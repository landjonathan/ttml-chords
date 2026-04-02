import type { ChordPosition, LyricLine, LyricWord, UgChordLine } from '~/types'
import { mapChordsToCharPositions } from '~/composables/useChordParser'

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
 * Apply chords from a UG chord line to a TTML line using word alignment
 * to produce character-level positions.
 */
function applyChordsAligned(
  line: LyricLine,
  ugLine: UgChordLine,
) {
  const chords = mapChordsToCharPositions(line.text, ugLine.lyrics, ugLine.chords)
  for (const c of chords) {
    if (!line.chords.some((existing) => existing.charIndex === c.charIndex)) {
      line.chords.push(c)
    }
  }
}

/**
 * Apply chords positionally (proportional character mapping) when lyrics
 * differ too much for word alignment.
 */
function applyChordsPositional(
  line: LyricLine,
  ugLine: UgChordLine,
) {
  const ttmlLen = line.text.length
  const ugLen = ugLine.lyrics.length
  if (ttmlLen === 0 || ugLen === 0) return

  for (const { chord, charPosition } of ugLine.chords) {
    const charIndex = Math.min(
      Math.round((charPosition / ugLen) * ttmlLen),
      ttmlLen - 1,
    )
    if (!line.chords.some((c) => c.charIndex === charIndex)) {
      line.chords.push({ chord, charIndex })
    }
  }
}

/**
 * Group UG lines by section, preserving order within each section.
 */
const groupBySection = (ugLines: UgChordLine[]) => {
  const sections = new Map<string, UgChordLine[]>()
  for (const ug of ugLines) {
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
 * Match UG chord lines to TTML lyrics lines and assign chords as
 * character-level positions on each line.
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

  // Track which TTML lines got matched and to which UG index
  const matched: (number | null)[] = new Array(ttmlLines.length).fill(null)
  const result = ttmlLines.map((line) => ({
    ...line,
    words: ensureWords(line).map((w) => ({ ...w })),
    chords: [] as ChordPosition[],
  }))

  // ── Phase 1: text-similarity matching ──
  let ugSearchStart = 0

  for (let i = 0; i < result.length; i++) {
    const ttmlText = result[i].text
    if (toWords(ttmlText).length === 0) continue

    let bestIdx = -1
    let bestScore = 0

    for (let u = ugSearchStart; u < ugLines.length; u++) {
      const score = similarity(ttmlText, ugLines[u].lyrics)
      if (score > bestScore) { bestScore = score; bestIdx = u }
      if (score > 0.8) break
    }

    if (bestScore < 0.5) {
      for (let u = 0; u < ugSearchStart && u < ugLines.length; u++) {
        const score = similarity(ttmlText, ugLines[u].lyrics)
        if (score > bestScore) { bestScore = score; bestIdx = u }
      }
    }

    if (bestIdx === -1 || bestScore < 0.4) continue

    if (bestIdx >= ugSearchStart) ugSearchStart = bestIdx + 1

    matched[i] = bestIdx
    applyChordsAligned(result[i], ugLines[bestIdx])
  }

  // ── Phase 2: section-type fallback ──
  const hasSections = ugLines.some((ug) => ug.section && ug.section !== 'other')

  if (hasSections) {
    const sectionGroups = groupBySection(ugLines)
    const unmatchedRuns = findRuns(result.length, (i) => matched[i] === null && toWords(result[i].text).length > 0)

    for (const run of unmatchedRuns) {
      let inferredType: string | undefined

      for (let b = run.start - 1; b >= 0; b--) {
        if (matched[b] !== null) {
          inferredType = ugLines[matched[b]!]?.section
          break
        }
      }

      if (inferredType) {
        for (let a = run.end + 1; a < result.length; a++) {
          if (matched[a] !== null) {
            const afterType = ugLines[matched[a]!]?.section
            if (afterType && afterType !== inferredType) break
            if (afterType === inferredType) break
            break
          }
        }
      }

      if (!inferredType) continue

      const candidates = sectionGroups.get(inferredType)
      if (!candidates || candidates.length === 0) continue

      const runLen = run.end - run.start + 1
      for (let r = 0; r < runLen; r++) {
        const ttmlIdx = run.start + r
        const ugLine = candidates[r % candidates.length]
        applyChordsPositional(result[ttmlIdx], ugLine)
        matched[ttmlIdx] = -1
      }
    }
  }

  // ── Phase 3: structural pattern propagation ──
  const unmatchedRuns = findRuns(result.length, (i) => matched[i] === null && toWords(result[i].text).length > 0)

  if (unmatchedRuns.length > 0) {
    const matchedRuns = findRuns(result.length, (i) => matched[i] !== null)

    for (const run of unmatchedRuns) {
      const runLen = run.end - run.start + 1

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
        const sourceChords = result[sourceIdx].chords
        const sourceText = result[sourceIdx].text
        const targetText = result[ttmlIdx].text
        if (sourceText.length === 0 || targetText.length === 0) continue

        // Proportionally map chord positions from source to target
        for (const { chord, charIndex } of sourceChords) {
          const mappedIdx = Math.min(
            Math.round((charIndex / sourceText.length) * targetText.length),
            targetText.length - 1,
          )
          if (!result[ttmlIdx].chords.some((c) => c.charIndex === mappedIdx)) {
            result[ttmlIdx].chords.push({ chord, charIndex: mappedIdx })
          }
        }
      }
    }
  }

  return result
}
