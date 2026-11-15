// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import type { ProjectEvent } from '../src/shared/types'
import { openView, projectBridge } from './project-fixtures'

function setup(autonomous = false, kind: 'normal' | 'install' = 'normal') {
  let listener: ((event: ProjectEvent) => void) | null = null
  const bridge = {
    ...projectBridge({ ...openView, autonomous }),
    checkCommand: vi.fn(async (command: string, args: string[]) => ({
      allowed: command !== 'curl',
      reason: command === 'curl' ? '«curl» no está en la lista de comandos permitidos.' : undefined,
      kind,
      network: kind === 'install',
      display: [command, ...args].join(' '),
      command,
      args,
      needsApproval: kind === 'install' || !autonomous,
    })),
    runCommand: vi.fn(async () => ({ runId: 'cmd-1' })),
    cancelCommand: vi.fn(async () => undefined),
    setAutonomous: vi.fn(async (enabled: boolean) => ({ ...openView, autonomous: enabled })),
    onProjectEvent: (cb: (event: ProjectEvent) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    },
  }
  window.reaStudio = bridge
  return { bridge, emit: (event: ProjectEvent) => listener?.(event) }
}

async function openCommands() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Comandos' }))
}

describe('comandos en la pantalla Proyecto', () => {
  it('pide confirmación, ejecuta y muestra la salida en vivo', async () => {
    const { bridge, emit } = setup()
    await openCommands()
    fireEvent.click(await screen.findByRole('button', { name: 'Probar: npm test' }))
    const dialog = await screen.findByRole('dialog', { name: '¿Ejecutar este comando?' })
    expect(dialog).toHaveTextContent('/datos/proyectos/visor-registros')
    expect(dialog).toHaveTextContent('No: se lanza el ejecutable directamente')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ejecutar' }))
    await waitFor(() => expect(bridge.runCommand).toHaveBeenCalledWith({ command: 'npm', args: ['test'], confirmed: true }))
    await act(async () => emit({ kind: 'chunk', runId: 'cmd-1', stream: 'stdout', text: 'ejecutando pruebas\n' }))
    expect(await screen.findByText('ejecutando pruebas')).toBeTruthy()
    expect(screen.getByText('En marcha…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Detener' }))
    expect(bridge.cancelCommand).toHaveBeenCalledWith('cmd-1')
    await act(async () =>
      emit({ kind: 'done', runId: 'cmd-1', result: { display: 'npm test', status: 'failed', exitCode: 1, durationMs: 1500, output: 'AssertionError: x\n', logPath: '.rea/salidas/a.log' } }),
    )
    expect(await screen.findByText('Falló · código 1')).toBeTruthy()
    expect(screen.getByText('AssertionError: x')).toHaveClass('err')
  })

  it('rechazar no ejecuta nada', async () => {
    const { bridge } = setup()
    await openCommands()
    fireEvent.click(await screen.findByRole('button', { name: 'Probar: npm test' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rechazar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bridge.runCommand).not.toHaveBeenCalled()
  })

  it('en modo autónomo no pregunta, salvo para instalar', async () => {
    const auto = setup(true)
    await openCommands()
    fireEvent.click(await screen.findByRole('button', { name: 'Probar: npm test' }))
    await waitFor(() => expect(auto.bridge.runCommand).toHaveBeenCalledWith({ command: 'npm', args: ['test'], confirmed: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('instalar pregunta también en modo autónomo y avisa de la red', async () => {
    setup(true, 'install')
    await openCommands()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Otro comando' }), { target: { value: 'npm install commander' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('siempre se pregunta, también en modo autónomo')
    expect(dialog).toHaveTextContent('registro público')
  })

  it('muestra el motivo si el comando no está permitido y activa el modo autónomo', async () => {
    const { bridge } = setup()
    await openCommands()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Otro comando' }), { target: { value: 'curl http://x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no está en la lista')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Modo autónomo' }))
    await waitFor(() => expect(bridge.setAutonomous).toHaveBeenCalledWith(true))
    expect(await screen.findByText('Sin preguntar (salvo instalar)')).toBeTruthy()
  })
})
