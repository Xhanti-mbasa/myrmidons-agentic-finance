"""Build a named Ollama development model; optionally import existing GGUF weights."""
import json
from pathlib import Path
import re

from .chat import endpoint
from .cli import digest


def build_model(args):
    try:
        import httpx
    except ImportError:
        raise ValueError("Install model/chat dependencies: python -m pip install -e '.[chat]'") from None
    host = endpoint(args.host)
    if not re.fullmatch(r"w3node-[A-Za-z0-9][A-Za-z0-9_.:-]{0,80}", args.name):
        raise ValueError("Development model names must start with w3node- (e.g. w3node-xhanti-v1)")
    profile = json.loads(Path(args.profile).read_text())
    if not isinstance(profile, dict) or set(profile) - {"from", "system", "parameters"}:
        raise ValueError("Model profiles support only from, system and parameters")
    if not isinstance(profile.get("from"), str) or not profile["from"] or profile["from"] == args.name:
        raise ValueError("Profile needs a different base model name in from")
    if "system" in profile and not isinstance(profile["system"], str):
        raise ValueError("Profile system must be a string")
    if "parameters" in profile and not isinstance(profile["parameters"], dict):
        raise ValueError("Profile parameters must be a JSON object")
    payload = {**profile, "model": args.name, "stream": False}
    try:
        with httpx.Client(timeout=600, trust_env=False, follow_redirects=False) as client:
            if args.gguf:
                source = Path(args.gguf)
                with source.open("rb") as file:
                    if file.read(4) != b"GGUF":
                        raise ValueError("Expected an existing GGUF checkpoint")
                sha = "sha256:" + digest(source)
                exists = client.head(host + "/api/blobs/" + sha)
                if exists.status_code == 404:
                    print(f"Uploading GGUF ({source.stat().st_size} bytes); digest {sha}")
                    with source.open("rb") as file:
                        chunks = iter(lambda: file.read(1024 * 1024), b"")
                        upload = client.post(host + "/api/blobs/" + sha, content=chunks,
                                             headers={"Content-Type": "application/octet-stream"})
                    upload.raise_for_status()
                else:
                    exists.raise_for_status()
                    print(f"Reusing cached weight blob; digest {sha}")
                payload.pop("from")
                payload["files"] = {"model.gguf": sha}
            response = client.post(host + "/api/create", json=payload)
            response.raise_for_status()
            result = response.json()
            if result.get("status") != "success" or result.get("error"):
                raise ValueError("Model build did not report success; inspect Ollama before testing")
    except httpx.HTTPError:
        raise ValueError(f"Ollama build request failed at {host}; check Ollama, base model and GGUF compatibility") from None
    print(f"Built {args.name}. Test: w3node chat --host {host} --model {args.name}")

