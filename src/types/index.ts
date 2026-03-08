export interface LyricWord {
  text: string
  beginMs: number
  endMs: number
  chord?: string
}

export interface LyricLine {
  index: number
  text: string
  beginMs: number
  endMs: number
  words: LyricWord[]
  isBackground: boolean
}

export interface ParsedTtml {
  lines: LyricLine[]
  timing: 'Word' | 'Line' | 'None'
  lang: string
}

// Ultimate Guitar types

export interface UgSearchResult {
  id: number
  url: string
  song_name: string
  artist_name: string
  rating: number
  votes: number
  type: string
}

export interface UgChordPosition {
  chord: string
  charPosition: number
}

export interface UgChordLine {
  lyrics: string
  chords: UgChordPosition[]
}
