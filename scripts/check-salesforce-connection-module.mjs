/* SPDX-License-Identifier: Apache-2.0 */
/** Enforce ADR 0103: extension org connections cross the shared sf-conn Interface. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("extensions");

// Product-host adapters may own their isolated connection/version only on the
// exact lines declared here. Presentation-only example paths are also explicit.
const ALLOW = [
  {
    file: "extensions/sf-agentscript/lib/bounded-salesforce-transport.ts",
    id: "get-api-version",
    line: /apiVersion = conn\.getApiVersion\?\.\(\) \?\? "";/,
  },
  {
    file: "extensions/sf-agentscript/lib/bounded-salesforce-transport.ts",
    id: "versioned-path",
    line: /(?:return|const relativeUrl =) `\/services\/data\/v\$\{apiVersion\}/,
  },
  {
    file: "extensions/sf-agentscript/lib/agent-api-auth.ts",
    id: "connection-create",
    line: /Connection\.create\(\{ authInfo \}\)/,
  },
  {
    file: "extensions/sf-agentscript/lib/agent-api-auth.ts",
    id: "set-api-version",
    line: /if \(selectedVersion\) conn\.setApiVersion\(selectedVersion\)/,
  },
  {
    file: "extensions/sf-agentscript/lib/eval/sfap.ts",
    id: "get-api-version",
    line: /apiVersion = conn\.getApiVersion\?\.\(\) \?\? apiVersion;/,
  },
  {
    file: "extensions/sf-data360/lib/api-tool.ts",
    id: "versioned-path",
    line: /Versionless path relative to \/services\/data\/vXX\.X/,
  },
  {
    file: "extensions/sf-data360/lib/display/facade-card.ts",
    id: "versioned-path",
    line: /path: "\/services\/data\/v\*\/ssot\/query-sql"/,
  },
  {
    file: "extensions/sf-guardrail/lib/preferences.ts",
    id: "versioned-path",
    line: /return "sf org api \/services\/data\/v67\.0\/sobjects\/Account\/001\.\.\. --method DELETE -o Prod"/,
  },
];

const checks = [
  {
    id: "deep-import",
    pattern: /lib\/common\/sf-conn\/(?:connection|request)\.ts/,
    message: "imports an internal sf-conn implementation; import sf-conn/index.ts",
  },
  {
    id: "org-create",
    pattern: /\bOrg\.create\s*\(/,
    message: "creates a Salesforce Org outside the shared Module",
  },
  {
    id: "connection-create",
    pattern: /\bConnection\.create\s*\(/,
    message: "creates a Salesforce Connection outside the shared Module",
  },
  {
    id: "get-api-version",
    pattern: /\.getApiVersion\s*(?:\?\.)?\s*\(/,
    message: "reads SDK API version instead of shared target.apiVersion",
  },
  {
    id: "set-api-version",
    pattern: /\.setApiVersion\s*(?:\?\.)?\s*\(/,
    message: "changes SDK API version outside the shared Module",
  },
  {
    id: "connection-version",
    pattern: /\b(?:conn|connection)\.version\b/,
    message: "reads SDK connection.version instead of shared target.apiVersion",
  },
  {
    id: "versioned-path",
    pattern: /\/services\/data\/v/,
    message: "constructs a versioned data path outside the shared Module",
  },
];

const files = await walk(ROOT);
const violations = [];
for (const absolute of files) {
  if (!absolute.endsWith(".ts") || absolute.includes(`${path.sep}tests${path.sep}`)) continue;
  const relative = path.relative(process.cwd(), absolute).split(path.sep).join("/");
  const lines = (await readFile(absolute, "utf8")).split("\n");
  for (const [index, line] of lines.entries()) {
    for (const check of checks) {
      if (!check.pattern.test(line) || isAllowed(relative, check.id, line)) continue;
      violations.push(`${relative}:${index + 1}: ${check.message} [${check.id}]`);
    }
  }
}

if (violations.length) {
  console.error("Salesforce Connection Module check failed:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(
  `✅ Salesforce Connection Module check passed (${files.length} extension source files scanned).`,
);

function isAllowed(file, id, line) {
  return ALLOW.some((entry) => entry.file === file && entry.id === id && entry.line.test(line));
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    }),
  );
  return nested.flat();
}
