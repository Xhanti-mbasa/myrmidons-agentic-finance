import argparse
import base64
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from w3node import onboarding as flow


KEY = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + bytes(range(32))).decode()
OTHER_KEY = "ssh-ed25519 " + base64.b64encode(b"\0\0\0\x0bssh-ed25519\0\0\0\x20" + b"x" * 32).decode()


def fixtures():
    request = {"schema_version": 1, "username": "johnson", "public_key": KEY}
    policy = {"members": {"johnson": {"github_id": 42, "enabled": True,
                                       "tailscale_email": "johnson@example.com"}}, "tailscale_device_id": "nExample"}
    pr = {"state": "open", "draft": False, "number": 8, "maintainer_can_modify": False,
          "user": {"id": 42}, "base": {"ref": "main", "repo": {"full_name": flow.REPO}},
          "head": {"ref": "onboarding/42/johnson-key", "sha": "a" * 40,
                   "repo": {"full_name": "johnson/myrmidons-agentic-finance", "owner": {"id": 42}}}}
    files = [{"filename": "access/requests/johnson.json", "status": "added"}]
    return request, policy, pr, files


class RequestValidation(unittest.TestCase):
    def test_valid_preapproved_actor(self):
        request, policy, pr, files = fixtures()
        self.assertEqual(flow.checked_request(pr, files, json.dumps(request), policy), request)

    def test_cannot_claim_other_github_identity(self):
        request, policy, pr, files = fixtures()
        pr["user"]["id"] = 999
        with self.assertRaises(ValueError):
            flow.checked_request(pr, files, json.dumps(request), policy)

    def test_disabled_identity_cannot_replay_request(self):
        request, policy, pr, files = fixtures()
        policy["members"]["johnson"]["enabled"] = False
        with self.assertRaises(ValueError):
            flow.checked_request(pr, files, json.dumps(request), policy)

    def test_request_cannot_choose_privileges_or_email(self):
        for field in ("groups", "shell", "command", "tailscale_email", "home", "inviteUrl"):
            request, policy, pr, files = fixtures()
            request[field] = "attacker-controlled"
            with self.assertRaises(ValueError):
                flow.checked_request(pr, files, json.dumps(request), policy)

    def test_request_cannot_include_code_or_another_members_file(self):
        request, policy, pr, files = fixtures()
        for changed in [files + [{"filename": "src/payload.py", "status": "added"}],
                        [{"filename": "access/requests/cam.json", "status": "added"}]]:
            with self.assertRaises(ValueError):
                flow.checked_request(pr, changed, json.dumps(request), policy)

    def test_shared_repository_or_editable_head_rejected(self):
        request, policy, pr, files = fixtures()
        for change in ("owner", "editable"):
            altered = copy.deepcopy(pr)
            if change == "owner":
                altered["head"]["repo"]["owner"]["id"] = 999
            else:
                altered["maintainer_can_modify"] = True
            with self.assertRaises(ValueError):
                flow.checked_request(altered, files, json.dumps(request), policy)

    def test_key_options_multiline_and_invalid_encoding_rejected(self):
        for key in ['command="id" ' + KEY, KEY + "\n" + KEY, "ssh-ed25519 YWJj", "ssh-rsa YWJj"]:
            with self.assertRaises(ValueError):
                flow.public_key(key)

    def test_reserved_or_injected_username_rejected(self):
        for name in ["root", "cam", "ollama", "../johnson", "johnson;id", "--system"]:
            with self.assertRaises(ValueError):
                flow.username(name)


