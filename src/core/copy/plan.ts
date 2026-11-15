import type { ProgramDetection } from '../../shared/types.js'

export interface AnalysisStep {
  adapterId: string
  actionId: string
  /** 'file' usa fileTarget; 'folder' usa folderTarget o sourcePath. */
  target: 'file' | 'folder' | 'source'
  timeoutMs: number
  optional: boolean
  label: string
  /** Si está, se analiza este archivo en lugar del objetivo principal. */
  targetPath?: string
  /** Si está, no se lanza el trabajo: se anota en el informe (módulo demasiado grande, etc.). */
  skipReason?: string
}

const T = {
  meta: 60_000,
  strings: 120_000,
  rea: 10 * 60_000,
  radare: 5 * 60_000,
  ghidra: 30 * 60_000,
  jadx: 20 * 60_000,
  craft: 30 * 60_000,
}

/** Máximo de módulos a los que se lanza Ghidra, además del ejecutable principal. */
export const GHIDRA_MODULE_CAP = 6
/** Por encima de este tamaño no se lanza Ghidra (cabe en ~16 GB con margen). */
export const GHIDRA_MAX_BYTES = 80 * 1024 * 1024

/** Análisis en secuencia (uno cada vez) según el tipo detectado. */
export function planAnalyses(detection: ProgramDetection): AnalysisStep[] {
  const kind = detection.kind
  const steps: AnalysisStep[] = []
  const hasFile = Boolean(detection.fileTarget) || detection.sourceKind === 'file'
  // Craft Anything es el motor principal (Deep + nuestro Ghidra). Nuestras herramientas quedan como alternativa.
  const craftTarget = detection.fileTarget ?? (detection.sourceKind === 'file' ? detection.sourcePath : detection.folderTarget ?? detection.sourcePath)
  if (craftTarget) {
    steps.push({
      adapterId: 'craft-anything',
      actionId: 'triage',
      target: detection.fileTarget || detection.sourceKind === 'file' ? 'file' : 'folder',
      targetPath: craftTarget,
      timeoutMs: T.craft,
      optional: true,
      label: 'Craft Anything · estudio Deep',
    })
    steps.push({
      adapterId: 'craft-anything',
      actionId: 'report',
      target: 'source',
      timeoutMs: T.craft,
      optional: true,
      label: 'Craft Anything · informe',
    })
  }
  if (hasFile) {
    steps.push({ adapterId: 'metadata', actionId: 'inspect', target: 'file', timeoutMs: T.meta, optional: true, label: 'Metadatos' })
    steps.push({ adapterId: 'strings', actionId: 'extract', target: 'file', timeoutMs: T.strings, optional: true, label: 'Cadenas' })
  }
  if (kind === 'javascript' || kind === 'electron') {
    steps.push({
      adapterId: 'rea',
      actionId: 'analyze-javascript',
      target: detection.folderTarget ? 'folder' : 'source',
      timeoutMs: T.rea,
      optional: false,
      label: 'REA · JavaScript',
    })
    return steps
  }
  if (kind === 'java') {
    const target = detection.fileTarget ?? (detection.sourceKind === 'file' ? detection.sourcePath : undefined)
    if (target && /\.(apk|jar|dex|aar)$/i.test(target)) {
      steps.push({ adapterId: 'jadx', actionId: 'decompile', target: 'file', timeoutMs: T.jadx, optional: false, label: 'JADX' })
    } else if (target) {
      steps.push({ adapterId: 'jadx', actionId: 'decompile', target: 'file', timeoutMs: T.jadx, optional: true, label: 'JADX' })
    }
    return steps
  }
  if (kind === 'dotnet') {
    steps.push({ adapterId: 'rea', actionId: 'inspect-managed', target: 'file', timeoutMs: T.rea, optional: false, label: 'REA · .NET' })
    if (hasFile) {
      steps.push({ adapterId: 'ghidra', actionId: 'import-summary', target: 'file', timeoutMs: T.ghidra, optional: true, label: 'Ghidra' })
      steps.push({ adapterId: 'radare2', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'radare2' })
      steps.push({ adapterId: 'rizin', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'Rizin' })
    }
    appendModuleSteps(steps, detection)
    return steps
  }
  if (kind === 'python') {
    if ((detection.fileTarget ?? detection.sourcePath).toLowerCase().endsWith('.pyc')) {
      steps.push({ adapterId: 'rea', actionId: 'inspect-python-pyc', target: 'file', timeoutMs: T.rea, optional: true, label: 'REA · Python' })
    }
    if (hasFile) {
      steps.push({ adapterId: 'rea', actionId: 'inspect-pe-imports', target: 'file', timeoutMs: T.rea, optional: true, label: 'REA · importaciones' })
      steps.push({ adapterId: 'ghidra', actionId: 'import-summary', target: 'file', timeoutMs: T.ghidra, optional: true, label: 'Ghidra' })
      steps.push({ adapterId: 'radare2', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'radare2' })
      steps.push({ adapterId: 'rizin', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'Rizin' })
    }
    return steps
  }
  if (kind === 'native') {
    const source = (detection.fileTarget ?? detection.sourcePath).toLowerCase()
    if (source.endsWith('.so') || source.includes('.elf') || (!source.endsWith('.exe') && !source.endsWith('.dll') && detection.sourceKind === 'file')) {
      steps.push({ adapterId: 'rea', actionId: 'inspect-elf-notes', target: 'file', timeoutMs: T.rea, optional: true, label: 'REA · ELF' })
    } else if (hasFile) {
      steps.push({ adapterId: 'rea', actionId: 'inspect-pe-imports', target: 'file', timeoutMs: T.rea, optional: false, label: 'REA · importaciones PE' })
      steps.push({ adapterId: 'rea', actionId: 'inspect-pe-certificates', target: 'file', timeoutMs: T.rea, optional: true, label: 'REA · certificados' })
    }
    if (hasFile) {
      steps.push({ adapterId: 'ghidra', actionId: 'import-summary', target: 'file', timeoutMs: T.ghidra, optional: true, label: 'Ghidra' })
      steps.push({ adapterId: 'radare2', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'radare2' })
      steps.push({ adapterId: 'rizin', actionId: 'info', target: 'file', timeoutMs: T.radare, optional: true, label: 'Rizin' })
    }
    appendModuleSteps(steps, detection)
    return steps
  }
  return steps
}

