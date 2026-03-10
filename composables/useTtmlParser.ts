import type { LyricLine, LyricWord, ParsedTtml } from '~/types'

/**
 * Parse a TTML time string to milliseconds.
 * Supports:
 *   - offset: "5.0s", "500ms"
 *   - clock:  "00:01:30.500", "01:30.500"
 */
function parseTime(raw: string | null): number {
  if (!raw) return 0
  const s = raw.trim()

  // Offset format: "123.456s"
  if (s.endsWith('s') && !s.endsWith('ms')) {
    return Math.round(parseFloat(s.slice(0, -1)) * 1000)
  }
  // Offset format: "500ms"
  if (s.endsWith('ms')) {
    return Math.round(parseFloat(s.slice(0, -2)))
  }

  // Clock format: "HH:MM:SS.mmm" or "MM:SS.mmm"
  const parts = s.split(':')
  if (parts.length === 3) {
    const [h, m, sec] = parts
    return Math.round(
      parseInt(h) * 3600000 + parseInt(m) * 60000 + parseFloat(sec) * 1000
    )
  }
  if (parts.length === 2) {
    const [m, sec] = parts
    return Math.round(parseInt(m) * 60000 + parseFloat(sec) * 1000)
  }

  return 0
}

function getTextContent(el: Element): string {
  // Collect text from the element and its children, handling <br> as newlines
  let text = ''
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).localName
      if (tag === 'br') {
        text += '\n'
      } else {
        text += (node as Element).textContent || ''
      }
    }
  })
  return text.trim()
}

/**
 * Look for a <div ttm:agent="chords"> section and apply chord annotations
 * to the matching lyrics words by timing.
 */
function applyChordsFromAgent(doc: Document, lines: LyricLine[]): boolean {
  const divs = Array.from(doc.getElementsByTagNameNS('*', 'div'))
  const chordsDiv = divs.find(
    (d) =>
      d.getAttribute('ttm:agent') === 'chords' ||
      d.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'agent') === 'chords'
  )
  if (!chordsDiv) return false

  const chordPs = Array.from(chordsDiv.getElementsByTagNameNS('*', 'p'))
  if (chordPs.length === 0) return false

  // Build a lookup: lineBeginMs -> chord spans (in document order)
  const chordsByLine = new Map<number, { beginMs: number; endMs: number; chord: string }[]>()
  for (const p of chordPs) {
    const lineBegin = parseTime(p.getAttribute('begin'))
    const spans = Array.from(p.getElementsByTagNameNS('*', 'span'))
    const chords = spans
      .map((s) => ({
        beginMs: parseTime(s.getAttribute('begin')),
        endMs: parseTime(s.getAttribute('end')),
        chord: s.textContent?.trim() || '',
      }))
      .filter((c) => c.chord)
    if (chords.length > 0) chordsByLine.set(lineBegin, chords)
  }

  if (chordsByLine.size === 0) return false

  // Match chords to lyrics words
  for (const line of lines) {
    const chords = chordsByLine.get(line.beginMs)
    if (!chords) continue

    // If the line has word-level timing, match by timestamp
    if (line.words.length > 0) {
      const used = new Set<number>()
      for (const { beginMs, endMs, chord } of chords) {
        let bestIdx = -1
        let bestDist = Infinity
        for (let i = 0; i < line.words.length; i++) {
          if (used.has(i)) continue
          const dist = Math.abs(line.words[i].beginMs - beginMs) + Math.abs(line.words[i].endMs - endMs)
          if (dist < bestDist) {
            bestDist = dist
            bestIdx = i
          }
        }
        if (bestIdx >= 0) {
          line.words[bestIdx].chord = chord
          used.add(bestIdx)
        }
      }
      continue
    }

    // Line has no word-level timing — synthesize words from text,
    // derive word index from chord position within line time range
    const textWords = line.text.split(/\s+/).filter(Boolean)
    if (textWords.length === 0) continue

    const duration = line.endMs - line.beginMs
    const words: LyricWord[] = textWords.map((text) => ({
      text,
      beginMs: line.beginMs,
      endMs: line.endMs,
    }))

    for (const { beginMs, chord } of chords) {
      // Reverse the distribution: wordIndex = position within line range
      const fraction = duration > 0 ? (beginMs - line.beginMs) / duration : 0
      const idx = Math.min(Math.floor(fraction * textWords.length), textWords.length - 1)
      words[idx].chord = chord
    }

    line.words = words
  }

  return true
}

