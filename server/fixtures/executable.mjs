import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(process.env.FIXTURE_STATE, 'utf8'))
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + '\n')
const save = () => writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(state))
if (args.includes('--version')) {
  if (state.broken) process.exit(1)
  console.log(state.version || '2026.01.01')
} else if (args[0] === 'list') {
  console.log(JSON.stringify([{ name: 'yt-dlp', version: '2026.01.01' }, { name: 'yt-dlp-ejs', version: '0.1.0' }]))
} else if (args[0] === 'install') {
  await new Promise((r) => setTimeout(r, 200))
  if (args.includes('-U')) { state.version = '2026.02.02'; state.broken = !!state.failUpdate }
  else { state.version = '2026.01.01'; state.broken = false }
  save()
} else if (args[0] === 'check') {
  if (state.broken) process.exit(1)
} else if (args[0] === 'branch') console.log('phone-dist')
else if (args[0] === 'status') { if (state.dirty) console.log(' M server/relay.ts') }
else if (args[0] === 'rev-parse') console.log('a'.repeat(40))
else if (['fetch', 'cat-file', 'reset'].includes(args[0])) {
  if (state.failGit) process.exit(1)
} else if (args.includes('--flat-playlist')) {
  const url = args.at(-1)
  if (state.failPrimary && url.startsWith('https://music.youtube.com')) process.exit(1)
  console.log(JSON.stringify({ entries: [
    { id: '9bZkp7q19f0', title: 'Seed', channel: 'PSY - Topic', duration: 200 },
    { id: 'abcdefghijk', title: 'Song', artists: ['Artist'], album: 'Album', channel: 'Artist - Topic', duration: 123 },
    { id: 'abcdefghijk', title: 'Duplicate' },
    { id: '12345678901', title: 'Live', live_status: 'is_live' },
    { id: '23456789012', title: 'Unknown duration', channel: 'SingerVEVO' },
    { id: '34567890123', title: 'Not official', channel: 'Other' },
    { id: '../bad', title: 'Bad ID' }
  ] }))
} else {
  if (state.resolveError) { console.error(state.resolveError); process.exit(1) }
  state.resolves = (state.resolves || 0) + 1; save()
  console.log(JSON.stringify({ url: state.upstream + '/' + state.resolves, duration: 123, ext: 'm4a', abr: 128, is_live: state.live }))
}
