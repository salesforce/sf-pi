/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Canvas body → markdown.
 *
 * Slack returns a canvas body only as the HTML document at the file's
 * `url_private_download`. `files.info` carries metadata and
 * `canvases.sections.lookup` returns bare section IDs, so neither can show
 * the text. This module turns that small, regular HTML (headings, paragraphs,
 * lists, tables, links, inline emphasis) into markdown the model can read.
 *
 * It is intentionally a narrow converter for Slack's canvas export, not a
 * general HTML parser: unknown tags are dropped and their text is kept.
 * Slack's export writes links as `<lnk>`, every line as `<p class="line">`
 * (code lines add `prettyprint`), and line breaks as `<br>`.
 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  deg: "°",
};

/** Link targets kept as markdown links; any other scheme keeps only its label. */
const SAFE_LINK_TARGET = /^(https?:|mailto:)/i;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const value =
        code[1] === "x" || code[1] === "X"
          ? Number.parseInt(code.slice(2), 16)
          : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 ? String.fromCodePoint(value) : match;
    }
    return ENTITY_MAP[code.toLowerCase()] ?? match;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Collapse spaces on each line and drop leading and trailing blank lines. */
function tidyLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function link(href: string, text: string): string {
  const label = text.replace(/\s+/g, " ").trim();
  if (!SAFE_LINK_TARGET.test(href.trim())) return label;
  return label ? `[${label}](${href.trim()})` : href.trim();
}

/** Inline tags that open a mark; their close tags end it. */
const INLINE_MARKS: Record<string, "**" | "_" | "`"> = {
  b: "**",
  strong: "**",
  i: "_",
  em: "_",
  code: "`",
};

/**
 * Text of an inline fragment, with links and emphasis kept as markdown and
 * `<br>` kept as a line break. One left-to-right pass over the tags keeps this
 * linear even when tags are left unclosed.
 */
function inline(html: string): string {
  const out: string[] = [];
  const open: Array<{ tag: string; at: number; href?: string }> = [];
  let pos = 0;
  for (const tag of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)) {
    out.push(html.slice(pos, tag.index).replace(/\s+/g, " "));
    pos = tag.index + tag[0].length;
    const closing = tag[1] === "/";
    const name = tag[2].toLowerCase();
    if (name === "br") {
      out.push("\n");
    } else if (name === "a" || name === "lnk") {
      if (!closing) {
        const href = /\bhref=["']([^"']+)["']/i.exec(tag[3])?.[1];
        open.push({ tag: name, at: out.length, href });
      } else {
        const index = lastOpen(open, name);
        if (index >= 0) {
          const [entry] = open.splice(index);
          const label = out.splice(entry.at).join("");
          out.push(entry.href ? link(entry.href, label) : label);
        }
      }
    } else if (INLINE_MARKS[name]) {
      if (!closing) {
        open.push({ tag: name, at: out.length });
      } else {
        const index = lastOpen(open, name);
        if (index >= 0) {
          const [entry] = open.splice(index);
          const body = out.splice(entry.at).join("");
          out.push(mark(INLINE_MARKS[name], body));
        }
      }
    }
  }
  out.push(html.slice(pos).replace(/\s+/g, " "));
  return tidyLines(decodeEntities(out.join("")));
}

/** Index of the innermost open tag named `name`, or -1. */
function lastOpen(open: ReadonlyArray<{ tag: string }>, name: string): number {
  for (let index = open.length - 1; index >= 0; index--) {
    if (open[index].tag === name) return index;
  }
  return -1;
}

function mark(marker: "**" | "_" | "`", body: string): string {
  const value = marker === "`" ? body.replace(/\s+/g, " ") : body.replace(/\s+/g, " ").trim();
  return value ? `${marker}${value}${marker}` : "";
}

/** Code text with `<br>` as line breaks and no markdown marks. */
function codeText(html: string): string {
  return decodeEntities(stripTags(html.replace(/<br\s*\/?>/gi, "\n"))).replace(/^\n+|\n+$/g, "");
}

function tableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) =>
      inline(cell[2].replace(/<\/p>\s*<p\b/gi, "</p> <p").replace(/<\/li>\s*<li\b/gi, "</li>; <li"))
        .replace(/\n+/g, " ")
        .replace(/\|/g, "\\|"),
    ),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return "";
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const lines = [`| ${pad(rows[0]).join(" | ")} |`, `|${" --- |".repeat(width)}`];
  for (const row of rows.slice(1)) lines.push(`| ${pad(row).join(" | ")} |`);
  return lines.join("\n");
}

/** Inner HTML of a list whose open tag ends at `openEnd`, balancing nested lists. */
function balancedList(html: string, openEnd: number): { inner: string; end: number } {
  const tags = /<(\/?)(?:ul|ol)\b[^>]*>/gi;
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0)
      return { inner: html.slice(openEnd, tag.index), end: tag.index + tag[0].length };
  }
  return { inner: html.slice(openEnd), end: html.length };
}

