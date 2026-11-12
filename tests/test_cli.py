import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from w3node import cli


class Artifacts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.payload = b"adapter checkpoint"
        self.sha = hashlib.sha256(self.payload).hexdigest()
        self.lock = self.root / "model.lock.json"
        self.lock.write_text(json.dumps({"schema_version": 1, "components": {
            "adapter.safetensors": {"url": "https://example.org/adapter", "sha256": self.sha, "size": len(self.payload)},
            "base.safetensors": {"url": "https://example.org/base", "sha256": "0" * 64, "size": 123},
        }}))
        self.args = argparse.Namespace(action="pull", manifest=self.lock,
            names=["adapter.safetensors"], cache=self.root / "cache")

    def test_selected_component_and_verified_cache(self):
        with patch.object(cli.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(self.payload)
            cli.model(self.args)
            opener.return_value.open.assert_called_once_with("https://example.org/adapter", timeout=60)
        with patch.object(cli.urllib.request, "build_opener") as opener:
            cli.model(self.args)
            opener.return_value.open.assert_not_called()

    def test_corrupt_download_never_published(self):
        with patch.object(cli.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(b"x" * len(self.payload))
            with self.assertRaisesRegex(ValueError, "mismatch"):
                cli.model(self.args)
        self.assertEqual(list(self.args.cache.iterdir()), [])

    def test_oversize_download_cleaned(self):
        with patch.object(cli.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(self.payload * 2)
            with self.assertRaisesRegex(ValueError, "exceeds"):
                cli.model(self.args)
        self.assertEqual(list(self.args.cache.iterdir()), [])

    def test_corrupt_cache_refetched(self):
        self.args.cache.mkdir()
        (self.args.cache / self.sha).write_bytes(b"broken")
        with patch.object(cli.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = io.BytesIO(self.payload)
            cli.model(self.args)
        self.assertEqual((self.args.cache / self.sha).read_bytes(), self.payload)

    def test_unknown_component_does_not_download(self):
        self.args.names = ["missing"]
        with patch.object(cli.urllib.request, "build_opener") as opener:
            with self.assertRaisesRegex(ValueError, "Unknown"):
                cli.model(self.args)
            opener.assert_not_called()

    def test_reject_secret_urls_and_insecure_redirects(self):
        for url in ["http://example.org/a", "https://user:secret@example.org/a", "https://example.org/a?token=secret"]:
            with self.assertRaises(ValueError):
                cli.https_url(url)
        with self.assertRaises(ValueError):
            cli.HTTPSOnly().redirect_request(None, None, 302, "", {}, "http://example.org/a")

    def test_pin_matches_bytes(self):
        source = self.root / "adapter"
        source.write_bytes(self.payload)
        self.args.action = "pin"
        self.args.file = source
        self.args.url = "https://example.org/version2"
        self.args.name = "adapter.safetensors"
        cli.model(self.args)
        self.assertEqual(cli.manifest(self.lock)["components"][self.args.name]["sha256"], self.sha)


class UserSafety(unittest.TestCase):
    def test_invalid_username(self):
        for name in ["root;id", "--system", "../cam", "cam\nroot"]:
            with self.assertRaises(ValueError):
                cli.account(name)

    def test_refuse_existing_unmanaged_account(self):
        user = argparse.Namespace(pw_gecos="other", pw_uid=1001)
        with patch.object(cli, "account", return_value=user), patch.object(cli.os, "geteuid", return_value=0), patch("builtins.open", unittest.mock.mock_open()), patch("fcntl.flock"), patch.object(cli, "run") as run:
            with self.assertRaisesRegex(ValueError, "unmanaged"):
                cli.users(argparse.Namespace(action="remove", name="cam"))
            run.assert_not_called()

    def test_revocation_expires_account_and_terminates_processes(self):
        user = argparse.Namespace(pw_gecos=cli.MARKER, pw_uid=1002)
        with patch.object(cli, "account", return_value=user), patch.object(cli.os, "geteuid", return_value=0), patch.dict(cli.os.environ, {"SUDO_UID": "1001"}), patch("builtins.open", unittest.mock.mock_open()), patch("fcntl.flock"), patch.object(cli, "run") as run, patch.object(cli.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as processes:
            cli.users(argparse.Namespace(action="remove", name="johnson"))
            self.assertIn(unittest.mock.call("usermod", "--lock", "--expiredate", "1", "--shell", "/usr/sbin/nologin", "johnson"), run.call_args_list)
            processes.assert_called_once_with(["pkill", "-KILL", "-u", "1002"], check=False)


if __name__ == "__main__":
    unittest.main()
