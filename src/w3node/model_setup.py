"""Fetch the base model into the selected Ollama instance and verify its identity."""
import json
from pathlib import Path
import re

from .chat import endpoint


def installed_digest(client, host, name):
    response = client.get(host + "/api/tags")
    response.raise_for_status()
    for item in response.json().get("models", []):
        if item.get("name") == name or item.get("model") == name:
            return str(item.get("digest", "")).removeprefix("sha256:")
    return None


def setup_model(args):
    try:
        import httpx
    except ImportError:
        raise ValueError("Install dependencies: python -m pip install -e '.[chat]'") from None
    lock = json.loads(Path(args.lock).read_text())
    name, expected = lock.get("model"), lock.get("manifest_digest")
    if (lock.get("schema_version") != 1 or not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,200}", name)
            or not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected)):
        raise ValueError("Expected schema_version=1, model and a 64-hex manifest_digest in the model lock")
    host = endpoint(args.host)
    print(f"Setting up {name} at {host}", flush=True)
    try:
        with httpx.Client(timeout=600, trust_env=False, follow_redirects=False) as client:
            actual = installed_digest(client, host, name)
            if actual is None:
                print("Downloading base model; Ollama reuses cached layers.", flush=True)
                last = None
                success = False
                with client.stream("POST", host + "/api/pull", json={"model": name, "stream": True}) as response:
                    response.raise_for_status()
                    for line in response.iter_lines():
                        if not line.strip():
                            continue
                        progress = json.loads(line)
                        if progress.get("error"):
                            raise ValueError("Ollama could not pull the locked model; inspect the Ollama service")
                        status = progress.get("status", "")
                        total, completed = progress.get("total"), progress.get("completed")
                        # Print at most one update per ten percent per layer.
                        bucket = min(10, int(completed / total * 10)) if type(total) is int and total > 0 and type(completed) is int else None
                        current = (status, progress.get("digest"), bucket)
                        if current != last:
                            print(f"{status}" + (f" {bucket * 10}%" if bucket is not None else ""), flush=True)
                            last = current
                        success = status == "success"
                if not success:
                    raise ValueError("Model pull ended without success; rerun setup after inspecting Ollama")
                actual = installed_digest(client, host, name)
            if actual != expected:
                raise ValueError(f"Model digest mismatch: expected {expected}, got {actual}. "
                                 "No verified setup. The tag may have changed; restore the pinned version or review a lock update. "
                                 "Setup does not overwrite an already installed mismatched model.")
    except httpx.HTTPError:
        raise ValueError(f"Cannot complete setup at {host}. Install/start Ollama (ollama serve), "
                         "or check the SSH tunnel when targeting the server. No automatic retry.") from None
    print(f"Verified {name}; manifest digest {expected}")
    print(f"Test: w3node chat --host {host} --model {name}")
