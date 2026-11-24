import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

export const windowsExtractor = {
  version: '2026.11.23',
  url: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp.exe',
  sha256: '622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c',
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function downloadVerified(tool, destination) {
  const existing = await readFile(destination).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (existing && sha256(existing) === tool.sha256) return

  if (existing) await unlink(destination)
  const response = await fetch(tool.url, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`Download falhou (HTTP ${response.status}).`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== tool.sha256) throw new Error(`SHA-256 inválido para ${tool.url}.`)

  const temporary = `${destination}.tmp`
  await mkdir(dirname(destination), { recursive: true })
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, destination)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}
