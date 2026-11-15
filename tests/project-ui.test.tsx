// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { openView, projectBridge, templates } from './project-fixtures'

describe('pantalla Proyecto', () => {
  it('crea un proyecto con plantilla y artefactos de referencia', async () => {
    const created = vi.fn(async () => openView)
    window.reaStudio = {
      ...projectBridge({ project: null, gitAvailable: true, autonomous: false, templates }),
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
    window.reaStudio = projectBridge({ project: null, gitAvailable: false, autonomous: false, templates })
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
