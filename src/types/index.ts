export interface LyricWord {
  text: string
  beginMs: number
  endMs: number
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
