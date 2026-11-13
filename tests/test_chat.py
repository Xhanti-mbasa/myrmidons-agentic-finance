import argparse
import asyncio
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from w3node.chat import configuration, endpoint, failure_details, launch, local_tools, turn

HAS_CHAT = importlib.util.find_spec("mcp") is not None and importlib.util.find_spec("httpx") is not None
SOURCE = str(Path(__file__).resolve().parents[1] / "src")


@contextmanager
def config(demo=False):
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "mcp.json"
        path.write_text(json.dumps({"mcpServers": {"sandbox": {
            "command": "{python}", "args": ["-m", "w3node.sandbox_mcp"] + (["--demo-tool"] if demo else []),
            "env": {"PYTHONPATH": SOURCE}}}}))
        yield path


@unittest.skipUnless(HAS_CHAT, "Install .[chat] to test request failures")
class FailureTests(unittest.TestCase):
    def test_nested_groups_reveal_ollama_error(self):
        import httpx
        request = httpx.Request("POST", "http://localhost:11434/api/chat", headers={"Authorization": "secret-test-header"})
        response = httpx.Response(500, request=request, json={"error": "model requires more memory"})
        error = httpx.HTTPStatusError("hidden request details", request=request, response=response)
        nested = ExceptionGroup("SDK wrapper", [ExceptionGroup("inner", [error])])
        self.assertEqual(failure_details(nested), "Ollama HTTP 500: model requires more memory")
        args = argparse.Namespace(host="http://127.0.0.1:11434")
        from unittest.mock import AsyncMock
        with patch("w3node.chat.chat", new=AsyncMock(side_effect=nested)):
            with self.assertRaisesRegex(ValueError, "Ollama HTTP 500: model requires more memory") as caught:
                launch(args)
        self.assertNotIn("secret-test-header", str(caught.exception))

    def test_timeout_connection_and_non_json_errors_are_actionable(self):
        import httpx
        self.assertIn("ReadTimeout", failure_details(ExceptionGroup("SDK", [httpx.ReadTimeout("request private payload")])) )
        self.assertIn("cannot connect", failure_details(httpx.ConnectError("private connection details")))
        request = httpx.Request("POST", "http://localhost:11434/api/chat")
        response = httpx.Response(502, request=request, text="private proxy HTML")
        self.assertEqual(failure_details(httpx.HTTPStatusError("private", request=request, response=response)), "Ollama HTTP 502")


class ConfigurationTests(unittest.TestCase):
    def test_remote_plain_http_and_credentials_refused(self):
        for url in ["http://example.com", "http://user:secret@localhost", "http://localhost/v1"]:
            with self.assertRaises(ValueError): endpoint(url)

    def test_config_never_uses_a_shell_and_expands_only_named_env(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
            path.write_text(json.dumps({"mcpServers": {"local": {
                "command": "{python}", "args": ["-m", "example", "; touch ignored"],
                "env": {"TOKEN": "${W3NODE_TEST_TOKEN}"}}}}))
            with patch.dict(os.environ, {"W3NODE_TEST_TOKEN": "private-test-value"}):
                _, spec = configuration(path)[0]
            self.assertEqual(spec["command"], sys.executable)
            self.assertEqual(spec["args"][-1], "; touch ignored")
            self.assertEqual(spec["env"], {"TOKEN": "private-test-value"})


@unittest.skipUnless(HAS_CHAT, "Install .[chat] to test MCP")
class MCPIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_empty_mcp_handshake_and_no_tools_sent_to_model(self):
        import httpx
        requests = []
        def model(request):
            requests.append(json.loads(request.content))
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "56"}})
        with config() as path:
            async with local_tools(path, emit=lambda _: None) as tools:
                self.assertEqual(tools, {})
                async with httpx.AsyncClient(transport=httpx.MockTransport(model)) as client:
                    async def deny(*_): return False
                    answer = await turn(client, "http://127.0.0.1:11435", "qwen3", [{"role": "user", "content": "7*8"}], tools, deny)
        self.assertEqual(answer, "56")
        self.assertNotIn("tools", requests[0])

    async def test_real_tool_execution_and_result_returned_to_scripted_model(self):
        import httpx
        requests, trace = [], []
        def model(request):
            payload = json.loads(request.content)
            requests.append(payload)
            if len(requests) == 1:
                self.assertEqual(payload["tools"][0]["function"]["name"], "sandbox__echo")
                return httpx.Response(200, json={"message": {"role": "assistant", "content": "", "tool_calls": [
                    {"function": {"name": "sandbox__echo", "arguments": {"text": "connected"}}}]}})
            result = json.loads(payload["messages"][-1]["content"])
            self.assertEqual(json.loads(result["content"][0]["text"])["echo"], "connected")
            self.assertEqual(payload["messages"][-1]["tool_name"], "sandbox__echo")
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "Echo returned connected"}})
        with config(True) as path:
            async with local_tools(path, emit=lambda _: None) as tools:
                async with httpx.AsyncClient(transport=httpx.MockTransport(model)) as client:
                    async def approve(*_): return True
                    answer = await turn(client, "http://127.0.0.1:11435", "qwen3", [{"role": "user", "content": "echo connected"}], tools, approve, emit=trace.append)
        self.assertEqual(answer, "Echo returned connected")
        self.assertTrue(any("[tool result]" in line for line in trace))
        self.assertEqual(len(requests), 2)

    async def test_declined_unknown_and_repeated_calls_never_execute(self):
        import httpx
        from unittest.mock import AsyncMock
        session = argparse.Namespace(call_tool=AsyncMock())
        tools = {"demo__echo": {"schema": {}, "original": "echo", "session": session}}
        attempts = []
        def model(request):
            attempts.append(json.loads(request.content))
            if len(attempts) < 3:
                return httpx.Response(200, json={"message": {"role": "assistant", "tool_calls": [
                    {"function": {"name": "demo__echo", "arguments": {"text": "x"}}},
                    {"function": {"name": "invented", "arguments": {}}}]}})
            return httpx.Response(200, json={"message": {"role": "assistant", "content": "No tools ran"}})
        async def deny(*_): return False
        async with httpx.AsyncClient(transport=httpx.MockTransport(model)) as client:
            await turn(client, "http://127.0.0.1:11435", "qwen3", [], tools, deny)
        session.call_tool.assert_not_called()
        self.assertIn("Duplicate call blocked", json.dumps(attempts[-1]))


