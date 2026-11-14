"""MCP transport for the same guarded OpenAPI tool host. No owner methods exposed."""
import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse
import httpx
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

app = Server('Shucamoxa governed harness')
ALLOWED = frozenset({'get_capabilities', 'get_policy', 'policy_check', 'compliance_check', 'pay',
                     'get_transfer_status', 'purchase_resource', 'reconcile_purchase',
                     'read_purchased_resource', 'get_audit_log', 'run_flow', 'bridge_quote',
                     'get_instructions', 'list_payees', 'propose_payee', 'propose_payment',
                     'propose_mandate', 'pay_payee', 'list_proposals', 'check_recipient',
                     'get_balance', 'payment_history', 'list_scheduled'})


def settings():
    url = os.environ.get('SHUCAMOXA_HARNESS_URL', 'http://127.0.0.1:8091').rstrip('/')
    parsed = urlparse(url)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path or not (
        parsed.scheme == 'https' or parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1'}
    ):
        raise ValueError('Private loopback or authenticated HTTPS origin required')
    path = Path(os.environ['SHUCAMOXA_HARNESS_AGENT_TOKEN_FILE'])
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private regular agent credential file required')
    token = path.read_text().strip()
    if len(token) < 32:
        raise ValueError('Agent credential too short')
    return url, token


async def request(path, body=None):
    url, token = settings()
    async with httpx.AsyncClient(timeout=35, follow_redirects=False, trust_env=False) as client:
        async with client.stream('GET' if body is None else 'POST', url + path,
                                 headers={'Authorization': 'Bearer ' + token}, json=body) as response:
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 262144:
                    raise ValueError('Tool response exceeded limit')
            response.raise_for_status()
            return json.loads(data)


@app.list_tools()
async def list_tools():
    schema = await request('/openapi.json')
    result = []
    for path, item in schema['paths'].items():
        operation = item.get('post', {})
        name = operation.get('operationId')
        if name in ALLOWED and path == '/tools/' + name:
            result.append(Tool(name=name, description=operation['summary'],
                               inputSchema=operation['requestBody']['content']['application/json']['schema']))
    return result


@app.call_tool(validate_input=True)
async def call_tool(name, arguments):
    if name not in ALLOWED:
        raise ValueError('Unknown harness tool')
    try:
        result = await request('/tools/' + name, arguments)
    except (httpx.HTTPError, ValueError):
        result = {'status': 'unknown', 'code': 'HARNESS_UNAVAILABLE',
                  'instruction': 'Inspect stored intent/resource. Do not invent another target or payment.'}
    return [TextContent(type='text', text=json.dumps(result))]


async def main():
    async with stdio_server() as (reader, writer):
        await app.run(reader, writer, app.create_initialization_options())


if __name__ == '__main__':
    asyncio.run(main())
