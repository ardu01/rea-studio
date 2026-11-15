import { describe, expect, it, vi } from 'vitest'
import {
  OLLAMA_SUGGESTIONS,
  assertOllamaModelName,
  isLocalEndpoint,
  listOllamaModels,
  ollamaBaseFromEndpoint,
  pullOllamaModel,
  splitNdjson,
  translatePullError,
  translatePullStatus,
} from '../src/core/ollama'
import { ollamaPullSchema } from '../src/core/ipc-schemas'
import { checkProvider, keylessAllowed, publicProviders, runModel } from '../src/core/providers'
import { defaultSettings, normalizeSettings } from '../src/core/settings'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

describe('Ollama: endpoint', () => {
  it('quita /v1 y solo admite localhost', () => {
    expect(ollamaBaseFromEndpoint('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434')
    expect(ollamaBaseFromEndpoint('http://localhost:11434/v1/')).toBe('http://localhost:11434')
    expect(ollamaBaseFromEndpoint('http://[::1]:11434')).toBe('http://[::1]:11434')
    expect(() => ollamaBaseFromEndpoint('https://api.openai.com/v1')).toThrow(/localhost/)
    expect(() => ollamaBaseFromEndpoint('http://192.168.1.20:11434/v1')).toThrow(/localhost/)
    expect(() => ollamaBaseFromEndpoint('http://127.0.0.1.evil.example/v1')).toThrow(/localhost/)
    expect(() => ollamaBaseFromEndpoint('http://user:pw@127.0.0.1:11434')).toThrow(/usuario/)
    expect(() => ollamaBaseFromEndpoint('file:///etc/passwd')).toThrow()
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalEndpoint('https://api.x.ai/v1')).toBe(false)
  })

  it('valida los nombres de modelo en core y en IPC', () => {
    expect(assertOllamaModelName(' llama3.2 ')).toBe('llama3.2')
    expect(assertOllamaModelName('hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M')).toContain('Q4_K_M')
    for (const bad of ['', '-rm', 'a b', '../x', 'a//b', 'x;rm', 'a'.repeat(201)]) {
      expect(() => assertOllamaModelName(bad)).toThrow()
    }
    expect(ollamaPullSchema.safeParse({ model: 'llama3.2' }).success).toBe(true)
    expect(ollamaPullSchema.safeParse({ model: 'x y' }).success).toBe(false)
    expect(ollamaPullSchema.safeParse({ model: 'llama3.2', extra: 1 }).success).toBe(false)
  })
})

describe('Ollama: sugerencias', () => {
  it('incluye los tres Huihui del catálogo de Sopa con su forma hf.co', () => {
    const names = OLLAMA_SUGGESTIONS.map((item) => item.name)
    expect(names).toContain('hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M')
    expect(names).toContain('hf.co/mradermacher/Huihui-Qwen3.5-4B-abliterated-GGUF:Q4_K_M')
    expect(names).toContain('hf.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF:UD-IQ3_XXS')
    const uncensored = OLLAMA_SUGGESTIONS.filter((item) => item.uncensored)
    expect(uncensored).toHaveLength(3)
    for (const item of OLLAMA_SUGGESTIONS) expect(() => assertOllamaModelName(item.name)).not.toThrow()
  })
})

