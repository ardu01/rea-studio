# REA Studio | Software Analysis & AI Workstation

### Understand software. Explore its structure. Stay in control.

**Entorno de escritorio para análisis estático de software, inspección de archivos binarios e integración de herramientas de ingeniería inversa e inteligencia artificial, desarrollado por Miguel Rodríguez Saiz dentro de Ardu Solutions.**

[![Version](https://img.shields.io/badge/Version-0.1.0-2563EB?style=flat-square)](https://github.com/ardu01/rea-studio)
![Status](https://img.shields.io/badge/Status-Preview-F59E0B?style=flat-square)
![Windows](https://img.shields.io/badge/Platform-Windows_x64-0078D4?style=flat-square&logo=windows&logoColor=white)
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
15. [Configuración](#15-configuración)
16. [Desarrollo y compilación](#16-desarrollo-y-compilación)
17. [Pruebas y validación](#17-pruebas-y-validación)
18. [Estado de compatibilidad](#18-estado-de-compatibilidad)
19. [Limitaciones conocidas](#19-limitaciones-conocidas)
20. [Hoja de ruta](#20-hoja-de-ruta)
21. [Preguntas frecuentes](#21-preguntas-frecuentes)
22. [Licencias y atribuciones](#22-licencias-y-atribuciones)
23. [Autor y organización](#23-autor-y-organización)

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
| Plataforma de distribución | Windows x64 |
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

**Trans