export function parseTtml(xml: string): ParsedTtml {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'application/xml')

  // Check for parse errors
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error('Invalid TTML XML: ' + parseError.textContent)
  }

  const tt = doc.documentElement

  // Extract timing mode and language
  const timing = (
    tt.getAttribute('itunes:timing') ||
    tt.getAttributeNS('http://music.apple.com/lyric-ttml-internal', 'timing') ||
    'Line'
  ) as ParsedTtml['timing']

  const lang =
    tt.getAttribute('xml:lang') || tt.getAttribute('lang') || 'en'

  // Find all <p> elements (lyrics lines) in <body>, excluding chords agent div
  const allPs = Array.from(doc.getElementsByTagNameNS('*', 'p'))
  const pElements = allPs.filter((p) => {
    const parentDiv = p.closest('div')
    if (!parentDiv) return true
    return (
      parentDiv.getAttribute('ttm:agent') !== 'chords' &&
      parentDiv.getAttributeNS('http://www.w3.org/ns/ttml#metadata', 'agent') !== 'chords'
    )
  })

  const lines: LyricLine[] = []

  pElements.forEach((p, idx) => {
    const beginMs = parseTime(p.getAttribute('begin'))
    const endMs = parseTime(p.getAttribute('end'))

    // Check for background vocal attribute
    const isBackground =
      p.getAttribute('ttm:role') === 'x-bg' ||
      p.getAttribute('itunes:key') === 'L2'

    // Extract word-level spans
    const spanElements = Array.from(p.getElementsByTagNameNS('*', 'span'))
    const words: LyricWord[] = []

    // Filter to direct child spans only (or spans that have timing)
    spanElements.forEach((span) => {
      const spanBegin = span.getAttribute('begin')
      const spanEnd = span.getAttribute('end')
      if (spanBegin || spanEnd) {
        const wordText = span.textContent?.trim() || ''
        if (wordText) {
          words.push({
            text: wordText,
            beginMs: parseTime(spanBegin),
            endMs: parseTime(spanEnd),
          })
        }
      }
    })

    const text =
      words.length > 0 ? words.map((w) => w.text).join(' ') : getTextContent(p)

    if (text) {
      lines.push({
        index: idx,
        text,
        beginMs,
        endMs,
        words,
        isBackground,
      })
    }
  })

  // Re-index after filtering
  lines.forEach((line, i) => {
    line.index = i
  })

  // Extract metadata
  const titleEl = doc.getElementsByTagNameNS('http://www.w3.org/ns/ttml#metadata', 'title')[0]
  const descEl = doc.getElementsByTagNameNS('http://www.w3.org/ns/ttml#metadata', 'desc')[0]
  const agentEl = doc.getElementsByTagNameNS('http://www.w3.org/ns/ttml#metadata', 'agent')[0]
  const songName = titleEl?.textContent?.trim() || undefined
  const artistName = descEl?.textContent?.trim() || agentEl?.textContent?.trim() || agentEl?.getAttribute('xml:id')?.trim() || undefined

  // Extract playback rate from <ttm:item name="playbackRate">
  const itemEls = doc.getElementsByTagNameNS('http://www.w3.org/ns/ttml#metadata', 'item')
  let playbackRate: number | undefined
  let transposition: number | undefined
  for (const item of Array.from(itemEls)) {
    const name = item.getAttribute('name')
    const val = parseFloat(item.textContent?.trim() || '')
    if (name === 'playbackRate' && !isNaN(val) && val > 0) playbackRate = val
    if (name === 'transposition' && !isNaN(val)) transposition = val
  }

  // Extract chords from agent div
  const hasChords = applyChordsFromAgent(doc, lines)

  return { lines, timing, lang, songName, artistName, hasChords, playbackRate, transposition }
}

/**
 * Binary search to find the current active line index for a given time in ms.
 * Returns -1 if no line is active.
 */
export function findActiveLineIndex(
  lines: LyricLine[],
  currentMs: number
): number {
  if (lines.length === 0) return -1

  // Find the last line whose beginMs <= currentMs
  let lo = 0
  let hi = lines.length - 1
  let result = -1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (lines[mid].beginMs <= currentMs) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Verify the line hasn't ended yet
  if (result >= 0 && lines[result].endMs > 0 && currentMs > lines[result].endMs) {
    // We're past this line's end. Check if there's a gap before next line.
    // Still show this line as "last active" until the next one begins.
    if (result + 1 < lines.length && currentMs < lines[result + 1].beginMs) {
      return result
    }
    if (result + 1 < lines.length && currentMs >= lines[result + 1].beginMs) {
      return result + 1
    }
  }

  return result
}
