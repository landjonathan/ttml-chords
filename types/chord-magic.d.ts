declare module 'chord-magic' {
  export interface ParsedChord {
    root: string
    [key: string]: unknown
  }
  export function parse(chord: string): ParsedChord | null
  export function transpose(chord: ParsedChord, halfSteps: number): ParsedChord
  export function prettyPrint(chord: ParsedChord): string
}
