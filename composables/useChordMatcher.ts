import type { ChordPosition, LyricLine, LyricWord, UgChordLine } from '~/types'
import { mapChordsToCharPositions, normalizeWord, fuzzyWordMatch } from '~/composables/useChordParser'

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
 * Compute a similarity score between two strings (0–1).
 * Handles syllable-split TTML words by greedily concatenating consecutive
 * A words that match a B word (e.g. "ri"+"sin" → "risin" matching "risin").
 * Uses fuzzy matching so e.g. "risin" ≈ "rising".
 */
function similarity(a: string, b: string): number {
  const wordsA = toWords(a)
  const wordsB = toWords(b)
  if (wordsA.length === 0 || wordsB.length === 0) return 0

  // Pre-merge: greedily concatenate consecutive A words that match a B word.
  const normB = wordsB.map(normalizeWord)
  const mergedA: string[] = []
  let i = 0
  while (i < wordsA.length) {
    let merged = false
    for (let span = 3; span >= 2; span--) {
      if (i + span > wordsA.length) continue
      const concat = wordsA.slice(i, i + span).join('')
      if (normB.some((nb) => concat === nb || fuzzyWordMatch(concat, nb))) {
        mergedA.push(concat)
        i += span
        merged = true
        break
      }
    }
    if (!merged) { mergedA.push(wordsA[i]); i++ }
  }

  // Word overlap with fuzzy matching
  let matches = 0
  const used = new Set<number>()
  for (const wa of mergedA) {
    for (let j = 0; j < wordsB.length; j++) {
      if (!used.has(j) && (wa === wordsB[j] || fuzzyWordMatch(wa, wordsB[j]))) {
        matches++
        used.add(j)
        break
      }
    }
  }
  return matches / Math.max(mergedA.length, wordsB.length)
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
 * Capitalize a section type for display: 'intro' → 'Intro'.
 */
const sectionLabel = (section: string) =>
  section.charAt(0).toUpperCase() + section.slice(1)

/**
 * Match UG chord lines to TTML lyrics lines and assign chords as
 * character-level positions on each line.
 *
 * Phase 1: text-similarity matching (sequential greedy, 40% threshold)
 * Phase 2: section-type fallback (match unmatched runs to same-type UG sections)
 * Phase 3: structural fallback (match by line-count similarity when no sections)
 * Phase 4: instrumental chord-only lines inserted into TTML timeline gaps
 */
export function matchChordsToTtml(
  ttmlLines: LyricLine[],
  ugLines: UgChordLine[],
): LyricLine[] {
  if (ugLines.length === 0) return ttmlLines

  // Separate lyric UG lines from chord-only (instrumental) UG lines
  const lyricUgLines: (UgChordLine & { originalIndex: number })[] = []
  const instrumentalUgLines: (UgChordLine & { originalIndex: number })[] = []
  for (let u = 0; u < ugLines.length; u++) {
    if (ugLines[u].lyrics.trim()) {
      lyricUgLines.push({ ...ugLines[u], originalIndex: u })
    } else {
      instrumentalUgLines.push({ ...ugLines[u], originalIndex: u })
    }
  }

  // Track which TTML lines got matched and to which UG index
  const matched: (number | null)[] = new Array(ttmlLines.length).fill(null)
  const result = ttmlLines.map((line) => ({
    ...line,
    words: ensureWords(line).map((w) => ({ ...w })),
    chords: [] as ChordPosition[],
  }))

  // ── Phase 1: text-similarity matching with multi-line merging ──
  // A single UG line may span multiple TTML lines. Try spans of 1-3
  // consecutive TTML lines and pick the best match.
  let ugSearchStart = 0

  for (let i = 0; i < result.length; ) {
    if (toWords(result[i].text).length === 0) { i++; continue }

    let bestUgIdx = -1
    let bestScore = 0
    let bestSpan = 1

    const tryMatch = (u: number) => {
      for (let span = 1; span <= 3 && i + span <= result.length; span++) {
        const merged = result.slice(i, i + span).map((l) => l.text).join(' ')
        const score = similarity(merged, ugLines[u].lyrics)
        if (score > bestScore) { bestScore = score; bestUgIdx = u; bestSpan = span }
      }
    }

    for (let u = ugSearchStart; u < ugLines.length; u++) {
      tryMatch(u)
      if (bestScore > 0.8) break
    }

    if (bestScore < 0.5) {
      for (let u = 0; u < ugSearchStart && u < ugLines.length; u++) {
        tryMatch(u)
      }
    }

    if (bestUgIdx === -1 || bestScore < 0.4) { i++; continue }

    if (bestUgIdx >= ugSearchStart) ugSearchStart = bestUgIdx + 1

    const spanIndices = Array.from({ length: bestSpan }, (_, s) => i + s)
    for (const idx of spanIndices) matched[idx] = bestUgIdx

    if (bestSpan === 1) {
      // Single line match — apply directly
      applyChordsAligned(result[i], ugLines[bestUgIdx])
    } else {
      // Multi-line match — map chords to merged text, then distribute
      const mergedText = spanIndices.map((idx) => result[idx].text).join(' ')
      const chords = mapChordsToCharPositions(mergedText, ugLines[bestUgIdx].lyrics, ugLines[bestUgIdx].chords)

      let offset = 0
      for (let s = 0; s < spanIndices.length; s++) {
        const idx = spanIndices[s]
        const lineLen = result[idx].text.length
        const isLast = s === spanIndices.length - 1

        for (const c of chords) {
          if (c.charIndex >= offset && c.charIndex < offset + lineLen) {
            const local = { chord: c.chord, charIndex: c.charIndex - offset }
            if (!result[idx].chords.some((e) => e.charIndex === local.charIndex)) {
              result[idx].chords.push(local)
            }
          } else if (isLast && c.charIndex >= offset + lineLen) {
            // Trailing chords go to the last line — preserve spread offset
            const local = { chord: c.chord, charIndex: c.charIndex - offset }
            if (!result[idx].chords.some((e) => e.charIndex === local.charIndex)) {
              result[idx].chords.push(local)
            }
          }
        }
        offset += lineLen + 1 // +1 for joining space
      }
    }

    i += bestSpan
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

  // ── Phase 4: instrumental (chord-only) lines ──
  // Place chord-only UG lines into gaps in the TTML timeline.
  if (instrumentalUgLines.length > 0) {
    // Map each matched UG original index → TTML line index
    const ugIdxToTtmlIdx = new Map<number, number>()
    for (let t = 0; t < matched.length; t++) {
      if (matched[t] !== null && matched[t]! >= 0) {
        ugIdxToTtmlIdx.set(matched[t]!, t)
      }
    }

    // Collect instrumental lines with their determined insertion position
    const toInsert: { insertAfter: number; line: LyricLine }[] = []

    for (const inst of instrumentalUgLines) {
      // Find the nearest matched UG line before and after this instrumental line
      let prevTtmlIdx = -1
      let nextTtmlIdx = result.length
      for (let u = inst.originalIndex - 1; u >= 0; u--) {
        if (ugIdxToTtmlIdx.has(u)) { prevTtmlIdx = ugIdxToTtmlIdx.get(u)!; break }
      }
      for (let u = inst.originalIndex + 1; u < ugLines.length; u++) {
        if (ugIdxToTtmlIdx.has(u)) { nextTtmlIdx = ugIdxToTtmlIdx.get(u)!; break }
      }

      // Determine timing from the gap between surrounding TTML lines
      let gapBeginMs: number
      let gapEndMs: number

      if (prevTtmlIdx >= 0 && nextTtmlIdx < result.length) {
        gapBeginMs = result[prevTtmlIdx].endMs
        gapEndMs = result[nextTtmlIdx].beginMs
      } else if (prevTtmlIdx >= 0) {
        // After last lyric line — use a duration based on a nearby verse/chorus
        gapBeginMs = result[prevTtmlIdx].endMs
        const refDuration = result[prevTtmlIdx].endMs - result[prevTtmlIdx].beginMs
        gapEndMs = gapBeginMs + refDuration
      } else if (nextTtmlIdx < result.length) {
        // Before first lyric line (intro)
        gapEndMs = result[nextTtmlIdx].beginMs
        const refDuration = result[nextTtmlIdx].endMs - result[nextTtmlIdx].beginMs
        gapBeginMs = Math.max(0, gapEndMs - refDuration)
      } else {
        // No TTML lines at all — skip
        continue
      }

      // Skip if the gap is too small (< 500ms)
      if (gapEndMs - gapBeginMs < 500) continue

      // Use original charPosition as charIndex to preserve whitespace-based
      // proportional timing (wider gaps between chords = longer duration)
      const chords: ChordPosition[] = inst.chords.map(({ chord, charPosition }) => ({
        chord,
        charIndex: charPosition,
      }))

      const instLine: LyricLine = {
        index: 0, // will be reindexed
        text: '',
        beginMs: gapBeginMs,
        endMs: gapEndMs,
        words: [],
        chords,
        isBackground: false,
        songPart: inst.section && inst.section !== 'other'
          ? sectionLabel(inst.section)
          : undefined,
      }

      toInsert.push({ insertAfter: prevTtmlIdx, line: instLine })
    }

    // Insert in reverse order to keep indices stable
    toInsert
      .sort((a, b) => b.insertAfter - a.insertAfter)
      .forEach(({ insertAfter, line }) => {
        result.splice(insertAfter + 1, 0, line)
      })

    // Reindex all lines
    result.forEach((line, i) => { line.index = i })
  }

  return result
}
