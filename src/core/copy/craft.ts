import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Vueltas máximas de comprobación después de copiar. */
export const CHECK_MAX_ROUNDS = 3
/** Parecido mínimo (porcentaje) para dar por buena una vuelta, el mismo umbral que Craft Anything. */
export const CHECK_GOOD_ENOUGH = 90

export const CRAFT_CONFIG_ENV = 'CRAFT_ANYTHING_CONFIG_DIR'

/** Argumentos globales seguros: Deep, JSON, sin --allow-run (el original no se ejecuta solo). */
export function craftGlobalArgs(opts?: { deep?: boolean }): string[] {
  const args = ['--format', 'json']
  if (opts?.deep !== false) args.unshift('--deep')
  return args
}

export function assertNoAllowRun(args: string[]): void {
  if (args.some((arg) => arg === '--allow-run' || arg === '--allow_run')) {
    throw new Error('La CLI de Craft Anything no puede ejecutarse con --allow-run desde REA Studio: el original no se lanza sin confirmación.')
  }
}

export function writeCraftConfigText(opts: {
  ghidraDir?: string
  javaHome?: string
  storeDir: string
  memoryGb?: number
  runtimeStudy?: boolean
}): string {
  const lines = [
    'version = 3',
    'deep_mode = true',
    'ask_before_running = true',
    `runtime_study = ${opts.runtimeStudy ? 'true' : 'false'}`,
    'auto_mode = false',
    '',
    '[engines]',
    `store_dir = ${tomlString(opts.storeDir)}`,
    '',
    '[engines.ghidra]',
  ]
  if (opts.ghidraDir) lines.push(`install_dir = ${tomlString(opts.ghidraDir)}`)
  if (opts.javaHome) lines.push(`java_home = ${tomlString(opts.javaHome)}`)
  lines.push(`memory_gb = ${opts.memoryGb ?? 4}`)
  lines.push('')
  lines.push('[build]')
  lines.push(`good_enough = ${CHECK_GOOD_ENOUGH}.0`)
  lines.push(`max_rounds = ${CHECK_MAX_ROUNDS}`)
  lines.push('')
  return lines.join('\n')
}

export async function writeCraftConfig(configDir: string, opts: { ghidraDir?: string; javaHome?: string; memoryGb?: number; runtimeStudy?: boolean }): Promise<string> {
  await mkdir(configDir, { recursive: true })
  const storeDir = path.join(configDir, 'engines')
  await mkdir(storeDir, { recursive: true })
  const text = writeCraftConfigText({ ...opts, storeDir })
  const file = path.join(configDir, 'config.toml')
  await writeFile(file, text, 'utf8')
  return file
}

export function craftEnv(configDir: string): Record<string, string> {
  return { [CRAFT_CONFIG_ENV]: configDir }
}

/** Ghidra de Craft Anything espera la carpeta de instalación (o el lanzador). */
export function ghidraInstallDir(launcher?: string): string | undefined {
  if (!launcher) return undefined
  // .../ghidra/support/analyzeHeadless(.bat) → .../ghidra
  return path.dirname(path.dirname(launcher))
}

export interface CraftCheckResult {
  alike: number | null
  pending: string
  raw: string
  usedCraft: boolean
  needsRun?: boolean
}

/** Extrae un porcentaje de parecido y el texto pendiente de una salida JSON o de texto de Craft Anything. */
export function parseCraftCheck(text: string): CraftCheckResult {
  const raw = text.trim()
  let alike: number | null = null
  let pending = ''
  let needsRun = false
  const json = extractJson(raw)
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const rec = json as Record<string, unknown>
    alike = numberish(rec.alike ?? rec.similarity ?? rec.score ?? rec.percent ?? rec.percentage)
    const pend = rec.pending ?? rec.mismatches ?? rec.remaining ?? rec.diff
    if (typeof pend === 'string') pending = pend
    else if (Array.isArray(pend)) pending = pend.map(String).join(' ')
    if (rec.needs_run === true || rec.needsRun === true) needsRun = true
  }
  if (alike == null) {
    const m = raw.match(/(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:alike|parecid|similar)/i) ?? raw.match(/parecido(?:\s*[:\-]?\s*)(\d{1,3}(?:[.,]\d+)?)\s*%/i)
    if (m) alike = Number(String(m[1]).replace(',', '.'))
  }
  if (!pending) {
    pending = extractPending(raw)
  }
  if (/ejecutar el original|run the original|needs.?run|runtime_study/i.test(raw)) needsRun = true
  if (alike != null && (alike < 0 || alike > 100 || Number.isNaN(alike))) alike = null
  return { alike, pending: pending.trim(), raw, usedCraft: true, needsRun }
}

export function formatAlike(alike: number | null): string {
  if (alike == null) return 'Sin un porcentaje medido.'
  return `${Math.round(alike)} % de parecido.`
}

function numberish(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace('%', '').replace(',', '.').trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

function extractPending(text: string): string {
  const m = text.match(/Pendiente\s*[:\-]?\s*([\s\S]*?)(?=\n\s*(?:Reproducción|Mejoras|Parecido)\s*[:\-]|$)/i)
  return m?.[1]?.trim() ?? ''
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
