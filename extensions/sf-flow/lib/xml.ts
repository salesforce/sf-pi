/* SPDX-License-Identifier: Apache-2.0 */
/** Small position-aware XML projection for Flow metadata. */

import { XMLValidator } from "fast-xml-parser";

export interface XmlNode {
  name: string;
  text: string;
  start: number;
  line: number;
  column: number;
  end: number;
  parent?: XmlNode;
  children: XmlNode[];
}

export interface XmlParseResult {
  root?: XmlNode;
  errors: Array<{ message: string; line: number; column: number }>;
}

export function parseFlowXml(source: string): XmlParseResult {
  const validated = XMLValidator.validate(source);
  if (validated !== true) {
    return {
      errors: [
        {
          message: validated.err.msg,
          line: validated.err.line,
          column: validated.err.col,
        },
      ],
    };
  }

  const starts = lineStarts(source);
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let cursor = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[^>]+>/g;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (match.index > cursor) {
      const current = stack.at(-1);
      if (current) current.text += decodeXml(source.slice(cursor, match.index));
    }
    const token = match[0];
    cursor = match.index + token.length;
    if (token.startsWith("<!--") || token.startsWith("<?") || /^<![^[]/.test(token)) continue;
    if (token.startsWith("<![CDATA[")) {
      const current = stack.at(-1);
      if (current) current.text += token.slice(9, -3);
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const nameMatch = /^<\s*\/?\s*([A-Za-z_][\w:.-]*)/.exec(token);
    if (!nameMatch) continue;
    const name = localName(nameMatch[1]);
    if (closing) {
      const node = stack.pop();
      if (node) node.end = cursor;
      continue;
    }
    const pos = offsetPosition(starts, match.index);
    const parent = stack.at(-1);
    const node: XmlNode = {
      name,
      text: "",
      start: match.index,
      line: pos.line,
      column: pos.column,
      end: cursor,
      parent,
      children: [],
    };
    parent?.children.push(node);
    root ??= node;
    if (!/\/\s*>$/.test(token)) stack.push(node);
  }
  return { root, errors: [] };
}

export function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((candidate) => candidate.name === name);
}

export function childText(node: XmlNode, name: string): string | undefined {
  const value = child(node, name)?.text.trim();
  return value || undefined;
}

export function descendants(node: XmlNode): XmlNode[] {
  const all: XmlNode[] = [];
  const visit = (current: XmlNode) => {
    for (const nested of current.children) {
      all.push(nested);
      visit(nested);
    }
  };
  visit(node);
  return all;
}

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon >= 0 ? name.slice(colon + 1) : name;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function offsetPosition(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const radix = entity.toLowerCase().startsWith("#x") ? 16 : 10;
    const digits = entity.slice(radix === 16 ? 2 : 1);
    const code = Number.parseInt(digits, radix);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}