class LocalOnboarding(unittest.TestCase):
    @unittest.skipUnless(shutil.which("ssh-keygen"), "OpenSSH client required")
    def test_existing_real_local_key_reused_without_private_key_upload(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            (home / ".ssh").mkdir()
            key = home / ".ssh/shucamoxa_johnson"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
            before = key.read_bytes()
            with patch.object(flow.Path, "home", return_value=home), patch.object(flow.os, "geteuid", return_value=1000), patch.object(flow.socket, "gethostname", return_value="my-laptop"), patch.dict(os.environ, {}, clear=True), patch.object(flow, "run") as run:
                request, state = flow.prepare("johnson")
                flow.prepare("johnson")
                run.assert_not_called()
            self.assertEqual(key.read_bytes(), before)
            self.assertEqual(set(request), {"schema_version", "username", "public_key"})
            self.assertNotIn("PRIVATE", (state / "request.json").read_text())

    def test_server_and_ssh_sessions_refused(self):
        with patch.object(flow.os, "geteuid", return_value=0):
            with self.assertRaises(ValueError):
                flow.prepare("johnson")
        with patch.object(flow.os, "geteuid", return_value=1000), patch.object(flow.socket, "gethostname", return_value="laptop"), patch.dict(os.environ, {"SSH_CONNECTION": "remote session"}):
            with self.assertRaises(ValueError):
                flow.prepare("johnson")

    def test_submission_builds_only_json_request_and_uses_personal_fork(self):
        request, _, _, _ = fixtures()
        calls = []
        def fake(path, method="GET", payload=None):
            calls.append((path, method, payload))
            if path == "user": return {"id": 42, "login": "johnson"}
            if path == f"repos/{flow.REPO}": return {"owner": {"id": 1}, "permissions": {"push": True}}
            if path.endswith("/forks"): return {"full_name": "johnson/myrmidons-agentic-finance"}
            if "/git/ref/heads/" in path: return {"object": {"sha": "a" * 40}}
            if "/git/matching-refs/" in path: return []
            if method == "GET" and "/git/commits/" in path: return {"tree": {"sha": "b" * 40}}
            if path.endswith("/git/trees"): return {"sha": "c" * 40}
            if path.endswith("/git/commits"): return {"sha": "d" * 40}
            if path.endswith("/git/refs"): return {}
            if "/pulls?" in path: return []
            if path.endswith("/pulls"): return {"number": 8, "html_url": "https://github.com/example/pull/8"}
            raise AssertionError(path)
        with tempfile.TemporaryDirectory() as folder, patch.object(flow, "gh", side_effect=fake), patch.object(flow.shutil, "which", return_value="/usr/bin/gh"):
            flow.submit(request, Path(folder))
        tree = next(payload for path, method, payload in calls if path.endswith("/git/trees"))
        self.assertEqual(len(tree["tree"]), 1)
        self.assertEqual(json.loads(tree["tree"][0]["content"]), request)
        pr = next(payload for path, method, payload in calls if path.endswith("/pulls"))
        self.assertFalse(pr["maintainer_can_modify"])
        self.assertTrue(pr["head"].startswith("johnson:onboarding/"))

    def test_receipt_prevents_duplicate_requests(self):
        request, _, _, _ = fixtures()
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder)
            (state / "receipt.json").write_text(json.dumps({"pr": 8, "fingerprint": flow.fingerprint(KEY)[:16]}))
            def fake(path, method="GET", payload=None):
                if path == "user": return {"id": 42}
                if path.endswith("/pulls/8"): return {"state": "open", "html_url": "https://github.com/example/pull/8"}
                raise AssertionError("Unexpected mutation: " + path)
            with patch.object(flow, "gh", side_effect=fake), patch.object(flow.shutil, "which", return_value="/usr/bin/gh"):
                flow.submit(request, state)


class InvitationTests(unittest.TestCase):
    def setUp(self):
        _, self.policy, _, _ = fixtures()
        self.member = self.policy["members"]["johnson"]
        self.device = {"hostname": flow.SERVER_NAME, "addresses": [flow.HOST]}

    def test_single_use_email_invitation_only_for_known_device(self):
        api = Mock()
        api.call.side_effect = [self.device, [], [{"id": "invite1", "inviteUrl": "PRIVATE"}]]
        self.assertEqual(flow.ensure_invite(api, self.policy, self.member, {}), "invite1")
        self.assertEqual(api.call.call_args.args, ("/device/nExample/device-invites", "POST", [{
            "multiUse": False, "allowExitNode": False, "email": "johnson@example.com"}]))

    def test_host_cannot_be_accidentally_shared(self):
        api = Mock()
        api.call.return_value = {"hostname": "incus-host", "addresses": ["100.70.230.110"]}
        with self.assertRaises(ValueError):
            flow.ensure_invite(api, self.policy, self.member, {})
        self.assertEqual(api.call.call_count, 1)

    def test_retries_reuse_invite_after_partial_failure(self):
        api = Mock()
        api.call.side_effect = [self.device, [{"id": "invite1", "email": "johnson@example.com"}]]
        self.assertEqual(flow.ensure_invite(api, self.policy, self.member, {}), "invite1")
        self.assertEqual(api.call.call_count, 2)

    def test_missing_previous_invite_not_recreated(self):
        api = Mock()
        api.call.side_effect = [self.device, []]
        with self.assertRaises(ValueError):
            flow.ensure_invite(api, self.policy, self.member, {"invite_id": "old"})
        self.assertEqual(api.call.call_count, 2)


