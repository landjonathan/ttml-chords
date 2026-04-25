<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { LyricLine, LyricWord, ChordPosition } from '~/types'
import { parse as parseChord, transpose as transposeChord, prettyPrint } from 'chord-magic'

const props = defineProps<{
  line: LyricLine
  lineIndex: number
  lineClass: string
  transposition: number
  currentTimeMs: number
  isPlaying: boolean
  activeChordCharIndex: number | null
}>()

const emit = defineEmits<{
  seekTo: [timeMs: number]
  chordsUpdated: [lineIndex: number, chords: ChordPosition[]]
}>()

const el = ref<HTMLDivElement | null>(null)
defineExpose({ el })

// Gradient state for chord lines without word timing.
// Because chord activation time and chord character-position are both
// proportional to `charIndex / textLen` (when no word timing is present),
// a simple linear line-progress gradient is naturally synced to each
// chord's position when that chord activates. No DOM measurement needed.

// Local RAF clock that extrapolates between sparse `currentTimeMs` prop
// updates (HTMLMediaElement `timeupdate` can fire as slowly as ~4 Hz).
// `smoothedTimeMs` advances every animation frame using the wall-clock delta
// since the last received prop value, so the gradient interpolates smoothly.
const smoothedTimeMs = ref(props.currentTimeMs)
let lastReceivedTimeMs = props.currentTimeMs
let lastReceivedAt = typeof performance !== 'undefined' ? performance.now() : 0
let rafId = 0

function tickClock () {
  if (props.isPlaying) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    smoothedTimeMs.value = lastReceivedTimeMs + (now - lastReceivedAt)
  }
  rafId = requestAnimationFrame(tickClock)
}

watch(
  () => props.currentTimeMs,
  (val) => {
    lastReceivedTimeMs = val
    lastReceivedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    smoothedTimeMs.value = val
  },
)

watch(
  () => props.isPlaying,
  (playing) => {
    if (playing) {
      // Reset baseline so the paused duration isn't counted as elapsed.
      lastReceivedTimeMs = props.currentTimeMs
      lastReceivedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    } else {
      smoothedTimeMs.value = props.currentTimeMs
    }
  },
)

const gradientStyle = computed(() => {
  const t = smoothedTimeMs.value
  const line = props.line
  const duration = line.endMs - line.beginMs
  if (duration <= 0) return { width: '0%' }
  const progress = (t - line.beginMs) / duration
  const pct = Math.min(100, Math.max(0, progress * 100))
  return { width: `${pct}%` }
})

const hoveredCharIndex = ref<number | null>(null)
const editingCharIndex = ref<number | null>(null)
const editingOriginCharIndex = ref(-1)
const pendingChords = ref<ChordPosition[]>([])
const isMoveMode = ref(false)
const moveModeOriginCharIndex = ref(-1)

const isChordHovered = (ci: number) => hoveredCharIndex.value === ci
const isChordEditing = (ci: number) => editingCharIndex.value === ci
const showPopover = (ci: number) => isChordEditing(ci) || isChordHovered(ci)

const isChordActive = (ci: number) =>
  props.activeChordCharIndex === ci && editingCharIndex.value === null

const lineChords = (): ChordPosition[] => {
  if (editingCharIndex.value !== null && pendingChords.value.length > 0) return pendingChords.value
  return props.line.chords ?? []
}

const editingDirty = computed(() => {
  if (editingCharIndex.value === null) return false
  const original = props.line.chords
  if (!original || pendingChords.value.length === 0) return false
  return JSON.stringify(original) !== JSON.stringify(pendingChords.value)
})

const wouldSwap = (direction: -1 | 1) =>
  editingCharIndex.value !== null &&
  pendingChords.value.some((c) => c.charIndex === editingCharIndex.value! + direction)

interface WordSegment { text: string; chord?: string; charIndex: number }

