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

    async def test_projection_keeps_mandate_controls_but_removes_private_fields(self):
        canary = "ab" * 32
        self.reply = httpx.Response(200, json={"enabled": True, "total_budget": "200.00",
            "suppliers": [{"supplier_id": "sup_karoo", "name": "Karoo", "address": "private", "secret": canary}],
            "note": canary, "private_key": canary})
        result = await server.get_mandate()
        self.assertEqual(result, {"enabled": True, "total_budget": "200.00",
            "suppliers": [{"supplier_id": "sup_karoo", "name": "Karoo"}]})
        self.assertNotIn(canary, str(result))

    async def test_known_fields_redact_key_and_address_text_before_truncation(self):
        canary = "ab" * 32
        self.reply = httpx.Response(200, json={"invoice_id": "INV-001", "supplier_name": "x" * 480 + canary})
        result = await server.get_invoice("INV-001")
        self.assertNotIn(canary[:20], str(result))
        self.reply = httpx.Response(200, json={"invoice_id": "INV-001", "supplier_name": "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv"})
        self.assertNotIn("rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv", str(await server.get_invoice("INV-001")))

    async def test_oversized_payment_response_is_unknown_and_not_retried(self):
        self.reply = httpx.Response(200, content=b"x" * (server.MAX_RESPONSE_BYTES + 1))
        result = await server.pay_invoice("INV-001", "Due")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(len(self.requests), 1)

    async def test_seven_discoverable_tools(self):
        tools = await server.mcp.list_tools()
        self.assertEqual({t.name for t in tools}, {
            "get_mandate", "get_balance", "get_invoice", "pay_invoice", "get_payment_status",
            "pay", "get_transfer_status"})
        payment = next(t for t in tools if t.name == "pay_invoice")
        self.assertEqual(set(payment.inputSchema["properties"]), {"invoice_id", "reason"})

    async def test_pay_only_forwards_stored_intent_id(self):
        intent_id = "ad2ae810-0787-49f2-a458-1c57bff0fb11"
        self.reply = httpx.Response(200, json={"intentId": intent_id, "status": "submitted", "code": "OK"})
        result = await server.pay(intent_id)
        self.assertEqual(result["status"], "submitted")
        self.assertEqual(self.requests[0].url.path, "/transfers/pay")
        self.assertEqual(self.requests[0].content, b'{"intentId":"ad2ae810-0787-49f2-a458-1c57bff0fb11"}')

    async def test_transfer_timeout_is_unknown_without_retry(self):
        self.reply = httpx.ReadTimeout("private upstream detail")
        result = await server.pay("ad2ae810-0787-49f2-a458-1c57bff0fb11")
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["code"], "EXECUTION_UNKNOWN")
        self.assertEqual(len(self.requests), 1)

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