describe('Ollama: lista de modelos', () => {
  it('lee /api/tags en la raíz sin /v1', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: 'qwen:9b', size: 5_600_000_000, details: { parameter_size: '9.7B', quantization_level: 'Q4_K_M' } },
            { name: 'llama3.2:latest', size: 2_000_000_000, details: {} },
            { nope: true },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const result = await listOllamaModels({ endpoint: 'http://127.0.0.1:11434/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.objectContaining({ method: 'GET' }))
    expect(result.available).toBe(true)
    expect(result.models.map((item) => item.name)).toEqual(['llama3.2:latest', 'qwen:9b'])
    expect(result.models[1]).toMatchObject({ parameterSize: '9.7B', quantization: 'Q4_K_M', bytes: 5_600_000_000 })
    expect(result.detail).toBe('2 modelos en Ollama.')
  })

  it('no llama a la red si el endpoint no es local', async () => {
    const fetchImpl = vi.fn()
    const result = await listOllamaModels({ endpoint: 'https://api.openai.com/v1', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.available).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('distingue un servidor que no es Ollama y un Ollama apagado', async () => {
    const lmStudio = vi.fn(async () => new Response('not found', { status: 404 }))
    const notOllama = await listOllamaModels({ endpoint: 'http://localhost:1234/v1', fetchImpl: lmStudio as unknown as typeof fetch })
    expect(notOllama.available).toBe(false)
    expect(notOllama.detail).toMatch(/no parece Ollama/)

    const odd = vi.fn(async () => new Response('{"data":[]}', { status: 200 }))
    expect((await listOllamaModels({ endpoint: 'http://localhost:1234/v1', fetchImpl: odd as unknown as typeof fetch })).detail).toMatch(/no como Ollama/)

    const refused = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })
    const off = await listOllamaModels({ endpoint: 'http://127.0.0.1:11434/v1', fetchImpl: refused as unknown as typeof fetch })
    expect(off.available).toBe(false)
    expect(off.detail).toMatch(/No hay ningún Ollama escuchando/)
  })
})

describe('Ollama: descarga', () => {
  it('envía stream true y traduce el progreso NDJSON partido entre trozos', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        streamOf([
          '{"status":"pulling manifest"}\n{"status":"pulling abc123def","total":100,',
          '"completed":40}\n{"status":"verifying sha256 digest"}\n',
          '{"status":"writing manifest"}\n{"status":"success"}',
        ]),
        { status: 200 },
      ),
    )
    const events: Array<{ status: string; completed: number | null; total: number | null }> = []
    await pullOllamaModel({
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
      signal: new AbortController().signal,
      onProgress: (progress) => events.push(progress),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe('http://127.0.0.1:11434/api/pull')
    expect(JSON.parse(String(call[1].body))).toEqual({ model: 'llama3.2', stream: true })
    expect(events.map((item) => item.status)).toEqual([
      'Descargando el manifiesto',
      'Descargando',
      'Comprobando el SHA-256',
      'Guardando el manifiesto',
      'Descarga completada',
    ])
    expect(events[1]).toMatchObject({ completed: 40, total: 100 })
  })

  it('convierte los errores de Ollama en mensajes en español', async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf(['{"status":"pulling manifest"}\n{"error":"pull model manifest: file does not exist"}\n']), { status: 200 }))
    await expect(
      pullOllamaModel({
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'hf.co/nadie/nada-GGUF:Q4_K_M',
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('Ese modelo o esa cuantización no existen.')

    const http = vi.fn(async () => new Response('{"error":"no space left on device"}', { status: 500 }))
    await expect(
      pullOllamaModel({
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'llama3.2',
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: http as unknown as typeof fetch,
      }),
    ).rejects.toThrow('No queda espacio en el disco.')

    const cut = vi.fn(async () => new Response(streamOf(['{"status":"pulling manifest"}\n']), { status: 200 }))
    await expect(
      pullOllamaModel({
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'llama3.2',
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: cut as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/sin confirmación/)
  })

  it('se puede cancelar a mitad', async () => {
    const controller = new AbortController()
    const encoder = new TextEncoder()
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode('{"status":"pulling abc123def","total":10,"completed":1}\n'))
          init.signal?.addEventListener('abort', () => stream.error(new DOMException('Aborted', 'AbortError')))
        },
      })
      return new Response(body, { status: 200 })
    })
    const done = pullOllamaModel({
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.2',
      signal: controller.signal,
      onProgress: () => controller.abort(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await expect(done).rejects.toThrow('Cancelado.')
  })

  it('rechaza endpoints no locales y nombres raros antes de llamar a la red', async () => {
    const fetchImpl = vi.fn()
    await expect(
      pullOllamaModel({ endpoint: 'https://ollama.example.com/v1', model: 'llama3.2', signal: new AbortController().signal, onProgress: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/localhost/)
    await expect(
      pullOllamaModel({ endpoint: 'http://127.0.0.1:11434/v1', model: '../../x', signal: new AbortController().signal, onProgress: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/no es válido/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('utilidades de NDJSON y traducciones', () => {
    expect(splitNdjson('{"a":1}\n\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' })
    expect(translatePullStatus('something new')).toBe('something new')
    expect(translatePullError('401 Unauthorized')).toMatch(/permiso/)
  })
})

describe('proveedor compatible local sin clave', () => {
  it('se considera configurado en localhost y no fuera', () => {
    const local = defaultSettings()
    expect(keylessAllowed('compatible', local)).toBe(true)
    expect(keylessAllowed('openai', local)).toBe(false)
    const remote = normalizeSettings({ providers: { compatible: { endpoint: 'https://proxy.example.com/v1' } } })
    expect(keylessAllowed('compatible', remote)).toBe(false)
    const compatible = publicProviders(local, new Set()).find((item) => item.id === 'compatible')!
    expect(compatible.configured).toBe(true)
    expect(compatible.keyless).toBe(true)
    expect(publicProviders(remote, new Set()).find((item) => item.id === 'compatible')!.configured).toBe(false)
  })

  it('comprueba y chatea sin cabecera Authorization', async () => {
    const settings = defaultSettings()
    const models = vi.fn(async () => new Response('{"data":[]}', { status: 200 }))
    const check = await checkProvider({ id: 'compatible', settings, apiKey: null, fetchImpl: models as unknown as typeof fetch })
    expect(check.state).toBe('reachable')
    const headers = (models.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()

    const chat = vi.fn(async () => new Response(streamOf(['data: {"choices":[{"delta":{"content":"hola"}}]}\n\n', 'data: [DONE]\n\n']), { status: 200 }))
    const text = await runModel({
      id: 'compatible',
      settings,
      apiKey: null,
      prompt: 'hola',
      context: '',
      cwd: '/tmp',
      timeoutMs: 5000,
      signal: new AbortController().signal,
      fetchImpl: chat as unknown as typeof fetch,
      onDelta: () => undefined,
      onLog: () => undefined,
    } as Parameters<typeof runModel>[0])
    expect(text).toBe('hola')
    const chatHeaders = (chat.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(chatHeaders.Authorization).toBeUndefined()

    const remote = normalizeSettings({ providers: { compatible: { endpoint: 'https://proxy.example.com/v1' } } })
    const idle = vi.fn()
    expect((await checkProvider({ id: 'compatible', settings: remote, apiKey: null, fetchImpl: idle as unknown as typeof fetch })).state).toBe('not-configured')
    expect(idle).not.toHaveBeenCalled()
  })
})
