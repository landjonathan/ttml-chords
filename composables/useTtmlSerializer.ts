import type { LyricLine, ParsedTtml } from '~/types'

/**
 * Format milliseconds to TTML clock time "HH:MM:SS.mmm"
 */
const formatTime = (ms: number) => {
  const totalSeconds = ms / 1000
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
}

const escapeXml = (str: string) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Compute per-word timing for a line. If words already have distinct timing,
 * use it as-is. If all words share the same begin/end (line-level timing),
 * distribute the line's time range evenly across words so each gets a unique
 * and valid timestamp.
 */
const resolveWordTimings = (line: LyricLine) => {
  const { words } = line
  if (words.length === 0) return []

  const allSame = words.every(
    (w) => w.beginMs === words[0].beginMs && w.endMs === words[0].endMs
  )
  if (!allSame) return words.map((w) => ({ beginMs: w.beginMs, endMs: w.endMs }))

  // Distribute line range evenly
  const duration = line.endMs - line.beginMs
  const step = duration / words.length
  return words.map((_, i) => ({
    beginMs: Math.round(line.beginMs + i * step),
    endMs: Math.round(line.beginMs + (i + 1) * step),
  }))
}

/**
 * Serialize a line's words into <span> elements.
 */
const serializeWordSpans = (line: LyricLine) => {
  const timings = resolveWordTimings(line)
  return line.words
    .map(
      (w, i) =>
        `        <span begin="${formatTime(timings[i].beginMs)}" end="${formatTime(timings[i].endMs)}">${escapeXml(w.text)}</span>`
    )
    .join('\n')
}

/**
 * Build the chords <div> containing only lines that have chord annotations.
 * Each <p> mirrors the lyrics line timing; each <span> carries a chord name
 * timed to the word it annotates.
 */
const buildChordsDiv = (lines: LyricLine[]) => {
  const chordPs: string[] = []

  for (const line of lines) {
    const timings = resolveWordTimings(line)
    const chordSpans: string[] = []
    line.words.forEach((w, i) => {
      if (!w.chord) return
      chordSpans.push(
        `        <span begin="${formatTime(timings[i].beginMs)}" end="${formatTime(timings[i].endMs)}">${escapeXml(w.chord)}</span>`
      )
    })
    if (chordSpans.length === 0) continue

    const spans = chordSpans.join('\n')

    chordPs.push(
      `      <p begin="${formatTime(line.beginMs)}" end="${formatTime(line.endMs)}">\n${spans}\n      </p>`
    )
  }

  if (chordPs.length === 0) return ''

  return `    <div ttm:agent="chords">\n${chordPs.join('\n')}\n    </div>`
}

/**
 * Serialize ParsedTtml (with chord-annotated words) back into a TTML XML string.
 */
export const serializeTtml = (parsed: ParsedTtml, artistName?: string, songName?: string) => {
  const title = songName || parsed.songName || ''
  const artist = artistName || parsed.artistName || ''
  const timing = parsed.timing || 'Word'
  const lang = parsed.lang || 'en'

  // Metadata
  const metaParts: string[] = []
  if (title) metaParts.push(`      <ttm:title>${escapeXml(title)}</ttm:title>`)
  if (artist) metaParts.push(`      <ttm:desc>${escapeXml(artist)}</ttm:desc>`)
  metaParts.push(
    `      <ttm:agent xml:id="chords" type="other">\n        <ttm:name>Chords</ttm:name>\n      </ttm:agent>`
  )

  // Lyrics lines
  const lyricsPs = parsed.lines.map((line) => {
    const attrs = [
      `begin="${formatTime(line.beginMs)}"`,
      `end="${formatTime(line.endMs)}"`,
    ]
    if (line.isBackground) attrs.push(`itunes:key="L2"`)

    if (line.words.length > 0) {
      return `      <p ${attrs.join(' ')}>\n${serializeWordSpans(line)}\n      </p>`
    }
    return `      <p ${attrs.join(' ')}>${escapeXml(line.text)}</p>`
  })

  const chordsDiv = buildChordsDiv(parsed.lines)

  const bodyParts = [`    <div>\n${lyricsPs.join('\n')}\n    </div>`]
  if (chordsDiv) bodyParts.push(chordsDiv)

  return `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    itunes:timing="${timing}"
    xml:lang="${lang}">
  <head>
    <metadata>
${metaParts.join('\n')}
    </metadata>
  </head>
  <body>
${bodyParts.join('\n')}
  </body>
</tt>`
}
