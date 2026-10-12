export type Track = { id: string; title: string; artist: string; genre: string; sub: string; moods: Mood[]; energy: number; ytId: string; dur: number }
export type Mood = 'energia' | 'foco' | 'treino' | 'relaxar' | 'festa' | 'triste'

export const MOODS: { id: Mood | 'all'; label: string }[] = [
  { id: 'all', label: 'Tudo' }, { id: 'energia', label: 'Energia' }, { id: 'foco', label: 'Foco' },
  { id: 'treino', label: 'Treino' }, { id: 'relaxar', label: 'Relaxar' }, { id: 'festa', label: 'Festa' }, { id: 'triste', label: 'Melancolia' },
]

export const GENRES: { id: string; label: string; subs: string[]; color: string }[] = [
  { id: 'rock', label: 'Rock', subs: ['Alternativo', 'Indie', 'Clássico', 'Grunge'], color: '#b91c1c' },
  { id: 'pop', label: 'Pop', subs: ['Dance Pop', 'Synthpop', 'Teen Pop'], color: '#db2777' },
  { id: 'hiphop', label: 'Hip-Hop', subs: ['Trap', 'Boom Bap', 'Conscious'], color: '#ca8a04' },
  { id: 'eletronica', label: 'Eletrônica', subs: ['House', 'Synthwave', 'Techno'], color: '#7c3aed' },
  { id: 'mpb', label: 'MPB', subs: ['Bossa Nova', 'Nova MPB', 'Tropicália'], color: '#059669' },
  { id: 'rnb', label: 'R&B / Soul', subs: ['Neo Soul', 'R&B Moderno'], color: '#ea580c' },
  { id: 'lofi', label: 'Lo-fi / Chill', subs: ['Lo-fi Beats', 'Ambient'], color: '#0891b2' },
  { id: 'sertanejo', label: 'Sertanejo', subs: ['Universitário', 'Raiz'], color: '#65a30d' },
]

