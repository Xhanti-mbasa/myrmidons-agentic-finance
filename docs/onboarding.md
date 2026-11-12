# One-command team onboarding

## Teammate flow

Once this PR is merged, install from `main` once. Until then, these changes remain
on the review branch; `main` does not contain this CLI yet. We are not merging it
automatically. No branch switch is needed for normal use after merge.

Requirements: Python 3.11+, OpenSSH client and (for automatic requests) GitHub CLI.
GitHub and Tailscale sign-in are individual, one-time interactive steps. The CLI
does not silently install system packages or join a tailnet under shared credentials.
For Windows use a Python environment with `ssh`, `ssh-keygen` and `gh` on PATH;
the `.venv/bin` commands below are for Linux/macOS (Windows: `.venv\\Scripts`).

```bash
git pull --ff-only
python3 -m venv .venv
.venv/bin/python -m pip install -e .
source .venv/bin/activate
gh auth login --hostname github.com
w3node users add johnson
```

`add` is now a CLIENT command. It refuses to run as root, in an SSH session, or on
`shucamoxa-dev`, avoiding the earlier mistake of generating a laptop key in the
container. It creates `~/.ssh/shucamoxa_johnson` only when absent and asks for a
passphrase locally through ssh-keygen. It reuses existing keys. It reads only the
public `.pub` file; it never uploads the private key.

The CLI prints a public key and writes an access request outside the checkout at
`~/.local/state/w3node/johnson/request.json`. With GitHub CLI authenticated, it
creates an `onboarding/<github-id>/<name>-<fingerprint>` branch containing only
`access/requests/NAME.json` and opens a PR against main. It doesn't switch your
checkout, stage other files, or push your working tree. If you cannot push to the
upstream repository, it creates/uses your GitHub fork. A newly created fork may
need time to populate; rerun the same command if GitHub is not ready yet.

If you cannot install/authenticate `gh` yet, use `--offline` and send the printed
public key or request file to the administrator. `add` also prints this manual
fallback when gh is missing. It does not claim that local key generation grants
server access.

After the server is configured, an eligible request is picked up at the next
scheduled run. Tailscale sends the invitation directly to the email that Xhanti
configured privately on the server. Install Tailscale, sign into your own account,
and accept that email invitation. Acceptance/sign-in still requires the user.

```bash
w3node users status johnson
w3node users connect johnson
```

`status` reports the GitHub PR state, not a verified server provisioning state.
An onboarding PR remains open as an audit/request record; do not merge it. Public
keys are public in this repository. No invitation URL or email address is posted
there. Private links are delivered via the Tailscale provider's email API instead.
If email isn't received, the administrator checks sync logs and device invitations.

`connect` runs OpenSSH with the local key, individual username and the local-only
Ollama tunnel. It displays the known server fingerprint and preserves OpenSSH's
host-key verification. While connected, local applications use:

* Ollama: `http://127.0.0.1:11435`
* OpenAI-compatible base: `http://127.0.0.1:11435/v1`

The endpoint is shared development Ollama, not an isolated model per user. This
does not add an MCP client or authorize real payment execution.

## What authorizes automatic access

A push alone does not authorize a person. The administrator privately preapproves
a mapping of Linux username to numeric GitHub user ID and Tailscale email. The
server trusts GitHub's PR author ID, not an identity declared in the JSON. The PR
must have only one correctly named request file, be open and non-draft against
main, and have its request branch in the author's own repository with maintainer
modification disabled. Files are fetched at the exact head commit SHA.

For non-owner teammates the CLI therefore uses a personal fork. If teammates
have upstream push permission, create requests from their personal forks instead
of the shared upstream repository. The client handles this automatically.
Repository administrators and owners of the request repository remain trusted:
they can edit requests in repositories they control. Do not share a GitHub login.
Do not give untrusted collaborators write access to the owner's request branches.

No request may supply a group, shell, command, home path, destination host, email
or invitation URL. All get the fixed developer role: `users,w3node-dev`, no sudo.
Root-installed code consumes strict JSON; it never executes or installs code from
the request branch. A changed key for an already provisioned member is rejected
for administrator review. Repeating an unchanged request reuses its key and invite.

## One-time server setup (administrator inside shucamoxa-dev)

The known container has Ubuntu 24.04, OpenSSH, Tailscale, Python and Ollama. Cam
and Xhanti already have working access. Keep your existing root administration
session available until the first automated account's login has been verified.
Install reviewed code in a root-owned tree outside `/workspace` and outside any
developer-writable virtualenv. Never run pip from a teammate's request checkout.

After merge, on the server:

```bash
git clone https://github.com/Xhanti-mbasa/myrmidons-agentic-finance.git /opt/w3node-source
# Review and check out a specific approved release commit before installing.
python3 -m venv /opt/w3node-admin
/opt/w3node-admin/bin/python -m pip install /opt/w3node-source
install -d -m 0755 /etc/w3node
install -d -m 0700 /var/lib/w3node
install -m 0600 /opt/w3node-source/config/server.example.json /etc/w3node/server.json
```

