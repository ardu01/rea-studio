import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ghidraArgv, magicKind, parseJavaVersion, reaArgv, radareAdapter, rizinAdapter, stringsAdapter, metadataAdapter, createRegistry } from '../src/core/adapters'
import { assertOptIn, buildDisclosure } from '../src/core/cloud'
import { planLaunch, planWindowsCmd } from '../src/core/command'
import { jobStartSchema } from '../src/core/ipc-schemas'
import { JobManager } from '../src/core/jobs'
import { resolveInside } from '../src/core/paths'
import { allowedEnv, runProcess } from '../src/core/process'
import {
  anthropicDelta,
  checkProvider,
  claudeArgs,
  claudeCliDelta,
  codexArgs,
  geminiDelta,
  openAIDelta,
  parseSseBlocks,
  runModel,
} from '../src/core/providers'
import { assertNoSecretFields, scrubForLog, scrubProviderError } from '../src/core/redact'
import { createSealedStore, MemorySecretStore } from '../src/core/secrets'
import { normalizeSettings, saveSettings } from '../src/core/settings'

const sample = path.resolve('tests/fixtures/sample.bin')

async function writeExe(file: string, body: string): Promise<string> {
  const source = body.startsWith('#!') ? body.slice(body.indexOf('\n') + 1) : body
  if (process.platform === 'win32') {
    const js = file.toLowerCase().endsWith('.js') ? file : `${file}.js`
    await writeFile(js, source, 'utf8')
    return js
  }
  await writeFile(file, body, 'utf8')
  await chmod(file, 0o755)
  return file
}

describe('rutas y lanzamiento', () => {
  it('rechaza salidas que escapan del espacio y prefijos engañosos', () => {
    expect(() => resolveInside('/ws', '../etc/passwd', path.posix)).toThrow(/sale del espacio/)
    expect(() => resolveInside('/ws', '/etc/passwd', path.posix)).toThrow(/sale del espacio/)
    expect(() => resolveInside('/ws', '/ws-evil/file', path.posix)).toThrow(/sale del espacio/)
    expect(resolveInside('/ws', 'jobs/a/output/a.txt', path.posix)).toBe('/ws/jobs/a/output/a.txt')
    expect(() => resolveInside('C:\\ws', 'C:\\ws\\..\\Windows\\system32', path.win32)).toThrow(/sale del espacio/)
    expect(resolveInside('C:\\ws', 'jobs\\a\\out.txt', path.win32)).toBe('C:\\ws\\jobs\\a\\out.txt')
  })

  it('rechaza bytes nulos y rutas relativas', () => {
    expect(() => resolveInside('/ws', 'jobs/\u0000/a', path.posix)).toThrow(/control/)
    expect(() => planWindowsCmd('C:\\Tools\\analyzeHeadless.bat', ['C:\\a&calc.exe'])).toThrow(/cmd.exe/)
    expect(() => planWindowsCmd('C:\\Tools\\analyzeHeadless.bat', ['C:\\a\nfile'])).toThrow(/control/)
  })

  it('cita analyzeHeadless.bat sin usar shell:true y conserva espacios', () => {
    const plan = planWindowsCmd('C:\\Program Files\\ghidra\\support\\analyzeHeadless.bat', [
      'C:\\work\\proyecto',
      'rea-studio',
      '-import',
      'C:\\samples\\app.exe',
    ])
    expect(plan.shell).toBe(false)
    expect(plan.viaCmd).toBe(true)
    expect(plan.command.toLowerCase()).toContain('cmd.exe')
    expect(plan.args[0]).toBe('/d')
    expect(plan.args[2]).toBe('/c')
    expect(plan.args[3]).toContain('"C:\\Program Files\\ghidra\\support\\analyzeHeadless.bat"')
    expect(plan.args[3]).toContain('"C:\\samples\\app.exe"')
  })

  it('pasa un nombre con metacaracteres como un solo argumento, sin shell', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-arg-'))
    const weird = path.join(dir, 'a&b;$(rm)')
    await writeFile(weird, 'dato')
    const exe = await writeExe(
      path.join(dir, 'tool'),
      `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n`,
    )
    const plan = planLaunch(exe, [weird, '--json'])
    expect(plan.shell).toBe(false)
    expect(plan.viaCmd).toBe(false)
    const result = await runProcess({
      command: plan.command,
      args: plan.args,
      cwd: dir,
      timeoutMs: 5000,
      env: allowedEnv(),
    })
    expect(JSON.parse(result.stdout)).toEqual([weird, '--json'])
    await rm(dir, { recursive: true, force: true })
  })
})

