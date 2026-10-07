#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Import and normalize the official Data 360 Connect OpenAPI contract. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { format, resolveConfig } from "prettier";

import { normalizeConnectOpenApi, parseConnectOpenApi } from "./lib/d360-connect-openapi.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_URL =
  "https://developer.salesforce.com/static/datacloud/connectapi/spec/cdp-connect-api-Swagger.yaml";
const REFERENCE_URL = "https://developer.salesforce.com/docs/data/connectapi/references";
const OUTPUT = path.join(
  ROOT,
  "extensions",
  "sf-data360",
  "registry",
  "connect-openapi-contracts.json",
);
const check = process.argv.includes("--check");
const specFile = valueAfter("--spec-file");
const specUrl = valueAfter("--spec-url");
if (specFile && specUrl) throw new Error("Pass only one of --spec-file or --spec-url.");
if (!specFile && !specUrl) {
  throw new Error(
    "Pass --spec-file <downloaded OpenAPI YAML> or --spec-url <official developer.salesforce.com URL>.",
  );
}

const sourceUrl = specUrl ?? valueAfter("--source-url") ?? DEFAULT_SOURCE_URL;
const sourceText = specFile
  ? readFileSync(path.resolve(specFile), "utf8")
  : await fetchOfficialSpec(sourceUrl);
const sha256 = createHash("sha256").update(sourceText).digest("hex");
const snapshot = normalizeConnectOpenApi(parseConnectOpenApi(sourceText), { sourceUrl, sha256 });
const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};
const output = await format(JSON.stringify(snapshot), { ...prettierOptions, parser: "json" });

if (check) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, "utf8") !== output) {
    console.error(
      "❌ Data 360 Connect OpenAPI snapshot is stale. Run npm run import-d360-connect-openapi with the reviewed specification.",
    );
    process.exit(1);
  }
  console.log(
    `✅ Data 360 Connect OpenAPI snapshot matches ${snapshot.summary.operations} operation(s) (${sha256})`,
  );
} else {
  writeFileSync(OUTPUT, output, "utf8");
  console.log(
    `✅ Imported Data 360 Connect OpenAPI ${snapshot.source.apiVersion}: ${snapshot.summary.operations} operation(s), ${snapshot.summary.componentSchemas} schema(s), ${sha256}`,
  );
}

async function fetchOfficialSpec(urlText) {
  const url = new URL(urlText);
  if (url.protocol !== "https:" || url.hostname !== "developer.salesforce.com") {
    throw new Error("Connect OpenAPI URL must use https://developer.salesforce.com.");
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/yaml,text/yaml,application/octet-stream,*/*",
      Referer: REFERENCE_URL,
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Connect OpenAPI download failed HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    throw new Error("Connect OpenAPI download returned HTML instead of YAML.");
  }
  return response.text();
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
