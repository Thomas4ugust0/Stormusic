import tempfile
import tarfile
import unittest
from pathlib import Path
from prepare_reinstall import backup_state


class ReinstallBackupTests(unittest.TestCase):
    def test_state_audio_and_old_backups_are_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / '.stormusic'
            (state / 'audio').mkdir(parents=True)
            (state / 'audio/test.m4a').write_bytes(b'audio-file')
            (state / 'library.json').write_text('{"version":1,"tracks":[]}')
            (state / 'server.pid').write_text('123')
            (root / 'stormusic-r1-one-backup').mkdir()
            (root / 'stormusic-r1-two-backup').mkdir()
            destination = root / 'downloads'
            saved = backup_state(root, destination)
            with tarfile.open(saved) as archive:
                self.assertEqual(archive.extractfile('.stormusic/audio/test.m4a').read(), b'audio-file')
                self.assertIn('.stormusic/library.json', archive.getnames())
                self.assertNotIn('.stormusic/server.pid', archive.getnames())
            self.assertEqual((state / 'audio/test.m4a').read_bytes(), b'audio-file')
            self.assertTrue((root / 'stormusic-r1-one-backup').is_dir())
            self.assertTrue((root / 'stormusic-r1-two-backup').is_dir())
            second = backup_state(root, destination)
            self.assertNotEqual(saved, second)
            self.assertTrue(saved.is_file())

    def test_absent_state_does_not_invent_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with tarfile.open(backup_state(root, root / 'downloads')) as archive:
                self.assertEqual(archive.getnames(), [])


if __name__ == '__main__':
    unittest.main()
