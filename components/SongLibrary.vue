<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface SavedSong {
  filename: string
  artist: string
  song: string
}

const props = defineProps<{
  /** When true, renders as a toggleable overlay instead of full-page */
  menuMode?: boolean
}>()

const emit = defineEmits<{
  songSelected: [ttml: string, filename: string]
  ttmlLoaded: [content: string, fileName: string]
  audioLoaded: [url: string, fileName: string]
}>()

const songs = ref<SavedSong[]>([])
const isLoading = ref(false)
const loadError = ref('')
const fetchingFilename = ref('')

async function loadSongs() {
  isLoading.value = true
  loadError.value = ''
  try {
    const res = await fetch('/api/songs/list')
    const data = await res.json()
    songs.value = data.songs || []
  } catch {
    loadError.value = 'Failed to load song library'
  } finally {
    isLoading.value = false
  }
}

async function selectSong(song: SavedSong) {
  fetchingFilename.value = song.filename
  try {
    const res = await fetch(`/api/songs/${encodeURIComponent(song.filename)}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.statusMessage || 'Failed to load song')
    emit('songSelected', data.content, song.filename)
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to load song'
  } finally {
    fetchingFilename.value = ''
  }
}

function onTtmlLoaded(content: string, fileName: string) {
  emit('ttmlLoaded', content, fileName)
}

function onAudioLoaded(url: string, fileName: string) {
  emit('audioLoaded', url, fileName)
}

onMounted(loadSongs)

defineExpose({ loadSongs })
</script>

<template>
  <div class="song-library" :class="{ 'menu-mode': menuMode }">
    <h2 v-if="!menuMode" class="library-title">Library</h2>

    <!-- Saved songs list -->
    <div v-if="songs.length > 0" class="songs-list">
      <button
        v-for="s in songs"
        :key="s.filename"
        class="song-item"
        :disabled="fetchingFilename === s.filename"
        @click="selectSong(s)"
      >
        <span class="song-name">{{ s.song }}</span>
        <span class="song-artist">{{ s.artist }}</span>
        <span v-if="fetchingFilename === s.filename" class="song-loading">Loading…</span>
      </button>
    </div>

    <p v-else-if="!isLoading" class="empty-message">
      No saved songs yet. Upload a TTML file to get started.
    </p>

    <p v-if="isLoading" class="loading-message">Loading library…</p>
    <p v-if="loadError" class="error">{{ loadError }}</p>

    <!-- Divider -->
    <div v-if="songs.length > 0" class="divider"></div>

    <!-- Upload section -->
    <div class="upload-section">
      <p class="upload-label">Add new song</p>
      <FileUploader
        @ttml-loaded="onTtmlLoaded"
        @audio-loaded="onAudioLoaded"
      />
    </div>
  </div>
</template>

<style scoped>
.song-library {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  max-width: 520px;
}

.song-library.menu-mode {
  max-height: 70vh;
  overflow-y: auto;
  padding: 20px;
}

.library-title {
  font-size: 18px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.8);
  margin: 0;
  text-align: center;
}

.songs-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 280px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 4px;
}

.song-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: none;
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}

.song-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.song-item:disabled {
  opacity: 0.5;
  cursor: wait;
}

.song-name {
  font-weight: 600;
}

.song-artist {
  color: rgba(255, 255, 255, 0.5);
  flex: 1;
}

.song-loading {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.empty-message,
.loading-message {
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.4);
}

.error {
  margin: 0;
  color: #ff453a;
  font-size: 12px;
  text-align: center;
}

.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
  margin: 4px 0;
}

.upload-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-label {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
