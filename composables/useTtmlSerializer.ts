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
 * Check whether words have real (distinct) per-word timing.
 */
const hasRealWordTiming = (line: LyricLine) => {
  const { words } = line
  if (words.length <= 1) return true
  return !words.every(
    (w) => w.beginMs === words[0].beginMs && w.endMs === words[0].endMs
  )
}

/**
 * Serialize a line's words into <span> elements.
 * Only emits spans for word-timed lines; line-timed lines are handled as plain text.
 */
const serializeWordSpans = (line: LyricLine) =>
  line.words
    .map(
      (w) =>
        `        <span begin="${formatTime(w.beginMs)}" end="${formatTime(w.endMs)}">${escapeXml(w.text)}</span>`
    )
    .join('\n')

/**
 * Build the chords <div> containing only lines that have chord annotations.
 * Each <p> mirrors the lyrics line timing; each <span> carries a chord name
 * timed to encode its character position within the line text.
 *
 * Encoding: beginMs = lineBegin + (charIndex / textLength) * duration
 */
const buildChordsDiv = (lines: LyricLine[]) => {
  const chordPs: string[] = []

  for (const line of lines) {
    if (line.chords.length === 0) continue

    const duration = line.endMs - line.beginMs
    const textLen = Math.max(line.text.length, 1)
    const step = duration / textLen

    const chordSpans = [...line.chords]
      .sort((a, b) => a.charIndex - b.charIndex)
      .map(({ chord, charIndex }) => {
        const beginMs = Math.round(line.beginMs + charIndex * step)
        const endMs = Math.round(line.beginMs + (charIndex + 1) * step)
        return `        <span begin="${formatTime(beginMs)}" end="${formatTime(endMs)}">${escapeXml(chord)}</span>`
      })

    chordPs.push(
      `      <p begin="${formatTime(line.beginMs)}" end="${formatTime(line.endMs)}">\n${chordSpans.join('\n')}\n      </p>`
    )
  }

  if (chordPs.length === 0) return ''

  return `    <div ttm:agent="chords">\n${chordPs.join('\n')}\n    </div>`
}

/**
 * Serialize ParsedTtml (with chord-annotated words) back into a TTML XML string.
 */
export const serializeTtml = (parsed: ParsedTtml, artistName?: string, songName?: string, playbackRate?: number, transposition?: number, sourceUrl?: string) => {
  const title = songName || parsed.songName || ''
  const artist = artistName || parsed.artistName || ''
  const timing = parsed.timing || 'Word'
  const lang = parsed.lang || 'en'

  // Metadata
  const metaParts: string[] = []
  if (title) metaParts.push(`      <ttm:title>${escapeXml(title)}</ttm:title>`)
  if (artist) metaParts.push(`      <ttm:desc>${escapeXml(artist)}</ttm:desc>`)
  const rate = playbackRate ?? parsed.playbackRate
  if (rate && rate !== 1) metaParts.push(`      <ttm:item name="playbackRate">${rate}</ttm:item>`)
  const trans = transposition ?? parsed.transposition
  if (trans && trans !== 0) metaParts.push(`      <ttm:item name="transposition">${trans}</ttm:item>`)
  const resolvedsourceUrl = sourceUrl ?? parsed.sourceUrl
  if (resolvedsourceUrl) metaParts.push(`      <ttm:item name="sourceUrl">${escapeXml(resolvedsourceUrl)}</ttm:item>`)
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

    if (line.words.length > 0 && hasRealWordTiming(line)) {
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
