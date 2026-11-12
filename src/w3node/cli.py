"""Local onboarding, administrator provisioning, and pinned model components."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request


NAME = re.compile(r"[a-z_][a-z0-9_-]{0,30}\Z")
COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\Z")
MARKER = "w3node-managed-v1"


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def https_url(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("Use HTTPS URLs without embedded credentials, queries or fragments")
    return value


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        https_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def manifest(path):
    data = json.loads(Path(path).read_text())
    if data.get("schema_version") != 1 or not isinstance(data.get("components"), dict):
        raise ValueError("Expected schema_version=1 and a components object")
    for name, item in data["components"].items():
        if not COMPONENT.fullmatch(name) or name in (".", ".."):
            raise ValueError("Invalid component name")
        https_url(item["url"])
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise ValueError("Invalid SHA256")
        if type(item["size"]) is not int or item["size"] < 0:
            raise ValueError("Invalid component size")
    return data


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as out:
        temp = Path(out.name)
        json.dump(data, out, indent=2)
        out.write("\n")
    os.replace(temp, path)


def model(args):
    data = manifest(args.manifest)
    if args.action == "pin":
        if not COMPONENT.fullmatch(args.name) or args.name in (".", ".."):
            raise ValueError("Invalid component name")
        source = Path(args.file)
        data["components"][args.name] = {
            "url": https_url(args.url), "sha256": digest(source),
            "size": source.stat().st_size,
        }
        write_json(args.manifest, data)
        print("Pinned local bytes. Upload that exact file to the URL, then commit the manifest.")
        return
    selected = args.names or list(data["components"])
    if not selected:
        raise ValueError("No components pinned yet")
    unknown = set(selected) - data["components"].keys()
    if unknown:
        raise ValueError("Unknown components: " + ", ".join(sorted(unknown)))
    cache = Path(args.cache).expanduser()
    cache.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(HTTPSOnly())
    for name in selected:
        item = data["components"][name]
        target = cache / item["sha256"]
        if target.is_symlink():
            raise ValueError("Refusing symlink in artifact cache")
        if target.exists() and target.stat().st_size == item["size"] and digest(target) == item["sha256"]:
            print(f"{name}: {target.resolve()} (verified cache)")
            continue
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=cache, delete=False) as out:
                temp = Path(out.name)
                with opener.open(item["url"], timeout=60) as response:
                    received = 0
                    for chunk in iter(lambda: response.read(1024 * 1024), b""):
                        received += len(chunk)
                        if received > item["size"]:
                            raise ValueError(f"{name}: download exceeds pinned size")
                        out.write(chunk)
            if temp.stat().st_size != item["size"] or digest(temp) != item["sha256"]:
                raise ValueError(f"{name}: checksum/size mismatch")
            os.replace(temp, target)
            print(f"{name}: {target.resolve()} (downloaded and verified)")
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)


def account(name):
    import pwd
    if not NAME.fullmatch(name):
        raise ValueError("Invalid Linux username")
    try:
        return pwd.getpwnam(name)
    except KeyError:
        return None


def validate_key(path):
    value = Path(path).read_text().strip()
    parts = value.split()
    if len(value.splitlines()) != 1 or len(parts) < 2 or parts[0] not in ("ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"):
        raise ValueError("Provide one OpenSSH public key without authorized_keys options")
    base64.b64decode(parts[1], validate=True)
    run("ssh-keygen", "-l", "-f", str(Path(path).resolve()), stdout=subprocess.DEVNULL)
    return " ".join(parts[:2]) + "\n"


def users(args):
    import grp
    user = account(args.name)
    if args.action == "inspect":
        if not user:
            raise ValueError("Account does not exist")
        print(json.dumps({"name": user.pw_name, "uid": user.pw_uid,
                          "primary_group": grp.getgrgid(user.pw_gid).gr_name,
                          "groups": sorted(grp.getgrgid(g).gr_name for g in os.getgrouplist(user.pw_name, user.pw_gid)),
                          "shell": user.pw_shell}, indent=2))
        print("Inspect sudo -l -U USER, cloud IAM, SSH AllowGroups and file ACLs separately.")
        return
    if os.geteuid() != 0:
        raise ValueError("Run user changes as an administrator on the target Linux server")
    # Serialize our provisioning and revocation to avoid inconsistent managed state.
    import fcntl
    with open("/run/w3node-users.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        user = account(args.name)
        if user and (user.pw_gecos != MARKER or user.pw_uid < 1000):
            raise ValueError("Refusing to modify an existing unmanaged/system account")
        if args.action == "add":
            if user:
                raise ValueError("Managed account already exists; remove first or manage keys separately")
            key = validate_key(args.key)
            groups = args.groups.split(",")
            for group in groups:
                if not NAME.fullmatch(group):
                    raise ValueError("Invalid group name")
                grp.getgrnam(group)  # Require administrator-created groups.
            print(f"Create {args.name} with groups: {', '.join(groups)}")
            run("useradd", "--create-home", "--shell", "/bin/bash", "--comment", MARKER,
                "--groups", ",".join(groups), args.name)
            try:
                user = account(args.name)
                ssh = Path(user.pw_dir) / ".ssh"
                if ssh.is_symlink() or ssh.exists():
                    raise ValueError("Unexpected .ssh path; account left disabled")
                ssh.mkdir(mode=0o700)
                os.chown(ssh, user.pw_uid, user.pw_gid)
                keys = ssh / "authorized_keys"
                with keys.open("x") as out:
                    out.write(key)
                keys.chmod(0o600)
                os.chown(keys, user.pw_uid, user.pw_gid)
                # Keep password locked. Verify the host permits key-only locked-password accounts.
                print(f"Created {args.name}; verify SSH login before relying on access.")
            except Exception:
                run("usermod", "--expiredate", "1", "--shell", "/usr/sbin/nologin", args.name)
                raise
        else:
            if not user:
                raise ValueError("Account does not exist")
            if int(os.environ.get("SUDO_UID", "-1")) == user.pw_uid:
                raise ValueError("Refusing to revoke the invoking administrator")
            run("usermod", "--lock", "--expiredate", "1", "--shell", "/usr/sbin/nologin", args.name)
            # Remove supplemental privileges too; retain the home for recovery.
            run("usermod", "--groups", "", args.name)
            result = subprocess.run(["pkill", "-KILL", "-u", str(user.pw_uid)], check=False)
            if result.returncode not in (0, 1):
                raise ValueError("Account disabled, but process termination failed; inspect manually")
            print(f"Disabled {args.name} and terminated their processes; home retained.")
            print("Revoke independent API tokens, GitHub, cloud IAM and MCP credentials separately.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    u = commands.add_parser("users")
    actions = u.add_subparsers(dest="action", required=True)
    for action in ("add", "status", "connect"):
        p = actions.add_parser(action)
        p.add_argument("name")
        if action == "add":
            p.add_argument("--offline", action="store_true", help="Generate key/request without GitHub submission")
    admin = commands.add_parser("admin")
    admin_actions = admin.add_subparsers(dest="admin_action", required=True)
    sync = admin_actions.add_parser("sync")
    sync.add_argument("--config", default="/etc/w3node/server.json")
    au = admin_actions.add_parser("users")
    aa = au.add_subparsers(dest="action", required=True)
    for action in ("inspect", "add", "remove"):
        p = aa.add_parser(action)
        p.add_argument("name")
        if action == "add":
            p.add_argument("--key", required=True)
            p.add_argument("--groups", required=True)
    m = commands.add_parser("model")
    actions = m.add_subparsers(dest="action", required=True)
    for action in ("pin", "pull"):
        p = actions.add_parser(action)
        p.add_argument("--manifest", default="model.lock.json")
        if action == "pin":
            p.add_argument("name")
            p.add_argument("--file", required=True)
            p.add_argument("--url", required=True)
        else:
            p.add_argument("names", nargs="*")
            p.add_argument("--cache", default="~/.cache/w3node/artifacts")
    args = parser.parse_args()
    try:
        if args.command == "users":
            from .onboarding import client
            client(args)
        elif args.command == "admin" and args.admin_action == "sync":
            from .onboarding import sync_server
            sync_server(args.config)
        elif args.command == "admin":
            users(args)
        else:
            model(args)
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