const buildWordSegments = (wordText: string, wordStart: number): WordSegment[] => {
  const chords = lineChords()
  const wordEnd = wordStart + wordText.length
  const wordChords = chords
    .filter((c) => c.charIndex >= wordStart && c.charIndex < wordEnd)
    .sort((a, b) => a.charIndex - b.charIndex)
  if (wordChords.length === 0) return [{ text: wordText, charIndex: wordStart }]
  const segments: WordSegment[] = []
  let pos = 0
  for (const { chord, charIndex } of wordChords) {
    const offset = charIndex - wordStart
    if (offset > pos) segments.push({ text: wordText.slice(pos, offset), charIndex: wordStart + pos })
    const nextChordOffset = wordChords.find((c) => c.charIndex > charIndex)
    const segEnd = nextChordOffset ? nextChordOffset.charIndex - wordStart : wordText.length
    segments.push({ text: wordText.slice(offset, segEnd), chord, charIndex })
    pos = segEnd
  }
  if (pos < wordText.length) segments.push({ text: wordText.slice(pos), charIndex: wordStart + pos })
  return segments
}

const wordStartIndex = (wIdx: number) => {
  const regex = /\S+/g
  let match: RegExpExecArray | null
  let idx = 0
  while ((match = regex.exec(props.line.text)) !== null) {
    if (idx === wIdx) return match.index
    idx++
  }
  let pos = 0
  for (let i = 0; i < wIdx; i++) pos += props.line.words[i].text.length + 1
  return pos
}

const displayChord = (chord: string) => {
  if (!props.transposition) return chord
  const parsed = parseChord(chord)
  if (!parsed) return chord
  return prettyPrint(transposeChord(parsed, props.transposition))
}

// Distinguish real word-level timings from the synthetic fallback words the
// parser creates for chord lines that lacked per-word spans in the source.
const hasWordTiming = computed(() => {
  const ws = props.line.words
  if (ws.length === 0) return false
  return ws.some((w) => w.beginMs !== props.line.beginMs || w.endMs !== props.line.endMs)
})

const wordStateClass = (word: LyricWord): string => {
  if (!hasWordTiming.value) return ''
  const t = props.currentTimeMs
  if (word.endMs > 0 && t >= word.endMs) return 'word-past'
  if (t >= word.beginMs) return 'word-active'
  return 'word-upcoming'
}

function hasChords(): boolean { return props.line.chords.length > 0 }

function onChordEnter(ci: number) {
  if (editingCharIndex.value !== null) return
  hoveredCharIndex.value = ci
}
function onChordLeave() {
  if (editingCharIndex.value !== null) return
  hoveredCharIndex.value = null
}
function startEditing(ci: number, e: Event) {
  e.stopPropagation()
  editingCharIndex.value = ci
  hoveredCharIndex.value = ci
  editingOriginCharIndex.value = ci
  pendingChords.value = props.line.chords.map((c) => ({ ...c }))
  emit('seekTo', props.line.beginMs)
}
function revertEditing(e: Event) {
  e.stopPropagation()
  if (editingCharIndex.value === null) return
  pendingChords.value = props.line.chords.map((c) => ({ ...c }))
  editingCharIndex.value = editingOriginCharIndex.value
  hoveredCharIndex.value = editingOriginCharIndex.value
}
function commitEditing(e: Event) {
  e.stopPropagation()
  if (editingCharIndex.value !== null && editingDirty.value)
    emit('chordsUpdated', props.lineIndex, [...pendingChords.value])
  editingCharIndex.value = null
  hoveredCharIndex.value = null
  pendingChords.value = []
}
function onClickOutside(e: MouseEvent) {
  if (editingCharIndex.value === null) return
  const target = e.target as HTMLElement
  if (target.closest('.chord-popover') || target.closest('.chord-editing')) return
  if (isMoveMode.value) {
    cancelMoveMode()
    editingCharIndex.value = null
    hoveredCharIndex.value = null
    pendingChords.value = []
    return
  }
  if (editingDirty.value) return
  editingCharIndex.value = null
  hoveredCharIndex.value = null
  pendingChords.value = []
}

