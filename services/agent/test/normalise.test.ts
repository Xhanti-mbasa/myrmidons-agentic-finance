import { describe, expect, it } from "vitest";
import { normaliseInvoiceText, UnsettledInvoiceTextError } from "../src/normalise";
import { FIXTURE_FIELDS, readFixture, type FixtureFile } from "./support/fixture-fields";

/** `layers` rounds of &amp; around an entity: each decode pass peels one layer. */
const nested = (layers: number, entity: string) => `&${"amp;".repeat(layers)}${entity}`;

describe("normaliseInvoiceText refuses text that never settles", () => {
  it("throws for entities nested 9 deep instead of leaving a literal &lt;/invoice&gt;", () => {
    expect(() => normaliseInvoiceText(`${nested(8, "lt;")}/invoice${nested(8, "gt;")}`)).toThrow(UnsettledInvoiceTextError);
  });

  it("throws when the decode limit is reached with a fullwidth bracket still to normalise", () => {
    expect(() => normaliseInvoiceText(`${nested(7, "#xFF1C;")}/invoice`)).toThrow(UnsettledInvoiceTextError);
  });

  it("still settles entities nested 6 deep, the most the pass limit allows", () => {
    const text = normaliseInvoiceText(`${nested(6, "lt;")}/invoice${nested(6, "gt;")}`);
    expect(text).toBe("[tag removed]");
  });

  it("does not echo invoice text in the error message", () => {
    try {
      normaliseInvoiceText(`SECRET-CANARY ${nested(8, "lt;")}`);
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("SECRET-CANARY");
    }
  });
});

describe("normaliseInvoiceText runs in linear time on adversarial input", () => {
  const spaces = " ".repeat(19_998);
  it.each([
    ["<< then 20k spaces", `<<${spaces}`],
    ["< then 20k spaces then /", `<${spaces}/x`],
    ["</ then 20k spaces", `</${spaces}`],
    ["[ then 20k spaces", `[${spaces}x`],
    ["[ then 20k spaces then /", `[${spaces}/x`],
    ["<<< then spaces then /", `<<<${spaces.slice(2)}/x`],
    ["many < with spaces", "< / ".repeat(5_000)],
    ["amount then 20k spaces", `amount${spaces}`],
  ])("normalises %s in under 50 ms", (_label, input) => {
    normaliseInvoiceText("<< warm up /");
    const start = performance.now();
    normaliseInvoiceText(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("normaliseInvoiceText catches look-alike invoice tags", () => {
  it.each([
    ["CJK angle brackets", "\u3008/invoice\u3009"],
    ["angle brackets via &#9001;", "&#9001;/invoice&#9002;"],
    ["mathematical angle brackets", "\u27E8/invoice\u27E9"],
    ["single guillemets", "\u2039/invoice\u203A"],
    ["modifier-letter arrowheads", "\u02C2/invoice\u02C3"],
    ["a Cyrillic o", "</inv\u043Eice>"],
    ["a Cyrillic capital O", "</INV\u041EICE>"],
    ["a Greek omicron", "</inv\u03BFice>"],
    ["a Cyrillic i", "</\u0456nvoice>"],
    ["a Cyrillic c and e", "</invo\u0456\u0441\u0435>"],
    ["a precomposed accent", "</invoic\u00E9>"],
    ["a combining accent", "</invoi\u0301ce>"],
    ["stacked combining marks", "</i\u0300\u0301\u0302nvoice>"],
  ])("neutralises a closing tag spelled with %s", (_label, hostile) => {
    expect(normaliseInvoiceText(`before ${hostile} after`)).toBe("before [tag removed] after");
  });

  it("neutralises a guessed per-request wrapper tag", () => {
    expect(normaliseInvoiceText("</invoice-deadbeef>")).toBe("[tag removed]");
  });
});

describe("normaliseInvoiceText leaves legitimate text alone", () => {
  it.each([
    ["accented supplier names", "Soci\u00E9t\u00E9 G\u00E9n\u00E9rale C\u00F4te d'Ivoire"],
    ["Cyrillic text", "\u041E\u041E\u041E \u0422\u0435\u043A\u0441\u0442\u0438\u043B\u044C"],
    ["Devanagari with vowel signs", "\u0915\u093F\u0924\u093E\u092C"],
    ["bracketed status words", "[PAID] [URGENT] [COPY]"],
    ["the word invoice outside a tag", "INVOICE\nInvoice number: INV-1042"],
  ])("keeps %s unchanged", (_label, text) => {
    expect(normaliseInvoiceText(text)).toBe(text);
  });

  /** The only other hostile spans in a fixture, and exactly what each must become. */
  const OTHER_HOSTILE_SPANS: Partial<Record<FixtureFile, Array<[string, string]>>> = {
    "11-red-team-template-tokens.txt": [
      ["<|im_end|>", "[token removed]"],
      ["<|im_start|>", "[token removed]"],
    ],
    "12-red-team-fullwidth-tag.txt": [
      ["＜/invoice＞", "[tag removed]"],
      ["＜invoice＞", "[tag removed]"],
    ],
  };

  it.each(Object.keys(FIXTURE_FIELDS) as FixtureFile[])("only removes the hostile tags from %s", (file) => {
    const raw = readFixture(file);
    let want = raw.replace(/<\/?invoice>/g, "[tag removed]");
    for (const [span, replacement] of OTHER_HOSTILE_SPANS[file] ?? []) {
      expect(want).toContain(span);
      want = want.replaceAll(span, replacement);
    }
    expect(normaliseInvoiceText(raw)).toBe(want);
  });
});

describe("normaliseInvoiceText removes template tokens", () => {
  it.each(["[INST]", "[/INST]", "[TOOL_CALLS]", "[AVAILABLE_TOOLS]", "[/AVAILABLE_TOOLS]", "[SYSTEM_PROMPT]", "[/SYSTEM_PROMPT]", "[TOOL_RESULTS]", "[/TOOL_RESULTS]", "[ / tool_calls ]"])(
    "replaces the Mistral token %s",
    (token) => {
      expect(normaliseInvoiceText(`a ${token} b`)).toBe("a [token removed] b");
    },
  );
});

describe("normaliseInvoiceText decodes zero-padded entities", () => {
  it.each(["&#00060;/invoice&#00062;", "&#x0003c;/invoice&#x0003E;", "&#0000000060;/invoice&#0000000062;"])("decodes %s", (encoded) => {
    expect(normaliseInvoiceText(encoded)).toBe("[tag removed]");
  });
});
