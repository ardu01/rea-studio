/**
 * Pruebas de integración con el binario real de craft-anything-cli.
 *
 * Solo se ejecutan si REA_TEST_CRAFT_CLI apunta al ejecutable (por ejemplo, la build oficial 0.6.1 de Linux
 * o el craft-anything-cli.exe incluido en el instalador). Sin esa variable se omiten.
 * La última prueba recorre el paso Analizando completo con todas las herramientas incluidas si además
 * REA_TEST_TOOLS_DIR apunta a vendor-tools/ (o resources/tools). No cargan modelos, no usan --allow-run y no ejecutan el objetivo: solo lo leen.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { craftAnythingAdapter, createRegistry, type AdapterContext } from '../src/core/adapters'
import { locateBundledTools } from '../src/core/bundled'
import { planLaunch } from '../src/core/command'
import { craftEnv, craftRebuildCheckArgs, parseCraftCheck, writeCraftConfig } from '../src/core/copy/craft'
import { CopyFlow } from '../src/core/copy/run'
import { JobManager } from '../src/core/jobs'
import { allowedEnv, runProcess } from '../src/core/process'
import { scrubForLog } from '../src/core/redact'
import type { AgentEvent, JobRecord, ProgramDetection } from '../src/shared/types'

const CLI = process.env.REA_TEST_CRAFT_CLI ?? ''
const enabled = Boolean(CLI) && existsSync(CLI)
const suite = enabled ? describe : describe.skip

/** Un ejecutable inofensivo que ya está en el sistema: solo se lee, nunca se ejecuta. */
function harmlessTarget(): string {
  if (process.env.REA_TEST_CRAFT_TARGET) return process.env.REA_TEST_CRAFT_TARGET
  if (process.platform === 'win32') return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
  return '/bin/true'
}

function baseEnv(configDir: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', HOME: process.env.HOME ?? '', USERPROFILE: process.env.USERPROFILE ?? '', ...craftEnv(configDir) }
}

