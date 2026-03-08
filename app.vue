<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LyricLine } from '~/types'
import { parseTtml } from '~/composables/useTtmlParser'

const lines = ref<LyricLine[]>([])
const audioSrc = ref<string | null>(null)
const currentTimeMs = ref(0)
const isPlaying = ref(false)
const parseError = ref('')
const playerRef = ref<InstanceType<typeof AudioPlayer> | null>(null)

const hasLyrics = computed(() => lines.value.length > 0)
const simulateMode = computed(() => hasLyrics.value && !audioSrc.value)

function onTtmlLoaded(content: string, _fileName: string) {
  try {
    parseError.value = ''
    const result = parseTtml(content)
    lines.value = result.lines
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : 'Failed to parse TTML'
    lines.value = []
  }
}

function onAudioLoaded(url: string, _fileName: string) {
  audioSrc.value = url
}

function onTimeUpdate(ms: number) {
  currentTimeMs.value = ms
}

function onSeekTo(ms: number) {
  playerRef.value?.seekTo(ms)
  currentTimeMs.value = ms
}

function onChordsMatched(annotatedLines: LyricLine[]) {
  lines.value = annotatedLines
}
</script>

<template>
  <div class="app">
    <header class="app-header">
      <h1>TTML Lyrics</h1>
    </header>

    <main class="app-main">
      <!-- Upload view -->
      <div v-if="!hasLyrics" class="upload-view">
        <FileUploader
          @ttml-loaded="onTtmlLoaded"
          @audio-loaded="onAudioLoaded"
        />
        <p v-if="parseError" class="error">{{ parseError }}</p>
      </div>

      <!-- Lyrics view -->
      <template v-else>
        <ChordSearch
          :lines="lines"
          @chords-matched="onChordsMatched"
        />
        <LyricsDisplay
          :lines="lines"
          :current-time-ms="currentTimeMs"
          :is-playing="isPlaying"
          @seek-to="onSeekTo"
        />
      </template>
    </main>

    <!-- Player bar (always visible when lyrics loaded) -->
    <footer v-if="hasLyrics" class="app-footer">
      <AudioPlayer
        ref="playerRef"
        :src="audioSrc"
        :simulate-mode="simulateMode"
        @time-update="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
      />

      <button class="reset-btn" @click="lines = []; audioSrc = null; currentTimeMs = 0">
        Load different file
      </button>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  flex-shrink: 0;
  padding: 16px 24px;
  text-align: center;
}

.app-header h1 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0;
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.upload-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.error {
  margin-top: 12px;
  color: #ff453a;
  font-size: 13px;
  text-align: center;
}

.app-footer {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 24px 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
}

.reset-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
}

.reset-btn:hover {
  color: rgba(255, 255, 255, 0.6);
}
</style>
