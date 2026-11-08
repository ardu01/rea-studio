import { createHash } from 'node:crypto'
import type { DisclosureItem, DisclosureView } from '../shared/types.js'

const PREVIEW = 400
const PER_ITEM = 32_000
const TOTAL = 100_000

export function buildDisclosure(input: {
  providerId: string
  destination: string
  leavesDevice: boolean
  prompt: string
  artifacts: Array<{ name: string; text: string }>
}): DisclosureView {
  let budget = TOTAL
  const items: DisclosureItem[] = []
  for (const artifact of input.artifacts) {
    if (budget <= 0) break
    const slice = artifact.text.slice(0, Math.min(PER_ITEM, budget))
    budget -= slice.length
    items.push({
      name: artifact.name,
      bytes: Buffer.byteLength(slice),
      sha256: createHash('sha256').update(slice).digest('hex'),
      preview: slice.slice(0, PREVIEW),
    })
  }
  const prompt = input.prompt.slice(0, 12_000)
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        providerId: input.providerId,
        destination: input.destination,
        leavesDevice: input.leavesDevice,
        prompt,
        items: items.map((item) => ({ name: item.name, sha256: item.sha256, bytes: item.bytes })),
      }),
    )
    .digest('hex')
  const contextBytes = items.reduce((sum, item) => sum + item.bytes, 0)
  return {
    providerId: input.providerId,
    destination: input.destination,
    leavesDevice: input.leavesDevice,
    promptBytes: Buffer.byteLength(prompt),
    promptPreview: prompt.slice(0, PREVIEW),
    items,
    hash,
    totalBytes: Buffer.byteLength(prompt) + contextBytes,
  }
}

export function assertOptIn(optIn: boolean, seenHash: string, actualHash: string): void {
  if (seenHash !== actualHash) {
    throw new Error('El contexto cambió desde que se mostró el resumen. Vuelve a revisarlo antes de enviarlo.')
  }
  if (optIn !== true) {
    throw new Error('Confirma el envío. REA Studio no manda el contexto al proveedor sin esa casilla.')
  }
}

export function contextBody(items: DisclosureItem[], originals: Array<{ name: string; text: string }>): string {
  return items
    .map((item) => {
      const source = originals.find((original) => original.name === item.name)
      const text = source?.text.slice(0, PER_ITEM) ?? ''
      return `## ${item.name}\n${text}`
    })
    .join('\n\n')
}
