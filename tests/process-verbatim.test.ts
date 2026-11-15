import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const spawn = vi.fn()
vi.mock('node:child_process', async (importOriginal) => ({ ...(await importOriginal<typeof import('node:child_process')>()), spawn }))

describe('runProcess y cmd.exe', () => {
  it('pasa windowsVerbatimArguments a spawn', async () => {
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { pid: 123, stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough() })
      setTimeout(() => {
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0, null)
      }, 5)
      return child
    })
    const { runProcess } = await import('../src/core/process')
    for (const verbatim of [true, undefined]) {
      await runProcess({ command: 'cmd.exe', args: ['/d', '/s', '/c', '""a.cmd" "--version""'], windowsVerbatimArguments: verbatim, cwd: '.', timeoutMs: 2000, env: {} })
    }
    expect(spawn.mock.calls[0]![2]).toMatchObject({ shell: false, windowsVerbatimArguments: true })
    expect(spawn.mock.calls[1]![2]).toMatchObject({ shell: false, windowsVerbatimArguments: false })
  })
})
