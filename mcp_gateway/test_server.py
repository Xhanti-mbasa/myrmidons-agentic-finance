import os
import unittest
from unittest.mock import patch

import httpx
import server


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "SHUCAMOXA_BACKEND_URL": "http://127.0.0.1:8080",
            "SHUCAMOXA_BACKEND_TOKEN": "test-token-not-a-real-credential",
            "SHUCAMOXA_BUSINESS_SCOPE": "test-business",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.requests = []
        self.reply = httpx.Response(200, json={"status": "blocked", "code": "BUDGET_EXCEEDED"})
        original = httpx.AsyncClient

        def handle(request):
            self.requests.append(request)
            if isinstance(self.reply, Exception):
                raise self.reply
            return self.reply

        self.client = patch.object(server.httpx, "AsyncClient",
                                   side_effect=lambda **kw: original(transport=httpx.MockTransport(handle), **kw))
        self.client.start()
        self.addCleanup(self.client.stop)

    async def test_five_discoverable_tools(self):
        tools = await server.mcp.list_tools()
        self.assertEqual({t.name for t in tools}, {
            "get_mandate", "get_balance", "get_invoice", "pay_invoice", "get_payment_status"})
        payment = next(t for t in tools if t.name == "pay_invoice")
        self.assertEqual(set(payment.inputSchema["properties"]), {"invoice_id", "reason"})

    async def test_policy_rejection_and_stable_retry_key(self):
        result = await server.pay_invoice("INV-001", "Due today")
        await server.pay_invoice("INV-001", "Checking the same invoice")
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(self.requests[0].headers["Idempotency-Key"],
                         self.requests[1].headers["Idempotency-Key"])
        self.assertEqual(self.requests[0].url.path, "/v1/invoices/INV-001/payment")
        self.assertEqual(self.requests[0].headers["Authorization"],
                         "Bearer test-token-not-a-real-credential")

    async def test_timeout_is_unknown_and_not_retried(self):
        self.reply = httpx.ReadTimeout("upstream details must not leak")
        result = await server.pay_invoice("INV-002", "Due today")
        self.assertEqual(result["status"], "unknown")
        self.assertNotIn("upstream details", str(result))
        self.assertEqual(len(self.requests), 1)

    async def test_schema_rejects_path_traversal(self):
        with self.assertRaises(Exception):
            await server.mcp.call_tool("get_invoice", {"invoice_id": "../../admin"})
        self.assertEqual(self.requests, [])

    async def test_schema_rejects_blank_reason(self):
        with self.assertRaises(Exception):
            await server.mcp.call_tool("pay_invoice", {"invoice_id": "INV-001", "reason": "  "})
        self.assertEqual(self.requests, [])

    async def test_auth_error_is_sanitized(self):
        self.reply = httpx.Response(403, text="secret upstream stack trace")
        with self.assertRaisesRegex(server.ToolError, "denied access") as caught:
            await server.get_balance()
        self.assertNotIn("secret", str(caught.exception))

    async def test_remote_plain_http_is_refused(self):
        os.environ["SHUCAMOXA_BACKEND_URL"] = "http://example.com:8080"
        with self.assertRaisesRegex(server.ToolError, "HTTPS"):
            await server.get_balance()
        self.assertEqual(self.requests, [])


if __name__ == "__main__":
    unittest.main()
