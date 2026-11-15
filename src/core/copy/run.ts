import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentEvent,
  CommandCheck,
  CopyRunState,
  CopyStepId,
  JobRecord,
  ProgramDetection,
  ProjectInfo,
  ProjectTemplateId,
} from '../../shared/types.js'
import { redactUserPaths } from '../project/analysis-context.js'
import { detectProgram, defaultProjectsDir } from './detect.js'
import { simplifyCopyError } from './errors.js'
import { planAnalyses, resolveAnalysisTarget } from './plan.js'

const STEPS: CopyStepId[] = ['analizando', 'creando', 'copiando', 'mejorando', 'listo']
const PROGRESS: Record<CopyStepId, number> = { analizando: 18, creando: 36, copiando: 55, mejorando: 78, listo: 100 }

const COPY_GOAL =
  'Reproduce con fidelidad el programa original descrito en la ficha. No hagas mejoras en esta fase. Cuando la reproducción esté completa y las pruebas pasen, llama a fin con los apartados Reproducción y Pendiente (módulos, funciones o partes que no se han podido copiar, con el motivo). Si el análisis es incompleto, indícalo en Pendiente en lugar de inventar código.'
const IMPROVE_GOAL =
  'Ahora mejora la copia. Cada mejora es un cambio aparte con su motivo. Mantén la compatibilidad con los formatos del original. Al terminar, llama a fin con los apartados Mejoras y Pendiente (qué no se ha podido recrear o mejorar y por qué).'

export interface CopyJobStart {
  adapterId: string
  actionId: string
  targetPath?: string
  timeoutMs: number
}

export interface CopyDeps {
  listReadyTools: () => Promise<string[]>
  runJob: (input: CopyJobStart) => Promise<JobRecord>
  cancelJob?: (id: string) => void
  createProject: (input: { parentDir: string; name: string; template: ProjectTemplateId; references: string[] }) => Promise<ProjectInfo>
  setAutonomous: (enabled: boolean) => void
  startAgent: (goal: string, handlers: AgentHandlers) => { runId: string; done: Promise<AgentEvent & { kind: 'end' }> } | Promise<{ runId: string; done: Promise<AgentEvent & { kind: 'end' }> }>
  cancelAgent: (runId: string) => void
  mkdirp?: (dir: string) => Promise<void>
  workspace: () => string | null
  emit: (state: CopyRunState) => void
  detect?: (sourcePath: string, opts?: { destParent?: string }) => Promise<ProgramDetection>
}

export interface AgentHandlers {
  onEvent?: (event: AgentEvent) => void
  onInstall?: (callId: string, check: CommandCheck) => Promise<boolean>
}

export class CopyFlow {
  private current: CopyRunState | null = null
  private abort = new AbortController()
  private packageWait: { resolve: (ok: boolean) => void } | null = null
  private activeJobId: string | null = null
  private activeAgentId: string | null = null
  private running: Promise<void> | null = null
  private analysisPending: string[] = []

  constructor(private readonly deps: CopyDeps) {}

  get state(): CopyRunState | null {
    return this.current
  }

  async detect(sourcePath: string, destParent?: string): Promise<ProgramDetection> {
    return (this.deps.detect ?? detectProgram)(sourcePath, { destParent })
  }

  defaultDestParent(): string {
    return defaultProjectsDir()
  }

  async start(input: { sourcePath: string; destParent?: string }): Promise<void> {
    if (this.running) throw new Error('Ya hay una copia en curso.')
    this.abort = new AbortController()
    const detection = await (this.deps.detect ?? detectProgram)(input.sourcePath, { destParent: input.destParent })
    if (detection.kind === 'unknown' || !detection.template) {
      this.current = this.baseState(detection, 'failed', 'analizando', 8, detection.reason ?? 'No he reconocido este archivo como una aplicación.')
      this.push()
      return
    }
    const destPath = input.destParent ? path.join(input.destParent, detection.name) : detection.suggestedDest
    this.current = {
      status: 'running',
      step: 'analizando',
      progress: PROGRESS.analizando,
      sourcePath: detection.sourcePath,
      destPath,
      destParent: path.dirname(destPath),
      detection,
      details: [],
      projectRoot: null,
      summary: null,
      packageRequest: null,
    }
    this.log(`Detectado: ${detection.kindLabel} (${detection.templateLabel})`)
    this.push()
    this.running = this.execute().finally(() => {
      this.running = null
      this.activeJobId = null
      this.activeAgentId = null
    })
    return this.running
  }

  cancel(): void {
    this.abort.abort()
    if (this.activeJobId && this.deps.cancelJob) {
      try {
        this.deps.cancelJob(this.activeJobId)
      } catch {
        /* already done */
      }
    }
    if (this.activeAgentId) this.deps.cancelAgent(this.activeAgentId)
    if (this.packageWait) {
      this.packageWait.resolve(false)
      this.packageWait = null
    }
    if (this.current && this.current.status === 'running') {
      this.fail('Se ha cancelado la copia.', 'cancelled')
    }
  }

