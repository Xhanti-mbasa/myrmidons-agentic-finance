"""Local stdio MCP sandbox: no tools until --demo-tool is explicitly selected."""
import argparse


def main():
    from mcp.server.fastmcp import FastMCP
    from mcp.types import ToolAnnotations
    from pydantic import Field
    from typing import Annotated
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo-tool", action="store_true")
    args = parser.parse_args()
    server = FastMCP("W3Node local sandbox")
    if args.demo_tool:
        # Annotation must be resolvable in FastMCP's module-global schema namespace.
        @server.tool(annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False))
        async def echo(text: Annotated[str, Field(min_length=1, max_length=500)]) -> dict:
            """Echo the exact supplied text. No network, files, payments or other side effects."""
            return {"echo": text}
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
