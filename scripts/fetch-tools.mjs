// Descarga, verifica y prepara las herramientas que lleva el instalador de Windows.
// Uso: node scripts/fetch-tools.mjs [--check]
//   --check  solo comprueba que vendor-tools/ coincide con tools/manifest.json.
// Cada archivo se baja de la URL oficial fijada en tools/manifest.json y se rechaza si su
// sha256 no coincide. La CLI de REA se instala con `npm ci` desde tools/rea/package-lock.json
// (integridad sha512 de cada paquete), para Windows x64 y sin ejecutar scripts de instalación.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'tools/manifest.json'), 'utf8'))
const cacheDir = path.join(root, '.cache/tools')
const outDir = path.join(root, 'vendor-tools')
const stampFile = path.join(outDir, 'tools.json')
const checkOnly = process.argv.includes('--check')

function log(text) {
  process.stdout.write(`${text}\n`)
}

async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

async function download(url, dest, expected) {
  if (existsSync(dest)) {
    const got = await sha256File(dest)
    if (got === expected) return
    log(`  la copia en caché no coincide (${got}); se vuelve a bajar`)
    await rm(dest)
  }
  const tmp = `${dest}.part`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  const got = await sha256File(tmp)
  if (got !== expected) {
    await rm(tmp)
    throw new Error(`sha256 distinto para ${url}\n  esperado ${expected}\n  obtenido ${got}`)
  }
  await rename(tmp, dest)
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...opts })
  if (result.status !== 0) throw new Error(`Falló: ${command} ${args.join(' ')}`)
}

function extractZip(zip, dest) {
  // Windows 10+ trae bsdtar (tar.exe), que abre ZIP; en Linux y macOS se usa unzip.
  if (process.platform === 'win32') run('tar', ['-xf', zip, '-C', dest])
  else run('unzip', ['-q', '-o', zip, '-d', dest])
}

async function prepareArchive(item) {
  const file = path.join(cacheDir, decodeURIComponent(path.basename(new URL(item.url).pathname)))
  log(`· ${item.name} ${item.version}`)
  await download(item.url, file, item.sha256)
  const work = await mkdtemp(path.join(tmpdir(), `rea-tools-${item.id}-`))
  try {
    extractZip(file, work)
    let top = work
    if (item.stripTopDir) {
      const entries = (await readdir(work)).filter((name) => !name.startsWith('.'))
      if (entries.length !== 1) throw new Error(`${item.id}: se esperaba una sola carpeta raíz en el ZIP`)
      top = path.join(work, entries[0])
    }
    const dest = path.join(outDir, item.dest)
    await rm(dest, { recursive: true, force: true })
    if (item.keep) {
      await mkdir(dest, { recursive: true })
      for (const name of item.keep) await cp(path.join(top, name), path.join(dest, name), { recursive: true })
    } else {
      await rename(top, dest).catch(async () => cp(top, dest, { recursive: true }))
    }
    for (const rel of item.exclude ?? []) await rm(path.join(dest, rel), { recursive: true, force: true })
    const licDir = path.join(outDir, 'licenses', item.id)
    await mkdir(licDir, { recursive: true })
    for (const rel of item.licenseFiles ?? []) {
      const src = path.join(dest, rel)
      if (!existsSync(src)) throw new Error(`${item.id}: falta el archivo de licencia ${rel}`)
      await cp(src, path.join(licDir, rel), { recursive: true })
    }
    for (const lic of item.licenseDownloads ?? []) {
      const target = path.join(licDir, lic.file)
      await download(lic.url, target, lic.sha256)
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

async function prepareNpm(item) {
  log(`· ${item.name} ${item.version}`)
  const dest = path.join(outDir, item.dest)
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })
  for (const name of ['package.json', 'package-lock.json']) await cp(path.join(root, item.lockDir, name), path.join(dest, name))
  const lock = JSON.parse(await readFile(path.join(dest, 'package-lock.json'), 'utf8'))
  const locked = lock.packages?.[`node_modules/${item.package}`]
  if (locked?.version !== item.version || locked?.integrity !== item.integrity) {
    throw new Error(`${item.id}: el lockfile no fija ${item.package}@${item.version} con la integridad del manifiesto`)
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  run(npm, ['ci', '--omit=dev', '--os=win32', '--cpu=x64', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: dest,
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_cache: path.join(cacheDir, 'npm') },
  })
  // frida es opcional en rea-agents, sirve para instrumentar procesos en ejecución y necesita un
  // binario nativo que se baja en su script de instalación. REA Studio solo hace análisis estático:
  // no se incluye.
  for (const name of item.remove ?? []) await rm(path.join(dest, 'node_modules', name), { recursive: true, force: true })
  const licDir = path.join(outDir, 'licenses', item.id)
  await mkdir(licDir, { recursive: true })
  const rows = []
  const modules = path.join(dest, 'node_modules')
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.name.startsWith('@')) {
        await walk(full)
        continue
      }
      const pkgFile = path.join(full, 'package.json')
      if (existsSync(pkgFile)) {
        const pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
        const license = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? 'no indicada')
        rows.push({ name: pkg.name, version: pkg.version, license })
        const files = (await readdir(full)).filter((name) => /^(licen[cs]e|copying|notice)/i.test(name))
        for (const lic of files) await cp(path.join(full, lic), path.join(licDir, `${pkg.name.replace("/", "__")}@${pkg.version}-${lic}`), { recursive: true })
      }
      const nested = path.join(full, 'node_modules')
      if (existsSync(nested)) await walk(nested)
    }
  }
  await walk(modules)
  rows.sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(path.join(licDir, 'PAQUETES.md'), `# Paquetes npm de ${item.name}\n\n${rows.map((r) => `- ${r.name}@${r.version} — ${r.license}`).join('\n')}\n`)
  return rows
}

