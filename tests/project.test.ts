import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findOnPath } from '../src/core/command'
import { projectCreateSchema, projectStepSchema } from '../src/core/ipc-schemas'
import { applyEdit, assertProjectRelative, assertWritable, listProjectTree, readProjectFile, resolveProjectPath, treeSummary, writeProjectFile } from '../src/core/project/fs'
import { processGitRunner, ProjectGit } from '../src/core/project/git'
import { assertProjectName, parseManifest } from '../src/core/project/project'
import { ProjectService } from '../src/core/project/service'
import { PROJECT_TEMPLATES, templateFor } from '../src/core/project/templates'
import { normalizeSettings } from '../src/core/settings'

const GIT = findOnPath('git', process.env.PATH ?? '', process.platform)
const temps: string[] = []
async function temp(prefix = 'rea-proy-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true })
})

describe('rutas del proyecto', () => {
  it('rechaza escapes, .git, nombres reservados y flujos alternativos', () => {
    expect(assertProjectRelative('src/index.js')).toBe('src/index.js')
    expect(assertProjectRelative('.\\src\\a.js')).toBe('src/a.js')
    for (const bad of ['../x', 'src/../../x', '/etc/passwd', 'C:\\Windows\\x', 'C:x', '\\\\srv\\share', '.git/config', 'src/.GIT/hooks/pre-commit', 'CON', 'src/nul.txt', 'com1.js', 'a.js:flujo', 'carpeta./a', 'a /b', 'a\u0000b', 'a?b', '']) {
      expect(() => assertProjectRelative(bad), bad).toThrow()
    }
  })

  it('solo deja escribir texto de código o configuración', () => {
    expect(assertWritable('src/a.ts')).toBe('src/a.ts')
    expect(assertWritable('CMakeLists.txt')).toBe('CMakeLists.txt')
    for (const bad of ['run.bat', 'x.cmd', 'x.ps1', 'x.sh', 'app.exe', 'lib.dll', 'sin-extension', '.rea/log.txt', 'rea-proyecto.json']) {
      expect(() => assertWritable(bad), bad).toThrow()
    }
  })

  it('no sigue enlaces simbólicos que salen del proyecto', async () => {
    const root = await temp()
    const outside = await temp('rea-fuera-')
    await writeFile(path.join(outside, 'secreto.txt'), 'no')
    try {
      await symlink(outside, path.join(root, 'enlace'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch {
      return // sin permiso para crear enlaces en este sistema
    }
    await expect(resolveProjectPath(root, 'enlace/secreto.txt')).rejects.toThrow(/sale/)
    await expect(readProjectFile(root, 'enlace/secreto.txt')).rejects.toThrow(/sale/)
    await expect(writeProjectFile(root, 'enlace/nuevo.txt', 'x')).rejects.toThrow(/sale/)
    const tree = await listProjectTree(root)
    expect(tree.entries.find((item) => item.path === 'enlace')?.kind).toBe('link')
  })

  it('escribe, lee, edita y lista dentro del proyecto', async () => {
    const root = await temp()
    const first = await writeProjectFile(root, 'src/deep/a.js', 'uno\n')
    expect(first.created).toBe(true)
    const second = await writeProjectFile(root, 'src/deep/a.js', 'dos\n')
    expect(second).toMatchObject({ created: false, previous: 'uno\n' })
    expect((await readProjectFile(root, 'src/deep/a.js')).text).toBe('dos\n')
    await expect(writeProjectFile(root, 'grande.txt', 'x'.repeat(600 * 1024))).rejects.toThrow(/tamaño/)
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(path.join(root, 'node_modules', 'pkg', 'i.js'), '')
    await writeFile(path.join(root, 'bin.dat'), Buffer.from([0, 1, 2, 0]))
    expect((await readProjectFile(root, 'bin.dat')).binary).toBe(true)
    const tree = await listProjectTree(root)
    expect(tree.entries.map((item) => item.path)).toEqual(['node_modules', 'src', 'src/deep', 'src/deep/a.js', 'bin.dat'])
    expect(tree.entries[0]).toMatchObject({ skipped: true })
    expect(treeSummary(tree.entries)).toContain('node_modules/ (omitida)')
    const small = await listProjectTree(root, { maxEntries: 2 })
    expect(small.truncated).toBe(true)
  })

  it('edita un fragmento único', () => {
    expect(applyEdit('a b c', 'b', 'B')).toBe('a B c')
    expect(() => applyEdit('a b b', 'b', 'B')).toThrow(/más de una vez/)
    expect(() => applyEdit('a', 'z', 'B')).toThrow(/No se encontró/)
    expect(() => applyEdit('a', '', 'B')).toThrow()
  })
})

describe('plantillas y manifiesto', () => {
  it('las cuatro plantillas generan solo rutas escribibles y comandos', () => {
    expect(PROJECT_TEMPLATES.map((item) => item.id)).toEqual(['node', 'python', 'dotnet', 'cmake'])
    for (const template of PROJECT_TEMPLATES) {
      const files = template.files('demo')
      expect(Object.keys(files).length).toBeGreaterThan(2)
      for (const rel of Object.keys(files)) expect(() => assertWritable(rel), rel).not.toThrow()
      expect(files['.gitignore']).toContain('.rea/')
      expect(template.commands.length).toBeGreaterThan(0)
    }
    expect(() => templateFor('rust')).toThrow()
  })

  it('valida el nombre, el manifiesto y los esquemas IPC', () => {
    expect(assertProjectName('visor-registros')).toBe('visor-registros')
    for (const bad of ['Mayus', '../x', 'a b', '-x', 'x.', '']) expect(() => assertProjectName(bad)).toThrow()
    expect(() => parseManifest('{"app":"otra"}')).toThrow()
    expect(parseManifest('{"app":"rea-studio","kind":"proyecto","name":"demo","template":"python","references":["a",1]}').references).toEqual(['a'])
    expect(projectCreateSchema.safeParse({ parentDir: '/tmp', name: 'demo', template: 'node', references: [] }).success).toBe(true)
    expect(projectCreateSchema.safeParse({ parentDir: '/tmp', name: 'demo', template: 'java', references: [] }).success).toBe(false)
    expect(projectCreateSchema.safeParse({ parentDir: '/tmp', name: 'demo', template: 'node', references: [], extra: 1 }).success).toBe(false)
    expect(projectStepSchema.safeParse({ stepId: 'HEAD~1' }).success).toBe(false)
  })

  it('guarda la ruta del proyecto en ajustes solo si es absoluta', () => {
    expect(normalizeSettings({ projectPath: '/tmp/demo' }).projectPath).toBe('/tmp/demo')
    expect(normalizeSettings({}).projectPath).toBeNull()
    expect(() => normalizeSettings({ projectPath: 'relativa' })).toThrow()
  })
})

describe.skipIf(!GIT)('git local del proyecto (git real en una carpeta temporal)', () => {
  function service(workspace: string | null = null) {
    return new ProjectService({ gitFor: (root) => processGitRunner(GIT!, root), workspace: () => workspace })
  }

  it('crea el proyecto con commit inicial y lo vuelve a abrir', async () => {
    const parent = await temp()
    const projects = service()
    const info = await projects.create({ parentDir: parent, name: 'demo', template: 'node', references: ['jobs/a/strings.txt'] })
    expect(info.root).toBe(path.join(parent, 'demo'))
    expect(existsSync(path.join(info.root, '.git'))).toBe(true)
    expect(JSON.parse(await readFile(path.join(info.root, 'rea-proyecto.json'), 'utf8'))).toMatchObject({ name: 'demo', template: 'node', references: ['jobs/a/strings.txt'] })
    const history = await projects.history()
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ byRea: true, author: 'REA Studio' })
    expect(history[0]!.message).toMatch(/^REA: crea el proyecto demo/)
    projects.close()
    const reopened = await projects.open(info.root)
    expect(reopened.commands[0]).toMatchObject({ command: 'npm', args: ['test'] })
    await expect(projects.create({ parentDir: parent, name: 'demo', template: 'node', references: [] })).rejects.toThrow(/no está vacía/)
  })

  it('un commit por paso, diff, deshacer exacto y volver al inicio', async () => {
    const parent = await temp()
    const projects = service()
    const info = await projects.create({ parentDir: parent, name: 'pasos', template: 'python', references: [] })
    const git = projects.git()
    await writeProjectFile(info.root, 'app/nucleo.py', 'def saludo(n):\n    return "Hola"\n')
    expect((await git.status()).get('app/nucleo.py')).toBe('M')
    expect(await projects.diff()).toContain('+    return "Hola"')
    const step1 = await git.commitAll('cambia saludo')
    expect(step1).toMatch(/^[0-9a-f]{40}$/)
    expect(await git.commitAll('nada')).toBeNull()
    await writeProjectFile(info.root, 'app/extra.py', 'X = 1\n')
    const step2 = await git.commitAll('añade extra')
    await writeProjectFile(info.root, 'app/sucio.py', 'Y = 2\n')
    await expect(projects.undo(step1!)).rejects.toThrow(/sin guardar/)
    await rm(path.join(info.root, 'app/sucio.py'))
    await projects.undo(step2!)
    expect(existsSync(path.join(info.root, 'app/extra.py'))).toBe(false)
    expect(await readFile(path.join(info.root, 'app/nucleo.py'), 'utf8')).toContain('"Hola"')
    await projects.resetToStart()
    expect(await readFile(path.join(info.root, 'app/nucleo.py'), 'utf8')).toContain('f"Hola, {nombre}"')
    const history = await projects.history()
    expect(history[0]!.message).toBe('REA: vuelve al estado inicial')
    await expect(projects.undo(history[history.length - 1]!.id)).rejects.toThrow(/inicial/)
    const tree = await projects.tree()
    expect(tree.entries.some((item) => item.path === '.git' && item.skipped)).toBe(true)
  })

  it('no deshace commits que no son de REA', async () => {
    const parent = await temp()
    const projects = service()
    const info = await projects.create({ parentDir: parent, name: 'ajeno', template: 'cmake', references: [] })
    await writeProjectFile(info.root, 'src/main.cpp', 'int main(){return 0;}\n')
    const run = processGitRunner(GIT!, info.root)
    await run(['add', '-A'])
    await run(['-c', 'user.name=Otra', '-c', 'user.email=otra@example.com', 'commit', '-q', '-m', 'mío'])
    const [mine] = await projects.history()
    expect(mine!.byRea).toBe(false)
    await expect(projects.undo(mine!.id)).rejects.toThrow(/Solo se deshacen/)
  })

  it('no crea un proyecto dentro de la carpeta de análisis ni que la contenga', async () => {
    const base = await temp('rea-ws-')
    const workspace = path.join(base, 'contiene', 'analisis')
    await mkdir(workspace, { recursive: true })
    await expect(service(workspace).create({ parentDir: workspace, name: 'dentro', template: 'node', references: [] })).rejects.toThrow(/carpeta de análisis/)
    await expect(service(workspace).create({ parentDir: base, name: 'contiene', template: 'node', references: [] })).rejects.toThrow(/carpeta de análisis/)
    await expect(service(workspace).create({ parentDir: base, name: 'aparte', template: 'node', references: [] })).resolves.toMatchObject({ name: 'aparte' })
  })
})

describe('sin git', () => {
  it('se niega a crear el proyecto', async () => {
    const parent = await temp()
    const projects = new ProjectService({ gitFor: () => null, workspace: () => null })
    expect(projects.view().gitAvailable).toBe(false)
    await expect(projects.create({ parentDir: parent, name: 'x', template: 'node', references: [] })).rejects.toThrow(/git/)
    await expect(projects.tree()).rejects.toThrow(/Abre o crea/)
  })
})

it('GIT runner existe o se omiten las pruebas de git', () => {
  expect(typeof ProjectGit).toBe('function')
})
