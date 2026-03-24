import type { LyricLine, LyricWord, UgChordLine } from '~/types'
import { mapChordsToWords } from '~/composables/useChordParser'

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
 * Ensure a TTML line has word objects (synthesize from text if line-timed).
 */
const ensureWords = (line: LyricLine): LyricWord[] =>
  line.words.length > 0
    ? line.words
    : line.text.split(/\s+/).filter(Boolean).map((text) => ({
        text,
        beginMs: line.beginMs,
        endMs: line.endMs,
      }))

/**
 * Apply chords from a UG chord line to TTML words using two-pointer alignment.
 * Mutates the `words` array in place.
 */
function applyChordsAligned(
  words: LyricWord[],
  ugNormWords: string[],
  ugWordChords: Map<number, string>,
) {
  let ugPtr = 0
  for (let t = 0; t < words.length; t++) {
    const tWord = normalize(words[t].text)
    if (!tWord) continue

    let found = false
    for (let skip = 0; skip <= 2 && ugPtr + skip < ugNormWords.length; skip++) {
      if (ugNormWords[ugPtr + skip] === tWord) {
        for (let s = ugPtr; s <= ugPtr + skip; s++) {
          const chord = ugWordChords.get(s)
          if (chord) words[t].chord = chord
        }
        ugPtr = ugPtr + skip + 1
        found = true
        break
      }
    }
    if (!found) {
      for (let skip = 3; skip <= 5 && ugPtr + skip < ugNormWords.length; skip++) {
        if (ugNormWords[ugPtr + skip] === tWord) {
          for (let s = ugPtr; s <= ugPtr + skip; s++) {
            const chord = ugWordChords.get(s)
            if (chord) words[t].chord = chord
          }
          ugPtr = ugPtr + skip + 1
          break
        }
      }
    }
  }
}

/**
 * Apply chords from a UG chord line to TTML words by proportional position.
 * Used when lyrics differ too much for word alignment.
 */
function applyChordsPositional(
  words: LyricWord[],
  ugWordCount: number,
  ugWordChords: Map<number, string>,
) {
  if (words.length === 0 || ugWordCount === 0) return
  for (const [ugIdx, chord] of ugWordChords) {
    const ttmlIdx = Math.min(
      Math.round((ugIdx / ugWordCount) * words.length),
      words.length - 1,
    )
    if (!words[ttmlIdx].chord) words[ttmlIdx].chord = chord
  }
}

interface UgWordMap {
  lyrics: string
  section?: string
  normalizedWords: string[]
  chordMap: { wordIndex: number; chord: string }[]
}

/**
 * Build a chord-per-word lookup from a UgWordMap.
 */
const buildChordLookup = (ugMap: UgWordMap) => {
  const m = new Map<number, string>()
  for (const { wordIndex, chord } of ugMap.chordMap) m.set(wordIndex, chord)
  return m
}

/**
 * Group UG lines by section, preserving order within each section.
 */
const groupBySection = (ugMaps: UgWordMap[]) => {
  const sections = new Map<string, UgWordMap[]>()
  for (const ug of ugMaps) {
    const key = ug.section ?? '__none__'
    if (!sections.has(key)) sections.set(key, [])
    sections.get(key)!.push(ug)
  }
  return sections
}

/**
 * Find runs of consecutive indices where a predicate is true.
 */
const findRuns = (length: number, pred: (i: number) => boolean) => {
  const runs: { start: number; end: number }[] = []
  let i = 0
  while (i < length) {
    if (pred(i)) {
      const start = i
      while (i < length && pred(i)) i++
      runs.push({ start, end: i - 1 })
    } else {
      i++
    }
  }
  return runs
}

/**
 * Match UG chord lines to TTML lyrics lines and assign chords to TTML words.
 *
 * Phase 1: text-similarity matching (sequential greedy, 40% threshold)
 * Phase 2: section-type fallback (match unmatched runs to same-type UG sections)
 * Phase 3: structural fallback (match by line-count similarity when no sections)
 */
