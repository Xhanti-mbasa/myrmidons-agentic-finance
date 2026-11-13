import json
import os
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class StrictTransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_mcp_rejects_extra_fields_and_only_forwards_intent(self):
        requests = []
        intent_id = "ad2ae810-0787-49f2-a458-1c57bff0fb11"
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"])) ))
                body = json.dumps({"intentId": intent_id, "status": "blocked", "code": "POLICY_DENIED"}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as http:
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                params = StdioServerParameters(command=sys.executable,
                    args=[str(Path(__file__).with_name("transfers.py"))],
                    env={**os.environ, "SHUCAMOXA_BACKEND_URL": f"http://127.0.0.1:{http.server_port}",
                         "SHUCAMOXA_BACKEND_TOKEN": "test-placeholder-only", "SHUCAMOXA_BUSINESS_SCOPE": "test"})
                async with stdio_client(params) as (reader, writer):
                    async with ClientSession(reader, writer) as session:
                        await session.initialize()
                        self.assertEqual({t.name for t in (await session.list_tools()).tools}, {"pay", "get_transfer_status"})
                        for args in [{"intent_id": intent_id, "amount": "1000"}, {"intent_id": intent_id + "\u200b"}]:
                            self.assertTrue((await session.call_tool("pay", args)).isError)
                        self.assertEqual(requests, [])
                        result = await session.call_tool("pay", {"intent_id": intent_id})
                        self.assertFalse(result.isError)
                        self.assertEqual(json.loads(result.content[0].text)["code"], "POLICY_DENIED")
                        self.assertEqual(requests, [{"intentId": intent_id}])
            finally:
                http.shutdown()
                thread.join()
