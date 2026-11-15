import type { GitStep, ProjectFile, ProjectInfo, ProjectTemplateId, ProjectTree, ProjectView } from '../../shared/types.js'
import { listProjectTree, readProjectFile } from './fs.js'
import { ProjectGit, type GitRunner } from './git.js'
import { createProject, openProject } from './project.js'
import { PROJECT_TEMPLATES } from './templates.js'

export interface ProjectServiceDeps {
  /** Devuelve un ejecutor de git para la raíz, o null si git no está disponible. */
  gitFor: (root: string) => GitRunner | null
  workspace: () => string | null
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
    await this.git().undo(stepId)
  }

  async resetToStart(): Promise<void> {
    await this.git().resetToStart()
  }
}
