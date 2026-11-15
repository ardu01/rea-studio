// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { openView, projectBridge } from './project-fixtures'

const FICHA = [
  '# Ficha del análisis',
  '',
  '## Programa',
  '',
  '- Nombre: visor.exe',
  '## Tipos (1)',
  '',
  '```c',
  'struct Registro (16 bytes) { +0 uint id; +8 double valor }',
  '```',
  '## Importaciones (1)',
  '',
  '- **KERNEL32.dll**: CreateFileW',
].join('\n')

function setup(withFicha: boolean) {
  const references = ['jobs/j1/output/ghidra-summary.json']
  const base = projectBridge({ ...openView, project: { ...openView.project!, references: withFicha ? references : [] } })
  const bridge = {
    ...base,
    projectRead: vi.fn(async (rel: string) => {
      if (rel === 'referencia/ficha.md' && withFicha) return { relativePath: rel, text: FICHA, bytes: FICHA.length, truncated: false, binary: false }
      if (rel === 'referencia/ficha.md') throw new Error('No existe referencia/ficha.md.')
      return base.projectRead(rel)
    }),
    listArtifacts: vi.fn(async () => [
      { relativePath: 'jobs/j1/output/ghidra-summary.json', bytes: 900, jobId: 'j1' },
      { relativePath: 'jobs/j1/output/strings.txt', bytes: 4000, jobId: 'j1' },
    ]),
    updateReferences: vi.fn(async (refs?: string[]) => ({ ...openView, project: { ...openView.project!, references: refs ?? references } })),
  }
  window.reaStudio = bridge
  return bridge
}

async function openTab() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Referencia' }))
}

describe('pestaña Referencia', () => {
  it('muestra la ficha y la regenera', async () => {
    const bridge = setup(true)
    await openTab()
    expect(await screen.findByText('struct Registro (16 bytes) { +0 uint id; +8 double valor }')).toBeTruthy()
    expect(screen.getByText('Solo lectura para el agente')).toBeTruthy()
    expect(screen.getByText('KERNEL32.dll')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Regenerar ficha' }))
    await waitFor(() => expect(bridge.updateReferences).toHaveBeenCalledWith(undefined))
  })

  it('elige artefactos y genera la ficha', async () => {
    const bridge = setup(false)
    await openTab()
    expect(await screen.findByText('Falta la ficha')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Generar ficha' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Elegir artefactos…' }))
    const label = await screen.findByText('jobs/j1/output/strings.txt')
    fireEvent.click(within(label.closest('label')!).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y generar ficha' }))
    await waitFor(() => expect(bridge.updateReferences).toHaveBeenCalledWith(['jobs/j1/output/strings.txt']))
  })
})
