"""Public-key requests on laptops; bounded, allowlisted reconciliation on server.

The root worker consumes JSON only. It never checks out or executes request code.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from .cli import NAME, MARKER, account, run, write_json

REPO = "Xhanti-mbasa/myrmidons-agentic-finance"
HOST = "100.83.89.75"
SERVER_NAME = "shucamoxa-dev"


def username(name):
    if not NAME.fullmatch(name) or name in {"root", "cam", "ubuntu", "ollama", "nobody"}:
        raise ValueError("Use a personal Linux username; reserved service/existing Cam accounts are excluded")
    return name


def public_key(value):
    if not isinstance(value, str) or len(value) > 1024 or len(value.splitlines()) != 1:
        raise ValueError("Expected one Ed25519 public key")
    parts = value.split()
    if len(parts) < 2 or parts[0] != "ssh-ed25519":
        raise ValueError("Only plain Ed25519 public keys are accepted")
    blob = base64.b64decode(parts[1], validate=True)
    # SSH wire encoding: string('ssh-ed25519'), string(32-byte public key).
    if len(blob) != 51 or blob[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20":
        raise ValueError("Invalid Ed25519 public key encoding")
    return " ".join(parts[:2])


def fingerprint(key):
    return hashlib.sha256(base64.b64decode(public_key(key).split()[1])).hexdigest()


def gh(path, method="GET", payload=None):
    args = ["gh", "api", "--hostname", "github.com", path, "--method", method]
    if payload is not None:
        args += ["--input", "-"]
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, check=False, timeout=60)
    if result.returncode:
        raise ValueError("GitHub request failed. Check `gh auth status`; rerun after resolving access.")
    return json.loads(result.stdout) if result.stdout.strip() else None


def local_paths(name):
    username(name)
    key = Path.home() / ".ssh" / f"shucamoxa_{name}"
    state = Path.home() / ".local" / "state" / "w3node" / name
    return key, state


def prepare(name):
    username(name)
    if socket.gethostname() == SERVER_NAME or (hasattr(os, "geteuid") and os.geteuid() == 0):
        raise ValueError("Run `w3node users add` on your own computer as your local user, outside SSH/root")
    if os.environ.get("SSH_CONNECTION"):
        raise ValueError("Open a local terminal outside SSH before generating your login key")
    if not shutil.which("ssh-keygen"):
        raise ValueError("Install OpenSSH client (ssh and ssh-keygen) first")
    key, state = local_paths(name)
    key.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    if key.is_symlink() or Path(str(key) + ".pub").is_symlink():
        raise ValueError("Refusing a symlinked key path")
    if not key.exists():
        if Path(str(key) + ".pub").exists():
            raise ValueError("Public key exists without private key; recover it or choose another username")
        # No -N: ssh-keygen prompts locally for a passphrase, never captured by us.
        run("ssh-keygen", "-t", "ed25519", "-f", str(key), "-C", f"w3node:{name}")
    pub_path = Path(str(key) + ".pub")
    if not pub_path.exists():
        raise ValueError("Private key exists but .pub is missing; restore the matching public key")
    key.chmod(0o600)
    value = public_key(pub_path.read_text().strip())
    request = {"schema_version": 1, "username": name, "public_key": value}
    write_json(state / "request.json", request)
    print(f"Public key (safe to send to Xhanti):\n{value}")
    print(f"Request file: {state / 'request.json'}")
    print("Private key stays on this computer.")
    return request, state


def submit(request, state):
    if not shutil.which("gh"):
        print("Automatic submission needs GitHub CLI: https://cli.github.com/ .")
        print("You can send the public key above now, or install gh, run `gh auth login`, and rerun this command.")
        return
    actor = gh("user")
    name = request["username"]
    tag = fingerprint(request["public_key"])[:16]
    branch = f"onboarding/{actor['id']}/{name}-{tag}"
    # An already recorded open PR is reused, so reruns do not rotate keys or spam requests.
    receipt = state / "receipt.json"
    if receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous.get("fingerprint") == tag:
            pr = gh(f"repos/{REPO}/pulls/{previous['pr']}")
            if pr["state"] == "open":
                print(f"Existing access request: {pr['html_url']}")
                return
            raise ValueError("Previous request was closed; ask the administrator before requesting access again")
    repository = gh(f"repos/{REPO}")
    destination = REPO
    if repository["owner"]["id"] != actor["id"]:
        fork = gh(f"repos/{REPO}/forks", "POST", {"default_branch_only": True})
        destination = fork["full_name"]
        print("Using your fork for the request; GitHub may need a moment to prepare a new fork.")
    base = gh(f"repos/{REPO}/git/ref/heads/main")["object"]["sha"]
    # Reuse only a branch that points to the identical one-file request.
    # A failed submission can be retried by looking for its branch via GET first.
    refs = gh(f"repos/{destination}/git/matching-refs/heads/{branch}")
    exact = [item for item in refs if item["ref"] == f"refs/heads/{branch}"]
    path = f"access/requests/{name}.json"
    if not exact:
        parent = gh(f"repos/{destination}/git/commits/{base}")
        tree = gh(f"repos/{destination}/git/trees", "POST", {
            "base_tree": parent["tree"]["sha"], "tree": [{"path": path,
            "mode": "100644", "type": "blob", "content": json.dumps(request, indent=2) + "\n"}]})
        commit = gh(f"repos/{destination}/git/commits", "POST", {
            "message": f"Request W3Node access for {name}", "tree": tree["sha"], "parents": [base]})
        # Publish the complete request branch last. Failures before this step leave no broken ref.
        gh(f"repos/{destination}/git/refs", "POST", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
    else:
        existing = gh(f"repos/{destination}/contents/{path}?ref={urllib.parse.quote(branch, safe='')}")
        if json.loads(base64.b64decode(existing["content"])) != request:
            raise ValueError("Request branch differs from local key; ask the administrator to inspect it")
    head = f"{destination.split('/')[0]}:{branch}"
    previous = gh(f"repos/{REPO}/pulls?state=open&head={urllib.parse.quote(head, safe='')}")
    pr = previous[0] if previous else gh(f"repos/{REPO}/pulls", "POST", {
        "title": f"W3Node access request: {name}", "head": head, "base": "main",
        "maintainer_can_modify": False,
        "body": "Public-key onboarding request. The server checks the authenticated PR author against its administrator-maintained allowlist. No private key or Tailscale invitation is included. This PR is consumed as data, not merged or executed."})
    write_json(receipt, {"pr": pr["number"], "fingerprint": tag})
    print(f"Access request submitted: {pr['html_url']}")
    print("If your GitHub identity is preapproved, the next server sync provisions access and emails your Tailscale invite.")


def client(args):
    if args.action == "add":
        request, state = prepare(args.name)
        if not args.offline:
            submit(request, state)
    elif args.action == "connect":
        key, _ = local_paths(args.name)
        if not key.exists():
            raise ValueError("Generate your local key with `w3node users add NAME` first")
        print("Connecting to the container; verify its host fingerprint on first connection.")
        print("Expected ED25519 fingerprint: SHA256:RsVIEMB/XoRLucau5SYriLzu7kDN98TifsJsK+AyqP0")
        run("ssh", "-i", str(key), "-o", "IdentitiesOnly=yes", "-o", "ExitOnForwardFailure=yes",
            "-L", "127.0.0.1:11435:127.0.0.1:11434", f"{args.name}@{HOST}")
    else:
        _, state = local_paths(args.name)
        if not (state / "receipt.json").exists():
            raise ValueError("No submitted request found; run `w3node users add NAME`")
        pr_number = json.loads((state / "receipt.json").read_text())["pr"]
        pr = gh(f"repos/{REPO}/pulls/{pr_number}")
        print(f"Request: {pr['html_url']} ({pr['state']})")
        print("An open request may be pending or already provisioned. Check your Tailscale invitation email, then use `w3node users connect NAME`.")


class API:
    """Fixed-origin JSON API client. Tokens never go in argv, URLs, logs or PRs."""
    def __init__(self, origin, token):
        self.origin, self.token = origin, token

    def call(self, path, method="GET", payload=None):
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("API path must be relative")
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(self.origin + path, data=data, method=method,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
                     "Accept": "application/json", "User-Agent": "w3node-team/0.2"})
        # Refuse redirects entirely: do not transmit tokens to an alternate origin.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("API response too large")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raise ValueError(f"API request failed with HTTP {error.code}; inspect server credentials/permissions") from None


def root_file(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("Server file paths must be absolute")
    for parent in [path, *path.parents]:
        stat = parent.lstat()
        if parent.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
            raise ValueError("Server files and parent directories must be root-owned and not group/world writable")
    if path.stat().st_mode & 0o077:
        raise ValueError("Server configuration and credential files must have mode 0600")
    return path


def root_directory(path):
    path = Path(path)
    for parent in [path, *path.parents]:
        stat = parent.lstat()
        if parent.is_symlink() or stat.st_uid != 0 or stat.st_mode & 0o022:
            raise ValueError("Administrative directories must be root-owned and protected")
    return path


def load_policy(path):
    data = json.loads(root_file(path).read_text())
    if data.get("repository") != REPO or not isinstance(data.get("members"), dict):
        raise ValueError("Invalid server policy")
    ids = set()
    for name, member in data["members"].items():
        username(name)
        if type(member.get("github_id")) is not int or member["github_id"] <= 0 or member["github_id"] in ids:
            raise ValueError("Each approved member needs a unique positive numeric GitHub user ID")
        ids.add(member["github_id"])
        if not isinstance(member.get("enabled"), bool):
            raise ValueError("Each member needs enabled=true or false")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", member.get("tailscale_email", "")):
            raise ValueError("Each approved member needs a private Tailscale invitation email")
    if not re.fullmatch(r"[A-Za-z0-9]+", data.get("tailscale_device_id", "")):
        raise ValueError("Set the node ID for shucamoxa-dev, not its IP address")
    return data


def checked_request(pr, files, raw, policy):
    if pr.get("state") != "open" or pr.get("draft") or pr["base"]["ref"] != "main":
        raise ValueError("Not an open onboarding request")
    if pr["base"]["repo"]["full_name"] != REPO or not pr["head"]["ref"].startswith("onboarding/"):
        raise ValueError("Wrong onboarding repository/branch")
    if pr["head"]["repo"]["owner"]["id"] != pr["user"]["id"] or pr.get("maintainer_can_modify"):
        raise ValueError("Request branch must be in the author's repository, with maintainer changes disabled")
    if len(raw) > 4096:
        raise ValueError("Request too large")
    request = json.loads(raw)
    if (set(request) != {"schema_version", "username", "public_key"}
            or type(request["schema_version"]) is not int or request["schema_version"] != 1):
        raise ValueError("Unexpected request fields")
    name = username(request["username"])
    member = policy["members"].get(name)
    if not member or not member["enabled"] or pr["user"]["id"] != member["github_id"]:
        raise ValueError("PR author is not preapproved for this username")
    if len(files) != 1 or files[0]["filename"] != f"access/requests/{name}.json" or files[0]["status"] not in ("added", "modified"):
        raise ValueError("Onboarding PR must contain only its one JSON request")
    request["public_key"] = public_key(request["public_key"])
    return request


def ssh_config(name):
    path = Path("/etc/ssh/sshd_config.d/00-shucamoxa.conf")
    if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
        raise ValueError("SSH snippet must be root-owned, not writable by developers")
    original = path.read_text()
    lines = original.splitlines()
    if any(re.match(r"\s*Match\s", line, re.I) for line in lines):
        raise ValueError("Expected a global SSH snippet; Match blocks need administrator review")
    allow = [i for i, line in enumerate(lines) if re.match(r"\s*AllowUsers\s", line, re.I)]
    if len(allow) != 1:
        raise ValueError("Expected exactly one AllowUsers line in the known container snippet")
    users = lines[allow[0]].split()[1:]
    if "#" in lines[allow[0]]:
        raise ValueError("Inline comments in AllowUsers require administrator cleanup")
    if name not in users:
        lines[allow[0]] += " " + name
    keylines = [i for i, line in enumerate(lines) if re.match(r"\s*AuthorizedKeysFile\s", line, re.I)]
    extra = "/etc/w3node/authorized_keys/%u"
    if len(keylines) > 1:
        raise ValueError("Ambiguous AuthorizedKeysFile configuration")
    if keylines:
        if extra not in lines[keylines[0]].split()[1:]:
            lines[keylines[0]] += " " + extra
    else:
        lines.append("AuthorizedKeysFile .ssh/authorized_keys .ssh/authorized_keys2 " + extra)
    updated = "\n".join(lines) + "\n"
    if updated == original:
        return
    # Keep a root-owned recovery copy; never touch password/forwarding restrictions.
    backup = Path(str(path) + ".before-w3node-sync")
    if not backup.exists():
        backup.write_text(original)
        backup.chmod(0o600)
    path.write_text(updated)
    try:
        run("/usr/sbin/sshd", "-t")
        run("systemctl", "reload", "ssh")
    except Exception:
        path.write_text(original)
        run("/usr/sbin/sshd", "-t")
        run("systemctl", "reload", "ssh")
        raise


def provision(request, previous):
    name, key = request["username"], request["public_key"]
    user = account(name)
    if user and (user.pw_gecos != MARKER or user.pw_uid < 1000):
        raise ValueError("Refusing to adopt an unmanaged/system account")
    if previous and previous.get("fingerprint") != fingerprint(key):
        raise ValueError("Key rotation needs administrator review; existing key will not be replaced")
    if not user:
        run("useradd", "--create-home", "--shell", "/usr/sbin/nologin", "--expiredate", "1",
            "--comment", MARKER, name)
    run("usermod", "--append", "--groups", "users,w3node-dev", name)
    keys_dir = Path("/etc/w3node/authorized_keys")
    root_directory(keys_dir.parent)
    if keys_dir.is_symlink():
        raise ValueError("Refusing symlinked managed key directory")
    keys_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
    if keys_dir.stat().st_uid != 0 or keys_dir.stat().st_mode & 0o022:
        raise ValueError("Managed keys must be root-owned and protected")
    target = keys_dir / name
    if target.is_symlink():
        raise ValueError("Refusing symlinked managed key file")
    if target.exists() and target.read_text().strip() != key:
        raise ValueError("Refusing to overwrite a different managed key")
    with tempfile.NamedTemporaryFile(mode="w", dir=keys_dir, delete=False) as out:
        out.write(key + "\n")
        temp = Path(out.name)
    temp.chmod(0o644)  # Public key, readable by sshd under the login user's identity.
    os.replace(temp, target)
    ssh_config(name)
    effective = run("/usr/sbin/sshd", "-T", "-C", f"user={name},host=shucamoxa-dev,addr=127.0.0.1", capture_output=True).stdout
    required = ["usepam yes", "pubkeyauthentication yes", "passwordauthentication no",
                "allowtcpforwarding local", "permitopen 127.0.0.1:11434"]
    if any(line not in effective.splitlines() for line in required) or str(keys_dir) + "/%u" not in effective:
        raise ValueError("Effective SSH configuration differs from supported container setup; account remains staged")
    allowed = [line.split()[1:] for line in effective.splitlines() if line.startswith("allowusers ")]
    if not any(name in entry for entry in allowed):
        raise ValueError("Account not in effective SSH allowlist; account remains staged")
    # The account password stays locked; PAM account expiry is cleared only after key/SSH validation.
    run("usermod", "--expiredate", "", "--shell", "/bin/bash", name)


def ensure_invite(api, policy, member, previous):
    device_id = policy["tailscale_device_id"]
    device = api.call(f"/device/{device_id}")
    if device.get("hostname") != SERVER_NAME or HOST not in device.get("addresses", []):
        raise ValueError("Configured Tailscale node is not the known shucamoxa-dev container")
    invites = api.call(f"/device/{device_id}/device-invites")
    if previous.get("invite_id"):
        match = [i for i in invites if str(i["id"]) == str(previous["invite_id"])]
        if match:
            return str(match[0]["id"])
        raise ValueError("Previous invitation disappeared; administrator must review before reissuing")
    # Reconcile after a crash following API creation but before the state write.
    matches = [i for i in invites if i.get("email", "").casefold() == member["tailscale_email"].casefold()]
    if matches:
        return str(matches[-1]["id"])
    result = api.call(f"/device/{device_id}/device-invites", "POST", [{
        "multiUse": False, "allowExitNode": False, "email": member["tailscale_email"]}])
    if not isinstance(result, list) or len(result) != 1 or not result[0].get("id"):
        raise ValueError("Unexpected Tailscale response; inspect invites before retrying")
    # The provider emails the private link; it is never posted to GitHub or logged.
    return str(result[0]["id"])


def sync_server(config_path):
    if os.geteuid() != 0 or socket.gethostname() != SERVER_NAME:
        raise ValueError("Run admin sync as root inside shucamoxa-dev")
    import fcntl
    import grp
    grp.getgrnam("w3node-dev")  # Workspace ACL setup is a one-time administrator task.
    policy = load_policy(config_path)
    credentials = json.loads(root_file(policy["credentials_file"]).read_text())
    github = API("https://api.github.com", credentials["github_token"])
    tailscale = API("https://api.tailscale.com/api/v2", credentials["tailscale_api_token"])
    state_dir = Path("/var/lib/w3node")
    root_directory(state_dir.parent)
    state_dir.mkdir(mode=0o700, exist_ok=True)
    root_file(config_path)  # Fail early; do not fetch or execute repository code.
    if state_dir.is_symlink() or state_dir.stat().st_uid != 0 or state_dir.stat().st_mode & 0o077:
        raise ValueError("State directory must be root-owned with mode 0700")
    with open(state_dir / "sync.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("Another sync is active; exiting.")
            return
        state_path = state_dir / "state.json"
        state = json.loads(state_path.read_text()) if state_path.exists() else {}
        # Disabled or removed policy members cannot be re-provisioned by replaying a PR.
        for name, old in state.items():
            member = policy["members"].get(name)
            if not member or not member["enabled"]:
                if not old.get("revoked"):
                    from .cli import users
                    import argparse
                    users(argparse.Namespace(action="remove", name=name))
                    old["revoked"] = True
                    write_json(state_path, state)
                    print(f"{name}: SSH revoked; remove accepted Tailscale sharing and independent tokens in admin console")
        # Bound each execution to five pages. Leave additional requests for operator review.
        errors = []
        for page in range(1, 6):
            prs = github.call(f"/repos/{REPO}/pulls?state=open&base=main&sort=created&direction=asc&per_page=100&page={page}")
            for summary in prs:
                if not summary["head"]["ref"].startswith("onboarding/"):
                    continue
                number = summary["number"]
                try:
                    pr = github.call(f"/repos/{REPO}/pulls/{number}")
                    actor = pr["user"]["id"]
                    if not any(m["enabled"] and m["github_id"] == actor for m in policy["members"].values()):
                        continue
                    sha = pr["head"]["sha"]
                    if not re.fullmatch(r"[0-9a-f]{40}", sha):
                        raise ValueError("Invalid request revision")
                    if any(old.get("pr") == number and old.get("sha") == sha and old.get("invite_id")
                           and not old.get("revoked") for old in state.values()):
                        continue
                    files = github.call(f"/repos/{REPO}/pulls/{number}/files?per_page=100")
                    if len(files) != 1:
                        raise ValueError("Only a single JSON request is permitted")
                    path = files[0]["filename"]
                    if not re.fullmatch(r"access/requests/[a-z_][a-z0-9_-]{0,30}\.json", path):
                        raise ValueError("Invalid request path")
                    source = pr["head"]["repo"]["full_name"]
                    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", source):
                        raise ValueError("Invalid request repository")
                    content = github.call(f"/repos/{source}/contents/{path}?ref={sha}")
                    raw = base64.b64decode(content["content"], validate=False)
                    request = checked_request(pr, files, raw, policy)
                    name = request["username"]
                    old = state.get(name, {})
                    if old.get("revoked"):
                        raise ValueError("Account revoked; administrator must explicitly reset its state before reenrollment")
                    # Do not reapply account/group changes for unchanged processed requests.
                    if old.get("fingerprint") == fingerprint(request["public_key"]) and old.get("invite_id"):
                        continue
                    provision(request, old)
                    old.update({"fingerprint": fingerprint(request["public_key"]), "pr": number, "sha": sha})
                    state[name] = old
                    write_json(state_path, state)  # Save account state before the external invitation.
                    old["invite_id"] = ensure_invite(tailscale, policy, policy["members"][name], old)
                    write_json(state_path, state)
                    print(f"{name}: account ready; Tailscale invitation delivered/reused")
                except (ValueError, KeyError, OSError, subprocess.SubprocessError, TypeError) as error:
                    # No bodies, keys, email addresses, tokens or invite URLs in logs.
                    errors.append(number)
                    print(f"Request #{number}: processing failed ({type(error).__name__}); inspect policy/API permissions and request schema")
            if len(prs) < 100:
                break
        if errors:
            raise ValueError("One or more requests failed; other valid requests were still processed")