describe('adaptadores', () => {
  it('construye los argv documentados de REA y Ghidra', () => {
    expect(reaArgv('analyze-javascript', '/tmp/app.asar')).toEqual([
      'analyze-javascript-application',
      '/tmp/app.asar',
      '--integrity-policy',
      'record-and-continue',
      '--json',
    ])
    expect(reaArgv('providers')).toEqual(['providers', '--json'])
    expect(reaArgv('inspect-pe-imports', '/tmp/a.exe')[0]).toBe('inspect-pe-imports')
    const args = ghidraArgv({
      projectDir: '/work/ghidra-project',
      target: '/samples/a.exe',
      scriptDir: '/resources/ghidra',
      summaryPath: '/work/output/ghidra-summary.json',
      logPath: '/work/output/ghidra.log',
      timeoutSec: 90,
    })
    expect(args).toContain('-import')
    expect(args).toContain('-deleteProject')
    expect(args).toContain('ExportSummary.java')
    expect(args).not.toContain('-process')
    const script = require('node:fs').readFileSync('resources/ghidra/ExportSummary.java', 'utf8')
    expect(script).toContain('class ExportSummary')
    expect(script).not.toContain('Runtime.getRuntime')
    expect(script).not.toContain('exec(')
  })

  it('mantiene radare2 y rizin en análisis estático', () => {
    const input = {
      targetPath: '/tmp/a.exe',
      jobDir: '/work',
      outputDir: '/work/output',
      timeoutMs: 10000,
      resourcesDir: '/resources/ghidra',
      configured: { radare2: '/usr/bin/r2', rabin2: '/usr/bin/rabin2', rizin: '/usr/bin/rizin', rzBin: '/usr/bin/rz-bin' },
      platform: 'linux' as const,
      pathEnv: '',
    }
    const r2 = radareAdapter.plan('aa', input)
    const rz = rizinAdapter.plan('aa', input)
    expect(r2.kind).toBe('process')
    expect(rz.kind).toBe('process')
    if (r2.kind === 'process' && rz.kind === 'process') {
      expect(r2.args.at(-1)).toBe('/tmp/a.exe')
      expect(r2.args.join(' ')).not.toMatch(/\bood\b|\bdc\b/)
      expect(rz.args.join(' ')).not.toMatch(/\bood\b|\bdc\b/)
      expect(r2.args).toContain('aa; afl; q')
    }
    expect(() => createRegistry().find((item) => item.id === 'ida')!.plan('run', input)).toThrow(/no está implementado/)
  })

  it('extrae cadenas y metadatos reales del archivo de ejemplo', async () => {
    const strings = await stringsAdapter.plan('extract', baseInput(sample))
    expect(strings.kind).toBe('local')
    if (strings.kind !== 'local') return
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-str-'))
    const result = await strings.run({
      outputDir: dir,
      targetPath: sample,
      signal: new AbortController().signal,
      log: () => undefined,
    })
    const text = await readFile(result.files[0]!, 'utf8')
    expect(text).toContain('REA_STUDIO_SAMPLE')
    expect(text).toContain('Cuerda')
    const meta = metadataAdapter.plan('inspect', baseInput(sample))
    if (meta.kind !== 'local') throw new Error('metadata')
    const described = await meta.run({
      outputDir: dir,
      targetPath: sample,
      signal: new AbortController().signal,
      log: () => undefined,
    })
    const json = JSON.parse(await readFile(described.files[0]!, 'utf8')) as { kind: string; sha256: string }
    expect(json.kind).toContain('MZ')
    expect(json.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(magicKind(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))).toBe('ELF')
    await rm(dir, { recursive: true, force: true })
  })

  it('reconoce la versión de Java que pide Ghidra 11', () => {
    expect(parseJavaVersion('openjdk version "21.0.2" 2024-01-16')?.major).toBe(21)
    expect(parseJavaVersion('java version "1.8.0_392"')?.major).toBe(8)
  })
})

