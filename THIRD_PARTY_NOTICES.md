# Avisos de terceros

REA Studio es software propio bajo la licencia MIT (ver LICENSE). No incluye el código de Ghidra, REA, radare2, Rizin, IDA, Binary Ninja, Hopper ni JADX.

Las herramientas externas se instalan aparte y conservan sus licencias:

- REA (`rea-agents`): MIT. https://github.com/morluto/rea
- Ghidra: Apache-2.0. https://github.com/NationalSecurityAgency/ghidra
- JDK Temurin: GPLv2 con classpath exception. https://adoptium.net/
- radare2: LGPL-3.0. https://github.com/radareorg/radare2
- Rizin: LGPL-3.0. https://github.com/rizinorg/rizin
- Codex CLI, Claude Code, Gemini CLI y las APIs de OpenAI, Anthropic, xAI y Google tienen sus propias condiciones de uso y pueden ser de pago.

El script `resources/ghidra/ExportSummary.java` es código original de esta aplicación. Ghidra lo compila en el equipo del usuario. No se copia código de Ghidra.

Dependencias directas de este repositorio (28). Hay unas 302 carpetas en node_modules, incluidas las transitivas. El árbol completo está fijado en package-lock.json.

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
