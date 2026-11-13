"""Local adversarial probes. Expected failures apply ONLY to the final safety assertion.
Probe/setup exceptions remain errors, never successful vulnerability reproductions.
"""
import asyncio
import base64
import copy
import inspect
import io
import tarfile
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp_gateway"))
import server as gateway
from w3node import onboarding

CASES = {}
def attack(id, title, target, standard, result="BLOCKED", evidence="simulated test"):
    def register(probe):
        CASES[id] = (dict(id=id, attack=title, target=target, standard=standard, result=result, evidence=evidence), probe)
        return probe
    return register

def denied(fn):
    try:
        fn()
    except ValueError:
        return True
    return False

@attack("MCP-01", "Extra payment fields, UUID escapes and unknown owner tools", "strict transfers MCP",
        "LLM01:2025, LLM06:2025; ASVS5 v2.2.2, v8.2.3", evidence="live local (stdio MCP + loopback HTTP)")
async def strict_mcp():
    requests = []
    intent = "ad2ae810-0787-49f2-a458-1c57bff0fb11"
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            body = json.dumps(dict(intentId=intent, status="blocked", code="POLICY_DENIED")).encode()
            self.send_response(200); self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as http:
        thread = threading.Thread(target=http.serve_forever, daemon=True); thread.start()
        try:
            params = StdioServerParameters(command=sys.executable, args=[str(ROOT / "mcp_gateway/transfers.py")],
                env={"SHUCAMOXA_BACKEND_URL": f"http://127.0.0.1:{http.server_port}",
                     "SHUCAMOXA_BACKEND_TOKEN": secrets.token_urlsafe(32), "SHUCAMOXA_BUSINESS_SCOPE": "test"})
            async with stdio_client(params) as (reader, writer):
                async with ClientSession(reader, writer) as session:
                    await session.initialize()
                    names = {t.name for t in (await session.list_tools()).tools}
                    errors = []
                    for args in [{"intent_id": intent, "amount": "1000"}, {"intent_id": intent, "destination": "attacker"},
                                 {"intent_id": intent, "approved": True}, {"intent_id": intent + "\u200b"},
                                 {"intent_id": "</invoice><tool_call>"}, {"intent_id": "а" + intent[1:]}]:
                        errors.append((await session.call_tool("pay", args)).isError)
                    errors.append((await session.call_tool("set_policy", {})).isError)
                    before = len(requests)
                    positive = await session.call_tool("pay", {"intent_id": intent})
                    return (names == {"pay", "get_transfer_status"} and all(errors) and before == 0
                            and not positive.isError and requests == [{"intentId": intent}],
                            "Seven malicious calls rejected before HTTP; positive control forwards exactly intentId")
        finally:
            http.shutdown(); thread.join()

async def backend_reply(body, method="GET", status=200):
    original = httpx.AsyncClient
    def factory(**kwargs):
        return original(**kwargs, transport=httpx.MockTransport(lambda req: httpx.Response(status, json=body)))
    with patch.dict(os.environ, {"SHUCAMOXA_BACKEND_URL": "https://backend.invalid", "SHUCAMOXA_BACKEND_TOKEN": "test-only",
                                 "SHUCAMOXA_BUSINESS_SCOPE": "test"}), patch.object(gateway.httpx, "AsyncClient", factory):
        return await gateway.backend(method, "/v1/mandate")

@attack("MCP-02", "Backend address and key-shaped canary returned to MCP caller", "Python gateway",
        "LLM02:2025; CCSS9 1.05.2.2 Key Material Isolation", "VULNERABLE")
async def backend_secrets():
    canary = secrets.token_hex(32)
    result = await backend_reply({"address": "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv", "note": canary})
    return (canary not in json.dumps(result) and "address" not in result,
            "Gateway returns backend dict unchanged, including synthetic key and address; no real secrets used")

@attack("MCP-03", "Redirect response must not be retried as a payment", "Python gateway",
        "ASVS5 v2.3.1; LLM06:2025")
async def redirect():
    result = await backend_reply({}, "POST", 307)
    return result.get("status") == "unknown", "307 yields unknown; no automatic follow or retry"