@unittest.skipUnless(HAS_CHAT, "Install .[chat] to test terminal chat")
class TerminalTests(unittest.TestCase):
    def test_full_cli_with_real_mcp_subprocess_and_local_scripted_ollama(self):
        payloads = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                payloads.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                body = json.dumps({"message": {"role": "assistant", "content": "Terminal test passed"}}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server, config() as path:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                result = subprocess.run([sys.executable, "-m", "w3node.cli", "chat", "--mcp", str(path),
                    "--host", f"http://127.0.0.1:{server.server_port}", "--prompt", "hello"],
                    env={**os.environ, "PYTHONPATH": SOURCE}, text=True, capture_output=True, timeout=45)
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("initialized; 0 tool(s)", result.stdout)
        self.assertIn("ai> Terminal test passed", result.stdout)
        self.assertNotIn("tools", payloads[0])


@unittest.skipUnless(HAS_CHAT, "Install .[chat] to test model build")
class ModelBuildTests(unittest.TestCase):
    def test_profile_build_and_gguf_blob_reuse(self):
        import httpx
        from w3node.model_build import build_model
        real_client = httpx.Client
        for cached in [False, True]:
            calls = []
            def handler(request):
                calls.append(request)
                if request.method == "HEAD": return httpx.Response(200 if cached else 404)
                if "/api/blobs/" in str(request.url): return httpx.Response(201)
                payload = json.loads(request.content)
                self.assertEqual(payload["model"], "w3node-test")
                self.assertNotIn("from", payload)
                self.assertTrue(payload["files"]["model.gguf"].startswith("sha256:"))
                return httpx.Response(200, json={"status": "success"})
            with tempfile.TemporaryDirectory() as folder:
                profile, gguf = Path(folder) / "profile.json", Path(folder) / "model.gguf"
                profile.write_text(json.dumps({"from": "qwen3", "system": "Test profile"}))
                gguf.write_bytes(b"GGUFtest-bytes-not-a-real-checkpoint")
                args = argparse.Namespace(name="w3node-test", profile=profile, gguf=gguf, host="http://127.0.0.1:11435")
                with patch.object(httpx, "Client", side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)):
                    build_model(args)
            uploads = [call for call in calls if call.method == "POST" and "/api/blobs/" in str(call.url)]
            self.assertEqual(len(uploads), 0 if cached else 1)

    def test_named_profile_changes_preserved_without_weight_upload(self):
        import httpx
        from w3node.model_build import build_model
        real_client = httpx.Client
        requests = []
        def handler(request):
            requests.append(request)
            self.assertEqual(json.loads(request.content)["system"], "Reply with the word W3Node")
            return httpx.Response(200, json={"status": "success"})
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "profile.json"
            path.write_text(json.dumps({"from": "qwen3", "system": "Reply with the word W3Node"}))
            args = argparse.Namespace(name="w3node-profile", profile=path, gguf=None, host="http://127.0.0.1:11435")
            with patch.object(httpx, "Client", side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw)):
                build_model(args)
        self.assertEqual(len(requests), 1)


if __name__ == "__main__":
    unittest.main()

