import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { getSongsDir } from '~/server/utils/songs'

export default defineEventHandler((event) => {
  const filename = getRouterParam(event, 'filename')
  if (!filename || !filename.endsWith('.ttml')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' })
  }

  // Prevent path traversal
  if (filename.includes('/') || filename.includes('..')) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid filename' })
  }

  const filePath = resolve(getSongsDir(), filename)
  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, statusMessage: 'Song not found' })
  }

  const content = readFileSync(filePath, 'utf-8')
  return { content, filename }
})
