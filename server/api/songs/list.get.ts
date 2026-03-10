import { readdirSync } from 'fs'
import { getSongsDir } from '~/server/utils/songs'

export default defineEventHandler(() => {
  const dir = getSongsDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.ttml'))

  const songs = files.map((filename) => {
    // Reverse the slug: "artist-name--song-title.ttml"
    const base = filename.replace(/\.ttml$/, '')
    const sep = base.indexOf('--')
    const artist = sep >= 0 ? base.slice(0, sep).replace(/-/g, ' ') : ''
    const song = sep >= 0 ? base.slice(sep + 2).replace(/-/g, ' ') : base.replace(/-/g, ' ')
    return { filename, artist, song }
  })

  return { songs }
})
