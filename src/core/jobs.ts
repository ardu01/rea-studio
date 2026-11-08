import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { adapterById, assertTargetExists, listOutputFiles, type ToolAdapter } from './adapters.js'
import { findOnPath, planLaunch } from './command.js'
import { allowedEnv, runProcess } from './process.js'
import { assertInside } from './paths.js'
import { parseJavaVersion } from './adapters.js'
import type { JobEvent, JobRecord, JobStatus } from '../shared/types.js'

const LOG_CAP = 5_000_000

export interface JobStart {
  adapterId: string
  actionId: string
  targetPath?: string
  timeoutMs: number
}

export class JobManager {
  private readonly active = new Map<string, AbortController>()
  private readonly pending = new Map<string, Promise<JobRecord>>()

  constructor(
    private readonly deps: {
      workspace: () => string
      configured: () => Record<string, string>
      resourcesDir: string
      scrub: () => Promise<(text: string) => string>
      emit: (event: JobEvent) => void
      platform?: NodeJS.Platform
      pathEnv?: string
    },
  ) {}

  async list(): Promise<JobRecord[]> {
    const jobsDir = path.join(this.deps.workspace(), 'jobs')
    let names: string[]
    try {
      names = await readdir(jobsDir)
    } catch {
      return []
    }
    const records: JobRecord[] = []
    for (const name of names) {
      try {
        const raw = await readFile(path.join(jobsDir, name, 'job.json'), 'utf8')
        records.push(JSON.parse(raw) as JobRecord)
      } catch {
        /* skip incomplete */
      }
    }
    return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async readLog(id: string): Promise<string> {
    assertJobId(id)
    const file = assertInside(this.deps.workspace(), path.join('jobs', id, 'stdout.log'))
    try {
      const scrub = await this.deps.scrub()
      return scrub(await readFile(file, 'utf8'))
    } catch {
      return ''
    }
  }

  async start(input: JobStart): Promise<JobRecord> {
    const workspace = this.deps.workspace()
    const adapter = adapterById(input.adapterId)
    const spec = adapter.actions.find((item) => item.id === input.actionId)
    if (!spec) throw new Error('Acción desconocida.')
    if (adapter.maturity === 'future') throw new Error(`${adapter.name} no está implementado.`)
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 60 * 60 * 1000) {
      throw new Error('El tiempo límite debe estar entre 1 segundo y 1 hora.')
    }
    if (spec.needsTarget) {
      if (!input.targetPath) throw new Error('Esta acción necesita un objetivo.')
      input = { ...input, targetPath: await assertTargetExists(input.targetPath, spec.targetKind) }
    } else if (input.targetPath) {
      throw new Error('Esta acción no admite un objetivo.')
    }
    const id = `job-${randomUUID()}`
    const record: JobRecord = {
      id,
      adapterId: adapter.id,
      actionId: spec.id,
      title: `${adapter.name} · ${spec.title}`,
      targetPath: input.targetPath,
      timeoutMs: input.timeoutMs,
      status: 'running',
      createdAt: new Date().toISOString(),
      artifacts: [],
    }
    const controller = new AbortController()
    this.active.set(id, controller)
    const work = this.execute(workspace, adapter, record, controller)
    this.pending.set(id, work)
    void work.finally(() => {
      this.active.delete(id)
      this.pending.delete(id)
    })
    return record
  }

  async wait(id: string): Promise<JobRecord> {
    const pending = this.pending.get(id)
    if (pending) return pending
    const all = await this.list()
    const found = all.find((item) => item.id === id)
    if (!found) throw new Error('No existe ese trabajo.')
    return found
  }

  cancel(id: string): void {
    assertJobId(id)
    const controller = this.active.get(id)
    if (!controller) throw new Error('Ese trabajo ya no está en curso.')
    controller.abort()
  }

