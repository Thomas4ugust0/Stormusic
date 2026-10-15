import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const html = readFileSync(new URL('../public/offline/stormusic-backup.html', import.meta.url), 'utf8')
const source = html.split('<script>')[1].split('</script>')[0]
function page(initial: Record<string, string> = {}, fail = (_key: string) => false) {
  const data = new Map(Object.entries(initial)), blobs: Blob[] = []
  const elements: Record<string, any> = Object.fromEntries(['status','file','understood','restore','export','summary'].map(id => [id, { textContent: '', checked: false, files: [], disabled: true }]))
  runInNewContext(source, {
    document: { querySelector: (selector: string) => elements[selector.slice(1)], createElement: () => ({ click() {} }) },
    localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { if (fail(key)) throw Error('QuotaExceededError'); data.set(key, value) }, removeItem: (key: string) => data.delete(key) },
    Blob, URL: { createObjectURL: (blob: Blob) => { blobs.push(blob); return 'blob:test' }, revokeObjectURL() {} }, setTimeout() {},
  })
  const restore = async (values: Record<string, unknown>, understood = true) => {
    const content = JSON.stringify({ version: 1, kind: 'stormusic-browser', values })
    elements.file.files = [{ size: content.length, text: async () => content }]
    elements.understood.checked = understood
    await elements.restore.onclick()
  }
  return { data, blobs, elements, restore }
}

test('browser export excludes unrelated keys and credentials; restore requires confirmation', async () => {
  const current = page({ 'ytm.profile': '{"genres":["rock"],"subs":[],"artists":[]}', 'ytm.audioflow': 'private-key' })
  current.elements.export.onclick()
  const exported = JSON.parse(await current.blobs[0].text())
  assert.equal(exported.values['ytm.profile'], current.data.get('ytm.profile'))
  assert.ok(!('ytm.audioflow' in exported.values))
  const fresh = page()
  await fresh.restore(exported.values, false)
  assert.equal(fresh.data.size, 0)
  await fresh.restore(exported.values)
  assert.equal(fresh.data.get('ytm.profile'), exported.values['ytm.profile'])
  assert.ok(fresh.data.has('ytm.reinstallBackup'))
})

test('invalid backup or backup quota failure cannot replace current browser data', async () => {
  const original = '{"genres":["rock"],"subs":[],"artists":[]}'
  const current = page({ 'ytm.profile': original })
  await current.restore({ 'ytm.profile': '{"genres":"broken"}' })
  assert.equal(current.data.get('ytm.profile'), original)
  await current.restore({ 'ytm.audioflow': 'credentials' })
  assert.ok(!current.data.has('ytm.audioflow'))
  const full = page({ 'ytm.profile': original }, key => key === 'ytm.reinstallBackup')
  await full.restore({ 'ytm.profile': '{"genres":["pop"],"subs":[],"artists":[]}' })
  assert.equal(full.data.get('ytm.profile'), original)
})

test('partial storage failure rolls back replaced and newly introduced keys', async () => {
  const original = '{"genres":["rock"],"subs":[],"artists":[]}'
  let failOnce = true
  const current = page({ 'ytm.profile': original }, key => { if (key !== 'ytm.taste' || !failOnce) return false; failOnce = false; return true })
  await current.restore({ 'ytm.profile': '{"genres":["pop"],"subs":[],"artists":[]}', 'ytm.fb': '{"liked":[],"disliked":[],"played":[]}', 'ytm.taste': '{"ev":[],"meta":{}}' })
  assert.equal(current.data.get('ytm.profile'), original)
  assert.ok(!current.data.has('ytm.fb'))
  assert.ok(!current.data.has('ytm.taste'))
  assert.ok(current.data.has('ytm.reinstallBackup'))
})
