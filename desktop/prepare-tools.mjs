import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { downloadVerified } from './tool-download.mjs'

const output = fileURLToPath(new URL('./build/tools', import.meta.url))
const version = 'v24.22.3'

await Promise.all([
  downloadVerified({
    url: `https://nodejs.org/dist/${version}/win-x64/node.exe`,
    sha256: '86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6',
  }, join(output, 'node.exe')),
  downloadVerified({
    url: `https://raw.githubusercontent.com/nodejs/node/${version}/LICENSE`,
    sha256: '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace',
  }, join(output, 'node-LICENSE.txt')),
])
