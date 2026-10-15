"""Bounded JSON-lines protocol; stdout contains protocol only, never diagnostics."""
import contextlib
import json
import os
import re
import sys
import yt_dlp


class Quiet:
    def debug(self, *_): pass
    def warning(self, *_): pass
    def error(self, *_): pass


output = sys.stdout
with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
    ydl = yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'logger': Quiet(),
                          'skip_download': True, 'noplaylist': True,
                          'format': 'bestaudio[ext=m4a]', 'js_runtimes': {'node': {'path': os.environ.get('STORMUSIC_NODE')}},
                          'socket_timeout': 15})
    for line in sys.stdin:
        request_id = None
        try:
            if len(line) > 512:
                raise ValueError('invalid_input')
            request = json.loads(line)
            request_id = request.get('id')
            video = request.get('video', '')
            if not isinstance(request_id, int) or not isinstance(video, str) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
                raise ValueError('invalid_input')
            info = ydl.extract_info('https://www.youtube.com/watch?v=' + video, download=False)
            if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
                raise ValueError('live_not_supported')
            result = {'id': request_id, 'result': {k: info.get(k) for k in
                      ('url', 'duration', 'ext', 'abr', 'http_headers', 'format_id')}}
        except Exception as error:
            raw = str(error).lower()
            code = ('source_blocked' if re.search(r'403|429|not a bot|po token', raw) else
                    'live_not_supported' if 'live_not_supported' in raw else 'extractor_outdated')
            result = {'id': request_id, 'error': code}
        output.write(json.dumps(result) + '\n')
        output.flush()
