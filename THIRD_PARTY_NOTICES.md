# Avisos de terceros

REA Studio es software propio bajo la licencia MIT (ver LICENSE).

## Herramientas incluidas en el instalador de Windows

El instalador lleva estas herramientas sin modificar (salvo lo indicado), descargadas en la compilación de su fuente oficial con versión fija y sha256 comprobado (ver tools/manifest.json). Se instalan en resources/tools, dentro de la carpeta de REA Studio. Los textos completos de sus licencias van en resources/tools/licenses/ y la lista en resources/tools/TERCEROS.md.

| Herramienta | Versión | Licencia | Código fuente |
| --- | --- | --- | --- |
| CLI de REA (`rea-agents`) y sus dependencias npm | 6.8.0 | MIT; dependencias MIT, Apache-2.0, BSD, ISC, BlueOak y LGPL-3.0+ (openpgp) | https://github.com/morluto/rea |
| Node.js (solo node.exe, para la CLI de REA) | 24.22.3 | MIT y terceros (LICENSE) | https://github.com/nodejs/node/tree/v24.22.3 |
| Eclipse Temurin JDK (sin jmods/) | 25.0.5+8 | GPL-2.0 con Classpath Exception | https://github.com/adoptium/jdk25u/tree/jdk-25.0.5+8 |
| Ghidra | 12.2 | Apache-2.0; terceros en licenses/ y GPL/ | https://github.com/NationalSecurityAgency/ghidra/tree/Ghidra_12.2_build |
| radare2 | 6.2.6 | Mayormente LGPL-3.0; partes GPL, MIT, BSD, Apache-2.0, Zlib | https://github.com/radareorg/radare2/tree/6.2.6 |
| Rizin | 0.9.1 | Mayormente LGPL-3.0; otras partes libres (REUSE.toml) | https://github.com/rizinorg/rizin/tree/v0.9.1 |
| JADX | 1.5.6 | Apache-2.0 | https://github.com/skylot/jadx/tree/v1.5.6 |

El JDK, y las partes GPL o LGPL de Ghidra, radare2, Rizin y openpgp, se distribuyen con su código fuente disponible en los enlaces de la tabla, en la etiqueta exacta de la versión incluida. Si alguno deja de estar disponible ahí, se puede pedir a quien distribuye el instalador.

De la CLI de REA no se incluye el paquete opcional `frida` (instrumentación de procesos en ejecución): REA Studio solo hace análisis estático y frida necesita un binario nativo que se baja en su instalación.

## No incluidas

Su licencia no permite redistribuirlas. REA Studio enlaza su descarga oficial en Herramientas:

- IDA Pro (Hex-Rays): licencia comercial; IDA Free tampoco permite redistribuirlo. https://hex-rays.com/ida-free
- Binary Ninja (Vector 35): licencia comercial; la edición gratuita tampoco. https://binary.ninja/free/
- Hopper: licencia comercial y sin versión para Windows. https://www.hopperapp.com/download.html

## Servicios de IA

Codex CLI, Claude Code, Gemini CLI y las APIs de OpenAI, Anthropic, xAI y Google tienen sus propias condiciones de uso y pueden ser de pago. No van en el instalador.

El script `resources/ghidra/ExportSummary.java` es código original de esta aplicación. Ghidra lo compila en el equipo del usuario. No se copia código de Ghidra.

Dependencias directas de este repositorio (28). Hay unas 303 carpetas en node_modules, incluidas las transitivas. El árbol completo está fijado en package-lock.json.

- @radix-ui/react-checkbox@1.4.1 — MIT
- @radix-ui/react-dialog@1.3.1 — MIT
- @radix-ui/react-label@2.1.17 — MIT
- @radix-ui/react-scroll-area@1.4.0 — MIT
- @radix-ui/react-separator@1.2.0 — MIT
- @radix-ui/react-slot@1.5.0 — MIT
- @tailwindcss/vite@4.3.5 — MIT
- @testing-library/jest-dom@7.0.1 — MIT
- @testing-library/react@16.3.3 — MIT
- @types/node@26.6.6 — MIT
- @types/react@19.3.0 — MIT
- @types/react-dom@19.3.0 — MIT
- @vitejs/plugin-react@6.2.1 — MIT
- class-variance-authority@0.7.1 — Apache-2.0
- clsx@2.1.1 — MIT
- electron@45.2.3 — MIT
- electron-builder@26.18.0 — MIT
- electron-vite@6.0.0 — MIT
- happy-dom@21.0.4 — MIT
- lucide-react@1.70.0 — ISC
- react@19.3.1 — MIT
- react-dom@19.3.1 — MIT
- tailwind-merge@3.7.0 — MIT
- tailwindcss@4.3.5 — MIT
- typescript@7.0.2 — Apache-2.0
- vite@8.3.6 — MIT
- vitest@5.1.0 — MIT
- zod@4.6.7 — MIT

`npm audit` en el momento del empaquetado de v0.1.0 reportó avisos moderados en dependencias de desarrollo (electron-builder y herramientas de empaquetado). No se aplicó `npm audit fix` automático. Revisa el informe antes de publicar una versión posterior.
