import type { LyricLine, UgChordLine } from '../types'
import { mapChordsToWords } from './useChordParser'

/**
 * Normalize text for comparison: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Split text into normalized words.
 */
function toWords(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean)
}

/**
 * Compute a simple similarity score between two strings (0-1).
 * Uses word overlap ratio.
 */
function similarity(a: string, b: string): number {
  const wordsA = toWords(a)
  const wordsB = toWords(b)
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  let matches = 0
  const used = new Set<number>()
  for (const wa of wordsA) {
    for (let i = 0; i < wordsB.length; i++) {
      if (!used.has(i) && wa === wordsB[i]) {
        matches++
        used.add(i)
        break
      }
    }
  }
  const maxLen = Math.max(wordsA.length, wordsB.length)
  return matches / maxLen
}

/**
 * Match UG chord lines to TTML lyrics lines and assign chords to TTML words.
 *
 * Strategy:
 * 1. For each TTML line, find the best matching UG chord line (by text similarity)
 * 2. Use character-position mapping to assign chords to individual TTML words
 * 3. Handle repeated sections (e.g. chorus) by allowing UG lines to match multiple TTML lines
 *
 * Returns a new array of LyricLines with chord annotations on words.
 */
export function matchChordsToTtml(
  ttmlLines: LyricLine[],
  ugLines: UgChordLine[],
): LyricLine[] {
  if (ugLines.length === 0) return ttmlLines

  // Build a flat list of UG "word slots" with chord info for each UG line
  const ugWordMaps = ugLines.map((ugLine) => ({
    lyrics: ugLine.lyrics,
    normalizedWords: toWords(ugLine.lyrics),
    chordMap: mapChordsToWords(ugLine.lyrics, ugLine.chords),
  }))

  // For sequential matching: track where we are in UG lines
  let ugSearchStart = 0

  return ttmlLines.map((ttmlLine) => {
    if (ttmlLine.words.length === 0) return ttmlLine

    const ttmlText = ttmlLine.text
    const ttmlNormWords = toWords(ttmlText)
    if (ttmlNormWords.length === 0) return ttmlLine

    // Find best matching UG line, starting from ugSearchStart
    // but also check all UG lines for repeated sections
    let bestIdx = -1
    let bestScore = 0

    // First pass: search forward from current position (preferred for order)
    for (let u = ugSearchStart; u < ugWordMaps.length; u++) {
      const score = similarity(ttmlText, ugWordMaps[u].lyrics)
      if (score > bestScore) {
        bestScore = score
        bestIdx = u
      }
      // If we found a very good match, stop looking further
      if (score > 0.8) break
    }

    // Second pass: if no good match found forward, check earlier lines (repeated sections)
    if (bestScore < 0.5) {
      for (let u = 0; u < ugSearchStart && u < ugWordMaps.length; u++) {
        const score = similarity(ttmlText, ugWordMaps[u].lyrics)
        if (score > bestScore) {
          bestScore = score
          bestIdx = u
        }
      }
    }

    // Need at least 40% similarity to consider it a match
    if (bestIdx === -1 || bestScore < 0.4) return ttmlLine

    // Advance search pointer past the matched line
    if (bestIdx >= ugSearchStart) {
      ugSearchStart = bestIdx + 1
    }

    // Now map chords from the matched UG line to TTML words
    const ugMatch = ugWordMaps[bestIdx]
    const ugWords = ugMatch.normalizedWords
    const chordMap = ugMatch.chordMap

    // Build a chord-per-UG-word lookup
    const ugWordChords = new Map<number, string>()
    for (const { wordIndex, chord } of chordMap) {
      ugWordChords.set(wordIndex, chord)
    }

    // Two-pointer alignment: match TTML words to UG words
    const newWords = ttmlLine.words.map((w) => ({ ...w }))
    let ugPtr = 0

    for (let t = 0; t < newWords.length; t++) {
      const tWord = normalize(newWords[t].text)
      if (!tWord) continue

      // Try to find this TTML word in the UG word sequence
      // Allow skipping up to 2 UG words to handle minor differences
      let found = false
      for (let skip = 0; skip <= 2 && ugPtr + skip < ugWords.length; skip++) {
        if (ugWords[ugPtr + skip] === tWord) {
          // Check if any of the skipped or matched UG words have chords
          for (let s = ugPtr; s <= ugPtr + skip; s++) {
            const chord = ugWordChords.get(s)
            if (chord) {
              newWords[t].chord = chord
            }
          }
          ugPtr = ugPtr + skip + 1
          found = true
          break
        }
      }

      // If not found with small skip, try a broader search (up to 5 ahead)
      if (!found) {
        for (let skip = 3; skip <= 5 && ugPtr + skip < ugWords.length; skip++) {
          if (ugWords[ugPtr + skip] === tWord) {
            for (let s = ugPtr; s <= ugPtr + skip; s++) {
              const chord = ugWordChords.get(s)
              if (chord) {
                newWords[t].chord = chord
              }
            }
            ugPtr = ugPtr + skip + 1
            break
          }
        }
      }
    }

    return { ...ttmlLine, words: newWords }
  })
}
