#!/usr/bin/env python3
"""Read-only diagnostic for Shucamoxa's Open WebUI tool integration.

Never prints bearer tokens or changes settings. Run after start-harness-demo.sh.
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEBUI = "http://127.0.0.1:3000"
HARNESS = "http://127.0.0.1:8091"


def load(path, token=None):
    req = urllib.request.Request(
        path, headers={"Authorization": "Bearer " + token} if token else {}
    )
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=8) as response:
        return json.load(response)


def main():
    failures = []
    try:
        health = load(HARNESS + "/health")
        schema = load(HARNESS + "/openapi.json")
        operations = sorted(
            spec.get("post", {}).get("operationId")
            for spec in schema.get("paths", {}).values()
            if spec.get("post", {}).get("operationId")
        )
        print("Harness:", health.get("evidence", "unknown"))
        print("Advertised operations (" + str(len(operations)) + "):", ", ".join(operations))
        if not operations or not health.get("ok"):
            failures.append("Harness is not healthy or exposes no operations")
    except (OSError, ValueError, urllib.error.URLError) as exc:
        print("Harness: UNREACHABLE (" + type(exc).__name__ + ")")
        failures.append("Harness HTTP or OpenAPI discovery failed")

    session_path = ROOT / "secrets/webui/admin.session"
    if not session_path.is_file() or session_path.is_symlink() or session_path.stat().st_mode & 0o077:
        print("WebUI admin session: unavailable; use the normal launcher to register")
        failures.append("Private WebUI admin session missing or incorrectly permissioned")
    else:
        token = session_path.read_text().strip()
        try:
            config = load(WEBUI + "/api/v1/configs/tool_servers", token)
            connections = config.get("TOOL_SERVER_CONNECTIONS") or []
            ours = [c for c in connections if (c.get("info") or {}).get("id") == "shucamoxa"]
            print("Shucamoxa global server registered:", len(ours) == 1)
            if len(ours) != 1:
                failures.append("Shucamoxa tool server not registered exactly once")
            else:
                c = ours[0]
                print("Server enabled:", (c.get("config") or {}).get("enable") is True)
                print("Server spec path:", c.get("path"))
                if (c.get("config") or {}).get("enable") is not True:
                    failures.append("Global tool server disabled")
            model = load(WEBUI + "/api/v1/models/model?id=shucamoxa-finance", token)
            ids = (model.get("meta") or {}).get("toolIds") or []
            print("Finance model attached to server:", "server:shucamoxa" in ids)
            print("Base model:", model.get("base_model_id", "unknown"))
            if "server:shucamoxa" not in ids:
                failures.append("Finance preset is not attached to Shucamoxa")
        except (OSError, ValueError, urllib.error.URLError) as exc:
            print("WebUI registration: CANNOT VERIFY (" + type(exc).__name__ + ")")
            failures.append("Cannot inspect WebUI registration")

    print("\nManual proof still required: Open WebUI + > Tools must show an enabled Shucamoxa server.")
    print("In a NEW finance chat, invoke get_capabilities and inspect the actual tool-call trace.")
    print("A successful registration check alone does not prove model tool execution.")
    if failures:
        print("\nChecks requiring attention:")
        for failure in failures:
            print("- " + failure)
        return 1
    print("\nConfiguration checks passed; live tool execution is not yet proven.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
