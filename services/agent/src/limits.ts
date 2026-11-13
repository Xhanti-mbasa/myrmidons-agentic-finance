/**
 * Time and size limits for one agent run (T10). If the model laptop sleeps or the backend hangs, the
 * run ends as needs_review naming the stage, instead of freezing. Every number is injectable so tests
 * use milliseconds instead of fake timers.
 */
export type RunLimits = {
  /** Any backend call except POST /payments. */
  backendMs: number;
  /** POST /payments, which waits for ledger validation. */
  paymentMs: number;
  /** One generateText call (extraction, or the whole planner loop). */
  modelMs: number;
  /** The whole processInvoice or chat run. */
  runMs: number;
  /** Largest backend response body read, in bytes. */
  maxBodyBytes: number;
  /** Most GET /log entries passed on to the model. */
  maxLogEntries: number;
};

export const DEFAULT_LIMITS: Readonly<RunLimits> = Object.freeze({
  backendMs: 10_000,
  paymentMs: 30_000,
  modelMs: 120_000,
  runMs: 300_000,
  maxBodyBytes: 262_144,
  maxLogEntries: 50,
});

/** Fills in defaults. A limit that is not a positive finite number is a startup error, not "no limit". */
export function resolveLimits(partial: Partial<RunLimits> = {}): RunLimits {
  const limits = { ...DEFAULT_LIMITS, ...partial };
  for (const [name, value] of Object.entries(limits)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new RangeError(`limits.${name} must be a positive number`);
  }
  return limits;
}

export class ResponseTooLarge extends Error {
  override name = "ResponseTooLarge";
}

/**
 * Reads a response body as text, refusing it once more than maxBytes have arrived. Never holds more
 * than maxBytes: a declared Content-Length over the limit is refused unread, and a streamed body is
 * cancelled at the first chunk that crosses it.
 */
export async function readBoundedText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new ResponseTooLarge();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ResponseTooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Settles with work, or rejects as soon as signal aborts, even if work ignores the signal. The
 * abandoned work keeps running; callers make sure it can't act afterwards (see RunGuard.signal).
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** Why a run stopped early: the first stage that ran out of time, or a payment with no clear answer. */
export type Stall = { stage: string; cause: "timeout" | "deadline" | "unclear"; ms: number };

/** What the backend client needs from a run: its signal, and a way to report a stalled call. */
export type RunControl = {
  readonly signal: AbortSignal;
  stall(stage: string, stageTimedOut: boolean, ms: number, payment: boolean): void;
  /** Call before sending POST /payments; call the returned function only once a valid PayResult has parsed. */
  paymentSent(): () => void;
  /** POST /payments got no answer it can trust (unreadable, off-contract, 5xx, network error): stop the run. */
  paymentUnclear(stage: string): void;
};

/**
 * One run's deadline. The first stall stops the whole run: signal aborts, so every later backend call
 * is refused unsent and every model call is cancelled, including work the run has stopped awaiting.
 */
export class RunGuard implements RunControl {
  readonly signal: AbortSignal;
  private readonly stop = new AbortController();
  private readonly deadline: AbortSignal;
  private first: Stall | null = null;
  private paymentCutOff = false;
  private paymentsInFlight = 0;

  constructor(readonly limits: RunLimits) {
    this.deadline = AbortSignal.timeout(limits.runMs);
    this.signal = AbortSignal.any([this.stop.signal, this.deadline]);
  }

  get stalled(): Stall | null {
    return this.first ?? (this.deadline.aborted ? { stage: "the run", cause: "deadline", ms: this.limits.runMs } : null);
  }

  /**
   * True if a POST /payments was cut off before answering: money may or may not have moved. Counted
   * synchronously, so it holds even when the run deadline is seen before the pay call's own catch runs.
   */
  get paymentOutcomeUnknown(): boolean {
    return this.paymentCutOff || (this.signal.aborted && this.paymentsInFlight > 0);
  }

  paymentSent(): () => void {
    this.paymentsInFlight++;
    let answered = false;
    return () => {
      if (!answered) this.paymentsInFlight--;
      answered = true;
    };
  }

  stall(stage: string, stageTimedOut: boolean, ms: number, payment = false): void {
    if (payment) this.paymentCutOff = true;
    this.first ??= stageTimedOut ? { stage, cause: "timeout", ms } : { stage, cause: "deadline", ms: this.limits.runMs };
    this.stop.abort(new StageTimeout(this.first));
  }

  paymentUnclear(stage: string): void {
    // Deliberate backup: the in-flight count already reports this pay as unknown (mutation-equivalent).
    this.paymentCutOff = true;
    this.first ??= { stage, cause: "unclear", ms: 0 };
    this.stop.abort(new StageTimeout(this.first));
  }

  /** Runs work under its own timeout and the run's deadline. If either fires, stops the run and throws. */
  async stage<T>(stage: string, ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeout = AbortSignal.timeout(ms);
    const signal = AbortSignal.any([this.signal, timeout]);
    try {
      return await raceAbort(work(signal), signal);
    } catch (error) {
      if (!signal.aborted) throw error;
      this.stall(stage, timeout.aborted && !this.signal.aborted, ms);
      throw new StageTimeout(this.stalled!);
    }
  }

  /** Awaits the run's body, giving up when the run is stopped. */
  within<T>(work: Promise<T>): Promise<T> {
    return raceAbort(work, this.signal);
  }
}

export class StageTimeout extends Error {
  override name = "StageTimeout";
  constructor(readonly stall: Stall) {
    super(describeStall(stall));
  }
}

export function describeStall(stall: Stall): string {
  if (stall.cause === "unclear") return `${stall.stage} gave no answer that could be trusted`;
  return stall.cause === "timeout"
    ? `${stall.stage} did not answer within ${duration(stall.ms)}`
    : `the ${duration(stall.ms)} run deadline passed${stall.stage === "the run" ? "" : ` during ${stall.stage}`}`;
}

function duration(ms: number): string {
  return ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`;
}

export const PAYMENT_OUTCOME_UNKNOWN =
  "The payment outcome is unknown: POST /payments gave no clear answer in time, so money may or may not have moved. It was not retried. Check the activity log before paying this invoice again.";