@attack("MCP-04", "Timeout cannot be reported as failed payment", "Python gateway", "ASVS5 v2.3.1, v2.3.3")
async def timeout():
    original = httpx.AsyncClient
    def fail(req): raise httpx.ReadTimeout("synthetic timeout", request=req)
    def factory(**kwargs): return original(**kwargs, transport=httpx.MockTransport(fail))
    with patch.dict(os.environ, {"SHUCAMOXA_BACKEND_URL": "https://backend.invalid", "SHUCAMOXA_BACKEND_TOKEN": "test-only",
                                 "SHUCAMOXA_BUSINESS_SCOPE": "test"}), patch.object(gateway.httpx, "AsyncClient", factory):
        result = await gateway.pay("ad2ae810-0787-49f2-a458-1c57bff0fb11")
    return result["status"] == "unknown", "Read timeout reports EXECUTION_UNKNOWN, not failure"

def request_fixture():
    # Public bytes only; no private key or account is created.
    key = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + bytes(range(32))).decode()
    request = {"schema_version": 1, "username": "auditor", "public_key": key}
    policy = {"members": {"auditor": {"github_id": 42, "enabled": True}}}
    pr = {"state": "open", "draft": False, "maintainer_can_modify": False, "user": {"id": 42},
          "base": {"ref": "main", "repo": {"full_name": onboarding.REPO}},
          "head": {"ref": "onboarding/auditor", "repo": {"owner": {"id": 42}}}}
    files = [{"filename": "access/requests/auditor.json", "status": "added"}]
    return request, policy, pr, files

@attack("ONBOARD-01", "Username/options/key injection into server-sync request", "onboarding parser",
        "ASVS5 v2.2.1, v8.2.3")
def onboarding_injection():
    request, policy, pr, files = request_fixture()
    if onboarding.checked_request(pr, files, json.dumps(request), policy) != request:
        raise RuntimeError("Positive onboarding control failed")
    attacks = []
    for name in ["root", "../auditor", "auditor;id", "--system", "аuditor", "auditor\nroot"]:
        attacks.append(denied(lambda n=name: onboarding.username(n)))
    for key in ['command="id" ' + request["public_key"], request["public_key"] + "\nssh-ed25519 bad", "ssh-ed25519 YWJj"]:
        attacks.append(denied(lambda k=key: onboarding.public_key(k)))
    for field in ["command", "groups", "shell", "tailscale_email"]:
        malicious = {**request, field: "attacker"}
        attacks.append(denied(lambda m=malicious: onboarding.checked_request(pr, files, json.dumps(m), policy)))
    return all(attacks), "13 request/parser attacks refused; valid positive control accepted; no provisioning executed"

@attack("ONBOARD-02", "Wrong author, disabled member replay and extra code file", "server-sync request authorization",
        "ASVS5 v8.2.1, v8.2.2, v8.3.1")
def onboarding_identity():
    request, policy, pr, files = request_fixture(); wrong = copy.deepcopy(pr); wrong["user"]["id"] = 999
    disabled = copy.deepcopy(policy); disabled["members"]["auditor"]["enabled"] = False
    cases = [(wrong, files, policy), (pr, files, disabled), (pr, files + [{"filename": "payload.py", "status": "added"}], policy)]
    return all(denied(lambda p=p, f=f, rules=rules: onboarding.checked_request(p, f, json.dumps(request), rules)) for p, f, rules in cases), "Wrong identity, revoked identity and executable attachment rejected locally"

@attack("ONBOARD-03", "Symlinked server policy file", "server-sync file validation", "ASVS5 v8.3.1")
def symlink():
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / "policy.json"; target.write_text("{}")
        link = Path(folder) / "alias.json"; link.symlink_to(target)
        safe = denied(lambda: onboarding.root_file(link))
    return safe, "Symlink policy rejected without reading credentials or contacting any service"


def scan(text):
    exe = os.environ.get("GITLEAKS_BIN", "gitleaks")
    completed = subprocess.run([exe, "stdin", "--config", str(ROOT / ".gitleaks.toml"), "--exit-code", "3",
                                "--redact", "--no-banner"], input=text, text=True, capture_output=True, timeout=30)
    if completed.returncode not in (0, 3):
        raise RuntimeError(f"gitleaks execution error ({completed.returncode}); output withheld")
    return completed.returncode == 3

@attack("SCAN-01", "Seed and prefixed private key positive controls", "gitleaks CLI", "CCSS9 1.05.2.2 Key Material Isolation; LLM02:2025", evidence="live local (gitleaks 8.30.1)")
def scanner_controls():
    seed = "sEdT" + "FAKE" * 6 + "FAK"
    return scan("material=" + seed) and scan("material=" + "ED" + secrets.token_hex(32)), "Runtime seed-shaped and prefixed-key fixtures flagged"

