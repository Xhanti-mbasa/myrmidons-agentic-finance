# Local MCP and interactive model chat

The chat host and MCP server run on your laptop. Qwen continues running in the
shared container. No port forwarding is needed for local MCP: it communicates
through stdin/stdout. The remote model still needs its existing SSH tunnel.
Ollama does not itself open MCP connections; the chat host discovers schemas,
sends them to Qwen and routes requested calls back to the local MCP server.

## Install once from main

On your own computer in this checkout:

```bash
git switch main
git pull --ff-only
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[chat]'
```

The extra installs the official MCP Python SDK and HTTP client at the same pinned
versions as the merged payment gateway. This is an editable install: subsequent
Python code edits in VS Code are used when you restart the command. On Windows,
activate `.venv\Scripts\Activate.ps1` in PowerShell instead.

## First test: MCP connected, zero tools

In terminal A on the laptop, keep the existing model connection open:

```bash
w3node users connect xhanti
```

That opens the container terminal and forwards local 11435 to Ollama's 11434.
Use your own provisioned username. In terminal B **on the laptop**, activate the
venv and run:

```bash
w3node chat
```

The default `config/mcp.local.json` launches a local sandbox subprocess and
performs a real MCP initialization and tools/list request. Expected startup:

```text
MCP sandbox: initialized; 0 tool(s)
Model: qwen3:1.7b-q4_K_M at http://127.0.0.1:11435
you>
```

Type `/tools` (it should say `none`), then `What is 7 times 8?` and press Enter.
You should get an `ai>` answer. No `tools` field is sent to Ollama while the MCP
server exposes none. This proves MCP discovery and ordinary model chat, not tool
execution. `/clear` clears the conversation; `/quit` closes chat and its local
MCP subprocess. No curl command is needed.

To chat without MCP at all, run `w3node chat --no-mcp`. If Ollama runs on your
laptop, use `--host http://127.0.0.1:11434` and no SSH tunnel. To use a different
installed model, pass `--model NAME`. This host accepts an Ollama origin, not a
`/v1` OpenAI-compatible base URL. First model loading may take a while on CPU.

## Second test: explicitly enable one harmless tool

Exit the first chat and run:

```bash
w3node chat --mcp config/mcp.demo.json
```

This selects the same sandbox with `--demo-tool`, exposing only `sandbox__echo`.
Ask: `Use sandbox__echo to echo exactly: W3Node is connected`.
If Qwen requests it, the terminal asks permission. Enter `y` to allow the call.
The trace must include `[tool call]` and `[tool result]`, followed by the model's
answer. The echo tool has no network/files/payment side effects. A model answer
that merely says it used the tool is not proof: look for the actual call/result
trace. Small models can fail to choose or format a call correctly; that is
different from a broken MCP connection.

For an explicit one-turn echo test without the per-call prompt:

```bash
w3node chat --mcp config/mcp.demo.json --allow-tool sandbox__echo --prompt 'Use sandbox__echo to echo exactly: W3Node is connected'
```

The allow option must name a discovered tool. Other tool calls require terminal
confirmation, and are denied in noninteractive mode. Unknown tools are never
executed, repeated identical calls within a turn are blocked, and the tool loop
has a six-step bound. No HTTP/tool request is retried automatically after failure.
Tool annotations are hints, not authorization. Tool output and arguments are
shown in the terminal; do not put secrets in prompts or copy private traces to Git.

## Edit MCP connections in VS Code

Open this repository in VS Code and edit `config/mcp.local.json`. Use the familiar
`mcpServers` structure with a local executable, argument array, optional `cwd`
(relative to the config file), and optional environment entries. `{python}` means
the same interpreter as the running CLI. No shell splitting/eval is used.

`src/w3node/sandbox_mcp.py` is the runnable empty/demo MCP server. Add your own
tools there or point the config at your own local stdio MCP process. Restart chat
to discover changed tools; live list-changed refresh is not implemented.
This first bridge supports stdio, not HTTP/SSE MCP endpoints, resources, prompts,
sampling, elicitation or multimodal tool output. Text/JSON tool output is the
supported initial path. Do not assume protocol support beyond tool discovery/call.

The merged `mcp_gateway/server.py` is a separate payment-backend adapter with five
tools. It is not enabled by the default config. Its proposed backend contract is
different from the existing TypeScript agent's backend client; they are not
silently interchangeable. See `mcp_gateway/README.md` before any integration.
`config/mcp.payments.example.json` shows how to connect it locally later, with
backend credentials referenced as `${ENV_VARIABLE}` rather than committed values.
It needs a compatible sandbox backend; no real backend/payment call was tested
by this terminal demo. Keep confirmations and backend authorization in place.

To version your connection/code changes:

```bash
git switch -c feat/my-local-tools
# Edit in VS Code, then:
git add src/w3node/sandbox_mcp.py config/mcp.local.json
git commit -m 'Add local MCP tools'
git push -u origin feat/my-local-tools
```

## Edit model behaviour and import changed weights

Configuration, tool connections and weights are different artifacts. Edit
`model-profiles/qwen-dev.json` in VS Code to change the base model, system prompt
or inference parameters, then build an isolated development model name:

```bash
w3node model build w3node-xhanti-v1
w3node chat --model w3node-xhanti-v1
```

The build calls Ollama's create API over the existing tunnel and creates or
updates the named development model on that instance. It reuses the base model
already there; it does not download/copy its weights to your laptop. Development
names must begin `w3node-`, so the command won't overwrite `qwen3:1.7b-q4_K_M`.
Use a unique name per teammate/experiment; rebuilding an existing development name
updates it. The chat leaves the model's system prompt in effect unless you supply
an explicit `--system-file`. The tiny CPU instance should be used for one test at
a time; the CLI does not manage GPU scheduling or isolate model memory per user.

These changes do not train weights. To test an **already trained compatible GGUF**
checkpoint from your laptop:

```bash
w3node model build w3node-xhanti-weights-v1 --gguf /path/to/trained-model.gguf
w3node chat --model w3node-xhanti-weights-v1
```

The CLI hashes the local GGUF, checks whether that blob exists on the selected
Ollama server, uploads it only if missing and builds from it. Existing blob bytes
are reused. Ollama validates checkpoint compatibility at import time. This is
whole-file blob reuse, not tensor-level delta upload. This CLI does not implement
fine-tuning, direct tensor editing or LoRA merging; export those training results
to a supported GGUF before import. A fake GGUF used in tests only verifies API
flow; it is not evidence a particular trained checkpoint can load on this host.

Commit the profile/recipes and pinned artifact manifest, keep large binaries in
your model registry, and use the existing `w3node model pin/pull` commands for
reproducible file versions. A profile using a mutable model tag alone is not an
immutable weight pin. Never commit weight binaries, tokens, private keys or real
payment/customer data. Runtime builds themselves are not Git commits: push the
source profile/manifest changes separately through your normal branch/PR workflow.

## Verification and limits

```bash
python -m unittest discover -s tests -v
python -m unittest discover -s mcp_gateway -p 'test_*.py' -v
```

Integration tests start actual local SDK MCP subprocesses for zero-tool discovery
and echo execution, and run the full terminal CLI against a local scripted Ollama
HTTP fixture. Model-response logic and build APIs are simulated. They do not
prove that your remote Qwen generated a call, that a real GGUF loads, or that a
payment backend works. Run the two interactive tests above on your laptop for
the final live-model check. If chat cannot reach Ollama, check that terminal A
is still connected and port 11435 is free. MCP errors usually mean a bad command,
missing dependencies, or stdout output from the server that isn't MCP protocol.
