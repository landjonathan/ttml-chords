import type { LyricLine, LyricWord, ParsedTtml } from '../types'

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

  // Find all <p> elements (lyrics lines) in <body>
  const pElements = Array.from(doc.getElementsByTagNameNS('*', 'p'))

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

  return { lines, timing, lang }
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
