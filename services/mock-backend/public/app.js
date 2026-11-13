// PayGuard owner dashboard. Vanilla JS, no build step, no external resources.
// Every string from the agent, an invoice or the log reaches the page through textContent (see el()),
// never as HTML. The only link it makes is to the XRPL Testnet explorer, after checking the URL.
"use strict";

const POLL_MS = 3000;
const EXPLORER_URL = /^https:\/\/testnet\.xrpl\.org\/transactions\/[0-9A-F]{64}$/;

const $ = (id) => document.getElementById(id);

/** Creates an element whose only content is plain text. */
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const money = (amount) => (amount === null || amount === undefined ? "" : `$${amount}`);

/** Decimal string to integer cents, for drawing the budget bar only. */
function cents(amount) {
  const [whole, frac = ""] = String(amount).split(".");
  return BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2));
}
function percent(part, whole) {
  if (whole <= 0n) return 0;
  const basisPoints = (part * 10000n) / whole;
  return Math.min(100, Number(basisPoints) / 100);
}

const EVENT_LABELS = {
  payment_settled: ["Paid", "paid"],
  policy_blocked: ["Blocked", "blocked"],
  payment_failed: ["Outcome unknown", "hold"],
  approval_requested: ["Awaiting owner", "hold"],
  approval_decided: ["Owner decision", ""],
  rules_changed: ["Limits changed", ""],
  kill_switch_on: ["Kill switch on", "blocked"],
  kill_switch_off: ["Kill switch off", ""],
};
const DECISION_LABELS = {
  paid: ["Paid", "paid"],
  blocked: ["Blocked", "blocked"],
  awaiting_owner: ["Awaiting owner", "hold"],
  needs_review: ["Needs review", "hold"],
};

// ---- Talking to the backend ----

let banner = { source: null };
function showBanner(source, message) {
  banner = { source };
  $("banner").textContent = message;
  $("banner").hidden = false;
}
function clearBanner(source) {
  if (banner.source !== source) return;
  banner = { source: null };
  $("banner").hidden = true;
}

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (response.status === 401 && path.startsWith("/owner/api/")) showLogin();
  return { status: response.status, ok: response.ok, data };
}

const errorOf = (result, fallback) => (result.data && typeof result.data.error === "string" ? result.data.error : fallback);

// ---- Views ----

let pollTimer = null;
function showLogin() {
  document.body.dataset.view = "login";
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  $("login-token").focus();
}
function showDashboard() {
  document.body.dataset.view = "dashboard";
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
}

// ---- Rendering ----

let killSwitchOn = false;

function render(state) {
  const { rules } = state;
  $("cap").textContent = money(rules.perPaymentCap);
  $("budget").textContent = money(rules.totalBudget);
  $("spent").textContent = money(rules.spent);
  $("reserved").textContent = money(rules.reserved);
  $("remaining").textContent = money(rules.remaining);
  $("period-start").textContent = rules.periodStart;
  const budget = cents(rules.totalBudget);
  $("bar-spent").style.width = `${percent(cents(rules.spent), budget)}%`;
  $("bar-reserved").style.width = `${percent(cents(rules.reserved), budget)}%`;
  $("budget-bar").setAttribute("aria-label", `Spent ${money(rules.spent)}, reserved ${money(rules.reserved)}, remaining ${money(rules.remaining)} of ${money(rules.totalBudget)}`);
  if (!$("limits-form").contains(document.activeElement)) {
    $("limit-cap").value = rules.perPaymentCap;
    $("limit-budget").value = rules.totalBudget;
  }

  renderKillSwitch(state.killSwitch);
  renderSuppliers(state.suppliers);
  renderApprovals(state.approvals);
  renderActivity(state.activity);
}

function renderKillSwitch(on) {
  killSwitchOn = on;
  const button = $("kill-switch");
  button.setAttribute("aria-checked", on ? "true" : "false");
  $("kill-state").textContent = on ? "Agent payment authority revoked" : "Agent may pay approved suppliers";
  $("revoked").hidden = !on;
  document.body.classList.toggle("revoked-on", on);
}

