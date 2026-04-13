<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { LyricLine, ChordPosition } from '~/types'
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

function getLineClass(line: LyricLine, index: number): string {
  const active = activeLineIndex.value
  if (index === active) return 'line active'
  if (active >= 0 && index < active) return 'line past'
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