function moveChordTo(target: number) {
  const original = props.line.chords.map((c) => ({ ...c }))
  const existing = original.find((c) => c.charIndex === target)
  pendingChords.value = original.map((c) => {
    if (c.charIndex === editingOriginCharIndex.value) return { ...c, charIndex: target }
    if (existing && c.charIndex === target) return { ...c, charIndex: editingOriginCharIndex.value }
    return { ...c }
  })
  editingCharIndex.value = target
  hoveredCharIndex.value = target
}
function moveChord(direction: -1 | 1, e: Event) {
  e.stopPropagation()
  if (editingCharIndex.value === null) return
  const text = props.line.text ?? ''
  let target = editingCharIndex.value + direction
  while (target >= 0 && target < text.length && /\s/.test(text[target])) target += direction
  if (target < 0 || target >= text.length) return
  moveChordTo(target)
}
function charIndexFromX(clientX: number): number | null {
  const lineEl = el.value
  if (!lineEl) return null
  const wordEls = Array.from(lineEl.querySelectorAll('.word'))
  const wordCount = Math.min(wordEls.length, props.line.words.length)
  for (let w = 0; w < wordCount; w++) {
    const rect = wordEls[w].getBoundingClientRect()
    if (clientX >= rect.left && clientX <= rect.right) {
      const ws = wordStartIndex(w)
      const wLen = props.line.words[w].text.length
      if (wLen === 0) return ws
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      return ws + Math.min(Math.round(fraction * (wLen - 1)), wLen - 1)
    }
  }
  let bestDist = Infinity, bestWIdx = 0
  for (let w = 0; w < wordCount; w++) {
    const rect = wordEls[w].getBoundingClientRect()
    const dist = clientX < rect.left ? rect.left - clientX : clientX - rect.right
    if (dist < bestDist) { bestDist = dist; bestWIdx = w }
  }
  const rect = wordEls[bestWIdx].getBoundingClientRect()
  const ws = wordStartIndex(bestWIdx)
  const wLen = props.line.words[bestWIdx].text.length
  if (clientX <= rect.left) return ws
  return ws + Math.max(wLen - 1, 0)
}
function clampBetweenChords(target: number): number {
  const currentCi = editingCharIndex.value ?? -1
  const others = pendingChords.value
    .filter((c) => c.charIndex !== currentCi)
    .map((c) => c.charIndex)
    .sort((a, b) => a - b)
  let lower = 0, upper = props.line.text.length - 1
  for (const ci of others) {
    if (ci < target) lower = Math.max(lower, ci + 1)
    else { upper = Math.min(upper, ci - 1); break }
  }
  return Math.max(lower, Math.min(upper, target))
}
function moveChordPosition(target: number) {
  if (editingCharIndex.value === null) return
  const cur = editingCharIndex.value
  pendingChords.value = pendingChords.value.map((c) =>
    c.charIndex === cur ? { ...c, charIndex: target } : { ...c },
  )
  editingCharIndex.value = target
  hoveredCharIndex.value = target
}
function enterMoveMode(e: Event) {
  e.stopPropagation()
  if (editingCharIndex.value === null) return
  moveModeOriginCharIndex.value = editingCharIndex.value
  isMoveMode.value = true
}
function exitMoveMode(e: Event) { e.stopPropagation(); isMoveMode.value = false }
function cancelMoveMode() {
  if (!isMoveMode.value || editingCharIndex.value === null) return
  moveChordPosition(moveModeOriginCharIndex.value)
  isMoveMode.value = false
}
function onDocumentMouseMove(e: MouseEvent) {
  if (!isMoveMode.value || editingCharIndex.value === null) return
  const raw = charIndexFromX(e.clientX)
  if (raw === null) return
  const text = props.line.text ?? ''
  let target = raw
  if (target >= 0 && target < text.length && /\s/.test(text[target])) {
    let left = target, right = target
    while (left >= 0 && /\s/.test(text[left])) left--
    while (right < text.length && /\s/.test(text[right])) right++
    target = (raw - left <= right - raw && left >= 0) ? left : (right < text.length ? right : left)
  }
  if (target < 0 || target >= text.length) return
  const clamped = clampBetweenChords(target)
  if (clamped === editingCharIndex.value) return
  moveChordPosition(clamped)
}
function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isMoveMode.value) cancelMoveMode()
}
function onLineClick() {
  if (editingCharIndex.value !== null) return
  emit('seekTo', props.line.beginMs)
}
onMounted(() => {
  document.addEventListener('pointerdown', onClickOutside)
  document.addEventListener('mousemove', onDocumentMouseMove)
  document.addEventListener('keydown', onKeyDown)
  if (typeof requestAnimationFrame !== 'undefined') {
    rafId = requestAnimationFrame(tickClock)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onClickOutside)
  document.removeEventListener('mousemove', onDocumentMouseMove)
  document.removeEventListener('keydown', onKeyDown)
  if (rafId && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(rafId)
})

</script>

<template>
  <div ref="el" :class="lineClass" @click="onLineClick">
    <span v-if="line.songPart" class="song-part-label">{{ line.songPart }}</span>
    <span v-if="hasChords() || lineChords().length > 0" class="chord-frame">
      <span class="chord-frame-gradient" :class="{ 'chord-frame-gradient-dim': hasWordTiming }" :style="gradientStyle" />
      <span v-for="(word, wIdx) in line.words" :key="wIdx" class="word word-has-chord" :class="wordStateClass(word)">
        <template v-for="(seg, sIdx) in buildWordSegments(word.text, wordStartIndex(wIdx))" :key="sIdx">
          <span v-if="seg.chord" class="segment-with-chord">
            <span
              class="chord-label chord-interactive"
              :data-char-index="seg.charIndex"
              :class="{ 'chord-active': isChordActive(seg.charIndex), 'chord-editing': isChordEditing(seg.charIndex), 'chord-moving': isMoveMode && isChordEditing(seg.charIndex) }"
              @mouseenter="onChordEnter(seg.charIndex)"
              @mouseleave="onChordLeave"
            >
              {{ displayChord(seg.chord) }}
              <span v-if="showPopover(seg.charIndex)" class="chord-popover" @click.stop>
                <template v-if="isChordEditing(seg.charIndex)">
                  <template v-if="isMoveMode">
                    <button class="pop-btn pop-move-confirm" @click="exitMoveMode($event)">✓</button>
                  </template>
                  <template v-else>
                    <button v-if="editingDirty" class="pop-btn pop-revert" @click="revertEditing($event)">✕</button>
                    <button class="pop-btn" :class="{ 'pop-swap': wouldSwap(-1) }" :disabled="seg.charIndex === 0" @click="moveChord(-1, $event)">{{ wouldSwap(-1) ? '⇆' : '‹' }}</button>
                    <button class="pop-btn" :class="{ 'pop-swap': wouldSwap(1) }" :disabled="seg.charIndex >= line.text.length - 1" @click="moveChord(1, $event)">{{ wouldSwap(1) ? '⇆' : '›' }}</button>
                    <button class="pop-btn pop-move" @click="enterMoveMode($event)">⇔</button>
                    <button v-if="editingDirty" class="pop-btn pop-done" @click="commitEditing($event)">✓</button>
                  </template>
                </template>
                <button v-else class="pop-btn" @click="startEditing(seg.charIndex, $event)">✎</button>
              </span>
            </span>
            <span class="word-text">{{ seg.text }}</span>
          </span>
          <span v-else class="word-text">{{ seg.text }}</span>
        </template>
      </span>
      <span
        v-for="tc in lineChords().filter(c => c.charIndex >= line.text.length)"
        :key="'t' + tc.charIndex"
        class="word word-has-chord"
      >
        <span class="segment-with-chord">
          <span
            class="chord-label chord-interactive"
            :data-char-index="tc.charIndex"
            :class="{ 'chord-active': isChordActive(tc.charIndex), 'chord-editing': isChordEditing(tc.charIndex) }"
            @mouseenter="onChordEnter(tc.charIndex)"
            @mouseleave="onChordLeave"
          >
            {{ displayChord(tc.chord) }}
          </span>
          <span class="word-text">​</span>
        </span>
      </span>
    </span>
    <template v-else-if="hasWordTiming">
      <span v-for="(word, wIdx) in line.words" :key="wIdx" class="word" :class="wordStateClass(word)"><span class="word-text">{{ word.text }}</span></span>
    </template>
    <template v-else>{{ line.text }}</template>
  </div>
</template>


<style scoped>
.song-part-label {
  display: block;
  font-size: 0.45em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.35);
  margin-bottom: 0.25em;
  line-height: 1;
}

