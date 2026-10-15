"""Executa a distribuição de diagnóstico sem substituir a instalação existente."""
import os
import sys
import argparse
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time


def supervisor_matches(arguments, cwd, app):
    return (cwd == app and '--supervise' in arguments
            and any(Path(arg).name == 'bash' for arg in arguments[:1])
            and any((cwd / arg).resolve() == app / 'phone/start.sh'
                    for arg in arguments[1:] if not arg.startswith('-')))


def port_busy():
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(('127.0.0.1', 8787)) == 0


def activate(app, target):
    backup = target.with_name(target.name + '-backup')
    if backup.exists():
        raise RuntimeError('Pasta de backup já existe; instalação não substituída.')
    app.rename(backup)
    try:
        target.rename(app)
    except OSError:
        backup.rename(app)
        raise
    return backup


def main(install=False):
    app = (Path.home() / 'stormusic').resolve()
    state = Path.home() / '.stormusic'
    bundle = Path(__file__).resolve().with_name('stormusic.bundle')
    if not bundle.is_file() or not (app / 'phone/start.sh').is_file():
        raise RuntimeError('Pacote ou instalação original ausente; nenhuma alteração feita.')
    if any(os.environ.get(key) for key in ('RELAY_STATE_DIR', 'RELAY_APP_DIR', 'RELAY_PORT')):
        raise RuntimeError('Configuração personalizada detectada; envie esse aviso para adaptar a coleta.')
    pid = None
    pid_file = state / 'server.pid'
    if pid_file.exists():
        value = pid_file.read_text().strip()
        if not value.isdecimal() or int(value) <= 1:
            raise RuntimeError('PID inválido; nenhum processo encerrado.')
        candidate = int(value)
        proc = Path('/proc') / value
        try:
            args = proc.joinpath('cmdline').read_bytes().decode().strip('\0').split('\0')
            cwd = proc.joinpath('cwd').resolve(strict=True)
        except (OSError, UnicodeError):
            raise RuntimeError('Não foi possível verificar o supervisor; nenhum processo encerrado.')
        if not supervisor_matches(args, cwd, app):
            raise RuntimeError('Supervisor não corresponde à instalação; nenhum processo encerrado.')
        pid = candidate
    elif port_busy():
        raise RuntimeError('Porta 8787 ocupada sem supervisor verificável; nenhum processo encerrado.')

    target = Path(tempfile.mkdtemp(prefix='stormusic-r1-', dir=Path.home()))
    result = subprocess.run(['git', 'clone', '--quiet', '-b', 'phone-dist', str(bundle), str(target)],
                            capture_output=True, timeout=120, shell=False)
    if result.returncode or not (target / 'server/metrics.ts').is_file():
        raise RuntimeError('Falha ao preparar distribuição; instalação original preservada.')
    if install:
        runtime = subprocess.run([sys.executable, '-c', 'import yt_dlp'], capture_output=True, timeout=15, shell=False)
        if runtime.returncode:
            raise RuntimeError('yt-dlp ausente no Python. No Termux, execute pip install -U yt-dlp yt-dlp-ejs e repita. Instalação anterior preservada.')
        for relative in ('dist/index.html', 'phone/start.sh', 'server/standalone.ts'):
            if not (target / relative).is_file():
                raise RuntimeError('Distribuição incompleta; instalação original preservada.')
        result = subprocess.run(['node', '--check', 'server/standalone.ts'], cwd=target,
                                capture_output=True, timeout=30, shell=False)
        if result.returncode:
            raise RuntimeError('Node incompatível com a distribuição; instalação original preservada.')
        subprocess.run(['git', '-C', str(target), 'remote', 'set-url', 'origin',
                        'https://github.com/Thomas4ugust0/Stormusic.git'],
                       capture_output=True, timeout=30, check=True, shell=False)
    print('Cópia de diagnóstico preparada; instalação original preservada.', flush=True)
    stopped = False
    installed = False
    try:
        if pid is not None:
            os.kill(pid, signal.SIGTERM)
            stopped = True
        for _ in range(50):
            if not port_busy() and (not stopped or not pid_file.exists()):
                break
            time.sleep(0.2)
        else:
            raise RuntimeError('Servidor anterior não liberou a porta; coleta não iniciada.')
        if install:
            backup = activate(app, target)
            installed = True
            print('Atualização instalada. Backup completo da pasta anterior: ' + str(backup), flush=True)
            print('Abra http://localhost:8787 e recarregue. Nenhum benchmark é necessário.', flush=True)
            return
        environment = dict(os.environ, RELAY_AUTO_UPDATE_DAYS='0', RELAY_HOST='127.0.0.1')
        print('Abra http://localhost:8787 no Chrome e recarregue a página.', flush=True)
        print('Baixe um mix com pelo menos dez faixas novas. Não feche esta sessão.', flush=True)
        print('Ao terminar, volte aqui e pressione Ctrl+C para restaurar o servidor original.', flush=True)
        try:
            subprocess.run(['node', 'server/standalone.ts'], cwd=target, env=environment, check=True, shell=False)
        except KeyboardInterrupt:
            print('\nColeta encerrada.', flush=True)
    finally:
        if stopped or installed:
            subprocess.run(['bash', str(app / 'phone/start.sh')], check=True, shell=False)
            print('Inicialização do servidor atualizado solicitada.' if installed else 'Inicialização do servidor original solicitada.', flush=True)
        print('Métricas: ~/.stormusic/metrics.jsonl. Nenhum dado do navegador foi apagado.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Instala permanentemente, preservando a pasta anterior como backup.')
    options = parser.parse_args()
    try:
        main(install=options.install)
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, RuntimeError):
            print(str(error))
        else:
            print('Falha ao executar coleta; envie esta mensagem e a etapa em que ocorreu.')
        raise SystemExit(1)
