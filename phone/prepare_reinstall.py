"""Preserva dados do Termux e disponibiliza exportação do perfil no Chrome."""
from pathlib import Path
import os
import signal
import subprocess
import tarfile
import time
from datetime import datetime
from diagnose import supervisor_matches, port_busy


def backup_state(home, destination):
    state = home / '.stormusic'
    if state.is_symlink():
        raise RuntimeError('Pasta de dados personalizada; nenhuma alteração feita.')
    destination.mkdir(parents=True, exist_ok=True)
    name = destination / ('Stormusic-dados-termux-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '.tar.gz')
    def keep(info):
        return None if Path(info.name).name in ('server.pid', 'server.lock') else info
    with name.open('xb') as output:
        with tarfile.open(fileobj=output, mode='w:gz', dereference=False) as archive:
            if state.is_dir():
                archive.add(state, arcname='.stormusic', filter=keep)
    # Read every stored file now, so unreadable/truncated output is not reported as ready.
    with tarfile.open(name, 'r:gz') as archive:
        for entry in archive:
            if entry.isfile():
                stream = archive.extractfile(entry)
                while stream.read(1024 * 1024):
                    pass
    return name


def main():
    home = Path.home().resolve()
    app = home / 'stormusic'
    destination = home / 'storage/downloads'
    if not destination.is_dir():
        raise RuntimeError('Execute termux-setup-storage e permita o acesso aos arquivos primeiro.')
    if any(os.environ.get(key) for key in ('RELAY_STATE_DIR', 'RELAY_APP_DIR', 'RELAY_PORT')):
        raise RuntimeError('Configuração personalizada detectada; preserve-a antes de reinstalar.')
    print('Backups anteriores encontrados (todos serão mantidos):', flush=True)
    for folder in sorted(home.glob('stormusic-r1-*-backup'), key=lambda p: p.stat().st_mtime, reverse=True):
        if folder.is_dir() and not folder.is_symlink():
            print(str(folder), flush=True)
    pid = None
    pid_file = home / '.stormusic/server.pid'
    if pid_file.exists():
        value = pid_file.read_text().strip()
        if not value.isdecimal() or int(value) <= 1:
            raise RuntimeError('PID inválido; nenhum processo encerrado.')
        proc = Path('/proc') / value
        args = proc.joinpath('cmdline').read_bytes().decode().strip('\0').split('\0')
        if not supervisor_matches(args, proc.joinpath('cwd').resolve(strict=True), app):
            raise RuntimeError('Supervisor desconhecido; nenhum processo encerrado.')
        pid = int(value)
    elif port_busy():
        raise RuntimeError('Porta ocupada sem supervisor verificável; nenhuma alteração feita.')
    try:
        if pid is not None:
            os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            if not port_busy() and (pid is None or not pid_file.exists()):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('Servidor não parou; cópia cancelada.')
        saved = backup_state(home, destination)
        print('Backup dos dados e áudios do Termux: ' + str(saved), flush=True)
        page = Path(__file__).resolve().with_name('stormusic-backup.html')
        if not page.is_file():
            page = Path(__file__).resolve().parent.parent / 'dist/offline/stormusic-backup.html'
        if (app / 'dist').is_dir():
            (app / 'dist/offline').mkdir(exist_ok=True)
            (app / 'dist/offline/stormusic-backup.html').write_bytes(page.read_bytes())
        print('Agora abra no Chrome: http://localhost:8787/offline/stormusic-backup.html', flush=True)
        print('Salve o JSON do perfil antes de desinstalar apenas o PWA. Mantenha o Termux instalado.', flush=True)
    finally:
        if (app / 'phone/start.sh').is_file():
            subprocess.run(['bash', str(app / 'phone/start.sh')], check=True, shell=False)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Não foi possível preparar a cópia. Instalação e backups anteriores preservados.')
        raise SystemExit(1)
