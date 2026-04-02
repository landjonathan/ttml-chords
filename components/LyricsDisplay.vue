<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import type { LyricLine, ChordPosition } from '~/types'
import { findActiveLineIndex } from '~/composables/useTtmlParser'
import { parse as parseChord, transpose as transposeChord, prettyPrint } from 'chord-magic'

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
const lineRefs = ref<(HTMLDivElement | null)[]>([])

// Chord editing state
const hoveredChordIdx = ref<{ line: number; charIndex: number } | null>(null)
const editingChordIdx = ref<{ line: number; charIndex: number } | null>(null)
const editingOriginCharIdx = ref(-1)
// Buffered chord state for the line being edited
const pendingChords = ref<ChordPosition[]>([])

const isChordHovered = (lineIdx: number, charIndex: number) =>
  hoveredChordIdx.value?.line === lineIdx && hoveredChordIdx.value?.charIndex === charIndex

const isChordEditing = (lineIdx: number, charIndex: number) =>
  editingChordIdx.value?.line === lineIdx && editingChordIdx.value?.charIndex === charIndex

const showPopover = (lineIdx: number, charIndex: number) =>
  isChordEditing(lineIdx, charIndex) || isChordHovered(lineIdx, charIndex)

/** Get the effective chords for a line (pending edits or props). */
const lineChords = (lineIdx: number): ChordPosition[] => {
  if (editingChordIdx.value?.line === lineIdx && pendingChords.value.length > 0) {
    return pendingChords.value
  }
  return props.lines[lineIdx]?.chords ?? []
}

const editingDirty = computed(() => {
  if (!editingChordIdx.value) return false
  const original = props.lines[editingChordIdx.value.line]?.chords
  if (!original || pendingChords.value.length === 0) return false
  return JSON.stringify(original) !== JSON.stringify(pendingChords.value)
})

/** Check if moving in a direction would swap with another chord. */
const wouldSwap = (direction: -1 | 1) => {
  if (!editingChordIdx.value || pendingChords.value.length === 0) return false
  const current = editingChordIdx.value.charIndex
  const target = current + direction
  return pendingChords.value.some((c) => c.charIndex === target)
}

/**
 * Build word segments for a line, splitting words at chord boundaries.
 * Each segment: { text, chord?, charIndex (absolute in line) }
 */
interface WordSegment {
  text: string
  chord?: string
  charIndex: number
}

const buildWordSegments = (lineIdx: number, wordText: string, wordStart: number): WordSegment[] => {
  const chords = lineChords(lineIdx)
  // Find chords that fall within this word's character range
  const wordEnd = wordStart + wordText.length
  const wordChords = chords
    .filter((c) => c.charIndex >= wordStart && c.charIndex < wordEnd)
    .sort((a, b) => a.charIndex - b.charIndex)

  if (wordChords.length === 0) {
    return [{ text: wordText, charIndex: wordStart }]
  }

  const segments: WordSegment[] = []
  let pos = 0

  for (const { chord, charIndex } of wordChords) {
    const offset = charIndex - wordStart
    // Text before this chord
    if (offset > pos) {
      segments.push({ text: wordText.slice(pos, offset), charIndex: wordStart + pos })
    }
    // Segment starting at chord position (extends to next chord or end of word)
    const nextChordOffset = wordChords.find((c) => c.charIndex > charIndex)
    const segEnd = nextChordOffset ? nextChordOffset.charIndex - wordStart : wordText.length
    segments.push({ text: wordText.slice(offset, segEnd), chord, charIndex })
    pos = segEnd
  }

  // Remaining text after last chord
  if (pos < wordText.length) {
    segments.push({ text: wordText.slice(pos), charIndex: wordStart + pos })
  }

  return segments
}

/** Compute the start character index of a word within the line text. */
const wordStartIndex = (line: LyricLine, wIdx: number) => {
  const regex = /\S+/g
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = regex.exec(line.text)) !== null) {
    if (idx === wIdx) return match.index
    idx++
  }
  // Fallback: accumulate with single-space assumption
  let pos = 0
  for (let i = 0; i < wIdx; i++) {
    pos += line.words[i].text.length + 1
  }
  return pos
}

function onChordEnter(lineIdx: number, charIndex: number) {
  if (editingChordIdx.value) return
  hoveredChordIdx.value = { line: lineIdx, charIndex }
}

function onChordLeave() {
  if (editingChordIdx.value) return
  hoveredChordIdx.value = null
}

function startEditing(lineIdx: number, charIndex: number, e: Event) {
  e.stopPropagation()
  editingChordIdx.value = { line: lineIdx, charIndex }
  hoveredChordIdx.value = { line: lineIdx, charIndex }
  editingOriginCharIdx.value = charIndex
  pendingChords.value = props.lines[lineIdx].chords.map((c) => ({ ...c }))
  emit('seekTo', props.lines[lineIdx].beginMs)
}

