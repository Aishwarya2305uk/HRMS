/**
 * Where a check-in came from: the client IP, and the coarse city/country that
 * IP resolves to.
 *
 * The IP itself is free — it's already on the request. The city/country needs
 * a lookup against a public IP-geolocation service, which is why every part of
 * this module is deliberately fail-soft: a check-in must NEVER fail, or even
 * slow down noticeably, because a third-party geo API was down, rate-limited
 * or slow. Every failure path returns EMPTY_LOCATION and the attendance row is
 * still written with the IP.
 *
 * Accuracy expectations, stated once here because the UI copy depends on them:
 * IP geolocation is city-level *at best*. A VPN, a mobile carrier's NAT or a
 * corporate egress point routinely reports the wrong city — this is a rough
 * "roughly where from" signal for attendance review, not proof of location.
 */
import { GEOIP_ENABLED, GEOIP_URL } from '../env.js'

/** What every failure path returns, so callers never branch on null. */
export const EMPTY_LOCATION = { city: '', region: '', country: '', countryCode: '' }

/** Give up on the provider well inside a click's worth of patience. */
const LOOKUP_TIMEOUT_MS = 2500

/** Successful lookups are reused for a day — an IP's city doesn't move, and
 *  a whole office checking in from one egress IP costs a single call. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map()

/** Warn once per process, not once per check-in, when a provider misbehaves. */
let warned = false
function warnOnce(message) {
  if (warned) return
  warned = true
  console.warn(`[geoip] ${message} — check-ins will record the IP without a city/country.`)
}

/**
 * The client's IP for this request. Express already resolves proxy hops via
 * `trust proxy` (see app.js); this only strips the IPv4-mapped-IPv6 prefix
 * ('::ffff:203.0.113.4') so what we store reads like an address people
 * recognise.
 */
export function clientIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim()
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip
}

/**
 * Addresses that can't have a public location of their own: loopback, RFC1918 /
 * RFC4193 private ranges, link-local. Local dev, same-host and LAN requests
 * land here — lookupLocation resolves these to the network's shared egress
 * location instead of asking the provider about an unroutable address.
 */
export function isPrivateIp(ip) {
  if (!ip) return true
  if (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('127.')) return true
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip)) return true
  return false
}

/**
 * Map a provider's JSON onto our shape. Written to tolerate the two common
 * field conventions so GEOIP_URL can be pointed at a different service without
 * a code change: ip-api.com ({ status, city, regionName, country: 'India',
 * countryCode: 'IN' }) and ipapi.co-style ({ city, region, country: 'IN',
 * country_name: 'India' }). Anything unrecognised reads as a miss.
 */
function normalize(data) {
  if (!data || typeof data !== 'object') return null
  if (data.status && data.status !== 'success') return null // ip-api failure shape
  if (data.error) return null // ipapi.co failure shape

  const text = (v) => String(v ?? '').trim()
  const city = text(data.city)
  const region = text(data.regionName ?? data.region)
  // 'country' means the full name on one provider and the 2-letter code on the
  // other — tell them apart by length rather than by provider.
  const rawCountry = text(data.country)
  const country = text(data.country_name) || (rawCountry.length > 2 ? rawCountry : '')
  const code = (text(data.countryCode ?? data.country_code) ||
    (rawCountry.length === 2 ? rawCountry : '')).toUpperCase()

  if (!city && !country && !code) return null
  return { city, region, country, countryCode: code.slice(0, 2) }
}

/**
 * Cache key for "this network's own public location" — the egress lookup
 * below. Not a valid IP, so it can never collide with a real cache entry.
 */
const EGRESS_KEY = '@egress'

/**
 * City/country for an IP, or EMPTY_LOCATION when it can't be determined —
 * disabled by config, a provider error, or a timeout. Never throws.
 *
 * A private/loopback IP (LAN check-ins, local dev, on-prem deployments) has
 * no public location of its own — but the network it sits on does. For those
 * we ask the provider for the CALLER's location instead (URL with an empty
 * {ip}): the server's public egress IP, which everyone on the same network
 * shares. That's the right coarse answer exactly when private client IPs
 * occur — client and server on one network behind one internet connection.
 */
export async function lookupLocation(ip) {
  if (!GEOIP_ENABLED) return EMPTY_LOCATION
  if (!GEOIP_URL.includes('{ip}')) {
    warnOnce('GEOIP_URL has no {ip} placeholder')
    return EMPTY_LOCATION
  }

  const key = isPrivateIp(ip) ? EGRESS_KEY : ip
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), LOOKUP_TIMEOUT_MS)
  try {
    const res = await fetch(
      GEOIP_URL.replace('{ip}', key === EGRESS_KEY ? '' : encodeURIComponent(ip)),
      {
        signal: abort.signal,
        headers: { accept: 'application/json' },
      },
    )
    if (!res.ok) {
      warnOnce(`lookup provider returned HTTP ${res.status}`)
      return EMPTY_LOCATION
    }
    const location = normalize(await res.json())
    if (!location) return EMPTY_LOCATION
    cache.set(key, { at: Date.now(), value: location })
    return location
  } catch (err) {
    warnOnce(err?.name === 'AbortError' ? 'lookup timed out' : `lookup failed (${err?.message})`)
    return EMPTY_LOCATION
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Everything to stamp on a check-in: the request's IP plus its resolved
 * location. One await, one shape, used by both check-in routes.
 */
export async function captureCheckInOrigin(req) {
  const ip = clientIp(req)
  const location = await lookupLocation(ip)
  return { ip: ip.slice(0, 64) || null, ...location }
}

/** "Mumbai, Maharashtra, India" from the stored columns — '' when unknown. */
export function locationLabel({ city, region, country }) {
  return [city, region, country].map((v) => String(v || '').trim()).filter(Boolean).join(', ')
}
