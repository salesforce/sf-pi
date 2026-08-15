/* SPDX-License-Identifier: Apache-2.0 */
/** Weekly/report-only external Markdown link checker. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExternalLinkReport,
  extractExternalLinks,
  renderExternalLinkReport,
} from "./lib/external-link-report.mjs";
import { listTrackedPublicTextFiles } from "./lib/public-artifact-safety.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
const outputDir = options.outputDir ?? defaultOutputDir();
const entries = listTrackedPublicTextFiles(ROOT)
  .filter((file) => file.endsWith(".md"))
  .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), "utf8") }));
const links = extractExternalLinks(entries);
const report = await buildExternalLinkReport(links, options);
const markdown = renderExternalLinkReport(report);

mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, "external-links.json");
const markdownPath = path.join(outputDir, "external-links.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, markdown, "utf8");

console.log(markdown);
console.log(`Reports: ${jsonPath} · ${markdownPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--output-dir") parsed.outputDir = path.resolve(requiredValue(argv, ++index, arg));
    else if (arg === "--concurrency") parsed.concurrency = positiveNumber(argv, ++index, arg);
    else if (arg === "--timeout-ms") parsed.timeoutMs = positiveNumber(argv, ++index, arg);
    else if (arg === "--retry-delay-ms") {
      parsed.retryDelayMs = nonNegativeNumber(argv, ++index, arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: npm run docs:links:report -- [--output-dir path] [--concurrency n] [--timeout-ms n] [--retry-delay-ms n]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveNumber(argv, index, flag) {
  const value = Number(requiredValue(argv, index, flag));
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flag} must be a positive integer`);
  return value;
}

function nonNegativeNumber(argv, index, flag) {
  const value = Number(requiredValue(argv, index, flag));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return value;
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(ROOT, ".pi", "state", "docs", "external-links", stamp);
}
