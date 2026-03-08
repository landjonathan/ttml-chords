import { ugFetch } from '~/server/utils/ugFetch'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const q = query.q as string | undefined

  if (!q) {
    throw createError({ statusCode: 400, statusMessage: 'Missing q parameter' })
  }

  try {
    const data = (await ugFetch(
      `/tab/search?title=${encodeURIComponent(q)}&type=300`,
    )) as Record<string, unknown>

    const rawTabs = Array.isArray(data.tabs) ? data.tabs : []
    const tabs = rawTabs
      .map((r: any) => ({
        id: r.id,
        url: r.tab_url || '',
        song_name: r.song_name,
        artist_name: r.artist_name,
        rating: r.rating ?? 0,
        votes: r.votes ?? 0,
        type: r.type || 'Chords',
      }))
      .slice(0, 15)

    return { results: tabs }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Search failed'
    console.error('[ug-api] search error:', msg)
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