  async retry(): Promise<void> {
    const prev = this.current
    if (!prev) throw new Error('No hay una copia que reintentar.')
    if (prev.status === 'running') throw new Error('La copia sigue en curso.')
    await this.start({ sourcePath: prev.sourcePath, destParent: prev.destParent })
  }

  answerPackage(approve: boolean): void {
    if (!this.packageWait) return
    const wait = this.packageWait
    this.packageWait = null
    if (this.current) {
      this.current = { ...this.current, status: 'running', packageRequest: null }
      this.push()
    }
    wait.resolve(approve)
  }

  private async execute(): Promise<void> {
    const state = this.current
    if (!state || !state.detection.template) return
    this.analysisPending = []
    if (state.detection.note) this.log(state.detection.note)
    try {
      const references = await this.analyze(state.detection)
      this.thrownIfAborted()
      this.setStep('creando')
      this.log('Creando la carpeta del proyecto y la ficha del análisis.')
      const parent = state.destParent
      await (this.deps.mkdirp ?? mkdirp)(parent)
      const project = await this.deps.createProject({
        parentDir: parent,
        name: state.detection.name,
        template: state.detection.template,
        references,
      })
      this.current = { ...this.require(), projectRoot: project.root, destPath: project.root }
      this.log(`Proyecto creado en ${redactUserPaths(project.root)}`)
      this.push()
      this.deps.setAutonomous(true)
      const copied = await this.runPhase('copiando', COPY_GOAL)
      this.thrownIfAborted()
      let improved = ''
      try {
        improved = await this.runPhase('mejorando', IMPROVE_GOAL)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido.'
        if (this.abort.signal.aborted || /cancelad/i.test(message)) throw error
        this.log(`No se han podido aplicar las mejoras: ${simplifyCopyError(message)}`)
        this.analysisPending.push(`No se han podido aplicar las mejoras: ${simplifyCopyError(message)}`)
        improved = 'No se han podido aplicar las mejoras.'
      }
      this.thrownIfAborted()
      const pending = formatPending(this.analysisPending)
      this.current = {
        ...this.require(),
        status: 'done',
        step: 'listo',
        progress: 100,
        summary: {
          copied: copied || 'Reproducción del original a partir de la ficha.',
          improved: improved || 'Mejoras aplicadas sobre la copia.',
          pending,
        },
        packageRequest: null,
      }
      this.log(pending === 'Nada pendiente.' ? 'Listo.' : 'Listo. El informe incluye lo que no se ha podido recrear.')
      this.push()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido.'
      if (this.abort.signal.aborted || /cancelad/i.test(message)) this.fail('Se ha cancelado la copia.', 'cancelled')
      else this.fail(simplifyCopyError(message), 'failed')
    }
  }

  private async analyze(detection: ProgramDetection): Promise<string[]> {
    this.setStep('analizando')
    const ready = new Set(await this.deps.listReadyTools())
    const plan = planAnalyses(detection)
    if (plan.length === 0) {
      throw new Error('No he encontrado un análisis que se pueda aplicar a esta aplicación.')
    }
    if ((detection.modules?.length ?? 0) > 0) {
      this.log(`Se analizarán ${detection.modules!.length} módulo(s) aparte del programa principal, uno cada vez.`)
    }
    const references: string[] = []
    let requiredFailed = false
    let requiredError = ''
    for (const step of plan) {
      this.thrownIfAborted()
      if (step.skipReason) {
        this.log(`${step.label}: ${step.skipReason}`)
        this.analysisPending.push(step.skipReason)
        continue
      }
      const target = resolveAnalysisTarget(step, detection)
      if (!target && (step.target === 'file' || step.target === 'folder' || step.target === 'source')) {
        const note = `${step.label}: sin archivo, se omite.`
        this.log(note)
        this.analysisPending.push(note)
        if (!step.optional) {
          requiredFailed = true
          requiredError = `Falta el archivo para ${step.label}.`
        }
        continue
      }
      if (!ready.has(step.adapterId)) {
        const note = `${step.label} no está disponible, se omite.`
        this.log(note)
        this.analysisPending.push(note)
        if (!step.optional) {
          requiredFailed = true
          requiredError = `${step.label} no está disponible.`
        }
        continue
      }
      this.log(`${step.label}…`)
      const job = await this.runOne({ adapterId: step.adapterId, actionId: step.actionId, targetPath: target, timeoutMs: step.timeoutMs })
      if (job.status === 'cancelled') throw new Error('Cancelado.')
      if (job.status === 'succeeded') {
        references.push(...job.artifacts)
        this.log(`${step.label}: terminado.`)
      } else {
        const detail = job.error ? ` (${redactUserPaths(job.error)})` : ''
        const note = `${step.label}: no se ha podido completar${detail}.`
        this.log(note)
        this.analysisPending.push(note)
        if (!step.optional) {
          requiredFailed = true
          requiredError = job.error || `${step.label} ha fallado.`
        }
      }
    }
    if (references.length === 0) {
      throw new Error(requiredError || 'El análisis no ha dado datos suficientes para copiar la aplicación.')
    }
    if (requiredFailed) {
      this.log(`El análisis ha sido incompleto: ${requiredError} Sigo con lo que hay y lo dejaré en el informe.`)
      this.analysisPending.push(requiredError)
    }
    return references
  }

