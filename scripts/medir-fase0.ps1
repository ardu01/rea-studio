<#
.SYNOPSIS
  Fase 0 del modo Proyecto: mide un modelo local de Ollama en esta máquina.

.DESCRIPTION
  Carga UN modelo en Ollama (localhost), mide velocidad y memoria con varios
  tamaños de contexto (num_ctx), comprueba si responde con llamadas a
  herramientas y lo descarga al terminar (keep_alive = 0).

  NO lo ejecutes sin el sí de Miguel para cargar ese modelo concreto.
  No descarga modelos, no cambia la configuración de Ollama, ni la energía,
  ni el firewall. Si la RAM libre baja de -MinFreeGB, se para.

  Resultado: una carpeta medidas-fase0-<fecha> con resultados.json,
  resultados.csv y las lecturas de nvidia-smi.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\medir-fase0.ps1 `
    -Model "hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M" -Confirmo
#>
param(
  [Parameter(Mandatory = $true)][string]$Model,
  [int[]]$Contexts = @(4096, 8192, 16384),
  [string]$Endpoint = 'http://127.0.0.1:11434',
  [double]$MinFreeGB = 3.0,
  [int]$TimeoutSec = 900,
  [string]$OutDir = '',
  [switch]$Confirmo
)

$ErrorActionPreference = 'Stop'

if (-not $Confirmo) {
  Write-Host 'Este script carga un modelo en Ollama. Vuelve a lanzarlo con -Confirmo cuando Miguel haya dado el sí para este modelo.'
  exit 2
}

$uri = [Uri]$Endpoint
if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1', '[::1]')) {
  throw 'Solo se mide contra Ollama en localhost.'
}
$base = $Endpoint.TrimEnd('/')
if (-not $OutDir) { $OutDir = Join-Path (Get-Location) ("medidas-fase0-" + (Get-Date -Format 'yyyyMMdd-HHmm')) }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-FreeRamGB {
  $os = Get-CimInstance Win32_OperatingSystem
  [math]::Round($os.FreePhysicalMemory / 1MB, 2)
}
function Get-TotalRamGB {
  $os = Get-CimInstance Win32_OperatingSystem
  [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
}
function Get-Gpu {
  $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
  if (-not $smi) { return $null }
  $line = & $smi.Source --query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits | Select-Object -First 1
  $p = $line -split ',\s*'
  [pscustomobject]@{ name = $p[0]; vramUsedMB = [int]$p[1]; vramTotalMB = [int]$p[2]; utilPct = [int]$p[3]; tempC = [int]$p[4] }
}
function Invoke-Ollama($path, $body) {
  $json = $body | ConvertTo-Json -Depth 12 -Compress
  Invoke-RestMethod -Method Post -Uri "$base$path" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8' -TimeoutSec $TimeoutSec
}
function Unload {
  try { Invoke-Ollama '/api/generate' @{ model = $Model; keep_alive = 0 } | Out-Null } catch { Write-Warning "No se pudo descargar el modelo: $($_.Exception.Message)" }
}

# Comprobaciones previas
$tags = Invoke-RestMethod -Uri "$base/api/tags" -TimeoutSec 10
if (-not ($tags.models | Where-Object { $_.name -eq $Model -or $_.model -eq $Model })) {
  throw "El modelo no está instalado en Ollama: $Model. Este script no descarga modelos."
}
$ps = Invoke-RestMethod -Uri "$base/api/ps" -TimeoutSec 10
if ($ps.models -and $ps.models.Count -gt 0) {
  throw ('Ya hay un modelo cargado en Ollama (' + (($ps.models | ForEach-Object { $_.name }) -join ', ') + '). Una cosa a la vez: espera a que se descargue.')
}
$before = [pscustomobject]@{ freeRamGB = Get-FreeRamGB; totalRamGB = Get-TotalRamGB; gpu = Get-Gpu }
$before | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'antes.json')
Write-Host ("RAM libre {0} de {1} GB" -f $before.freeRamGB, $before.totalRamGB)
if ($before.freeRamGB -lt $MinFreeGB + 2) { throw "Poca RAM libre ($($before.freeRamGB) GB). No se carga nada." }

# Texto de relleno para llenar el contexto (código ficticio, sin datos personales)
$filler = (1..400 | ForEach-Object { "function paso$_(registro) { return registro.valor * $_ + 1 } // línea de ejemplo $_" }) -join "`n"
$tools = @(@{ type = 'function'; function = @{ name = 'leer'; description = 'Lee un archivo del proyecto'; parameters = @{ type = 'object'; properties = @{ ruta = @{ type = 'string' } }; required = @('ruta') } } })

