import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ProjectTemplateId } from '../../shared/types.js'

export function launchCommand(
  template: ProjectTemplateId,
  root: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  const exe = platform === 'win32'
  const candidates: Record<ProjectTemplateId, Array<{ command: string; args: string[]; file?: string }>> = {
    node: [
      { command: 'npm', args: ['start'] },
      { command: 'node', args: ['src/index.js'], file: 'src/index.js' },
      { command: 'node', args: ['src/main.js'], file: 'src/main.js' },
      { command: 'node', args: ['index.js'], file: 'index.js' },
    ],
    python: [
      { command: 'python', args: ['app/main.py'], file: 'app/main.py' },
      { command: 'python', args: ['main.py'], file: 'main.py' },
      { command: 'python', args: ['src/main.py'], file: 'src/main.py' },
    ],
    dotnet: [{ command: 'dotnet', args: ['run', '--project', 'src/App/App.csproj', '--nologo'] }],
    cmake: [],
    java: [
      { command: 'java', args: ['-cp', 'out', 'App'], file: 'out/App.class' },
    ],
  }
  if (template === 'cmake') {
    const names = exe ? ['app.exe', 'app'] : ['app']
    const dirs = ['build', path.join('build', 'Debug'), path.join('build', 'Release')]
    for (const dir of dirs) {
      for (const name of names) {
        const full = path.join(root, dir, name)
        if (existsSync(full)) return { command: full, args: [] }
      }
    }
    return null
  }
  for (const item of candidates[template]) {
    if (!item.file || existsSync(path.join(root, item.file))) return { command: item.command, args: item.args }
  }
  return null
}
