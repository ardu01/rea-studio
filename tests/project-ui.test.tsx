// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { defaultSettings } from '../src/core/settings'
import { publicProviders } from '../src/core/providers'
import { PROJECT_TEMPLATES } from '../src/core/project/templates'
import type { AppState, ProjectView, ReaBridge } from '../src/shared/types'
import { bridgeFor } from './bridge'

export function readyState(): AppState {
  const settings = defaultSettings()
  settings.acceptedUseNotice = true
  settings.onboardingComplete = true
  settings.workspacePath = '/datos/analisis'
  return { version: '0.1.0', encryptionAvailable: true, e2e: false, settings, providers: publicProviders(settings, new Set()) }
}

const templates = PROJECT_TEMPLATES.map((item) => ({ id: item.id, label: item.label, summary: item.summary }))

export const openView: ProjectView = {
  gitAvailable: true,
  templates,
  project: {
    root: '/datos/proyectos/visor-registros',
    name: 'visor-registros',
    template: 'node',
    templateLabel: 'Node.js',
    createdAt: '2026-11-15T14:00:00.000Z',
    references: [],
    commands: [{ label: 'Probar', command: 'npm', args: ['test'] }],
  },
}

export function projectBridge(view: ProjectView = openView): ReaBridge {
  return {
    ...bridgeFor(readyState()),
    projectState: vi.fn(async () => view),
    projectTree: vi.fn(async () => ({
      truncated: false,
      entries: [
        { path: 'src', kind: 'dir' as const, depth: 0 },
        { path: 'src/index.js', kind: 'file' as const, depth: 1, bytes: 60, status: 'M' },
        { path: 'package.json', kind: 'file' as const, depth: 0, bytes: 120 },
      ],
    })),
    projectRead: vi.fn(async (rel: string) => ({ relativePath: rel, text: 'export const x = 1\n', bytes: 19, truncated: false, binary: false })),
    projectDiff: vi.fn(async () => 'diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1 +1 @@\n-uno\n+dos\n'),
    projectHistory: vi.fn(async () => [
      { id: 'b'.repeat(40), message: 'REA: escribe src/index.js', at: '2026-11-15T14:05:00.000Z', author: 'REA Studio', byRea: true },
      { id: 'a'.repeat(40), message: 'REA: crea el proyecto visor-registros (Node.js)', at: '2026-11-15T14:00:00.000Z', author: 'REA Studio', byRea: true },
    ]),
    projectUndo: vi.fn(async () => view),
  }
}

describe('pantalla Proyecto', () => {
  it('crea un proyecto con plantilla y artefactos de referencia', async () => {
    const created = vi.fn(async () => openView)
    window.reaStudio = {
      ...projectBridge({ project: null, gitAvailable: true, templates }),
      listArtifacts: async () => [{ relativePath: 'jobs/j1/strings.txt', bytes: 10 }],
      chooseProjectParent: async () => '/datos/proyectos',
      createProject: created,
    }
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Nombre del proyecto' }), { target: { value: 'visor-registros' } })
    fireEvent.click(screen.getByRole('button', { name: 'Elegir…' }))
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Carpeta donde crear el proyecto' }) as HTMLInputElement).value).toBe('/datos/proyectos'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Plantilla' }), { target: { value: 'cmake' } })
    expect(screen.getByText(/CTest/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }))
    await waitFor(() =>
      expect(created).toHaveBeenCalledWith({ parentDir: '/datos/proyectos', name: 'visor-registros', template: 'cmake', references: ['jobs/j1/strings.txt'] }),
    )
    expect(await screen.findByText('visor-registros · Node.js')).toBeTruthy()
  })

  it('sin git avisa y no deja crear', async () => {
    window.reaStudio = projectBridge({ project: null, gitAvailable: false, templates })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
    expect(await screen.findByText(/No se encuentra git/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Crear proyecto' })).toBeDisabled()
  })

  it('muestra árbol, archivo, cambios e historial con deshacer', async () => {
    const bridge = projectBridge()
    window.reaStudio = bridge
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
    fireEvent.click(await screen.findByRole('treeitem', { name: /index\.js/ }))
    expect(await screen.findByText('export const x = 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Cambios' }))
    expect(await screen.findByText('+dos')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
    const undo = await screen.findAllByRole('button', { name: 'Deshacer este paso' })
    expect(undo).toHaveLength(1)
    fireEvent.click(undo[0]!)
    await waitFor(() => expect(bridge.projectUndo).toHaveBeenCalledWith('b'.repeat(40)))
    expect(screen.getByText('Inicio', { selector: '.pill' })).toBeTruthy()
  })
})
