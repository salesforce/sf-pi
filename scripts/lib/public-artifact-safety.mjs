/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public-artifact safety scanner.
 *
 * The Git index defines the public corpus. Ignored local notes, reports, and
 * session artifacts never enter this check; tracked docs, source, fixtures, and
 * generated text do. Secret scanners remain separate and authoritative for
 * credential material.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PUBLIC_TEXT_EXTENSIONS = new Set([
  ".agent",
  ".cls",
  ".css",
  ".csv",
  ".gql",
  ".graphql",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".properties",
  ".py",
  ".sh",
  ".soql",
  ".svg",
  ".toml",
  ".trigger",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const PUBLIC_TEXT_BASENAMES = new Set([
  ".editorconfig",
  ".gitignore",
  ".gitleaksignore",
  ".npmrc",
  ".prettierignore",
  "CODEOWNERS",
  "Dockerfile",
]);

const PUBLIC_SAFETY_PATTERNS = [
  {
    id: "salesforce-sandbox-host",
    regex: /[a-z0-9-]+--[a-z0-9-]+\.sandbox\.my\.salesforce\.com/i,
    message: "Salesforce sandbox hostnames must not appear in public artifacts.",
  },
  {
    id: "salesforce-org-id",
    regex: /\b00D[A-Za-z0-9]{12,15}\b/,
    message: "Salesforce org IDs must not appear in public artifacts.",
  },
  {
    id: "slack-permalink",
    regex: /https:\/\/[^\s)"']+\.slack\.com\/archives\/[^\s)"']+/i,
    message: "Slack permalinks must not appear in public artifacts.",
  },
  {
    id: "slack-team-id",
    regex: /\bT(?!0{2}|01XYZ)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack team IDs must not appear in public artifacts.",
  },
  {
    id: "slack-user-id",
    regex: /\bU(?!0{2}|01ABC)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack user IDs must not appear in public artifacts.",
  },
  {
    id: "slack-channel-id",
    regex: /\bC(?!0{2}|01ABC|09Z)[0-9][A-Z0-9]{7,}\b/,
    message: "Slack channel IDs must not appear in public artifacts.",
  },
];

export function parseTrackedPublicTextFiles(output) {
  return String(output).split("\0").filter(Boolean).filter(isPublicTextPath).sort();
}

export function listTrackedPublicTextFiles(root) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  return parseTrackedPublicTextFiles(output);
}

export function scanTrackedPublicArtifacts(root) {
  return scanPublicArtifactTexts(
    listTrackedPublicTextFiles(root)
      .filter((file) => existsSync(path.join(root, file)))
      .map((file) => ({
        file,
        source: readFileSync(path.join(root, file), "utf8"),
      })),
  );
}

export function scanPublicArtifactTexts(entries) {
  const findings = [];
  for (const { file, source } of entries) {
    const lines = String(source).split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? "";
      for (const pattern of PUBLIC_SAFETY_PATTERNS) {
        const match = line.match(pattern.regex);
        if (!match?.[0] || isExplicitGenericFixture(pattern.id, match[0])) continue;
        findings.push({
          id: pattern.id,
          file,
          line: index + 1,
          message: pattern.message,
          detail: `line ${index + 1}: private-shaped ${pattern.id}; inspect the file locally`,
        });
      }
    }
  }
  return findings;
}

function isPublicTextPath(file) {
  const normalized = file.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  return (
    PUBLIC_TEXT_BASENAMES.has(basename) || PUBLIC_TEXT_EXTENSIONS.has(path.posix.extname(basename))
  );
}

function isExplicitGenericFixture(id, value) {
  if (id === "salesforce-sandbox-host") return value.toLowerCase().startsWith("example--");
  if (id === "salesforce-org-id") return /^00D[01]+(?:AAA)?$/.test(value);
  if (id === "slack-permalink") {
    try {
      return new URL(value).hostname === "example.slack.com";
    } catch {
      return false;
    }
  }
  if (id.startsWith("slack-")) return isGenericSlackId(value);
  return false;
}

function isGenericSlackId(value) {
  return (
    /^[CUTD]0(?:123456789|987654321)$/.test(value) ||
    /^[CUTD]0[A-G]{3}0000[1-9]$/.test(value) ||
    /^[CUTD]01(?:ABCEXAMPLE|ABCDEF[0-9]*|DEADBEEF)$/.test(value) ||
    /^[CUTD]012ABCDEF$/.test(value)
  );
}
