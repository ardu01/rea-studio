import { readFile } from 'node:fs/promises'
import { DOC_LINKS, type ProviderCheck, type ProviderPublic, type PublicSettings } from '../shared/types.js'
import { endpointLeavesDevice } from './settings.js'
import { allowedEnv, runProcess } from './process.js'
import { findOnPath, planLaunch } from './command.js'
import { scrubProviderError } from './redact.js'

export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'xai',
  'gemini',
  'compatible',
  'codex-cli',
  'claude-cli',
  'gemini-cli',
] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

const SYSTEM = [
  'Eres el asistente de REA Studio.',
  'El usuario estudia artefactos que declara tener autorización para examinar.',
  'Resume solo el contexto que te entrega, distingue hechos de hipótesis y no inventes salidas de herramientas.',
  'No des instrucciones para acceder a sistemas ajenos ni para evadir protecciones.',
].join(' ')

export function assertProviderId(id: string): ProviderId {
  if ((PROVIDER_IDS as readonly string[]).includes(id)) return id as ProviderId
  throw new Error('Proveedor desconocido.')
}

export function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export interface SseEvent {
  event: string
  data: string
}

export function parseSseBlocks(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  const events: SseEvent[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    let event = 'message'
    const data: string[] = []
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (data.length) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

export function openAIDelta(data: string): string | null {
  if (data.trim() === '[DONE]') return null
  const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
  const content = json.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : null
}

export function anthropicDelta(data: string): string | null {
  const json = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } }
  if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && typeof json.delta.text === 'string') {
    return json.delta.text
  }
  return null
}

export function geminiDelta(data: string): string | null {
  const json = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const parts = json.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts.map((part) => part.text ?? '').join('')
  return text || null
}

export function claudeCliDelta(line: string): string | null {
  const json = JSON.parse(line) as { type?: string; event?: { delta?: { type?: string; text?: string } } }
  if (json.type === 'stream_event' && json.event?.delta?.type === 'text_delta' && typeof json.event.delta.text === 'string') {
    return json.event.delta.text
  }
  return null
}

export function claudeCliResult(line: string): string | null {
  const json = JSON.parse(line) as { type?: string; result?: string }
  if (json.type === 'result' && typeof json.result === 'string') return json.result
  return null
}

export function codexAgentText(line: string): string | null {
  const json = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } }
  if (json.type === 'item.completed' && typeof json.item?.text === 'string') return json.item.text
  return null
}

export function geminiCliPiece(line: string): { delta?: string; result?: string } {
  const json = JSON.parse(line) as {
    type?: string
    content?: unknown
    response?: string
    message?: { content?: unknown }
  }
  const fromContent = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value) return value
    if (Array.isArray(value)) {
      const text = value
        .map((part) => (typeof part === 'string' ? part : typeof (part as { text?: string }).text === 'string' ? (part as { text: string }).text : ''))
        .join('')
      return text || undefined
    }
    return undefined
  }
  if (json.type === 'result' && typeof json.response === 'string') return { result: json.response }
  const delta = fromContent(json.content) ?? fromContent(json.message?.content)
  return delta ? { delta } : {}
}

export function codexArgs(model: string, outputFile: string): string[] {
  const args = [
    'exec',
    '--json',
    '--ephemeral',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--color',
    'never',
    '--output-last-message',
    outputFile,
  ]
  if (model.trim()) args.push('--model', model.trim())
  args.push('-')
  return args
}

export function claudeArgs(model: string, question: string): string[] {
  const args = [
    '--safe-mode',
    '--permission-mode',
    'plan',
    '--tools',
    '',
    '--max-turns',
    '1',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]
  if (model.trim()) args.push('--model', model.trim())
  args.push('-p', guardQuestion(question))
  return args
}

export function geminiCliArgs(model: string, question: string): string[] {
  const args = ['--skip-trust', '--approval-mode', 'plan', '--output-format', 'stream-json', '-p', guardQuestion(question)]
  if (model.trim()) args.push('-m', model.trim())
  return args
}

function guardQuestion(question: string): string {
  const trimmed = question.trim() || 'Resume el contexto adjunto.'
  if (trimmed.length > 6000) {
    throw new Error('La pregunta supera 6000 caracteres. El contexto largo va por la entrada estándar, no en el argumento.')
  }
  if (trimmed.startsWith('-')) return `Pregunta: ${trimmed}`
  return trimmed
}

