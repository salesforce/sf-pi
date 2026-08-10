/* SPDX-License-Identifier: Apache-2.0 */
/** Enforce ADR 0103: extension org connections cross the shared sf-conn Interface. */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("extensions");
const ALLOW = new Map([
  [
    "extensions/sf-agentscript/lib/bounded-salesforce-transport.ts",
    new Set(["versioned-path", "get-api-version"]),
  ],
  [
    "extensions/sf-agentscript/lib/agent-api-auth.ts",
    new Set(["connection-create", "set-api-version"]),
  ],
]);

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
    pattern: /\.getApiVersion\s*\(/,
    message: "reads SDK API version instead of shared target.apiVersion",
  },
  {
    id: "set-api-version",
    pattern: /\.setApiVersion\s*\(/,
    message: "changes SDK API version outside the shared Module",
  },
  {
    id: "versioned-path",
    pattern: /\/services\/data\/v\$\{/,
    message: "constructs a versioned data path outside the shared Module",
  },
];

const files = await walk(ROOT);
const violations = [];
for (const absolute of files) {
  if (!absolute.endsWith(".ts") || absolute.includes(`${path.sep}tests${path.sep}`)) continue;
  const relative = path.relative(process.cwd(), absolute).split(path.sep).join("/");
  const source = await readFile(absolute, "utf8");
  const allowed = ALLOW.get(relative) ?? new Set();
  for (const check of checks) {
    if (allowed.has(check.id)) continue;
    const match = check.pattern.exec(source);
    if (!match) continue;
    const line = source.slice(0, match.index).split("\n").length;
    violations.push(`${relative}:${line}: ${check.message} [${check.id}]`);
  }
}

if (violations.length) {
  console.error("Salesforce Connection Module check failed:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(
  `✅ Salesforce Connection Module check passed (${files.length} extension source files scanned).`,
);

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
