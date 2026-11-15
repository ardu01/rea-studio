import type { OllamaListResult, OllamaModel, OllamaProgress, OllamaSuggestion } from '../shared/types.js'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * Modelos sugeridos para descargar con Ollama. Los tres de Huihui son los mismos
 * GGUF que usa el catálogo de Sopa (Sopa-IA-new/sopa, sopa_app/catalogo.json,
 * esquema 3, revisión 9). Ollama los descarga de Hugging Face con hf.co/<repo>:<cuantización>.
 */
export const OLLAMA_SUGGESTIONS: readonly OllamaSuggestion[] = [
  {
    name: 'hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M',
    label: 'Qwen3.5 9B sin censura (Huihui, Q4_K_M)',
    file: 'Huihui-Qwen3.5-9B-abliterated.Q4_K_M.gguf',
    bytes: 5627045248,
    uncensored: true,
    hint: 'Recomendado para 16 GB de RAM.',
  },
  {
    name: 'hf.co/mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF:Q4_K_M',
    label: 'Qwen3.5 4B sin censura (Huihui, Q4_K_M)',
    file: 'Huihui-Qwen3.5-4B-abliterated.Q4_K_M.gguf',
    bytes: 2707514688,
    uncensored: true,
    hint: 'El más ligero.',
  },
  {
    name: 'hf.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF:UD-IQ3_XXS',
    label: 'Qwen3.8 27B sin censura (Huihui, UD-IQ3_XXS)',
    file: 'Huihui-Qwen3.8-27B-abliterated-UD-IQ3_XXS.gguf',
    bytes: 11021122464,
    uncensored: true,
    hint: 'Pensado para una GPU de 12 GB. Va justo con 16 GB de RAM.',
  },
  {
    name: 'llama3.2',
    label: 'Llama 3.2 3B (biblioteca de Ollama)',
    bytes: null,
    uncensored: false,
    hint: 'El modelo por defecto del proveedor compatible.',
  },
]

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/

export function assertOllamaModelName(name: string): string {
  const trimmed = name.trim()
  if (!MODEL_NAME.test(trimmed) || trimmed.includes('..') || trimmed.includes('//')) {
    throw new Error('El nombre del modelo no es válido.')
  }
  return trimmed
}

/**
 * Convierte el endpoint OpenAI compatible (http://127.0.0.1:11434/v1) en la raíz
 * de la API nativa de Ollama (http://127.0.0.1:11434). Solo admite localhost.
 */
export function ollamaBaseFromEndpoint(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('El endpoint no es una URL válida.')
  }
  if (url.username || url.password) throw new Error('El endpoint no puede incluir usuario ni contraseña.')
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('El endpoint debe ser http o https.')
  if (!LOOPBACK.has(url.hostname)) throw new Error('Solo se consulta Ollama en este equipo (localhost).')
  const pathname = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
  return `${url.protocol}//${url.host}${pathname}`
}

export function isLocalEndpoint(endpoint: string): boolean {
  try {
    ollamaBaseFromEndpoint(endpoint)
    return true
  } catch {
    return false
  }
}

function networkMessage(error: unknown, base: string): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string } }
  if (err?.name === 'AbortError') return 'Cancelado.'
  if (err?.name === 'TimeoutError') return `Ollama no respondió a tiempo en ${base}.`
  const code = err?.cause?.code
  if (code === 'ECONNREFUSED') return `No hay ningún Ollama escuchando en ${base}. ¿Está abierto?`
  return `No se pudo conectar con ${base}: ${String(err?.message ?? 'error de red').slice(0, 200)}`
}

