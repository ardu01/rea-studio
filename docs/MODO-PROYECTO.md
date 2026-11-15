# Modo «Proyecto»

El modo Proyecto sirve para escribir un programa propio a partir de lo aprendido en un análisis, con ayuda de un modelo que corre en tu equipo (Ollama). El código vive en una carpeta aparte del espacio de trabajo del análisis, con su propio git.

## Crear o abrir un proyecto

- **Proyecto › Nuevo proyecto**: eliges un nombre (minúsculas, números, `.`, `_` o `-`), la carpeta donde se crea y una plantilla.
- **Plantillas**: Node.js, Python, .NET (C#) o C/C++ con CMake. Ninguna trae dependencias.
- **Git**: hace falta git en PATH. Se crea un repositorio local con un primer commit, y REA Studio firma sus commits como `REA Studio <rea-studio@localhost.invalid>`. No se configura ningún remoto ni se sube nada.
- **Artefactos de referencia** (opcional): salidas del análisis (resumen y tipos de Ghidra, cadenas, metadatos, JSON de importaciones). Con ellos se genera la ficha (ver más abajo).
- **Abrir**: un proyecto existente se abre eligiendo la carpeta que contiene `rea-proyecto.json`.

## Pestañas

| Pestaña | Para qué |
| --- | --- |
| Agente | Le das un objetivo al modelo local y revisas cada paso. |
| Comandos | Lanzas a mano compilar, probar o ejecutar, con la salida en vivo. |
| Referencia | Ves y regeneras la ficha del análisis. |
| Archivo | Lees un archivo del árbol. |
| Cambios | Diff de lo que aún no tiene commit. |
| Historial | Pasos con commit. Puedes deshacer un paso concreto o volver al inicio. |

## Comandos

- **Sin shell**: se lanza el ejecutable directamente. No valen `&&`, `|`, `>`, `;`, `$`, `%` ni comillas, y las rutas de los argumentos no pueden salir de la carpeta del proyecto.
- **Programas permitidos**: `npm`, `node`, `python`/`py`, `pytest`, `pip`, `dotnet`, `cmake`, `ctest`, `ninja`, `make`, `cargo`, `go` y `git` (solo lectura: status, diff, log). `npx` no está porque descarga y ejecuta paquetes arbitrarios.
- **Confirmación**: cada comando pide permiso antes de ejecutarse.
- **Instalar paquetes** (`npm install`, `pip install`, `dotnet add package`, `cargo add`…) **siempre** pide permiso, también en modo autónomo. `pip` solo instala dentro de un entorno virtual del proyecto.
- **Registros**: la salida completa se guarda en `.rea/salidas/`, que no entra en git.

## Agente

- **Modelo**: usa el proveedor «OpenAI compatible» de Ajustes, que tiene que apuntar a localhost (Ollama en `http://127.0.0.1:11434`). Si el endpoint no es local, el agente no arranca.
- **Herramientas**: `listar`, `leer`, `escribir`, `editar`, `ejecutar`, `ver_diff`, `referencia` y `fin`. Si el modelo no admite llamadas a herramientas, REA Studio le pide las mismas llamadas en JSON dentro del texto.
- **Cambios**: cada escritura enseña su diff antes de aplicarse, y cada cambio aceptado o comando ejecutado es un commit. Lo puedes deshacer en «Historial».
- **Modo autónomo** (apagado por defecto, se apaga al abrir o cerrar un proyecto): escribe archivos y ejecuta comandos permitidos sin preguntar. Instalar paquetes sigue preguntando.
- **Archivos protegidos**: el agente no puede escribir `.bat`, `.cmd`, `.ps1`, `.sh` ni ejecutables, ni tocar `.git`, `.rea`, `rea-proyecto.json` o `referencia/`.
- **Límites** (provisionales hasta medir en el equipo): 25 pasos por objetivo, 3 llamadas inválidas seguidas y unos 48 000 caracteres de contexto. Los resultados antiguos se recortan.

## Ficha del análisis

- **Contenido**: la ficha (`referencia/ficha.md` y `referencia/ficha.json`) resume el programa analizado: formato, arquitectura, funciones con nombre, importaciones y exportaciones, tipos (structs, unions y enums) y cadenas legibles.
- **Uso**: el agente la consulta con la herramienta `referencia` y recibe un resumen al empezar. Es una guía; no se copia código desensamblado.
- **Rutas de usuario**: se quitan (`C:\Users\<usuario>`, `/home/<usuario>`).
- **Tipos de Ghidra**: salen de `ExportTypes.java`, que se ejecuta junto a `ExportSummary.java` en la acción «Importar y resumir» de Ghidra. Los análisis hechos antes de este cambio no tienen `ghidra-types.json`; repite la acción para obtenerlo.

## Medir el modelo (fase 0)

`scripts/medir-fase0.ps1` mide en Windows un modelo ya instalado en Ollama:

- tokens por segundo con varios `num_ctx`;
- RAM libre, VRAM y temperatura (con `nvidia-smi`);
- si el modelo responde con llamadas a herramientas.

Cómo se comporta:

- **Antes de cargar nada**: no hace nada sin `-Confirmo`, no descarga modelos y se para si ya hay un modelo cargado o si la RAM libre baja de `-MinFreeGB`.
- **Al terminar**: descarga el modelo de la memoria.
- **Resultados**: `medidas-fase0-<fecha>/resultados.json` y `resultados.csv`. Con esas cifras se ajustarán los límites del agente.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\medir-fase0.ps1 `
  -Model "hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M" -Confirmo
```
