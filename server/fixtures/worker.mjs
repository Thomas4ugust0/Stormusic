import { createInterface } from 'node:readline'
createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line)
  if (request.video === 'crash000000') process.exit(1)
  if (request.video === 'timeout0000') return
  if (request.video === 'slow0000000') await new Promise(done => setTimeout(done, 50))
  process.stdout.write(JSON.stringify({ id: request.id, result: { url: 'https://fixture.invalid/' + request.video, duration: 180, ext: 'm4a', abr: 128 } }) + '\n')
})