export function publicProviders(settings: PublicSettings, configured: ReadonlySet<string>): ProviderPublic[] {
  const api = (
    id: 'openai' | 'anthropic' | 'xai' | 'gemini' | 'compatible',
    label: string,
    docsUrl: string,
    note: string,
  ): ProviderPublic => ({
    id,
    label,
    transport: 'api',
    model: settings.providers[id].model,
    endpoint: settings.providers[id].endpoint,
    configured: configured.has(id),
    leavesDevice: endpointLeavesDevice(settings.providers[id].endpoint),
    docsUrl,
    note,
  })
  return [
    api('openai', 'OpenAI', DOC_LINKS.openaiApi, 'Chat Completions en streaming. La clave se guarda cifrada en este equipo.'),
    api('anthropic', 'Anthropic Claude', DOC_LINKS.anthropicApi, 'API Messages nativa. No usa la sesión del navegador.'),
    api('xai', 'xAI Grok', DOC_LINKS.xaiApi, 'API compatible con Chat Completions en api.x.ai. No hay CLI oficial cableada.'),
    api('gemini', 'Google Gemini', DOC_LINKS.geminiApi, 'streamGenerateContent. La clave va en la cabecera x-goog-api-key, no en la URL.'),
    api(
      'compatible',
      'OpenAI compatible',
      DOC_LINKS.openaiApi,
      'Sirve para un servidor local (Ollama, LM Studio u otro) o un proxy compatible. HTTP solo en localhost.',
    ),
    {
      id: 'codex-cli',
      label: 'Codex CLI',
      transport: 'cli',
      model: settings.providers.codexCli.model,
      configured: configured.has('codex-cli'),
      leavesDevice: true,
      docsUrl: DOC_LINKS.codexCli,
      note: 'codex exec en sandbox de solo lectura. Usa el inicio de sesión que ya tengas en Codex. No se fuerza --yolo.',
    },
    {
      id: 'claude-cli',
      label: 'Claude Code',
      transport: 'cli',
      model: settings.providers.claudeCli.model,
      configured: configured.has('claude-cli'),
      leavesDevice: true,
      docsUrl: DOC_LINKS.claudeCli,
      note: 'claude -p con --safe-mode, --permission-mode plan y --tools vacío. Reutiliza la autenticación normal del CLI, no --bare.',
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      transport: 'cli',
      model: settings.providers.geminiCli.model,
      configured: configured.has('gemini-cli'),
      leavesDevice: true,
      docsUrl: DOC_LINKS.geminiCli,
      note: 'gemini -p en modo plan. La sesión es la del CLI en este equipo.',
    },
  ]
}

export async function checkProvider(opts: {
  id: ProviderId
  settings: PublicSettings
  apiKey: string | null
  cliPath?: string
  fetchImpl?: typeof fetch
  pathEnv?: string
  platform?: NodeJS.Platform
}): Promise<ProviderCheck> {
  if (opts.id.endsWith('-cli')) {
    const base = opts.id === 'codex-cli' ? 'codex' : opts.id === 'claude-cli' ? 'claude' : 'gemini'
    const key = opts.id === 'codex-cli' ? 'codex' : opts.id === 'claude-cli' ? 'claude' : 'gemini'
    const configured = opts.settings.tools[key as 'codex' | 'claude' | 'gemini']
    const executable = configured || opts.cliPath || findOnPath(base, opts.pathEnv ?? process.env.PATH ?? '', opts.platform ?? process.platform)
    if (!executable) {
      return { id: opts.id, state: 'not-configured', detail: 'No configurado', evidence: 'not-run' }
    }
    try {
      const launch = planLaunch(executable, ['--version'], opts.platform ?? process.platform, opts.pathEnv ?? process.env.PATH ?? '')
      const result = await runProcess({
        command: launch.command,
        args: launch.args,
        cwd: process.cwd(),
        timeoutMs: 20000,
        env: allowedEnv(),
      })
      const line = `${result.stdout}\n${result.stderr}`.trim().split('\n')[0] ?? ''
      if (result.exitCode !== 0) {
        return { id: opts.id, state: 'error', detail: line.slice(0, 300) || 'El CLI no respondió a --version.', evidence: 'cli-version' }
      }
      return {
        id: opts.id,
        state: 'present',
        detail: `${line.slice(0, 180) || 'CLI presente'}. La autenticación no se ha probado: un mensaje de prueba puede tener coste.`,
        evidence: 'cli-version',
      }
    } catch (error) {
      return { id: opts.id, state: 'error', detail: (error as Error).message, evidence: 'cli-version' }
    }
  }
  if (!opts.apiKey) {
    return { id: opts.id, state: 'not-configured', detail: 'No configurado', evidence: 'not-run' }
  }
  const endpoint = endpointFor(opts.id, opts.settings)
  const fetchImpl = opts.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(joinUrl(endpoint, 'models'), {
      method: 'GET',
      headers: authHeaders(opts.id, opts.apiKey),
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 401 || response.status === 403) {
      return { id: opts.id, state: 'rejected', detail: `El proveedor respondió ${response.status}.`, evidence: 'models-list' }
    }
    if (!response.ok) {
      const body = scrubProviderError(await response.text(), [opts.apiKey])
      return { id: opts.id, state: 'error', detail: `HTTP ${response.status}. ${body}`.slice(0, 400), evidence: 'models-list' }
    }
    return { id: opts.id, state: 'reachable', detail: 'La lista de modelos respondió. Esto no genera una completion.', evidence: 'models-list' }
  } catch (error) {
    return {
      id: opts.id,
      state: 'error',
      detail: scrubProviderError((error as Error).message, [opts.apiKey]),
      evidence: 'models-list',
    }
  }
}

