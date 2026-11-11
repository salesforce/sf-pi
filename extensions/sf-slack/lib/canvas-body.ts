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
 */

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

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

/** Text of an inline fragment, with links and emphasis kept as markdown. */
function inline(html: string): string {
  const withMarks = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, body) => {
      const label = stripTags(body).trim();
      return label ? `[${label}](${href})` : href;
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, body: string) => {
      const value = stripTags(body).trim();
      return value ? `**${value}**` : "";
    })
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, body: string) => {
      const value = stripTags(body).trim();
      return value ? `_${value}_` : "";
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, body: string) => {
      const value = stripTags(body);
      return value ? `\`${value}\`` : "";
    });
  return decodeEntities(stripTags(withMarks)).replace(/\s+/g, " ").trim();
}

function tableToMarkdown(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((cell) =>
      inline(cell[2].replace(/<\/p>\s*<p\b/gi, "</p> <p")).replace(/\|/g, "\\|"),
    ),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return "";
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const lines = [`| ${pad(rows[0]).join(" | ")} |`, `|${" --- |".repeat(width)}`];
  for (const row of rows.slice(1)) lines.push(`| ${pad(row).join(" | ")} |`);
  return lines.join("\n");
}

function listToMarkdown(listHtml: string, ordered: boolean): string {
  const items = [...listHtml.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
  return items
    .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${inline(item[1])}`)
    .filter((line) => !/^(-|\d+\.)\s*$/.test(line))
    .join("\n");
}

/** Convert a Slack canvas HTML export to markdown. */
export function canvasHtmlToMarkdown(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, "");

  const blocks: string[] = [];
  const blockPattern =
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<table\b[^>]*>([\s\S]*?)<\/table>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\4>|<(p|pre|blockquote)\b[^>]*>([\s\S]*?)<\/\6>/gi;
  for (const match of body.matchAll(blockPattern)) {
    if (match[1]) {
      const text = inline(match[2]);
      if (text) blocks.push(`${"#".repeat(Number(match[1]))} ${text}`);
    } else if (match[3] !== undefined) {
      const table = tableToMarkdown(match[3]);
      if (table) blocks.push(table);
    } else if (match[4]) {
      const list = listToMarkdown(match[5], match[4].toLowerCase() === "ol");
      if (list) blocks.push(list);
    } else if (match[6]) {
      const text = inline(match[7]);
      if (!text) continue;
      const tag = match[6].toLowerCase();
      if (tag === "pre") blocks.push("```\n" + decodeEntities(stripTags(match[7])) + "\n```");
      else if (tag === "blockquote") blocks.push(`> ${text}`);
      else blocks.push(text);
    }
  }
  return blocks.join("\n\n");
}
