# REA Studio 0.1.0 (vista previa)

Instalador NSIS x64 sin firmar, generado en GitHub Actions (`windows-latest`). SmartScreen puede avisar.

Esta publicación es una vista previa. `SHA256SUMS` identifica el archivo. `INSTALL-VALIDATION.txt` separa la build, la instalación silenciosa en el runner y el arranque del proceso (`REA_STUDIO_SMOKE=1` hasta `app.ready`). Ese arranque no demuestra un asistente en un escritorio de usuario, ni que REA, Ghidra, radare2 o Rizin estén instalados, ni que las APIs de pago respondan. Esas pruebas no se hacen aquí para no gastar crédito ni analizar binarios ajenos.

La compilación cruzada de Linux (119 MB, SHA-256 `455f1073788c9685067d7463e32a5de63bf20cf2fd02e27bf4ccba4e5dd3e801`) no es este archivo: Wine terminó la instalación con código 2.

## Incluye

- Carpeta de trabajo, trabajos con registro, cancelación y tiempo límite
- REA y Ghidra headless con comandos reales, más radare2, Rizin, cadenas y metadatos locales
- Conversación con OpenAI, Anthropic, xAI, Gemini y los CLI de Codex, Claude Code y Gemini
- El texto solo sale del equipo después de mostrar el resumen y marcar la casilla

## Cómo comprobar el archivo

En PowerShell, desde la carpeta de la descarga:

```powershell
Get-FileHash .\REA-Studio-0.1.0-win-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS
```

Las dos huellas tienen que coincidir. El instalador permite elegir la carpeta. La aplicación y las herramientas externas se instalan por separado.
