"""Protocol test with a fake yt_dlp; never connects to YouTube."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class WorkerTests(unittest.TestCase):
    def test_resident_instance_runtime_and_private_errors(self):
        with tempfile.TemporaryDirectory(prefix='stormusic-worker-') as directory:
            Path(directory, 'yt_dlp.py').write_text('''
class YoutubeDL:
    def __init__(self, options):
        assert options['js_runtimes']['node']['path'] == 'node-fixture'
        assert options['skip_download'] is True
        self.calls = 0
    def extract_info(self, url, download=False):
        self.calls += 1
        print('PRIVATE diagnostic must not escape')
        if url.endswith('blocked0000'):
            raise RuntimeError('403 PRIVATE diagnostic')
        return dict(url='https://fixture.invalid/audio', duration=self.calls, ext='m4a', abr=128)
''', encoding='utf-8')
            messages = [{'id': i, 'video': video} for i, video in enumerate(
                ['abcdefghijk', '12345678901', 'blocked0000'])]
            result = subprocess.run([sys.executable, str(Path(__file__).with_name('ytdlp_worker.py'))],
                                    input=''.join(json.dumps(m) + '\n' for m in messages),
                                    text=True, capture_output=True, timeout=10, check=True,
                                    env=dict(os.environ, PYTHONPATH=directory, STORMUSIC_NODE='node-fixture'))
            rows = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual([row['id'] for row in rows], [0, 1, 2])
            self.assertEqual(rows[0]['result']['duration'], 1)
            self.assertEqual(rows[1]['result']['duration'], 2)
            self.assertEqual(rows[2]['error'], 'source_blocked')
            self.assertNotIn('PRIVATE', result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
