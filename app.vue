<script setup lang="ts">
import { ref, computed } from 'vue'
import type { LyricLine, ParsedTtml } from '~/types'
import { parseTtml, findActiveLineIndex } from '~/composables/useTtmlParser'
import { serializeTtml } from '~/composables/useTtmlSerializer'

const lines = ref<LyricLine[]>([])
const audioSrc = ref<string | null>(null)
const currentTimeMs = ref(0)
const isPlaying = ref(false)
const parseError = ref('')
const playerRef = ref<InstanceType<typeof AudioPlayer> | null>(null)
const playbackRate = ref(1)
const songName = ref('')
const artistName = ref('')
const hasEmbeddedChords = ref(false)
const showLibrary = ref(false)
const libraryRef = ref<{ loadSongs: () => void } | null>(null)

// Save state
const isSaving = ref(false)
const saveMessage = ref('')
const saveMessageType = ref<'success' | 'warning' | 'error'>('success')

// Preserve parsed metadata for serialization
const parsedTtml = ref<ParsedTtml | null>(null)

const hasLyrics = computed(() => lines.value.length > 0)

const lineProgress = computed(() => {
  const idx = findActiveLineIndex(lines.value, currentTimeMs.value)
  if (idx < 0) return 0
  const line = lines.value[idx]
  const duration = line.endMs - line.beginMs
  if (duration <= 0) return 0
  return Math.min(100, Math.max(0, ((currentTimeMs.value - line.beginMs) / duration) * 100))
})
const hasChords = computed(() => lines.value.some((l) => l.words.some((w) => w.chord)))
const simulateMode = computed(() => hasLyrics.value && !audioSrc.value)
const lyricsDuration = computed(() => {
  if (!lines.value.length) return 0
  return Math.max(...lines.value.map(l => l.endMs)) / 1000
})

function loadTtml(content: string) {
  parseError.value = ''
  try {
    const result = parseTtml(content)
    lines.value = result.lines
    songName.value = result.songName || ''
    artistName.value = result.artistName || ''
    hasEmbeddedChords.value = result.hasChords
    parsedTtml.value = result
    if (result.playbackRate) {
      playbackRate.value = result.playbackRate
      playerRef.value?.setRate(result.playbackRate)
    }
    showLibrary.value = false
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : 'Failed to parse TTML'
    lines.value = []
  }
}

function onTtmlLoaded(content: string, _fileName: string) {
  loadTtml(content)
}