function revertEditing(e: Event) {
  e.stopPropagation()
  if (!editingChordIdx.value) return
  const lineIdx = editingChordIdx.value.line
  pendingChords.value = props.lines[lineIdx].chords.map((c) => ({ ...c }))
  editingChordIdx.value = { line: lineIdx, charIndex: editingOriginCharIdx.value }
  hoveredChordIdx.value = { line: lineIdx, charIndex: editingOriginCharIdx.value }
}

function commitEditing(e: Event) {
  e.stopPropagation()
  if (editingChordIdx.value && editingDirty.value) {
    emit('chordsUpdated', editingChordIdx.value.line, [...pendingChords.value])
  }
  editingChordIdx.value = null
  hoveredChordIdx.value = null
  pendingChords.value = []
}

function onClickOutside(e: MouseEvent) {
  if (!editingChordIdx.value) return
  if (editingDirty.value) return
  const target = e.target as HTMLElement
  if (target.closest('.chord-popover') || target.closest('.chord-editing')) return
  editingChordIdx.value = null
  hoveredChordIdx.value = null
  pendingChords.value = []
}

onMounted(() => document.addEventListener('pointerdown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onClickOutside))

function moveChord(direction: -1 | 1, e: Event) {
  e.stopPropagation()
  if (!editingChordIdx.value) return
  const { line, charIndex } = editingChordIdx.value
  const textLen = props.lines[line]?.text.length ?? 0
  const target = charIndex + direction
  if (target < 0 || target >= textLen) return

  // Recompute from original: only the edited chord moves
  const original = props.lines[line].chords.map((c) => ({ ...c }))
  const existing = original.find((c) => c.charIndex === target)

  pendingChords.value = original.map((c) => {
    if (c.charIndex === editingOriginCharIdx.value) return { ...c, charIndex: target }
    if (existing && c.charIndex === target) return { ...c, charIndex: editingOriginCharIdx.value }
    return { ...c }
  })

  editingChordIdx.value = { line, charIndex: target }
  hoveredChordIdx.value = { line, charIndex: target }
}

const activeLineIndex = computed(() =>
  findActiveLineIndex(props.lines, props.currentTimeMs)
)

// Track previous active line for scroll triggering
const prevActiveIndex = ref(-1)

watch(activeLineIndex, (newIdx) => {
  if (newIdx !== prevActiveIndex.value && newIdx >= 0) {
    prevActiveIndex.value = newIdx
    nextTick(() => scrollToLine(newIdx))
  }
})

function scrollToLine(index: number) {
  const el = lineRefs.value[index]
  const container = containerRef.value
  if (!el || !container) return

  const containerRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()

  // Target: position the active line about 25% from the top
  const targetOffset = containerRect.height * 0.25
  const currentOffset = elRect.top - containerRect.top
  const scrollDelta = currentOffset - targetOffset

  container.scrollBy({
    top: scrollDelta,
    behavior: 'smooth',
  })
}

function getLineClass(line: LyricLine, index: number): string {
  const active = activeLineIndex.value
  if (index === active) return 'line active'
  if (active >= 0 && index < active) return 'line past'
  if (line.isBackground) return 'line background'
  return 'line upcoming'
}

function hasChords(line: LyricLine): boolean {
  return line.chords.length > 0
}

const displayChord = (chord: string) => {
  if (!props.transposition) return chord
  const parsed = parseChord(chord)
  if (!parsed) return chord
  return prettyPrint(transposeChord(parsed, props.transposition))
}

function onLineClick(line: LyricLine) {
  if (editingChordIdx.value) return
  emit('seekTo', line.beginMs)
}

function setLineRef(el: unknown, index: number) {
  lineRefs.value[index] = el as HTMLDivElement | null
}
</script>

<template>
  <div ref="containerRef" class="lyrics-container">
    <div class="lyrics-spacer-top"></div>

    <div
      v-for="(line, index) in lines"
      :key="index"
      :ref="(el) => setLineRef(el, index)"
      :class="getLineClass(line, index)"
      @click="onLineClick(line)"
    >
      <!-- Line with chords -->
      <template v-if="hasChords(line) || lineChords(index).length > 0">
        <span
          v-for="(word, wIdx) in line.words"
          :key="wIdx"
          class="word word-has-chord"
        >
          <template v-for="(seg, sIdx) in buildWordSegments(index, word.text, wordStartIndex(line, wIdx))" :key="sIdx">
            <span v-if="seg.chord" class="segment-with-chord">
              <span
                class="chord-label chord-interactive"
                :class="{ 'chord-editing': isChordEditing(index, seg.charIndex) }"
                @mouseenter="onChordEnter(index, seg.charIndex)"
                @mouseleave="onChordLeave"
              >
                {{ displayChord(seg.chord) }}

                <!-- Popover -->
                <span v-if="showPopover(index, seg.charIndex)" class="chord-popover" @click.stop>
                  <template v-if="isChordEditing(index, seg.charIndex)">
                    <button v-if="editingDirty" class="pop-btn pop-revert" @click="revertEditing($event)">✕</button>
                    <button class="pop-btn" :class="{ 'pop-swap': wouldSwap(-1) }" :disabled="seg.charIndex === 0" @click="moveChord(-1, $event)">{{ wouldSwap(-1) ? '⇆' : '‹' }}</button>
                    <button class="pop-btn" :class="{ 'pop-swap': wouldSwap(1) }" :disabled="seg.charIndex >= line.text.length - 1" @click="moveChord(1, $event)">{{ wouldSwap(1) ? '⇆' : '›' }}</button>
                    <button v-if="editingDirty" class="pop-btn pop-done" @click="commitEditing($event)">✓</button>
                  </template>
                  <button v-else class="pop-btn" @click="startEditing(index, seg.charIndex, $event)">✎</button>
                </span>
              </span>
              <span class="word-text">{{ seg.text }}</span>
            </span>
            <span v-else class="word-text">{{ seg.text }}</span>
          </template>
        </span>
        <!-- Trailing chords (charIndex >= text length) -->
        <span
          v-for="tc in lineChords(index).filter(c => c.charIndex >= line.text.length)"
          :key="'t' + tc.charIndex"
          class="word word-has-chord"
        >
          <span class="segment-with-chord">
            <span
              class="chord-label chord-interactive"
              :class="{ 'chord-editing': isChordEditing(index, tc.charIndex) }"
              @mouseenter="onChordEnter(index, tc.charIndex)"
              @mouseleave="onChordLeave"
            >
              {{ displayChord(tc.chord) }}
            </span>
            <span class="word-text">​</span>
          </span>
        </span>
      </template>

      <!-- Plain text -->
      <template v-else>
        {{ line.text }}
      </template>

    </div>

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

.line {
  padding: 8px 0;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
  font-weight: 700;
  line-height: 2;
  user-select: none;
}

.line:hover {
  opacity: 0.9 !important;
}

.line.active {
  font-size: 2rem;
  color: rgba(255, 255, 255, 1);
  opacity: 1;
  transform: scale(1);
  padding: 1em 0;
}

.line.past {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.3);
  opacity: 1;
}

.line.upcoming {
  font-size: 1.5rem;
  color: rgba(255, 255, 255, 0.45);
  opacity: 1;
}

.line.background {
  font-size: 1.2rem;
  color: rgba(255, 255, 255, 0.25);
  font-style: italic;
}

/* Words */
.word {
  display: inline-block;
  margin-right: 0.25em;
}

/* Chord annotations */
.word-has-chord {
  position: relative;
  padding-top: 0.7em;
}

.segment-with-chord {
  position: relative;
  display: inline;
}

.chord-label {
  position: absolute;
  bottom: 100%;
  left: 0;
  font-size: 0.6em;
  font-weight: 700;
  color: #5ac8fa;
  white-space: nowrap;
  pointer-events: none;
  letter-spacing: 0.02em;
}

.chord-label.chord-interactive {
  pointer-events: auto;
  cursor: default;
  border-radius: 3px;
  padding: 0 2px;
  margin: -1px -2px;
  transition: background 0.15s;
}

.chord-label.chord-interactive:hover {
  background: rgba(90, 200, 250, 0.12);
}

.chord-label.chord-editing {
  background: rgba(90, 200, 250, 0.2);
}

.chord-popover {
  position: absolute;
  top: -28px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  background: rgba(30, 30, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 2px;
  backdrop-filter: blur(8px);
  z-index: 20;
  pointer-events: auto;
}

.pop-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s;
}

.pop-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.pop-btn:disabled {
  opacity: 0.2;
  cursor: default;
}

.pop-swap {
  color: #ffd60a;
  font-size: 11px;
}

.pop-revert {
  color: #ff453a;
}

.pop-revert:hover {
  background: rgba(255, 69, 58, 0.15);
}

.pop-done {
  color: #30d158;
}

.pop-done:hover {
  background: rgba(48, 209, 88, 0.15);
}

.line.past .chord-label {
  color: rgba(90, 200, 250, 0.5);
}

/* Responsive */
@media (max-width: 600px) {
  .line.active {
    font-size: 1.6rem;
  }
  .line.past,
  .line.upcoming {
    font-size: 1.2rem;
  }
  .lyrics-container {
    padding: 0 calc(20px + env(safe-area-inset-right, 0px)) 0 calc(20px + env(safe-area-inset-left, 0px));
  }
}
</style>
