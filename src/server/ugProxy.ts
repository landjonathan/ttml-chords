import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'

const UG_BASE = 'https://www.ultimate-guitar.com'
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchWithUA(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) {
    throw new Error(`UG fetch failed: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

/**
 * Extract the JSON data from UG's `<div class="js-store" data-content="...">` element.
 */
function extractStoreData(html: string): unknown {
  // The data-content attribute contains HTML-encoded JSON
  const match = html.match(/class="js-store"\s+data-content="([^"]*)"/)
  if (!match) {
    throw new Error('Could not find js-store data in UG page')
  }
  const encoded = match[1]
  // Decode HTML entities
  const decoded = encoded
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
  return JSON.parse(decoded)
}

function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function getQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  return url.searchParams
}

export function ugProxyPlugin(): Plugin {
  return {
    name: 'ug-proxy',
    configureServer(server) {
      // Search endpoint
      server.middlewares.use('/api/ug/search', async (req, res) => {
        try {
          const params = getQuery(req)
          const q = params.get('q')
          if (!q) {
            sendJson(res, 400, { error: 'Missing q parameter' })
            return
          }

          const searchUrl = `${UG_BASE}/search.php?search_type=title&value=${encodeURIComponent(q)}&type[]=300`
          const html = await fetchWithUA(searchUrl)
          const store = extractStoreData(html) as Record<string, unknown>

          // Navigate to search results
          const page = (store as any)?.store?.page
          const results = page?.data?.results || []

          // Filter to chords type and map to our format
          const tabs = (Array.isArray(results) ? results : [])
            .filter(
              (r: any) =>
                r.type === 'Chords' || r.type_name === 'chords' || r.type === 'chords',
            )
            .map((r: any) => ({
              id: r.id,
              url: r.tab_url || r.url,
              song_name: r.song_name,
              artist_name: r.artist_name,
              rating: r.rating ?? 0,
              votes: r.votes ?? 0,
              type: r.type || r.type_name || 'Chords',
            }))
            .slice(0, 10)

          sendJson(res, 200, { results: tabs })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Search failed'
          console.error('[ug-proxy] search error:', msg)
          sendJson(res, 500, { error: msg })
        }
      })

      // Tab content endpoint
      server.middlewares.use('/api/ug/tab', async (req, res) => {
        try {
          const params = getQuery(req)
          const tabUrl = params.get('url')
          if (!tabUrl) {
            sendJson(res, 400, { error: 'Missing url parameter' })
            return
          }

          const html = await fetchWithUA(tabUrl)
          const store = extractStoreData(html) as Record<string, unknown>

          const page = (store as any)?.store?.page
          const content =
            page?.data?.tab_view?.wiki_tab?.content ||
            page?.data?.tab?.content ||
            ''

          if (!content) {
            sendJson(res, 404, { error: 'No tab content found' })
            return
          }

          sendJson(res, 200, { content })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Tab fetch failed'
          console.error('[ug-proxy] tab error:', msg)
          sendJson(res, 500, { error: msg })
        }
      })
    },
  }
}
