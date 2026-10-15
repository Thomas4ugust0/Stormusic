import subprocess
import unittest
from types import SimpleNamespace
from bench import measure, summary


class BenchmarkTests(unittest.TestCase):
    def test_arguments_and_success_clock(self):
        def runner(args, **options):
            self.assertFalse(options['shell'])
            self.assertEqual(options['timeout'], 45)
            self.assertIn('youtube:player_client=ios', args)
            self.assertEqual(args[-2], '--')
            return SimpleNamespace(returncode=0, stdout='{"url":"secret-signed-url"}')
        ticks = iter([1, 1.125])
        result = measure('9bZkp7q19f0', 'ios', runner, lambda: next(ticks))
        self.assertEqual(result['resolve_ms'], 125)
        self.assertIsNone(result['error'])
        self.assertNotIn('secret', str(result))

    def test_failures_are_excluded_from_median(self):
        rows = [dict(client='ios', resolve_ms=10, error=None),
                dict(client='ios', resolve_ms=30, error=None),
                dict(client='ios', resolve_ms=45000, error='extract_timeout')]
        self.assertIn('ios | 2/3 | 20.0', summary(rows, ['ios']))
        def timeout(*args, **kwargs):
            raise subprocess.TimeoutExpired('sensitive command', 45)
        result = measure('9bZkp7q19f0', 'ios', timeout)
        self.assertEqual(result['error'], 'extract_timeout')
        self.assertNotIn('sensitive', str(result))


if __name__ == '__main__':
    unittest.main()
