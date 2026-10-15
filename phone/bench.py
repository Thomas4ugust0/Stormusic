"""Benchmark de resolução, sem salvar URLs assinadas ou saída do extrator."""
import argparse
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import time

CLIENTS = ['default', 'visionos', 'tv', 'web_safari', 'android_vr', 'ios']
IDS = ['bpOSxM0rNPM', 'ngzC_8zqInk', 'qU9mHegkTc4', 'hTWKbfoikeg',
       'vabnZ9-ex7o', 'O2lzmpEs29M', 'pFptt7Cargc', 'fJ9rUzIMcZQ',
       '0J2QdDbelmY', 'gGdGFtwCNBE']


def measure(video, client, runner=subprocess.run, clock=time.perf_counter):
    args = ['yt-dlp', '--ignore-config', '--no-warnings', '--js-runtimes', 'node',
            '-j', '--no-playlist', '-f', 'bestaudio[ext=m4a]/bestaudio', '--skip-download']
    if client != 'default':
        args += ['--extractor-args', 'youtube:player_client=' + client]
    args += ['--', 'https://www.youtube.com/watch?v=' + video]
    start = clock()
    error = None
    try:
        result = runner(args, capture_output=True, text=True, timeout=45, shell=False)
        if result.returncode:
            error = 'extract_failed'
        else:
            data = json.loads(result.stdout)
            if not isinstance(data, dict) or not data.get('url') or data.get('is_live'):
                error = 'no_audio'
    except subprocess.TimeoutExpired:
        error = 'extract_timeout'
    except (ValueError, UnicodeError):
        error = 'invalid_output'
    except OSError:
        error = 'executable_unavailable'
    return dict(id=video, client=client, resolve_ms=round((clock() - start) * 1000, 2), error=error)


def summary(samples, clients):
    lines = ['Cliente | Sucessos | Mediana de resolução (ms) | Falhas']
    for client in clients:
        rows = [s for s in samples if s['client'] == client]
        times = [s['resolve_ms'] for s in rows if s['error'] is None]
        errors = {}
        for row in rows:
            if row['error']:
                errors[row['error']] = errors.get(row['error'], 0) + 1
        median = str(round(statistics.median(times), 2)) if times else 'sem sucesso'
        lines.append(f'{client} | {len(times)}/{len(rows)} | {median} | {json.dumps(errors)}')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clients', nargs='+', choices=CLIENTS, default=CLIENTS)
    parser.add_argument('--ids', nargs=10, default=IDS)
    parser.add_argument('--network', choices=['wifi', 'mobile', 'uninformed'], default='uninformed')
    parser.add_argument('--delay', type=int, choices=range(0, 61), default=15, metavar='0..60')
    args = parser.parse_args()
    if len(set(args.ids)) != 10 or any(not re.fullmatch(r'[A-Za-z0-9_-]{11}', v) for v in args.ids):
        parser.error('Informe dez IDs distintos de vídeo, com 11 caracteres válidos.')
    clients = list(dict.fromkeys(args.clients))
    directory = Path(os.environ.get('RELAY_STATE_DIR') or Path.home() / '.stormusic')
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f'bench-{time.strftime("%Y%m%d-%H%M%S")}-{os.getpid()}.jsonl'
    samples = []
    print('Mantenha o Termux em primeiro plano. Apenas resolução; não mede som nem baixa áudio.', flush=True)
    with output.open('x', encoding='utf-8') as log:
        os.chmod(output, 0o600)
        for index, video in enumerate(args.ids):
            order = clients[index % len(clients):] + clients[:index % len(clients)]
            for client in order:
                row = measure(video, client)
                row.update(network=args.network, at=time.strftime('%Y-%m-%dT%H:%M:%S%z'))
                samples.append(row)
                log.write(json.dumps(row) + '\n')
                log.flush()
                print(f'{len(samples)}/{10 * len(clients)}: {client}: {row["error"] or "ok"}', flush=True)
                if len(samples) < 10 * len(clients):
                    time.sleep(args.delay)
    report = summary(samples, clients)
    output.with_suffix('.txt').write_text(f'Rede: {args.network}\n{report}\n', encoding='utf-8')
    print(report)
    print(f'Registros: {output}')


if __name__ == '__main__':
    main()
