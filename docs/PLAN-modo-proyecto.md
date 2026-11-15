# Plan: modo «Proyecto» en REA Studio

Estado: aprobado por Miguel el 15/11/2026 y en implementación por fases (PR encadenados). Base: `main` en 126f1a7.

**Decisiones de Miguel (15/11/2026):**
- El «Modo autónomo» entra desde la primera versión. Es una casilla desactivada por defecto. Cuando está activada, los comandos permitidos se ejecutan sin preguntar, salvo los que instalan paquetes.
- Plantillas iniciales: Node, Python, .NET (C#) y C/C++ con CMake.
- Instalar paquetes (npm install, pip install, dotnet add package, etc.) siempre pide confirmación, también en modo autónomo.

## 1. Qué es

Es una pantalla nueva, «Proyecto», en la barra lateral. Ahí el modelo local elegido en el proveedor «OpenAI compatible» (Ollama, por ejemplo `hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M`) trabaja dentro de una carpeta local de proyecto:

1. Crea y modifica los archivos de una aplicación nueva.
2. Ejecuta la compilación o las pruebas con comandos de una lista permitida.
3. Lee los errores y propone correcciones.
4. Usa como referencia lo que se sacó en el análisis (salidas de REA, Ghidra, `strings` y `metadata` que ya guarda la carpeta de trabajo en `jobs/<id>/`).

Lo que no hace:

- No ejecuta el binario analizado ni código del artefacto original.
- No usa proveedores en la nube en este modo. Solo el compatible en localhost. Más adelante se podría abrir a otros proveedores con la misma confirmación de envío que ya tiene «Conversación».
- No copia el binario original al proyecto.

## 2. Arquitectura

Sigue el patrón actual: la lógica va en `src/core`, el proceso principal en `electron/main`, el puente en `electron/preload` y la interfaz en `src/renderer`. El renderer no toca ni la red ni el disco.

### 2.1 Módulos nuevos en `src/core`

| Módulo | Responsabilidad |
|---|---|
| `project.ts` | Crear y abrir proyectos y guardar su manifiesto `rea-proyecto.json` (nombre, fecha, plantilla, artefactos de referencia, comandos permitidos del proyecto). Inicia el git local. |
| `project-fs.ts` | Leer, escribir y listar dentro de la raíz del proyecto. Reutiliza `assertInside` y `realpath` de `paths.ts`, como ya hacen `artifacts:read` y `loadContext`. |
| `project-exec.ts` | Ejecutar comandos permitidos con `runProcess` (`process.ts`): tiempo máximo, mata el árbol de procesos con `killTree`, entorno filtrado con `allowedEnv` y `cwd` siempre dentro del proyecto. |
| `project-git.ts` | Git local: `init`, un commit por cada paso aceptado, `diff`, deshacer el último paso (`git revert` o `reset` a un commit del propio agente, nunca sobre trabajo del usuario sin confirmar). |
| `agent.ts` | Bucle del agente: prompt de sistema, historial, llamadas a herramientas, límites de pasos y de contexto. No tiene red propia: recibe una función `chat()` que habla con Ollama. |
| `agent-tools.ts` | Definición y validación (zod) de las herramientas que el modelo puede pedir. |
| `analysis-context.ts` | Convierte las salidas del análisis en una ficha de referencia compacta (ver §4). |

### 2.2 IPC (todo validado con zod en `ipc-schemas.ts`)

| Canal | Payload | Respuesta |
|---|---|---|
| `project:create` | `{ name, parentDir, template, artifactRels[] }` | estado del proyecto |
| `project:open` | `{ path }` | estado del proyecto |
| `project:tree` | `{}` | árbol (hasta un límite de entradas; ver §5) |
| `project:read` | `{ relativePath }` | vista previa de texto (reutiliza `readTextPreview`) |
| `project:diff` | `{ stepId? }` | diff unificado |
| `project:undo` | `{ stepId }` | estado |
| `agent:start` | `{ goal, autonomous }` | `{ runId }` |
| `agent:approve` | `{ runId, callId, decision: 'aceptar' \| 'rechazar' }` | `{}` |
| `agent:cancel` | `{ runId }` | `{}` |
| evento `agent:event` | `{ kind: 'mensaje' \| 'herramienta' \| 'pide-permiso' \| 'salida' \| 'fin', ... }` | — |

Igual que ahora: `assertSender` comprueba el origen, `ZodError` se traduce a «Los datos enviados no son válidos.», y los textos de error y los registros pasan por `scrubForLog`.

### 2.3 Bucle del agente

```
objetivo del usuario
  → prompt de sistema + ficha del análisis + árbol del proyecto (resumido)
  → modelo (POST <ollama>/api/chat o /v1/chat/completions, en localhost)
  → si pide herramienta: validar con zod → (¿necesita permiso?) → ejecutar → devolver resultado
  → repetir hasta «fin», el límite de pasos, cancelación o error
```

Herramientas:

| Herramienta | Qué hace | ¿Permiso? |
|---|---|---|
| `listar(ruta)` | Lista un directorio del proyecto. | No |
| `leer(ruta, desde?, hasta?)` | Lee un archivo de texto (por trozos si es largo). | No |
| `escribir(ruta, contenido)` | Crea o reemplaza un archivo. Se muestra como diff propuesto. | Sí, salvo en modo autónomo |
| `editar(ruta, buscar, reemplazar)` | Cambio puntual. Es más barato en contexto que reescribir el archivo entero. | Sí, salvo en modo autónomo |
| `ejecutar(comando, args[])` | Comando de la lista permitida (§3.2). | Sí, salvo en modo autónomo para los de la lista |
| `ver_diff()` | Diff de lo cambiado desde el último commit. | No |
| `referencia(consulta)` | Busca en la ficha del análisis (funciones, cadenas, importaciones). | No |
| `fin(resumen)` | Termina el paso con un resumen para el usuario. | No |

Protocolo con el modelo:

- Primera opción: llamadas a herramientas nativas de Ollama (`tools` en `/api/chat`).
- Si el modelo o su plantilla GGUF no las soporta bien, se pasa a una alternativa: el modelo responde con un bloque JSON `{"herramienta": ..., "argumentos": ...}` que se valida con zod. Si el JSON no es válido, se le devuelve el error y se reintenta un número limitado de veces.
- **Hay que comprobar en la torre** cuál de las dos funciona con el Qwen 9B de Huihui. No está medido.

Cada paso aceptado hace un commit local («REA agente: <resumen>»). Así «Deshacer» es exacto.

## 3. Seguridad

### 3.1 Sistema de archivos

- **Rutas:** toda ruta pasa por `assertInside(raizReal, ruta)`, después `realpath` y otra vez `assertInside`. Esto bloquea `..`, rutas absolutas y enlaces simbólicos o *junctions* que salgan del proyecto.
- **Carpetas que no se tocan:** `.git/` no se lee ni se escribe con las herramientas del agente. Solo `project-git.ts` lo maneja.
- **Límites de escritura:** un tamaño máximo por archivo, una lista de extensiones de texto y ningún ejecutable o binario escrito por el modelo.
- **Ubicación:** el proyecto no puede estar dentro de la carpeta de trabajo de análisis ni contenerla, para no mezclar artefactos originales con código nuevo. Las salidas del análisis se leen por la ficha (§4), no copiando archivos.

### 3.2 Comandos permitidos

- **Lista por defecto, editable por proyecto en Ajustes:**
  - `npm`, solo para `test`, `run <script>`, `ci`, `install` (`npx` se queda fuera, porque descarga y ejecuta paquetes arbitrarios);
  - `node`;
  - `dotnet`, para `build`, `test`, `run`, `restore`;
  - `python` / `py` / `pytest`;
  - `cmake`, `ctest`, `ninja`, `make`;
  - `cargo`, para `build`, `test`, `check`;
  - `go`, para `build`, `test`, `vet`;
  - `git`, solo `status`, `diff` y `log`, porque los commits los hace REA.
- **Sin shell:** nunca se pasa por shell. Se usa `planLaunch` y `assertArg` (`command.ts`), sin `cmd /c` con texto libre y sin `&&`, `|`, `>` ni comodines. El ejecutable se resuelve con `findOnPath` y su nombre se valida con `assertCommandBasename`.
- **Confirmación:**
  - Por defecto, cada `ejecutar` y cada escritura muestran un diálogo con el comando exacto, la carpeta y el tiempo máximo.
  - Con la casilla **«Modo autónomo»** activada, se ejecutan sin preguntar los comandos de la lista y las escrituras dentro del proyecto.
  - Fuera de la lista, siempre se pregunta, también en modo autónomo. En la primera versión, se rechaza directamente.
  - La casilla se apaga sola al cerrar el proyecto.
- **Límites de ejecución:** tiempo máximo por comando, un solo comando a la vez, la salida recortada a un tamaño máximo para el modelo (el registro completo se guarda en disco) y botón «Detener» que mata el árbol de procesos.

### 3.3 Red

- **Agente:** solo habla con `localhost` (el endpoint de Ollama ya validado con `ollamaBaseFromEndpoint`).
- **Comandos:** no se pueden bloquear a nivel de sistema sin tocar el cortafuegos (y no se toca). Lo que se hace:
  - `npm install`, `dotnet restore`, `pip install` y `cargo` solo se permiten con confirmación explícita, incluso en modo autónomo, y el diálogo dice que bajan paquetes del registro público (npmjs, NuGet, PyPI, crates.io);
  - el resto de comandos de la lista no deberían necesitar red, pero no hay garantía técnica. Se dice así en la interfaz.
- **Sin descargas fuera del registro:** no hay herramienta de descarga ni `curl` o `wget` en la lista.
- **Revisión de dependencias:** antes de un `install`, REA muestra el diff de `package.json` (o del equivalente) para que el usuario vea qué dependencias añade el modelo.

### 3.4 Deshacer

- **Git local:** git local obligatorio. Si no hay `git` en PATH, el modo no arranca y lo explica.
- **Un commit por paso:** cada paso del agente hace un commit. «Deshacer este paso» revierte ese commit.
- **Volver al inicio:** «Volver al inicio» vuelve al commit de creación del proyecto, con confirmación.
- **Cambios del usuario:** si el usuario edita archivos fuera de REA, se detecta con `git status` y se le pide que los confirme o los descarte antes de seguir, para no mezclarlos.

### 3.5 Uso responsable

- **Aviso de autorización:** se mantiene el aviso actual («Solo archivos que tengas autorización para examinar»).
- **Sin código copiado:** el modo trabaja con lo que el análisis describe (nombres de funciones, cadenas, formatos, importaciones), no con código desensamblado copiado. La ficha de referencia no incluye bytes ni pseudocódigo completo.

## 4. Contexto del análisis al proyecto

**Qué hay hoy en el repo:**

- **REA:** salidas JSON por acción (`analyze`, `analyze-javascript`, `inspect-pe-imports`, `inspect-managed`, `inspect-go`, `inspect-rust`, `inspect-python-pyc`, etc.).
- **Ghidra:** `ghidra-summary.json` con nombre, lenguaje, compilador, base, formato, número de funciones y **hasta 200** funciones (nombre y dirección de entrada), con `truncated` si hay más. **No exporta estructuras ni tipos.**
- **strings:** `strings.txt`.
- **metadata:** `metadata.json`.

**Plan:**

1. Al crear el proyecto se eligen artefactos de la pestaña «Artefactos», con el mismo selector que usa «Conversación».
2. `analysis-context.ts` genera `referencia/ficha.md` y `referencia/ficha.json` dentro del proyecto:
   - resumen del binario (formato, lenguaje, compilador);
   - funciones con su nombre, priorizando las que no son genéricas (`FUN_…`);
   - importaciones agrupadas por biblioteca;
   - cadenas filtradas: rutas, mensajes de error, formatos, URLs y claves de configuración, sin duplicados;
   - de dónde sale cada dato, con el artefacto y el trabajo de origen.
3. **Estructuras:** hace falta un script nuevo de Ghidra (por ejemplo `ExportTypes.java`) que exporte los tipos y estructuras definidos (nombre, campos, tamaños). Es una fase aparte (fase 4). Hasta entonces la ficha dice que no hay estructuras.
4. **Uso por el agente:** la ficha completa no se manda entera en cada turno. El agente recibe un resumen corto y usa `referencia(consulta)` para pedir detalles. Es una búsqueda por texto en `ficha.json`, sin embeddings en la primera versión.
5. **Regenerar la ficha:** si hay análisis nuevos, «Actualizar referencia» regenera la ficha y hace commit.

## 5. Límites con 16 GB de RAM y modelos de 9B

**Hechos conocidos:**

- **Tamaño de los modelos:** el Qwen3.5 9B Q4_K_M ocupa 5.627.045.248 bytes en disco y el 4B Q4_K_M 2.707.514.688 bytes (catálogo de Sopa, revisión 9). El 27B UD-IQ3_XXS ocupa 11.021.122.464 bytes y el catálogo lo pone como perfil de 12 GB.
- **Medidas pendientes:** ni el consumo real de RAM y VRAM con Ollama ni el rendimiento del Qwen 9B de Huihui están medidos en la torre. El catálogo dice «Aún no está medida».
- **RAM libre en la torre:** el 15/11/2026 había entre 2,8 y 3,6 GB de RAM libre con el uso normal (Ollama, REA y otras apps), según las comprobaciones de hoy.

**Decisiones de diseño:**

- **Contexto acotado:** el contexto que se envía tiene un tamaño máximo configurable. El valor por defecto se fija **después de medir** en la torre. Hasta entonces se usa el de Ollama.
- **Prompt compacto:** árbol resumido, la ficha solo bajo demanda, archivos leídos por trozos y salida de comandos recortada al principio y al final del error.
- **Un modelo a la vez:** REA no arranca ni para modelos. Usa el que tenga Ollama. Si el modelo elegido no está instalado, lo dice (como hace el selector del PR #3).
- **Límite de pasos:** un número máximo de pasos por objetivo y un número máximo de reintentos por error de compilación. Al llegar al límite se para y se pregunta.
- **No compilar con el modelo cargado si falta RAM:** antes de `ejecutar`, REA mira la RAM libre (`os.freemem()`). Si baja de un umbral configurable, avisa. No se inventa un umbral: se fija tras las mediciones.
- **Expectativas:** un 9B cuantizado comete más errores en tareas largas. La interfaz recomienda objetivos pequeños («añade la función X y su prueba») frente a «haz la aplicación entera».

## 6. Fases

| Fase | Contenido | Aceptación |
|---|---|---|
| 0. Medición | En la torre, con permiso: cargar el Qwen 9B en Ollama, medir RAM, VRAM, primer token y tokens/s con contextos de distintos tamaños, y probar si funcionan las herramientas nativas de Ollama o hace falta el JSON. | Tabla con cifras medidas en `docs/`. Decide el contexto por defecto y el protocolo. |
| 1. Proyecto y archivos | `project.ts`, `project-fs.ts`, `project-git.ts`, IPC `project:*`, pantalla con el árbol y el visor. Sin agente. | Crear, abrir, listar, leer y deshacer con git. Pruebas de escape de ruta. |
| 2. Comandos | `project-exec.ts`, lista permitida, diálogo de confirmación, panel de salida y «Detener». | Ejecuta `npm test` en un proyecto de ejemplo. Rechaza comandos fuera de la lista y operadores de shell. Mata el árbol al cancelar. |
| 3. Agente | `agent.ts` y `agent-tools.ts`, chat, diff propuesto, aceptar o rechazar, modo autónomo y límites. | Con Ollama simulado en las pruebas: el ciclo escribir → ejecutar → leer error → corregir termina. En la torre: un objetivo pequeño en una plantilla Node y otro en Python. |
| 4. Referencia del análisis | `analysis-context.ts`, ficha, herramienta `referencia` y `ExportTypes.java` para estructuras. | La ficha se genera desde salidas de prueba (fixtures) de REA, Ghidra y strings. El agente la consulta en un caso de prueba. |
| 5. Pulido | Plantillas (Node, Python, .NET, CMake), textos y capturas. | Capturas aprobadas por Miguel antes de fusionar. |

Cada fase va en un PR propio, con su sí antes de fusionar.

## 7. Pruebas

- **Unitarias (vitest, sin Ollama ni herramientas reales), como ya hacen `tests/core.test.ts` y `tests/ollama.test.ts`:**
  - rutas: `..`, absolutas, enlaces simbólicos o *junctions* fuera, `.git/`, nombres de Windows reservados (`CON`, `NUL`) y mayúsculas en Windows;
  - comandos: lista permitida, subcomandos, rechazo de `&&`, `|`, `>`, `;`, comillas raras, y `cwd` fuera del proyecto;
  - zod: cada canal IPC y cada herramienta del agente rechaza campos extra y tipos erróneos;
  - el bucle del agente con un `chat()` simulado que pide herramientas, devuelve JSON inválido, se pasa del límite de pasos o se cancela a mitad;
  - git: un commit por paso, deshacer exacto, detección de cambios del usuario.
- **Interfaz (happy-dom + Testing Library):** diálogo de confirmación, casilla de modo autónomo, diff propuesto, panel de errores y árbol.
- **E2E en la torre (manual y con permiso):** un proyecto Node con una prueba que falla a propósito, para que el agente la corrija. Se mide el tiempo y si lo consigue, sin inventar cifras previas.
- **Sin borrar pruebas críticas existentes.**

## 8. Preguntas abiertas

Resueltas: ver «Decisiones de Miguel» al principio.
