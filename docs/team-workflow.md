# Team instance and model workflow

## What this implements

`w3node users add NAME` now starts onboarding on a teammate's computer.
See [onboarding](onboarding.md) for automated account creation and device invitations.
`w3node admin users` provides low-level SSH account administration on the instance.
`w3node model` pins and fetches selected immutable model files by SHA256, with a
local content-addressed cache. No cloud instance or model server is created.
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

## Version and selectively pull model changes

For each changed adapter/checkpoint/config file:

```bash
w3node model pin payments-adapter.safetensors --file ./checkpoints/adapter.safetensors --url https://YOUR-ARTIFACT-HOST/releases/v1/adapter.safetensors
git add model.lock.json
git commit -m 'Pin payments adapter v1'
git push
```

`pin` computes the checksum from the local file and updates the manifest. It does
not upload it. Upload those exact bytes to the URL using your storage provider's
tools before teammates pull. Use immutable release paths. URLs must be HTTPS and
must not contain embedded credentials or signed query strings. This initial
downloader supports URLs accessible without authentication only; do not make
private model weights public to accommodate it. For private/gated artifacts use
the registry's authenticated download tooling until an appropriate provider
adapter is configured. Keep credentials outside Git.

Teammates can then run:

```bash
git pull --ff-only
w3node model pull payments-adapter.safetensors
w3node model pull
```

The first command pulls only the named component. The second pulls all pinned
components. Each prints the verified cache path. Matching cached bytes are reused;
checksum mismatch, size mismatch and HTTPS downgrade redirects fail without
publishing partial downloads. Changing a component fetches that whole file; this
is file-level selection, not tensor-level or block-level binary delta transfer.

For a runnable build, pin the base model revision, tokenizer, model config, all
required shards, adapter and runtime/training dependency versions together.
An adapter depends on its compatible base model; arbitrary subsets of weight
shards generally cannot run independently. This CLI intentionally does not load,
merge, train or edit tensors: the correct build/serve command depends on the
actual training workflow. The running instance uses Ollama with
`qwen3:1.7b-q4_K_M`; training/adapter export is still a separate workflow.
Use a separate adapter and branch per experiment; evaluate changes before merge.
Rolling back the Git commit restores the old manifest and artifact selection.

## MCP and payment backend integration

`config/mcp.example.json` records server names, URLs and environment variable
names only. It is a project template, not an automatically connected MCP client.
The model's agent runtime must load it and implement the MCP client lifecycle,
tool schemas, authentication and authorization. The exact wiring is pending the
runtime name/version and the MCP servers' actual endpoints/auth methods.

Backend developers should test through the same development model endpoint,
using individual credentials and a sandbox payment backend. Keep payment tools
in test mode during integration; never commit payment secrets or real customer
data. Record evaluation inputs and expected tool behavior with each change.
The tools/integrity layer should validate tool arguments and authorize each
action independently of what the model asks for. Live payment execution belongs
in a separately reviewed integration, not this account/model CLI.

## Information needed to activate this on the real instance

* Instance provider, hostname and an existing authorized administrator session.
* Cam's Linux login, actual permissions and intended team group/role list.
* Each teammate's exact Linux login and public SSH key.
* Model ID, open-weight vs hosted API, base revision, runtime and artifact store.
* MCP endpoints/authentication and development model/payment sandbox endpoints.

No live accounts, instance permissions, MCP connections or model weights are
changed merely by installing this project.

## Validation

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Tests use temporary files and mocked system/network boundaries. They verify
artifact selection, cache reuse/corruption, failed-download cleanup, URL rules,
pinning, refusal to alter unmanaged accounts and the account revocation sequence.
No tests provision live accounts or download actual model weights.
