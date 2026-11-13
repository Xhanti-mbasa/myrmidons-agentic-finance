import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error

path = Path(__file__).resolve().parents[1] / 'scripts/setup-webui-harness.py'
spec = importlib.util.spec_from_file_location('webui_setup', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SetupTests(unittest.TestCase):
    def test_preserves_unrelated_connections_and_existing_owner_preset(self):
        calls = []

        class Opener:
            def open(self, request, timeout):
                calls.append((request.full_url, json.loads(request.data) if request.data else None))
                if request.full_url.endswith('/tool_servers') and not request.data:
                    return io.BytesIO(json.dumps({'TOOL_SERVER_CONNECTIONS': [{'url': 'https://existing.example', 'info': {'id': 'existing'}}]}).encode())
                return io.BytesIO(b'{}')

        result = module.install('http://127.0.0.1:3000', 'http://harness:8091', 'admin-test-credential', 'a' * 40, 'model', Opener())
        self.assertEqual(result['preset'], 'already_present_preserved')
        updated = calls[1][1]['TOOL_SERVER_CONNECTIONS']
        self.assertEqual(updated[0]['info']['id'], 'existing')
        self.assertEqual(updated[1]['key'], 'a' * 40)
        self.assertEqual(len(calls), 3)

    def test_creates_preset_with_only_agent_tools_on_missing_model(self):
        calls = []

        class Opener:
            def open(self, request, timeout):
                calls.append((request.full_url, json.loads(request.data) if request.data else None))
                if '/models/model?' in request.full_url:
                    raise urllib.error.HTTPError(request.full_url, 404, '', {}, None)
                return io.BytesIO(b'{}')

        result = module.install('http://127.0.0.1:3000', 'http://harness:8091', 'admin-test', 'a' * 40, 'local-model', Opener())
        self.assertEqual(result['preset'], 'created')
        preset = calls[-1][1]
        self.assertEqual(preset['meta']['toolIds'], ['server:shucamoxa'])
        self.assertEqual(preset['base_model_id'], 'local-model')
        self.assertNotIn('a' * 40, json.dumps(preset))

    def test_refuses_repointing_an_existing_connection(self):
        class Opener:
            def open(self, request, timeout):
                return io.BytesIO(b'{"TOOL_SERVER_CONNECTIONS":[{"url":"https://other.example","info":{"id":"shucamoxa"}}]}')
        with self.assertRaises(ValueError):
            module.install('http://127.0.0.1:3000', 'http://harness:8091', 'admin', 'a' * 40, 'model', Opener())

    def test_refuses_plain_http_remote_or_embedded_credentials(self):
        for url in ['http://remote.example', 'https://user:pass@example.com', 'https://example.com?token=secret']:
            with self.assertRaises(ValueError):
                module.validate_url(url)
