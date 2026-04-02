import type { ChordPosition, UgChordLine, UgChordPosition } from '~/types'

/**
 * Check if a line contains [ch]...[/ch] chord tags.
 */
function isChordLine(line: string): boolean {
  return line.includes('[ch]')
}

/**
 * Check if a line is a section header like [Verse 1], [Chorus], etc.
 * These use plain brackets (not [ch]).
 */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^\[(?!ch\])/.test(trimmed) &&
    !trimmed.includes('[ch]') &&
    /\]$/.test(trimmed)
  )
}

/**
 * Normalize a section header label to a canonical type.
 * "[Verse 1]", "[Verse]", "[Verse 3]" → 'verse'
 * "[Chorus]", "[Chorus 2]" → 'chorus'
 * "[Bridge]", "[Pre-Chorus]" etc. → 'bridge', 'pre-chorus'
 * Unknown → 'other'
 */
function normalizeSectionType(header: string): string {
  const inner = header.replace(/^\[|\]$/g, '').trim().toLowerCase()
  const base = inner.replace(/\s*\d+$/, '').trim()
  const known = ['verse', 'chorus', 'bridge', 'pre-chorus', 'intro', 'outro', 'interlude', 'solo']
  return known.find((k) => base === k) ?? 'other'
}

/**
 * Extract chord names and their character positions from a chord line.
 * The position is calculated based on where the chord would appear
 * after stripping all [ch]/[/ch] tags.
 */
function extractChords(chordLine: string): UgChordPosition[] {
  const chords: UgChordPosition[] = []
  let renderPos = 0
  let i = 0
  const src = chordLine

  while (i < src.length) {
    if (src.startsWith('[ch]', i)) {
      // Found a chord tag
      const startTag = i + 4 // skip '[ch]'
      const endTag = src.indexOf('[/ch]', startTag)
      if (endTag === -1) break

      const chordName = src.substring(startTag, endTag)
      chords.push({ chord: chordName, charPosition: renderPos })
      renderPos += chordName.length
      i = endTag + 5 // skip '[/ch]'
    } else if (src.startsWith('[/ch]', i)) {
      // Stray closing tag, skip
      i += 5
    } else {
      // Regular character (spaces between chords)
      renderPos++
      i++
    }
  }

  return chords
}

/**
 * Parse UG tab content (BBCode-like format) into structured chord-lyrics pairs.
 *
 * Format:
 *   [ch]Am[/ch]    [ch]C[/ch]       [ch]G[/ch]
 *   I can see the sun coming down
 *
 * A chord line is followed by its corresponding lyrics line.
 * The character position of each chord maps to the word at that column in the lyrics.
 */
export function parseUgContent(content: string): UgChordLine[] {
  // Strip [tab]/[/tab] wrappers
  const cleaned = content.replace(/\[\/?tab\]/gi, '')

  const rawLines = cleaned.split('\n')
  const result: UgChordLine[] = []

  let currentSection: string | undefined
  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]

    if (isSectionHeader(line.trim())) {
      currentSection = normalizeSectionType(line.trim())
    }

    if (isChordLine(line)) {
      const chords = extractChords(line)

      // Look ahead for the lyrics line (next non-empty, non-chord, non-header line)
      let lyricsLine = ''
      let j = i + 1
      while (j < rawLines.length) {
        const next = rawLines[j].trim()
        if (next === '' || isSectionHeader(next)) {
          j++
          continue
        }
        if (isChordLine(rawLines[j])) {
          // Next line is also a chord line — this chord line is instrumental (no lyrics)
          break
        }
        lyricsLine = rawLines[j]
        // Remove any [ch] tags that might be inline with lyrics
        lyricsLine = lyricsLine.replace(/\[\/?ch\]/g, '')
        j++
        break
      }

      if (lyricsLine.trim() && chords.length > 0) {
        result.push({ lyrics: lyricsLine, chords, section: currentSection })
      }

      i = j
    } else {
      i++
    }
  }

  return result
}

/**
 * Build word boundaries for a text string.
 */
const buildWordBounds = (text: string) => {
  const words: { start: number; end: number }[] = []
  const regex = /\S+/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    words.push({ start: match.index, end: match.index + match[0].length })
  }
  return words
}

/**
 * Normalize a word for comparison: lowercase, strip non-word chars.
 */
const normalizeWord = (text: string) => text.toLowerCase().replace(/[^\w]/g, '')

/**
 * Map UG chord positions to character indices in the TTML line text.
 *
 * Uses two-pointer word alignment between the two texts: UG words are matched
 * to TTML words by normalized text. For each UG chord, the character offset
 * within its UG word is proportionally mapped to the aligned TTML word.
 * Chords on unmatched UG words (e.g. when UG line is longer than TTML) become
 * trailing chords (charIndex = ttmlText.length).
 */
