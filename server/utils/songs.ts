import { resolve } from 'path'
import { existsSync, mkdirSync } from 'fs'

const SONGS_DIR = resolve(process.cwd(), 'data/songs')

export const getSongsDir = () => {
  if (!existsSync(SONGS_DIR)) {
    mkdirSync(SONGS_DIR, { recursive: true })
  }
  return SONGS_DIR
}

export const slugify = (str: string) =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const songFilename = (artist: string, song: string) =>
  `${slugify(artist)}--${slugify(song)}.ttml`
