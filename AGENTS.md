# Agent Guide — TTML Chords

## Quick orientation
Nuxt 3 app. Single page (`pages/[...slug].vue`) with 5 components, 4 composables, server API routes. No test suite. No CSS framework (scoped CSS, dark theme). TypeScript throughout.

## File map
```
pages/[...slug].vue          — main page, owns all state (lines, playback, dirty tracking)
components/
  LyricsDisplay.vue          — lyrics + chord rendering, chord editing popover
  ChordSearch.vue            — UG search UI, triggers chord matching pipeline
  AudioPlayer.vue            — <audio> + simulation mode, exposes seekTo/setRate
  FileUploader.vue           — drag-drop .ttml and audio files
  SongLibrary.vue            — saved song list, CRUD, includes FileUploader
composables/
  useChordParser.ts          — UG BBCode → UgChordLine[] (with section detection) + mapChordsToCharPositions
  useChordMatcher.ts         — UgChordLine[] + LyricLine[] → LyricLine[] with character-level chords
  useTtmlParser.ts           — TTML XML → ParsedTtml
  useTtmlSerializer.ts       — ParsedTtml → TTML XML string
types/index.ts               — all shared interfaces
server/api/songs/            — CRUD for .ttml files in data/songs/
server/api/ug/               — proxy to UG mobile API (search + tab fetch)
server/utils/ugFetch.ts      — UG API client (auth, retries)
server/utils/songs.ts        — slugify, getSongsDir, songFilename helpers
```

## State management
All state lives in `pages/[...slug].vue` as refs. No store/pinia. Dirty tracking compares `currentSnapshot` (computed JSON of chord positions + rate + transposition) against `savedSnapshot`. Components communicate via props down, events up.

## Chord storage
Chords are stored on `LyricLine.chords` as `ChordPosition[]` — each entry has a `chord` name and a `charIndex` (0-based character offset within `line.text`). This enables syllable-level precision. `LyricWord` does not carry chord data.

## Chord matching pipeline
`useChordParser.parseUgContent()` → `useChordMatcher.matchChordsToTtml()`

`mapChordsToCharPositions(ttmlText, ugLyrics, ugChords)` maps UG character positions to TTML character positions via word alignment with proportional sub-word interpolation.

Three phases in matcher:
1. **Text similarity** — sequential greedy, 40% word-overlap threshold, produces character-level positions via `mapChordsToCharPositions`
2. **Section-type fallback** — for unmatched runs, infer section type from matched neighbors, apply chords proportionally (UG charPosition → TTML charIndex)
3. **Structural fallback** — when no UG section headers exist, find matched run of similar line count, proportionally map chord charIndex from source to target line

## Chord editing (LyricsDisplay)
- Hover chord → pencil icon → click enters edit mode
- `pendingChords` ref (`ChordPosition[]`) buffers all moves locally (never touches parent state)
- Arrow buttons shift `charIndex` by ±1 character; if another chord occupies the target index, they swap
- Each move recomputes from original prop data (single swap: origin ↔ current)
- ✕ reverts, ✓ commits (emits `chordsUpdated` with `ChordPosition[]` to parent), click-outside dismisses if clean
- `editingDirty` compares `pendingChords` vs prop chords by JSON equality
- Words are split into sub-segments at chord boundaries for rendering (`buildWordSegments`)

## TTML format
Lyrics in first `<div>`, chords in `<div ttm:agent="chords">`. Chord `<p>` timing matches lyrics `<p>` timing.

Chord `<span>` timing encodes character position:
- `beginMs = lineBegin + (charIndex / textLength) * duration`
- `endMs = beginMs + duration / textLength`

On parse, `charIndex = Math.round((spanBeginMs - lineBeginMs) / duration * textLength)`.

## Maintaining these docs
When making changes that affect architecture, data flow, component responsibilities, state management, or conventions described in this file or `README.md`, update the relevant docs in the same commit. This includes adding/removing/renaming files, changing event or prop interfaces, modifying the matching pipeline, or altering the TTML format.

## Conventions
- Pure functions as `const`, side-effect functions as `function`
- Prefer inferred types, no explicit return types unless necessary
- No tailwind — scoped `<style>` in every component
- Composables tied to a single component are inlined in `<script setup>`
- Commits: conventional commits with tightest context scope
