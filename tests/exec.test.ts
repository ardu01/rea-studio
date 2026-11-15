import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commandCheckSchema, commandRunSchema } from '../src/core/ipc-schemas'
import { classifyCommand, needsApproval, outputForModel, resolveExecutable, runProjectCommand, splitCommandLine } from '../src/core/project/exec'
import { splitLine } from '../src/renderer/src/project-commands'

const root = path.resolve('/proyectos/demo')
const temps: string[] = []
afterEach(async () => {
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true })
})

describe('lista de comandos permitidos', () => {
  const ok = (command: string, ...args: string[]) => classifyCommand(command, args, root)

  it('acepta los comandos de las plantillas', () => {
    for (const [cmd, args] of [
      ['npm', ['test']],
      ['npm', ['run', 'build']],
      ['node', ['--test', 'tests/']],
      ['python', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.']],
      ['python', ['app/main.py']],
      ['pytest', ['-q']],
      ['dotnet', ['build', 'src/App/App.csproj', '--nologo']],
      ['dotnet', ['run', '--project', 'src/App/App.csproj', '--no-build']],
      ['cmake', ['-S', '.', '-B', 'build']],
      ['javac', ['-d', 'out', 'src/App.java']],
      ['java', ['-cp', 'out', 'App']],
      ['cmake', ['--build', 'build']],
      ['ctest', ['--test-dir', 'build', '--output-on-failure']],
      ['git', ['status']],
    ] as Array<[string, string[]]>) {
      const check = ok(cmd, ...args)
      expect(check.allowed, `${cmd} ${args.join(' ')}: ${check.reason}`).toBe(true)
      expect(check.kind).toBe('normal')
    }
  })

  it('marca como instalación lo que baja paquetes', () => {
    for (const [cmd, args] of [
      ['npm', ['install']],
      ['npm', ['i', 'commander']],
      ['npm', ['ci']],
      ['pip', ['install', 'requests']],
      ['python', ['-m', 'pip', 'install', 'requests']],
      ['dotnet', ['add', 'src/App/App.csproj', 'package', 'xunit']],
      ['dotnet', ['restore']],
      ['cargo', ['add', 'serde']],
      ['go', ['get', 'example.com/x']],
    ] as Array<[string, string[]]>) {
      const check = ok(cmd, ...args)
      expect(check.allowed, `${cmd} ${args.join(' ')}`).toBe(true)
      expect(check.kind).toBe('install')
      expect(check.network).toBe(true)
    }
  })

  it('rechaza comandos fuera de la lista, opciones peligrosas y operadores de shell', () => {
    const denied: Array<[string, string[]]> = [
      ['npx', ['create-app']],
      ['curl', ['http://x']],
      ['powershell', ['-c', 'x']],
      ['cmd', ['/c', 'dir']],
      ['bash', ['-c', 'ls']],
      ['rm', ['-rf', '.']],
      ['npm', ['install', '-g', 'x']],
      ['npm', ['publish']],
      ['npm', ['exec', 'x']],
      ['npm', ['run']],
      ['node', ['-e', 'process.exit()']],
      ['node', ['--eval=1']],
      ['node', ['--inspect', 'a.js']],
      ['python', ['-c', 'print(1)']],
      ['python', ['-m', 'http.server']],
      ['python', ['script.sh']],
      ['pip', ['install', '--user', 'x']],
      ['pip', ['uninstall', 'x']],
      ['cmake', ['-E', 'rm', '-rf', 'src']],
      ['cmake', ['-P', 'x.cmake']],
      ['cmake', ['--install', 'build']],
      ['ctest', ['-S', 'x.cmake']],
      ['dotnet', ['tool', 'install', 'x']],
      ['cargo', ['install', 'x']],
      ['go', ['install', 'x']],
      ['git', ['commit', '-m', 'x']],
      ['git', ['push']],
      ['npm', ['test', '&&', 'del', 'x']],
      ['npm', ['test', '|', 'more']],
      ['npm', ['test', '>', 'out.txt']],
      ['node', ['a.js;calc']],
      ['node', ['$(whoami)']],
      ['node', ['%PATH%']],
      ['node', ['a"b']],
      ['cmake', ['-B', '/tmp/fuera']],
      ['cmake', ['-B', 'C:\\Windows\\Temp']],
      ['node', ['../otro/a.js']],
      ['cmake', ['-DCMAKE_INSTALL_PREFIX=/usr/local', '-S', '.']],
    ]
    for (const [cmd, args] of denied) {
      const check = ok(cmd, ...args)
      expect(check.allowed, `${cmd} ${args.join(' ')}`).toBe(false)
      expect(check.reason).toBeTruthy()
    }
    expect(ok('node', 'a.js', ...Array(41).fill('x')).allowed).toBe(false)
  })

  it('el modo autónomo no se salta la confirmación de instalar', () => {
    const test = ok('npm', 'test')
    const inst = ok('npm', 'install')
    expect(needsApproval(test, false)).toBe(true)
    expect(needsApproval(test, true)).toBe(false)
    expect(needsApproval(inst, false)).toBe(true)
    expect(needsApproval(inst, true)).toBe(true)
    expect(needsApproval(ok('curl'), true)).toBe(true)
  })

  it('divide la línea de comandos igual en core y en la interfaz', () => {
    for (const line of ['npm test', '  cmake  -S . -B build ', 'node "mi script.js" --x', "python 'a b.py'"]) {
      expect(splitLine(line)).toEqual(splitCommandLine(line))
    }
    expect(splitCommandLine('node "mi script.js"')).toEqual({ command: 'node', args: ['mi script.js'] })
    expect(() => splitCommandLine('node "abierto')).toThrow(/comilla/)
    expect(() => splitCommandLine('   ')).toThrow()
  })

  it('valida los esquemas IPC', () => {
    expect(commandCheckSchema.safeParse({ command: 'npm', args: ['test'] }).success).toBe(true)
    expect(commandCheckSchema.safeParse({ command: 'C:\\x\\npm.exe', args: [] }).success).toBe(false)
    expect(commandRunSchema.safeParse({ command: 'npm', args: ['test'], confirmed: true, timeoutSec: 99999 }).success).toBe(false)
    expect(commandRunSchema.safeParse({ command: 'npm', args: ['test'], confirmed: 'si' }).success).toBe(false)
  })
})

describe('ejecución real con node (sin shell)', () => {
  async function project(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-exec-'))
    temps.push(dir)
    return dir
  }

  it('ejecuta, guarda el registro y devuelve el final de la salida', async () => {
    const dir = await project()
    await writeFile(path.join(dir, 'ok.js'), "console.log('hola'); console.error('aviso')\n")
    const chunks: string[] = []
    const result = await runProjectCommand({ root: dir, check: classifyCommand('node', ['ok.js'], dir), onChunk: (_s, t) => chunks.push(t) })
    expect(result.status).toBe('succeeded')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hola')
    expect(chunks.join('')).toContain('aviso')
    const log = await readFile(path.join(dir, ...result.logPath.split('/')), 'utf8')
    expect(log).toContain('$ node ok.js')
    expect(log).toContain('[fin: succeeded')
    expect(outputForModel(result)).toContain('estado: succeeded, código: 0')
  })

  it('informa del fallo, del tiempo agotado y de la cancelación', async () => {
    const dir = await project()
    await writeFile(path.join(dir, 'falla.js'), "console.error('Error: algo'); process.exit(3)\n")
    await writeFile(path.join(dir, 'lento.js'), 'setTimeout(() => {}, 60000)\n')
    const failed = await runProjectCommand({ root: dir, check: classifyCommand('node', ['falla.js'], dir) })
    expect(failed).toMatchObject({ status: 'failed', exitCode: 3 })
    const slow = await runProjectCommand({ root: dir, check: classifyCommand('node', ['lento.js'], dir), timeoutSec: 1 })
    expect(slow.status).toBe('timed-out')
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const cancelled = await runProjectCommand({ root: dir, check: classifyCommand('node', ['lento.js'], dir), signal: controller.signal })
    expect(cancelled.status).toBe('cancelled')
  }, 20000)

  it('no ejecuta lo que no está permitido ni lo que no está en PATH', async () => {
    const dir = await project()
    await expect(runProjectCommand({ root: dir, check: classifyCommand('curl', ['x'], dir) })).rejects.toThrow(/lista/)
    await expect(runProjectCommand({ root: dir, check: classifyCommand('cargo', ['build'], dir), resolve: () => null })).rejects.toThrow(/No se encuentra/)
  })

  it('python usa el .venv del proyecto si existe', async () => {
    const dir = await project()
    const bin = process.platform === 'win32' ? path.join(dir, '.venv', 'Scripts') : path.join(dir, '.venv', 'bin')
    await mkdir(bin, { recursive: true })
    const exe = path.join(bin, process.platform === 'win32' ? 'python.exe' : 'python')
    await writeFile(exe, '')
    expect(resolveExecutable('python', dir)).toBe(exe)
    expect(resolveExecutable('py', dir)).toBe(exe)
  })
})

describe('git de solo lectura', () => {
  it('no deja escribir archivos ni lanzar programas externos desde git', () => {
    expect(classifyCommand('git', ['diff', '--stat'], root).allowed).toBe(true)
    for (const args of [['diff', '--output=x.txt'], ['log', '--output', 'x.txt'], ['diff', '--ext-diff'], ['log', '--textconv'], ['status', '--git-dir=../otro']]) {
      expect(classifyCommand('git', args, root).allowed, args.join(' ')).toBe(false)
    }
  })
})
