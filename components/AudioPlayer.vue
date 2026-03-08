<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'

const props = defineProps<{
  src: string | null
  /** If no audio file, allow manual time simulation */
  simulateMode?: boolean
}>()

const emit = defineEmits<{
  timeUpdate: [timeMs: number]
  play: []
  pause: []
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const isSeeking = ref(false)

// Simulation mode state (when no audio file is provided)
const simStartTime = ref(0)
const simOffset = ref(0)
let simRaf = 0

const formattedCurrent = computed(() => formatTime(currentTime.value))
const formattedDuration = computed(() => formatTime(duration.value))
const progress = computed(() => (duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0))

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function togglePlay() {
  if (props.src && audioEl.value) {
    if (isPlaying.value) {
      audioEl.value.pause()
    } else {
      audioEl.value.play()
    }
  } else if (props.simulateMode) {
    if (isPlaying.value) {
      pauseSimulation()
    } else {
      startSimulation()
    }
  }
}

function onTimeUpdate() {
  if (audioEl.value && !isSeeking.value) {
    currentTime.value = audioEl.value.currentTime
    emit('timeUpdate', currentTime.value * 1000)
  }
}

function onLoadedMetadata() {
  if (audioEl.value) {
    duration.value = audioEl.value.duration
  }
}

function onPlay() {
  isPlaying.value = true
  emit('play')
}

function onPause() {
  isPlaying.value = false
  emit('pause')
}

function onSeekInput(e: Event) {
  const input = e.target as HTMLInputElement
  const val = parseFloat(input.value)
  currentTime.value = (val / 100) * duration.value
  isSeeking.value = true
}

function onSeekChange(e: Event) {
  const input = e.target as HTMLInputElement
  const val = parseFloat(input.value)
  const seekTo = (val / 100) * duration.value
  if (audioEl.value) {
    audioEl.value.currentTime = seekTo
  } else if (props.simulateMode) {
    simOffset.value = seekTo
    if (isPlaying.value) {
      simStartTime.value = performance.now()
    }
  }
  currentTime.value = seekTo
  emit('timeUpdate', seekTo * 1000)
  isSeeking.value = false
}

// Simulation mode
function startSimulation() {
  isPlaying.value = true
  simStartTime.value = performance.now()
  emit('play')
  tickSimulation()
}

function pauseSimulation() {
  isPlaying.value = false
  simOffset.value = currentTime.value
  cancelAnimationFrame(simRaf)
  emit('pause')
}

function tickSimulation() {
  if (!isPlaying.value) return
  const elapsed = (performance.now() - simStartTime.value) / 1000
  currentTime.value = simOffset.value + elapsed
  emit('timeUpdate', currentTime.value * 1000)

  if (duration.value > 0 && currentTime.value >= duration.value) {
    isPlaying.value = false
    currentTime.value = duration.value
    emit('pause')
    return
  }

  simRaf = requestAnimationFrame(tickSimulation)
}

// When switching to simulation mode, set a default duration
watch(
  () => props.simulateMode,
  (sim) => {
    if (sim && duration.value === 0) {
      duration.value = 120 // 2 min default for sample
    }
  },
  { immediate: true }
)

watch(
  () => props.src,
  () => {
    // Reset when source changes
    currentTime.value = 0
    isPlaying.value = false
    simOffset.value = 0
    cancelAnimationFrame(simRaf)
  }
)

onUnmounted(() => {
  cancelAnimationFrame(simRaf)
})

defineExpose({ seekTo: (ms: number) => {
  const sec = ms / 1000
  if (audioEl.value) {
    audioEl.value.currentTime = sec
  } else {
    simOffset.value = sec
    if (isPlaying.value) {
      simStartTime.value = performance.now()
    }
  }
  currentTime.value = sec
  emit('timeUpdate', ms)
}})
</script>

<template>
  <div class="audio-player">
    <audio
      v-if="src"
      ref="audioEl"
      :src="src"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @play="onPlay"
      @pause="onPause"
    />

    <button class="play-btn" @click="togglePlay" :aria-label="isPlaying ? 'Pause' : 'Play'">
      <!-- Pause icon -->
      <svg v-if="isPlaying" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
      <!-- Play icon -->
      <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6,4 20,12 6,20" />
      </svg>
    </button>

    <span class="time current">{{ formattedCurrent }}</span>

    <div class="seek-container">
      <div class="seek-track">
        <div class="seek-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="0.1"
        :value="progress"
        class="seek-input"
        @input="onSeekInput"
        @change="onSeekChange"
      />
    </div>

    <span class="time duration">{{ formattedDuration }}</span>
  </div>
</template>

<style scoped>
.audio-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  backdrop-filter: blur(20px);
  width: 100%;
  max-width: 600px;
}

.play-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.play-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
  min-width: 32px;
  text-align: center;
  flex-shrink: 0;
}

.seek-container {
  flex: 1;
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
}

.seek-track {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  overflow: hidden;
}

.seek-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 2px;
  transition: width 0.05s linear;
}

.seek-input {
  position: absolute;
  left: 0;
  right: 0;
  width: 100%;
  height: 20px;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}
</style>