describe('trabajos, cancelación y secretos', () => {
  it('ejecuta un sustituto de REA y no guarda la clave en el registro', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-job-'))
    const workspace = path.join(dir, 'ws')
    const secret = 'sk-test-SECRETVALUE1234567890'
    const exe = await writeExe(
      path.join(dir, 'rea'),
      `#!${process.execPath}\nprocess.stdout.write('clave ${secret} y providers')\n`,
    )
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workspace)
    const jobs = manager(workspace, { rea: exe }, async () => [secret])
    const started = await jobs.start({ adapterId: 'rea', actionId: 'providers', timeoutMs: 8000 })
    const done = await jobs.wait(started.id)
    expect(done.status).toBe('succeeded')
    const log = await readFile(path.join(workspace, 'jobs', started.id, 'stdout.log'), 'utf8')
    expect(log).toContain('[REDACTED]')
    expect(log).not.toContain(secret)
    expect(log).toContain('providers')
    const record = await readFile(path.join(workspace, 'jobs', started.id, 'job.json'), 'utf8')
    expect(record).not.toContain(secret)
    await rm(dir, { recursive: true, force: true })
  })

  it('ejecuta un sustituto de analyzeHeadless y escribe el resumen', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-ghi-'))
    const workspace = path.join(dir, 'ws')
    const launcher = await writeExe(
      path.join(dir, 'analyzeHeadless'),
      `#!${process.execPath}\nconst fs=require('fs');const a=process.argv;const i=a.indexOf('ExportSummary.java');fs.mkdirSync(require('path').dirname(a[i+1]),{recursive:true});fs.writeFileSync(a[i+1], '{"name":"sample"}\\n');process.stdout.write('ANALYZE\\n')\n`,
    )
    const java = await writeExe(
      path.join(dir, 'java'),
      `#!${process.execPath}\nprocess.stderr.write('openjdk version "21.0.2"\\n')\n`,
    )
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workspace)
    const target = path.join(dir, 'sample.bin')
    await writeFile(target, 'MZ-demo')
    const jobs = manager(workspace, { ghidra: launcher, java }, async () => [])
    const started = await jobs.start({ adapterId: 'ghidra', actionId: 'import-summary', targetPath: target, timeoutMs: 8000 })
    const done = await jobs.wait(started.id)
    expect(done.status).toBe('succeeded')
    const summary = await readFile(path.join(workspace, 'jobs', started.id, 'output', 'ghidra-summary.json'), 'utf8')
    expect(summary).toContain('sample')
    await rm(dir, { recursive: true, force: true })
  })

  it('cancela un proceso y no lanza un objetivo malicioso', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-cancel-'))
    const workspace = path.join(dir, 'ws')
    const touched = path.join(dir, 'touched')
    const exe = await writeExe(path.join(dir, 'rea'), `#!${process.execPath}\nsetInterval(()=>{},1000)\n`)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(workspace)
    const jobs = manager(workspace, { rea: exe }, async () => [])
    const started = await jobs.start({ adapterId: 'rea', actionId: 'doctor', timeoutMs: 15000 })
    setTimeout(() => jobs.cancel(started.id), 150)
    const done = await jobs.wait(started.id)
    expect(done.status).toBe('cancelled')

    await expect(
      jobs.start({ adapterId: 'rea', actionId: 'analyze', targetPath: 'foo; rm -rf /', timeoutMs: 5000 }),
    ).rejects.toThrow(/absoluta/)
    await expect(
      jobs.start({ adapterId: 'rea', actionId: 'analyze', targetPath: `/tmp/bad\u0000file`, timeoutMs: 5000 }),
    ).rejects.toThrow(/control/)
    expect(existsSync(touched)).toBe(false)
    expect(() => jobStartSchema.parse({ adapterId: 'rea;rm', actionId: 'analyze', timeoutSec: 10, extra: true })).toThrow()

    const controller = new AbortController()
    const running = runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: dir,
      timeoutMs: 10000,
      env: allowedEnv(),
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 150)
    const result = await running
    expect(result.cancelled).toBe(true)

    const timed = await runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: dir,
      timeoutMs: 300,
      env: allowedEnv(),
    })
    expect(timed.timedOut).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('no escribe claves en claro y rechaza campos secretos en la configuración', async () => {
    const secret = 'sk-test-SECRETVALUE1234567890'
    expect(scrubForLog(`token ${secret} fin`, [secret])).toBe('token [REDACTED] fin')
    expect(scrubProviderError('Authorization: Bearer abcdefghijklmnop', [])).toContain('[REDACTED]')
    expect(() => assertNoSecretFields({ providers: { openai: { apiKey: 'no' } } })).toThrow(/almacén cifrado/)
    const memory = new MemorySecretStore()
    await memory.set('openai', secret)
    const file = { buf: Buffer.alloc(0) }
    const store = createSealedStore(
      {
        async read() {
          return file.buf.length ? file.buf : null
        },
        async write(buf) {
          file.buf = Buffer.from(buf)
        },
      },
      {
        available: true,
        encrypt: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf8'),
        decrypt: (payload) => payload.toString('utf8').split('').reverse().join(''),
      },
    )
    await store.set('openai', secret)
    expect(file.buf.toString('utf8')).not.toContain(secret)
    expect(await store.get('openai')).toBe(secret)
    const refused = createSealedStore(
      { async read() { return null }, async write() { throw new Error('no debería escribir') } },
      { available: false },
    )
    await expect(refused.set('openai', secret)).rejects.toThrow(/texto plano/)
    const dir = await mkdtemp(path.join(tmpdir(), 'rea-cfg-'))
    const settings = normalizeSettings({
      acceptedUseNotice: true,
      onboardingComplete: true,
      workspacePath: dir,
      tools: { rea: '' },
      providers: { openai: { model: 'gpt-test', endpoint: 'https://example.test/v1' } },
    })
    await saveSettings(path.join(dir, 'config.json'), settings)
    const saved = await readFile(path.join(dir, 'config.json'), 'utf8')
    expect(saved).not.toContain(secret)
    expect(saved).not.toContain('apiKey')
    expect(() => normalizeSettings({ endpoint: 'http://example.test/v1' })).not.toThrow()
    expect(() =>
      normalizeSettings({
        providers: { openai: { endpoint: 'http://example.test/v1' } },
      }),
    ).toThrow(/https/)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('protocolo simulado de proveedores; autenticación en vivo no realizada', () => {
  it('interpreta SSE de OpenAI, Anthropic y Gemini', () => {
    const openai = parseSseBlocks('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n\n')
    expect(openAIDelta(openai.events[0]!.data)).toBe('Hola')
    expect(openAIDelta(openai.events[1]!.data)).toBeNull()
    expect(anthropicDelta('{"type":"content_block_delta","delta":{"type":"text_delta","text":" Claude"}}')).toBe(' Claude')
    expect(geminiDelta('{"candidates":[{"content":{"parts":[{"text":" Gem"}]}}]}')).toBe(' Gem')
    expect(claudeCliDelta('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"x"}}}')).toBe('x')
  })

  it('no llama a la red si falta la clave y transmite un cuerpo simulado', async () => {
    const idle = vi.fn()
    const missing = await checkProvider({
      id: 'openai',
      settings: normalizeSettings({}),
      apiKey: null,
      fetchImpl: idle as unknown as typeof fetch,
    })
    expect(missing.state).toBe('not-configured')
    expect(missing.detail).toBe('No configurado')
    expect(missing.evidence).toBe('not-run')
    expect(idle).not.toHaveBeenCalled()

    const chunks = [
      'data: {"choices":[{"delta":{"content":"uno"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" dos"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    const fetchImpl = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )) as typeof fetch
    let streamed = ''
    const text = await runModel({
      id: 'openai',
      settings: normalizeSettings({}),
      apiKey: 'sk-test-SIMULATEDKEY123456',
      prompt: 'Hola',
      context: '',
      cwd: tmpdir(),
      timeoutMs: 5000,
      signal: new AbortController().signal,
      fetchImpl,
      onDelta: (delta) => {
        streamed += delta
      },
      onLog: () => undefined,
    })
    expect(text).toBe('uno dos')
    expect(streamed).toBe('uno dos')
    expect(codexArgs('gpt-test', '/tmp/out.txt')).toContain('--sandbox')
    expect(codexArgs('gpt-test', '/tmp/out.txt')).toContain('read-only')
    expect(codexArgs('gpt-test', '/tmp/out.txt')).not.toContain('--yolo')
    expect(claudeArgs('', 'Resume')).toContain('--safe-mode')
    expect(claudeArgs('', 'Resume')).toContain('plan')
    expect(claudeArgs('', 'Resume')).not.toContain('--dangerously-skip-permissions')
  })

  it('exige la confirmación y el hash del resumen antes de un envío', () => {
    const view = buildDisclosure({
      providerId: 'openai',
      destination: 'https://api.openai.com/v1',
      leavesDevice: true,
      prompt: '¿Qué cadenas hay?',
      artifacts: [{ name: 'strings.txt', text: 'REA_STUDIO_SAMPLE' }],
    })
    expect(view.leavesDevice).toBe(true)
    expect(view.items[0]?.preview).toContain('REA_STUDIO_SAMPLE')
    expect(() => assertOptIn(false, view.hash, view.hash)).toThrow(/casilla/)
    expect(() => assertOptIn(true, 'a'.repeat(64), view.hash)).toThrow(/cambió/)
    expect(() => assertOptIn(true, view.hash, view.hash)).not.toThrow()
  })
})

function baseInput(target: string) {
  return {
    targetPath: target,
    jobDir: '/tmp',
    outputDir: '/tmp',
    timeoutMs: 5000,
    resourcesDir: path.resolve('resources/ghidra'),
    configured: {},
    platform: 'linux' as const,
    pathEnv: '',
  }
}

function manager(workspace: string, tools: Record<string, string>, secrets: () => Promise<string[]>) {
  return new JobManager({
    workspace: () => workspace,
    configured: () => ({
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
      ...tools,
    }),
    resourcesDir: path.resolve('resources/ghidra'),
    scrub: async () => {
      const values = await secrets()
      return (text: string) => scrubForLog(text, values)
    },
    emit: () => undefined,
  })
}