The group `w3node-dev` and shared workspace ACLs must already be established as
in the interactive setup. The worker requires the group; it doesn't recursively
change workspace permissions on every run. Cam remains an existing unmanaged
account; the sync refuses requests for `cam` and does not change his account.
The script-created Xhanti account has the managed marker, but it is left untouched
unless an explicitly approved request/policy entry is supplied for it.

Set `tailscale_device_id` to the node ID of **shucamoxa-dev**, not its Tailscale
IP or the Incus host's node ID. The worker verifies both the hostname and known
`100.83.89.75` address against the API before creating any device share.

Populate `members` in `/etc/w3node/server.json`, for example (replace values):

```json
{
  "johnson": {
    "github_id": 123456789,
    "tailscale_email": "johnson@example.com",
    "enabled": true
  }
}
```

Get each actual numeric GitHub ID with `gh api users/GITHUB_LOGIN --jq .id` and
verify who owns that account. The example ID/email are not real authorizations.
Empty `members` grants nobody access. No teammate usernames/IDs/emails are guessed.

Create `/etc/w3node/credentials.json` with mode 0600, root ownership, containing:

```json
{
  "github_token": "SET_PRIVATELY_ON_SERVER",
  "tailscale_api_token": "SET_PRIVATELY_ON_SERVER"
}
```

Do not paste tokens into chat, shell command arguments or the public repository.
Use a root text editor or a secret manager. GitHub credentials need repository/PR
read access and contents read access to the request forks. No GitHub write token
or CI secrets are required on this server. Public forks/requests are the supported
automatic path; a private request fork must be readable by this server credential.

The Tailscale credential must be a user-owned API access token able to create
device share invites for the container's owner, not a device auth key. OAuth
client-generated tokens cannot create these user-scoped device invites. Use an
appropriately authorized owner credential and track its expiry/rotation. Only
single-use shares with `allowExitNode=false` are requested. The tailnet access
policy and container firewall must permit SSH to this container, and incoming
connections must be enabled. The worker does not widen tailnet ACLs, share the
Incus host, expose Ollama publicly, or disable host-key verification.

This is an API integration with strict response checks, not a claim that these
credentials or a live invitation were tested in this workspace. Test the first
invite with an approved teammate before unattended operation.

Run once interactively:

```bash
/opt/w3node-admin/bin/w3node admin sync
```

It creates staged, expired managed accounts, writes root-owned public keys under
`/etc/w3node/authorized_keys/`, extends the known SSH snippet while preserving
Cam's allowlist and forwarding/password restrictions, tests/reloads SSH, verifies
effective key-only PAM configuration, and then activates the account. Failed
provisioning leaves new accounts staged or retryable. Invitation failure is
recorded as incomplete and retried; successful requests are not reprovisioned on
every run. API calls have timeouts and response-size limits; the whole job is
bounded by the scheduler's 50-second timeout.

Enable ONE scheduler. Recommended systemd timer:

```bash
install -m 0644 /opt/w3node-source/deploy/w3node-sync.service /etc/systemd/system/
install -m 0644 /opt/w3node-source/deploy/w3node-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now w3node-sync.timer
journalctl -u w3node-sync.service -n 50
```

Or install `deploy/w3node-sync.cron` in `/etc/cron.d/w3node-sync` (0644, root-owned)
on a server with cron already installed/enabled. Add normal log rotation for
`/var/log/w3node-sync.log`. Do not enable both. Both are finite jobs protected by
a process lock; there is no custom always-running worker. Cron is time-triggered,
not Git-push-triggered; each scheduled check still uses CPU, network and API quota.
The worker scans at most 500 open PRs per run, oldest first; archive old onboarding
PRs after successful provisioning so they do not fill the queue.

## Removing access and operational limits

Set a provisioned member's `enabled` to false (or remove the member from policy).
The next sync disables that managed Linux account, clears supplementary groups
and terminates its processes; its home is retained. It records a revocation
tombstone so old requests cannot automatically reactivate the member. Revocation
of accepted Tailscale device shares, independent API tokens and other accounts
remains an administrator action in their corresponding services. This release
does not claim to revoke accepted Tailscale shares automatically.

The low-level emergency command is `w3node admin users remove NAME`. Also disable
the member in policy; sync skips already processed requests rather than silently
reactivating them. To restore a revoked member or rotate a key, review root-owned
state, managed key file and account expiry explicitly. Never reset these based
solely on a repeated request. If GitHub/Tailscale is unreachable, local grants
already made persist; new requests fail closed and retry on later runs. Policy
revocations run before network fetches but still require valid local credentials
configuration. Monitor failed service runs, expired tokens and invitation status.

## Tests

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Tests mock the privileged OS and remote API boundaries; local OpenSSH key
generation is tested with temporary passphrase-free test keys. No real account,
Tailscale invitation, GitHub access request or scheduler is activated by tests.