$results = @()
try {
  foreach ($ctx in $Contexts) {
    $free = Get-FreeRamGB
    if ($free -lt $MinFreeGB) { Write-Warning "RAM libre $free GB < $MinFreeGB GB: me paro."; break }
    $promptChars = [math]::Min($filler.Length, [int]($ctx * 2.2))
    $prompt = "Resume en una frase qué hace este código:`n" + $filler.Substring(0, $promptChars)
    Write-Host "num_ctx=$ctx …"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $r = Invoke-Ollama '/api/chat' @{ model = $Model; stream = $false; keep_alive = '5m'; options = @{ num_ctx = $ctx; temperature = 0 }; messages = @(@{ role = 'user'; content = $prompt }) }
    $sw.Stop()
    $gpu = Get-Gpu
    $loaded = (Invoke-RestMethod -Uri "$base/api/ps" -TimeoutSec 10).models | Where-Object { $_.name -eq $Model } | Select-Object -First 1
    $row = [pscustomobject]@{
      model             = $Model
      numCtx            = $ctx
      wallSec           = [math]::Round($sw.Elapsed.TotalSeconds, 1)
      loadSec           = [math]::Round($r.load_duration / 1e9, 1)
      promptTokens      = $r.prompt_eval_count
      promptTokPerSec   = if ($r.prompt_eval_duration) { [math]::Round($r.prompt_eval_count / ($r.prompt_eval_duration / 1e9), 1) } else { $null }
      outTokens         = $r.eval_count
      outTokPerSec      = if ($r.eval_duration) { [math]::Round($r.eval_count / ($r.eval_duration / 1e9), 1) } else { $null }
      modelSizeGB       = if ($loaded) { [math]::Round($loaded.size / 1GB, 2) } else { $null }
      modelVramGB       = if ($loaded) { [math]::Round($loaded.size_vram / 1GB, 2) } else { $null }
      freeRamGB         = Get-FreeRamGB
      vramUsedMB        = if ($gpu) { $gpu.vramUsedMB } else { $null }
      gpuTempC          = if ($gpu) { $gpu.tempC } else { $null }
    }
    $row | Format-List | Out-String | Write-Host
    $results += $row
  }

  # ¿Responde con llamadas a herramientas?
  $toolTest = [pscustomobject]@{ supported = $false; called = $false; error = $null }
  try {
    $r = Invoke-Ollama '/api/chat' @{ model = $Model; stream = $false; keep_alive = '1m'; options = @{ num_ctx = $Contexts[0]; temperature = 0 }; tools = $tools; messages = @(@{ role = 'user'; content = 'Lee el archivo src/index.js usando la herramienta leer.' }) }
    $toolTest.supported = $true
    $toolTest.called = [bool]($r.message.tool_calls | Where-Object { $_.function.name -eq 'leer' })
  } catch {
    $toolTest.error = $_.Exception.Message
  }
  Write-Host ("Herramientas: admitidas={0} usadas={1}" -f $toolTest.supported, $toolTest.called)
}
finally {
  Unload
}

$summary = [pscustomobject]@{ when = (Get-Date).ToString('s'); before = $before; runs = $results; tools = $toolTest }
$summary | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $OutDir 'resultados.json')
$results | Export-Csv -NoTypeInformation -Encoding UTF8 (Join-Path $OutDir 'resultados.csv')
Write-Host "Listo. Resultados en $OutDir"
