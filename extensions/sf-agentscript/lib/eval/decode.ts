/* SPDX-License-Identifier: Apache-2.0 */
/**
 * HTML entity decoder for eval API responses.
 *
 * The Salesforce Evaluation API HTML-encodes values inside
 * `actual_value`, `expected_value`, `metricExplainability`, `agentResponse`,
 * and `invokedActions`. Without decoding, regression reports show literal
 * `&apos;`, `&quot;`, `&amp;`, `&rsquo;`, etc.
 *
 * Behavior: standard named + numeric refs are decoded by a small built-in
 * table; typographic punctuation (rsquo, ldquo, mdash, …) is preserved at its
 * proper Unicode codepoint rather than lossily folded to ASCII. The agent's
 * actual output uses curly quotes — we want the LLM to see exactly what
 * the user saw.
 */

const ENTITIES: Record<string, string> = {
  // Named refs the eval API actually emits
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // Typographic — preserved as Unicode (don't fold to ASCII)
  rsquo: "\u2019",
  lsquo: "\u2018",
  ldquo: "\u201C",
  rdquo: "\u201D",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  trade: "\u2122",
  copy: "\u00A9",
  reg: "\u00AE",
  euro: "\u20AC",
  pound: "\u00A3",
  yen: "\u00A5",
  cent: "\u00A2",
  times: "\u00D7",
  divide: "\u00F7",
  plusmn: "\u00B1",
  micro: "\u00B5",
  para: "\u00B6",
  sect: "\u00A7",
  bull: "\u2022",
  middot: "\u00B7",
  deg: "\u00B0",
  nbsp: " ",
  // Other common ones we may see
  "#92": "\\",
  "#39": "'",
};

const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z]+|#\d+);/g;

function decodeOne(name: string): string {
  // Numeric: &#NNN; or &#xNNN;
  if (name.startsWith("#")) {
    const isHex = name[1] === "x" || name[1] === "X";
    const num = parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    if (Number.isFinite(num) && num > 0 && num <= 0x10ffff) {
      try {
        return String.fromCodePoint(num);
      } catch {
        return `&${name};`;
      }
    }
    // Fall through to named lookup (covers &#92; / &#39; alias entries)
  }
  const v = ENTITIES[name];
  return v ?? `&${name};`;
}

export function decodeHtmlEntities(s: unknown): unknown {
  if (typeof s !== "string") return s;
  if (!s.includes("&")) return s;
  return s.replace(ENTITY_RE, (_, name: string) => decodeOne(name));
}

/**
 * Recursively decode every string in dicts/arrays. Returns a *new* structure;
 * the input is never mutated. Used to render the canonical
 * decoded-but-otherwise-untouched response for both the LLM and the on-disk
 * artifact.
 */
export function deepDecode<T = unknown>(obj: T): T {
  if (typeof obj === "string") return decodeHtmlEntities(obj) as T;
  if (Array.isArray(obj)) return obj.map((v) => deepDecode(v)) as unknown as T;
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = deepDecode(v);
    }
    return out as T;
  }
  return obj;
}