export function mapChordsToCharPositions(
  ttmlText: string,
  ugLyrics: string,
  ugChords: UgChordPosition[],
): ChordPosition[] {
  const ugWords = buildWordBounds(ugLyrics)
  const ttmlWords = buildWordBounds(ttmlText)
  if (ugWords.length === 0 || ttmlWords.length === 0) return []

  // Two-pointer word alignment: match UG words to TTML words by text
  const ugToTtml = new Array<number>(ugWords.length).fill(-1)
  const ugNorm = ugWords.map((w) => normalizeWord(ugLyrics.slice(w.start, w.end)))
  const ttmlNorm = ttmlWords.map((w) => normalizeWord(ttmlText.slice(w.start, w.end)))

  let ttmlPtr = 0
  for (let u = 0; u < ugWords.length; u++) {
    if (ttmlPtr >= ttmlWords.length) break
    for (let skip = 0; skip <= 3 && ttmlPtr + skip < ttmlWords.length; skip++) {
      if (ugNorm[u] === ttmlNorm[ttmlPtr + skip]) {
        ugToTtml[u] = ttmlPtr + skip
        ttmlPtr = ttmlPtr + skip + 1
        break
      }
    }
  }

  // Find the matched UG word range for leading/trailing detection
  const firstMatchedUg = ugToTtml.findIndex((t) => t !== -1)
  const lastMatchedUg = ugToTtml.lastIndexOf(Math.max(...ugToTtml))

  return ugChords
    .map(({ chord, charPosition }): ChordPosition | null => {
      // Find which UG word owns this chord position
      let ugWordIdx = -1
      let offsetInWord = 0
      for (let w = 0; w < ugWords.length; w++) {
        if (charPosition >= ugWords[w].start && charPosition < ugWords[w].end) {
          ugWordIdx = w
          offsetInWord = charPosition - ugWords[w].start
          break
        }
      }

      // Chord is in whitespace
      if (ugWordIdx === -1) {
        const lastUgWord = ugWords[ugWords.length - 1]
        if (charPosition >= lastUgWord.end) {
          return { chord, charIndex: ttmlText.length }
        }
        // Snap to nearest UG word start
        let bestDist = Infinity
        for (let w = 0; w < ugWords.length; w++) {
          const dist = Math.abs(charPosition - ugWords[w].start)
          if (dist < bestDist) { bestDist = dist; ugWordIdx = w }
        }
        offsetInWord = 0
      }

      // Skip chords on UG words outside the aligned range
      if (firstMatchedUg === -1) return null
      if (ugWordIdx < firstMatchedUg) return null
      if (ugWordIdx > lastMatchedUg) return null

      // Look up aligned TTML word
      let ttmlWordIdx = ugToTtml[ugWordIdx]

      if (ttmlWordIdx === -1) {
        // Unmatched word between matched words — map across the TTML gap
        let prevTtml = -1
        let nextTtml = ttmlWords.length
        for (let b = ugWordIdx - 1; b >= 0; b--) {
          if (ugToTtml[b] !== -1) { prevTtml = ugToTtml[b]; break }
        }
        for (let f = ugWordIdx + 1; f < ugWords.length; f++) {
          if (ugToTtml[f] !== -1) { nextTtml = ugToTtml[f]; break }
        }

        const gapStart = prevTtml + 1
        const gapEnd = Math.min(nextTtml, ttmlWords.length)
        if (gapStart < gapEnd) {
          // Proportionally map across the TTML words in the gap
          const ugWord = ugWords[ugWordIdx]
          const ugWordLen = ugWord.end - ugWord.start
          const frac = ugWordLen > 0 ? offsetInWord / ugWordLen : 0
          const gapCharStart = ttmlWords[gapStart].start
          const gapCharEnd = ttmlWords[gapEnd - 1].end
          const gapLen = gapCharEnd - gapCharStart
          const charIndex = gapCharStart + Math.min(
            Math.round(frac * gapLen),
            Math.max(gapLen - 1, 0),
          )
          return { chord, charIndex }
        }

        ttmlWordIdx = prevTtml !== -1
          ? prevTtml
          : (nextTtml < ttmlWords.length ? nextTtml : ttmlWords.length - 1)
      }

      const ttmlWord = ttmlWords[ttmlWordIdx]
      const ugWord = ugWords[ugWordIdx]
      const ugWordLen = ugWord.end - ugWord.start
      const ttmlWordLen = ttmlWord.end - ttmlWord.start

      const fraction = ugWordLen > 0 ? offsetInWord / ugWordLen : 0
      const charIndex = ttmlWord.start + Math.min(
        Math.round(fraction * ttmlWordLen),
        Math.max(ttmlWordLen - 1, 0),
      )

      return { chord, charIndex }
    })
    .filter((item): item is ChordPosition => item !== null)
    .filter(
      (item, idx, arr) =>
        arr.findIndex((x) => x.charIndex === item.charIndex) === idx,
    )
}
