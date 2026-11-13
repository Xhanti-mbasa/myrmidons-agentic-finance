import {
  GENESIS_HASH,
  hashLogEntry,
  type LogEntry,
} from "@shucamoxa/shared";
import type { AuditLogStore } from "./types";

export class MemoryAuditLog implements AuditLogStore {
  private readonly entries: LogEntry[] = [];
  private lastHash = GENESIS_HASH;
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  async append(raw: Omit<LogEntry, "seq" | "ts" | "prevHash" | "hash">): Promise<LogEntry> {
    const run = this.queue.then(async () => {
      this.seq += 1;
      const ts = new Date().toISOString();
      const prevHash = this.lastHash;
      const entryWithoutHash = {
        seq: this.seq,
        ts,
        prevHash,
        ...raw,
      };
      const hash = await hashLogEntry(prevHash, entryWithoutHash);
      const fullEntry: LogEntry = {
        ...entryWithoutHash,
        hash,
      };
      this.entries.push(fullEntry);
      this.lastHash = hash;
      return fullEntry;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  getLog(): readonly LogEntry[] {
    return this.entries;
  }

  getLastHash(): string {
    return this.lastHash;
  }
}
