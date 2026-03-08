<script setup lang="ts">
import { ref } from 'vue'
import type { UgSearchResult, LyricLine } from '~/types'
import { parseUgContent } from '~/composables/useChordParser'
import { matchChordsToTtml } from '~/composables/useChordMatcher'

const props = defineProps<{
  lines: LyricLine[]
}>()

const emit = defineEmits<{
  chordsMatched: [lines: LyricLine[]]
}>()

const artist = ref('')
const song = ref('')
const searchResults = ref<UgSearchResult[]>([])
const isSearching = ref(false)
const isFetching = ref(false)
const error = ref('')
const matchedTabName = ref('')

async function search() {
  if (!artist.value.trim() && !song.value.trim()) {
    error.value = 'Enter an artist or song name'
    return
  }

  error.value = ''
  searchResults.value = []
  isSearching.value = true

  try {
    const q = [artist.value.trim(), song.value.trim()].filter(Boolean).join(' ')
    const res = await fetch(`/api/ug/search?q=${encodeURIComponent(q)}`)
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Search failed')
    }

    searchResults.value = data.results || []
    if (searchResults.value.length === 0) {
      error.value = 'No chord tabs found. Try a different search.'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Search failed'
  } finally {
    isSearching.value = false
  }
}

async function selectTab(tab: UgSearchResult) {
  error.value = ''
  isFetching.value = true

  try {
    const res = await fetch(`/api/ug/tab?id=${encodeURIComponent(tab.id)}`)
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch tab')
    }

    const ugLines = parseUgContent(data.content)
    if (ugLines.length === 0) {
      error.value = 'No chord data found in this tab'
      return
    }

    const annotatedLines = matchChordsToTtml(props.lines, ugLines)
    matchedTabName.value = `${tab.artist_name} – ${tab.song_name}`
    emit('chordsMatched', annotatedLines)
    searchResults.value = []
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to fetch chords'
  } finally {
    isFetching.value = false
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') search()
}
</script>

<template>
  <div class="chord-search">
    <div class="search-inputs">
      <input
        v-model="artist"
        type="text"
        placeholder="Artist"
        class="input"
        @keydown="onKeydown"
      />
      <input
        v-model="song"
        type="text"
        placeholder="Song"
        class="input"
        @keydown="onKeydown"
      />
      <button class="search-btn" :disabled="isSearching" @click="search">
        {{ isSearching ? 'Searching…' : 'Find Chords' }}
      </button>
    </div>

    <p v-if="matchedTabName" class="matched-info">
      <span class="dot"></span>
      Chords: {{ matchedTabName }}
    </p>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="searchResults.length > 0" class="results">
      <button
        v-for="tab in searchResults"
        :key="tab.id"
        class="result-item"
        :disabled="isFetching"
        @click="selectTab(tab)"
      >
        <span class="result-song">{{ tab.song_name }}</span>
        <span class="result-artist">{{ tab.artist_name }}</span>
        <span v-if="tab.rating" class="result-rating">★ {{ tab.rating.toFixed(1) }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chord-search {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 24px;
}

.search-inputs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.input {
  flex: 1;
  min-width: 120px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: white;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.input:focus {
  border-color: rgba(255, 255, 255, 0.3);
}

.input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.search-btn {
  padding: 8px 18px;
  background: rgba(90, 200, 250, 0.15);
  border: 1px solid rgba(90, 200, 250, 0.3);
  border-radius: 10px;
  color: #5ac8fa;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
}

.search-btn:hover:not(:disabled) {
  background: rgba(90, 200, 250, 0.25);
}

.search-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.matched-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.matched-info .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #30d158;
  flex-shrink: 0;
}

.error {
  margin: 0;
  color: #ff453a;
  font-size: 12px;
}

.results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 4px;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
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

.result-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.result-item:disabled {
  opacity: 0.5;
  cursor: wait;
}

.result-song {
  font-weight: 600;
}

.result-artist {
  color: rgba(255, 255, 255, 0.5);
  flex: 1;
}

.result-rating {
  color: #ffd60a;
  font-size: 11px;
  flex-shrink: 0;
}
</style>
