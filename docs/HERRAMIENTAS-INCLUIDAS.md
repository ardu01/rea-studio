# Herramientas incluidas en el instalador de Windows

El instalador NSIS lleva todas las herramientas del catálogo que se pueden redistribuir. Se instalan para el usuario dentro de la carpeta de la app (`%LOCALAPPDATA%\Programs\REA Studio\resources\tools`), sin permisos de administrador y sin cambiar el PATH ni otras variables del sistema.

| Herramienta | Versión | Carpeta | Para qué |
| --- | --- | --- | --- |
| CLI de REA (`rea-agents`) | 6.8.0 | `rea/` | Trabajos de REA. Se lanza con `node/node.exe`, sin cmd.exe. |
| Node.js (solo `node.exe`) | 24.22.3 | `node/` | Motor de la CLI de REA. |
| Eclipse Temurin JDK | 25.0.5+8 | `jdk/` | Java para Ghidra y JADX (se pasa como `JAVA_HOME`). |
| Ghidra | 12.2 | `ghidra/` | `support/analyzeHeadless.bat`. |
| radare2 | 6.2.6 | `radare2/` | `bin/radare2.exe`, `bin/rabin2.exe`. |
| Rizin | 0.9.1 | `rizin/` | `bin/rizin.exe`, `bin/rz-bin.exe`. |
| JADX | 1.5.6 | `jadx/` | `bin/jadx.bat`, con `-j 2` y `-Xmx4g` para no agotar la RAM. |

No incluidas, porque su licencia no permite redistribuirlas: IDA Pro, Binary Ninja y Hopper (este último, además, no tiene versión para Windows). La pantalla Herramientas tiene un botón para abrir su descarga oficial.

## Orden de búsqueda

1. La ruta que indiques en Herramientas.
2. La copia incluida en `resources/tools`.
3. El PATH (y `GHIDRA_INSTALL_DIR` para Ghidra).

La pantalla Herramientas marca cada una como «Incluida» o «Ruta propia».

## Cómo se preparan

`tools/manifest.json` fija la versión, la URL oficial y el sha256 de cada archivo. `npm run tools:fetch` (lo lanza `npm run dist:win` si hace falta):

1. Descarga cada ZIP a `.cache/tools/` y lo rechaza si el sha256 no coincide.
2. Lo descomprime en `vendor-tools/<herramienta>`.
3. Instala la CLI de REA con `npm ci` desde `tools/rea/package-lock.json`, para Windows x64 y sin scripts de instalación. Cada paquete va fijado con su integridad sha512. Se quita el paquete opcional `frida` (instrumentación en vivo; REA Studio solo hace análisis estático).
4. Copia las licencias a `vendor-tools/licenses/<herramienta>/` (las de radare2 y Rizin se bajan de su etiqueta en GitHub, también con sha256) y escribe `TERCEROS.md` y `tools.json`.

`electron-builder.yml` copia `vendor-tools/` a `resources/tools`. `npm run tools:check` dice si `vendor-tools/` está al día con el manifiesto.

Para actualizar una herramienta: cambia versión, URL y sha256 en el manifiesto (tomando el sha256 publicado por el proyecto), ejecuta `npm run tools:fetch` y `npm test`.

## Licencias y código fuente

Ver `THIRD_PARTY_NOTICES.md`. El código fuente de cada herramienta está enlazado en la etiqueta exacta de la versión incluida. El del JDK está en https://github.com/adoptium/jdk25u/tree/jdk-25.0.5+8.
