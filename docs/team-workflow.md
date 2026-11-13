# Team instance onboarding workflow

## What this implements

`w3node users add NAME` now starts onboarding on a teammate's computer.
See [onboarding](onboarding.md) for automated account creation and device invitations.
`w3node admin users` provides low-level SSH account administration on the instance.
The legacy Python model pin/pull tools are retired. Use Open WebUI for agent/model configuration (see [Open WebUI](open-webui.md)).
There are no runtime Python dependencies. Python 3.11+ is required.

Git tracks code, prompts, MCP configuration templates, evaluation cases, training
recipes and `model.lock.json`. Store large base weights and adapters in a model
registry or object store. Commit the URL, size and checksum, not weight binaries.
Each teammate checks out a Git revision and gets the corresponding exact artifacts.

This works for open-weight models you are licensed to use. A hosted API model's
private weights cannot be downloaded or edited through this CLI. MCP integration
changes the agent's tools; it does not itself modify model weights.

## Installation

From a checkout of this repository:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/w3node --help
```

## Access matching Cam

An existing administrator runs these on the model instance. Replace `cam` with
his actual Linux login; use each person's own public SSH key, never a shared
private key or Cam's credentials.

```bash
.venv/bin/w3node admin users inspect cam
sudo -l -U cam
sudo /usr/sbin/sshd -T
```

`inspect` reports Linux groups and shell. It does not clone permissions.
The administrator must inspect sudo rules, SSH AllowUsers/AllowGroups, cloud IAM,
filesystem ACLs, container access and model-service authentication. Linux groups
alone do not prove equivalent access. `docker` and `sudo` can confer root power;
include them only if that is the intended, verified Cam-equivalent role.

The script uses standard OpenSSH `~/.ssh/authorized_keys` and Linux shadow account
expiry. Verify the effective SSH configuration (including Match blocks) has
UsePAM enabled, the default AuthorizedKeysFile includes this path, and key-only
accounts with locked passwords can sign in. This release does not support LDAP,
SSH certificates, alternate key backends, cloud-IAM provisioning or custom sudo
rules. Account revocation must be validated against the host configuration first.

Example after an administrator creates a shared development group and decides
it is the correct role:

```bash
sudo groupadd -f w3node-dev
sudo .venv/bin/w3node admin users add johnson --key /tmp/johnson.pub --groups w3node-dev
sudo .venv/bin/w3node admin users add trainer --key /tmp/trainer.pub --groups w3node-dev
```

Use the same explicit group list for all developers. The example group name is
a new development role, not a claim about Cam's current role. Set shared project
directory ownership/ACLs to the intended group separately. Adding an SSH account
does not grant GitHub access, model API credentials or access to payments services.

Test SSH login from a second terminal before ending the admin session. The CLI
does not replace keys or change pre-existing accounts; only accounts tagged by
this CLI can be revoked. Install the administrative copy in a root-owned path
before regular use (e.g. a root-owned venv under `/opt/w3node-admin`). Never grant
sudo execution of a CLI installed in a developer-writable checkout or venv.

```bash
sudo /opt/w3node-admin/bin/w3node admin users remove johnson
```

Removal locks and expires the managed account, changes its shell, clears its
supplementary groups and kills its running processes, including active training
jobs. Home files are retained; the CLI does not delete accounts. Independent
GitHub access, cloud roles, API tokens, MCP sessions and delegated credentials
must be revoked separately. Restoring a removed account requires administrator
review; `add` deliberately refuses all existing accounts.

## LLM configuration

Use [Open WebUI](open-webui.md) for custom model presets and PC-hosted inference. The TypeScript finance agent still uses its separate `MODEL_BASE_URL` / `MODEL_NAME` settings. Never store large weights or credentials in this repository.
