import { ugFetch } from '~/server/utils/ugFetch'

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

    const content = data.content
    if (!content || typeof content !== 'string') {
      throw createError({ statusCode: 404, statusMessage: 'No tab content found' })
    }

    return { content }
  } catch (e) {
    if ((e as any).statusCode) throw e
    const msg = e instanceof Error ? e.message : 'Tab fetch failed'
    console.error('[ug-api] tab error:', msg)
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
