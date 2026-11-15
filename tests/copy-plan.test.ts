import { describe, expect, it } from 'vitest'
import { GHIDRA_MAX_BYTES, planAnalyses } from '../src/core/copy/plan'
import type { ProgramDetection } from '../src/shared/types'

function base(partial: Partial<ProgramDetection> & Pick<ProgramDetection, 'kind' | 'kindLabel' | 'template'>): ProgramDetection {
  return {
    sourcePath: '/app/app.exe',
    sourceKind: 'file',
    name: 'app',
    templateLabel: 'x',
    suggestedDest: '/out/app',
    fileTarget: '/app/app.exe',
    ...partial,
  }
}

describe('plan de análisis del modo sencillo', () => {
  it('para Electron/JS lanza el análisis JavaScript de REA', () => {
    const plan = planAnalyses(base({ kind: 'electron', kindLabel: 'Electron', template: 'node', folderTarget: '/app', fileTarget: '/app/resources/app.asar' }))
    expect(plan[0]).toMatchObject({ adapterId: 'craft-anything', actionId: 'triage' })
    expect(plan.map((step) => `${step.adapterId}:${step.actionId}`)).toEqual(expect.arrayContaining(['craft-anything:triage', 'craft-anything:report', 'rea:analyze-javascript']))
    expect(plan.some((step) => step.adapterId === 'ghidra')).toBe(false)
  })

  it('para Java/APK lanza JADX', () => {
    const plan = planAnalyses(base({ kind: 'java', kindLabel: 'Java', template: 'java', fileTarget: '/app/demo.apk', sourcePath: '/app/demo.apk' }))
    expect(plan.map((step) => `${step.adapterId}:${step.actionId}`)).toContain('jadx:decompile')
  })

  it('para nativo grande analiza módulos uno a uno y omite los que no caben en memoria', () => {
    const plan = planAnalyses(
      base({
        kind: 'native',
        kindLabel: 'Programa nativo',
        template: 'cmake',
        modules: [
          { path: '/app/mod.dll', name: 'mod.dll', bytes: 1024 },
          { path: '/app/huge.dll', name: 'huge.dll', bytes: GHIDRA_MAX_BYTES + 1 },
        ],
      }),
    )
    expect(plan.some((step) => step.label === 'Ghidra · mod.dll' && !step.skipReason)).toBe(true)
    const skipped = plan.find((step) => step.label === 'Ghidra · huge.dll')
    expect(skipped?.skipReason).toMatch(/demasiado/)
    expect(plan.filter((step) => step.targetPath === '/app/mod.dll').length).toBeGreaterThan(1)
  })
})
