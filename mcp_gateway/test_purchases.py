import json
import os
from pathlib import Path
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class PurchaseToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_mcp_rejects_urls_and_policy_overrides_before_http(self):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                seen.append((self.path, data))
                body = json.dumps({"status": "blocked"}).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as http:
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                params = StdioServerParameters(command=sys.executable, args=[str(Path(__file__).with_name("purchases.py"))],
                    env={**os.environ, "SHUCAMOXA_BACKEND_URL": f"http://127.0.0.1:{http.server_port}",
                         "SHUCAMOXA_BACKEND_TOKEN": "test-agent-placeholder-only", "SHUCAMOXA_BUSINESS_SCOPE": "business"})
                async with stdio_client(params) as (reader, writer):
                    async with ClientSession(reader, writer) as session:
                        await session.initialize()
                        self.assertEqual({t.name for t in (await session.list_tools()).tools},
                                         {"purchase_resource", "reconcile_purchase", "read_purchased_resource"})
                        for args in [{"resource_id": "article", "amount": "100"}, {"resource_id": "https://evil.example"},
                                     {"resource_id": "article", "ownerId": "admin"}]:
                            self.assertTrue((await session.call_tool("purchase_resource", args)).isError)
                        self.assertEqual(seen, [])
                        result = await session.call_tool("purchase_resource", {"resource_id": "article"})
                        self.assertFalse(result.isError)
                        self.assertEqual(seen, [("/purchases", {"resourceId": "article", "decision": "automatic"})])
            finally:
                http.shutdown()
                thread.join()
