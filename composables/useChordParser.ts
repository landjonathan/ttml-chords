import type { UgChordLine, UgChordPosition } from '~/types'

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
  const cleaned = content.replace(/\[\/?(tab)\]/gi, '')

  const rawLines = cleaned.split('\n')
  const result: UgChordLine[] = []

  let i = 0
  while (i < rawLines.length) {
    const line = rawLines[i]

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
        result.push({ lyrics: lyricsLine, chords })
      }

      i = j
    } else {
      i++
    }
  }

  return result
}

/**
 * Given a lyrics line and chord positions, map each chord to the word
 * that starts at or contains that character position.
 * Returns an array of { wordIndex, chord } assignments.
 */
export function mapChordsToWords(
  lyrics: string,
  chords: UgChordPosition[],
): { wordIndex: number; chord: string }[] {
  // Build word boundaries
  const words: { start: number; end: number; text: string }[] = []
  const regex = /\S+/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(lyrics)) !== null) {
    words.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
    })
  }

  if (words.length === 0) return []

  return chords
    .map(({ chord, charPosition }) => {
      // Find the word whose range contains or is closest to charPosition
      let bestIdx = 0
      let bestDist = Infinity
      for (let w = 0; w < words.length; w++) {
        const word = words[w]
        if (charPosition >= word.start && charPosition < word.end) {
          return { wordIndex: w, chord }
        }
        // Distance to word start
        const dist = Math.abs(charPosition - word.start)
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = w
        }
      }
      return { wordIndex: bestIdx, chord }
    })
    .filter(
      // Deduplicate: keep only the first chord per word
      (item, idx, arr) =>
        arr.findIndex((x) => x.wordIndex === item.wordIndex) === idx,
    )
}
