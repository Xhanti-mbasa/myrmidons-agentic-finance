import type { Rules } from "@shucamoxa/shared";
import type { PolicyRules } from "./checks";

/** Rules as the policy reads them: the agent's shape, or the policy shape with supplier addresses. */
export type ReadableRules = Rules | PolicyRules;

export interface RulesReader {
  getRules(): Promise<ReadableRules> | ReadableRules;
}

export type RulesReaderLike = RulesReader | (() => Promise<ReadableRules> | ReadableRules);

export async function readRules(reader: RulesReaderLike): Promise<ReadableRules> {
  if (typeof reader === "function") {
    return await reader();
  }
  return await reader.getRules();
}

export class StaticRulesReader implements RulesReader {
  constructor(private readonly rules: Rules) {}

  getRules(): Rules {
    return this.rules;
  }
}
