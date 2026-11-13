import contextlib
import importlib.util
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_demo', ROOT / 'scripts/start-local-demo.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class StartupTests(unittest.TestCase):
    def test_repeat_provision_preserves_tokens_env_and_payment_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertEqual(m.provision(root), 3000)
            owner = (root / 'secrets/harness/owner.token').read_text()
            env = (root / '.env').read_text()
            db = root / 'secrets/harness/harness.db'
            db.write_bytes(b'existing-state')
            m.provision(root)
            self.assertEqual(owner, (root / 'secrets/harness/owner.token').read_text())
            self.assertEqual(env, (root / '.env').read_text())
            self.assertEqual(db.read_bytes(), b'existing-state')
            self.assertEqual((root / 'secrets/webui').stat().st_mode & 0o777, 0o700)
            self.assertEqual((root / 'secrets/harness/owner.token').stat().st_mode & 0o777, 0o600)
            self.assertFalse((root / 'secrets/harness/admin.session').exists())

    def test_placeholder_replaced_without_replacing_other_env_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / '.env').write_text('WEBUI_SECRET_KEY=replace-with-random-secret\nWEBUI_PORT=3010\nOTHER=preserved\n')
            self.assertEqual(m.provision(root), 3010)
            text = (root / '.env').read_text()
            self.assertNotIn('replace-with-random-secret', text)
            self.assertIn('OTHER=preserved', text)

    def test_explicit_owner_rotation_preserves_agent_token_and_state(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            m.provision(root)
            owner = (root / 'secrets/harness/owner.token').read_text()
            agent = (root / 'secrets/harness/agent.token').read_text()
            state = root / 'secrets/harness/harness.db'; state.write_bytes(b'preserve')
            m.provision(root, rotate_owner=True)
            self.assertNotEqual(owner, (root / 'secrets/harness/owner.token').read_text())
            self.assertEqual(agent, (root / 'secrets/harness/agent.token').read_text())
            self.assertEqual(state.read_bytes(), b'preserve')

    def test_refuses_symlink_and_readable_cached_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            target = path / 'target'; target.write_text('unchanged'); target.chmod(0o600)
            link = path / 'link'; link.symlink_to(target)
            with self.assertRaises(ValueError):
                m.write_private(link, 'overwrite', replace=True)
            self.assertEqual(target.read_text(), 'unchanged')
            target.chmod(0o644)
            with self.assertRaises(ValueError):
                m.write_private(target, 'overwrite', replace=True)

    def test_model_selection_never_downloads_or_silently_substitutes_requested_model(self):
        tags = {'models': [{'name': 'other'}, {'name': 'qwen3:1.7b-q4_K_M'}]}
        self.assertEqual(m.select_model(tags, None), 'qwen3:1.7b-q4_K_M')
        with self.assertRaises(m.StartError): m.select_model(tags, 'missing')
        with self.assertRaises(m.StartError): m.select_model({'models': []}, None)

    def test_host_override_is_only_webui_and_loopback_bound(self):
        text = m.override_text(3000)
        self.assertIn('network_mode: host', text)
        self.assertIn('HOST: "127.0.0.1"', text)
        self.assertIn('ports: !reset []', text)
        self.assertNotIn('  harness:', text)
        self.assertNotIn('0.0.0.0', text)

    def test_login_cache_reuses_private_session_over_actual_local_http(self):
        session = 'session-' + 'x' * 40
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                calls.append('verify')
                self.send_response(200 if self.headers.get('Authorization') == 'Bearer ' + session else 401)
                self.end_headers(); self.wfile.write(b'{"role":"admin"}')
            def do_POST(self):
                credentials = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                assert credentials == {'email': 'admin@example.invalid', 'password': 'private-password'}
                calls.append('login')
                self.send_response(200); self.end_headers()
                self.wfile.write(json.dumps({'role': 'admin', 'token': session}).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            opener = urllib.request.build_opener(m.setup.NoRedirect(), urllib.request.ProxyHandler({}))
            with tempfile.TemporaryDirectory() as folder:
                cache = Path(folder) / 'admin.session'
                out = io.StringIO()
                with contextlib.redirect_stdout(out), patch.object(m.getpass, 'getpass', side_effect=['admin@example.invalid', 'private-password']):
                    self.assertEqual(m.admin_session(opener, 'http://127.0.0.1:' + str(server.server_port), cache), session)
                self.assertNotIn(session, out.getvalue()); self.assertNotIn('private-password', out.getvalue())
                with patch.object(m.getpass, 'getpass', side_effect=AssertionError('Must reuse session')):
                    self.assertEqual(m.admin_session(opener, 'http://127.0.0.1:' + str(server.server_port), cache), session)
                self.assertEqual(cache.stat().st_mode & 0o777, 0o600)
                self.assertEqual(calls, ['login', 'verify'])
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_ollama_config_preserves_other_connections_and_api_settings(self):
        calls = []
        def request(opener, url, body=None, token=None):
            if body is None:
                return {'ENABLE_OLLAMA_API': True, 'OLLAMA_BASE_URLS': ['http://host.docker.internal:11434', 'https://team.example'], 'OLLAMA_API_CONFIGS': {'1': {'key': 'preserve'}}}
            calls.append(body); return {}
        with patch.object(m, 'request_json', side_effect=request):
            m.configure_ollama(None, 'http://127.0.0.1:3000', 'admin', 'http://127.0.0.1:11434')
        self.assertEqual(calls[0]['OLLAMA_BASE_URLS'], ['http://127.0.0.1:11434', 'https://team.example'])
        self.assertEqual(calls[0]['OLLAMA_API_CONFIGS'], {'1': {'key': 'preserve'}})

    def test_readiness_timeout_does_not_loop_forever(self):
        with patch.object(m, 'request_json', side_effect=urllib.error.URLError('unavailable')):
            with self.assertRaises(m.StartError):
                m.wait_ready(None, 'http://127.0.0.1:8091/health', timeout=2, clock=iter([0, 1, 3]).__next__, pause=lambda _: None)

    def test_orchestrator_stops_before_credentials_or_registration_in_testnet_mode(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(m, 'ROOT', Path(folder)))
            stack.enter_context(patch.object(m.sys, 'argv', ['start-local-demo.py']))
            stack.enter_context(patch.object(m.shutil, 'which', return_value='/docker'))
            stack.enter_context(patch.object(m.subprocess, 'run'))
            stack.enter_context(patch.object(m, 'request_json', return_value={'models': [{'name': 'local'}]}))
            stack.enter_context(patch.object(m, 'wait_ready', side_effect=[{}, {'evidence': 'testnet'}]))
            login = stack.enter_context(patch.object(m, 'admin_session'))
            install = stack.enter_context(patch.object(m.setup, 'install'))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            original = Path.cwd()
            try:
                with self.assertRaises(m.StartError): m.main()
            finally: m.os.chdir(original)
            login.assert_not_called(); install.assert_not_called()

    def test_orchestrator_reuses_images_and_checks_webui_model_discovery(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(m, 'ROOT', Path(folder)))
            stack.enter_context(patch.object(m.sys, 'argv', ['start-local-demo.py', '--skip-warmup']))
            stack.enter_context(patch.object(m.shutil, 'which', return_value='/docker'))
            run = stack.enter_context(patch.object(m.subprocess, 'run'))
            requests = stack.enter_context(patch.object(m, 'request_json', side_effect=[
                {'models': [{'name': 'local'}]}, {'data': [{'id': 'local'}]}]))
            stack.enter_context(patch.object(m, 'wait_ready', side_effect=[{}, {'evidence': 'simulated'}]))
            stack.enter_context(patch.object(m, 'admin_session', return_value='private-session'))
            stack.enter_context(patch.object(m, 'configure_ollama'))
            install = stack.enter_context(patch.object(m.setup, 'install', return_value={'preset': 'fast_settings_updated'}))
            out = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            original = Path.cwd()
            try: m.main()
            finally: m.os.chdir(original)
            up = run.call_args_list[-1].args[0]
            self.assertEqual(up[-2:], ['up', '-d'])
            self.assertNotIn('--build', up); self.assertNotIn('--force-recreate', up)
            self.assertTrue(install.call_args.kwargs['fast'])
            self.assertTrue(requests.call_args.args[1].endswith('/api/models'))
            self.assertNotIn('private-session', out.getvalue())


if __name__ == '__main__': unittest.main()
