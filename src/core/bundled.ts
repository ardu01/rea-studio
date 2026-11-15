import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Herramientas que el instalador de Windows deja en resources/tools (ver tools/manifest.json y
 * scripts/fetch-tools.mjs). Se instalan para el usuario dentro de la carpeta de la app: no tocan
 * el PATH ni piden permisos de administrador.
 */
export interface BundledTools {
  dir: string
  /** CLI de REA: se lanza con el node.exe incluido, sin pasar por cmd.exe. */
  rea?: { node: string; script: string }
  /** support/analyzeHeadless(.bat) de Ghidra. */
  ghidra?: string
  java?: string
  javaHome?: string
  radare2?: string
  rabin2?: string
  rizin?: string
  rzBin?: string
  jadx?: string
  /** CLI de Craft Anything (craft-anything-cli). */
  craftAnything?: string
  versions: Record<string, string>
}

export type ToolSource = 'configured' | 'bundled' | 'path'

export function locateBundledTools(
  dir: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean,
  read: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): BundledTools | undefined {
  if (!dir) return undefined
  const p = platform === 'win32' ? path.win32 : path.posix
  const win = platform === 'win32'
  const exe = (name: string) => (win ? `${name}.exe` : name)
  const pick = (...parts: string[]) => {
    const full = p.join(dir, ...parts)
    return exists(full) ? full : undefined
  }
  const node = pick('node', exe('node'))
  const script = pick('rea', 'node_modules', 'rea-agents', 'scripts', 'rea.mjs')
  const java = pick('jdk', 'bin', exe('java'))
  const found: BundledTools = {
    dir,
    rea: node && script ? { node, script } : undefined,
    ghidra: pick('ghidra', 'support', win ? 'analyzeHeadless.bat' : 'analyzeHeadless'),
    java,
    javaHome: java ? p.join(dir, 'jdk') : undefined,
    radare2: pick('radare2', 'bin', exe('radare2')),
    rabin2: pick('radare2', 'bin', exe('rabin2')),
    rizin: pick('rizin', 'bin', exe('rizin')),
    rzBin: pick('rizin', 'bin', exe('rz-bin')),
    jadx: pick('jadx', 'bin', win ? 'jadx.bat' : 'jadx'),
    craftAnything: pick('craft-anything', exe('craft-anything-cli')),
    versions: {},
  }
  try {
    const stamp = JSON.parse(read(p.join(dir, 'tools.json'))) as { tools?: Array<{ id: string; version: string }> }
    for (const tool of stamp.tools ?? []) found.versions[tool.id] = tool.version
  } catch {
    // Sin tools.json se usan las rutas igualmente; solo falta la versión.
  }
  const any = found.rea || found.ghidra || found.java || found.radare2 || found.rabin2 || found.rizin || found.rzBin || found.jadx || found.craftAnything
  return any ? found : undefined
}

/** Variables para que Ghidra y JADX usen el JDK elegido aunque haya otro java en PATH. */
export function javaEnv(java: string | undefined, pathEnv: string, platform: NodeJS.Platform = process.platform): Record<string, string> {
  if (!java) return {}
  const p = platform === 'win32' ? path.win32 : path.posix
  const bin = p.dirname(java)
  const home = p.dirname(bin)
  const sep = platform === 'win32' ? ';' : ':'
  return { JAVA_HOME: home, PATH: pathEnv ? `${bin}${sep}${pathEnv}` : bin }
}

/** Java mínimo que pide una instalación de Ghidra (Ghidra/application.properties). */
export function ghidraJavaMin(launcher: string, platform: NodeJS.Platform, read: (file: string) => string): number | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  const root = p.dirname(p.dirname(launcher))
  try {
    const text = read(p.join(root, 'Ghidra', 'application.properties'))
    const match = text.match(/^application\.java\.min=(\d+)/m)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}
