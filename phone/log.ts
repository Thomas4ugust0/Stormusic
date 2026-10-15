import { appendFileSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
const path = process.argv[2]
const limit = 1024 * 1024
if (existsSync(path) && statSync(path).size > limit) writeFileSync(path, readFileSync(path).subarray(-limit))
process.stdin.on('data', (data: Buffer) => {
  appendFileSync(path, data.subarray(-limit))
  if (statSync(path).size > limit) writeFileSync(path, readFileSync(path).subarray(-limit))
})