async function dirSize(dir) {
  let total = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(full)
    else if (entry.isFile()) total += (await stat(full)).size
  }
  return total
}

function stampOf() {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
}

if (checkOnly) {
  const ok = existsSync(stampFile) && JSON.parse(await readFile(stampFile, 'utf8')).manifestSha256 === stampOf()
  log(ok ? 'vendor-tools/ está al día.' : 'vendor-tools/ falta o no coincide con tools/manifest.json. Ejecuta npm run tools:fetch.')
  process.exit(ok ? 0 : 1)
}

await mkdir(cacheDir, { recursive: true })
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const tools = []
for (const item of manifest.archives) {
  await prepareArchive(item)
  tools.push(item)
}
const npmRows = {}
for (const item of manifest.npm) {
  npmRows[item.id] = await prepareNpm(item)
  tools.push(item)
}

const lines = [
  '# Herramientas incluidas en el instalador de REA Studio',
  '',
  'Se instalan para el usuario dentro de la carpeta de REA Studio (resources/tools). No cambian el PATH ni necesitan permisos de administrador.',
  '',
  '| Herramienta | Versión | Licencia | Código fuente |',
  '| --- | --- | --- | --- |',
  ...tools.map((t) => `| ${t.name} | ${t.version} | ${t.license} | ${t.source} |`),
  '',
  'Los textos de cada licencia están en licenses/<herramienta>/.',
  '',
  'El JDK Temurin se distribuye bajo GPL-2.0 con Classpath Exception. Su código fuente correspondiente está en el enlace de la tabla; también se puede pedir escribiendo a quien te dio este instalador.',
  'radare2 y Rizin son mayormente LGPL-3.0: puedes obtener su código fuente en los enlaces de la tabla y sustituir sus bibliotecas por versiones modificadas.',
  '',
  '## No incluidas',
  '',
  ...manifest.notBundled.map((t) => `- ${t.name}: ${t.reason} Descarga oficial: ${t.url}`),
  '',
  '## Paquetes npm de la CLI de REA',
  '',
  ...Object.values(npmRows).flat().map((r) => `- ${r.name}@${r.version} — ${r.license}`),
  '',
]
await writeFile(path.join(outDir, 'TERCEROS.md'), lines.join('\n'))
await writeFile(
  stampFile,
  `${JSON.stringify(
    {
      manifestSha256: stampOf(),
      platform: manifest.platform,
      tools: tools.map((t) => ({ id: t.id, name: t.name, version: t.version, license: t.license, source: t.source, dir: t.dest })),
      notBundled: manifest.notBundled,
    },
    null,
    2,
  )}\n`,
)
const bytes = await dirSize(outDir)
log(`Listo: vendor-tools/ ocupa ${(bytes / 1024 / 1024).toFixed(0)} MB sin comprimir.`)
