<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { LyricLine, ChordPosition } from '~/types'

/**
 * Compute the playback time (ms) at which a chord at the given charIndex
 * starts. When the line has real word-level timing, the chord is positioned
 * within its containing word proportionally to its offset within that word;
 * otherwise we fall back to linear interpolation across the whole line.
 */
function chordTimeMs(line: LyricLine, charIndex: number): number {
  const duration = line.endMs - line.beginMs
  const textLen = line.text.length
  const lineFallback = duration > 0 && textLen > 0
    ? line.beginMs + (charIndex / textLen) * duration
    : line.beginMs

  const words = line.words
  if (words.length === 0) return lineFallback
  const hasWordTiming = words.some(
    (w) => w.beginMs !== line.beginMs || w.endMs !== line.endMs,
  )
  if (!hasWordTiming) return lineFallback

  // Walk words to find the one containing charIndex. Text is `words.join(' ')`
  // so each word occupies [pos, pos + word.text.length) with a single space
  // before the next word.
  let pos = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const wStart = pos
    const wEnd = pos + w.text.length
    if (charIndex < wStart) {
      // Sits in the gap before this word — snap to its start.
      return w.beginMs
    }
    if (charIndex < wEnd) {
      // When syllable-level timing is available, interpolate within the
      // correct syllable for sub-word precision.
      if (w.syllables) {
        let sylPos = wStart
        for (const syl of w.syllables) {
          const sylEnd = sylPos + syl.text.length
          if (charIndex < sylEnd) {
            const sylDur = syl.endMs - syl.beginMs
            if (syl.text.length === 0 || sylDur <= 0) return syl.beginMs
            return syl.beginMs + ((charIndex - sylPos) / syl.text.length) * sylDur
          }
          sylPos = sylEnd
        }
      }
      const wDur = w.endMs - w.beginMs
      if (w.text.length === 0 || wDur <= 0) return w.beginMs
      return w.beginMs + ((charIndex - wStart) / w.text.length) * wDur
    }
    if (charIndex === wEnd) {
      // Boundary (space) — use this word's end.
      return w.endMs
    }
    pos = wEnd + 1 // skip the space separator
  }
  // Past the last word — use its end.
  return words[words.length - 1].endMs
}

/**
 * Find the active highlight chord at the given time, looking across lines.
 * A chord stays highlighted until the next chord starts, even past its own
 * line's end — unless a chord-less line sits between them (gap rule).
 */
function findActiveHighlightChord(
  lines: LyricLine[],
  t: number,
): { lineIndex: number; charIndex: number } | null {
  // Find the last line that has started (beginMs <= t)
  let startIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].beginMs <= t) { startIdx = i; break }
  }
  if (startIdx < 0) return null

  for (let i = startIdx; i >= 0; i--) {
    const line = lines[i]
    if (!line.chords.length) return null   // gap line: stop searching

    const sorted = [...line.chords].sort((a, b) => a.charIndex - b.charIndex)
    let active: ChordPosition | null = null
    for (const c of sorted) {
      if (chordTimeMs(line, c.charIndex) <= t) active = c
      else break
    }
    if (active) return { lineIndex: i, charIndex: active.charIndex }
    // Line has chords but none have started yet — look at the previous line
  }
  return null
}
import { findActiveLineIndex } from '~/composables/useTtmlParser'

const props = defineProps<{
  lines: LyricLine[]
  currentTimeMs: number
  isPlaying: boolean
  transposition: number
}>()

const emit = defineEmits<{
  seekTo: [timeMs: number]
  chordsUpdated: [lineIndex: number, chords: ChordPosition[]]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const lineRefs = ref<({ el: HTMLDivElement | null } | null)[]>([])

const activeLineIndex = computed(() =>
  findActiveLineIndex(props.lines, props.currentTimeMs)
)

const activeHighlightChord = computed(() =>
  findActiveHighlightChord(props.lines, props.currentTimeMs)
)

const prevActiveIndex = ref(-1)

watch(activeLineIndex, (newIdx) => {
  if (newIdx !== prevActiveIndex.value && newIdx >= 0) {
    prevActiveIndex.value = newIdx
    nextTick(() => scrollToLine(newIdx))
  }
})

function scrollToLine(index: number) {
  const lineComp = lineRefs.value[index]
  const container = containerRef.value
  if (!lineComp?.el || !container) return
  const containerRect = container.getBoundingClientRect()
  const elRect = lineComp.el.getBoundingClientRect()
  const targetOffset = containerRect.height * 0.25
  const scrollDelta = elRect.top - containerRect.top - targetOffset
  container.scrollBy({ top: scrollDelta, behavior: 'smooth' })
}

/** Max gap (ms) across which the ending line stays highlighted instead of flashing out. */
const ACTIVE_LINE_HOLD_MS = 2000

function getLineClass(line: LyricLine, index: number): string {
  const active = activeLineIndex.value
  if (index === active) {
    const withinBounds = line.endMs <= 0 || props.currentTimeMs <= line.endMs
    if (withinBounds) return 'line active'
    // Line has ended — stay active if the gap to the next line is short enough
    const nextLine = props.lines[index + 1]
    const gap = nextLine ? nextLine.beginMs - line.endMs : Infinity
    if (gap < ACTIVE_LINE_HOLD_MS) return 'line active'
  }
  if (active >= 0 && index <= active) return 'line past'
  if (line.isBackground) return 'line background'
  return 'line upcoming'
}

function setLineRef(comp: unknown, index: number) {
  lineRefs.value[index] = comp as { el: HTMLDivElement | null } | null
}
</script>

<template>
  <div ref="containerRef" class="lyrics-container">
    <div class="lyrics-spacer-top"></div>

    <LyricLine
      v-for="(line, index) in lines"
      :key="index"
      :ref="(comp) => setLineRef(comp, index)"
      :line="line"
      :line-index="index"
      :line-class="getLineClass(line, index)"
      :transposition="transposition"
      :current-time-ms="currentTimeMs"
      :is-playing="isPlaying"
      :active-chord-char-index="activeHighlightChord?.lineIndex === index ? activeHighlightChord.charIndex : null"
      @seek-to="emit('seekTo', $event)"
      @chords-updated="(idx, chords) => emit('chordsUpdated', idx, chords)"
    />

    <div class="lyrics-spacer-bottom"></div>
  </div>
</template>

<style scoped>
.lyrics-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 calc(32px + env(safe-area-inset-right, 0px)) 0 calc(32px + env(safe-area-inset-left, 0px));
  scroll-behavior: smooth;
  mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 10%,
    black 85%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0%,
    black 10%,
    black 85%,
    transparent 100%
  );
}

/* Hide scrollbar */
.lyrics-container::-webkit-scrollbar {
  display: none;
}
.lyrics-container {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.lyrics-spacer-top {
  height: 25vh;
}

.lyrics-spacer-bottom {
  height: 60vh;
}

@media (max-width: 600px) {
  .lyrics-container {
    padding: 0 calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px));
  }
}
</style>
