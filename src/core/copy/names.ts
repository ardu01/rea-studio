import type { ProgramKind, ProjectTemplateId } from '../../shared/types.js'

export const KIND_LABEL: Record<ProgramKind, string> = {
  javascript: 'JavaScript',
  electron: 'Electron',
  dotnet: '.NET',
  python: 'Python',
  native: 'Programa nativo',
  java: 'Java / Android',
}

export function projectNameFrom(sourcePath: string): string {
  const base = sourcePath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  const stem = base.replace(/\.(exe|dll|so|dylib|app|asar|apk|jar|pyc|pyz|bin)$/i, '')
  const slug = stem
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60)
  if (/^[a-z0-9][a-z0-9._-]{0,59}$/.test(slug) && !slug.endsWith('.')) return slug
  return 'aplicacion'
}

export function defaultProjectsDir(opts?: {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: (dir: string) => boolean
}): string {
  const platform = opts?.platform ?? (typeof process !== 'undefined' ? process.platform : undefined)
  const env = opts?.env ?? (typeof process !== 'undefined' ? process.env : {})
  const exists = opts?.exists
  if (platform === 'win32') {
    if (!exists || exists('D:\\Proyectos') || exists('D:\\')) return 'D:\\Proyectos'
    const home = env.USERPROFILE || env.HOME || 'C:\\'
    return `${String(home).replace(/[\\/]+$/, '')}\\Proyectos`
  }
  const home = env.HOME || '/tmp'
  return `${String(home).replace(/\/+$/, '')}/Proyectos`
}

export function templateLabel(id: ProjectTemplateId | null): string | null {
  if (id === 'node') return 'Node.js'
  if (id === 'python') return 'Python'
  if (id === 'dotnet') return '.NET (C#)'
  if (id === 'cmake') return 'C/C++ con CMake'
  if (id === 'java') return 'Java'
  return null
}