  private async runOne(input: CopyJobStart): Promise<JobRecord> {
    const job = await this.deps.runJob(input)
    this.activeJobId = job.id
    try {
      return job
    } finally {
      this.activeJobId = null
    }
  }

  private async runPhase(step: 'copiando' | 'mejorando', goal: string): Promise<string> {
    this.setStep(step)
    this.log(step === 'copiando' ? 'Reproduciendo el original con fidelidad.' : 'Añadiendo mejoras, cada una con su motivo.')
    const { runId, done } = await this.deps.startAgent(goal, {
      onEvent: (event) => {
        if (event.kind === 'message' && event.text.trim()) this.log(event.text.trim().split('\n')[0]!.slice(0, 200))
        if (event.kind === 'tool') this.log(`${event.tool}: ${event.summary}`)
      },
      onInstall: async (callId, check) => {
        void callId
        const st = this.require()
        this.current = {
          ...st,
          status: 'needs-package',
          packageRequest: { display: check.display, command: check.command, args: check.args, network: check.network },
        }
        this.push()
        return await new Promise<boolean>((resolve) => {
          this.packageWait = { resolve }
        })
      },
    })
    this.activeAgentId = runId
    try {
      const end = await done
      if (end.status === 'cancelled') throw new Error('Cancelado.')
      if (end.status === 'failed' || end.status === 'limit') throw new Error(end.text || 'El agente no ha podido terminar.')
      const pending = extractSection(end.text, 'Pendiente')
      if (pending && pending.toLowerCase() !== 'nada' && pending.toLowerCase() !== 'nada pendiente.') {
        this.analysisPending.push(pending)
      }
      return extractSection(end.text, step === 'copiando' ? 'Reproducción' : 'Mejoras') || end.text.trim()
    } finally {
      this.activeAgentId = null
    }
  }

  private setStep(step: CopyStepId): void {
    this.current = { ...this.require(), status: 'running', step, progress: PROGRESS[step], packageRequest: null }
    this.push()
  }

  private log(line: string): void {
    if (!this.current) return
    const stamped = `${hhmm(new Date())}  ${redactUserPaths(line)}`.trim()
    this.current = { ...this.current, details: [...this.current.details, stamped].slice(-200) }
    this.push()
  }

  private fail(error: string, status: 'failed' | 'cancelled'): void {
    if (!this.current) return
    this.current = { ...this.current, status, error, packageRequest: null }
    this.log(error)
    this.push()
  }

  private baseState(detection: ProgramDetection, status: CopyRunState['status'], step: CopyStepId, progress: number, error?: string): CopyRunState {
    return {
      status,
      step,
      progress,
      sourcePath: detection.sourcePath,
      destPath: detection.suggestedDest,
      destParent: path.dirname(detection.suggestedDest),
      detection,
      details: error ? [`${hhmm(new Date())}  ${error}`] : [],
      error,
      projectRoot: null,
      summary: null,
      packageRequest: null,
    }
  }

  private require(): CopyRunState {
    if (!this.current) throw new Error('No hay una copia en curso.')
    return this.current
  }

  private thrownIfAborted(): void {
    if (this.abort.signal.aborted) throw new Error('Cancelado.')
  }

  private push(): void {
    if (this.current) this.deps.emit(this.current)
  }
}

async function mkdirp(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function formatPending(notes: string[]): string {
  const unique = [...new Set(notes.map((item) => item.trim()).filter(Boolean))]
  if (unique.length === 0) return 'Nada pendiente.'
  return unique.map((item) => (item.endsWith('.') ? item : `${item}.`)).join(' ')
}

export function extractSection(text: string, heading: string): string {
  const re = new RegExp(`${heading}\\s*[:\\-]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:Reproducción|Mejoras|Pendiente)\\s*[:\\-]|$)`, 'i')
  const m = text.match(re)
  return m?.[1]?.trim() ?? ''
}

export { STEPS, COPY_GOAL, IMPROVE_GOAL }
