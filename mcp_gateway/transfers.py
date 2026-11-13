"""Strict transfer-only stdio MCP surface for the deterministic payment host."""
import asyncio
import json

from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from server import READ, WRITE, get_transfer_status, pay

app = Server("Shucamoxa transfers")
INPUT = {
    "type": "object", "additionalProperties": False,
    "properties": {"intent_id": {"type": "string", "pattern":
        r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"}},
    "required": ["intent_id"],
}


@app.list_tools()
async def tools():
    return [
        Tool(name="pay", description="Execute or schedule an owner-authorized stored transfer. Never changes its recipient, amount or policy. Unknown is not failure: read status.", inputSchema=INPUT, annotations=WRITE),
        Tool(name="get_transfer_status", description="Read the durable transfer outcome. Submitted is not settled.", inputSchema=INPUT, annotations=READ),
    ]


@app.call_tool(validate_input=True)
async def call(name: str, arguments: dict):
    if name == "pay":
        result = await pay(arguments["intent_id"])
    elif name == "get_transfer_status":
        result = await get_transfer_status(arguments["intent_id"])
    else:
        raise ValueError("Unknown transfer tool")
    return [TextContent(type="text", text=json.dumps(result))]


async def main():
    async with stdio_server() as (reader, writer):
        await app.run(reader, writer, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