.line {
  padding: 8px 0;
  margin-inline-end: 24px;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
  font-weight: 700;
  line-height: 2;
  user-select: none;
}
.line:hover { opacity: 0.9 !important; }
.line.active {
  font-size: 2rem;
  color: rgba(255, 255, 255, 1);
  opacity: 1;
  transform: scale(1);
  padding: 1em 0;
}
.line.past { font-size: 1.5rem; color: rgba(255, 255, 255, 0.3); opacity: 1; }
.line.upcoming { font-size: 1.5rem; color: rgba(255, 255, 255, 0.45); opacity: 1; }
.line.background { font-size: 1.2rem; color: rgba(255, 255, 255, 0.25); font-style: italic; }
.line.past .chord-label { color: rgba(90, 200, 250, 0.5); }

.word { display: inline-block; margin-right: 0.25em; }
.word-has-chord { position: relative; padding-top: 0.7em; }
.segment-with-chord { position: relative; display: inline; }

/* Frame wrapping all chord-bearing words on a line. The inside gradient
   represents line progress and its right edge is synced with the currently
   highlighted chord. */
.chord-frame {
  position: relative;
  display: block;
  width: fit-content;
  max-width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 0.1em 0.5em 0.15em;
}
.chord-frame-gradient {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 0%;
  background: linear-gradient(to right, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.12));
  border-radius: inherit;
  pointer-events: none;
  opacity: 1;
  /* JS interpolates width continuously from currentTimeMs; short linear
     transition just smooths stepping when audio timeupdate fires at a low
     rate. */
  transition: width 0.1s linear;
  z-index: 0;
}
.chord-frame-gradient-dim { opacity: 0.5; }
.chord-frame > .word { position: relative; z-index: 1; }