function endpointFor(id: ProviderId, settings: PublicSettings): string {
  if (id === 'openai') return settings.providers.openai.endpoint
  if (id === 'anthropic') return settings.providers.anthropic.endpoint
  if (id === 'xai') return settings.providers.xai.endpoint
  if (id === 'gemini') return settings.providers.gemini.endpoint
  if (id === 'compatible') return settings.providers.compatible.endpoint
  throw new Error('Este proveedor no tiene endpoint HTTP.')
}

function authHeaders(id: ProviderId, apiKey: string): Record<string, string> {
  if (id === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
  }
  if (id === 'gemini') return { 'x-goog-api-key': apiKey }
  return { Authorization: `Bearer ${apiKey}` }
}

export async function runModel(opts: {
  id: ProviderId
  settings: PublicSettings
  apiKey: string | null
  prompt: string
  context: string
  cwd: string
  outputFile?: string
  timeoutMs: number
  signal: AbortSignal
  fetchImpl?: typeof fetch
  onDelta: (text: string) => void
  onLog: (text: string) => void
  executable?: string
}): Promise<string> {
  if (opts.prompt.length > 120_000 || opts.context.length > 120_000) {
    throw new Error('El contexto supera el límite de 120000 caracteres.')
  }
  if (opts.id === 'codex-cli' || opts.id === 'claude-cli' || opts.id === 'gemini-cli') {
    return runCli(opts)
  }
  if (!opts.apiKey) throw new Error('No configurado')
  return runApi({ ...opts, apiKey: opts.apiKey })
}

async function runApi(opts: {
  id: ProviderId
  settings: PublicSettings
  apiKey: string
  prompt: string
  context: string
  timeoutMs: number
  signal: AbortSignal
  fetchImpl?: typeof fetch
  onDelta: (text: string) => void
}): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const user = opts.context ? `${opts.prompt}\n\nContexto de análisis local, adjunto por el usuario:\n\n${opts.context}` : opts.prompt
  const endpoint = endpointFor(opts.id, opts.settings)
  const model = modelFor(opts.id, opts.settings)
  let url: string
  let body: unknown
  if (opts.id === 'anthropic') {
    url = joinUrl(endpoint, 'messages')
    body = { model, max_tokens: 4096, stream: true, system: SYSTEM, messages: [{ role: 'user', content: user }] }
  } else if (opts.id === 'gemini') {
    url = `${joinUrl(endpoint, `models/${encodeURIComponent(model)}:streamGenerateContent`)}?alt=sse`
    body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
    }
  } else {
    url = joinUrl(endpoint, 'chat/completions')
    body = {
      model,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }
  }
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { ...authHeaders(opts.id, opts.apiKey), 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]),
  })
  if (!response.ok) {
    const text = scrubProviderError(await response.text(), [opts.apiKey])
    throw new Error(`El proveedor respondió HTTP ${response.status}. ${text}`.slice(0, 500))
  }
  if (!response.body) throw new Error('El proveedor no envió un cuerpo.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let text = ''
  const take = (delta: string | null) => {
    if (!delta) return
    text += delta
    opts.onDelta(delta)
  }
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const parsed = parseSseBlocks(pending)
    pending = parsed.rest
    for (const event of parsed.events) {
      try {
        if (opts.id === 'anthropic') take(anthropicDelta(event.data))
        else if (opts.id === 'gemini') take(geminiDelta(event.data))
        else take(openAIDelta(event.data))
      } catch {
        /* ignore keep-alive or non-json lines */
      }
    }
  }
  return text
}