class ServerSafety(unittest.TestCase):
    def test_new_account_stays_expired_if_ssh_configuration_fails(self):
        request, _, _, _ = fixtures()
        with tempfile.TemporaryDirectory() as folder:
            keys = Path(folder) / "authorized_keys"
            real_path, real_stat = Path, Path.stat
            def mapped(value):
                return keys if str(value) == "/etc/w3node/authorized_keys" else real_path(value)
            def root_stat(value, *args, **kwargs):
                actual = real_stat(value, *args, **kwargs)
                return SimpleNamespace(st_uid=0, st_mode=actual.st_mode) if value == keys else actual
            with patch.object(flow, "Path", side_effect=mapped), patch.object(Path, "stat", root_stat), patch.object(flow, "root_directory"), patch.object(flow, "account", return_value=None), patch.object(flow, "run") as run, patch.object(flow, "ssh_config", side_effect=ValueError("invalid SSH configuration")):
                with self.assertRaises(ValueError):
                    flow.provision(request, {})
                create = run.call_args_list[0].args
                self.assertEqual(create[create.index("--expiredate") + 1], "1")
                self.assertEqual(create[create.index("--shell") + 1], "/usr/sbin/nologin")
                self.assertFalse(any("/bin/bash" in call.args for call in run.call_args_list))
            self.assertEqual((keys / "johnson").read_text().strip(), KEY)

    def test_key_rotation_refused_before_system_changes(self):
        request, _, _, _ = fixtures()
        user = argparse.Namespace(pw_gecos=flow.MARKER, pw_uid=1002)
        with patch.object(flow, "account", return_value=user), patch.object(flow, "run") as run:
            with self.assertRaisesRegex(ValueError, "rotation"):
                flow.provision(request, {"fingerprint": flow.fingerprint(OTHER_KEY)})
            run.assert_not_called()

    def test_existing_unmanaged_account_never_adopted(self):
        request, _, _, _ = fixtures()
        user = argparse.Namespace(pw_gecos="Existing user", pw_uid=1002)
        with patch.object(flow, "account", return_value=user), patch.object(flow, "run") as run:
            with self.assertRaisesRegex(ValueError, "unmanaged"):
                flow.provision(request, {})
            run.assert_not_called()

    def test_unsafe_root_configuration_path_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "server.json"
            path.write_text("{}")
            path.chmod(0o600)
            # /tmp is writable to other users; a root worker must reject this path.
            with self.assertRaises(ValueError):
                flow.root_file(path)

    def test_ssh_validation_failure_restores_original_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "00-shucamoxa.conf"
            original = "AllowUsers cam xhanti\nPasswordAuthentication no\nAllowTcpForwarding local\nPermitOpen 127.0.0.1:11434\n"
            path.write_text(original)
            path.chmod(0o644)
            real_path = Path
            real_stat = Path.stat
            def mapped(value):
                return path if str(value) == "/etc/ssh/sshd_config.d/00-shucamoxa.conf" else real_path(value)
            def root_stat(value, *args, **kwargs):
                actual = real_stat(value, *args, **kwargs)
                return SimpleNamespace(st_uid=0, st_mode=actual.st_mode) if value == path else actual
            with patch.object(flow, "Path", side_effect=mapped), patch.object(Path, "stat", root_stat), patch.object(flow, "run", side_effect=[subprocess.CalledProcessError(1, "sshd"), Mock(), Mock()]):
                with self.assertRaises(subprocess.CalledProcessError):
                    flow.ssh_config("johnson")
            self.assertEqual(path.read_text(), original)

    def test_sync_provisions_exact_revision_once_and_revokes_disabled_member(self):
        request, policy, pr, files = fixtures()
        policy["credentials_file"] = "/etc/w3node/credentials.json"
        github, tailscale = Mock(), Mock()
        paths = []
        def api(path, method="GET", payload=None):
            paths.append(path)
            if "/pulls?" in path: return [pr]
            if path.endswith("/pulls/8"): return pr
            if "/files?" in path: return files
            if "/contents/" in path:
                self.assertTrue(path.endswith("?ref=" + "a" * 40))
                return {"content": base64.b64encode(json.dumps(request).encode()).decode()}
            raise AssertionError(path)
        github.call.side_effect = api
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            credentials = root / "credentials.json"
            credentials.write_text(json.dumps({"github_token": "test-github", "tailscale_api_token": "test-tailscale"}))
            state_dir = root / "state"
            real_path, real_stat = Path, Path.stat
            def mapped(value):
                return state_dir if str(value) == "/var/lib/w3node" else real_path(value)
            def root_stat(value, *args, **kwargs):
                actual = real_stat(value, *args, **kwargs)
                return SimpleNamespace(st_uid=0, st_mode=actual.st_mode) if value == state_dir else actual
            with patch.object(flow, "load_policy", return_value=policy), patch.object(flow, "root_file", return_value=credentials), patch.object(flow, "root_directory"), patch.object(flow, "Path", side_effect=mapped), patch.object(Path, "stat", root_stat), patch.object(flow.os, "geteuid", return_value=0), patch.object(flow.socket, "gethostname", return_value=flow.SERVER_NAME), patch("grp.getgrnam"), patch.object(flow, "API", side_effect=[github, tailscale, github, tailscale, github, tailscale]), patch.object(flow, "provision") as provision, patch.object(flow, "ensure_invite", return_value="invite1") as invite, patch("w3node.cli.users") as revoke:
                flow.sync_server("/etc/w3node/server.json")
                flow.sync_server("/etc/w3node/server.json")
                provision.assert_called_once()
                invite.assert_called_once()
                policy["members"]["johnson"]["enabled"] = False
                flow.sync_server("/etc/w3node/server.json")
                revoke.assert_called_once()
                self.assertEqual(revoke.call_args.args[0].name, "johnson")
                self.assertTrue(json.loads((state_dir / "state.json").read_text())["johnson"]["revoked"])


if __name__ == "__main__":
    unittest.main()