  private async execute(
    workspace: string,
    adapter: ToolAdapter,
    record: JobRecord,
    controller: AbortController,
  ): Promise<JobRecord> {
    const scrub = await this.deps.scrub()
    const jobDir = path.join(workspace, 'jobs', record.id)
    const outputDir = path.join(jobDir, 'output')
    await mkdir(outputDir, { recursive: true })
    let logBytes = 0
    let truncated = false
    const logPath = path.join(jobDir, 'stdout.log')
    const append = async (stream: 'stdout' | 'stderr' | 'system', text: string) => {
      const clean = scrub(text)
      this.deps.emit({ kind: 'log', jobId: record.id, stream, text: clean })
      if (truncated) return
      const prefix = stream === 'stdout' ? '' : `[${stream}] `
      const piece = `${prefix}${clean}`
      const room = LOG_CAP - logBytes
      if (room <= 0) {
        truncated = true
        await writeFile(logPath, '\n[registro truncado por tamaño]\n', { flag: 'a' })
        return
      }
      const slice = piece.slice(0, room)
      logBytes += slice.length
      await writeFile(logPath, slice, { flag: 'a' })
      if (logBytes >= LOG_CAP && !truncated) {
        truncated = true
        await writeFile(logPath, '\n[registro truncado por tamaño]\n', { flag: 'a' })
      }
    }

    const persist = async (status: JobStatus, extra: Partial<JobRecord> = {}) => {
      record.status = status
      Object.assign(record, extra)
      if (status !== 'running') record.finishedAt = new Date().toISOString()
      const safe: JobRecord = {
        ...record,
        error: record.error ? scrub(record.error) : undefined,
        args: record.args?.map((arg) => scrub(arg)),
      }
      await writeFile(path.join(jobDir, 'job.json'), `${JSON.stringify(safe, null, 2)}\n`, 'utf8')
      this.deps.emit({ kind: 'status', job: safe })
      return safe
    }

    try {
      await persist('running')
      if (record.targetPath) {
        const spec = adapter.actions.find((item) => item.id === record.actionId)
        record.targetPath = await assertTargetExists(record.targetPath, spec?.targetKind ?? 'file')
      }
      if (adapter.id === 'ghidra') await this.assertJava(append)
      const plan = adapter.plan(record.actionId, {
        targetPath: record.targetPath,
        jobDir,
        outputDir,
        timeoutMs: record.timeoutMs,
        resourcesDir: this.deps.resourcesDir,
        configured: this.deps.configured(),
        platform: this.deps.platform ?? process.platform,
        pathEnv: this.deps.pathEnv ?? process.env.PATH ?? '',
      })
      if (plan.kind === 'local') {
        await append('system', 'Trabajo local. El archivo no se ejecuta.\n')
        const result = await plan.run({
          outputDir,
          targetPath: record.targetPath,
          signal: controller.signal,
          log: (line) => {
            void append('system', `${line}\n`)
          },
        })
        await append('system', `${result.summary}\n`)
        record.artifacts = await relativeArtifacts(workspace, jobDir, [...result.files, logPath])
        if (controller.signal.aborted) return persist('cancelled', { error: 'Cancelado.' })
        return persist('succeeded')
      }
      const launch = planLaunch(plan.executable, plan.args, this.deps.platform ?? process.platform, this.deps.pathEnv ?? process.env.PATH ?? '')
      if (launch.shell !== false) throw new Error('El lanzador rechazó un modo de shell.')
      record.executable = launch.command
      record.args = launch.args
      await append('system', `Ejecutable: ${launch.command}\n`)
      await append('system', `Argumentos: ${JSON.stringify(launch.args)}\n`)
      const result = await runProcess({
        command: launch.command,
        args: launch.args,
        cwd: plan.cwd,
        timeoutMs: record.timeoutMs,
        stdin: plan.stdin,
        env: allowedEnv(),
        signal: controller.signal,
        onChunk: (stream, text) => {
          void append(stream, text)
        },
      })
      const produced = await listOutputFiles(outputDir)
      record.artifacts = await relativeArtifacts(workspace, jobDir, [logPath, ...produced])
      if (result.cancelled || controller.signal.aborted) return persist('cancelled', { exitCode: result.exitCode, error: 'Cancelado.' })
      if (result.timedOut) return persist('timed-out', { exitCode: result.exitCode, error: 'Tiempo agotado.' })
      if (result.exitCode !== 0) {
        return persist('failed', {
          exitCode: result.exitCode,
          error: scrub(result.stderr.trim() || `El proceso terminó con código ${result.exitCode}.`),
        })
      }
      return persist('succeeded', { exitCode: 0 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido.'
      const status: JobStatus = controller.signal.aborted || message === 'Cancelado.' ? 'cancelled' : 'failed'
      record.artifacts = await relativeArtifacts(workspace, jobDir, [logPath]).catch(() => [])
      return persist(status, { error: message === 'Cancelado.' ? 'Cancelado.' : message })
    }
  }

  private async assertJava(append: (stream: 'system', text: string) => Promise<void>): Promise<void> {
    const configured = this.deps.configured().java?.trim()
    const java =
      configured ||
      findOnPath('java', this.deps.pathEnv ?? process.env.PATH ?? '', this.deps.platform ?? process.platform)
    if (!java) throw new Error('Ghidra necesita Java. No está java en PATH ni en Ajustes.')
    const launch = planLaunch(java, ['-version'], this.deps.platform ?? process.platform, this.deps.pathEnv ?? process.env.PATH ?? '')
    const result = await runProcess({
      command: launch.command,
      args: launch.args,
      cwd: this.deps.workspace(),
      timeoutMs: 15000,
      env: allowedEnv(),
    })
    const parsed = parseJavaVersion(`${result.stderr}\n${result.stdout}`)
    if (result.exitCode !== 0 && !parsed) {
      throw new Error('java -version falló. Revisa la ruta de Java.')
    }
    if (parsed?.major !== null && parsed && parsed.major < 21) {
      await append('system', `Aviso: Java ${parsed.version}. Ghidra 11.x pide JDK 21.\n`)
    } else if (parsed) {
      await append('system', `Java ${parsed.version}.\n`)
    }
  }
}

function assertJobId(id: string): void {
  if (!/^job-[0-9a-f-]{36}$/i.test(id)) throw new Error('Identificador de trabajo inválido.')
}

async function relativeArtifacts(workspace: string, jobDir: string, files: string[]): Promise<string[]> {
  const unique = [...new Set(files)]
  const rels: string[] = []
  for (const file of unique) {
    try {
      const inside = assertInside(workspace, file)
      const info = await stat(inside)
      if (!info.isFile()) continue
      rels.push(path.relative(workspace, inside))
    } catch {
      /* ignore files outside the workspace or not written yet */
    }
  }
  void jobDir
  return rels
}