suite('craft-anything-cli real', () => {
  let root = ''
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'rea-craft-real-'))
  })
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('el informe sin ruta usa la evidencia del estudio guardada en el mismo --project', async () => {
    const configDir = path.join(root, 'cfg-a')
    await writeCraftConfig(configDir, {})
    const target = harmlessTarget()
    const triageOut = path.join(root, 'triage-out')
    const reportOut = path.join(root, 'report-out')
    await mkdir(triageOut, { recursive: true })
    await mkdir(reportOut, { recursive: true })
    const common = { jobDir: root, timeoutMs: 120_000, resourcesDir: root, configured: { craftAnything: CLI }, platform: process.platform, pathEnv: '' }
    const triage = craftAnythingAdapter.plan('triage', { ...common, outputDir: triageOut, targetPath: target })
    if (triage.kind !== 'process') throw new Error('se esperaba un proceso')
    expect(triage.args).not.toContain('--allow-run')
    expect(triage.env).toEqual(craftEnv(path.join(root, 'craft-config')))
    const t = await runProcess({ command: triage.executable, args: triage.args, cwd: root, timeoutMs: 120_000, env: baseEnv(configDir) })
    expect(t.exitCode, t.stderr).toBe(0)
    const study = JSON.parse(t.stdout) as { operation?: string; result?: { format?: string } }
    expect(study.operation).toBe('core_target_triage')
    expect(['elf', 'pe', 'macho']).toContain(study.result?.format)

    const project = path.join(triageOut, 'craft-project')
    const report = craftAnythingAdapter.plan('report', { ...common, outputDir: reportOut, targetPath: project })
    if (report.kind !== 'process') throw new Error('se esperaba un proceso')
    // Sin ruta del objetivo: solo --project y --out.
    expect(report.args).not.toContain(target)
    const r = await runProcess({ command: report.executable, args: report.args, cwd: root, timeoutMs: 120_000, env: baseEnv(configDir) })
    expect(r.exitCode, r.stderr).toBe(0)
    const summary = JSON.parse(r.stdout) as { result?: { evidence_records?: number } }
    expect(summary.result?.evidence_records).toBeGreaterThanOrEqual(1)
    const markdown = await readFile(path.join(reportOut, 'craft-report.md'), 'utf8')
    expect(markdown).toContain(path.basename(target))
  }, 300_000)

  it('lee config.toml de REA: reconoce la carpeta de Ghidra indicada', async () => {
    const configDir = path.join(root, 'cfg-b')
    const fakeGhidra = path.join(root, 'ghidra-falso')
    await mkdir(path.join(fakeGhidra, 'support'), { recursive: true })
    const launcher = process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless'
    await writeFile(path.join(fakeGhidra, 'support', launcher), '', { mode: 0o755 })
    await writeCraftConfig(configDir, { ghidraDir: fakeGhidra })
    const d = await runProcess({ command: CLI, args: ['--format', 'text', 'doctor'], cwd: root, timeoutMs: 120_000, env: baseEnv(configDir) })
    const text = `${d.stdout}\n${d.stderr}`
    expect(text).toMatch(/engine:ghidra/)
    expect(text).toContain(path.join('ghidra-falso', 'support', launcher))
  }, 180_000)

  it('rebuild-check rechaza carpetas que no son proyectos de reconstrucción y no se inventa un parecido', async () => {
    const configDir = path.join(root, 'cfg-c')
    await writeCraftConfig(configDir, {})
    const copy = path.join(root, 'copia-normal')
    await mkdir(copy, { recursive: true })
    const args = craftRebuildCheckArgs(copy, 1)
    const c = await runProcess({ command: CLI, args, cwd: root, timeoutMs: 120_000, env: baseEnv(configDir) })
    expect(c.exitCode).not.toBe(0)
    const parsed = parseCraftCheck(`${c.stdout}\n${c.stderr}`)
    expect(parsed.usedCraft).toBe(false)
    expect(parsed.alike).toBeNull()
    expect(parsed.reason).toMatch(/craft\.json/)
  }, 180_000)

  it('el paso Analizando del modo sencillo termina con estudio e informe de Craft Anything', async () => {
    const workspace = path.join(root, 'ws')
    await mkdir(workspace, { recursive: true })
    const jobs = new JobManager({
      workspace: () => workspace,
      configured: () => ({ craftAnything: CLI }),
      resourcesDir: root,
      scrub: async () => (text: string) => scrubForLog(text, []),
      emit: () => undefined,
      platform: process.platform,
      pathEnv: process.env.PATH ?? '',
    })
    const target = harmlessTarget()
    const detection: ProgramDetection = {
      sourcePath: target,
      sourceKind: 'file',
      name: 'objetivo',
      kind: 'native',
      kindLabel: 'Programa nativo',
      template: 'cmake',
      templateLabel: 'C/C++ con CMake',
      suggestedDest: path.join(root, 'out', 'objetivo'),
      fileTarget: target,
    }
    const ran: JobRecord[] = []
    let references: string[] = []
    const end = (text: string): AgentEvent & { kind: 'end' } => ({ kind: 'end', runId: 'ag', status: 'finished', text })
    const flow = new CopyFlow({
      listReadyTools: async () => ['craft-anything'],
      runJob: async (input) => {
        const started = await jobs.start(input)
        const done = await jobs.wait(started.id)
        ran.push(done)
        return done
      },
      createProject: async (input) => {
        references = input.references
        return { root: path.join(root, 'out', 'objetivo'), name: 'objetivo', template: 'cmake', templateLabel: 'C/C++ con CMake', createdAt: new Date().toISOString(), references: input.references, commands: [] }
      },
      setAutonomous: () => undefined,
      startAgent: () => ({ runId: 'ag', done: Promise.resolve(end('Reproducción:\nNada.\nPendiente:\nNada pendiente.')) }),
      cancelAgent: () => undefined,
      workspace: () => workspace,
      emit: () => undefined,
      mkdirp: async () => undefined,
      detect: async () => detection,
    })
    await flow.start({ sourcePath: target, destParent: path.join(root, 'out') })
    const craft = ran.filter((job) => job.adapterId === 'craft-anything')
    expect(craft.map((job) => `${job.actionId}:${job.status}`)).toEqual(['triage:succeeded', 'report:succeeded'])
    expect(craft[1].targetPath).toBe(path.join(workspace, 'jobs', craft[0].id, 'output', 'craft-project'))
    expect(references.some((ref) => ref.endsWith('craft-report.md'))).toBe(true)
    const details = flow.state?.details.join('\n') ?? ''
    expect(details).not.toMatch(/no admite un objetivo/)
    expect(details).toMatch(/Craft Anything · informe: terminado/)
  }, 600_000)
})

