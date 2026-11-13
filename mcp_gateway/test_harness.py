import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class HarnessMCPTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_discovery_and_strict_forwarding(self):
        seen = []
        schema = {'type': 'object', 'additionalProperties': False, 'properties': {'intentId': {'type': 'string', 'format': 'uuid'}}, 'required': ['intentId']}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_GET(self):
                body = {'paths': {'/tools/pay': {'post': {'operationId': 'pay', 'summary': 'Bounded test payment',
                    'requestBody': {'content': {'application/json': {'schema': schema}}}}},
                    '/owner/policy': {'post': {'operationId': 'edit_policy'}}}}
                self.reply(body)

            def do_POST(self):
                seen.append((self.path, json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.reply({'evidence': 'simulated', 'status': 'blocked'})

            def reply(self, body):
                data = json.dumps(body).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        with tempfile.TemporaryDirectory() as directory, ThreadingHTTPServer(('127.0.0.1', 0), Handler) as http:
            path = Path(directory) / 'agent.token'
            path.write_text('a' * 40)
            path.chmod(0o600)
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                params = StdioServerParameters(command=sys.executable, args=[str(Path(__file__).with_name('harness.py'))],
                    env={**os.environ, 'SHUCAMOXA_HARNESS_URL': f'http://127.0.0.1:{http.server_port}',
                         'SHUCAMOXA_HARNESS_AGENT_TOKEN_FILE': str(path)})
                async with stdio_client(params) as (reader, writer):
                    async with ClientSession(reader, writer) as session:
                        await session.initialize()
                        self.assertEqual([t.name for t in (await session.list_tools()).tools], ['pay'])
                        intent = '11111111-1111-4111-8111-111111111111'
                        self.assertTrue((await session.call_tool('pay', {'intentId': intent, 'override': True})).isError)
                        self.assertEqual(seen, [])
                        response = await session.call_tool('pay', {'intentId': intent})
                        self.assertFalse(response.isError)
                        self.assertEqual(seen, [('/tools/pay', {'intentId': intent})])
                        self.assertIn('simulated', response.content[0].text)
            finally:
                http.shutdown()
                thread.join()
