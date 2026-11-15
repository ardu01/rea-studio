import type { ProjectTemplateId } from '../../shared/types.js'

export interface TemplateCommand {
  label: string
  command: string
  args: string[]
}

export interface ProjectTemplate {
  id: ProjectTemplateId
  label: string
  summary: string
  /** Comandos de compilación y pruebas, en orden. */
  commands: TemplateCommand[]
  files: (name: string) => Record<string, string>
}

const COMMON_IGNORE = ['.rea/', '']

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'node',
    label: 'Node.js',
    summary: 'Módulo ES con pruebas de node:test. Sin dependencias.',
    commands: [{ label: 'Probar', command: 'npm', args: ['test'] }],
    files: (name) => ({
      'package.json': json({
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { test: 'node --test tests/' },
      }),
      'src/index.js': "export function saludo(nombre) {\n  return `Hola, ${nombre}`\n}\n",
      'tests/index.test.js':
        "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { saludo } from '../src/index.js'\n\ntest('saludo', () => {\n  assert.equal(saludo('REA'), 'Hola, REA')\n})\n",
      '.gitignore': ['node_modules/', ...COMMON_IGNORE].join('\n'),
      'README.md': `# ${name}\n\nProyecto Node.js creado con REA Studio.\n\n- Pruebas: \`npm test\`\n`,
    }),
  },
  {
    id: 'python',
    label: 'Python',
    summary: 'Paquete con pruebas de unittest. Sin dependencias.',
    commands: [{ label: 'Probar', command: 'python', args: ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'] }],
    files: (name) => ({
      'app/__init__.py': '',
      'app/nucleo.py': 'def saludo(nombre: str) -> str:\n    return f"Hola, {nombre}"\n',
      'tests/__init__.py': '',
      'tests/test_nucleo.py':
        'import unittest\n\nfrom app.nucleo import saludo\n\n\nclass PruebaNucleo(unittest.TestCase):\n    def test_saludo(self):\n        self.assertEqual(saludo("REA"), "Hola, REA")\n\n\nif __name__ == "__main__":\n    unittest.main()\n',
      '.gitignore': ['__pycache__/', '*.pyc', '.venv/', ...COMMON_IGNORE].join('\n'),
      'README.md': `# ${name}\n\nProyecto Python creado con REA Studio.\n\n- Pruebas: \`python -m unittest discover -s tests -t .\`\n`,
    }),
  },
  {
    id: 'dotnet',
    label: '.NET (C#)',
    summary: 'Aplicación de consola net8.0. Comprobación con dotnet build. Añadir xUnit pide instalar paquetes.',
    commands: [
      { label: 'Compilar', command: 'dotnet', args: ['build', 'src/App/App.csproj', '--nologo'] },
      { label: 'Ejecutar', command: 'dotnet', args: ['run', '--project', 'src/App/App.csproj', '--no-build'] },
    ],
    files: (name) => ({
      'src/App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n</Project>\n',
      'src/App/Program.cs': 'Console.WriteLine(Nucleo.Saludo("REA"));\n\npublic static class Nucleo\n{\n    public static string Saludo(string nombre) => $"Hola, {nombre}";\n}\n',
      '.gitignore': ['bin/', 'obj/', ...COMMON_IGNORE].join('\n'),
      'README.md': `# ${name}\n\nProyecto .NET creado con REA Studio.\n\n- Compilar: \`dotnet build src/App/App.csproj\`\n`,
    }),
  },
  {
    id: 'cmake',
    label: 'C/C++ con CMake',
    summary: 'Ejecutable C++17 y una prueba con CTest, sin bibliotecas externas.',
    commands: [
      { label: 'Configurar', command: 'cmake', args: ['-S', '.', '-B', 'build'] },
      { label: 'Compilar', command: 'cmake', args: ['--build', 'build'] },
      { label: 'Probar', command: 'ctest', args: ['--test-dir', 'build', '--output-on-failure'] },
    ],
    files: (name) => ({
      'CMakeLists.txt': `cmake_minimum_required(VERSION 3.16)\nproject(${name.replace(/[^A-Za-z0-9_]/g, '_')} CXX)\nset(CMAKE_CXX_STANDARD 17)\nset(CMAKE_CXX_STANDARD_REQUIRED ON)\n\nadd_library(nucleo src/nucleo.cpp)\ntarget_include_directories(nucleo PUBLIC src)\n\nadd_executable(app src/main.cpp)\ntarget_link_libraries(app PRIVATE nucleo)\n\nenable_testing()\nadd_executable(pruebas tests/pruebas.cpp)\ntarget_link_libraries(pruebas PRIVATE nucleo)\nadd_test(NAME pruebas COMMAND pruebas)\n`,
      'src/nucleo.hpp': '#pragma once\n#include <string>\n\nstd::string saludo(const std::string& nombre);\n',
      'src/nucleo.cpp': '#include "nucleo.hpp"\n\nstd::string saludo(const std::string& nombre) {\n    return "Hola, " + nombre;\n}\n',
      'src/main.cpp': '#include <iostream>\n#include "nucleo.hpp"\n\nint main() {\n    std::cout << saludo("REA") << "\\n";\n    return 0;\n}\n',
      'tests/pruebas.cpp': '#include <iostream>\n#include "nucleo.hpp"\n\nint main() {\n    if (saludo("REA") != "Hola, REA") {\n        std::cerr << "saludo devolvió un valor inesperado\\n";\n        return 1;\n    }\n    return 0;\n}\n',
      '.gitignore': ['build/', ...COMMON_IGNORE].join('\n'),
      'README.md': `# ${name}\n\nProyecto C/C++ con CMake creado con REA Studio.\n\n- \`cmake -S . -B build\`\n- \`cmake --build build\`\n- \`ctest --test-dir build --output-on-failure\`\n`,
    }),
  },
  {
    id: 'java',
    label: 'Java',
    summary: 'Aplicación Java con javac, sin dependencias ni Maven.',
    commands: [
      { label: 'Compilar', command: 'javac', args: ['-d', 'out', 'src/App.java'] },
      { label: 'Ejecutar', command: 'java', args: ['-cp', 'out', 'App'] },
    ],
    files: (name) => ({
      'src/App.java': 'public class App {\n    public static String saludo(String nombre) {\n        return "Hola, " + nombre;\n    }\n\n    public static void main(String[] args) {\n        System.out.println(saludo("REA"));\n    }\n}\n',
      '.gitignore': ['out/', '*.class', ...COMMON_IGNORE].join('\n'),
      'README.md': `# ${name}\n\nProyecto Java creado con REA Studio.\n\n- Compilar: \`javac -d out src/App.java\`\n- Ejecutar: \`java -cp out App\`\n`,
    }),
  },

]

export function templateFor(id: string): ProjectTemplate {
  const found = PROJECT_TEMPLATES.find((item) => item.id === id)
  if (!found) throw new Error('Plantilla desconocida.')
  return found
}
