#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Normalize and validate Data 360 payload example parity.
 *
 * The upstream reference repository keeps curated payloads in
 * src/main/resources/metadata/payload-examples.json. sf-pi stores a public-safe
 * snapshot of that file plus capability-oriented examples. Upstream example
 * keys that are variants (for example d360_dmo_create_profile) should map to
 * canonical executable capabilities (d360_dmo_create) under examples[].variants.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "extensions/sf-data360/registry");
const CHECK = process.argv.includes("--check");

const upstreamPath = path.join(REGISTRY_DIR, "upstream-payload-examples.json");
const examplesPath = path.join(REGISTRY_DIR, "examples.json");
const upstreamExamples = readJson(upstreamPath);
const localExamples = readJson(examplesPath);

validatePayloadExampleParity(upstreamExamples, localExamples);

const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};
const formattedUpstream = await format(JSON.stringify(upstreamExamples), {
  ...prettierOptions,
  parser: "json",
});
const formattedExamples = await format(JSON.stringify(localExamples), {
  ...prettierOptions,
  parser: "json",
});

const errors = [];
if (readFileSync(upstreamPath, "utf8") !== formattedUpstream) {
  errors.push("upstream-payload-examples.json");
}
if (readFileSync(examplesPath, "utf8") !== formattedExamples) errors.push("examples.json");

if (CHECK) {
  if (errors.length) {
    console.error(
      `❌ Data 360 payload example artifacts out of date: ${errors.join(", ")}. Run: npm run generate-d360-payload-examples`,
    );
    process.exit(1);
  }
  console.log(
    `✅ d360 payload examples are up to date (${Object.keys(upstreamExamples).length} upstream example(s))`,
  );
} else {
  writeFileSync(upstreamPath, formattedUpstream, "utf8");
  writeFileSync(examplesPath, formattedExamples, "utf8");
  console.log(
    `✅ d360 payload examples normalized (${Object.keys(upstreamExamples).length} upstream example(s))`,
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function validatePayloadExampleParity(upstream, local) {
  const missing = Object.keys(upstream).filter(
    (upstreamKey) => !local[upstreamKey] && !findVariantBySourceExample(local, upstreamKey),
  );
  const invalidExamples = [];
  const invalidVariants = [];

  for (const [name, example] of Object.entries(local)) {
    const record = asRecord(example);
    if (!record) {
      invalidExamples.push(`${name} must be an object`);
      continue;
    }
    if (record.operation || record.runbook) {
      invalidExamples.push(`${name} must use capability, not operation/runbook`);
    }
    if (record.capability !== name) {
      invalidExamples.push(`${name} capability must equal example key`);
    }
  }

  for (const [capability, example] of Object.entries(local)) {
    const variants = asRecord(asRecord(example)?.variants);
    if (!variants) continue;
    for (const [variant, variantExample] of Object.entries(variants)) {
      const record = asRecord(variantExample);
      const sourceExample = typeof record?.sourceExample === "string" ? record.sourceExample : "";
      if (!sourceExample) {
        invalidVariants.push(`${capability}.${variant} missing sourceExample`);
        continue;
      }
      if (!upstream[sourceExample]) {
        invalidVariants.push(
          `${capability}.${variant} references unknown upstream example ${sourceExample}`,
        );
      }
      if (record.capability !== capability) {
        invalidVariants.push(`${capability}.${variant} capability must equal ${capability}`);
      }
      if (record.variant !== variant) {
        invalidVariants.push(`${capability}.${variant} variant must equal ${variant}`);
      }
      if (!asRecord(record.params)) {
        invalidVariants.push(`${capability}.${variant} missing params object`);
      }
    }
  }

  if (missing.length || invalidExamples.length || invalidVariants.length) {
    for (const name of missing) console.error(`❌ Missing upstream payload example: ${name}`);
    for (const error of invalidExamples) console.error(`❌ Invalid example: ${error}`);
    for (const error of invalidVariants) console.error(`❌ Invalid variant: ${error}`);
    throw new Error(
      `d360 payload example validation failed with ${missing.length + invalidExamples.length + invalidVariants.length} error(s).`,
    );
  }
}

function findVariantBySourceExample(local, sourceExample) {
  for (const example of Object.values(local)) {
    const variants = asRecord(asRecord(example)?.variants);
    if (!variants) continue;
    for (const value of Object.values(variants)) {
      if (asRecord(value)?.sourceExample === sourceExample) return value;
    }
  }
  return undefined;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
