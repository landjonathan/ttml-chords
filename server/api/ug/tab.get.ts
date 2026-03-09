import { ugFetch, UgApiError } from '~/server/utils/ugFetch'

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
