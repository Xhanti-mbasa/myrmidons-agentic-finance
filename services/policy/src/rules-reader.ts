import type { Rules } from "@shucamoxa/shared";

export interface RulesReader {
  getRules(): Promise<Rules> | Rules;
}

export type RulesReaderLike = RulesReader | (() => Promise<Rules> | Rules);

export async function readRules(reader: RulesReaderLike): Promise<Rules> {
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
