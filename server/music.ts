import { extract, Lru, videoId } from './runtime.ts'

type Hit = { id: string; title: string; artist: string; album: string | null; duration: number | null }
const cache = new Lru<Hit[]>()
const pending = new Map<string, Promise<Hit[]>>()
export function musicEntries(entries: any[], limit: number, officialOnly: boolean, seed?: string): Hit[] {
  const out: Hit[] = []; const seen = new Set<string>()
  for (const en of entries) {
    if (!en || !videoId.test(en.id) || seen.has(en.id) || en.id === seed || en.is_live || ['is_live', 'is_upcoming'].includes(en.live_status)) continue
    const channel = String(en.channel || en.uploader || '')
    if (officialOnly && !channel.endsWith(' - Topic') && !/vevo/i.test(channel)) continue
    seen.add(en.id)
    const artists = Array.isArray(en.artists) ? en.artists.filter((a: unknown) => typeof a === 'string') : []
    out.push({ id: en.id, title: String(en.title || ''), artist: artists.join(', ') || channel.replace(/ - Topic$|VEVO$/i, '').trim(), album: typeof en.album === 'string' ? en.album : null, duration: typeof en.duration === 'number' && Number.isFinite(en.duration) ? en.duration : null })
    if (out.length >= limit) break
  }
  return out
}
export async function music(kind: 'search' | 'related', value: string, limit: number): Promise<Hit[]> {
  const key = JSON.stringify([kind, value, limit]); const hit = cache.get(key)
  if (hit) return hit
  if (pending.has(key)) return pending.get(key)!
  const work = (async () => {
    const urls = kind === 'search' ? [`https://music.youtube.com/search?q=${encodeURIComponent(value)}#songs`, `ytsearch${Math.min(limit * 3, 60)}:${value}`] : [`https://music.youtube.com/watch?v=${value}&list=RDAMVM${value}`, `https://www.youtube.com/watch?v=${value}&list=RD${value}`]
    let lastError: unknown
    for (const [i, url] of urls.entries()) {
      try {
        const data = await extract(['--flat-playlist', '-J', '--playlist-end', String(limit * 3), '--', url])
        const results = musicEntries(data.entries || [], limit, i === 1, kind === 'related' ? value : undefined)
        if (results.length) { cache.set(key, results, Date.now() + (kind === 'search' ? 600000 : 21600000)); return results }
      } catch (e) { lastError = e }
    }
    if (lastError) throw lastError
    return []
  })()
  pending.set(key, work)
  try { return await work } finally { pending.delete(key) }
}
