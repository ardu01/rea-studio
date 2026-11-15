import { lstatSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { buildFicha, fichaHasContent, fitFicha, FICHA_DIR, FICHA_JSON, FICHA_MD, fichaMarkdown, parseFicha, type Ficha } from './analysis-context.js'
import type { GitStep, ProjectFile, ProjectInfo, ProjectTemplateId, ProjectTree, ProjectView } from '../../shared/types.js'
import { listProjectTree, readProjectFile, resolveProjectPath, writeProjectFile } from './fs.js'
import { ProjectGit, type GitRunner } from './git.js'
import { createProject, loadManifest, openProject, saveManifest } from './project.js'
import { PROJECT_TEMPLATES } from './templates.js'

const FICHA_ADDED = 'añade la ficha del análisis del programa original'
export const NEED_ANALYSIS = 'Carga primero el análisis del programa original: elige al menos un artefacto (resumen de Ghidra, tipos, cadenas o importaciones). El proyecto se recrea a partir de él.'
export const EMPTY_ANALYSIS = 'Los artefactos elegidos no tienen datos del análisis del programa original (funciones, tipos, importaciones o cadenas). Elige el resumen de Ghidra, los tipos o las cadenas.'

export interface ProjectServiceDeps {
  /** Devuelve un ejecutor de git para la raíz, o null si git no está disponible. */
  gitFor: (root: string) => GitRunner | null
  workspace: () => string | null
  agentInfo?: () => import('../../shared/types.js').AgentInfo
}

export class ProjectService {
  private current: ProjectInfo | null = null
  private autonomousMode = false

  constructor(private readonly deps: ProjectServiceDeps) {}

  get project(): ProjectInfo | null {
    return this.current
  }

  gitAvailable(): boolean {
    return this.deps.gitFor(process.cwd()) !== null
  }

  view(): ProjectView {
    return {
      project: this.current,
      gitAvailable: this.gitAvailable(),
      autonomous: this.autonomousMode,
      agent: this.deps.agentInfo?.(),
      ficha: this.current ? { loaded: this.hasFicha() } : undefined,
      templates: PROJECT_TEMPLATES.map((item) => ({ id: item.id, label: item.label, summary: item.summary })),
    }
  }

  get autonomous(): boolean {
    return this.autonomousMode
  }

  setAutonomous(enabled: boolean): void {
    if (enabled) this.requireProject()
    this.autonomousMode = enabled
  }

  requireProject(): ProjectInfo {
    if (!this.current) throw new Error('Abre o crea un proyecto.')
    return this.current
  }

  git(): ProjectGit {
    const project = this.requireProject()
    const runner = this.deps.gitFor(project.root)
    if (!runner) throw new Error('No se encuentra git en PATH. El modo Proyecto lo necesita para deshacer cambios.')
    return new ProjectGit(runner)
  }

  async create(input: { parentDir: string; name: string; template: ProjectTemplateId; references: string[] }): Promise<ProjectInfo> {
    const probe = this.deps.gitFor(input.parentDir)
    if (!probe) throw new Error('No se encuentra git en PATH. Instálalo o añádelo a PATH para usar el modo Proyecto.')
    if (!input.references.length) throw new Error(NEED_ANALYSIS)
    const workspace = this.deps.workspace()
    if (!workspace) throw new Error('Elige primero el espacio de trabajo con el análisis del programa original.')
    const ficha = fitFicha(await buildFicha(workspace, input.references))
    if (!fichaHasContent(ficha)) throw new Error(EMPTY_ANALYSIS)
    this.autonomousMode = false
    this.current = await createProject({
      ...input,
      workspace: this.deps.workspace(),
      git: (root) => {
        const runner = this.deps.gitFor(root)
        if (!runner) throw new Error('No se encuentra git en PATH.')
        return new ProjectGit(runner)
      },
    })
    await this.writeFicha(ficha, FICHA_ADDED)
    return this.current
  }

  async open(dir: string): Promise<ProjectInfo> {
    this.autonomousMode = false
    this.current = await openProject(dir, this.deps.workspace())
    return this.current
  }

  close(): void {
    this.autonomousMode = false
    this.current = null
  }

  async tree(): Promise<ProjectTree> {
    const project = this.requireProject()
    let status: Map<string, string> | undefined
    try {
      status = await this.git().status()
    } catch {
      status = undefined
    }
    return listProjectTree(project.root, { status })
  }

  async read(relativePath: string): Promise<ProjectFile> {
    return readProjectFile(this.requireProject().root, relativePath)
  }

  async diff(stepId?: string): Promise<string> {
    return this.git().diff(stepId)
  }

  async history(): Promise<GitStep[]> {
    return this.git().history()
  }

  async undo(stepId: string): Promise<void> {
    const step = (await this.git().history(500)).find((item) => item.id === stepId)
    if (step?.message === `REA: ${FICHA_ADDED}`) throw new Error('La ficha del análisis del original no se deshace: es la base del proyecto. Puedes regenerarla en «Referencia».')
    await this.git().undo(stepId)
  }

  /** Vuelve al inicio conservando la ficha del análisis (referencia/). */
  async resetToStart(): Promise<void> {
    await this.git().resetToStart([`${FICHA_DIR}/`])
  }

  /**
   * Regenera referencia/ficha.json y ficha.md desde los artefactos del análisis
   * y guarda el cambio en el git del proyecto. Si se pasan referencias nuevas,
   * se guardan en el manifiesto.
   */
  async updateReferences(references?: string[]): Promise<{ ficha: Ficha; commit: string | null }> {
    const project = this.requireProject()
    const workspace = this.deps.workspace()
    if (!workspace) throw new Error('Elige primero el espacio de trabajo del análisis.')
    const refs = (references ?? project.references).slice(0, 50)
    if (!refs.length) throw new Error(NEED_ANALYSIS)
    const ficha = fitFicha(await buildFicha(workspace, refs))
    if (!fichaHasContent(ficha)) throw new Error(EMPTY_ANALYSIS)
    if (references) {
      const manifest = await loadManifest(project.root)
      await saveManifest(project.root, { ...manifest, references: refs })
      this.current = { ...project, references: refs }
    }
    const commit = await this.writeFicha(ficha, 'actualiza la ficha del análisis')
    return { ficha, commit }
  }

  private async writeFicha(ficha: Ficha, message: string): Promise<string | null> {
    const project = this.requireProject()
    await writeProjectFile(project.root, FICHA_JSON, `${JSON.stringify(ficha)}\n`)
    await writeProjectFile(project.root, FICHA_MD, fichaMarkdown(ficha))
    return this.git().commitAll(message)
  }

  /** Hay ficha del análisis guardada en el proyecto abierto. */
  hasFicha(): boolean {
    const project = this.current
    if (!project) return false
    try {
      const info = lstatSync(path.join(project.root, FICHA_JSON))
      return info.isFile() && info.size > 0
    } catch {
      return false
    }
  }

  async ficha(): Promise<Ficha | null> {
    const project = this.requireProject()
    try {
      const full = await resolveProjectPath(project.root, FICHA_JSON)
      const info = await lstat(full)
      if (!info.isFile() || info.size > 600 * 1024) return null
      return parseFicha(await readFile(full, 'utf8'))
    } catch {
      return null
    }
  }
}
