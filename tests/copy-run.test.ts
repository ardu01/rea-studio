import { describe, expect, it } from 'vitest'
import { CopyFlow, extractSection, formatPending, type CopyDeps } from '../src/core/copy/run'
import type { AgentEvent, JobRecord, ProgramDetection, ProjectInfo } from '../src/shared/types'

function job(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    adapterId: 'rea',
    actionId: 'inspect',
    title: 'análisis',
    timeoutMs: 1000,
    status: 'succeeded',
    createdAt: '2026-01-01T00:00:00Z',
    artifacts: ['/ws/jobs/job-1/out.json'],
    ...partial,
  }
}

function detection(partial: Partial<ProgramDetection> = {}): ProgramDetection {
  return {
    sourcePath: '/app/app.exe',
    sourceKind: 'file',
    name: 'app',
    kind: 'native',
    kindLabel: 'Programa nativo',
    template: 'cmake',
    templateLabel: 'C/C++ con CMake',
    suggestedDest: '/out/app',
    fileTarget: '/app/app.exe',
    ...partial,
  }
}

function project(root = '/out/app'): ProjectInfo {
  return {
    root,
    name: 'app',
    template: 'cmake',
    templateLabel: 'C/C++ con CMake',
    createdAt: '2026-01-01T00:00:00Z',
    references: ['/ws/jobs/job-1/out.json'],
    commands: [],
  }
}

function end(text: string, status: 'finished' | 'failed' = 'finished'): AgentEvent & { kind: 'end' } {
  return { kind: 'end', runId: 'ag-1', status, text }
}

function deps(overrides: Partial<CopyDeps> = {}): CopyDeps {
  return {
    listReadyTools: async () => ['metadata', 'strings', 'rea', 'ghidra', 'radare2', 'rizin', 'jadx'],
    runJob: async (input) => job({ id: `${input.adapterId}-${input.actionId}`, artifacts: [`/ws/${input.adapterId}.txt`] }),
    createProject: async () => project(),
    setAutonomous: () => undefined,
    startAgent: (goal) => ({
      runId: 'ag-1',
      done: Promise.resolve(
        end(
          goal.includes('Ahora mejora')
            ? 'Mejoras:\nAñadí pruebas.\nPendiente:\nEl módulo de red no se ha podido recrear.'
            : goal.includes('Compara la copia') || goal.includes('Corrige solo')
              ? 'Parecido:\nSin un porcentaje medido.\nPendiente:\nEl módulo de red no se ha podido recrear.'
              : 'Reproducción:\nSe copió el núcleo.',
        ),
      ),
    }),
    cancelAgent: () => undefined,
    workspace: () => '/ws',
    emit: () => undefined,
    mkdirp: async () => undefined,
    detect: async () => detection(),
    ...overrides,
  }
}

describe('informe y flujo de copia', () => {
  it('extrae apartados y resume lo pendiente', () => {
    const text = 'Reproducción:\nSe copió el menú.\n\nPendiente:\nFalta el módulo de red.\n\nMejoras:\nAñadí un registro.'
    expect(extractSection(text, 'Reproducción')).toMatch(/menú/)
    expect(extractSection(text, 'Pendiente')).toMatch(/módulo de red/)
    expect(extractSection(text, 'Mejoras')).toMatch(/registro/)
    expect(formatPending([])).toBe('Nada pendiente.')
    expect(formatPending(['Falta JADX', 'Falta JADX'])).toBe('Falta JADX.')
  })

  it('si el tipo no se reconoce, falla con una explicación y no arranca análisis', async () => {
    const jobs: string[] = []
    const flow = new CopyFlow(
      deps({
        detect: async () =>
          detection({
            kind: 'unknown',
            kindLabel: 'No reconocido',
            template: null,
            templateLabel: null,
            reason: 'No parece una aplicación (ejecutable, Electron, .NET, Java/APK, Python o nativo).',
          }),
        runJob: async (input) => {
          jobs.push(`${input.adapterId}:${input.actionId}`)
          return job()
        },
      }),
    )
    await flow.start({ sourcePath: '/app/notas.txt', destParent: '/out' })
    expect(flow.state?.status).toBe('failed')
    expect(flow.state?.error).toMatch(/no parece una aplicación/i)
    expect(jobs).toEqual([])
  })

  it('si un análisis obligatorio falla pero hay artefactos, sigue y lo deja en Pendiente', async () => {
    const jobs: string[] = []
    const flow = new CopyFlow(
      deps({
        runJob: async (input) => {
          jobs.push(`${input.adapterId}:${input.actionId}`)
          if (input.adapterId === 'rea' && input.actionId === 'inspect-pe-imports') {
            return job({ status: 'failed', error: 'PE ilegible', artifacts: [], id: 'failed' })
          }
          return job({ id: `${input.adapterId}-${input.actionId}`, artifacts: [`/ws/${input.adapterId}.txt`] })
        },
      }),
    )
    await flow.start({ sourcePath: '/app/app.exe', destParent: '/out' })
    expect(flow.state?.status).toBe('done')
    expect(flow.state?.summary?.copied).toMatch(/núcleo/)
    expect(flow.state?.summary?.improved).toMatch(/pruebas/)
    expect(flow.state?.summary?.pending).toMatch(/PE ilegible|módulo de red/)
    expect(jobs.some((item) => item.startsWith('metadata:'))).toBe(true)
  })

  it('si no hay artefactos, falla con una explicación y no crea el proyecto', async () => {
    let created = false
    const flow = new CopyFlow(
      deps({
        listReadyTools: async () => [],
        runJob: async () => job({ status: 'failed', artifacts: [] }),
        createProject: async () => {
          created = true
          return project()
        },
      }),
    )
    await flow.start({ sourcePath: '/app/app.exe', destParent: '/out' })
    expect(created).toBe(false)
    expect(flow.state?.status).toBe('failed')
    expect(flow.state?.error).toBeTruthy()
  })

  it('usa Craft Anything para comprobar y deja el porcentaje en el informe', async () => {
    const flow = new CopyFlow(
      deps({
        runCraftCheck: async () => ({
          alike: 92,
          pending: '',
          raw: '{"alike":92,"pending":""}',
          usedCraft: true,
        }),
      }),
    )
    await flow.start({ sourcePath: '/app/app.exe', destParent: '/out' })
    expect(flow.state?.status).toBe('done')
    expect(flow.state?.summary?.alike).toBe(92)
    expect(flow.state?.check?.alike).toBe(92)
  })

  it('si Craft Anything falla, sigue con nuestras herramientas y lo explica', async () => {
    const flow = new CopyFlow(
      deps({
        runCraftCheck: async () => {
          throw new Error('CLI no responde')
        },
      }),
    )
    await flow.start({ sourcePath: '/app/app.exe', destParent: '/out' })
    expect(flow.state?.status).toBe('done')
    expect(flow.state?.summary?.pending).toMatch(/Craft Anything no se ha podido completar/)
  })
})
