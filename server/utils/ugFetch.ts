import { createHash, randomBytes } from 'crypto'

const UG_API = 'https://api.ultimate-guitar.com/api/v1'
const UG_USER_AGENT = 'UGT_ANDROID/4.11.1 (Pixel; 8.1.0)'

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

export async function ugFetch(path: string, retries = 2): Promise<unknown> {
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
          Connection: 'close',
        },
      })

      if (res.ok) {
        return res.json()
      }

      lastError = new Error(`UG API error: ${res.status} ${res.statusText}`)

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
