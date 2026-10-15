import { resetResolver } from './resolver.ts'
import { mkdir, readFile, rename, writeFile, access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError, command, ytdlpPath } from './runtime.ts'

type Update = { state: 'idle' | 'running' | 'ok' | 'failed'; ytdlp_version: string | null; updated_at: number | null; message: string; target?: 'app' | 'ytdlp' }
const stateDir = () => process.env.RELAY_STATE_DIR || resolve(homedir(), '.stormusic')
const root = process.env.RELAY_APP_DIR || fileURLToPath(new URL('../', import.meta.url))
let state: Update = { state: 'idle', ytdlp_version: null, updated_at: null, message: '' }
let loaded: Promise<void> | undefined
let lock = false
let version: { value: string | null; at: number } = { value: null, at: 0 }
async function load() {
  loaded ??= (async () => {
    try {
      const old = JSON.parse(await readFile(resolve(stateDir(), 'state.json'), 'utf8'))
      state = { ...state, ...old }
      if (state.state === 'running') state = { ...state, state: 'failed', message: 'A atualização foi interrompida. Tente novamente.' }
    } catch { /* First launch. */ }
  })()
  await loaded
}
async function persist() {
  await mkdir(stateDir(), { recursive: true })
  const path = resolve(stateDir(), 'state.json')
  await writeFile(path + '.tmp', JSON.stringify(state), { mode: 0o600 })
  await rename(path + '.tmp', path)
}
export async function getVersion(force = false) {
  if (force || Date.now() - version.at > 600000) {
    version = { value: await command(ytdlpPath(), ['--ignore-config', '--version'], 10000).catch(() => null), at: Date.now() }
  }
  return version.value
}
export async function healthStatus() {
  await load()
  const ytdlp_version = await getVersion()
  return { status: ytdlp_version ? 'ok' : 'degraded', js_runtime: `node ${process.versions.node}`, ...state, state: lock ? 'running' : state.state, ytdlp_version }
}
async function updateYtdlp() {
  const pip = process.env.RELAY_PIP || 'pip'
  let pinned: string[] = []
  try {
    const packages = JSON.parse(await command(pip, ['list', '--format=json'], 30000)) as { name: string; version: string }[]
    pinned = ['yt-dlp', 'yt-dlp-ejs'].map((name) => {
      const item = packages.find((p) => p.name.toLowerCase().replace(/_/g, '-') === name)
      if (!item || !/^[\w.+!-]+$/.test(item.version)) throw new Error('missing installed version')
      return `${name}==${item.version}`
    })
    await command(pip, ['install', '-U', 'yt-dlp', 'yt-dlp-ejs'], 300000)
    const current = await getVersion(true)
    if (!current) throw new Error('version check failed')
    await command(process.execPath, ['--version'], 10000)
    await command(pip, ['check'], 30000)
    state = { ...state, state: 'ok', ytdlp_version: current, updated_at: Date.now(), message: 'yt-dlp atualizado e verificado.' }
  } catch {
    let restored = false
    if (pinned.length === 2) {
      try { await command(pip, ['install', '--force-reinstall', ...pinned], 300000); restored = !!await getVersion(true) } catch { /* Report rollback failure explicitly. */ }
    }
    state = { ...state, state: 'failed', message: restored ? 'Atualização falhou. Versões anteriores restauradas.' : 'Atualização falhou; não foi possível confirmar a restauração. Verifique a instalação no Termux.' }
  }
}
async function updateApp(restart: () => void) {
  const git = process.env.RELAY_GIT || 'git'
  const run = (args: string[]) => command(git, args, 300000, root)
  let previous = ''; let changed = false
  try {
    // Never reset a developer checkout or discard local work.
    if (await run(['branch', '--show-current']) !== 'phone-dist') throw new Error('not phone distribution')
    if (await run(['status', '--porcelain'])) throw new Error('dirty checkout')
    previous = await run(['rev-parse', 'HEAD'])
    await run(['fetch', '--depth', '1', 'origin', 'phone-dist'])
    for (const path of ['dist/index.html', 'server/standalone.ts', 'phone/start.sh']) await run(['cat-file', '-e', `FETCH_HEAD:${path}`])
    changed = true; await run(['reset', '--hard', 'FETCH_HEAD'])
    await access(resolve(root, 'dist/index.html'))
    await command(process.execPath, ['--input-type=module', '-e', "await import('./server/standalone.ts')"], 10000, root)
    state = { ...state, state: 'ok', message: 'App atualizado. Reiniciando o motor local.' }
    await persist()
    setTimeout(restart, 750).unref()
  } catch {
    let restored = !changed
    if (changed && previous) { try { await run(['reset', '--hard', previous]); restored = true } catch { /* Report below. */ } }
    state = { ...state, state: 'failed', message: restored ? 'App não atualizado. Use a instalação phone-dist sem alterações locais; a versão anterior foi preservada.' : 'Falha na atualização e na restauração do app. Reinstale o pacote pelo Termux.' }
  }
}
export async function startUpdate(target: 'app' | 'ytdlp', restart: () => void = () => process.exit(0)) {
  await load()
  if (lock) throw new ApiError('update_busy', 'Uma atualização já está em andamento.', 409, true)
  lock = true
  state = { ...state, state: 'running', target, message: target === 'app' ? 'Atualizando o app…' : 'Atualizando yt-dlp…' }
  try { await persist() } catch { lock = false; state.state = 'failed'; throw new ApiError('state_unavailable', 'Não foi possível salvar o estado da atualização.', 500) }
  void (async () => {
    try { if (target === 'app') await updateApp(restart); else { await updateYtdlp(); resetResolver() } await persist() }
    catch { state = { ...state, state: 'failed', message: 'Falha ao salvar a atualização.' } }
    finally { lock = false }
  })()
  return { ...state }
}
export async function autoUpdate() {
  await load()
  const days = Number(process.env.RELAY_AUTO_UPDATE_DAYS ?? 7)
  if (days > 0 && Date.now() - (state.updated_at ?? 0) > days * 86400000) await startUpdate('ytdlp').catch(() => {})
}
