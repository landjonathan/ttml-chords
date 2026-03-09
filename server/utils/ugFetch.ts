import { createHash, randomBytes } from 'crypto'

const UG_API = 'https://api.ultimate-guitar.com/api/v1'
const UG_USER_AGENT = 'UGT_ANDROID/4.11.1 (Pixel; 8.1.0)'

/** Error thrown by ugFetch with the upstream HTTP status preserved. */
export class UgApiError extends Error {
  constructor(
    public readonly status: number,
    statusText: string,
  ) {
    super(`UG API error: ${status} ${statusText}`)
    this.name = 'UgApiError'
  }
}

function generateDeviceId(): string {
  return randomBytes(8).toString('hex')
}

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

/**
 * Fetch from the UG mobile API with automatic retries for transient errors
 * (5xx, 404 auth mismatches, 498). A new device-id / api-key pair is
 * generated for every attempt so transient key-validation failures on the UG
 * side are unlikely to persist across all attempts.
 */
export async function ugFetch(path: string, retries = 3): Promise<unknown> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
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
        },
      })

      if (res.ok) {
        return res.json()
      }

      lastError = new UgApiError(res.status, res.statusText)

      // Only retry on 5xx, 404 (transient auth), or 498 — everything else
      // is a deterministic client error that won't change on retry.
      if (res.status < 500 && res.status !== 404 && res.status !== 498) {
        throw lastError
      }
    } catch (e) {
      if (e instanceof UgApiError) {
        lastError = e
      } else {
        lastError = e instanceof Error ? e : new Error('UG API request failed')
      }
    }

    if (attempt < retries) {
      // Exponential back-off with jitter: ~750ms, ~1500ms, ~3000ms
      const base = 750 * Math.pow(2, attempt)
      const jitter = Math.random() * 250
      await new Promise((r) => setTimeout(r, base + jitter))
    }
  }

  throw lastError!
}
