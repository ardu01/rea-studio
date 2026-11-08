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

REA Studio es software propio bajo la licencia MIT (ver LICENSE). No incluye el código de Ghidra, REA, radare2, Rizin, IDA, Binary Ninja, Hopper ni JADX.

Las herramientas externas se instalan aparte y conservan sus licencias:

- REA (\`rea-agents\`): MIT. https://github.com/morluto/rea
- Ghidra: Apache-2.0. https://github.com/NationalSecurityAgency/ghidra
- JDK Temurin: GPLv2 con classpath exception. https://adoptium.net/
- radare2: LGPL-3.0. https://github.com/radareorg/radare2
- Rizin: LGPL-3.0. https://github.com/rizinorg/rizin
- Codex CLI, Claude Code, Gemini CLI y las APIs de OpenAI, Anthropic, xAI y Google tienen sus propias condiciones de uso y pueden ser de pago.

El script \`resources/ghidra/ExportSummary.java\` es código original de esta aplicación. Ghidra lo compila en el equipo del usuario. No se copia código de Ghidra.

Dependencias directas de este repositorio (${names.length}). Hay unas ${transitive} carpetas en node_modules, incluidas las transitivas. El árbol completo está fijado en package-lock.json.

${rows.join('\n')}

\`npm audit\` en el momento del empaquetado de v0.1.0 reportó avisos moderados en dependencias de desarrollo (electron-builder y herramientas de empaquetado). No se aplicó \`npm audit fix\` automático. Revisa el informe antes de publicar una versión posterior.
`
await writeFile('THIRD_PARTY_NOTICES.md', body)
console.log(`wrote ${names.length} direct notices`)