const raw: [string, string, string, string, Mood[], number, string, number][] = [
  ['Do I Wanna Know?', 'Arctic Monkeys', 'rock', 'Indie', ['foco', 'energia'], 0.6, 'bpOSxM0rNPM', 272],
  ['R U Mine?', 'Arctic Monkeys', 'rock', 'Indie', ['energia', 'treino'], 0.85, 'ngzC_8zqInk', 202],
  ['505', 'Arctic Monkeys', 'rock', 'Indie', ['triste', 'relaxar'], 0.45, 'qU9mHegkTc4', 253],
  ['Smells Like Teen Spirit', 'Nirvana', 'rock', 'Grunge', ['energia', 'treino'], 0.95, 'hTWKbfoikeg', 301],
  ['Come As You Are', 'Nirvana', 'rock', 'Grunge', ['foco'], 0.6, 'vabnZ9-ex7o', 219],
  ['The Less I Know The Better', 'Tame Impala', 'rock', 'Alternativo', ['festa', 'relaxar'], 0.65, 'O2lzmpEs29M', 216],
  ['Let It Happen', 'Tame Impala', 'rock', 'Alternativo', ['foco', 'energia'], 0.7, 'pFptt7Cargc', 467],
  ['Bohemian Rhapsody', 'Queen', 'rock', 'Clássico', ['energia'], 0.7, 'fJ9rUzIMcZQ', 355],
  ['Seven Nation Army', 'The White Stripes', 'rock', 'Alternativo', ['treino', 'energia'], 0.9, '0J2QdDbelmY', 231],
  ['Mr. Brightside', 'The Killers', 'rock', 'Indie', ['festa', 'energia'], 0.9, 'gGdGFtwCNBE', 222],
  ['Blinding Lights', 'The Weeknd', 'pop', 'Synthpop', ['energia', 'treino', 'festa'], 0.9, '4NRXx6U8ABQ', 200],
  ['Save Your Tears', 'The Weeknd', 'pop', 'Synthpop', ['festa', 'relaxar'], 0.7, 'XXYlFuWEuKI', 215],
  ['Levitating', 'Dua Lipa', 'pop', 'Dance Pop', ['festa', 'energia'], 0.88, 'TUVcZfQe-Kw', 203],
  ["Don't Start Now", 'Dua Lipa', 'pop', 'Dance Pop', ['treino', 'festa'], 0.9, 'oygrmJFKYZY', 183],
  ['drivers license', 'Olivia Rodrigo', 'pop', 'Teen Pop', ['triste'], 0.3, 'ZmDBbnmKpqQ', 242],
  ['good 4 u', 'Olivia Rodrigo', 'pop', 'Teen Pop', ['treino', 'energia'], 0.92, 'gNi_6U5Pm_o', 178],
  ['Anti-Hero', 'Taylor Swift', 'pop', 'Synthpop', ['foco', 'relaxar'], 0.6, 'b1kbLwvqugk', 200],
  ['HUMBLE.', 'Kendrick Lamar', 'hiphop', 'Conscious', ['treino', 'energia'], 0.9, 'tvTRZJ-4EyI', 177],
  ['Alright', 'Kendrick Lamar', 'hiphop', 'Conscious', ['energia', 'foco'], 0.75, 'Z-48u_uWMHY', 219],
  ['SICKO MODE', 'Travis Scott', 'hiphop', 'Trap', ['treino', 'festa'], 0.88, '6ONRf7h3Mdk', 312],
  ['goosebumps', 'Travis Scott', 'hiphop', 'Trap', ['festa', 'relaxar'], 0.65, 'Dst9gZkq1a8', 243],
  ['N.Y. State of Mind', 'Nas', 'hiphop', 'Boom Bap', ['foco'], 0.65, 'hI8A14Qcv68', 294],
  ['Lose Yourself', 'Eminem', 'hiphop', 'Boom Bap', ['treino', 'energia'], 0.95, '_Yhyp-_hX2s', 326],
  ['One More Time', 'Daft Punk', 'eletronica', 'House', ['festa', 'energia'], 0.9, 'FGBhQbmPwH8', 320],
  ['Get Lucky', 'Daft Punk', 'eletronica', 'House', ['festa', 'relaxar'], 0.75, '5NV6Rdv1a3I', 248],
  ['Nightcall', 'Kavinsky', 'eletronica', 'Synthwave', ['foco', 'relaxar'], 0.55, 'MV_3Dpw-BRY', 258],
  ['Midnight City', 'M83', 'eletronica', 'Synthwave', ['energia', 'foco'], 0.8, 'dX3k_QDnzHE', 243],
  ['Strobe', 'deadmau5', 'eletronica', 'Techno', ['foco', 'relaxar'], 0.5, 'tKi9Z-f6qX4', 637],
  ['Garota de Ipanema', 'Tom Jobim', 'mpb', 'Bossa Nova', ['relaxar', 'foco'], 0.3, 'KJzBxJ8ExRk', 324],
  ['Chega de Saudade', 'João Gilberto', 'mpb', 'Bossa Nova', ['relaxar', 'triste'], 0.25, 'vVBQ0XUd8zE', 120],
  ['Trem-Bala', 'Ana Vilela', 'mpb', 'Nova MPB', ['triste', 'relaxar'], 0.3, 'sWVB5j4xyDw', 233],
  ['Velha Infância', 'Tribalistas', 'mpb', 'Nova MPB', ['relaxar'], 0.4, 'j3YJGVzHD1s', 260],
  ['Baianidade Nagô', 'Caetano Veloso', 'mpb', 'Tropicália', ['festa'], 0.6, 'h5mzrSnkZA0', 245],
  ['Ainda Gosto Dela', 'Skank', 'mpb', 'Nova MPB', ['foco'], 0.55, 'U2bB4qb3jhE', 250],
  ['Redbone', 'Childish Gambino', 'rnb', 'Neo Soul', ['relaxar', 'foco'], 0.45, 'Kp7eSUU9oy8', 327],
  ['Thinkin Bout You', 'Frank Ocean', 'rnb', 'R&B Moderno', ['triste', 'relaxar'], 0.35, 'pNBD4OFF8cc', 201],
  ['Kill Bill', 'SZA', 'rnb', 'R&B Moderno', ['festa', 'relaxar'], 0.6, 'MSRcC626prw', 153],
  ['Snooze', 'SZA', 'rnb', 'R&B Moderno', ['relaxar'], 0.45, 'LKYcW0EZSSQ', 201],
  ['Lofi Study Session', 'Lofi Girl', 'lofi', 'Lo-fi Beats', ['foco', 'relaxar'], 0.2, 'jfKfPfyJRdk', 240],
  ['Rainy Night Tokyo', 'Kupla', 'lofi', 'Lo-fi Beats', ['foco', 'triste'], 0.2, 'rUxyKA_-grg', 180],
  ['Weightless', 'Marconi Union', 'lofi', 'Ambient', ['relaxar', 'foco'], 0.1, 'UfcAVejslrU', 480],
  ['Evidências', 'Chitãozinho & Xororó', 'sertanejo', 'Raiz', ['triste', 'festa'], 0.5, 'ePjtnSPFWK8', 280],
  ['Atrasadinha', 'Felipe Araújo', 'sertanejo', 'Universitário', ['festa'], 0.75, 'iL3lRGw1Pg0', 170],
  ['Batom de Cereja', 'Israel & Rodolffo', 'sertanejo', 'Universitário', ['festa', 'energia'], 0.8, 'vS4Fv2qoFnU', 190],
]

export const TRACKS: Track[] = raw.map(([title, artist, genre, sub, moods, energy, ytId, dur], i) => ({ id: 't' + i, title, artist, genre, sub, moods, energy, ytId, dur }))
export const ARTISTS = [...new Set(TRACKS.map((t) => t.artist))].map((name) => ({ name, genre: TRACKS.find((t) => t.artist === name)!.genre }))
export const thumb = (t: Track, q: 'hq' | 'mq' = 'hq') => `https://i.ytimg.com/vi/${t.ytId}/${q}default.jpg`
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
