import path from 'node:path'

const CONTROL = /[\u0000-\u001f]/

export type PathApi = typeof path.posix | typeof path.win32

export function pathApiFor(platform: NodeJS.Platform): PathApi {
  return platform === 'win32' ? path.win32 : path.posix
}

export function assertNoControl(value: string, label = 'La ruta'): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} está vacía.`)
  }
  if (value.length > 4096) {
    throw new Error(`${label} es demasiado larga.`)
  }
  if (CONTROL.test(value)) {
    throw new Error(`${label} contiene un carácter de control o un byte nulo.`)
  }
}

export function isAbsoluteFor(value: string, platform: NodeJS.Platform): boolean {
  return pathApiFor(platform).isAbsolute(value)
}

/** User-chosen target. Must be absolute on the host platform. Does not follow the path. */
export function assertAbsoluteUserPath(value: string, platform: NodeJS.Platform = process.platform): string {
  assertNoControl(value)
  if (!isAbsoluteFor(value, platform)) {
    throw new Error('Usa una ruta absoluta. Las rutas relativas no se aceptan.')
  }
  return value
}

/**
 * Resolve candidate inside root. Rejects traversal, absolute escapes and prefix tricks
 * such as /ws vs /ws-evil. The path API is injectable so Windows rules can be tested on Linux.
 */
export function resolveInside(root: string, candidate: string, pathApi: PathApi = path): string {
  assertNoControl(root, 'La carpeta')
  assertNoControl(candidate, 'La ruta')
  const base = pathApi.resolve(root)
  const target = pathApi.resolve(base, candidate)
  const rel = pathApi.relative(base, target)
  if (rel === '') return base
  if (rel.startsWith('..') || pathApi.isAbsolute(rel)) {
    throw new Error('La ruta sale del espacio de trabajo.')
  }
  return target
}

export function assertInside(root: string, candidate: string): string {
  return resolveInside(root, candidate, path)
}
