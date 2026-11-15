import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRegistry, ghidraAdapter, jadxAdapter, reaAdapter, resolveTool } from '../src/core/adapters'
import { ghidraJavaMin, javaEnv, locateBundledTools } from '../src/core/bundled'
import { JobManager } from '../src/core/jobs'
import { scrubForLog } from '../src/core/redact'
import { DOC_LINK_LIST } from '../src/shared/types'

const manifest = JSON.parse(readFileSync('tools/manifest.json', 'utf8'))

async function writeExe(file: string, body: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  await chmod(file, 0o755)
  return file
}

/** Carpeta con la misma forma que resources/tools en Linux (para poder ejecutar sustitutos). */
async function fakeTools(opts: { javaVersion?: string; ghidraJavaMin?: number } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rea-bundled-'))
  const tools = path.join(dir, 'tools')
  await writeExe(path.join(tools, 'node', 'node'), `#!/bin/sh\nexec "${process.execPath}" "$@"\n`)
  await writeExe(
    path.join(tools, 'rea', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'),
    `process.stdout.write('REA-INCLUIDA ' + JSON.stringify(process.argv.slice(2)) + '\\n')\n`,
  )
  await writeExe(
    path.join(tools, 'jdk', 'bin', 'java'),
    `#!${process.execPath}\nprocess.stderr.write('openjdk version "${opts.javaVersion ?? '25.0.5'}"\\n')\n`,
  )
  await writeExe(
    path.join(tools, 'ghidra', 'support', 'analyzeHeadless'),
    `#!${process.execPath}\nconst fs=require('fs');const a=process.argv;const i=a.indexOf('ExportSummary.java');fs.mkdirSync(require('path').dirname(a[i+1]),{recursive:true});fs.writeFileSync(a[i+1], '{"name":"sample"}\\n');process.stdout.write('JAVA_HOME=' + process.env.JAVA_HOME + '\\n')\n`,
  )
  await mkdir(path.join(tools, 'ghidra', 'Ghidra'), { recursive: true })
  await writeFile(path.join(tools, 'ghidra', 'Ghidra', 'application.properties'), `application.java.min=${opts.ghidraJavaMin ?? 25}\n`)
  await writeExe(path.join(tools, 'jadx', 'bin', 'jadx'), `#!${process.execPath}\nprocess.stdout.write('JADX ' + process.env.JAVA_OPTS + ' ' + process.env.JAVA_HOME + '\\n')\n`)
  await writeFile(path.join(tools, 'tools.json'), JSON.stringify({ tools: [{ id: 'rea', version: '6.8.0' }, { id: 'ghidra', version: '12.2' }] }))
  return { dir, tools, bundled: locateBundledTools(tools, 'linux', existsSync)! }
}

function manager(workspace: string, bundled: ReturnType<typeof locateBundledTools>, tools: Record<string, string> = {}) {
  return new JobManager({
    workspace: () => workspace,
    configured: () => ({ rea: '', ghidra: '', java: '', radare2: '', rabin2: '', rizin: '', rzBin: '', jadx: '', codex: '', claude: '', gemini: '', ...tools }),
    resourcesDir: path.resolve('resources/ghidra'),
    scrub: async () => (text: string) => scrubForLog(text, []),
    emit: () => undefined,
    platform: 'linux',
    pathEnv: '',
    bundled,
  })
}

describe('herramientas incluidas en el instalador', () => {
  it('encuentra las rutas de Windows dentro de resources/tools', () => {
    const dir = 'C:\\Programas\\REA Studio\\resources\\tools'
    const files = new Set(
      [
        'node\\node.exe',
        'rea\\node_modules\\rea-agents\\scripts\\rea.mjs',
        'ghidra\\support\\analyzeHeadless.bat',
        'jdk\\bin\\java.exe',
        'radare2\\bin\\radare2.exe',
        'radare2\\bin\\rabin2.exe',
        'rizin\\bin\\rizin.exe',
        'rizin\\bin\\rz-bin.exe',
        'jadx\\bin\\jadx.bat',
      ].map((rel) => `${dir}\\${rel}`),
    )
    const found = locateBundledTools(dir, 'win32', (file) => files.has(file), () => JSON.stringify({ tools: [{ id: 'jadx', version: '1.5.6' }] }))!
    expect(found.rea).toEqual({ node: `${dir}\\node\\node.exe`, script: `${dir}\\rea\\node_modules\\rea-agents\\scripts\\rea.mjs` })
    expect(found.ghidra).toBe(`${dir}\\ghidra\\support\\analyzeHeadless.bat`)
    expect(found.javaHome).toBe(`${dir}\\jdk`)
    expect(found.rabin2).toBe(`${dir}\\radare2\\bin\\rabin2.exe`)
    expect(found.rzBin).toBe(`${dir}\\rizin\\bin\\rz-bin.exe`)
    expect(found.jadx).toBe(`${dir}\\jadx\\bin\\jadx.bat`)
    expect(found.versions.jadx).toBe('1.5.6')
    expect(locateBundledTools(dir, 'win32', () => false)).toBeUndefined()
    expect(locateBundledTools(null, 'win32', () => true)).toBeUndefined()
  })

  it('usa primero la ruta indicada, después la incluida y por último el PATH', async () => {
    const { dir, bundled } = await fakeTools()
    const pathDir = path.join(dir, 'path')
    await writeExe(path.join(pathDir, 'rz-bin'), '#!/bin/sh\n')
    const own = await writeExe(path.join(dir, 'propio', 'rabin2'), '#!/bin/sh\n')
    const ctx = { configured: { rabin2: own }, platform: 'linux' as const, pathEnv: pathDir, exists: existsSync, bundled: { ...bundled, rabin2: '/incluida/rabin2', rzBin: undefined } }
    expect(resolveTool(ctx, 'rabin2', 'rabin2')).toEqual({ path: own, source: 'configured' })
    expect(resolveTool({ ...ctx, configured: {} }, 'rabin2', 'rabin2')).toEqual({ path: '/incluida/rabin2', source: 'bundled' })
    expect(resolveTool(ctx, 'rzBin', 'rz-bin')).toEqual({ path: path.join(pathDir, 'rz-bin'), source: 'path' })
    await rm(dir, { recursive: true, force: true })
  })

  it('lanza la CLI de REA incluida con su node, sin pasar por cmd.exe', async () => {
    const { dir, bundled } = await fakeTools()
    const input = { targetPath: '/x/app.asar', jobDir: '/j', outputDir: '/o', timeoutMs: 1000, resourcesDir: '/r', configured: {}, platform: 'linux' as const, pathEnv: '', bundled }
    const plan = reaAdapter.plan('analyze-javascript', input)
    expect(plan.kind).toBe('process')
    if (plan.kind !== 'process') return
    expect(plan.executable).toBe(bundled.rea!.node)
    expect(plan.args).toEqual([bundled.rea!.script, 'analyze-javascript-application', '/x/app.asar', '--integrity-policy', 'record-and-continue', '--json'])
    const own = reaAdapter.plan('providers', { ...input, configured: { rea: '/opt/rea/rea' } })
    expect(own.kind === 'process' && own.executable).toBe('/opt/rea/rea')
    await rm(dir, { recursive: true, force: true })
  })

  it('ejecuta un trabajo de REA con la copia incluida', async () => {
    const { dir, bundled } = await fakeTools()
    const workspace = path.join(dir, 'ws')
    await mkdir(workspace)
    const jobs = manager(workspace, bundled)
    const started = await jobs.start({ adapterId: 'rea', actionId: 'providers', timeoutMs: 8000 })
    const done = await jobs.wait(started.id)
    expect(done.status).toBe('succeeded')
    const log = await readFile(path.join(workspace, 'jobs', started.id, 'stdout.log'), 'utf8')
    expect(log).toContain('REA-INCLUIDA ["providers","--json"]')
    await rm(dir, { recursive: true, force: true })
  })

  it('lanza Ghidra incluido con JAVA_HOME del JDK incluido', async () => {
    const { dir, bundled, tools } = await fakeTools()
    const workspace = path.join(dir, 'ws')
    await mkdir(workspace)
    const target = path.join(dir, 'sample.bin')
    await writeFile(target, 'MZ-demo')
    const jobs = manager(workspace, bundled)
    const started = await jobs.start({ adapterId: 'ghidra', actionId: 'import-summary', targetPath: target, timeoutMs: 8000 })
    const done = await jobs.wait(started.id)
    expect(done.status).toBe('succeeded')
    const out = await readFile(path.join(workspace, 'jobs', started.id, 'stdout.log'), 'utf8')
    expect(out).toContain(`JAVA_HOME=${path.join(tools, 'jdk')}`)
    expect(out).toContain('Java 25.0.5 (incluido con REA Studio).')
    expect(out).not.toContain('pide JDK')
    await rm(dir, { recursive: true, force: true })
  })

  it('avisa si el java no llega al mínimo que pide Ghidra', async () => {
    const { dir, tools, bundled } = await fakeTools({ javaVersion: '21.0.2', ghidraJavaMin: 25 })
    expect(ghidraJavaMin(bundled.ghidra!, 'linux', (file) => readFileSync(file, 'utf8'))).toBe(25)
    const detection = await ghidraAdapter.detect({
      platform: 'linux',
      pathEnv: '',
      configured: {},
      resourcesDir: '/r',
      bundled,
      exists: existsSync,
      runVersion: async () => ({ stdout: '', stderr: 'openjdk version "21.0.2"', exitCode: 0 }),
    })
    expect(detection.source).toBe('bundled')
    expect(detection.detail).toContain('Incluida con REA Studio (12.2)')
    expect(detection.detail).toContain('pide JDK 25')
    expect(javaEnv(path.join(tools, 'jdk', 'bin', 'java'), '/usr/bin', 'linux')).toEqual({ JAVA_HOME: path.join(tools, 'jdk'), PATH: `${path.join(tools, 'jdk', 'bin')}:/usr/bin` })
    await rm(dir, { recursive: true, force: true })
  })

  it('JADX incluido usa el JDK incluido y limita la memoria de Java', async () => {
    const { dir, bundled, tools } = await fakeTools()
    const workspace = path.join(dir, 'ws')
    await mkdir(workspace)
    const target = path.join(dir, 'app.apk')
    await writeFile(target, 'PK-demo')
    const plan = jadxAdapter.plan('decompile', { targetPath: target, jobDir: '/j', outputDir: '/o', timeoutMs: 1000, resourcesDir: '/r', configured: {}, platform: 'linux', pathEnv: '', bundled })
    expect(plan.kind === 'process' && plan.args).toEqual(['-d', path.join('/o', 'jadx'), '-j', '2', target])
    const jobs = manager(workspace, bundled)
    const started = await jobs.start({ adapterId: 'jadx', actionId: 'decompile', targetPath: target, timeoutMs: 8000 })
    expect((await jobs.wait(started.id)).status).toBe('succeeded')
    const out = await readFile(path.join(workspace, 'jobs', started.id, 'stdout.log'), 'utf8')
    expect(out).toContain(`JADX -Xmx4g ${path.join(tools, 'jdk')}`)
    await rm(dir, { recursive: true, force: true })
  })
})

describe('manifiesto de herramientas', () => {
  it('fija versión, URL oficial https, sha256, licencia y código fuente de cada archivo', () => {
    for (const item of manifest.archives) {
      expect(item.url, item.id).toMatch(/^https:\/\//)
      expect(item.sha256, item.id).toMatch(/^[0-9a-f]{64}$/)
      expect(item.version, item.id).toBeTruthy()
      expect(item.license, item.id).toBeTruthy()
      expect(item.source, item.id).toMatch(/^https:\/\//)
      expect(item.redistributable, item.id).toBe(true)
      expect((item.licenseFiles?.length ?? 0) + (item.licenseDownloads?.length ?? 0), item.id).toBeGreaterThan(0)
      for (const lic of item.licenseDownloads ?? []) expect(lic.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('el lockfile fija rea-agents con la integridad del manifiesto', () => {
    const lock = JSON.parse(readFileSync('tools/rea/package-lock.json', 'utf8'))
    const rea = manifest.npm.find((item: { id: string }) => item.id === 'rea')
    const locked = lock.packages['node_modules/rea-agents']
    expect(locked.version).toBe(rea.version)
    expect(locked.integrity).toBe(rea.integrity)
    for (const [name, entry] of Object.entries<{ integrity?: string; link?: boolean }>(lock.packages)) {
      if (name && !entry.link) expect(entry.integrity, name).toMatch(/^sha512-/)
    }
  })

  it('cubre todo el catálogo: cada herramienta externa va incluida o explica por qué no', () => {
    const included = new Set([...manifest.archives, ...manifest.npm].map((item: { id: string }) => item.id))
    const excluded = new Set(manifest.notBundled.map((item: { id: string }) => item.id))
    const builtIn = new Set(['strings', 'metadata'])
    for (const adapter of createRegistry()) {
      if (builtIn.has(adapter.id)) continue
      expect(included.has(adapter.id) || excluded.has(adapter.id), adapter.id).toBe(true)
    }
    expect(included.has('jdk')).toBe(true)
    expect(included.has('node')).toBe(true)
  })

  it('las no incluidas ofrecen su descarga oficial y el enlace está permitido', () => {
    for (const item of manifest.notBundled) {
      const adapter = createRegistry().find((a) => a.id === item.id)!
      expect(adapter.downloadUrl, item.id).toBeTruthy()
      expect(DOC_LINK_LIST).toContain(adapter.downloadUrl)
      expect(DOC_LINK_LIST).toContain(adapter.docsUrl)
    }
  })

  it('el instalador copia vendor-tools a resources/tools', () => {
    const yml = readFileSync('electron-builder.yml', 'utf8')
    expect(yml).toMatch(/- from: vendor-tools\n\s+to: tools/)
    expect(yml).toMatch(/perMachine: false/)
    expect(yml).toMatch(/requestedExecutionLevel: asInvoker/)
  })
})
