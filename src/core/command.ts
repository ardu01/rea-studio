import { existsSync, statSync, accessSync, constants } from 'node:fs'
import path from 'node:path'
import { assertNoControl } from './paths.js'

const SAFE_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/
const CMD_META = /[&|<>^%!\r\n"]/

export interface LaunchPlan {
  command: string
  args: string[]
  shell: false
  viaCmd: boolean
}

export function assertCommandBasename(name: string): void {
  if (!SAFE_BASENAME.test(name)) {
    throw new Error('Nombre de ejecutable no permitido.')
  }
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

export function findOnPath(name: string, pathEnv: string, platform: NodeJS.Platform): string | null {
  assertCommandBasename(name)
  const sep = platform === 'win32' ? ';' : ':'
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = path.join(dir, platform === 'win32' ? name + ext : name)
      if (!isFile(candidate)) continue
      if (platform !== 'win32') {
        try {
          accessSync(candidate, constants.X_OK)
        } catch {
          continue
        }
      }
      return candidate
    }
  }
  return null
}

export function assertExistingFile(candidate: string): string {
  assertNoControl(candidate)
  if (!path.isAbsolute(candidate)) {
    throw new Error('La ruta de la herramienta debe ser absoluta.')
  }
  if (!isFile(candidate)) {
    throw new Error('No existe el ejecutable indicado.')
  }
  return path.resolve(candidate)
}

/**
 * Build a cmd.exe /d /s /c plan. Arguments with cmd metacharacters are rejected
 * instead of being escaped loosely. Spaces and parentheses are quoted.
 */
export function assertArg(value: string): void {
  if (typeof value !== 'string') throw new Error('Argumento inválido.')
  if (value.length > 8000) throw new Error('Un argumento es demasiado largo.')
  if (/[\u0000-\u001f]/.test(value)) throw new Error('Un argumento contiene un carácter de control o un byte nulo.')
}

export function planWindowsCmd(
  executable: string,
  args: string[],
  cmdExe = 'C:\\Windows\\System32\\cmd.exe',
): LaunchPlan {
  assertArg(executable)
  for (const arg of args) assertArg(arg)
  for (const part of [executable, ...args]) {
    if (CMD_META.test(part)) {
      throw new Error(
        'La ruta o un argumento contiene caracteres que cmd.exe interpretaría (& | < > ^ % ! o comillas). Renombra el archivo.',
      )
    }
  }
  const line = [quoteCmd(executable), ...args.map(quoteCmd)].join(' ')
  return {
    command: cmdExe,
    args: ['/d', '/s', '/c', line],
    shell: false,
    viaCmd: true,
  }
}

function quoteCmd(value: string): string {
  return `"${value}"`
}

export function planLaunch(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  pathEnv: string = process.env.PATH ?? '',
): LaunchPlan {
  const exe = assertExistingFile(executable)
  for (const arg of args) assertArg(arg)
  const lower = exe.toLowerCase()
  if (platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
    const cmd = resolveCmdExe(pathEnv)
    return planWindowsCmd(exe, args, cmd)
  }
  if (platform === 'win32' && lower.endsWith('.js')) {
    const node = findOnPath('node', pathEnv, platform)
    if (!node || node.toLowerCase().endsWith('.cmd') || node.toLowerCase().endsWith('.bat')) {
      throw new Error('Hace falta node.exe en PATH para lanzar un script .js sin pasar por cmd.exe.')
    }
    return { command: node, args: [exe, ...args], shell: false, viaCmd: false }
  }
  return { command: exe, args, shell: false, viaCmd: false }
}

function resolveCmdExe(pathEnv: string): string {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT
  if (systemRoot) {
    const candidate = path.win32.join(systemRoot, 'System32', 'cmd.exe')
    if (existsSync(candidate)) return candidate
  }
  const found = findOnPath('cmd', pathEnv, 'win32')
  if (found && found.toLowerCase().endsWith('cmd.exe')) return found
  return 'C:\\Windows\\System32\\cmd.exe'
}
