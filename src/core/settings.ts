import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { assertNoSecretFields } from './redact.js'
import { assertAbsoluteUserPath } from './paths.js'
import type { PublicSettings } from '../shared/types.js'

export function defaultSettings(): PublicSettings {
  return {
    acceptedUseNotice: false,
    onboardingComplete: false,
    workspacePath: null,
    recentWorkspaces: [],
    tools: {
      rea: '',
      ghidra: '',
      java: '',
      radare2: '',
      rabin2: '',
      rizin: '',
      rzBin: '',
      codex: '',
      claude: '',
      gemini: '',
    },
    providers: {
      openai: { model: 'gpt-4.1-mini', endpoint: 'https://api.openai.com/v1' },
      anthropic: { model: 'claude-sonnet-4-5', endpoint: 'https://api.anthropic.com/v1' },
      xai: { model: 'grok-4', endpoint: 'https://api.x.ai/v1' },
      gemini: { model: 'gemini-2.5-flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
      compatible: { model: 'llama3.2', endpoint: 'http://127.0.0.1:11434/v1' },
      codexCli: { model: '' },
      claudeCli: { model: '' },
      geminiCli: { model: '' },
    },
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function assertEndpoint(endpoint: string): URL {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    throw new Error('El endpoint no es una URL válida.')
  }
  if (url.username || url.password) {
    throw new Error('El endpoint no puede incluir usuario ni contraseña.')
  }
  if (url.protocol === 'https:') return url
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return url
  throw new Error('El endpoint debe usar https, salvo un servicio en localhost.')
}

export function endpointLeavesDevice(endpoint: string): boolean {
  const url = assertEndpoint(endpoint)
  return !(url.protocol === 'http:' && isLoopback(url.hostname))
}

export function normalizeSettings(input: unknown): PublicSettings {
  assertNoSecretFields(input)
  const base = defaultSettings()
  if (!input || typeof input !== 'object') return base
  const raw = input as Partial<PublicSettings>
  const tools = { ...base.tools, ...(raw.tools ?? {}) }
  for (const key of Object.keys(tools) as (keyof PublicSettings['tools'])[]) {
    const value = tools[key]
    if (typeof value !== 'string') throw new Error('La ruta de una herramienta no es texto.')
    if (value.trim() === '') {
      tools[key] = ''
      continue
    }
    tools[key] = assertAbsoluteUserPath(value)
  }
  const providers = structuredClone(base.providers)
  const incoming = (raw.providers ?? {}) as Partial<Record<keyof PublicSettings['providers'], { model?: string; endpoint?: string }>>
  for (const key of ['openai', 'anthropic', 'xai', 'gemini', 'compatible'] as const) {
    const item = incoming[key]
    if (!item) continue
    if (item.model !== undefined) {
      if (typeof item.model !== 'string' || item.model.length > 120) throw new Error('Identificador de modelo inválido.')
      providers[key].model = item.model.trim()
    }
    if (item.endpoint !== undefined) {
      const url = assertEndpoint(item.endpoint)
      if (url.search || url.hash) throw new Error('El endpoint no puede llevar consulta ni ancla.')
      providers[key].endpoint = `${url.origin}${url.pathname}`.replace(/\/$/, '')
    }
  }
  for (const key of ['codexCli', 'claudeCli', 'geminiCli'] as const) {
    const item = incoming[key]
    if (!item?.model) continue
    if (typeof item.model !== 'string' || item.model.length > 120) throw new Error('Identificador de modelo inválido.')
    providers[key].model = item.model.trim()
  }
  const recent = Array.isArray(raw.recentWorkspaces)
    ? raw.recentWorkspaces.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : []
  let workspacePath: string | null = null
  if (typeof raw.workspacePath === 'string' && raw.workspacePath.trim()) {
    workspacePath = assertAbsoluteUserPath(raw.workspacePath)
  }
  return {
    acceptedUseNotice: raw.acceptedUseNotice === true,
    onboardingComplete: raw.onboardingComplete === true && raw.acceptedUseNotice === true && !!workspacePath,
    workspacePath,
    recentWorkspaces: recent,
    tools,
    providers,
  }
}

export async function loadSettings(file: string): Promise<PublicSettings> {
  try {
    const raw = await readFile(file, 'utf8')
    return normalizeSettings(JSON.parse(raw))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return defaultSettings()
    if (error instanceof SyntaxError) return defaultSettings()
    throw error
  }
}

export async function saveSettings(file: string, settings: PublicSettings): Promise<void> {
  const clean = normalizeSettings(settings)
  assertNoSecretFields(clean)
  await mkdir(path.dirname(file), { recursive: true })
  const body = JSON.stringify(clean, null, 2)
  await writeFile(file, `${body}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function ensureWorkspace(dir: string, name: string): Promise<void> {
  const resolved = assertAbsoluteUserPath(dir)
  await access(resolved)
  await mkdir(path.join(resolved, 'jobs'), { recursive: true })
  const manifestPath = path.join(resolved, 'rea-studio.json')
  let createdAt = new Date().toISOString()
  try {
    const existing = JSON.parse(await readFile(manifestPath, 'utf8')) as { createdAt?: string }
    if (existing.createdAt) createdAt = existing.createdAt
  } catch {
    /* new workspace */
  }
  const manifest = {
    name: name.trim() || path.basename(resolved),
    createdAt,
    app: 'rea-studio',
    version: '0.1.0',
  }
  assertNoSecretFields(manifest)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export function rememberWorkspace(settings: PublicSettings, dir: string): PublicSettings {
  const next = [dir, ...settings.recentWorkspaces.filter((item) => item !== dir)].slice(0, 8)
  return { ...settings, workspacePath: dir, recentWorkspaces: next }
}
