<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ChordPosition, LyricLine, ParsedTtml } from '~/types'
import { parseTtml } from '~/composables/useTtmlParser'
import { serializeTtml } from '~/composables/useTtmlSerializer'
import type { AudioPlayer } from '#components'

const route = useRoute()

const lines = ref<LyricLine[]>([])
const audioSrc = ref<string | null>(null)
const currentTimeMs = ref(0)
const isPlaying = ref(false)
const parseError = ref('')
const playerRef = ref<InstanceType<typeof AudioPlayer> | null>(null)
const playbackRate = ref(1)
const transposition = ref(0)
const songName = ref('')
const artistName = ref('')
const sourceUrl = ref('')
const albumCover = ref('')
const hasEmbeddedChords = ref(false)
const showLibrary = ref(false)
const libraryRef = ref<{ loadSongs: () => void } | null>(null)
const currentFilename = ref('')

// Save state
const isSaving = ref(false)
const savedSnapshot = ref<string | null>(null)

// Preserve parsed metadata for serialization
const parsedTtml = ref<ParsedTtml | null>(null)

const hasLyrics = computed(() => lines.value.length > 0)

const routeSlug = computed(() => {
  const slug = route.params.slug
  if (Array.isArray(slug)) return slug[0] || ''
  return slug || ''
})

const hasChords = computed(() => lines.value.some((l) => l.chords.length > 0))

const currentSnapshot = computed(() =>
  JSON.stringify({
    chords: lines.value.map(l => l.chords),
    rate: playbackRate.value,
    transposition: transposition.value,
  })
)

const isDirty = computed(() => {
  if (!hasChords.value) return false
  if (savedSnapshot.value === null) return true
  return currentSnapshot.value !== savedSnapshot.value
})
const simulateMode = computed(() => hasLyrics.value && !audioSrc.value)
const lyricsDuration = computed(() => {
  if (parsedTtml.value?.totalDurationMs) return parsedTtml.value.totalDurationMs / 1000
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
    sourceUrl.value = result.sourceUrl || ''
    albumCover.value = result.albumCover || ''
    hasEmbeddedChords.value = result.hasChords
    parsedTtml.value = result
    if (result.playbackRate) {
      playbackRate.value = result.playbackRate
      playerRef.value?.setRate(result.playbackRate)
    } else {
      playbackRate.value = 1
    }
    transposition.value = result.transposition ?? 0
    savedSnapshot.value = result.hasChords ? currentSnapshot.value : null
    showLibrary.value = false
  } catch (e) {
    parseError.value = e instanceof Error ? e.message : 'Failed to parse TTML'
    lines.value = []
  }
}

function onTtmlLoaded(content: string, _fileName: string) {
  loadTtml(content)
}

function onSongSelected(ttml: string, filename: string) {
  loadTtml(ttml)
  const slug = filename.replace(/\.ttml$/, '')
  currentFilename.value = filename
  navigateTo(slug ? `/${slug}` : '/', { replace: true })
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

function onChordsMatched (annotatedLines: LyricLine[], artist: string, song: string, url: string, cover: string) {
  lines.value = annotatedLines
  if (artist) artistName.value = artist
  if (song) songName.value = song
  sourceUrl.value = url
  albumCover.value = cover
}

function onChordsUpdated(lineIndex: number, chords: ChordPosition[]) {
  const line = lines.value[lineIndex]
  if (!line) return
  line.chords = chords
}

function resetSong() {
  lines.value = []
  audioSrc.value = null
  currentTimeMs.value = 0
  songName.value = ''
  artistName.value = ''
  sourceUrl.value = ''
  albumCover.value = ''
  hasEmbeddedChords.value = false
  parsedTtml.value = null
  showLibrary.value = false
  currentFilename.value = ''
  navigateTo('/', { replace: true })
}

function transposeAll(halfSteps: number) {
  transposition.value = Math.max(-12, Math.min(12, transposition.value + halfSteps))
}

function revertChanges() {
  if (!savedSnapshot.value) return
  const { chords, rate, transposition: savedTrans } = JSON.parse(savedSnapshot.value)
  lines.value.forEach((line, i) => {
    line.chords = chords[i] ?? []
  })
  playbackRate.value = rate
  playerRef.value?.setRate(rate)
  transposition.value = savedTrans ?? 0
}

function onRateChange(rate: number) {
  playbackRate.value = rate
  playerRef.value?.setRate(rate)
}

async function saveSong() {
  if (!parsedTtml.value || !hasChords.value) return
  if (!artistName.value.trim() || !songName.value.trim()) return

  isSaving.value = true

  try {
    const ttmlWithChords = serializeTtml(
      { ...parsedTtml.value, lines: lines.value },
      artistName.value,
      songName.value,
      playbackRate.value,
      transposition.value,
      sourceUrl.value || undefined,
      albumCover.value || undefined,
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

    hasEmbeddedChords.value = true
    savedSnapshot.value = currentSnapshot.value
    const slug = data.filename.replace(/\.ttml$/, '')
    currentFilename.value = data.filename
    navigateTo(slug ? `/${slug}` : '/', { replace: true })
    libraryRef.value?.loadSongs()
  } catch (_e) {
    // save failed silently
  } finally {
    isSaving.value = false
  }
}

// Load song from route slug on client
if (import.meta.client) {
  watch(routeSlug, async (slug) => {
    if (!slug) return
    if (currentFilename.value === slug + '.ttml') return
    try {
      const res = await $fetch<{ content: string; filename: string }>(`/api/songs/${encodeURIComponent(slug + '.ttml')}`)
      loadTtml(res.content)
      currentFilename.value = slug + '.ttml'
    } catch {
      // song not found — stay on home
    }
  }, { immediate: true })
}
</script>

<template>
  <div class="app">
    <PlaybackSidebar
      v-if="hasLyrics"
      :has-chords="hasChords"
      :transposition="transposition"
      :playback-rate="playbackRate"
      @transpose="transposeAll"
      @rate-change="onRateChange"
    />

    <AppHeader
      :has-lyrics="hasLyrics"
      :has-chords="hasChords"
      :is-dirty="isDirty"
      :can-revert="isDirty && !!savedSnapshot"
      :song-name="songName"
      :artist-name="artistName"
      :source-url="sourceUrl"
      :album-cover="albumCover"
      @toggle-library="showLibrary = !showLibrary"
      @save="saveSong"
      @revert="revertChanges"
    />

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
          :transposition="transposition"
          @seek-to="onSeekTo"
          @chords-updated="onChordsUpdated"
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

    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  position: relative;
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
  padding: 24px calc(24px + env(safe-area-inset-right, 0px)) 24px calc(24px + env(safe-area-inset-left, 0px));
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
  padding: 12px calc(24px + env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) calc(24px + env(safe-area-inset-left, 0px));
  background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent);
}

</style>
