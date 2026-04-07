import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { ugFetch, UgApiError } from '~/server/utils/ugFetch'
import { slugify } from '~/server/utils/songs'

const getJsonDir = () => {
  const dir = resolve(process.cwd(), 'data/json')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const id = query.id as string | undefined

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id parameter' })
  }

  try {
    const data = (await ugFetch(
      `/tab/info?tab_id=${encodeURIComponent(id)}&tab_access_type=public`,
    )) as Record<string, unknown>

    const artist = typeof data.artist_name === 'string' ? data.artist_name : ''
    const song = typeof data.song_name === 'string' ? data.song_name : ''
    const jsonFilename = `${slugify(artist)}--${slugify(song)}--${id}.json`
    writeFileSync(resolve(getJsonDir(), jsonFilename), JSON.stringify(data, null, 2), 'utf-8')

    const content = data.content
    if (!content || typeof content !== 'string') {
      throw createError({ statusCode: 404, statusMessage: 'No tab content found' })
    }

    const url = typeof data.urlWeb === 'string' ? data.urlWeb : ''
    const appAlbumCover = (data.album_cover as any)?.app_album_cover
    const albumCover = typeof appAlbumCover?.small === 'string' ? appAlbumCover.small : ''
    return { content, url, albumCover }
  } catch (e) {
    if ((e as any).statusCode) throw e

    if (e instanceof UgApiError) {
      console.error(`[ug-api] tab error: upstream ${e.status} for tab ${id}`)
      const code = e.status === 404 ? 404 : 502
      throw createError({ statusCode: code, statusMessage: e.message })
    }

    const msg = e instanceof Error ? e.message : 'Tab fetch failed'
    console.error('[ug-api] tab error:', msg)
    throw createError({ statusCode: 502, statusMessage: msg })
  }
})