function onSongSelected(ttml: string, _filename: string) {
  loadTtml(ttml)
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

function onChordsMatched(annotatedLines: LyricLine[], artist: string, song: string) {
  lines.value = annotatedLines
  if (artist) artistName.value = artist
  if (song) songName.value = song
}

function resetSong() {
  lines.value = []
  audioSrc.value = null
  currentTimeMs.value = 0
  songName.value = ''
  artistName.value = ''
  hasEmbeddedChords.value = false
  parsedTtml.value = null
  saveMessage.value = ''
  showLibrary.value = false
}

async function saveSong() {
  if (!parsedTtml.value || !hasChords.value) return
  if (!artistName.value.trim() || !songName.value.trim()) {
    saveMessage.value = 'Artist and song name are required to save'
    saveMessageType.value = 'error'
    return
  }

  isSaving.value = true
  saveMessage.value = ''

  try {
    // Re-serialize with current lines (which have chord annotations)
    const ttmlWithChords = serializeTtml(
      { ...parsedTtml.value, lines: lines.value },
      artistName.value,
      songName.value,
      playbackRate.value
    )

    const res = await fetch('/api/songs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ttml: ttmlWithChords,
        artist: artistName.value.trim(),
        song: songName.value.trim(),
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.statusMessage || 'Save failed')

    if (data.overwritten) {
      saveMessage.value = 'Saved (overwrote existing file)'
      saveMessageType.value = 'warning'
    } else {
      saveMessage.value = 'Saved'
      saveMessageType.value = 'success'
    }

    hasEmbeddedChords.value = true
    libraryRef.value?.loadSongs()
  } catch (e) {
    saveMessage.value = e instanceof Error ? e.message : 'Save failed'
    saveMessageType.value = 'error'
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="app">
    <div
      v-if="hasLyrics && isPlaying"
      class="progress-gradient"
      :style="{ transform: `scaleX(${lineProgress / 100})`, transitionDuration: lineProgress < 3 ? '0s' : '0.15s' }"
    />

    <div v-if="hasLyrics" class="rate-slider">
      <span class="rate-label">{{ playbackRate.toFixed(2) }}x</span>
      <input
        type="range"
        min="0.5"
        max="2"
        step="0.05"
        :value="playbackRate"
        class="rate-input"
        orient="vertical"
        @input="(e: Event) => { playbackRate = parseFloat((e.target as HTMLInputElement).value); playerRef?.setRate(playbackRate) }"
      />
    </div>

    <header class="app-header">
      <h1>TTML Chords</h1>
      <button v-if="hasLyrics" class="library-toggle" @click="showLibrary = !showLibrary">
        {{ showLibrary ? 'Close' : 'Library' }}
      </button>
    </header>

    <main class="app-main">
      <!-- Library overlay when toggled from header -->
      <div v-if="hasLyrics && showLibrary" class="library-overlay" @click.self="showLibrary = false">
        <SongLibrary
          ref="libraryRef"
          menu-mode
          @song-selected="onSongSelected"
          @ttml-loaded="onTtmlLoaded"
          @audio-loaded="onAudioLoaded"
        />
      </div>

      <!-- Library view (no song loaded) -->
      <div v-if="!hasLyrics" class="library-view">
        <SongLibrary
          ref="libraryRef"
          @song-selected="onSongSelected"
          @ttml-loaded="onTtmlLoaded"
          @audio-loaded="onAudioLoaded"
        />
        <p v-if="parseError" class="error">{{ parseError }}</p>
      </div>

      <!-- Lyrics view -->
      <template v-if="hasLyrics">
        <ChordSearch
          v-if="!hasEmbeddedChords"
          :lines="lines"
          :initial-artist="artistName"
          :initial-song="songName"
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
        :duration-hint="lyricsDuration"
        @time-update="onTimeUpdate"
        @play="isPlaying = true"
        @pause="isPlaying = false"
      />

      <div class="footer-actions">
        <button
          v-if="hasChords && !isSaving"
          class="save-btn"
          @click="saveSong"
        >
          Save
        </button>
        <span v-if="isSaving" class="save-status">Saving…</span>
        <span
          v-if="saveMessage"
          class="save-status"
          :class="'save-' + saveMessageType"
        >
          {{ saveMessage }}
        </span>
        <button class="reset-btn" @click="resetSong">
          Load different file
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  position: relative;
}

.progress-gradient {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.05));
  transform-origin: left;
  will-change: transform;
  transition: transform 0.15s linear;
}

.app-header {
  flex-shrink: 0;
  padding: 16px 24px;
  text-align: center;
  position: relative;
}

.app-header h1 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0;
}

.library-toggle {
  position: absolute;
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.library-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
}

.app-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.library-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.library-overlay {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 40px;
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

.footer-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.save-btn {
  padding: 6px 18px;
  background: rgba(90, 200, 250, 0.15);
  border: 1px solid rgba(90, 200, 250, 0.3);
  border-radius: 8px;
  color: #5ac8fa;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
}

.save-btn:hover {
  background: rgba(90, 200, 250, 0.25);
}

.save-status {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.save-success {
  color: #30d158;
}

.save-warning {
  color: #ffd60a;
}

.save-error {
  color: #ff453a;
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

.rate-slider {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 5;
}

.rate-input {
  writing-mode: vertical-lr;
  direction: ltr;
  height: 60vh;
  width: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.rate-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
}

.rate-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  font-variant-numeric: tabular-nums;
}
</style>
