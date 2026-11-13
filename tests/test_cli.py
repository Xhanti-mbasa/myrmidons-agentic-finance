import argparse
import subprocess
import unittest
from unittest.mock import patch

from w3node import cli


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
