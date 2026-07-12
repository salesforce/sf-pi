#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Import the public Data 360 reference catalog into sf-data360 snapshots.
 *
 * FamilyCatalog.java is the primary source because it is the upstream search
 * catalog. @McpTool annotations and payload-examples.json are used as drift
 * signals so a catalog entry without implementation evidence is visible during
 * review instead of silently becoming executable.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const REGISTRY_DIR = path.join(ROOT, "extensions/sf-data360/registry");
const CHECK = process.argv.includes("--check");
const UPSTREAM_DIR = resolveUpstreamDir();
const FAMILY_CATALOG = path.join(
  UPSTREAM_DIR,
  "src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java",
);
const PAYLOAD_EXAMPLES = path.join(
  UPSTREAM_DIR,
  "src/main/resources/metadata/payload-examples.json",
);

if (!existsSync(FAMILY_CATALOG)) {
  throw new Error(
    `Missing upstream FamilyCatalog.java. Pass --upstream-dir <d360-mcp-server checkout>; looked in ${FAMILY_CATALOG}`,
  );
}
if (!existsSync(PAYLOAD_EXAMPLES)) {
  throw new Error(
    `Missing upstream payload-examples.json. Pass --upstream-dir <d360-mcp-server checkout>; looked in ${PAYLOAD_EXAMPLES}`,
  );
}

const upstreamSha = gitSha(UPSTREAM_DIR);
const capturedAt = gitCommitDate(UPSTREAM_DIR) ?? "unknown";
const catalogTools = parseFamilyCatalog(readFileSync(FAMILY_CATALOG, "utf8"));
const implementedToolNames = collectImplementedToolNames(UPSTREAM_DIR);
const upstreamPayloadExamples = JSON.parse(readFileSync(PAYLOAD_EXAMPLES, "utf8"));
const payloadExampleNames = new Set(Object.keys(upstreamPayloadExamples));
const existingOperations = readJson(path.join(REGISTRY_DIR, "upstream-operations.json"));
const existingByName = new Map(existingOperations.map((operation) => [operation.name, operation]));
const upstreamNames = new Set(catalogTools.map((tool) => tool.name));

const tools = catalogTools.map((tool) => ({
  ...tool,
  implementationFound: implementedToolNames.has(tool.name),
  hasPayloadExample: payloadExampleNames.has(tool.name),
}));

const importedOperations = catalogTools.map((tool) =>
  toOperation(tool, existingByName.get(tool.name)),
);
const compatibilityOperations = existingOperations
  .filter((operation) => !upstreamNames.has(operation.name))
  .map((operation) => ({ ...operation, origin: operation.origin ?? "local_compatibility" }));
const upstreamOperations = [...importedOperations, ...compatibilityOperations];

const missingImplementations = tools.filter(
  (tool) => !tool.implementationFound && tool.method !== null && tool.path !== null,
);
if (missingImplementations.length) {
  for (const tool of missingImplementations) {
    console.warn(
      `⚠️  ${tool.name} appears in FamilyCatalog but no @McpTool implementation was found.`,
    );
  }
}

const upstreamToolsSnapshot = {
  source:
    "https://github.com/forcedotcom/d360-mcp-server/src/main/java/com/salesforce/data360/mcp/runtime/FamilyCatalog.java",
  capturedAt,
  commit: upstreamSha,
  count: tools.length,
  tools,
};

const outputs = [
  {
    path: path.join(REGISTRY_DIR, "upstream-tools.json"),
    value: upstreamToolsSnapshot,
  },
  {
    path: path.join(REGISTRY_DIR, "upstream-operations.json"),
    value: upstreamOperations,
  },
  {
    path: path.join(REGISTRY_DIR, "upstream-payload-examples.json"),
    value: upstreamPayloadExamples,
  },
];

const prettierOptions = {
  printWidth: 100,
  ...((await resolveConfig(path.join(ROOT, "package.json"))) ?? {}),
};
const formatted = await Promise.all(
  outputs.map(async (output) => ({
    ...output,
    text: await format(JSON.stringify(output.value), { ...prettierOptions, parser: "json" }),
  })),
);

