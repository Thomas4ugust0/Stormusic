// PC-side packaging only. No npm installation/build is needed on Android.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const artifacts = resolve(root, 'artifacts')
await mkdir(artifacts, { recursive: true })
const stage = await mkdtemp(resolve(artifacts, 'runtime-'))
const output = resolve(artifacts, 'Stormusic-celular')
await mkdir(output, { recursive: true })
try {
  for (const path of ['dist', 'server', 'phone', 'package.json']) await cp(resolve(root, path), resolve(stage, path), { recursive: true, filter: (src) => !src.endsWith('.test.ts') && !src.endsWith('_test.py') && !src.endsWith('.pyc') && !src.endsWith('__pycache__') && !src.endsWith('fixtures') && !src.endsWith('package.mjs') })
  for (const name of await readdir(resolve(stage, 'phone'))) if (name.endsWith('.sh')) {
    const script = resolve(stage, 'phone', name)
    await writeFile(script, (await readFile(script, 'utf8')).replace(/\r\n/g, '\n'))
  }
  const git = (args) => execFileSync('git', args, { cwd: stage, windowsHide: true, stdio: 'pipe' })
  git(['init', '-b', 'phone-dist'])
  git(['config', 'core.autocrlf', 'false'])
  git(['config', 'user.name', 'Stormusic local build'])
  git(['config', 'user.email', 'build@stormusic.local'])
  git(['add', '.'])
  for (const name of await readdir(resolve(stage, 'phone'))) if (name.endsWith('.sh')) git(['update-index', '--chmod=+x', 'phone/' + name])
  git(['commit', '-m', 'Build standalone phone distribution'])
  git(['bundle', 'create', resolve(output, 'stormusic.bundle'), 'phone-dist'])
  git(['bundle', 'verify', resolve(output, 'stormusic.bundle')])
  await cp(resolve(stage, 'phone/setup.sh'), resolve(output, 'setup.sh'))
  await cp(resolve(root, 'docs/PHONE.md'), resolve(output, 'LEIA-ME.md'))
  await writeFile(resolve(output, 'VERSAO.txt'), 'Stormusic — distribuição local compilada\n' + new Date().toISOString() + '\n')
  console.log('Pacote pronto em ' + output)
} finally {
  // This exact directory was created above under the project's artifacts root.
  if (!stage.startsWith(artifacts + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unexpected staging path')
  await rm(stage, { recursive: true, force: true })
}
