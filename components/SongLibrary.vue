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
const confirmDelete = ref<SavedSong | null>(null)

const sortBy = ref<keyof SavedSong>('artist')

function toggleSortby () {
  if (sortBy.value === 'artist') {
    sortBy.value = 'song'
  } else {
    sortBy.value = 'artist'
  }
}

const sortedSongs = computed(() => songs.value.toSorted((a, b) => a[sortBy.value].localeCompare(b[sortBy.value])))

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

async function deleteSong() {
  const song = confirmDelete.value
  if (!song) return
  try {
    await $fetch(`/api/songs/${encodeURIComponent(song.filename)}`, { method: 'DELETE' })
    confirmDelete.value = null
    await loadSongs()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : 'Failed to delete song'
    confirmDelete.value = null
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

    <button @click="toggleSortby" class="sort-btn">Sorted by {{ sortBy }}</button>
    <!-- Saved songs list -->
    <div v-if="sortedSongs.length > 0" class="songs-list">
      <div v-for="s in sortedSongs" :key="s.filename" class="song-row">
        <button
          class="song-item"
          :disabled="fetchingFilename === s.filename"
          @click="selectSong(s)"
        >
          <span class="song-name">{{ s.song }}</span>
          <span class="song-artist">{{ s.artist }}</span>
          <span v-if="fetchingFilename === s.filename" class="song-loading">Loading…</span>
        </button>
        <button class="delete-btn" @click.stop="confirmDelete = s" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <p v-else-if="!isLoading" class="empty-message">
      No saved songs yet. Upload a TTML file to get started.
    </p>

    <p v-if="isLoading" class="loading-message">Loading library…</p>
    <p v-if="loadError" class="error">{{ loadError }}</p>

    <!-- Upload section -->
    <div class="upload-section">
      <FileUploader
        @ttml-loaded="onTtmlLoaded"
        @audio-loaded="onAudioLoaded"
      />
    </div>
    <!-- Delete confirmation dialog -->
    <Teleport to="body">
      <div v-if="confirmDelete" class="dialog-backdrop" @click.self="confirmDelete = null">
        <div class="dialog">
          <p class="dialog-message">Delete <strong>{{ confirmDelete.song }}</strong> by {{ confirmDelete.artist }}?</p>
          <div class="dialog-actions">
            <button class="dialog-btn" @click="confirmDelete = null">Cancel</button>
            <button class="dialog-btn dialog-btn-danger" @click="deleteSong">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
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
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 4px;
}

.song-row {
  display: flex;
  align-items: center;
  border-radius: 8px;
  transition: background 0.15s;
}

.song-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.song-row:hover .delete-btn {
  opacity: 1;
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
  flex: 1;
  min-width: 0;
}

.song-item:disabled {
  opacity: 0.5;
  cursor: wait;
}

.delete-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
  flex-shrink: 0;
}

.delete-btn:hover {
  color: #ff453a;
}

.sort-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: start;
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
  align-items: stretch;
  gap: 8px;
}

.upload-label {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  background: #1c1c1e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 20px 24px;
  max-width: 320px;
  width: 100%;
  text-align: center;
}

.dialog-message {
  margin: 0 0 16px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.4;
}

.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.dialog-btn {
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s;
}

.dialog-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

.dialog-btn-danger {
  background: rgba(255, 69, 58, 0.15);
  border-color: rgba(255, 69, 58, 0.3);
  color: #ff453a;
}

.dialog-btn-danger:hover {
  background: rgba(255, 69, 58, 0.25);
}
</style>
