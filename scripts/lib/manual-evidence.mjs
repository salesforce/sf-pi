/* SPDX-License-Identifier: Apache-2.0 */
/** Freshness contract for current manual live-verification Markdown. */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listTrackedPublicTextFiles } from "./public-artifact-safety.mjs";

const EVIDENCE_KIND = "manual-live-verification";
const REQUIRED_FIELDS = ["evidence", "as_of", "owner", "revalidate_after", "revalidation_trigger"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function scanTrackedManualEvidence(root, today = currentDate()) {
  const entries = listTrackedPublicTextFiles(root)
    .filter((file) => file.endsWith(".md") && existsSync(path.join(root, file)))
    .map((file) => ({ file, source: readFileSync(path.join(root, file), "utf8") }));
  return scanManualEvidenceTexts(entries, today);
}

export function scanManualEvidenceTexts(entries, today = currentDate()) {
  const findings = [];
  for (const entry of entries) {
    const metadata = parseFlatFrontmatter(entry.source);
    const isCandidate =
      entry.file.endsWith("live-verification.md") || metadata?.evidence === EVIDENCE_KIND;
    if (!isCandidate) continue;

    if (!metadata) {
      findings.push(
        finding(
          entry.file,
          "Manual live-verification evidence must start with freshness frontmatter.",
        ),
      );
      continue;
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof metadata[field] !== "string" || metadata[field].trim().length === 0) {
        findings.push(finding(entry.file, `Manual evidence frontmatter requires ${field}.`));
      }
    }
    if (metadata.evidence && metadata.evidence !== EVIDENCE_KIND) {
      findings.push(finding(entry.file, `Manual evidence field must be ${EVIDENCE_KIND}.`));
    }
    if (metadata.owner && !/^[a-z][a-z0-9-]*$/.test(metadata.owner)) {
      findings.push(
        finding(entry.file, "Manual evidence owner must be a stable public-safe slug."),
      );
    }

    const asOfValid = validateDate(entry.file, "as_of", metadata.as_of, findings);
    const revalidateValid = validateDate(
      entry.file,
      "revalidate_after",
      metadata.revalidate_after,
      findings,
    );
    if (asOfValid && metadata.as_of > today) {
      findings.push(finding(entry.file, `Manual evidence as_of must not be after ${today}.`));
    }
    if (asOfValid && revalidateValid && metadata.revalidate_after < metadata.as_of) {
      findings.push(
        finding(entry.file, "Manual evidence revalidate_after must not precede as_of."),
      );
    }
    if (revalidateValid && metadata.revalidate_after < today) {
      findings.push(
        finding(
          entry.file,
          `Manual evidence requires revalidation: ${metadata.revalidate_after} is before ${today}.`,
        ),
      );
    }
  }
  return findings;
}

function parseFlatFrontmatter(source) {
  if (!source.startsWith("---\n")) return undefined;
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return undefined;
  const metadata = {};
  for (const line of source.slice(4, end).split("\n")) {
    const match = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = unquote(match[2].trim());
  }
  return metadata;
}

function validateDate(file, field, value, findings) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value) || !isRealDate(value)) {
    if (value) findings.push(finding(file, `Manual evidence ${field} must be YYYY-MM-DD.`));
    return false;
  }
  return true;
}

function isRealDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  }
  return value;
}

function finding(file, message) {
  return { file, message };
}

function currentDate() {
  return new Date().toISOString().slice(0, 10);
}
