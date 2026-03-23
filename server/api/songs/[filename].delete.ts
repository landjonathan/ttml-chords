import { unlinkSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getSongsDir } from '~/server/utils/songs'

export default defineEventHandler((event) => {
  const filename = getRouterParam(event, 'filename')
  if (!filename || !filename.endsWith('.ttml')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' })
  }

  if (filename.includes('/') || filename.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' })
  }

  const filePath = resolve(getSongsDir(), filename)
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'Song not found' })
  }

  unlinkSync(filePath)
  return { deleted: true, filename }
})
