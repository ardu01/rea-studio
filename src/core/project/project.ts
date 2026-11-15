import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectInfo, ProjectTemplateId } from '../../shared/types.js'
import { assertAbsoluteUserPath } from '../paths.js'
import { isOutside, writeProjectFile } from './fs.js'
import { ProjectGit } from './git.js'
import { templateFor } from './templates.js'

export const MANIFEST = 'rea-proyecto.json'
const NAME = /^[a-z0-9][a-z0-9._-]{0,59}$/

export interface ProjectManifest {
  app: 'rea-studio'
  kind: 'proyecto'
  version: 1
  name: string
  template: ProjectTemplateId
  createdAt: string
  references: string[]
}

export function assertProjectName(name: string): string {
  const trimmed = name.trim()
  if (!NAME.test(trimmed) || trimmed.endsWith('.')) {
    throw new Error('El nombre debe ir en minúsculas, con letras, números, punto, guion o guion bajo (máx. 60).')
  }
  return trimmed
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** El proyecto no puede estar dentro de la carpeta de análisis ni contenerla. */
export async function assertSeparateFromWorkspace(projectRoot: string, workspace: string | null): Promise<void> {
  if (!workspace) return
  let ws: string
  try {
    ws = await realpath(workspace)
  } catch {
    return
  }
  let probe = projectRoot
  let real: string | null = null
  while (!real) {
    try {
      real = await realpath(probe)
    } catch {
      const parent = path.dirname(probe)
      if (parent === probe) return
      probe = parent
    }
  }
  const full = path.resolve(real, path.relative(probe, projectRoot))
  if (!isOutside(ws, full) || !isOutside(full, ws)) {
    throw new Error('El proyecto no puede estar dentro de la carpeta de análisis ni contenerla.')
  }
}

export async function createProject(opts: {
  parentDir: string
  name: string
  template: string
  references: string[]
  workspace: string | null
  git: (root: string) => ProjectGit
  now?: () => Date
}): Promise<ProjectInfo> {
  const parent = assertAbsoluteUserPath(opts.parentDir)
  const name = assertProjectName(opts.name)
  const template = templateFor(opts.template)
  const parentInfo = await stat(parent).catch(() => null)
  if (!parentInfo?.isDirectory()) throw new Error('La carpeta elegida no existe.')
  const root = path.join(parent, name)
  await assertSeparateFromWorkspace(root, opts.workspace)
  if (await exists(root)) {
    const items = await readdir(root)
    if (items.length > 0) throw new Error(`Ya existe ${name} y no está vacía. Elige otro nombre.`)
  } else {
    await mkdir(root)
  }
  const files = template.files(name)
  for (const [rel, content] of Object.entries(files)) await writeProjectFile(root, rel, content)
  const manifest: ProjectManifest = {
    app: 'rea-studio',
    kind: 'proyecto',
    version: 1,
    name,
    template: template.id,
    createdAt: (opts.now?.() ?? new Date()).toISOString(),
    references: opts.references.slice(0, 50),
  }
  await writeFile(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  const git = opts.git(root)
  await git.init()
  await git.commitAll(`crea el proyecto ${name} (${template.label})`)
  return infoFrom(root, manifest)
}

export async function openProject(dir: string, workspace: string | null): Promise<ProjectInfo> {
  const root = assertAbsoluteUserPath(dir)
  const raw = await readFile(path.join(root, MANIFEST), 'utf8').catch(() => {
    throw new Error('Esa carpeta no es un proyecto de REA Studio (falta rea-proyecto.json).')
  })
  const manifest = parseManifest(raw)
  if (!(await exists(path.join(root, '.git')))) throw new Error('El proyecto no tiene repositorio git; REA Studio lo necesita para deshacer.')
  await assertSeparateFromWorkspace(root, workspace)
  return infoFrom(root, manifest)
}

export function parseManifest(raw: string): ProjectManifest {
  let json: Partial<ProjectManifest>
  try {
    json = JSON.parse(raw) as Partial<ProjectManifest>
  } catch {
    throw new Error('rea-proyecto.json no es JSON válido.')
  }
  if (json.app !== 'rea-studio' || json.kind !== 'proyecto') throw new Error('rea-proyecto.json no es de REA Studio.')
  const template = templateFor(String(json.template)).id
  return {
    app: 'rea-studio',
    kind: 'proyecto',
    version: 1,
    name: assertProjectName(String(json.name ?? '')),
    template,
    createdAt: typeof json.createdAt === 'string' ? json.createdAt : '',
    references: Array.isArray(json.references) ? json.references.filter((item): item is string => typeof item === 'string').slice(0, 50) : [],
  }
}

export async function saveManifest(root: string, manifest: ProjectManifest): Promise<void> {
  await writeFile(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function loadManifest(root: string): Promise<ProjectManifest> {
  return parseManifest(await readFile(path.join(root, MANIFEST), 'utf8'))
}

function infoFrom(root: string, manifest: ProjectManifest): ProjectInfo {
  const template = templateFor(manifest.template)
  return {
    root,
    name: manifest.name,
    template: manifest.template,
    templateLabel: template.label,
    createdAt: manifest.createdAt,
    references: manifest.references,
    commands: template.commands.map((item) => ({ label: item.label, command: item.command, args: item.args })),
  }
}
