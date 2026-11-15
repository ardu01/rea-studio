import { existsSync } from 'node:fs'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { CommandCheck, CommandResult } from '../../shared/types.js'
import { findOnPath, planLaunch } from '../command.js'
import { allowedEnv, runProcess } from '../process.js'

export const MAX_ARGS = 40
export const DEFAULT_TIMEOUT_SEC = 600
export const MAX_TIMEOUT_SEC = 1800
export const OUTPUT_TAIL = 12_000

/** Caracteres que una shell interpretaría. Se rechazan aunque nunca se use shell. */
const META = /[&|;<>`$^%!"\r\n]/

type Rule = (args: string[]) => { kind: 'normal' | 'install'; network: boolean } | string

const NODE_BLOCKED = new Set(['-e', '--eval', '-p', '--print', '-r', '--require', '--import', '--loader', '--experimental-loader', '-i', '--interactive'])
const NPM_GLOBAL = /^(-g|--global|--location(=.*)?|--prefix(=.*)?)$/

function firstWord(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith('-'))
}

const normal = { kind: 'normal' as const, network: false }
const install = { kind: 'install' as const, network: true }

const pythonRule: Rule = (args) => {
  if (args.includes('-c')) return 'python -c no está permitido: ejecuta un archivo .py del proyecto.'
  const m = args.indexOf('-m')
  if (m !== -1) {
    const mod = args[m + 1]
    if (mod === 'pip') return pipRule(args.slice(m + 2))
    if (mod && ['unittest', 'pytest', 'venv', 'compileall', 'py_compile'].includes(mod)) return normal
    return `python -m ${mod ?? ''} no está en la lista permitida.`
  }
  const script = firstWord(args)
  if (!script) return 'Indica un archivo .py del proyecto.'
  if (!script.toLowerCase().endsWith('.py')) return 'python solo ejecuta archivos .py del proyecto.'
  return normal
}

const pipRule: Rule = (args) => {
  const sub = firstWord(args)
  if (sub === 'install') {
    if (args.some((arg) => arg === '--user' || arg.startsWith('--target') || arg.startsWith('--prefix') || arg.startsWith('--root'))) {
      return 'pip install solo instala en el entorno virtual del proyecto (.venv).'
    }
    return install
  }
  if (sub && ['list', 'show', 'freeze', 'check'].includes(sub)) return normal
  return `pip ${sub ?? ''} no está en la lista permitida.`
}

export const COMMAND_RULES: Record<string, Rule> = {
  npm: (args) => {
    if (args.some((arg) => NPM_GLOBAL.test(arg))) return 'npm global o con --prefix no está permitido.'
    const sub = firstWord(args)
    if (sub && ['test', 't', 'run', 'run-script', 'start', 'ls', 'list'].includes(sub)) {
      if ((sub === 'run' || sub === 'run-script') && args.indexOf(sub) === args.length - 1) return 'Indica el script: npm run <script>.'
      return normal
    }
    if (sub && ['ci', 'install', 'i', 'add'].includes(sub)) return install
    return `npm ${sub ?? ''} no está en la lista permitida.`
  },
  node: (args) => {
    if (args.some((arg) => NODE_BLOCKED.has(arg.split('=')[0]!) || arg.startsWith('--inspect'))) return 'Esa opción de node no está permitida.'
    if (!firstWord(args) && !args.includes('--test')) return 'Indica un archivo del proyecto o --test.'
    return normal
  },
  python: pythonRule,
  python3: pythonRule,
  py: pythonRule,
  pytest: () => normal,
  pip: pipRule,
  pip3: pipRule,
  dotnet: (args) => {
    const sub = firstWord(args)
    if (sub && ['build', 'test', 'run', 'clean'].includes(sub)) return normal
    if (sub === 'restore') return install
    if (sub === 'add') {
      if (args.includes('package')) return install
      if (args.includes('reference')) return normal
    }
    return `dotnet ${sub ?? ''} no está en la lista permitida.`
  },
  cmake: (args) => {
    if (args.some((arg) => arg === '-E' || arg === '-P' || arg === '--install' || arg.startsWith('--install'))) return 'cmake -E, -P y --install no están permitidos.'
    return normal
  },
  ctest: (args) => (args.some((arg) => arg === '-S' || arg.startsWith('--script')) ? 'ctest -S no está permitido.' : normal),
  ninja: () => normal,
  make: () => normal,
  cargo: (args) => {
    const sub = firstWord(args)
    if (sub && ['build', 'test', 'check', 'run', 'clippy', 'fmt'].includes(sub)) return normal
    if (sub && ['add', 'fetch', 'update'].includes(sub)) return install
    return `cargo ${sub ?? ''} no está en la lista permitida.`
  },
  go: (args) => {
    const sub = firstWord(args)
    if (sub && ['build', 'test', 'vet', 'run', 'fmt'].includes(sub)) return normal
    if (sub === 'get' || (sub === 'mod' && ['download', 'tidy'].includes(args[args.indexOf('mod') + 1] ?? ''))) return install
    return `go ${sub ?? ''} no está en la lista permitida.`
  },
  git: (args) => {
    const sub = firstWord(args)
    if (sub && ['status', 'diff', 'log'].includes(sub)) {
      const risky = args.find((arg) => /^--(output|ext-diff|textconv|exec-path|git-dir|work-tree)(=|$)/.test(arg))
      if (risky) return `git ${sub} no admite ${risky.split('=')[0]} aquí.`
      return normal
    }
    return 'De git solo se permiten status, diff y log. Los commits los hace REA Studio.'
  },
}

export const ALLOWED_COMMANDS = Object.keys(COMMAND_RULES)

function looksAbsolute(value: string): boolean {
  return value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)
}

/** Comprueba que los argumentos con aspecto de ruta no salgan de la carpeta del proyecto. */
function checkPathArg(root: string, arg: string): string | null {
  const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg
  if (!value) return null
  const segments = value.split(/[\\/]/)
  if (!looksAbsolute(value) && !segments.includes('..')) return null
  if (looksAbsolute(value) && !path.isAbsolute(value)) return `El argumento «${arg}» apunta fuera de la carpeta del proyecto.`
  const resolved = path.resolve(root, value)
  const rel = path.relative(root, resolved)
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return `El argumento «${arg}» apunta fuera de la carpeta del proyecto.`
  return null
}

export function displayCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => (/\s/.test(arg) ? `'${arg}'` : arg))].join(' ')
}

export function classifyCommand(command: string, args: string[], root: string): CommandCheck {
  const display = displayCommand(command, args)
  const deny = (reason: string): CommandCheck => ({ allowed: false, kind: 'normal', network: false, reason, display, command, args })
  const rule = COMMAND_RULES[command]
  if (!rule) return deny(`«${command}» no está en la lista de comandos permitidos (${ALLOWED_COMMANDS.join(', ')}).`)
  if (args.length > MAX_ARGS) return deny('Demasiados argumentos.')
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > 1000) return deny('Argumento inválido.')
    if (META.test(arg) || /[\u0000-\u001f]/.test(arg)) return deny(`El argumento «${arg.slice(0, 40)}» lleva caracteres de shell; no se ejecuta.`)
    const outside = checkPathArg(root, arg)
    if (outside) return deny(outside)
  }
  const verdict = rule(args)
  if (typeof verdict === 'string') return deny(verdict)
  return { allowed: true, kind: verdict.kind, network: verdict.network, display, command, args }
}

/** Instalar paquetes siempre pide confirmación. El resto, solo si no está activado el modo autónomo. */
export function needsApproval(check: CommandCheck, autonomous: boolean): boolean {
  if (!check.allowed) return true
  if (check.kind === 'install') return true
  return !autonomous
}

/** Divide una línea de comando escrita por el usuario. Admite comillas simples o dobles para espacios. */
export function splitCommandLine(line: string): { command: string; args: string[] } {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (quote) throw new Error('Falta cerrar una comilla.')
  if (started) tokens.push(current)
  const [command, ...args] = tokens
  if (!command) throw new Error('Escribe un comando.')
  return { command, args }
}

export function commandEnv(): NodeJS.ProcessEnv {
  return {
    ...allowedEnv(),
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_update_notifier: 'false',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_NOLOGO: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    PIP_REQUIRE_VIRTUALENV: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  }
}

/** Busca el ejecutable. python usa el .venv del proyecto si existe. */
export function resolveExecutable(command: string, root: string, pathEnv = process.env.PATH ?? '', platform = process.platform): string | null {
  if (['python', 'python3', 'py', 'pip', 'pip3', 'pytest'].includes(command)) {
    const bin = platform === 'win32' ? path.join(root, '.venv', 'Scripts') : path.join(root, '.venv', 'bin')
    const name = command === 'py' || command === 'python3' ? 'python' : command === 'pip3' ? 'pip' : command
    const candidate = path.join(bin, platform === 'win32' ? `${name}.exe` : name)
    if (existsSync(candidate)) return candidate
  }
  const found = findOnPath(command, pathEnv, platform)
  if (found) return found
  if (command === 'python' && platform === 'win32') return findOnPath('py', pathEnv, platform)
  return null
}

function tail(text: string, max = OUTPUT_TAIL): string {
  if (text.length <= max) return text
  return `[… recortado …]\n${text.slice(-max)}`
}

export async function runProjectCommand(opts: {
  root: string
  check: CommandCheck
  timeoutSec?: number
  signal?: AbortSignal
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void
  resolve?: (command: string, root: string) => string | null
  now?: () => Date
}): Promise<CommandResult> {
  const { check, root } = opts
  if (!check.allowed) throw new Error(check.reason ?? 'Comando no permitido.')
  const exe = (opts.resolve ?? resolveExecutable)(check.command, root)
  if (!exe) throw new Error(`No se encuentra «${check.command}» en PATH.`)
  const timeoutSec = Math.max(1, Math.min(MAX_TIMEOUT_SEC, Math.round(opts.timeoutSec ?? DEFAULT_TIMEOUT_SEC)))
  const launch = planLaunch(exe, check.args)
  const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
  const logRel = `.rea/salidas/${stamp}-${check.command}.log`
  const logFile = path.join(root, ...logRel.split('/'))
  await mkdir(path.dirname(logFile), { recursive: true })
  await appendFile(logFile, `$ ${check.display}\n`, 'utf8')
  let combined = ''
  const result = await runProcess({
    command: launch.command,
    args: launch.args,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
    cwd: root,
    timeoutMs: timeoutSec * 1000,
    env: commandEnv(),
    signal: opts.signal,
    onChunk: (stream, text) => {
      combined += text
      if (combined.length > OUTPUT_TAIL * 4) combined = combined.slice(-OUTPUT_TAIL * 2)
      void appendFile(logFile, text, 'utf8').catch(() => undefined)
      opts.onChunk?.(stream, text)
    },
  })
  const status = result.cancelled ? 'cancelled' : result.timedOut ? 'timed-out' : result.exitCode === 0 ? 'succeeded' : 'failed'
  await appendFile(logFile, `\n[fin: ${status}, código ${result.exitCode ?? '—'}, ${result.durationMs} ms]\n`, 'utf8').catch(() => undefined)
  return {
    display: check.display,
    status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    output: tail(combined),
    logPath: logRel,
  }
}

/** Para el modelo: el final de la salida, que es donde suelen estar los errores. */
export function outputForModel(result: CommandResult, max = 4000): string {
  const head = `$ ${result.display}\nestado: ${result.status}, código: ${result.exitCode ?? '—'}\n`
  return head + tail(result.output, max)
}
