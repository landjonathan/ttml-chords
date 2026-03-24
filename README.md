# TTML Chords

Nuxt 3 app that overlays guitar chords onto Apple Music TTML lyrics files. Upload a `.ttml` file, search for matching chords from Ultimate Guitar, and the app maps chords to individual words using text-similarity matching with section-aware fallback.

## Stack

- **Nuxt 3** (Vue 3, Nitro server, Vite)
- **chord-magic** for chord parsing/transposition
- No CSS framework — scoped CSS throughout, dark theme
- `data/songs/` stores saved `.ttml` files on disk (not a database)

## Running

```sh
npm install
npm run dev     # port 7731
```

## Architecture

### Page: `pages/[...slug].vue`

Single catch-all page — owns all top-level state (`lines`, `audioSrc`, `playbackRate`, `transposition`, dirty tracking via snapshot diffing). Orchestrates all child components. Route slug maps to a saved song filename.

### Components

| File | Purpose |
|---|---|
| `LyricsDisplay.vue` | Renders synced lyrics with chord annotations. Auto-scrolls to active line. Chord editing popover (hover → edit → move left/right → confirm). Buffers edits locally in `pendingChords` and only emits `chordsUpdated` on confirm. |
| `ChordSearch.vue` | Search UG for chord tabs, select one, runs the matching pipeline, emits annotated lines. |
| `AudioPlayer.vue` | `<audio>` wrapper with simulation mode (manual time advancement when no audio file). Exposes `setRate()` and `seekTo()`. |
| `FileUploader.vue` | Drag-and-drop / browse for `.ttml` and audio files. |
| `SongLibrary.vue` | Lists saved songs from server, handles select/delete, includes FileUploader for adding new songs. |

### Composables

| File | Purpose |
|---|---|
| `useChordParser.ts` | Parses UG BBCode tab content (`[ch]Am[/ch]`) into `UgChordLine[]` with character-position chords and normalized section types (`verse`, `chorus`, etc.). |
| `useChordMatcher.ts` | Maps UG chords onto TTML lyrics words. Three-phase strategy: (1) text-similarity matching (40% threshold), (2) section-type fallback for unmatched runs, (3) structural pattern propagation when no section headers exist. |
| `useTtmlParser.ts` | Parses TTML XML → `ParsedTtml` with `LyricLine[]`. Handles word-level and line-level timing, background vocals, embedded chord agent div. |
| `useTtmlSerializer.ts` | Serializes `ParsedTtml` back to TTML XML with a `<div ttm:agent="chords">` section. Line-timed chords use distributed timing to encode word position. |

### Types: `types/index.ts`

- `LyricWord` — text, begin/endMs, optional `chord`
- `LyricLine` — text, timing, words array, isBackground
- `ParsedTtml` — lines, timing mode, metadata, playbackRate, transposition
- `UgChordLine` — lyrics string, chord positions, optional `section` type
- `UgSearchResult`, `UgChordPosition`

### Server: `server/`

**Song CRUD** (`server/api/songs/`):
- `list.get.ts` — list all `.ttml` files in `data/songs/`
- `[filename].get.ts` — read a song file
- `[filename].delete.ts` — delete a song file
- `save.post.ts` — write TTML content, filename derived from `slugify(artist)--slugify(song).ttml`

**UG proxy** (`server/api/ug/`):
- `search.get.ts` — search UG mobile API for chord tabs
- `tab.get.ts` — fetch tab content by ID
- `server/utils/ugFetch.ts` — UG API client with device-id generation, API key derivation, exponential backoff retry

## Key data flow

1. User uploads `.ttml` → `useTtmlParser` → `LyricLine[]` displayed in `LyricsDisplay`
2. User searches UG → `ChordSearch` calls server proxy → `useChordParser` parses tab → `useChordMatcher` maps chords to TTML words
3. User edits chord positions via popover → buffered locally → confirmed → parent state updated → dirty flag set
4. Save → `useTtmlSerializer` → POST to server → stored in `data/songs/`

## TTML chord storage format

Chords are stored in a second `<div ttm:agent="chords">` alongside the lyrics div. Each `<p>` mirrors a lyrics line's timing; each `<span>` carries a chord name timed to the word it annotates.
