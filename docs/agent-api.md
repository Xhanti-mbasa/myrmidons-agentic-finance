# Agent HTTP API (`@shucamoxa/agent`)

The Shucamoxa Agent HTTP service provides authenticated endpoints for automated invoice processing and streaming owner chat.

## 1. Authentication & Security Boundaries

- **Authentication**: All endpoints (except `GET /health`) require a Bearer token in the `Authorization` header:
  ```http
  Authorization: Bearer <AGENT_INBOUND_TOKEN>
  ```
  The token is validated using constant-time comparison (`timingSafeEqual`). Requests with missing, incorrect, un-prefixed, or mismatched tokens return HTTP `401 Unauthorized` with error code `unauthorized`.
- **Environment Isolation**: The agent service environment strictly forbids wallet seeds, private keys, or direct database credentials (enforced at startup by T09).
- **Redaction**: Wallet addresses (both classic base58 `r...` addresses and X-addresses `X...`/`T...`) are redacted to `[address hidden]`. Tool event streams never emit input arguments or raw tool results; only `ruleCode` and `refused` leave the service.

## 2. Limits & Guardrails

- **Payload Size**: Request bodies are capped at 1 MB (`MAX_REQUEST_BYTES = 1,048,576` bytes). Payloads exceeding this limit receive HTTP `413 Payload Too Large` with error code `payload_too_large`.
- **Serialization**: Execution is strictly serialized (`serially`). Only one task (invoice or chat run) executes at a time.
- **Invoice Limits**:
  - `invoiceId`: 1 to 64 ASCII alphanumeric characters, hyphens, and underscores (`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`).
  - `text`: 1 to 20,000 characters (`MAX_INVOICE_TEXT_CHARS`).
  - Duplicate in-flight invoice IDs receive HTTP `409 Conflict` with error code `invoice_in_flight`.
- **Chat Limits**:
  - `message`: 1 to 2,000 characters (`MAX_CHAT_MESSAGE_CHARS`). Messages outside this range receive HTTP `400 Bad Request` with error code `invalid_request`.
- **Timeouts & Abort**:
  - Model and backend calls are bounded by injected or default `RunLimits` (`modelMs`, `backendMs`, `paymentMs`, `runMs`).
  - Client disconnects propagate through the request `AbortSignal` (`c.req.raw.signal`), immediately halting model streaming and preventing subsequent tool invocations.

---

## 3. Endpoints

### 3.1 `POST /agent/invoices`

Processes raw invoice text through extraction, supplier resolution, mandate enforcement, and the tool-using planner.

- **Request Headers**:
  - `Authorization: Bearer <AGENT_INBOUND_TOKEN>`
  - `Content-Type: application/json`
- **Request Body** (`ProcessInvoiceRequest`):
  ```json
  {
    "invoiceId": "inv_20261113_001",
    "text": "Karoo Textiles (Pty) Ltd\nInvoice: INV-1042\nTotal: 30.00 USD\nCotton bolts"
  }
  ```
- **Response** (HTTP 200, `ProcessInvoiceResponse`):
  ```json
  {
    "outcome": {
      "invoiceNumber": "INV-1042",
      "decision": "paid",
      "ruleCode": "OK",
      "explanation": "Payment completed successfully.",
      "txHash": "A1B2C3D4E5F6",
      "flags": [],
      "suspiciousText": []
    },
    "explanation": {
      "decision": "paid",
      "ruleCode": "OK",
      "explanation": "Payment completed successfully.",
      "invoiceNumber": "INV-1042"
    }
  }
  ```

---

### 3.2 `POST /agent/chat`

Streaming owner chat interface. Executes the owner turn against chat tools under strict payment guards and streams real-time tool events, text deltas, deterministic summary, and termination events via Server-Sent Events (`text/event-stream`).

- **Request Headers**:
  - `Authorization: Bearer <AGENT_INBOUND_TOKEN>`
  - `Content-Type: application/json`
- **Request Body** (`ChatRequest`):
  ```json
  {
    "message": "Pay Karoo $30 now"
  }
  ```
- **Response Headers**:
  - `Content-Type: text/event-stream; charset=utf-8`
  - `Cache-Control: no-store`

#### SSE Event Specifications

Each event is formatted as standard Server-Sent Events:
```
event: <eventType>
data: <JSON payload>

```

##### 1. `tool`
Emitted immediately before a tool executes (`phase: "start"`) and immediately after it finishes (`phase: "end"`). Arguments and raw results are never included.
- **Payload Schema** (`ChatStreamToolEvent`):
  ```typescript
  {
    name: string;
    phase: "start" | "end";
    ok: boolean;
    refused?: boolean;
    ruleCode?: RuleCode;
  }
  ```
- **Example Start**:
  ```
  event: tool
  data: {"name":"find_supplier","phase":"start","ok":true}
  ```
- **Example End (Success)**:
  ```
  event: tool
  data: {"name":"pay","phase":"end","ok":true,"ruleCode":"OK"}
  ```
- **Example End (Refused by Policy / Guard)**:
  ```
  event: tool
  data: {"name":"pay","phase":"end","ok":false,"refused":true}
  ```

