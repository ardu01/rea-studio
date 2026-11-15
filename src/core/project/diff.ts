/** Diff unificado por líneas (LCS), suficiente para mostrar un cambio propuesto. */
export function unifiedDiff(before: string | null, after: string, file: string, context = 3): string {
  const a = before === null ? [] : splitLines(before)
  const b = splitLines(after)
  const header = [`--- ${before === null ? '/dev/null' : `a/${file}`}`, `+++ b/${file}`]
  const ops = diffOps(a, b)
  if (!ops.some((op) => op.type !== 'same')) return ''
  const hunks: string[] = []
  let i = 0
  while (i < ops.length) {
    while (i < ops.length && ops[i]!.type === 'same') i++
    if (i >= ops.length) break
    let start = Math.max(0, i - context)
    let end = i
    // Extiende el bloque mientras haya cambios a menos de 2*context líneas.
    for (;;) {
      while (end < ops.length && ops[end]!.type !== 'same') end++
      let next = end
      while (next < ops.length && ops[next]!.type === 'same' && next - end < context * 2) next++
      if (next < ops.length && ops[next]!.type !== 'same') {
        end = next
        continue
      }
      break
    }
    const stop = Math.min(ops.length, end + context)
    const slice = ops.slice(start, stop)
    const aStart = slice.find((op) => op.aIndex !== undefined)?.aIndex ?? countBefore(ops, start, 'a')
    const bStart = slice.find((op) => op.bIndex !== undefined)?.bIndex ?? countBefore(ops, start, 'b')
    const aLen = slice.filter((op) => op.type !== 'add').length
    const bLen = slice.filter((op) => op.type !== 'del').length
    hunks.push(`@@ -${aLen ? aStart + 1 : aStart},${aLen} +${bLen ? bStart + 1 : bStart},${bLen} @@`)
    for (const op of slice) hunks.push(`${op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' '}${op.text}`)
    i = stop
    start = stop
  }
  return [...header, ...hunks].join('\n') + '\n'
}

interface Op {
  type: 'same' | 'add' | 'del'
  text: string
  aIndex?: number
  bIndex?: number
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function countBefore(ops: Op[], index: number, side: 'a' | 'b'): number {
  let count = 0
  for (let k = 0; k < index; k++) {
    const op = ops[k]!
    if (side === 'a' ? op.type !== 'add' : op.type !== 'del') count++
  }
  return count
}

const MAX_CELLS = 4_000_000

function diffOps(a: string[], b: string[]): Op[] {
  // Recorta prefijo y sufijo comunes para que la tabla LCS sea pequeña.
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const am = a.slice(prefix, a.length - suffix)
  const bm = b.slice(prefix, b.length - suffix)
  const ops: Op[] = []
  for (let k = 0; k < prefix; k++) ops.push({ type: 'same', text: a[k]!, aIndex: k, bIndex: k })
  if (am.length * bm.length > MAX_CELLS) {
    am.forEach((text, k) => ops.push({ type: 'del', text, aIndex: prefix + k }))
    bm.forEach((text, k) => ops.push({ type: 'add', text, bIndex: prefix + k }))
  } else {
    const n = am.length
    const m = bm.length
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let x = n - 1; x >= 0; x--) {
      for (let y = m - 1; y >= 0; y--) {
        table[x]![y] = am[x] === bm[y] ? table[x + 1]![y + 1]! + 1 : Math.max(table[x + 1]![y]!, table[x]![y + 1]!)
      }
    }
    let x = 0
    let y = 0
    while (x < n || y < m) {
      if (x < n && y < m && am[x] === bm[y]) {
        ops.push({ type: 'same', text: am[x]!, aIndex: prefix + x, bIndex: prefix + y })
        x++
        y++
      } else if (y < m && (x >= n || table[x]![y + 1]! >= table[x + 1]![y]!)) {
        ops.push({ type: 'add', text: bm[y]!, bIndex: prefix + y })
        y++
      } else {
        ops.push({ type: 'del', text: am[x]!, aIndex: prefix + x })
        x++
      }
    }
  }
  for (let k = 0; k < suffix; k++) {
    const ai = a.length - suffix + k
    const bi = b.length - suffix + k
    ops.push({ type: 'same', text: a[ai]!, aIndex: ai, bIndex: bi })
  }
  return ops
}

export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added++
    else if (line.startsWith('-')) removed++
  }
  return { added, removed }
}
