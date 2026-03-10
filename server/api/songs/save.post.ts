import { writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getSongsDir, songFilename } from '~/server/utils/songs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ ttml: string; artist: string; song: string }>(event)

  if (!body.ttml || !body.artist?.trim() || !body.song?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Missing ttml, artist, or song' })
  }

  const filename = songFilename(body.artist.trim(), body.song.trim())
  const filePath = resolve(getSongsDir(), filename)
  const overwritten = existsSync(filePath)

  writeFileSync(filePath, body.ttml, 'utf-8')

  return { filename, overwritten }
})
