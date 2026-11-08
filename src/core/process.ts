import { spawn, type ChildProcess } from 'node:child_process'

export interface ProcessRequest {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  stdin?: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void
}

export interface ProcessResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  stdout: string
  stderr: string
  durationMs: number
}

const TAIL = 100_000
const ENV_ALLOW = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'ComSpec',
  'WINDIR',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'USER',
  'USERNAME',
  'LOGNAME',
  'SHELL',
  'TERM',
  'JAVA_HOME',
  'GHIDRA_INSTALL_DIR',
  'CODEX_HOME',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PUBLIC',
] as const

export function allowedEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOW) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  return env
}

function pushTail(current: string, chunk: string): string {
  const next = current + chunk
  return next.length > TAIL ? next.slice(next.length - TAIL) : next
}

function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  const later = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }, 1200)
  later.unref()
}

export function runProcess(req: ProcessRequest): Promise<ProcessResult> {
  if (!Number.isFinite(req.timeoutMs) || req.timeoutMs < 1 || req.timeoutMs > 60 * 60 * 1000) {
    return Promise.reject(new Error('El tiempo límite debe estar entre 1 ms y 1 hora.'))
  }
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let cancelled = false
    let settled = false

    let child: ChildProcess
    try {
      child = spawn(req.command, req.args, {
        cwd: req.cwd,
        env: req.env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode,
        signal,
        timedOut,
        cancelled,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      })
    }

    const onAbort = () => {
      if (settled) return
      cancelled = true
      killTree(child)
    }

    const timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      killTree(child)
    }, req.timeoutMs)

    req.signal?.addEventListener('abort', onAbort, { once: true })
    if (req.signal?.aborted) onAbort()

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = pushTail(stdout, chunk)
      req.onChunk?.('stdout', chunk)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = pushTail(stderr, chunk)
      req.onChunk?.('stderr', chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code, signal) => {
      finish(code, signal)
    })

    const stdin = child.stdin
    if (stdin) {
      if (req.stdin) {
        const ok = stdin.write(req.stdin)
        if (!ok) stdin.once('drain', () => stdin.end())
        else stdin.end()
      } else {
        stdin.end()
      }
    }
  })
}