/* Progressive word highlighting on the active line. Past/upcoming lines use
   line-level styling so the progressive effect is only visible while singing.
   Opacity is applied to .word-text specifically so chord labels keep their
   own timing-driven highlighting. */
.line.active .word-upcoming .word-text { opacity: 0.4; transition: opacity 0.2s ease; }
.line.active .word-active .word-text { opacity: 1; transition: opacity 0.15s ease; }
.line.active .word-past .word-text { opacity: 0.75; transition: opacity 0.3s ease; }

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
  touch-action: none;
}
.chord-label.chord-interactive:hover { background: rgba(90, 200, 250, 0.12); }
.chord-label.chord-active { background: rgba(90, 200, 250, 0.3); }
.chord-label.chord-editing { background: rgba(90, 200, 250, 0.2); cursor: default; }
.chord-label.chord-moving { cursor: crosshair; }

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
.pop-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); color: white; }
.pop-btn:disabled { opacity: 0.2; cursor: default; }
.pop-swap { color: #ffd60a; font-size: 11px; }
.pop-revert { color: #ff453a; }
.pop-revert:hover { background: rgba(255, 69, 58, 0.15); }
.pop-done { color: #30d158; }
.pop-done:hover { background: rgba(48, 209, 88, 0.15); }
.pop-move { color: rgba(255, 255, 255, 0.55); font-size: 12px; }
.pop-move-confirm { color: #5ac8fa; }
.pop-move-confirm:hover { background: rgba(90, 200, 250, 0.15); }

@media (max-width: 600px) {
  .line.active { font-size: 1.6rem; }
  .line.past, .line.upcoming { font-size: 1.2rem; }
}
</style>
