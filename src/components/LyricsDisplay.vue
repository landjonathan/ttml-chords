<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { LyricLine } from '../types'
import { findActiveLineIndex } from '../composables/useTtmlParser'

const props = defineProps<{
  lines: LyricLine[]
  currentTimeMs: number
  isPlaying: boolean
}>()

const emit = defineEmits<{
  seekTo: [timeMs: number]
}>()

const containerRef = ref<HTMLDivElement | null>(null)
const lineRefs = ref<(HTMLDivElement | null)[]>([])

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

function isWordActive(word: { beginMs: number; endMs: number }): boolean {
  return props.currentTimeMs >= word.beginMs && props.currentTimeMs < word.endMs
}

function isWordPast(word: { beginMs: number; endMs: number }): boolean {
  return props.currentTimeMs >= word.endMs
}

function getWordProgress(word: { beginMs: number; endMs: number }): number {
  if (props.currentTimeMs < word.beginMs) return 0
  if (props.currentTimeMs >= word.endMs) return 100
  const duration = word.endMs - word.beginMs
  if (duration <= 0) return 100
  return ((props.currentTimeMs - word.beginMs) / duration) * 100
}

function hasChords(line: LyricLine): boolean {
  return line.words.some((w) => !!w.chord)
}

function onLineClick(line: LyricLine) {
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
      <!-- Word-level highlighting -->
      <template v-if="line.words.length > 0 && index === activeLineIndex">
        <span
          v-for="(word, wIdx) in line.words"
          :key="wIdx"
          class="word"
          :class="{
            'word-active': isWordActive(word),
            'word-past': isWordPast(word),
            'word-upcoming': !isWordActive(word) && !isWordPast(word),
            'word-has-chord': !!word.chord,
          }"
        >
          <span v-if="word.chord" class="chord-label">{{ word.chord }}</span>
          <span class="word-fill" :style="{ width: getWordProgress(word) + '%' }"></span>
          <span class="word-text">{{ word.text }}</span>
        </span>
      </template>

      <!-- Non-active lines with chords (show chords but no fill animation) -->
      <template v-else-if="line.words.length > 0 && hasChords(line)">
        <span
          v-for="(word, wIdx) in line.words"
          :key="wIdx"
          class="word word-static"
          :class="{
            'word-has-chord': !!word.chord,
          }"
        >
          <span v-if="word.chord" class="chord-label">{{ word.chord }}</span>
          <span class="word-text">{{ word.text }}</span>
        </span>
      </template>

      <!-- Line-level display (no word timing and no chords) -->
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
  line-height: 1.3;
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
  padding: 12px 0;
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

/* Word-level highlighting */
.word {
  position: relative;
  display: inline-block;
  margin-right: 0.25em;
  color: rgba(255, 255, 255, 0.4);
  transition: color 0.15s ease;
}

.word-text {
  position: relative;
  z-index: 1;
}

.word-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  transition: width 0.05s linear;
  z-index: 0;
}

.word-active {
  color: rgba(255, 255, 255, 1);
}

.word-active .word-fill {
  background: rgba(255, 255, 255, 0.12);
}

.word-past {
  color: rgba(255, 255, 255, 0.85);
}

.word-past .word-fill {
  width: 100% !important;
  background: transparent;
}

.word-upcoming {
  color: rgba(255, 255, 255, 0.35);
}

.word-static {
  color: rgba(255, 255, 255, 0.45);
}

.line.past .word-static {
  color: rgba(255, 255, 255, 0.3);
}

/* Chord annotations */
.word-has-chord {
  position: relative;
  padding-top: 1.3em;
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

.word-active .chord-label {
  color: #5ac8fa;
}

.word-past .chord-label {
  color: rgba(90, 200, 250, 0.5);
}

.word-upcoming .chord-label,
.word-static .chord-label {
  color: rgba(90, 200, 250, 0.6);
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
