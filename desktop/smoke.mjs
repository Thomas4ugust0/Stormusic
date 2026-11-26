import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const profile = await mkdtemp(join(tmpdir(), 'stormusic-windows-'))
const executablePath = fileURLToPath(new URL('./build/windows/win-unpacked/Stormusic.exe', import.meta.url))
const fixture = new URL('./fixtures/silence.m4a', import.meta.url)
const id = 'smokeaudio1'
const title = 'Faixa de teste do Stormusic'
const engineDir = join(profile, 'engine')
let application

async function launch() {
  application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 120000 })
  application.process().stderr?.pipe(process.stderr, { end: false })
  assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile)
  return application.firstWindow({ timeout: 120000 })
}

try {
  await mkdir(join(engineDir, 'audio'), { recursive: true })
  await cp(fixture, join(engineDir, 'audio', `${id}.m4a`))
  const bytes = (await stat(fixture)).size
  await writeFile(join(engineDir, 'library.json'), JSON.stringify({
    version: 1, storageVersion: 2, nextRunAt: 0, lastRunAt: Date.now(),
    tracks: [{ id, title, artist: 'Stormusic', duration: 25, status: 'done', bytes, total: bytes, percent: 100 }],
  }))

  const page = await launch()
  page.setDefaultTimeout(20000)
  await page.getByRole('heading', { name: 'Quais gêneros você curte?' }).waitFor()
  await page.getByRole('button', { name: 'Rock', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByRole('button', { name: 'Indie', exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await page.getByRole('button', { name: 'Arctic Monkeys', exact: true }).click()
  await page.getByRole('button', { name: 'Gerar meu Supermix' }).click()

  const health = await page.evaluate(async () => (await fetch('/health')).json())
  assert.equal(health.status, 'ok')
  assert.match(health.ytdlp_version, /^\d{4}\.\d{2}\.\d{2}/)
  console.log(`Motor disponível: yt-dlp ${health.ytdlp_version}`)

  const pinned = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())
  await page.getByRole('button', { name: 'Modo widget' }).click()
  await page.getByRole('main', { name: 'Widget do Stormusic' }).waitFor()
  assert.equal(await pinned(), true)
  assert.ok(await page.evaluate(() => innerHeight <= 155), 'Widget has compact content bounds')
  await page.getByRole('button', { name: 'Voltar ao app' }).click()
  await page.getByRole('main', { name: 'Widget do Stormusic' }).waitFor({ state: 'hidden' })
  assert.equal(await pinned(), false)

  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click()
  await page.getByRole('button', { name: `Tocar ${title}` }).click()
  await page.getByRole('button', { name: 'Modo widget' }).click()
  const widget = page.getByRole('main', { name: 'Widget do Stormusic' })
  await widget.getByText(title).waitFor()
  const seek = widget.getByRole('slider', { name: 'Posição da faixa' })
  await page.waitForFunction(() => Number(document.querySelector('[aria-label="Posição da faixa"]')?.value) >= 1)
  await widget.getByRole('button', { name: 'Pausar', exact: true }).click()
  const resume = widget.getByRole('button', { name: 'Reproduzir', exact: true })
  await resume.waitFor()
  const pausedAt = Number(await seek.inputValue())
  await resume.click()
  await page.waitForFunction(position => Number(document.querySelector('[aria-label="Posição da faixa"]')?.value) > position, pausedAt)
  await widget.getByRole('button', { name: 'Voltar ao app' }).click()
  await widget.waitFor({ state: 'hidden' })
  assert.equal(await pinned(), false)
  await page.getByText(title).first().waitFor()
  console.log('Widget fixo, faixa local, pausa, retomada e retorno à janela completa verificados.')

  await application.close()
  const restarted = await launch()
  await restarted.getByRole('button', { name: 'Modo widget' }).waitFor()
  await restarted.getByRole('button', { name: 'Biblioteca', exact: true }).click()
  await restarted.getByRole('button', { name: `Tocar ${title}` }).waitFor()
  console.log('Perfil e biblioteca preservados após reabrir o executável.')
} finally {
  await application?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}