function renderSuppliers(suppliers) {
  const list = $("suppliers");
  clear(list);
  for (const supplier of suppliers) {
    const item = el("li");
    item.append(el("span", supplier.name), el("span", supplier.shortAddress, "code muted"));
    list.append(item);
  }
}

function renderApprovals(approvals) {
  const list = $("approvals");
  clear(list);
  $("approvals-empty").hidden = approvals.length > 0;
  for (const approval of approvals) {
    const item = el("li");
    const title = approval.kind === "payment"
      ? `Pay ${approval.supplierName ?? approval.supplierId} ${money(approval.amount)} for ${approval.invoiceNumber}`
      : `Add supplier ${approval.supplierName ?? "(unnamed)"} from ${approval.invoiceNumber}`;
    item.append(el("p", title, "approval-title"));
    if (approval.shortAddress) item.append(el("p", `Address on invoice: ${approval.shortAddress}`, "small muted code"));
    item.append(el("p", approval.reason, "small"));
    const actions = el("div", null, "actions");
    const approve = el("button", "Approve", "primary");
    const reject = el("button", "Reject", "reject");
    approve.type = "button";
    reject.type = "button";
    approve.addEventListener("click", () => decide(approval.approvalId, "approve", [approve, reject]));
    reject.addEventListener("click", () => decide(approval.approvalId, "reject", [approve, reject]));
    actions.append(approve, reject);
    item.append(actions, el("p", "Recorded in the log only: approving does not pay or add the supplier.", "small muted"));
    list.append(item);
  }
}

function ledgerCell(row) {
  const cell = el("td");
  if (typeof row.explorerUrl === "string" && EXPLORER_URL.test(row.explorerUrl)) {
    const link = el("a", "View on ledger");
    link.href = row.explorerUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    cell.append(link);
  } else if (row.txHash) {
    const hash = el("span", `Mock ${row.txHash.slice(0, 8)}…`, "code muted");
    hash.title = `Mock hash, not on any ledger: ${row.txHash}`;
    cell.append(hash);
  } else {
    cell.append(el("span", "", "muted"));
  }
  return cell;
}

function renderActivity(rows) {
  const body = $("activity");
  clear(body);
  $("activity-empty").hidden = rows.length > 0;
  for (const row of rows) {
    const [label, tone] = EVENT_LABELS[row.event] ?? [row.event, ""];
    const tr = el("tr");
    if (tone) tr.dataset.tone = tone;
    const when = el("td", new Date(row.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), "when");
    when.title = row.ts;
    tr.append(
      when,
      el("td", row.supplierName ?? row.supplierId ?? ""),
      el("td", money(row.amount), "num"),
      el("td", label),
      el("td", row.ruleCode ?? "", "code"),
      el("td", row.explanation, "explain"),
      ledgerCell(row),
    );
    body.append(tr);
  }
}

function renderResult(outcome) {
  const box = $("result");
  const [label, tone] = DECISION_LABELS[outcome.decision] ?? [outcome.decision, ""];
  box.dataset.decision = outcome.decision;
  $("result-decision").textContent = label;
  $("result-decision").dataset.tone = tone;
  $("result-rule").textContent = outcome.ruleCode ?? "no rule code";
  $("result-explanation").textContent = outcome.explanation;
  $("result-tx").textContent = outcome.txHash ? `Transaction ${outcome.txHash}. The ledger link is in Activity.` : "";
  const flags = $("result-flags");
  clear(flags);
  for (const flag of outcome.flags) flags.append(el("li", flag));
  const list = $("suspicious-list");
  clear(list);
  for (const passage of outcome.suspiciousText) list.append(el("li", passage));
  $("result-suspicious").hidden = outcome.suspiciousText.length === 0;
  box.hidden = false;
}

// ---- Actions ----