##### 2. `text`
Emitted for each chunk of model-generated prose.
- **Payload Schema** (`ChatStreamTextEvent`):
  ```typescript
  {
    delta: string;
  }
  ```
- **Example**:
  ```
  event: text
  data: {"delta":"Paid Karoo $30."}
  ```

##### 3. `summary`
Deterministic outcome constructed by code from verified backend state (not model text). Always emitted before `done`.
- **Payload Schema** (`ChatStreamSummaryEvent`):
  ```typescript
  {
    summary: string;
    payments: PayResult[];
  }
  ```
- **Example**:
  ```
  event: summary
  data: {"summary":"Paid 30.00 to sup_karoo, tx TXHASH1.","payments":[{"status":"settled","ruleCode":"OK","txHash":"TXHASH1","logId":"log_1"}]}
  ```

##### 4. `error`
Emitted if an unhandled error occurs during execution. Emits a generic fixed message; stack traces and provider internals are never revealed.
- **Payload Schema** (`ChatStreamErrorEvent`):
  ```typescript
  {
    message: string;
  }
  ```
- **Example**:
  ```
  event: error
  data: {"message":"The agent could not finish."}
  ```

##### 5. `done`
Emitted as the final event to signal completion of the stream.
- **Payload Schema** (`ChatStreamDoneEvent`):
  ```typescript
  {}
  ```
- **Example**:
  ```
  event: done
  data: {}
  ```

---

#### Complete Stream Example

Below is a complete SSE stream generated for `POST /agent/chat` with `{"message": "Pay Karoo $30 now"}`:

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store

event: tool
data: {"name":"find_supplier","phase":"start","ok":true}

event: tool
data: {"name":"find_supplier","phase":"end","ok":true}

event: tool
data: {"name":"get_rules","phase":"start","ok":true}

event: tool
data: {"name":"get_rules","phase":"end","ok":true}

event: tool
data: {"name":"pay","phase":"start","ok":true}

event: tool
data: {"name":"pay","phase":"end","ok":true,"ruleCode":"OK"}

event: text
data: {"delta":"Paid Karoo $30."}

event: summary
data: {"summary":"Paid 30.00 to sup_karoo, tx TXHASH1.","payments":[{"status":"settled","ruleCode":"OK","txHash":"TXHASH1","logId":"log_101"}]}

event: done
data: {}
```

#### Kill-Switch Behavior

When the kill switch is enabled (`killSwitch: true`), the planner model is never called. The endpoint immediately emits the deterministic summary followed by `done`:

```http
event: summary
data: {"summary":"Blocked: the owner has revoked the agent's payment authority.","payments":[]}

event: done
data: {}
```

---

### 3.3 `GET /v1/models`

`{"object":"list","data":[{"id":"payguard","object":"model","owned_by":"myrmidons"}]}`.

### 3.4 `POST /v1/chat/completions`

OpenAI-compatible (M05), so Open WebUI can point at the guarded agent instead of the raw model.

Request (`OpenAIChatRequest`): `model`, `messages[]` (role `system`, `developer`, `user` or `assistant`), optional
`stream`. Other OpenAI options (`temperature`, `top_p`, `stream_options`, ...) are ignored.

- **Only the last `user` message is used.** It goes to `ownerChat({ latestOwnerTurn })`. System, developer and assistant
  messages and earlier user turns are never read and never reach the model, so a client cannot widen a limit through
  a system prompt or a replayed history.
- The agent's tools are its own: `tools`, `tool_choice`, `functions`, `function_call` and `parallel_tool_calls` are
  refused whatever their value.

Refusals use OpenAI's error shape, `{"error":{"message","type","param":null,"code"}}`:

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_json` | the body is not JSON |
| 400 | `tools_not_supported` | the request carries any tool field |
| 400 | `unsupported_content` | any message's content is not plain text (image, file, audio, null) |
| 400 | `no_user_turn` | no user message, or the last one is blank |
| 400 | `turn_too_long` | the last user message is over 2,000 characters |
| 400 | `invalid_request` | anything else off-shape (no model, no messages, a `tool` role, ...) |
| 500 | `internal_error` | the turn failed before the backend acted; generic message, no stack |

Answers carry the agent's reply: the model's text followed by a code-built summary of what the backend actually did
(for example `Paid 30.00 to sup_karoo, tx <hash>.` or `No payment was made.`).

- `stream: false` (default): a `chat.completion` object with one choice, `finish_reason: "stop"`.
- `stream: true`: `text/event-stream` with three `data:` lines: one `chat.completion.chunk` holding the full reply, a
  chunk with an empty delta and `finish_reason: "stop"`, then `[DONE]`.

If a payment settled (or was sent, or an approval was asked) during the turn and something fails afterwards, the answer
is still 200 and says what happened, with the tx hash. A settled payment is never hidden behind an error.

The reply is built only after the queued run finishes, and the run does not watch the client connection, so a client
that disconnects cannot cancel a payment already sent to the backend.

### Try it

```sh
curl -s localhost:8790/v1/chat/completions \
  -H "Authorization: Bearer $AGENT_INBOUND_TOKEN" -H 'content-type: application/json' \
  -d '{"model":"payguard","messages":[{"role":"user","content":"How much budget is left?"}]}'
```
