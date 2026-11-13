import argparse
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from w3node.cli import main
from w3node.model_setup import setup_model


@unittest.skipUnless(importlib.util.find_spec("httpx"), "Install .[chat]")
class SetupTests(unittest.TestCase):
    def exercise(self, installed=None, pulled=None, events=None):
        import httpx
        real_client = httpx.Client
        requests = []
        expected = "a" * 64
        def handler(request):
            requests.append(request)
            if request.method == "GET":
                digest = installed if len(requests) == 1 else pulled
                return httpx.Response(200, json={"models": [] if digest is None else [
                    {"name": "qwen3:test", "digest": digest}]})
            self.assertEqual(json.loads(request.content), {"model": "qwen3:test", "stream": True})
            return httpx.Response(200, text="\n".join(json.dumps(x) for x in (
                events if events is not None else [{"status": "pulling", "total": 100, "completed": 50}, {"status": "success"}])))
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "lock.json"
            path.write_text(json.dumps({"schema_version": 1, "model": "qwen3:test", "manifest_digest": expected}))
            original = path.read_bytes()
            args = argparse.Namespace(lock=path, host="http://127.0.0.1:11434")
            with patch.object(httpx, "Client", side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)):
                with redirect_stdout(io.StringIO()):
                    try:
                        setup_model(args)
                    finally:
                        self.assertEqual(path.read_bytes(), original)
        return requests

    def test_verified_cache_never_downloads(self):
        self.assertEqual(len(self.exercise(installed="sha256:" + "a" * 64)), 1)

    def test_missing_model_pulls_then_checks_manifest(self):
        requests = self.exercise(pulled="a" * 64)
        self.assertEqual([r.method for r in requests], ["GET", "POST", "GET"])

    def test_mismatched_installed_or_pulled_model_fails(self):
        for args in [{"installed": "b" * 64}, {"pulled": "b" * 64}]:
            with self.subTest(args=args), self.assertRaisesRegex(ValueError, "digest mismatch"):
                self.exercise(**args)

    def test_failed_or_incomplete_pull_never_reports_verified(self):
        for events in [[{"error": "failed"}], [{"status": "pulling"}]]:
            with self.subTest(events=events), self.assertRaises(ValueError):
                self.exercise(events=events)


class EndpointDefaultsTests(unittest.TestCase):
    def test_local_default_env_override_and_explicit_server(self):
        cases = [(None, [], "http://127.0.0.1:11434"),
                 ("http://127.0.0.1:12345", [], "http://127.0.0.1:12345"),
                 ("http://127.0.0.1:12345", ["--host", "http://127.0.0.1:11435"], "http://127.0.0.1:11435")]
        for command, target in [(["chat"], "w3node.chat.launch"),
                                (["model", "build", "w3node-test"], "w3node.model_build.build_model"),
                                (["model", "setup"], "w3node.model_setup.setup_model")]:
            for env, flags, expected in cases:
                with self.subTest(command=command, env=env, flags=flags), patch.dict(os.environ, {}, clear=True):
                    if env:
                        os.environ["OLLAMA_HOST"] = env
                    with patch.object(sys, "argv", ["w3node", *command, *flags]), patch(target) as run:
                        self.assertEqual(main(), 0)
                        self.assertEqual(run.call_args.args[0].host, expected)
