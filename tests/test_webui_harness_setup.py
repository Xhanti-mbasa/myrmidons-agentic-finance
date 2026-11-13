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
                if '/models/model?' in request.full_url:
                    return io.BytesIO(json.dumps({'id': 'shucamoxa-finance', 'name': 'Owner title', 'params': {'system': 'Owner text'}, 'meta': {'description': 'Owner description', 'toolIds': ['unrelated-tool'], 'capabilities': {'builtin_tools': True}}}).encode())
                return io.BytesIO(b'{}')

        result = module.install('http://127.0.0.1:3000', 'http://harness:8091', 'admin-test-credential', 'a' * 40, 'model', Opener())
        self.assertEqual(result['preset'], 'tool_scope_updated')
        updated = calls[1][1]['TOOL_SERVER_CONNECTIONS']
        self.assertEqual(updated[0]['info']['id'], 'existing')
        self.assertEqual(updated[1]['key'], 'a' * 40)
        self.assertEqual(len(calls), 4)
        preset = calls[-1][1]
        self.assertEqual(preset['params']['system'], 'Owner text')
        self.assertEqual(preset['meta']['description'], 'Owner description')
        self.assertEqual(preset['meta']['toolIds'], ['server:shucamoxa'])
        self.assertFalse(preset['meta']['capabilities']['builtin_tools'])
        self.assertNotIn('max_tokens', preset['params'])

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
        self.assertFalse(preset['meta']['capabilities']['builtin_tools'])
        self.assertFalse(preset['meta']['capabilities']['terminal'])
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

class FastSetupTests(unittest.TestCase):
    def test_fast_update_preserves_prompt_tools_and_unrelated_params(self):
        calls = []
        class Opener:
            def open(self, request, timeout):
                calls.append((request.full_url, json.loads(request.data) if request.data else None))
                if '/models/model?' in request.full_url:
                    return io.BytesIO(json.dumps({'id': 'shucamoxa-finance', 'name': 'Owner title', 'base_model_id': 'old',
                        'params': {'system': 'Owner prompt', 'top_k': 17}, 'meta': {'toolIds': ['server:shucamoxa']}}).encode())
                return io.BytesIO(b'{}')
        result = module.install('http://127.0.0.1:3000', 'http://127.0.0.1:8091', 'admin', 'a' * 40, 'model', Opener(), fast=True)
        updated = calls[-1][1]
        self.assertEqual(result['preset'], 'fast_settings_updated')
        self.assertEqual(updated['params']['system'], 'Owner prompt')
        self.assertEqual(updated['params']['top_k'], 17)
        self.assertEqual(updated['meta']['toolIds'], ['server:shucamoxa'])
        self.assertFalse(updated['params']['think'])
        self.assertEqual(updated['params']['max_tokens'], 512)
        self.assertNotIn('a' * 40, json.dumps(updated))

    def test_local_network_migration_verifies_agent_before_replacing_connection(self):
        calls = []
        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                if request.full_url.endswith('/tool_servers') and request.data is None:
                    return io.BytesIO(b'{"TOOL_SERVER_CONNECTIONS":[{"url":"http://harness:8091","info":{"id":"shucamoxa"}}]}')
                if request.full_url.endswith('/get_capabilities'):
                    self_auth = request.get_header('Authorization')
                    if self_auth != 'Bearer ' + 'a' * 40: raise AssertionError('Agent credential required')
                    return io.BytesIO(b'{"evidence":"simulated"}')
                if '/models/model?' in request.full_url:
                    return io.BytesIO(b'{"id":"shucamoxa-finance","name":"Finance","params":{},"meta":{}}')
                return io.BytesIO(b'{}')
        module.install('http://127.0.0.1:3000', 'http://127.0.0.1:8091', 'admin', 'a' * 40, 'model', Opener(), allow_local_migration=True)
        self.assertTrue(calls[1].full_url.endswith('/get_capabilities'))
        self.assertTrue(calls[2].full_url.endswith('/tool_servers'))

    def test_migration_flag_still_refuses_remote_repointing(self):
        class Opener:
            def open(self, request, timeout):
                return io.BytesIO(b'{"TOOL_SERVER_CONNECTIONS":[{"url":"https://other.example","info":{"id":"shucamoxa"}}]}')
        with self.assertRaises(ValueError):
            module.install('http://127.0.0.1:3000', 'http://127.0.0.1:8091', 'admin', 'a' * 40, 'model', Opener(), allow_local_migration=True)

class FinanceScopeTests(unittest.TestCase):
    def test_existing_hardened_preset_is_idempotent_without_fast_update(self):
        calls = []
        class Opener:
            def open(self, request, timeout):
                calls.append(request)
                if '/models/model?' in request.full_url:
                    return io.BytesIO(json.dumps({'id': 'shucamoxa-finance', 'meta': module.finance_meta({})}).encode())
                return io.BytesIO(b'{}')
        result = module.install('http://127.0.0.1:3000', 'http://127.0.0.1:8091', 'admin', 'a' * 40, 'model', Opener())
        self.assertEqual(result['preset'], 'already_present_preserved')
        self.assertEqual(len(calls), 3)

    def test_scope_restriction_is_not_a_prompt_or_fast_setting(self):
        meta = module.finance_meta({'toolIds': ['tasks', 'automation', 'server:shucamoxa'],
                                   'capabilities': {'builtin_tools': True, 'citations': True}})
        self.assertEqual(meta['toolIds'], ['server:shucamoxa'])
        self.assertFalse(meta['capabilities']['builtin_tools'])
        self.assertTrue(meta['capabilities']['citations'])
        self.assertNotIn('system', meta)
