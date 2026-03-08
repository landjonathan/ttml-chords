import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { createHash, randomBytes } from 'crypto'

const UG_API = 'https://api.ultimate-guitar.com/api/v1'
const UG_USER_AGENT = 'UGT_ANDROID/4.11.1 (Pixel; 8.1.0)'

/**
 * Generate a random 16-char hex device ID.
 */
function generateDeviceId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Generate the X-UG-API-KEY header value.
 * Formula: md5(deviceId + "YYYY-MM-DD:H" (UTC, non-padded hour) + "createLog()")
 */
function generateApiKey(deviceId: string): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const hh = now.getUTCHours()
  const datePart = `${yyyy}-${mm}-${dd}:${hh}`
  const payload = `${deviceId}${datePart}createLog()`
  return createHash('md5').update(payload).digest('hex')
}

async function ugFetch(path: string, retries = 2): Promise<unknown> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Fresh credentials per attempt
    const deviceId = generateDeviceId()
    const apiKey = generateApiKey(deviceId)

    try {
      const res = await fetch(`${UG_API}${path}`, {
        headers: {
          'User-Agent': UG_USER_AGENT,
          Accept: 'application/json',
          'Accept-Charset': 'utf-8',
          'X-UG-CLIENT-ID': deviceId,
          'X-UG-API-KEY': apiKey,
          Connection: 'close',
        },
      })

      if (res.ok) {
        return res.json()
      }

      lastError = new Error(`UG API error: ${res.status} ${res.statusText}`)

      // Only retry on server errors or unexpected client errors (not 400/401)
      if (res.status < 500 && res.status !== 404 && res.status !== 498) {
        throw lastError
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('UG API request failed')
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
    }
  }

  throw lastError!
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function getQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`,
  )
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

          // type=300 = Chords
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

          sendJson(res, 200, { results: tabs })
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Search failed'
          console.error('[ug-proxy] search error:', msg)
          sendJson(res, 500, { error: msg })
        }
      })

      // Tab content endpoint — accepts tab_id
      server.middlewares.use('/api/ug/tab', async (req, res) => {
        try {
          const params = getQuery(req)
          const tabId = params.get('id')
          if (!tabId) {
            sendJson(res, 400, { error: 'Missing id parameter' })
            return
          }

          const data = (await ugFetch(
            `/tab/info?tab_id=${encodeURIComponent(tabId)}&tab_access_type=public`,
          )) as Record<string, unknown>

          const content = data.content
          if (!content || typeof content !== 'string') {
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
