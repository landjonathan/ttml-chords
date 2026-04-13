<script setup lang="ts">
defineProps<{
  hasLyrics: boolean
  hasChords: boolean
  isDirty: boolean
  canRevert: boolean
  songName: string
  artistName: string
  sourceUrl: string
  albumCover: string
}>()

defineEmits<{
  toggleLibrary: []
  save: []
  revert: []
}>()
</script>

<template>
  <header class="app-header">
    <button v-if="hasLyrics" class="header-btn header-left" @click="$emit('toggleLibrary')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>

    <div class="header-center">
      <template v-if="hasLyrics && (songName || artistName)">
        <div class="song-info">
          <div class="song-image">
            <img v-if="albumCover" :src="albumCover" class="album-cover" alt="" />
            <a v-if="sourceUrl" :href="sourceUrl" target="_blank" rel="noopener noreferrer" class="source-link" title="View on Ultimate Guitar">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
          <div class="song-text">
            <h1 class="song-title">{{ songName }}</h1>
            <p v-if="artistName" class="song-artist">{{ artistName }}</p>
          </div>
        </div>
      </template>
      <h1 v-else>TTML Chords</h1>
    </div>

    <div v-if="hasChords" class="header-right">
      <button class="header-btn reset-btn" :disabled="!canRevert" @click="$emit('revert')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
      </button>
      <button class="header-btn save-btn" :class="{ 'save-dirty': isDirty }" :disabled="!isDirty" @click="$emit('save')">
        Save
      </button>
    </div>
  </header>
</template>


<style scoped>
.app-header {
  flex-shrink: 0;
  padding: calc(12px + env(safe-area-inset-top, 0px)) calc(16px + env(safe-area-inset-right, 0px)) 12px calc(16px + env(safe-area-inset-left, 0px));
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  gap: 12px;
}
.app-header h1 {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin: 0;
}
.header-center { flex: 1; text-align: center; min-width: 0; }
.header-left { flex-shrink: 0; }
.header-right { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.header-btn {
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
}
.header-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); color: rgba(255, 255, 255, 0.8); }
.header-btn:disabled { opacity: 0.25; cursor: default; }
.save-btn { background: rgba(90, 200, 250, 0.15); border-color: rgba(90, 200, 250, 0.3); color: #5ac8fa; padding: 6px 14px; }
.save-btn:hover:not(:disabled) { background: rgba(90, 200, 250, 0.25); }
.song-info { display: inline-flex; align-items: center; gap: 8px; }
.song-image {
  display: grid;
  place-content: center;
  background-color: rgba(255, 255, 255, 0.05);
  height: 2lh;
  width: 2lh;
  border-radius: 6px;
  overflow: clip;

  > * { grid-area: 1/1/1/1; }

  &:has(img):not(:hover) .source-link { opacity: 0; }
  &:hover .album-cover { opacity: .5; }
}
.album-cover { width: 100%; height: 100%; object-fit: cover; flex-shrink: 0; transition: opacity 0.15s; }
.song-text { text-align: left; }
.song-title { font-size: 14px; font-weight: 700; color: rgba(255, 255, 255, 0.7); letter-spacing: 0.02em; text-transform: none; margin: 0; }
.song-artist { font-size: 11px; color: rgba(255, 255, 255, 0.35); margin: 2px 0 0; }
.source-link { display: grid; place-items: center; color: rgba(255, 255, 255, 1); text-decoration: none; z-index: 1; transition: opacity 0.15s; }
</style>