/** Top-level `<li>` bodies of a list, leaving nested lists inside their item. */
function listItems(listInner: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let start = -1;
  for (const tag of listInner.matchAll(/<(\/?)(li|ul|ol)\b[^>]*>/gi)) {
    const closing = tag[1] === "/";
    if (tag[2].toLowerCase() !== "li") {
      depth = Math.max(0, depth + (closing ? -1 : 1));
      continue;
    }
    if (depth !== 0) continue;
    if (!closing) {
      if (start >= 0) items.push(listInner.slice(start, tag.index));
      start = tag.index + tag[0].length;
    } else if (start >= 0) {
      items.push(listInner.slice(start, tag.index));
      start = -1;
    }
  }
  if (start >= 0) items.push(listInner.slice(start));
  // A list nested directly in a list, without an item around it, keeps its
  // text as one item rather than being dropped.
  if (items.length === 0 && /<(?:ul|ol)\b/i.test(listInner)) items.push(listInner);
  return items;
}

/** Deeper nesting is flattened into the deepest kept level; canvases nest far
 *  less, and a bound keeps hostile input from exhausting the stack. */
const MAX_LIST_DEPTH = 8;

function listToMarkdown(listInner: string, ordered: boolean, indent = "", depth = 0): string {
  const lines: string[] = [];
  let number = 0;
  for (const item of listItems(listInner)) {
    const nested: Array<{ inner: string; ordered: boolean }> = [];
    let own = "";
    let pos = 0;
    const opens = /<(ul|ol)\b[^>]*>/gi;
    for (let open = opens.exec(item); open; open = opens.exec(item)) {
      own += item.slice(pos, open.index) + " ";
      const list = balancedList(item, open.index + open[0].length);
      nested.push({ inner: list.inner, ordered: open[1].toLowerCase() === "ol" });
      pos = list.end;
      opens.lastIndex = list.end;
    }
    own += item.slice(pos);
    const text = inline(own).replace(/\n{2,}/g, "\n");
    if (!text && nested.length === 0) continue;
    const marker = ordered ? `${++number}.` : "-";
    const childIndent = indent + " ".repeat(marker.length + 1);
    if (text) {
      const [first, ...rest] = text.split("\n");
      lines.push(`${indent}${marker} ${first}`);
      for (const line of rest) lines.push(`${childIndent}${line}`);
    }
    for (const list of nested) {
      if (depth + 1 >= MAX_LIST_DEPTH) {
        const flat = inline(list.inner.replace(/<\/?(?:li|ul|ol)\b[^>]*>/gi, "<br>")).replace(
          /\n+/g,
          "; ",
        );
        if (flat) lines.push(`${childIndent}- ${flat}`);
        continue;
      }
      const sub = listToMarkdown(list.inner, list.ordered, childIndent, depth + 1);
      if (sub) lines.push(sub);
    }
  }
  return lines.join("\n");
}

const BLOCK_START = /<(h[1-6]|table|ul|ol|p|pre|blockquote)\b([^>]*)>/gi;

/** Convert a Slack canvas HTML export to markdown. */
export function canvasHtmlToMarkdown(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, "");

  const blocks: string[] = [];
  let codeBlock = -1;
  const push = (block: string, code = false) => {
    if (!block) return;
    if (code && codeBlock === blocks.length - 1 && codeBlock >= 0) {
      blocks[codeBlock] = blocks[codeBlock].replace(/\n```$/, `\n${block}\n\`\`\``);
      return;
    }
    blocks.push(code ? "```\n" + block + "\n```" : block);
    codeBlock = code ? blocks.length - 1 : -1;
  };
  // Text outside block elements, such as div lines, becomes its own paragraphs.
  const pushLoose = (fragment: string) => {
    for (const part of fragment.split(/<\/?div\b[^>]*>/gi)) push(inline(part));
  };

  // A block tag with no close anywhere after `pos` stays unclosed from then on;
  // remembering that keeps unclosed-tag input linear instead of rescanning.
  const unclosedFrom = new Map<string, number>();
  let pos = 0;
  while (pos < body.length) {
    BLOCK_START.lastIndex = pos;
    const open = BLOCK_START.exec(body);
    pushLoose(body.slice(pos, open ? open.index : body.length));
    if (!open) break;
    const tag = open[1].toLowerCase();
    const openEnd = open.index + open[0].length;
    if (tag === "ul" || tag === "ol") {
      const list = balancedList(body, openEnd);
      push(listToMarkdown(list.inner, tag === "ol"));
      pos = list.end;
      continue;
    }
    const knownUnclosed = unclosedFrom.get(tag);
    let closeMatch: RegExpExecArray | null = null;
    if (knownUnclosed === undefined || openEnd < knownUnclosed) {
      const close = new RegExp(`</${tag}\\s*>`, "gi");
      close.lastIndex = openEnd;
      closeMatch = close.exec(body);
      if (!closeMatch) unclosedFrom.set(tag, openEnd);
    }
    if (!closeMatch) {
      // An unclosed block keeps its text as loose text.
      pos = openEnd;
      continue;
    }
    const inner = body.slice(openEnd, closeMatch.index);
    pos = closeMatch.index + closeMatch[0].length;

    if (tag[0] === "h") {
      const text = inline(inner).replace(/\n+/g, " ");
      if (text) push(`${"#".repeat(Number(tag[1]))} ${text}`);
    } else if (tag === "table") {
      push(tableToMarkdown(inner));
    } else if (tag === "pre" || (tag === "p" && /\bprettyprint\b/i.test(open[2]))) {
      push(codeText(inner), true);
    } else if (tag === "blockquote") {
      const text = inline(inner.replace(/<\/p>\s*<p\b[^>]*>/gi, "<br>")).replace(/\n{2,}/g, "\n");
      if (text)
        push(
          text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        );
    } else {
      push(inline(inner));
    }
  }
  return blocks.join("\n\n");
}
