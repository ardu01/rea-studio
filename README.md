# REA Studio | Software Analysis & AI Workstation

### Understand software. Explore its structure. Stay in control.

**Entorno de escritorio para análisis estático de software, inspección de archivos binarios e integración de herramientas de ingeniería inversa e inteligencia artificial, desarrollado por Miguel Rodríguez Saiz dentro de Ardu Solutions.**

[![Version](https://img.shields.io/badge/Version-0.1.0-2563EB?style=flat-square)](https://github.com/ardu01/rea-studio)
![Status](https://img.shields.io/badge/Status-Preview-F59E0B?style=flat-square)
![Windows](https://img.shields.io/badge/Platform-Windows_x64-0078D4?style=flat-square&logo=windows&logoColor=white)
![macOS](https://img.shields.io/badge/Platform-macOS_Intel_x86__64-000000?style=flat-square&logo=apple&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-45-47848F?style=flat-square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-16A34A?style=flat-square)

**[Repositorio](https://github.com/ardu01/rea-studio) · [Publicaciones](https://github.com/ardu01/rea-studio/releases) · [Portfolio](https://ardu01.github.io/proyectos/) · [Ardu Solutions](https://ardusolutions.pages.dev/)**

---

## Índice

1. [Introducción](#01-introducción)
2. [Visión del proyecto](#02-visión-del-proyecto)
3. [Interfaz de usuario](#03-interfaz-de-usuario)
4. [Características principales](#04-características-principales)
5. [Motor de análisis local](#05-motor-de-análisis-local)
6. [Integración con REA](#06-integración-con-rea)
7. [Integración con Ghidra](#07-integración-con-ghidra)
8. [radare2 y Rizin](#08-radare2-y-rizin)
9. [Inteligencia artificial](#09-inteligencia-artificial)
10. [Integración de agentes CLI](#10-integración-de-agentes-cli)
11. [Privacidad y autorización](#11-privacidad-y-autorización)
12. [Gestión de trabajos](#12-gestión-de-trabajos)
13. [Arquitectura y tecnologías](#13-arquitectura-y-tecnologías)
14. [Instalación en Windows](#14-instalación-en-windows)
15. [Instalación en macOS Intel](#15-instalación-en-macos-intel)
16. [Configuración](#16-configuración)
17. [Desarrollo y compilación](#17-desarrollo-y-compilación)
18. [Pruebas y validación](#18-pruebas-y-validación)
19. [Estado de compatibilidad](#19-estado-de-compatibilidad)
20. [Limitaciones conocidas](#20-limitaciones-conocidas)
21. [Hoja de ruta](#21-hoja-de-ruta)
22. [Preguntas frecuentes](#22-preguntas-frecuentes)
23. [Licencias y atribuciones](#23-licencias-y-atribuciones)
24. [Autor y organización](#24-autor-y-organización)

---

## 01. Introducción

**REA Studio** es una aplicación de escritorio destinada a centralizar herramientas de inspección y análisis estático de software dentro de una interfaz gráfica.

El proyecto combina herramientas tradicionales de análisis binario con capacidades de inteligencia artificial, permitiendo realizar operaciones locales, consultar resultados y utilizar asistentes para interpretar la información obtenida.

Su objetivo es simplificar el acceso a herramientas técnicas que habitualmente requieren conocimientos de terminal, configuración de dependencias y manejo de múltiples aplicaciones.

REA Studio no pretende sustituir los motores originales de análisis, sino proporcionar un entorno que facilite su utilización conjunta.

### Información general

| Campo | Información |
|---|---|
| Proyecto | REA Studio |
| Desarrollador | Miguel Rodríguez Saiz |
| Organización | Ardu Solutions |
| Categoría | Análisis de Software / Herramientas de Desarrollo |
| Versión | 0.1.0 |
| Estado | Vista previa experimental |
| Plataforma de distribución | Windows x64 y macOS Intel (x86_64) |
| Entornos de desarrollo | Windows y Linux |
| Framework | Electron |
| Interfaz | React |
| Lenguaje | TypeScript |
| Compilación | Electron Vite |
| Pruebas | Vitest |
| Licencia | MIT |

### Alcance

REA Studio está orientado al análisis de archivos y aplicaciones que el usuario tenga autorización para examinar.

Las funciones de inspección estática documentadas no ejecutan los binarios analizados.

La aplicación tampoco necesita permisos de administrador para sus operaciones habituales ni desactiva mecanismos de protección del sistema operativo.

## 02. Visión del proyecto

### Una estación de trabajo para comprender software

El análisis de aplicaciones puede implicar varias herramientas especializadas, cada una con su propio sistema de instalación y funcionamiento.

REA Studio busca reunir esas capacidades mediante una experiencia de escritorio unificada.

### Principios de desarrollo

**Análisis local**

Priorizar operaciones realizadas en el propio ordenador.

**Integración modular**

Utilizar herramientas externas mediante adaptadores independientes.

**Transparencia**

Mostrar qué herramientas están disponibles y cuáles no.

**Control del usuario**

Solicitar autorización antes de enviar información a servicios de inteligencia artificial.

**Reproducibilidad**

Conservar registros y artefactos que permitan consultar los resultados de cada trabajo.

**Seguridad**

Evitar la ejecución innecesaria de archivos analizados y limitar las operaciones sobre el sistema.

**Extensibilidad**

Preparar una arquitectura que permita incorporar nuevas herramientas en versiones posteriores.

### Objetivo a largo plazo

Desarrollar un entorno de análisis técnico capaz de integrar herramientas de inspección binaria, análisis de código, generación de informes y asistencia mediante inteligencia artificial.

La versión 0.1.0 constituye la base inicial de esta plataforma.

## 03. Interfaz de usuario

REA Studio dispone de una interfaz de escritorio diseñada para organizar las herramientas y los resultados del análisis.

La navegación principal se divide en seis apartados.

| Sección | Función |
|---|---|
| Inicio | Estado general y trabajos recientes |
| Herramientas | Detección y configuración |
| Trabajos | Ejecución y seguimiento |
| Artefactos | Consulta de resultados |
| Conversación | Integración con modelos y agentes |
| Ajustes | Configuración de proveedores y preferencias |

### Capturas reales

Las siguientes capturas corresponden a la interfaz original del proyecto.

Se obtuvieron en Linux durante un análisis local del archivo de prueba `tests/fixtures/sample.bin`.

En ese entorno no estaban instalados REA ni Ghidra, y tampoco había credenciales de proveedores de IA. La interfaz refleja esa situación sin presentar conexiones simuladas como si fueran reales.

### Panel de inicio

![Inicio, con dos trabajos locales terminados](docs/screenshots/inicio.png)

*Panel de inicio con información del espacio de trabajo, proveedores y trabajos recientes.*

La pantalla principal proporciona acceso a la actividad del proyecto y al estado de sus componentes.

### Gestión de herramientas

![Herramientas no encontradas, sin marcarlas como listas](docs/screenshots/herramientas.png)

*Detección de herramientas externas y presentación de su disponibilidad real.*

REA Studio diferencia las herramientas configuradas de aquellas que no están instaladas o no se han comprobado correctamente.

### Trabajos de análisis

![Trabajo de metadatos con hash y tipo](docs/screenshots/trabajos.png)

*Ejecución y seguimiento de trabajos, con información técnica del archivo analizado.*

Los registros permiten consultar los resultados y el estado de las operaciones.

### Artefactos

![Artefactos generados en la carpeta](docs/screenshots/artefactos.png)

*Explorador de resultados generados por los trabajos.*

Los archivos de texto pueden consultarse desde la interfaz. Los binarios no se ejecutan ni se previsualizan como aplicaciones.

### Conversación con inteligencia artificial

![Conversación: el resumen aparece antes de enviar](docs/screenshots/conversacion.png)

*Interfaz de conversación con revisión previa del contenido que se enviará al proveedor.*

La autorización del usuario es obligatoria antes de realizar el envío.

### Configuración

![Ajustes sin clave y con el cifrado del sistema no disponible](docs/screenshots/ajustes.png)

*Configuración de modelos, endpoints y credenciales, con información sobre la disponibilidad del almacenamiento cifrado.*

REA Studio no guarda claves en texto plano cuando el sistema no proporciona un mecanismo de almacenamiento seguro compatible.

## 04. Características principales

### Inspección de archivos

REA Studio permite analizar información estructural de archivos sin ejecutarlos.

Entre las capacidades documentadas se encuentran:

- Obtención de metadatos.
- Cálculo de SHA-256.
- Identificación de determinados formatos.
- Extracción de cadenas de texto.
- Conservación de registros.
- Generación de artefactos.
- Consulta de resultados.

### Herramientas externas

La aplicación incorpora adaptadores para:

- REA.
- Ghidra headless.
- radare2.
- Rizin.

Cada integración depende de que la herramienta correspondiente esté instalada y configurada.

### Inteligencia artificial

El sistema incorpora conectores para proveedores de modelos de lenguaje y agentes CLI.

Permite preparar conversaciones con información obtenida durante los análisis.

### Gestión de trabajos

Los trabajos admiten:

- Inicio de procesos.
- Registros durante la ejecución.
- Cancelación.
- Límites de tiempo.
- Persistencia de resultados.
- Exploración de artefactos.

### Seguridad

La aplicación contempla:

- Restricciones de rutas.
- Protección frente a determinados argumentos peligrosos.
- Ejecución controlada de herramientas.
- Protección de credenciales.
- Consentimiento explícito para comunicaciones externas.

## 05. Motor de análisis local

REA Studio proporciona herramientas que pueden funcionar sin instalar motores externos de ingeniería inversa.

### Extracción de cadenas

Permite identificar secuencias de texto presentes en archivos binarios.

Esta información puede ayudar a localizar cadenas legibles, mensajes, nombres de componentes y otros datos incorporados en un archivo.

La presencia de una cadena no demuestra por sí misma que represente una funcionalidad ejecutable.

### Metadatos

La aplicación permite consultar información técnica del archivo seleccionado.

Entre los datos disponibles se encuentran:

- Ruta.
- Tipo reconocido.
- Tamaño.
- Firma de formato.
- Hash SHA-256.

### Identificación de formatos

La implementación se ha probado con un archivo de muestra que contiene una firma de tipo PE/DOS.

El sistema reconoce la marca:

`PE/DOS (MZ)`

### Integridad

El cálculo SHA-256 permite obtener una identificación criptográfica del contenido del archivo.

Puede utilizarse para comparar dos copias o verificar que un archivo no ha cambiado entre análisis.

Un hash no determina si el contenido es seguro o legítimo.

### Funcionamiento

Las herramientas locales leen los archivos y generan resultados sin ejecutar el binario inspeccionado.

Este comportamiento constituye una característica esencial del diseño de seguridad de la aplicación.

## 06. Integración con REA

### Reverse Engineering Assistant

REA es un proyecto externo que proporciona herramientas de análisis de software.

Repositorio original:

https://github.com/morluto/rea

Paquete npm:

`rea-agents`

### Funciones integradas

REA Studio incorpora un adaptador para utilizar operaciones documentadas de REA.

Entre ellas:

| Comando | Área |
|---|---|
| `analyze` | Análisis general |
| `analyze-javascript-application` | Aplicaciones JavaScript |
| `providers` | Proveedores disponibles |
| `capabilities` | Capacidades del sistema |
| `doctor` | Diagnóstico |
| `inspect-go-binary` | Binarios Go |
| `inspect-pe-imports` | Importaciones PE |
| `inspect-pe-certificates` | Certificados PE |
| `inspect-elf-notes` | Información ELF |
| `inspect-rust-binary` | Binarios Rust |
| `inspect-managed-artifact` | Ensamblados administrados |
| `inspect-python-pyc` | Archivos Python compilados |

### Instalación

REA requiere Node.js y sus dependencias correspondientes.

Instalación mediante npm:

```bash
npm install --global rea-agents
```

### Disponibilidad

REA Studio verifica la configuración de las herramientas y muestra su estado.

Si REA no está disponible, la interfaz no lo presenta como conectado.

### Validación

Las pruebas automatizadas verifican la construcción de comandos y el funcionamiento del adaptador utilizando ejecutables sustitutos.

**La versión documentada no incluye una validación completa contra una instalación real de REA en el entorno de compilación.**

### Dependencias

REA mantiene su propio sistema de proveedores y dependencias.

Determinadas operaciones pueden necesitar herramientas adicionales.

## 07. Integración con Ghidra

### Ghidra headless

REA Studio incorpora un adaptador para ejecutar análisis sin interfaz gráfica mediante Ghidra.

Ghidra es una plataforma de ingeniería inversa desarrollada por la National Security Agency y publicada como software de código abierto.

Repositorio oficial:

https://github.com/NationalSecurityAgency/ghidra

### Funcionamiento

La integración utiliza el componente:

`analyzeHeadless`

El procedimiento contempla:

- Creación de un proyecto temporal.
- Importación del archivo.
- Ejecución del análisis.
- Generación de resultados.
- Exportación de un resumen.
- Eliminación del proyecto temporal.
- Aplicación de límites de tiempo.

### Script de exportación

REA Studio incorpora un script específico:

`ExportSummary.java`

Su función es facilitar la generación de un resumen a partir de los resultados del análisis.

### Limitaciones

La implementación documentada limita el resumen a un máximo de 200 funciones.

El script no se compiló contra `ghidra.jar` durante la validación inicial.

### Requisitos

La documentación de la versión 0.1.0 contempla:

- Ghidra 11.
- JDK 21.
- Configuración de la ubicación de Ghidra.

### Instalación

Descargar Ghidra desde sus fuentes oficiales:

https://ghidra-sre.org/

Para el JDK puede utilizarse una distribución compatible, como Eclipse Temurin:

https://adoptium.net/

### Validación

El adaptador se ha probado mediante un lanzador sustituto.

No debe interpretarse como una validación completa del funcionamiento de Ghidra en Windows.

## 08. radare2 y Rizin

REA Studio también incorpora adaptadores para dos herramientas de análisis de binarios.

### radare2

Proyecto:

https://github.com/radareorg/radare2

La integración documentada utiliza comandos como:

```bash
rabin2 -IijES -j
```

Y:

```bash
r2 -q -c "aa; afl; q"
```

### Rizin

Proyecto:

https://rizin.re/

La integración contempla:

- `rz-bin`.
- Ejecución de análisis mediante `rizin`.
- Consulta de funciones.
- Extracción de resultados.

### Alcance

Estas herramientas se utilizan para inspección y análisis.

La versión documentada no invoca comandos como `ood` o `dc` para ejecutar el programa analizado.

### Estado de compatibilidad

Los adaptadores están implementados, pero no se ejecutaron los binarios oficiales durante la validación inicial.

La compatibilidad completa depende de las versiones instaladas y de los formatos analizados.

## 09. Inteligencia artificial

REA Studio incorpora una sección de conversación que permite utilizar modelos de lenguaje para interpretar resultados técnicos.

La integración con inteligencia artificial es opcional.

### Proveedores

| Proveedor | Integración |
|---|---|
| OpenAI | API compatible con Chat Completions |
| Anthropic | API Messages |
| xAI | API compatible con Chat Completions |
| Google Gemini | API Gemini |
| Endpoint compatible | Servidores locales o compatibles |

### OpenAI

La implementación contempla solicitudes a:

`POST /v1/chat/completions`

Con streaming habilitado.

La comprobación de disponibilidad utiliza:

`GET /v1/models`

### Anthropic

La integración utiliza la API Messages.

Contempla respuestas en streaming.

### xAI

Se utiliza un endpoint compatible con el formato Chat Completions.

### Gemini

La integración utiliza `streamGenerateContent` mediante respuestas SSE.

La clave se transmite en una cabecera HTTP, no mediante parámetros de la URL.

### Modelos locales

REA Studio admite endpoints compatibles con la API de OpenAI.

Esto permite configurar determinados servidores locales, como Ollama.

Ejemplo:

`http://127.0.0.1:11434/v1`

El uso de un endpoint local puede evitar enviar información a proveedores remotos.

### Disponibilidad de modelos

Los identificadores configurados son ejemplos editables.

No se garantiza que todos los modelos estén disponibles en cualquier cuenta o momento.

El usuario debe seleccionar un modelo compatible con sus credenciales y proveedor.

### Costes

Algunas APIs comerciales cobran por uso.

La instalación de REA Studio no incluye necesariamente acceso gratuito a sus servicios.

La compilación inicial no realizó llamadas de pago a los proveedores.

## 10. Integración de agentes CLI

Además de APIs HTTP, REA Studio contempla herramientas de inteligencia artificial ejecutadas mediante interfaces de línea de comandos.

### OpenAI Codex

La integración utiliza un modo de ejecución no interactivo.

Entre sus parámetros documentados:

```bash
codex exec --json --ephemeral --sandbox read-only
```

El sistema evita utilizar modos de ejecución sin restricciones como `--yolo`.

### Claude Code

La integración contempla ejecución mediante:

`claude -p`

Con opciones de seguridad y planificación, incluyendo:

- Safe mode.
- Permission mode plan.
- Sin herramientas habilitadas para la operación documentada.
- Límite de un turno.

### Gemini CLI

Se utiliza un modo de ejecución con salida estructurada.

La configuración documentada contempla:

`gemini -p --approval-mode plan --skip-trust --output-format stream-json`

### Detección

REA Studio comprueba la presencia del ejecutable mediante operaciones de consulta de versión.

Estas comprobaciones no implican iniciar sesión ni enviar un mensaje al modelo.

### Costes y privacidad

Las herramientas CLI pueden utilizar sesiones autenticadas o proveedores remotos.

Por tanto, una operación en modo lectura no significa necesariamente que todo el procesamiento se realice localmente.

Las condiciones de coste y tratamiento de datos dependen de cada herramienta y de su configuración.

## 11. Privacidad y autorización

La privacidad es uno de los principios principales del proyecto.

### Análisis local

Los procesos de extracción de cadenas y metadatos funcionan en el ordenador del usuario.

Los archivos analizados no necesitan enviarse a un servidor remoto para estas operaciones.

### Consentimiento antes de enviar

Cuando se utiliza un proveedor de inteligencia artificial, REA Studio muestra previamente un resumen del contenido que se enviará.

El usuario debe marcar una casilla de autorización.

Sin esa confirmación, la operación no puede continuar por el flujo previsto.

### Credenciales

REA Studio utiliza el mecanismo `safeStorage` de Electron.

Las claves se guardan utilizando las capacidades de cifrado disponibles en el sistema operativo.

Si el cifrado seguro no está disponible, la aplicación evita almacenar las claves en texto plano.

### Endpoints

Los servicios remotos deben utilizar HTTPS.

El uso de HTTP se limita a destinos locales permitidos.

### Registros

Los resultados y registros de los trabajos se almacenan en la carpeta de trabajo configurada.

El usuario debe tratar estos archivos como información potencialmente sensible.

### Precauciones

- No compartir claves API.
- No incluir secretos en repositorios.
- Revisar el contenido antes de enviarlo.
- No publicar informes que contengan información confidencial.
- Proteger los archivos y artefactos de análisis.
- Mantener actualizadas las herramientas utilizadas.

## 12. Gestión de trabajos

REA Studio organiza las operaciones de análisis mediante trabajos independientes.

### Espacio de trabajo

El usuario selecciona una carpeta que se utiliza como ubicación principal del proyecto.

### Registros

Los trabajos generan información sobre su ejecución.

El sistema contempla:

- Identificación del trabajo.
- Herramienta utilizada.
- Estado.
- Registro de ejecución.
- Resultado.
- Artefactos asociados.

### Cancelación

Las operaciones pueden detenerse desde la aplicación.

### Tiempo límite

Los trabajos incorporan restricciones temporales para evitar procesos que permanezcan ejecutándose indefinidamente.

### Artefactos

Los resultados se organizan en el espacio de trabajo, dentro de directorios de trabajos.

La aplicación permite consultar artefactos de texto.

Los binarios no se ejecutan automáticamente desde este visor.

### Seguridad de rutas

La implementación contempla comprobaciones para evitar accesos indebidos fuera del espacio de trabajo.

También se comprueban determinadas secuencias y caracteres especiales utilizados en argumentos de procesos.

## 13. Arquitectura y tecnologías

REA Studio utiliza una aplicación Electron con frontend React y componentes de integración con herramientas externas.

### Componentes principales

**Electron Main Process**

Gestiona la aplicación de escritorio y las operaciones que requieren acceso al sistema.

**React Renderer**

Proporciona la interfaz gráfica.

**Adaptadores de herramientas**

Preparan los argumentos y gestionan la ejecución de las herramientas compatibles.

**Gestor de trabajos**

Organiza las operaciones de análisis y sus resultados.

**Integraciones de IA**

Gestionan comunicaciones con proveedores y herramientas CLI.

**Almacenamiento local**

Mantiene configuraciones, registros y artefactos.

### Tecnologías

| Tecnología | Función |
|---|---|
| Electron 45 | Aplicación de escritorio |
| React 19 | Interfaz |
| TypeScript 7 | Desarrollo tipado |
| Vite 8 | Herramientas de frontend |
| Electron Vite | Integración y compilación |
| Tailwind CSS 4 | Estilos |
| Radix UI | Componentes de interfaz |
| Zod | Validación estructurada |
| Lucide React | Iconografía |
| Vitest 5 | Pruebas |
| electron-builder | Distribución |
| NSIS | Instalador Windows |
| ZIP | Paquete macOS Intel (x86_64) |

### Arquitectura modular

La aplicación separa las herramientas de análisis de los proveedores de inteligencia artificial.

Esto permite utilizar determinadas funciones locales sin configurar ningún servicio de IA.

Las integraciones externas conservan sus propios requisitos, versiones y condiciones de uso.

## 14. Instalación en Windows

### Distribución

La versión 0.1.0 contempla un instalador Windows x64:

`REA-Studio-0.1.0-win-x64.exe`

### Descargas

Consultar:

**[GitHub Releases](https://github.com/ardu01/rea-studio/releases)**

La publicación debe incluir, cuando el workflow finaliza correctamente:

- Instalador NSIS.
- Archivo `SHA256SUMS`.
- Informe `INSTALL-VALIDATION.txt`.

### Verificación

Antes de instalar, se recomienda comprobar que el archivo procede de una publicación oficial y verificar su suma de comprobación.

Ejemplo en PowerShell:

```powershell
Get-FileHash .\REA-Studio-0.1.0-win-x64.exe -Algorithm SHA256
```

Comparar el resultado con la suma publicada para ese archivo.

### Instalación

1. Descargar la publicación correspondiente.
2. Verificar la integridad del instalador.
3. Ejecutar el archivo.
4. Completar el procedimiento NSIS.
5. Abrir REA Studio.
6. Seleccionar una carpeta de trabajo.
7. Configurar las herramientas externas necesarias.

### SmartScreen

El instalador de la versión documentada no está firmado digitalmente.

Windows SmartScreen puede mostrar advertencias.

El usuario debe verificar la procedencia e integridad del archivo antes de autorizar su ejecución.

### Dependencias

REA Studio no incluye automáticamente todas las herramientas externas.

REA, Ghidra, radare2, Rizin y las herramientas de inteligencia artificial deben instalarse y configurarse por separado cuando se necesiten.

## 15. Instalación en macOS Intel

### Distribución

La versión 0.1.0 contempla un paquete ZIP para macOS Intel (x86_64):

`REA-Studio-0.1.0-mac-x64.zip`

No incluye binario arm64 ni paquete universal.

### Requisitos

- Mac con procesador Intel (x86_64).
- macOS 13 o posterior.

### Descargas

Consultar:

**[GitHub Releases](https://github.com/ardu01/rea-studio/releases)**

El instalador Windows permanece en la publicación [v0.1.0](https://github.com/ardu01/rea-studio/releases/tag/v0.1.0). El ZIP de macOS Intel está en [v0.1.0-macos-x64](https://github.com/ardu01/rea-studio/releases/tag/v0.1.0-macos-x64).

La publicación de macOS debe incluir:

- Paquete ZIP.
- Archivo `SHA256SUMS`.

### Verificación

Antes de abrir la aplicación, se recomienda comprobar la suma de comprobación.

Ejemplo en Terminal:

```bash
shasum -a 256 REA-Studio-0.1.0-mac-x64.zip
cat SHA256SUMS
```

Comparar el resultado con la suma publicada para ese archivo.

### Instalación

1. Descargar la publicación correspondiente.
2. Verificar la integridad del ZIP.
3. Descomprimir el archivo.
4. Mover `REA Studio.app` a la carpeta Aplicaciones.
5. Abrir REA Studio.
6. Seleccionar una carpeta de trabajo.
7. Configurar las herramientas externas necesarias.

### Gatekeeper

El paquete de la versión documentada no está firmado ni notarizado.

macOS puede bloquear la primera apertura.

Si el sistema lo impide, usar clic secundario y Abrir. Si sigue bloqueado: Ajustes del Sistema → Privacidad y seguridad → Abrir de todas formas.

Si Gatekeeper continúa bloqueando la aplicación:

```bash
xattr -dr com.apple.quarantine "/Applications/REA Studio.app"
```

El usuario debe verificar la procedencia e integridad del archivo antes de autorizar su ejecución.

### Dependencias

REA Studio no incluye automáticamente todas las herramientas externas.

REA, Ghidra, radare2, Rizin y las herramientas de inteligencia artificial deben instalarse y configurarse por separado cuando se necesiten.

## 16. Configuración

REA Studio permite configurar proveedores, modelos, endpoints y ubicaciones de herramientas.

### Ejemplo de configuración

El siguiente fragmento representa parámetros no secretos.

```json
{
  "providers": {
    "openai": {
      "model": "gpt-4.1-mini",
      "endpoint": "https://api.openai.com/v1"
    },
    "anthropic": {
      "model": "claude-sonnet-4-5",
      "endpoint": "https://api.anthropic.com/v1"
    },
    "xai": {
      "model": "grok-4",
      "endpoint": "https://api.x.ai/v1"
    },
    "gemini": {
      "model": "gemini-2.5-flash",
      "endpoint": "https://generativelanguage.googleapis.com/v1beta"
    },
    "compatible": {
      "model": "llama3.2",
      "endpoint": "http://127.0.0.1:11434/v1"
    }
  }
}
```

### Credenciales

Las claves API deben introducirse mediante las funciones de configuración previstas.

No deben incorporarse directamente a archivos JSON.

### Herramientas

Cada integración puede requerir indicar la ruta del ejecutable o de su directorio de instalación.

### Comprobación

La aplicación distingue entre herramientas detectadas, no configuradas y aquellas que no han superado la verificación disponible.

## 17. Desarrollo y compilación

### Requisitos

- Node.js 22.
- npm.
- Git.
- Herramientas necesarias para compilar Electron.

### Clonar el repositorio

```bash
git clone https://github.com/ardu01/rea-studio.git
cd rea-studio
```

### Instalar dependencias

```bash
npm ci
```

### Comprobar TypeScript

```bash
npm run typecheck
```

### Ejecutar pruebas

```bash
npm test
```

### Desarrollo

```bash
npm run dev
```

La aplicación utiliza Electron Vite.

La interfaz de desarrollo se sirve mediante el entorno local configurado, que en la versión documentada utiliza:

`http://127.0.0.1:43123`

### Compilar

```bash
npm run build
```

### Crear distribución Windows

```bash
npm run dist:win
```

El proyecto utiliza electron-builder y NSIS x64.

La publicación automática está desactivada mediante `--publish never`.

### Crear distribución macOS Intel

```bash
npm run dist:mac
```

El proyecto utiliza electron-builder para generar un ZIP de macOS x64, sin arquitectura arm64.

La aplicación no se firma ni se notariza.

La publicación automática está desactivada mediante `--publish never`.

### Compilación desde Linux

La compilación cruzada puede requerir Wine y componentes de 32 bits.

El proyecto ha registrado limitaciones en determinadas configuraciones de Wine durante la creación de instaladores.

Por ello, el resultado de una compilación cruzada debe validarse posteriormente en Windows.

## 18. Pruebas y validación

REA Studio incorpora pruebas automatizadas con Vitest.

### Pruebas disponibles

```bash
npm test
```

### Cobertura documentada

Las pruebas incluyen escenarios de:

- Construcción de argumentos.
- Adaptadores de REA.
- Adaptador de Ghidra.
- Integración radare2.
- Integración Rizin.
- Validación de rutas.
- Tratamiento de caracteres especiales.
- Extracción de cadenas.
- Lectura de metadatos.
- Cancelación de trabajos.
- Límites temporales.
- Protección de credenciales.
- Respuestas SSE simuladas.
- Consentimiento de envío.
- Comprobaciones básicas de interfaz.

### Validación de distribución

El workflow de Windows contempla tres niveles independientes.

| Nivel | Comprobación |
|---|---|
| Build | Compilación, pruebas y generación NSIS |
| Instalación | Instalación silenciosa del ejecutable |
| Arranque | Inicio del proceso principal de Electron |

### Verificación del instalador

El workflow comprueba, entre otras condiciones:

- Generación del archivo.
- Tamaño superior al mínimo configurado.
- Firma inicial `MZ`.
- Resultado de la instalación silenciosa.
- Existencia del ejecutable instalado.

### Prueba de arranque

El modo de comprobación utiliza:

`REA_STUDIO_SMOKE=1`

Verifica que el proceso principal alcanza la inicialización de Electron y crea una ventana.

No representa una prueba funcional completa de la interfaz.

### Informe de validación

Cada publicación debe consultarse mediante:

`INSTALL-VALIDATION.txt`

El valor `main_process_ready` identifica el nivel de arranque esperado.

### Alcance real

Las pruebas iniciales no incluyen ejecuciones completas contra todos los binarios oficiales de REA, Ghidra, radare2 y Rizin.

Las conexiones autenticadas reales con APIs comerciales tampoco se verificaron durante la compilación documentada.

## 19. Estado de compatibilidad

La siguiente matriz resume la cobertura documentada de REA Studio 0.1.0.

| Componente | Estado |
|---|---|
| Cadenas y metadatos | Implementado y probado |
| Hash SHA-256 | Implementado y probado |
| REA | Adaptador implementado |
| Ghidra headless | Adaptador implementado |
| radare2 | Adaptador implementado |
| Rizin | Adaptador implementado |
| OpenAI API | Conector implementado |
| Anthropic API | Conector implementado |
| xAI API | Conector implementado |
| Gemini API | Conector implementado |
| Endpoint local compatible | Implementado |
| Codex CLI | Integración implementada |
| Claude Code | Integración implementada |
| Gemini CLI | Integración implementada |
| IDA | Futuro |
| Binary Ninja | Futuro |
| Hopper | Futuro |
| JADX | Futuro |

**Implementado no significa necesariamente validado contra el producto externo real.**

Los adaptadores que únicamente se han probado con ejecutables sustitutos deben verificarse en un entorno con las herramientas correspondientes.

## 20. Limitaciones conocidas

REA Studio 0.1.0 es una versión experimental.

### Herramientas

- No incorpora todas las herramientas de ingeniería inversa existentes.
- REA necesita su instalación independiente.
- Ghidra requiere sus propias dependencias.
- Algunos adaptadores todavía no se han probado contra instalaciones reales.
- El soporte de formatos depende de cada herramienta externa.

### Inteligencia artificial

- Las APIs comerciales pueden generar costes.
- La disponibilidad de modelos varía.
- Las credenciales deben configurarse individualmente.
- Las integraciones CLI pueden comunicarse con servicios externos.
- Las respuestas de modelos pueden contener errores técnicos.

### Instalación

- El instalador no está firmado.
- La versión es una vista previa.
- El resultado de cada publicación debe revisarse mediante su informe de validación.
- No se garantiza compatibilidad con todas las configuraciones Windows.

### Seguridad

- Las herramientas externas deben considerarse componentes independientes.
- El análisis estático no garantiza que un archivo sea seguro.
- Los informes pueden contener información sensible.
- La autorización de envío no sustituye la revisión del usuario.

### Dependencias

La documentación de la compilación inicial registra avisos moderados de seguridad en determinadas dependencias de empaquetado.

Deben revisarse los avisos vigentes y las versiones disponibles antes de publicar nuevas distribuciones.

## 21. Hoja de ruta

### Fase I. Plataforma inicial

- [x] Aplicación Electron.
- [x] Interfaz React.
- [x] Gestión de espacios de trabajo.
- [x] Extracción de cadenas.
- [x] Metadatos.
- [x] Hash SHA-256.
- [x] Registro de trabajos.
- [x] Visor de artefactos.
- [x] Configuración de herramientas.

### Fase II. Integraciones

- [x] Adaptador REA.
- [x] Adaptador Ghidra headless.
- [x] Adaptador radare2.
- [x] Adaptador Rizin.
- [x] Conectores de APIs de IA.
- [x] Integraciones CLI.
- [ ] Ampliar las pruebas con instalaciones reales.
- [ ] Mejorar el diagnóstico de dependencias.

### Fase III. Análisis avanzado

- [ ] Ampliar los tipos de artefactos.
- [ ] Incorporar nuevas herramientas.
- [ ] Mejorar la presentación de resultados.
- [ ] Desarrollar comparaciones entre análisis.
- [ ] Ampliar la exportación de informes.
- [ ] Mejorar la organización de proyectos.

### Fase IV. Estabilidad y distribución

- [ ] Ampliar la validación de instaladores.
- [ ] Mejorar la compatibilidad Windows.
- [ ] Evaluar la firma digital.
- [ ] Mejorar el tratamiento de errores.
- [ ] Ampliar la cobertura de pruebas.
- [ ] Documentar configuraciones verificadas.
- [ ] Mejorar el mantenimiento de dependencias.

La hoja de ruta representa posibles líneas de desarrollo y no compromisos de publicación.

## 22. Preguntas frecuentes

<details>
<summary><strong>¿REA Studio es lo mismo que REA?</strong></summary>

No. REA Studio es una aplicación independiente que integra REA y otras herramientas mediante adaptadores. REA conserva su propio repositorio, funcionalidades y licencia.

</details>

<details>
<summary><strong>¿Necesito instalar Ghidra?</strong></summary>

Solo si deseas utilizar las funciones de análisis basadas en Ghidra. Las herramientas locales de cadenas y metadatos pueden funcionar sin él.

</details>

<details>
<summary><strong>¿Se ejecutan los programas analizados?</strong></summary>

Las operaciones estáticas documentadas no ejecutan el binario analizado. Las herramientas externas deben utilizarse dentro de sus modos y configuraciones compatibles.

</details>

<details>
<summary><strong>¿Puedo utilizar REA Studio sin inteligencia artificial?</strong></summary>

Sí. Las funciones locales de inspección no dependen de disponer de claves de API.

</details>

<details>
<summary><strong>¿Necesito pagar una suscripción?</strong></summary>

REA Studio no requiere una suscripción propia para sus funciones locales. Determinados proveedores de IA y herramientas externas pueden tener costes o condiciones independientes.

</details>

<details>
<summary><strong>¿Los archivos se envían automáticamente a la nube?</strong></summary>

No durante las operaciones locales documentadas. Para enviar contenido a proveedores de IA, la aplicación incorpora un mecanismo de revisión previa y autorización.

</details>

<details>
<summary><strong>¿Por qué una herramienta aparece como no configurada?</strong></summary>

Porque no se ha encontrado su ejecutable, faltan dependencias o no se ha completado la verificación disponible.

</details>

<details>
<summary><strong>¿Es una herramienta oficial de OpenAI, Ghidra o REA?</strong></summary>

No. REA Studio es un proyecto independiente desarrollado por Miguel Rodríguez Saiz y utiliza integraciones con herramientas de terceros.

</details>

<details>
<summary><strong>¿Puedo utilizarlo para analizar cualquier aplicación?</strong></summary>

Debe utilizarse únicamente sobre software que tengas autorización para examinar, respetando sus licencias, los derechos aplicables y los controles de acceso.

</details>

## 23. Licencias y atribuciones

### REA Studio

El proyecto se distribuye bajo **MIT License**.

Esta licencia permite utilizar, modificar y redistribuir el software conforme a sus condiciones.

Consultar:

[LICENSE](LICENSE)

### Componentes externos

REA Studio utiliza o integra proyectos independientes.

| Proyecto | Relación |
|---|---|
| REA | Herramientas de análisis |
| Ghidra | Ingeniería inversa |
| radare2 | Análisis binario |
| Rizin | Análisis binario |
| Electron | Aplicación de escritorio |
| React | Interfaz |
| TypeScript | Desarrollo |
| Codex | Agente de programación |
| Claude Code | Agente CLI |
| Gemini CLI | Agente CLI |

Las herramientas externas conservan sus propias licencias y condiciones.

### Avisos de terceros

La documentación de dependencias está disponible en:

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

### Independencia

REA Studio no está patrocinado ni respaldado oficialmente por los desarrolladores de las herramientas integradas.

Los nombres comerciales se utilizan únicamente para identificar los productos y servicios correspondientes.

## 24. Autor y organización

### Miguel Rodríguez Saiz

Diseño, desarrollo e integración de REA Studio.

El proyecto forma parte de una iniciativa de desarrollo de herramientas propias para ingeniería de software, análisis técnico y aplicación de inteligencia artificial a entornos profesionales.

### Ardu Solutions

Ardu Solutions desarrolla proyectos relacionados con:

- Ingeniería de software.
- Inteligencia artificial.
- Herramientas de programación.
- Análisis de aplicaciones.
- Automatización.
- Electrónica y hardware.
- Sistemas y plataformas tecnológicas.

### Enlaces oficiales

**Repositorio**  
https://github.com/ardu01/rea-studio

**Publicaciones**  
https://github.com/ardu01/rea-studio/releases

**Portfolio de proyectos**  
https://ardu01.github.io/proyectos/

**Ardu Solutions**  
https://ardusolutions.pages.dev/

**Perfil GitHub**  
https://github.com/ardu01

---

**© 2026 Miguel Rodríguez Saiz · Ardu Solutions**

**REA Studio — Software Analysis & AI Workstation**

*Understand software. Explore its structure. Stay in control.*
