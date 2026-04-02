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
 * Map UG chord positions to character indices in the TTML line text.
 *
 * Uses word alignment between the two texts: for each UG chord at `charPosition`,
 * find which UG word owns it, compute fractional offset within that word,
 * and map to the corresponding TTML word's character range.
 * Chords in inter-word whitespace snap to the start of the nearest word.
 */
export function mapChordsToCharPositions(
  ttmlText: string,
  ugLyrics: string,
  ugChords: UgChordPosition[],
): ChordPosition[] {
  const ugWords = buildWordBounds(ugLyrics)
  const ttmlWords = buildWordBounds(ttmlText)
  if (ugWords.length === 0 || ttmlWords.length === 0) return []

  return ugChords
    .map(({ chord, charPosition }) => {
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

      // Chord is in whitespace — snap to nearest word start
      if (ugWordIdx === -1) {
        let bestDist = Infinity
        for (let w = 0; w < ugWords.length; w++) {
          const dist = Math.abs(charPosition - ugWords[w].start)
          if (dist < bestDist) {
            bestDist = dist
            ugWordIdx = w
          }
        }
        offsetInWord = 0
      }

      // Map to corresponding TTML word (proportional if counts differ)
      const ttmlWordIdx = Math.min(
        Math.round((ugWordIdx / ugWords.length) * ttmlWords.length),
        ttmlWords.length - 1,
      )
      const ttmlWord = ttmlWords[ttmlWordIdx]
      const ugWord = ugWords[ugWordIdx]
      const ugWordLen = ugWord.end - ugWord.start
      const ttmlWordLen = ttmlWord.end - ttmlWord.start

      // Proportional offset within the TTML word
      const fraction = ugWordLen > 0 ? offsetInWord / ugWordLen : 0
      const charIndex = ttmlWord.start + Math.min(
        Math.round(fraction * ttmlWordLen),
        ttmlWordLen - 1,
      )

      return { chord, charIndex }
    })
    .filter(
      // Deduplicate: keep only the first chord per charIndex
      (item, idx, arr) =>
        arr.findIndex((x) => x.charIndex === item.charIndex) === idx,
    )
}
