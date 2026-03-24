<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue'
import type { LyricLine } from '~/types'
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
  chordMoved: [lineIndex: number, fromWord: number, toWord: number]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const lineRefs = ref<(HTMLDivElement | null)[]>([])

// Chord editing state
const hoveredChord = ref<{ line: number; word: number } | null>(null)
const editingChord = ref<{ line: number; word: number } | null>(null)
const editingDirty = ref(false)

const isChordHovered = (lineIdx: number, wIdx: number) =>
  hoveredChord.value?.line === lineIdx && hoveredChord.value?.word === wIdx

const isChordEditing = (lineIdx: number, wIdx: number) =>
  editingChord.value?.line === lineIdx && editingChord.value?.word === wIdx

const showPopover = (lineIdx: number, wIdx: number) =>
  isChordEditing(lineIdx, wIdx) || isChordHovered(lineIdx, wIdx)

function onChordEnter(lineIdx: number, wIdx: number) {
  if (editingChord.value) return
  hoveredChord.value = { line: lineIdx, word: wIdx }
}

function onChordLeave() {
  if (editingChord.value) return
  hoveredChord.value = null
}

function startEditing(lineIdx: number, wIdx: number, e: Event) {
  e.stopPropagation()
  editingChord.value = { line: lineIdx, word: wIdx }
  hoveredChord.value = { line: lineIdx, word: wIdx }
  editingDirty.value = false
  // Seek playback to this line
  emit('seekTo', props.lines[lineIdx].beginMs)
}

function stopEditing(e: Event) {
  e.stopPropagation()
  editingChord.value = null
  hoveredChord.value = null
  editingDirty.value = false
}

function onClickOutside(e: MouseEvent) {
  if (!editingChord.value) return
  // If changes were made, keep editing (user must explicitly confirm)
  if (editingDirty.value) return
  const target = e.target as HTMLElement
  if (target.closest('.chord-popover') || target.closest('.chord-editing')) return
  editingChord.value = null
  hoveredChord.value = null
}

onMounted(() => document.addEventListener('pointerdown', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onClickOutside))

function moveChord(direction: -1 | 1, e: Event) {
  e.stopPropagation()
  if (!editingChord.value) return
  const { line, word } = editingChord.value
  const target = word + direction
  const lineWords = props.lines[line]?.words
  if (!lineWords || target < 0 || target >= lineWords.length) return

  emit('chordMoved', line, word, target)
  editingChord.value = { line, word: target }
  hoveredChord.value = { line, word: target }
  editingDirty.value = true
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
  return line.words.some((w) => !!w.chord)
}

const displayChord = (chord: string) => {
  if (!props.transposition) return chord
  const parsed = parseChord(chord)
  if (!parsed) return chord
  return prettyPrint(transposeChord(parsed, props.transposition))
}

function onLineClick(line: LyricLine) {
  if (editingChord.value) return
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
      <template v-if="hasChords(line)">
        <span
          v-for="(word, wIdx) in line.words"
          :key="wIdx"
          class="word"
          :class="{ 'word-has-chord': !!word.chord }"
        >
          <span
            v-if="word.chord"
            class="chord-label"
            :class="{ 'chord-interactive': true, 'chord-editing': isChordEditing(index, wIdx) }"
            @mouseenter="onChordEnter(index, wIdx)"
            @mouseleave="onChordLeave"
          >
            {{ displayChord(word.chord) }}

            <!-- Popover -->
            <span v-if="showPopover(index, wIdx)" class="chord-popover" @click.stop>
              <template v-if="isChordEditing(index, wIdx)">
                <button class="pop-btn" :disabled="wIdx === 0" @click="moveChord(-1, $event)">‹</button>
                <button class="pop-btn" :disabled="wIdx === line.words.length - 1" @click="moveChord(1, $event)">›</button>
                <button v-if="editingDirty" class="pop-btn pop-done" @click="stopEditing($event)">✓</button>
              </template>
              <button v-else class="pop-btn" @click="startEditing(index, wIdx, $event)">✎</button>
            </span>
          </span>
          <span class="word-text">{{ word.text }}</span>
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
  padding: 0 32px;
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

.chord-label {
  position: absolute;
  top: 0;
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
    padding: 0 20px;
  }
}
</style>