export async function listOllamaModels(opts: {
  endpoint: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<OllamaListResult> {
  let base: string
  try {
    base = ollamaBaseFromEndpoint(opts.endpoint)
  } catch (error) {
    return { available: false, base: null, models: [], detail: (error as Error).message }
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(`${base}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    })
    if (!response.ok) {
      return { available: false, base, models: [], detail: `El servidor respondió HTTP ${response.status}; no parece Ollama.` }
    }
    const json = (await response.json()) as { models?: unknown }
    if (!json || !Array.isArray(json.models)) {
      return { available: false, base, models: [], detail: 'El servidor respondió, pero no como Ollama.' }
    }
    const models: OllamaModel[] = []
    for (const item of json.models as Array<Record<string, unknown>>) {
      const name = typeof item?.name === 'string' ? item.name : typeof item?.model === 'string' ? item.model : null
      if (!name) continue
      const details = (item.details ?? {}) as Record<string, unknown>
      models.push({
        name,
        bytes: typeof item.size === 'number' ? item.size : null,
        parameterSize: typeof details.parameter_size === 'string' ? details.parameter_size : null,
        quantization: typeof details.quantization_level === 'string' ? details.quantization_level : null,
      })
    }
    models.sort((a, b) => a.name.localeCompare(b.name))
    return {
      available: true,
      base,
      models,
      detail: models.length ? `${models.length} modelo${models.length === 1 ? '' : 's'} en Ollama.` : 'Ollama responde, pero no tiene modelos.',
    }
  } catch (error) {
    return { available: false, base, models: [], detail: networkMessage(error, base) }
  }
}

const STATUS_ES: Array<[RegExp, string]> = [
  [/^pulling manifest$/i, 'Descargando el manifiesto'],
  [/^pulling [0-9a-f]{6,}/i, 'Descargando'],
  [/^downloading/i, 'Descargando'],
  [/^verifying sha256 digest$/i, 'Comprobando el SHA-256'],
  [/^writing manifest$/i, 'Guardando el manifiesto'],
  [/^removing any unused layers$/i, 'Limpiando capas que ya no se usan'],
  [/^success$/i, 'Descarga completada'],
]

export function translatePullStatus(status: string): string {
  for (const [pattern, text] of STATUS_ES) if (pattern.test(status)) return text
  return status.slice(0, 160)
}

export function translatePullError(error: string): string {
  const lower = error.toLowerCase()
  if (lower.includes('file does not exist') || lower.includes('not found') || lower.includes('manifest unknown')) {
    return 'Ese modelo o esa cuantización no existen.'
  }
  if (lower.includes('no space left')) return 'No queda espacio en el disco.'
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
    return 'El repositorio pide permiso o inicio de sesión en Hugging Face.'
  }
  if (lower.includes('connection') || lower.includes('timeout') || lower.includes('dial tcp')) {
    return 'Se cortó la conexión durante la descarga. Puedes reintentarlo: Ollama reanuda lo ya bajado.'
  }
  return `Ollama devolvió un error: ${error.slice(0, 200)}`
}

/** Divide un búfer NDJSON en líneas completas y el resto pendiente. */
export function splitNdjson(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split(/\r?\n/)
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((line) => line.trim() !== ''), rest }
}

export async function pullOllamaModel(opts: {
  endpoint: string
  model: string
  signal: AbortSignal
  onProgress: (progress: OllamaProgress) => void
  fetchImpl?: typeof fetch
}): Promise<void> {
  const base = ollamaBaseFromEndpoint(opts.endpoint)
  const model = assertOllamaModelName(opts.model)
  const fetchImpl = opts.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(`${base}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
      signal: opts.signal,
    })
  } catch (error) {
    throw new Error(networkMessage(error, base))
  }
  if (!response.ok) {
    let detail = ''
    try {
      const text = await response.text()
      const parsed = JSON.parse(text) as { error?: string }
      detail = parsed.error ?? text
    } catch {
      /* cuerpo vacío o no JSON */
    }
    throw new Error(detail ? translatePullError(detail) : `Ollama respondió HTTP ${response.status}.`)
  }
  if (!response.body) throw new Error('Ollama no devolvió el progreso de la descarga.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  const handle = (line: string) => {
    let json: { status?: string; error?: string; total?: number; completed?: number }
    try {
      json = JSON.parse(line)
    } catch {
      return
    }
    if (json.error) throw new Error(translatePullError(json.error))
    const status = typeof json.status === 'string' ? json.status : ''
    if (/^success$/i.test(status)) finished = true
    opts.onProgress({
      status: translatePullStatus(status),
      completed: typeof json.completed === 'number' ? json.completed : null,
      total: typeof json.total === 'number' ? json.total : null,
    })
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { lines, rest } = splitNdjson(buffer)
      buffer = rest
      for (const line of lines) handle(line)
    }
    buffer += decoder.decode()
    if (buffer.trim()) handle(buffer)
  } catch (error) {
    if (opts.signal.aborted || (error as Error)?.name === 'AbortError') throw new Error('Cancelado.')
    throw error
  }
  if (opts.signal.aborted) throw new Error('Cancelado.')
  if (!finished) throw new Error('La descarga terminó sin confirmación de Ollama.')
}