function modelFor(id: ProviderId, settings: PublicSettings): string {
  if (id === 'openai') return settings.providers.openai.model
  if (id === 'anthropic') return settings.providers.anthropic.model
  if (id === 'xai') return settings.providers.xai.model
  if (id === 'gemini') return settings.providers.gemini.model
  if (id === 'compatible') return settings.providers.compatible.model
  if (id === 'codex-cli') return settings.providers.codexCli.model
  if (id === 'claude-cli') return settings.providers.claudeCli.model
  return settings.providers.geminiCli.model
}

async function runCli(opts: {
  id: ProviderId
  settings: PublicSettings
  prompt: string
  context: string
  cwd: string
  outputFile?: string
  timeoutMs: number
  signal: AbortSignal
  onDelta: (text: string) => void
  onLog: (text: string) => void
  executable?: string
}): Promise<string> {
  const model = modelFor(opts.id, opts.settings)
  const toolKey = opts.id === 'codex-cli' ? 'codex' : opts.id === 'claude-cli' ? 'claude' : 'gemini'
  const basename = toolKey
  const configured = opts.settings.tools[toolKey].trim()
  const executable = opts.executable || configured || findOnPath(basename, process.env.PATH ?? '', process.platform)
  if (!executable) throw new Error('No configurado')
  const outputFile = opts.outputFile ?? ''
  let args: string[]
  let stdin: string | undefined
  if (opts.id === 'codex-cli') {
    if (!outputFile) throw new Error('Falta el archivo de salida de Codex.')
    args = codexArgs(model, outputFile)
    stdin = opts.context ? `${opts.prompt}\n\nContexto de análisis local, adjunto por el usuario:\n\n${opts.context}` : opts.prompt
  } else if (opts.id === 'claude-cli') {
    args = claudeArgs(model, opts.prompt)
    stdin = opts.context || undefined
  } else {
    args = geminiCliArgs(model, opts.prompt)
    stdin = opts.context || undefined
  }
  const launch = planLaunch(executable, args)
  let streamed = ''
  let finalText: string | null = null
  const result = await runProcess({
    command: launch.command,
    args: launch.args,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    stdin,
    env: allowedEnv(),
    signal: opts.signal,
    onChunk: (stream, chunk) => {
      opts.onLog(chunk)
      if (stream !== 'stdout') return
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          if (opts.id === 'claude-cli') {
            const delta = claudeCliDelta(line)
            if (delta) {
              streamed += delta
              opts.onDelta(delta)
            }
            const done = claudeCliResult(line)
            if (done) finalText = done
          } else if (opts.id === 'codex-cli') {
            const text = codexAgentText(line)
            if (text) finalText = text
          } else {
            const piece = geminiCliPiece(line)
            if (piece.delta) {
              streamed += piece.delta
              opts.onDelta(piece.delta)
            }
            if (piece.result) finalText = piece.result
          }
        } catch {
          /* stdout may include non-json diagnostics */
        }
      }
    },
  })
  if (result.cancelled) throw new Error('Cancelado.')
  if (result.timedOut) throw new Error('Tiempo agotado.')
  if (opts.id === 'codex-cli' && outputFile) {
    try {
      const fileText = (await readFile(outputFile, 'utf8')).trim()
      if (fileText) finalText = fileText
    } catch {
      /* the CLI may have failed before writing */
    }
  }
  if (result.exitCode !== 0 && !finalText && !streamed) {
    throw new Error(result.stderr.trim().slice(0, 500) || `El CLI terminó con código ${result.exitCode}.`)
  }
  if (!streamed && finalText) opts.onDelta(finalText)
  return streamed || finalText || ''
}
