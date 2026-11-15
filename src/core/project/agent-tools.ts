import { z } from 'zod'
import type { ToolSpec } from '../ollama.js'

const rel = z.string().min(1).max(1024)

export const TOOL_SCHEMAS = {
  listar: z.object({ ruta: rel.optional() }).strict(),
  leer: z.object({ ruta: rel, desde: z.number().int().min(1).optional(), hasta: z.number().int().min(1).optional() }).strict(),
  escribir: z.object({ ruta: rel, contenido: z.string().max(512 * 1024), fase: z.enum(['reproduccion', 'mejora']).optional(), motivo: z.string().max(500).optional() }).strict(),
  editar: z
    .object({ ruta: rel, buscar: z.string().min(1).max(64 * 1024), reemplazar: z.string().max(64 * 1024), fase: z.enum(['reproduccion', 'mejora']).optional(), motivo: z.string().max(500).optional() })
    .strict(),
  ejecutar: z.object({ comando: z.string().min(1).max(40), argumentos: z.array(z.string().max(1000)).max(40).optional() }).strict(),
  ver_diff: z.object({}).strict(),
  referencia: z.object({ consulta: z.string().min(1).max(200) }).strict(),
  fin: z.object({ resumen: z.string().max(4000) }).strict(),
} as const

export type ToolName = keyof typeof TOOL_SCHEMAS

const PHASE_PROPS = {
  fase: { type: 'string', enum: ['reproduccion', 'mejora'], description: 'reproduccion: copia fiel del original. mejora: cambio sobre la copia ya terminada.' },
  motivo: { type: 'string', description: 'Obligatorio en las mejoras: qué mejora (errores, rendimiento, seguridad o interfaz) y por qué.' },
}

const DESCRIPTIONS: Record<ToolName, { description: string; parameters: Record<string, unknown> }> = {
  listar: {
    description: 'Lista archivos y carpetas del proyecto. Sin ruta, lista la raíz.',
    parameters: { type: 'object', properties: { ruta: { type: 'string', description: 'Carpeta relativa a la raíz' } } },
  },
  leer: {
    description: 'Lee un archivo de texto del proyecto. Para archivos largos usa desde/hasta (números de línea).',
    parameters: {
      type: 'object',
      properties: { ruta: { type: 'string' }, desde: { type: 'integer' }, hasta: { type: 'integer' } },
      required: ['ruta'],
    },
  },
  escribir: {
    description: 'Crea o reemplaza un archivo de texto entero. El usuario verá el diff.',
    parameters: { type: 'object', properties: { ruta: { type: 'string' }, contenido: { type: 'string' }, ...PHASE_PROPS }, required: ['ruta', 'contenido'] },
  },
  editar: {
    description: 'Sustituye un fragmento exacto, que debe aparecer una sola vez, por otro. Más barato que reescribir el archivo.',
    parameters: {
      type: 'object',
      properties: { ruta: { type: 'string' }, buscar: { type: 'string' }, reemplazar: { type: 'string' }, ...PHASE_PROPS },
      required: ['ruta', 'buscar', 'reemplazar'],
    },
  },
  ejecutar: {
    description: 'Ejecuta un comando de la lista permitida (compilar, probar). Sin shell: nada de &&, | o >.',
    parameters: {
      type: 'object',
      properties: { comando: { type: 'string', description: 'p. ej. npm, python, dotnet, cmake' }, argumentos: { type: 'array', items: { type: 'string' } } },
      required: ['comando'],
    },
  },
  ver_diff: { description: 'Muestra los cambios sin guardar respecto al último commit.', parameters: { type: 'object', properties: {} } },
  referencia: {
    description: 'Busca en la ficha del análisis (funciones, importaciones, cadenas, estructuras) del programa de referencia.',
    parameters: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
  },
  fin: {
    description: 'Termina el trabajo con un resumen para el usuario.',
    parameters: { type: 'object', properties: { resumen: { type: 'string' } }, required: ['resumen'] },
  },
}

export function toolSpecs(names: readonly ToolName[]): ToolSpec[] {
  return names.map((name) => ({ type: 'function', function: { name, ...DESCRIPTIONS[name] } }))
}

export type ParsedCall = { ok: true; name: ToolName; args: Record<string, unknown> } | { ok: false; error: string; name: string }

export function parseCall(name: string, args: unknown, enabled: readonly ToolName[]): ParsedCall {
  if (!(enabled as readonly string[]).includes(name)) {
    return { ok: false, name, error: `La herramienta «${name}» no existe. Usa: ${enabled.join(', ')}.` }
  }
  const schema = TOOL_SCHEMAS[name as ToolName]
  const result = schema.safeParse(args ?? {})
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || 'argumentos'}: ${issue.message}`).join('; ')
    return { ok: false, name, error: `Argumentos inválidos para ${name}: ${issues}` }
  }
  return { ok: true, name: name as ToolName, args: result.data as Record<string, unknown> }
}

/**
 * Alternativa cuando el modelo no usa llamadas nativas: busca en el texto un
 * objeto JSON {"herramienta": "...", "argumentos": {...}}.
 */
export function extractJsonCall(content: string): { name: string; arguments: unknown } | null {
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fence.exec(content))) candidates.push(match[1]!.trim())
  const first = content.indexOf('{')
  if (first !== -1) {
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = first; i < content.length; i++) {
      const ch = content[i]!
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          candidates.push(content.slice(first, i + 1))
          break
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(candidate) as Record<string, unknown>
      const name = json.herramienta ?? json.tool ?? json.name
      const args = json.argumentos ?? json.arguments ?? json.args ?? {}
      if (typeof name === 'string') return { name, arguments: args }
    } catch {
      /* siguiente candidato */
    }
  }
  return null
}

/** El contenido parece un intento de JSON de herramienta (para pedir que lo corrija). */
export function looksLikeToolJson(content: string): boolean {
  return /"(herramienta|tool)"\s*:/.test(content)
}
