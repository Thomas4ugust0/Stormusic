const target = process.argv[2] || 'ytdlp'
if (!['app', 'ytdlp'].includes(target)) throw new Error('Uso: bash phone/update.sh [ytdlp|app]')
const response = await fetch('http://localhost:8787/api/admin/update-' + target, { method: 'POST', headers: { 'Sec-Fetch-Site': 'same-origin', 'X-Stormusic': '1' } })
console.log(await response.text())
if (!response.ok) process.exitCode = 1
