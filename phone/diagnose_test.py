import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from diagnose import activate, supervisor_matches


class InstallationTests(unittest.TestCase):
    def test_supervisor_identity(self):
        app = Path(tempfile.gettempdir()).resolve() / 'stormusic'
        valid = ['bash', str(app / 'phone/start.sh'), '--supervise']
        self.assertTrue(supervisor_matches(valid, app, app))
        self.assertFalse(supervisor_matches(['node', *valid[1:]], app, app))
        self.assertFalse(supervisor_matches(valid[:-1], app, app))
        self.assertFalse(supervisor_matches(['bash', 'other.sh', '--supervise'], app, app))
        self.assertFalse(supervisor_matches(valid, app.parent, app))

    def test_activation_preserves_old_files(self):
        with tempfile.TemporaryDirectory() as root:
            app, target = Path(root) / 'stormusic', Path(root) / 'new'
            app.mkdir(); target.mkdir()
            (app / 'original.txt').write_text('original')
            (target / 'new.txt').write_text('updated')
            backup = activate(app, target)
            self.assertEqual((backup / 'original.txt').read_text(), 'original')
            self.assertEqual((app / 'new.txt').read_text(), 'updated')

    def test_failed_activation_restores_original(self):
        with tempfile.TemporaryDirectory() as root:
            app, target = Path(root) / 'stormusic', Path(root) / 'new'
            app.mkdir(); target.mkdir()
            (app / 'original.txt').write_text('original')
            original_rename = Path.rename
            def rename(path, destination):
                if path == target:
                    raise OSError('simulated activation failure')
                return original_rename(path, destination)
            with patch.object(Path, 'rename', rename):
                with self.assertRaises(OSError):
                    activate(app, target)
            self.assertEqual((app / 'original.txt').read_text(), 'original')
            self.assertTrue(target.is_dir())

    def test_existing_backup_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            app, target = Path(root) / 'stormusic', Path(root) / 'new'
            app.mkdir(); target.mkdir(); (Path(root) / 'new-backup').mkdir()
            with self.assertRaises(RuntimeError):
                activate(app, target)
            self.assertTrue(app.is_dir()); self.assertTrue(target.is_dir())


if __name__ == '__main__':
    unittest.main()
