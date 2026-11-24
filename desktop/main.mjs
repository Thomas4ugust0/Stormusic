import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accessHeader, startRelay } from './relay.mjs'
import { downloadVerified, windowsExtractor } from './tool-download.mjs'

const releases = 'https://github.com/Thomas4ugust0/Stormusic/releases'
const desktopDir = fileURLToPath(new URL('.', import.meta.url))
const resources = app.isPackaged ? process.resourcesPath : join(desktopDir, 'build')
const webDir = join(resources, 'web')
const serverDir = app.isPackaged ? join(resources, 'server') : join(desktopDir, '..', 'server')

app.setName('Stormusic')
app.setAppUserModelId('app.stormusic.desktop')

let window
let relay
let expanded

function showWindow() {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function openWindow() {
  const stateDir = join(app.getPath('userData'), 'engine')
  const windows = process.platform === 'win32'
  const extractor = windows ? join(stateDir, 'tools', windowsExtractor.version, 'yt-dlp.exe') : undefined
  let extractorError
  if (extractor) {
    try { await downloadVerified(windowsExtractor, extractor) }
    catch (error) { extractorError = error }
  }
  relay = await startRelay({
    serverDir,
    webDir,
    stateDir,
    extractor,
    node: windows ? join(resources, 'tools', 'node.exe') : undefined,
  })

  Menu.setApplicationMenu(null)
  window = new BrowserWindow({
    title: 'Stormusic',
    width: 550,
    height: 820,
    minWidth: 400,
    minHeight: 540,
    backgroundColor: '#101018',
    icon: join(webDir, 'stormusic-icon-192.png'),
    show: false,
    webPreferences: {
      preload: join(desktopDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  const { webContents } = window
  const { session } = webContents
  session.setPermissionCheckHandler(() => false)
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    const requestHeaders = new URL(details.url).origin === relay.origin
      ? { ...details.requestHeaders, [accessHeader]: relay.token }
      : details.requestHeaders
    callback({ requestHeaders })
  })
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  webContents.on('will-frame-navigate', event => {
    event.preventDefault()
    if (event.isMainFrame && event.url === releases) void shell.openExternal(releases).catch(console.error)
  })
  webContents.on('will-redirect', event => event.preventDefault())

  ipcMain.handle('stormusic:set-compact', (event, compact) => {
    if (event.sender !== webContents || event.senderFrame !== webContents.mainFrame || event.senderFrame.url !== `${relay.origin}/` || typeof compact !== 'boolean') return false
    if (compact && !expanded) {
      expanded = { bounds: window.getNormalBounds(), maximized: window.isMaximized() }
      if (expanded.maximized) window.unmaximize()
      window.setMinimumSize(400, 160)
      window.setContentSize(438, 150)
      window.setResizable(false)
      window.setAlwaysOnTop(true)
    } else if (!compact && expanded) {
      window.setAlwaysOnTop(false)
      window.setResizable(true)
      window.setMinimumSize(400, 540)
      window.setBounds(expanded.bounds)
      if (expanded.maximized) window.maximize()
      expanded = undefined
    }
    return true
  })

  window.once('ready-to-show', showWindow)
  await window.loadURL(`${relay.origin}/`)
  if (extractorError) {
    console.error(extractorError)
    await dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Motor do Stormusic',
      message: 'O motor de áudio não pôde ser baixado.',
      detail: 'Para pesquisar e tocar faixas online, conecte-se à internet e abra o Stormusic novamente. As faixas já baixadas continuam disponíveis.',
    })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    relay?.server.close()
    relay?.server.closeAllConnections()
  })
  void app.whenReady().then(openWindow).catch(error => {
    console.error(error)
    dialog.showErrorBox('Stormusic', error.code === 'EADDRINUSE'
      ? 'A porta local 38277 está em uso. Feche o programa que a está usando e abra o Stormusic novamente.'
      : 'Falha ao iniciar o Stormusic. Baixe novamente o executável e tente abrir de novo.')
    app.quit()
  })
}