const TOOLS_DIR = process.env.REA_TEST_TOOLS_DIR ?? ''
const toolsSuite = TOOLS_DIR && existsSync(path.join(TOOLS_DIR, 'tools.json')) ? describe : describe.skip

toolsSuite('Analizando con todas las herramientas incluidas', () => {
  it('termina sin pararse y con estudio e informe de Craft Anything', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rea-analizando-'))
    try {
      const bundled = locateBundledTools(TOOLS_DIR, process.platform, existsSync)
      expect(bundled?.craftAnything).toBeTruthy()
      const resourcesDir = path.resolve('resources/ghidra')
      const ctx: AdapterContext = {
        platform: process.platform,
        pathEnv: '',
        configured: {},
        resourcesDir,
        bundled,
        exists: existsSync,
        runVersion: async (executable, args) => {
          const launch = planLaunch(executable, args)
          const r = await runProcess({ command: launch.command, args: launch.args, windowsVerbatimArguments: launch.windowsVerbatimArguments, cwd: root, timeoutMs: 30_000, env: allowedEnv() })
          return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode }
        },
      }
      const ready: string[] = []
      for (const adapter of createRegistry()) if ((await adapter.detect(ctx)).state === 'ready') ready.push(adapter.id)
      expect(ready).toContain('craft-anything')
      const workspace = path.join(root, 'ws')
      await mkdir(workspace, { recursive: true })
      const jobs = new JobManager({
        workspace: () => workspace,
        configured: () => ({}),
        resourcesDir,
        scrub: async () => (text: string) => scrubForLog(text, []),
        emit: () => undefined,
        platform: process.platform,
        pathEnv: '',
        bundled,
      })
      const target = harmlessTarget()
      const { detectProgram } = await import('../src/core/copy/detect')
      const detection = await detectProgram(target, { destParent: path.join(root, 'out') })
      const ran: JobRecord[] = []
      const end = (text: string): AgentEvent & { kind: 'end' } => ({ kind: 'end', runId: 'ag', status: 'finished', text })
      const flow = new CopyFlow({
        listReadyTools: async () => ready,
        runJob: async (input) => {
          const started = await jobs.start(input)
          const done = await jobs.wait(started.id)
          ran.push(done)
          return done
        },
        createProject: async (input) => ({ root: path.join(root, 'out', 'objetivo'), name: 'objetivo', template: 'cmake', templateLabel: 'C/C++ con CMake', createdAt: new Date().toISOString(), references: input.references, commands: [] }),
        setAutonomous: () => undefined,
        startAgent: () => ({ runId: 'ag', done: Promise.resolve(end('Reproducción:\nNada.\nPendiente:\nNada pendiente.')) }),
        cancelAgent: () => undefined,
        workspace: () => workspace,
        emit: () => undefined,
        mkdirp: async () => undefined,
        detect: async () => detection,
      })
      await flow.start({ sourcePath: target, destParent: path.join(root, 'out') })
      const details = flow.state?.details ?? []
      // Se deja en la salida de la prueba lo que ha hecho cada herramienta (sin rutas personales: el objetivo es de prueba).
      console.log(['Herramientas listas: ' + ready.join(', '), ...ran.map((job) => `${job.adapterId}:${job.actionId} → ${job.status}${job.error ? ` (${job.error})` : ''}`), ...details].join('\n'))
      expect(details.join('\n')).not.toMatch(/no admite un objetivo/)
      const craft = ran.filter((job) => job.adapterId === 'craft-anything')
      expect(craft.map((job) => `${job.actionId}:${job.status}`)).toEqual(['triage:succeeded', 'report:succeeded'])
      expect(flow.state?.step).not.toBe('analizando')
      if (ready.includes('ghidra')) expect(ran.find((job) => job.adapterId === 'ghidra')?.status).toBe('succeeded')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 1_800_000)
})
