export interface SecretStore {
  set(id: string, value: string): Promise<void>
  get(id: string): Promise<string | null>
  delete(id: string): Promise<void>
  ids(): Promise<string[]>
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>()

  async set(id: string, value: string): Promise<void> {
    if (!value.trim()) throw new Error('La clave está vacía.')
    this.values.set(id, value)
  }

  async get(id: string): Promise<string | null> {
    return this.values.get(id) ?? null
  }

  async delete(id: string): Promise<void> {
    this.values.delete(id)
  }

  async ids(): Promise<string[]> {
    return [...this.values.keys()]
  }

  async allValues(): Promise<string[]> {
    return [...this.values.values()]
  }
}

export interface SealFns {
  available: boolean
  encrypt?: (plain: string) => Buffer
  decrypt?: (payload: Buffer) => string
}

export interface SealedFile {
  read: () => Promise<Buffer | null>
  write: (buf: Buffer) => Promise<void>
}

interface SealedDocument {
  v: 1
  entries: Record<string, string>
}

/**
 * Stores secrets only when OS encryption is available.
 * If it is not, set() refuses. There is no plaintext file fallback.
 */
export function createSealedStore(file: SealedFile, fns: SealFns): SecretStore {
  async function readDoc(): Promise<SealedDocument> {
    const raw = await file.read()
    if (!raw || raw.length === 0) return { v: 1, entries: {} }
    const parsed = JSON.parse(raw.toString('utf8')) as SealedDocument
    if (parsed.v !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
      throw new Error('El almacén de claves está dañado.')
    }
    return parsed
  }

  return {
    async set(id, value) {
      if (!fns.available || !fns.encrypt || !fns.decrypt) {
        throw new Error(
          'El cifrado del sistema no está disponible. REA Studio no guardará la clave en texto plano.',
        )
      }
      if (!value.trim()) throw new Error('La clave está vacía.')
      const doc = await readDoc()
      doc.entries[id] = fns.encrypt(value).toString('base64')
      await file.write(Buffer.from(JSON.stringify(doc), 'utf8'))
      const written = (await file.read())?.toString('utf8') ?? ''
      if (written.includes(value)) {
        throw new Error('La clave apareció en claro al guardar. Se aborta.')
      }
    },
    async get(id) {
      if (!fns.available || !fns.decrypt) return null
      const doc = await readDoc()
      const encoded = doc.entries[id]
      if (!encoded) return null
      return fns.decrypt(Buffer.from(encoded, 'base64'))
    },
    async delete(id) {
      if (!fns.available || !fns.encrypt) {
        throw new Error('El cifrado del sistema no está disponible.')
      }
      const doc = await readDoc()
      delete doc.entries[id]
      await file.write(Buffer.from(JSON.stringify(doc), 'utf8'))
    },
    async ids() {
      if (!fns.available) return []
      const doc = await readDoc()
      return Object.keys(doc.entries)
    },
  }
}