export function matchChordsToTtml(
  ttmlLines: LyricLine[],
  ugLines: UgChordLine[],
): LyricLine[] {
  if (ugLines.length === 0) return ttmlLines

  const ugWordMaps: UgWordMap[] = ugLines.map((ugLine) => ({
    lyrics: ugLine.lyrics,
    section: ugLine.section,
    normalizedWords: toWords(ugLine.lyrics),
    chordMap: mapChordsToWords(ugLine.lyrics, ugLine.chords),
  }))

  // Track which TTML lines got matched and to which UG index
  const matched: (number | null)[] = new Array(ttmlLines.length).fill(null)
  const result = ttmlLines.map((line) => ({
    ...line,
    words: ensureWords(line).map((w) => ({ ...w })),
  }))

  // ── Phase 1: text-similarity matching ──
  let ugSearchStart = 0

  for (let i = 0; i < result.length; i++) {
    const ttmlText = result[i].text
    if (toWords(ttmlText).length === 0) continue

    let bestIdx = -1
    let bestScore = 0

    for (let u = ugSearchStart; u < ugWordMaps.length; u++) {
      const score = similarity(ttmlText, ugWordMaps[u].lyrics)
      if (score > bestScore) { bestScore = score; bestIdx = u }
      if (score > 0.8) break
    }

    if (bestScore < 0.5) {
      for (let u = 0; u < ugSearchStart && u < ugWordMaps.length; u++) {
        const score = similarity(ttmlText, ugWordMaps[u].lyrics)
        if (score > bestScore) { bestScore = score; bestIdx = u }
      }
    }

    if (bestIdx === -1 || bestScore < 0.4) continue

    if (bestIdx >= ugSearchStart) ugSearchStart = bestIdx + 1

    matched[i] = bestIdx
    const ugMatch = ugWordMaps[bestIdx]
    applyChordsAligned(result[i].words, ugMatch.normalizedWords, buildChordLookup(ugMatch))
  }

  // ── Phase 2: section-type fallback ──
  const hasSections = ugWordMaps.some((ug) => ug.section && ug.section !== 'other')

  if (hasSections) {
    const sectionGroups = groupBySection(ugWordMaps)
    const unmatchedRuns = findRuns(result.length, (i) => matched[i] === null && toWords(result[i].text).length > 0)

    for (const run of unmatchedRuns) {
      // Infer expected section type from nearest matched neighbors
      let inferredType: string | undefined

      // Look backward for the nearest matched line's UG section
      for (let b = run.start - 1; b >= 0; b--) {
        if (matched[b] !== null) {
          inferredType = ugWordMaps[matched[b]!].section
          break
        }
      }

      // If the neighbor before is a different type (e.g. chorus→verse transition),
      // also check the neighbor after to confirm
      if (inferredType) {
        for (let a = run.end + 1; a < result.length; a++) {
          if (matched[a] !== null) {
            const afterType = ugWordMaps[matched[a]!].section
            // If before and after are both chorus, the gap is probably not a verse
            // If before=verse and after=chorus, the gap is likely a verse
            if (afterType && afterType !== inferredType) {
              // Gap is between two different section types — keep the "before" type
              break
            }
            if (afterType === inferredType) {
              // Both sides are the same type — gap is likely the same type
              break
            }
            break
          }
        }
      }

      if (!inferredType) continue

      const candidates = sectionGroups.get(inferredType)
      if (!candidates || candidates.length === 0) continue

      // Apply chords positionally: line i within run → line (i % sectionLen) in UG section
      const runLen = run.end - run.start + 1
      for (let r = 0; r < runLen; r++) {
        const ttmlIdx = run.start + r
        const ugLine = candidates[r % candidates.length]
        const chordLookup = buildChordLookup(ugLine)
        applyChordsPositional(result[ttmlIdx].words, ugLine.normalizedWords.length, chordLookup)
        matched[ttmlIdx] = -1 // mark as filled by fallback
      }
    }
  }

  // ── Phase 3: structural pattern propagation ──
  const unmatchedRuns = findRuns(result.length, (i) => matched[i] === null && toWords(result[i].text).length > 0)

  if (unmatchedRuns.length > 0) {
    // Find runs of consecutive matched lines to use as pattern sources
    const matchedRuns = findRuns(result.length, (i) => matched[i] !== null)

    for (const run of unmatchedRuns) {
      const runLen = run.end - run.start + 1

      // Find the matched run with the closest line count
      let bestSource: { start: number; end: number } | null = null
      let bestDiff = Infinity
      for (const mr of matchedRuns) {
        const mrLen = mr.end - mr.start + 1
        const diff = Math.abs(mrLen - runLen)
        if (diff < bestDiff) { bestDiff = diff; bestSource = mr }
      }

      if (!bestSource) continue

      const sourceLen = bestSource.end - bestSource.start + 1
      for (let r = 0; r < runLen; r++) {
        const ttmlIdx = run.start + r
        const sourceIdx = bestSource.start + (r % sourceLen)
        // Copy chord pattern from the matched source line
        const sourceWords = result[sourceIdx].words
        const targetWords = result[ttmlIdx].words
        if (sourceWords.length === 0 || targetWords.length === 0) continue

        const sourceChords = new Map<number, string>()
        sourceWords.forEach((w, i) => { if (w.chord) sourceChords.set(i, w.chord) })
        applyChordsPositional(targetWords, sourceWords.length, sourceChords)
      }
    }
  }

  return result
}