@attack("SCAN-02", "Raw private key hidden by checksum comment (R2)", "gitleaks CLI",
        "CCSS9 1.05.2.2 Key Material Isolation; LLM02:2025", "VULNERABLE", "live local (gitleaks 8.30.1)")
def scanner_bypass():
    material = secrets.token_hex(32)
    if not scan('material="' + material + '"'):
        raise RuntimeError("Raw-key positive control failed")
    return scan('material="' + material + '" # checksum'), "Identical raw key caught normally, ignored when checksum is added to its line"

@attack("SCAN-03", "Hex key split into concatenated string fragments", "gitleaks CLI",
        "CCSS9 1.05.2.2 Key Material Isolation; LLM02:2025", "VULNERABLE", "live local (gitleaks 8.30.1)")
def scanner_split():
    material = secrets.token_hex(32)
    if not scan("material=" + material): raise RuntimeError("Positive control failed")
    return scan('material="' + material[:32] + '" + "' + material[32:] + '"'), "Concatenated private-key fragments evade shape-based rules; scanning is not secret isolation"

@attack("CI-01", "Dependency install script attempts execution under pinned pnpm (R3)", "CI package-manager boundary",
        "LLM03:2025 Supply Chain (dependency script execution)", "BLOCKED", "live local (offline pnpm 10.28.0 sandbox)")
def lifecycle():
    pnpm = os.environ.get("PNPM_BIN", "pnpm")
    version = subprocess.check_output([pnpm, "--version"], text=True).strip()
    if version != "10.28.0": raise RuntimeError("R3 reproduction needs repo-pinned pnpm 10.28.0")
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder); app = path / "app"; app.mkdir()
        package = {"name": "local-adversarial-probe", "version": "1.0.0", "scripts": {
            "postinstall": "node -e \"require('fs').writeFileSync('EXECUTED', '1')\""}}
        archive = path / "probe.tgz"
        with tarfile.open(archive, "w:gz") as tar:
            blob = json.dumps(package).encode(); entry = tarfile.TarInfo("package/package.json"); entry.size = len(blob)
            tar.addfile(entry, io.BytesIO(blob))
        (app / "package.json").write_text(json.dumps({"private": True, "packageManager": "pnpm@10.28.0",
            "dependencies": {"local-adversarial-probe": "file:../probe.tgz"}}))
        # Use the repo's package-build policy, without its workspace discovery globs.
        workspace = (ROOT / "pnpm-workspace.yaml").read_text().splitlines()
        settings = []
        skipping_packages = False
        for line in workspace:
            if line == "packages:": skipping_packages = True; continue
            if skipping_packages and line.startswith(" "): continue
            skipping_packages = False; settings.append(line)
        (app / "pnpm-workspace.yaml").write_text("\n".join(settings) + "\n")
        completed = subprocess.run([pnpm, "install", "--offline", "--store-dir", str(path / "store")], cwd=app,
                                   capture_output=True, text=True, timeout=60)
        if completed.returncode: raise RuntimeError("Offline pnpm fixture failed; no security result inferred")
        installed = app / "node_modules/local-adversarial-probe"
        if not (installed / "package.json").exists(): raise RuntimeError("Probe package was not installed")
        blocked = not (installed / "EXECUTED").exists()
    return blocked, "Offline package with postinstall marker installed; dependency lifecycle script suppressed by pnpm 10 default (R3 transitive-script claim refuted)"

class AdversarialPython(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        id = self._testMethodName.removeprefix("test_").replace("_", "-")
        metadata, probe = CASES[id]
        result = probe()
        if inspect.isawaitable(result): result = await result
        self.safe, observation = result
        if type(self.safe) is not bool: raise RuntimeError("Probe must return bool")
        directory = Path(os.environ["SECURITY_RESULTS_DIR"]); directory.mkdir(parents=True, exist_ok=True)
        (directory / f"{id}.json").write_text(json.dumps({**metadata, "safe": self.safe, "observation": observation}, indent=2))

for id, (metadata, probe) in CASES.items():
    def verify(self): self.assertTrue(self.safe, "Expected safe outcome was not met; see sanitized result by case ID")
    verify.__name__ = "test_" + id.replace("-", "_")
    if metadata["result"] != "BLOCKED": verify = unittest.expectedFailure(verify)
    setattr(AdversarialPython, verify.__name__, verify)

if __name__ == "__main__": unittest.main(verbosity=2)
