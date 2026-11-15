import type { GitStep } from '../../shared/types.js'
import { planLaunch } from '../command.js'
import { allowedEnv, runProcess } from '../process.js'

export const AGENT_AUTHOR = { name: 'REA Studio', email: 'rea-studio@localhost.invalid' }
export const STEP_PREFIX = 'REA:'

export interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

export type GitRunner = (args: string[], opts?: { timeoutMs?: number; stdin?: string }) => Promise<GitResult>

/** Opciones fijas: sin hooks, sin pager, sin conversión de finales de línea y con autor de REA. */
const FIXED = [
  '-c', 'core.hooksPath=.rea-sin-hooks',
  '-c', 'core.autocrlf=false',
  '-c', 'core.safecrlf=false',
  '-c', 'core.quotepath=false',
  '-c', 'commit.gpgsign=false',
  '-c', `user.name=${AGENT_AUTHOR.name}`,
  '-c', `user.email=${AGENT_AUTHOR.email}`,
  '--no-pager',
]

export function processGitRunner(gitExe: string, root: string): GitRunner {
  return async (args, opts) => {
    const launch = planLaunch(gitExe, [...FIXED, ...args])
    const result = await runProcess({
      command: launch.command,
      args: launch.args,
      cwd: root,
      timeoutMs: opts?.timeoutMs ?? 60_000,
      stdin: opts?.stdin,
      env: { ...allowedEnv(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    })
    return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}

async function must(git: GitRunner, args: string[], stdin?: string): Promise<string> {
  const result = await git(args, stdin === undefined ? undefined : { stdin })
  if (result.code !== 0) {
    const line = (result.stderr || result.stdout).trim().split('\n').slice(-3).join(' ')
    throw new Error(`git ${args[0]} falló: ${line.slice(0, 300)}`)
  }
  return result.stdout
}

export class ProjectGit {
  constructor(private readonly git: GitRunner) {}

  async init(): Promise<void> {
    await must(this.git, ['init', '-q'])
    await must(this.git, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  }

  /** Mapa ruta → estado corto (M, A, D, ?) del árbol de trabajo frente a HEAD. */
  async status(): Promise<Map<string, string>> {
    const out = await must(this.git, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    const map = new Map<string, string>()
    const parts = out.split('\u0000').filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      const item = parts[i]!
      const code = item.slice(0, 2)
      const file = item.slice(3)
      if (code[0] === 'R' || code[0] === 'C') i++
      const short = code === '??' ? '?' : code.includes('D') ? 'D' : code.includes('A') ? 'A' : 'M'
      map.set(file, short)
    }
    return map
  }

  async isClean(): Promise<boolean> {
    return (await this.status()).size === 0
  }

  /** Añade todo y hace commit. Devuelve el hash o null si no había cambios. */
  async commitAll(message: string): Promise<string | null> {
    await must(this.git, ['add', '-A'])
    const staged = await this.git(['diff', '--cached', '--quiet'])
    if (staged.code === 0) return null
    const text = `${STEP_PREFIX} ${message.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)}`
    await must(this.git, ['commit', '-q', '-F', '-'], `${text}\n`)
    return (await must(this.git, ['rev-parse', 'HEAD'])).trim()
  }

  async history(limit = 50): Promise<GitStep[]> {
    const result = await this.git(['log', `-n${limit}`, '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s'])
    if (result.code !== 0) return []
    return result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, author, email, at, message] = line.split('\u001f')
        return { id: id!, message: message ?? '', at: at ?? '', byRea: email === AGENT_AUTHOR.email && (message ?? '').startsWith(STEP_PREFIX), author: author ?? '' }
      })
  }

  /** Diff del árbol de trabajo frente a HEAD (incluye archivos nuevos) o de un commit concreto. */
  async diff(stepId?: string): Promise<string> {
    if (stepId) {
      assertHash(stepId)
      return must(this.git, ['show', '--format=%s%n', '--no-color', stepId])
    }
    await must(this.git, ['add', '-A', '-N'])
    return must(this.git, ['diff', '--no-color', 'HEAD'])
  }

  async diffFrom(base: string): Promise<string> {
    assertHash(base)
    return must(this.git, ['diff', '--no-color', base, 'HEAD'])
  }

  /** Deshace un paso hecho por REA con un commit de revert. Exige el árbol limpio. */
  async undo(stepId: string): Promise<string> {
    assertHash(stepId)
    const steps = await this.history(500)
    const step = steps.find((item) => item.id === stepId)
    if (!step) throw new Error('Ese paso no está en el historial.')
    if (!step.byRea) throw new Error('Solo se deshacen pasos hechos por REA Studio.')
    if (steps[steps.length - 1]?.id === stepId) throw new Error('El commit inicial no se deshace; usa «Volver al inicio».')
    if (!(await this.isClean())) throw new Error('Hay cambios sin guardar en el proyecto. Guárdalos o descártalos antes de deshacer.')
    await must(this.git, ['revert', '--no-edit', stepId])
    return (await must(this.git, ['rev-parse', 'HEAD'])).trim()
  }

  /** Vuelve al commit inicial creando un commit nuevo (no reescribe el historial). */
  async resetToStart(keep: string[] = []): Promise<string | null> {
    const steps = await this.history(10_000)
    const first = steps[steps.length - 1]
    if (!first) throw new Error('El proyecto no tiene historial.')
    if (!(await this.isClean())) throw new Error('Hay cambios sin guardar en el proyecto. Guárdalos o descártalos antes de volver al inicio.')
    await must(this.git, ['checkout', first.id, '--', '.'])
    // Borra del índice y del disco lo que no existía al principio (solo archivos versionados).
    const added = (await must(this.git, ['diff', '--name-only', '--diff-filter=A', first.id, 'HEAD']))
      .split('\n')
      .filter(Boolean)
      .filter((file) => !keep.some((prefix) => file.startsWith(prefix)))
    if (added.length) await must(this.git, ['rm', '-q', '--', ...added])
    return this.commitAll('vuelve al estado inicial')
  }
}

function assertHash(value: string): void {
  if (!/^[0-9a-f]{7,64}$/.test(value)) throw new Error('Identificador de paso inválido.')
}