export function appendModuleSteps(steps: AnalysisStep[], detection: ProgramDetection): void {
  const modules = detection.modules ?? []
  let ghidraLeft = GHIDRA_MODULE_CAP
  for (const mod of modules) {
    steps.push({
      adapterId: 'metadata',
      actionId: 'inspect',
      target: 'file',
      targetPath: mod.path,
      timeoutMs: T.meta,
      optional: true,
      label: `Metadatos · ${mod.name}`,
    })
    steps.push({
      adapterId: 'strings',
      actionId: 'extract',
      target: 'file',
      targetPath: mod.path,
      timeoutMs: T.strings,
      optional: true,
      label: `Cadenas · ${mod.name}`,
    })
    if (mod.bytes > GHIDRA_MAX_BYTES) {
      steps.push({
        adapterId: 'ghidra',
        actionId: 'import-summary',
        target: 'file',
        targetPath: mod.path,
        timeoutMs: T.ghidra,
        optional: true,
        label: `Ghidra · ${mod.name}`,
        skipReason: `${mod.name} ocupa demasiado para analizarlo de una vez con la memoria disponible.`,
      })
    } else if (ghidraLeft > 0) {
      steps.push({
        adapterId: 'ghidra',
        actionId: 'import-summary',
        target: 'file',
        targetPath: mod.path,
        timeoutMs: T.ghidra,
        optional: true,
        label: `Ghidra · ${mod.name}`,
      })
      ghidraLeft -= 1
    } else {
      steps.push({
        adapterId: 'ghidra',
        actionId: 'import-summary',
        target: 'file',
        targetPath: mod.path,
        timeoutMs: T.ghidra,
        optional: true,
        label: `Ghidra · ${mod.name}`,
        skipReason: `${mod.name} se ha dejado para más adelante: ya se ha llegado al máximo de módulos que se pueden analizar con Ghidra de una vez.`,
      })
    }
  }
}

export function resolveAnalysisTarget(step: AnalysisStep, detection: ProgramDetection): string | undefined {
  if (step.targetPath) return step.targetPath
  if (step.target === 'folder') return detection.folderTarget ?? detection.sourcePath
  if (step.target === 'source') return detection.sourcePath
  return detection.fileTarget ?? (detection.sourceKind === 'file' ? detection.sourcePath : undefined)
}
