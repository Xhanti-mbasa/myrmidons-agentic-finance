import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const js = read("app.js");
const html = read("index.html");

describe("dashboard rendering (string checks on public/)", () => {
  it("never writes HTML from data: no innerHTML, outerHTML, insertAdjacentHTML, document.write or eval", () => {
    for (const sink of [/innerHTML/, /outerHTML/, /DOMParser/, /createContextualFragment/,/insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\s*\(/, /setAttribute\(\s*["'](on|style|srcdoc)/i, /\.src\s*=/]) {
      expect(js).not.toMatch(sink);
    }
  });

  it("puts every string on the page through textContent", () => {
    expect(js).toMatch(/\.textContent\s*=/);
    // The one text helper the renderers use; it never touches HTML.
    expect(js).toMatch(/function el\([^)]*\)\s*\{[\s\S]*?\.textContent = /);
  });

  it("links only to the XRPL Testnet explorer, and only after checking the URL", () => {
    const hrefs = js.match(/\.href\s*=[^;]+;/g) ?? [];
    expect(hrefs).toHaveLength(1);
    expect(js).toContain(String.raw`/^https:\/\/testnet\.xrpl\.org\/transactions\/[0-9A-F]{64}$/`);
    expect(js).toMatch(/if \(typeof row\.explorerUrl === "string" && EXPLORER_URL\.test\(row\.explorerUrl\)\)/);
    expect(js).toMatch(/rel = "noopener noreferrer"/);
  });

  it("has no inline script, inline style or external resource, so the CSP holds", () => {
    expect(html).not.toMatch(/<script(?![^>]*\bsrc="\/owner\/app\.js")[^>]*>/);
    expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i);
    expect(html + js).not.toMatch(/https?:\/\/(?!testnet\.xrpl\.org)/);
    expect(read("app.css")).not.toMatch(/@import|url\(\s*["']?https?:/);
  });
});