async function refresh() {
  let result;
  try {
    result = await api("GET", "/owner/api/state");
  } catch {
    showBanner("backend", "Can't reach the PayGuard backend. Retrying every 3 seconds.");
    return;
  }
  if (result.status === 401) return;
  if (!result.ok || !result.data) {
    showBanner("backend", `The backend answered ${result.status}. Retrying every 3 seconds.`);
    return;
  }
  clearBanner("backend");
  render(result.data);
}

async function decide(approvalId, decision, buttons) {
  for (const b of buttons) b.disabled = true;
  try {
    const result = await api("POST", `/owner/api/approvals/${encodeURIComponent(approvalId)}`, { decision });
    if (!result.ok) showBanner("action", errorOf(result, "The decision was not recorded."));
    else clearBanner("action");
  } catch {
    showBanner("backend", "Can't reach the PayGuard backend.");
  }
  refresh();
}

function wire() {
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("login-error").textContent = "";
    try {
      const result = await api("POST", "/owner/login", { token: $("login-token").value });
      $("login-token").value = "";
      if (result.ok) showDashboard();
      else $("login-error").textContent = result.status === 401 ? "That token isn't the owner token." : errorOf(result, "Sign-in failed.");
    } catch {
      $("login-error").textContent = "Can't reach the PayGuard backend.";
    }
  });

  $("logout-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("POST", "/owner/logout");
    } finally {
      showLogin();
    }
  });

  $("kill-switch").addEventListener("click", async () => {
    const button = $("kill-switch");
    button.disabled = true;
    try {
      const result = await api("POST", "/owner/api/kill-switch", { on: !killSwitchOn });
      if (result.ok && result.data) {
        renderKillSwitch(result.data.killSwitch);
        clearBanner("action");
      } else showBanner("action", errorOf(result, "The kill switch did not change."));
    } catch {
      showBanner("backend", "Can't reach the PayGuard backend. The kill switch did not change.");
    } finally {
      button.disabled = false;
      refresh();
    }
  });

  $("limits-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = $("limits-status");
    status.textContent = "";
    try {
      const result = await api("PUT", "/owner/api/limits", { perPaymentCap: $("limit-cap").value.trim(), totalBudget: $("limit-budget").value.trim() });
      status.textContent = result.ok ? "Limits saved." : errorOf(result, "The limits were not saved.");
      status.className = result.ok ? "small" : "small error-text";
    } catch {
      status.textContent = "Can't reach the PayGuard backend.";
      status.className = "small error-text";
    }
    document.activeElement?.blur?.();
    refresh();
  });

  for (const chip of document.querySelectorAll("[data-invoice]")) {
    chip.addEventListener("click", async () => {
      const id = chip.dataset.invoice;
      try {
        const result = await api("GET", `/owner/api/demo-invoices/${encodeURIComponent(id)}`);
        if (!result.ok || !result.data) return showBanner("action", errorOf(result, "That demo invoice couldn't be loaded."));
        $("invoice-text").value = result.data.text;
        for (const other of document.querySelectorAll("[data-invoice]")) other.setAttribute("aria-pressed", other === chip ? "true" : "false");
        clearBanner("action");
      } catch {
        showBanner("backend", "Can't reach the PayGuard backend.");
      }
    });
  }

  $("invoice-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = $("invoice-text").value;
    if (!text.trim()) return;
    const send = $("send-invoice");
    send.disabled = true;
    send.textContent = "Agent is working…";
    try {
      const result = await api("POST", "/owner/api/invoices", { text });
      if (result.ok && result.data) {
        renderResult(result.data.outcome);
        clearBanner("agent");
      } else if (result.status === 502 || result.status === 503 || result.status === 504) {
        showBanner("agent", `Agent unreachable: ${errorOf(result, "no answer")}`);
      } else {
        showBanner("agent", errorOf(result, `The invoice was not sent (HTTP ${result.status}).`));
      }
    } catch {
      showBanner("backend", "Can't reach the PayGuard backend. The invoice may not have been sent; check Activity.");
    } finally {
      send.disabled = false;
      send.textContent = "Send to agent";
      refresh();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  wire();
  if (document.body.dataset.view === "dashboard") showDashboard();
  else $("login-token").focus();
});
