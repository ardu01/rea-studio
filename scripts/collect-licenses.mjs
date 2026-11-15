import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = JSON.parse(await readFile('package.json', 'utf8'))
const names = [...new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {})])].sort()
const rows = []
for (const name of names) {
  const pkgPath = path.join('node_modules', name, 'package.json')
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
    const license = pkg.license || (Array.isArray(pkg.licenses) ? pkg.licenses.map((item) => item.type).join(', ') : 'no indicada')
    rows.push(`- ${name}@${pkg.version} — ${license}`)
  } catch {
    rows.push(`- ${name} — no se pudo leer package.json`)
  }
}

let transitive = 0
try {
  const entries = await readdir('node_modules')
  transitive = entries.filter((name) => !name.startsWith('.')).length
} catch {
  transitive = 0
}

const body = `# Avisos de terceros

REA Studio es software propio bajo la licencia MIT (ver LICENSE).

## Herramientas incluidas en el instalador de Windows

El instalador lleva estas herramientas sin modificar (salvo lo indicado), descargadas en la compilación de su fuente oficial con versión fija y sha256 comprobado (ver tools/manifest.json). Se instalan en resources/tools, dentro de la carpeta de REA Studio. Los textos completos de sus licencias van en resources/tools/licenses/ y la lista en resources/tools/TERCEROS.md.

| Herramienta | Versión | Licencia | Código fuente |
| --- | --- | --- | --- |
| CLI de REA (\`rea-agents\`) y sus dependencias npm | 6.8.0 | MIT; dependencias MIT, Apache-2.0, BSD, ISC, BlueOak y LGPL-3.0+ (openpgp) | https://github.com/morluto/rea |
| Node.js (solo node.exe, para la CLI de REA) | 24.22.3 | MIT y terceros (LICENSE) | https://github.com/nodejs/node/tree/v24.22.3 |
| Eclipse Temurin JDK (sin jmods/) | 25.0.5+8 | GPL-2.0 con Classpath Exception | https://github.com/adoptium/jdk25u/tree/jdk-25.0.5+8 |
| Ghidra | 12.2 | Apache-2.0; terceros en licenses/ y GPL/ | https://github.com/NationalSecurityAgency/ghidra/tree/Ghidra_12.2_build |
| radare2 | 6.2.6 | Mayormente LGPL-3.0; partes GPL, MIT, BSD, Apache-2.0, Zlib | https://github.com/radareorg/radare2/tree/6.2.6 |
| Rizin | 0.9.1 | Mayormente LGPL-3.0; otras partes libres (REUSE.toml) | https://github.com/rizinorg/rizin/tree/v0.9.1 |
| JADX | 1.5.6 | Apache-2.0 | https://github.com/skylot/jadx/tree/v1.5.6 |
| Craft Anything (CLI oficial Windows x64) | 0.6.1 | MIT o Apache-2.0 (a elección); NOTICE y ATTRIBUTION.md | https://github.com/storytold/craft-anything/tree/v0.6.1 |

El JDK, y las partes GPL o LGPL de Ghidra, radare2, Rizin y openpgp, se distribuyen con su código fuente disponible en los enlaces de la tabla, en la etiqueta exacta de la versión incluida. Si alguno deja de estar disponible ahí, se puede pedir a quien distribuye el instalador.

De la CLI de REA no se incluye el paquete opcional \`frida\` (instrumentación de procesos en ejecución): REA Studio solo hace análisis estático y frida necesita un binario nativo que se baja en su instalación.

## No incluidas

Su licencia no permite redistribuirlas. REA Studio enlaza su descarga oficial en Herramientas:

- IDA Pro (Hex-Rays): licencia comercial; IDA Free tampoco permite redistribuirlo. https://hex-rays.com/ida-free
- Binary Ninja (Vector 35): licencia comercial; la edición gratuita tampoco. https://binary.ninja/free/
- Hopper: licencia comercial y sin versión para Windows. https://www.hopperapp.com/download.html

## Servicios de IA

Codex CLI, Claude Code, Gemini CLI y las APIs de OpenAI, Anthropic, xAI y Google tienen sus propias condiciones de uso y pueden ser de pago. No van en el instalador.

El script \`resources/ghidra/ExportSummary.java\` es código original de esta aplicación. Ghidra lo compila en el equipo del usuario. No se copia código de Ghidra.

Dependencias directas de este repositorio (${names.length}). Hay unas ${transitive} carpetas en node_modules, incluidas las transitivas. El árbol completo está fijado en package-lock.json.

${rows.join('\n')}

\`npm audit\` en el momento del empaquetado de v0.1.0 reportó avisos moderados en dependencias de desarrollo (electron-builder y herramientas de empaquetado). No se aplicó \`npm audit fix\` automático. Revisa el informe antes de publicar una versión posterior.
`
await writeFile('THIRD_PARTY_NOTICES.md', body)
console.log(`wrote ${names.length} direct notices`)