const drifted = formatted.filter((output) => readFileSync(output.path, "utf8") !== output.text);
if (CHECK) {
  if (drifted.length) {
    console.error(
      `❌ Data 360 upstream snapshots are out of date: ${drifted
        .map((entry) => path.relative(ROOT, entry.path))
        .join(", ")}. Run: npm run import-d360-upstream -- --upstream-dir ${UPSTREAM_DIR}`,
    );
    process.exit(1);
  }
  console.log(`✅ Data 360 upstream snapshots are current (${tools.length} upstream tool(s))`);
} else {
  for (const output of formatted) writeFileSync(output.path, output.text, "utf8");
  console.log(
    `✅ Imported Data 360 upstream snapshots (${tools.length} tool(s), ${Object.keys(upstreamPayloadExamples).length} payload example(s))`,
  );
}

function resolveUpstreamDir() {
  const explicit = valueAfter("--upstream-dir") ?? process.env.D360_UPSTREAM_DIR;
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.join(ROOT, "..", "d360-mcp-server"),
    "/tmp/pi-d360-mcp-server-staging",
    "/tmp/pi-github-repos/forcedotcom/d360-mcp-server",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error("Pass --upstream-dir <path> or set D360_UPSTREAM_DIR.");
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function gitSha(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

function gitCommitDate(cwd) {
  try {
    return execFileSync("git", ["show", "-s", "--format=%cs", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function parseFamilyCatalog(source) {
  const entries = [];
  const pattern = /t\.add\(new ToolDef\((.*?)\)\);/gs;
  for (const match of source.matchAll(pattern)) {
    const args = parseJavaArguments(match[1]);
    if (args.length !== 5 && args.length !== 6) {
      throw new Error(`Unable to parse ToolDef arguments: ${match[1]}`);
    }
    const [name, family, description, method, apiPath, tips] = args;
    entries.push({
      name,
      family,
      description,
      method,
      path: apiPath,
      ...(tips ? { tips } : {}),
    });
  }
  if (!entries.length) throw new Error("No ToolDef entries found in FamilyCatalog.java.");
  return entries;
}

function parseJavaArguments(text) {
  const values = [];
  let current = "";
  let inString = false;
  let escaping = false;
  for (const char of text) {
    if (inString) {
      current += char;
      if (escaping) escaping = false;
      else if (char === "\\") escaping = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      current += char;
      continue;
    }
    if (char === ",") {
      values.push(parseJavaValue(current.trim()));
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) values.push(parseJavaValue(current.trim()));
  return values;
}

function parseJavaValue(value) {
  if (value === "null") return null;
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return JSON.parse(value);
}

function collectImplementedToolNames(upstreamDir) {
  const root = path.join(upstreamDir, "src/main/java/com/salesforce/data360/mcp");
  const names = new Set();
  const files = listJavaFiles(root);
  const toolPattern = /@McpTool\s*\(\s*name\s*=\s*"([^"]+)"/g;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(toolPattern)) names.add(match[1]);
  }
  return names;
}

function listJavaFiles(dir) {
  const entries = execFileSync("find", [dir, "-type", "f", "-name", "*.java"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  return entries;
}

function toOperation(tool, existing) {
  const existingPath = typeof existing?.path === "string" ? existing.path : undefined;
  const path = preserveFriendlyPathParams(tool.path, existingPath);
  return stripUndefined({
    name: tool.name,
    family: normalizeFamily(tool.family),
    description: tool.description,
    method: path
      ? (tool.method ?? existing?.method ?? "POST")
      : (existing?.method ?? tool.method ?? "POST"),
    path: path ?? existing?.path ?? "/local/unknown",
    ...(tool.tips ? { tips: tool.tips } : {}),
    origin: "upstream",
  });
}

function preserveFriendlyPathParams(upstreamPath, existingPath) {
  if (!upstreamPath) return existingPath;
  if (!existingPath) return upstreamPath;
  const upstreamParams = [...upstreamPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  const existingParams = [...existingPath.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
  if (!upstreamParams.length || upstreamParams.length !== existingParams.length)
    return upstreamPath;
  let result = upstreamPath;
  upstreamParams.forEach((param, index) => {
    result = result.replace(`{${param}}`, `{${existingParams[index]}}`);
  });
  return result;
}

function normalizeFamily(family) {
  return (
    {
      CalculatedInsights: "Calculated Insights",
      IdentityResolution: "Identity Resolution",
      SDM: "Semantic Retrieval",
      Retriever: "Semantic Retrieval",
      SearchIndex: "Semantic Retrieval",
    }[family] ?? family
  );
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}
