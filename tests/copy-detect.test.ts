import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectProgram, isSystemModule, projectNameFrom } from '../src/core/copy/detect'

const temps: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tmp(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rea-copy-'))
  temps.push(dir)
  return dir
}

function tinyPe(extra = ''): Buffer {
  const buf = Buffer.alloc(256, 0)
  buf[0] = 0x4d
  buf[1] = 0x5a
  buf.writeUInt32LE(0x40, 0x3c)
  if (extra) buf.write(extra, 80, 'utf8')
  return buf
}

describe('detección del modo sencillo', () => {
  it('nombra el proyecto a partir del archivo', () => {
    expect(projectNameFrom('/apps/Jerry.exe')).toBe('jerry')
    expect(projectNameFrom('/apps/Mi App.apk')).toBe('mi-app')
  })

  it('reconoce Jerry.exe junto a resources/app.asar como Electron', async () => {
    const root = await tmp()
    const exe = path.join(root, 'Jerry.exe')
    await writeFile(exe, tinyPe())
    await mkdir(path.join(root, 'resources'))
    await writeFile(path.join(root, 'resources', 'app.asar'), 'asar')
    const dest = path.join(root, 'out')
    const asFile = await detectProgram(exe, { destParent: dest })
    expect(asFile.kind).toBe('electron')
    expect(asFile.template).toBe('node')
    expect(asFile.fileTarget).toBe(path.join(root, 'resources', 'app.asar'))
    expect(asFile.folderTarget).toBe(root)
    const asFolder = await detectProgram(root, { destParent: dest })
    expect(asFolder.kind).toBe('electron')
    expect(asFolder.folderTarget).toBe(root)
  })

  it('reconoce un APK o un proyecto Java', async () => {
    const root = await tmp()
    const apk = path.join(root, 'demo.apk')
    await writeFile(apk, 'PK\u0003\u0004AndroidManifest.xml')
    const detected = await detectProgram(apk, { destParent: path.join(root, 'out') })
    expect(detected.kind).toBe('java')
    expect(detected.template).toBe('java')
    const src = path.join(root, 'src')
    await mkdir(src)
    await writeFile(path.join(src, 'App.java'), 'class App {}')
    const folder = await detectProgram(root, { destParent: path.join(root, 'out') })
    expect(folder.kind).toBe('java')
    expect(folder.template).toBe('java')
  })

  it('lista DLL del programa y omite las del sistema', async () => {
    const root = await tmp()
    const exe = path.join(root, 'app.exe')
    await writeFile(exe, tinyPe())
    await writeFile(path.join(root, 'plugin.dll'), tinyPe())
    await writeFile(path.join(root, 'kernel32.dll'), tinyPe())
    const detected = await detectProgram(exe, { destParent: path.join(root, 'out') })
    expect(detected.kind).toBe('native')
    expect(detected.template).toBe('cmake')
    expect(detected.modules?.map((item) => item.name)).toEqual(['plugin.dll'])
  })

  it('reconoce Python (PyInstaller) y .NET administrado por la marca CLR', async () => {
    const root = await tmp()
    const py = path.join(root, 'packed.exe')
    await writeFile(py, tinyPe('PyInstaller MEIPASS'))
    const python = await detectProgram(py, { destParent: path.join(root, 'out') })
    expect(python.kind).toBe('python')
    expect(python.template).toBe('python')
    await writeFile(path.join(root, 'app.py'), 'print(1)\n')
    const src = await detectProgram(path.join(root, 'app.py'), { destParent: path.join(root, 'out') })
    expect(src.kind).toBe('python')
  })

  it('un texto suelto no se trata como aplicación, con un motivo claro', async () => {
    const root = await tmp()
    const file = path.join(root, 'notas.txt')
    await writeFile(file, 'hola')
    const detected = await detectProgram(file, { destParent: path.join(root, 'out') })
    expect(detected.kind).toBe('unknown')
    expect(detected.template).toBeNull()
    expect(detected.reason).toMatch(/no parece una aplicación/i)
  })

  it('distingue módulos del sistema', () => {
    expect(isSystemModule('kernel32.dll')).toBe(true)
    expect(isSystemModule('api-ms-win-core-synch-l1-2-0.dll')).toBe(true)
    expect(isSystemModule('libc.so.6')).toBe(true)
    expect(isSystemModule('jerry.dll')).toBe(false)
    expect(isSystemModule('plugin.so')).toBe(false)
  })
})
