#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Runtime import check: every bare module imported by extension runtime code
 * must resolve in a git-style install.
 *
 * Pi installs git packages with `npm install --omit=dev --legacy-peer-deps`,
 * so devDependencies and peerDependencies are absent at runtime. A bare
 * import is safe only when it is:
 *
 * - a Node built-in (`node:*` or a known built-in),
 * - a production `dependencies` entry (or a subpath of one), or
 * - a module Pi's extension loader aliases to its bundled copy (HOST_ALIASES).
 *
 * Tests, fixtures, and type-only imports are excluded. Dynamic `import("x")`
 * and `require("x")` with a literal specifier are checked too. This catches a
 * module that exists in this repo's dev install (so local tests pass) but not
 * in a user's install (so the extension fails to load).
 */
import { builtinModules } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/**
 * Modules Pi's extension loader resolves to its bundled copies (Pi 1.5
 * `dist/core/extensions/loader.js` aliases). Keep this list exact: a subpath
 * that is not aliased (for example `typebox/schema`) fails in user installs.
 */
export const HOST_ALIASES = new Set([
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@earendil-works/pi-ai/models",
  "@earendil-works/pi-ai/oauth",
  "@earendil-works/pi-ai/providers/all",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
  "typebox/compile",
  "typebox/value",
  "@sinclair/typebox",
  "@sinclair/typebox/compile",
  "@sinclair/typebox/value",
]);

const ROOTS = ["extensions", "lib"];
const SKIP_DIR = /(^|\/)(tests?|__tests__|fixtures|node_modules|dist|coverage)(\/|$)/;
const SKIP_FILE = /\.(test|spec)\.ts$|\.d\.ts$/;
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const PROD = new Set(Object.keys(pkg.dependencies ?? {}));
const ALLOW_COMMENT = "sf-pi-allow-runtime-import";

export function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

export function isAllowed(specifier, prod = PROD, aliases = HOST_ALIASES) {
  if (BUILTINS.has(specifier) || specifier.startsWith("node:")) return true;
  if (aliases.has(specifier)) return true;
  return prod.has(packageName(specifier));
}

/**
 * Runtime (non-type-only) bare specifiers in one source file, from the
 * TypeScript AST: import/export declarations, `import("x")`, and
 * `require("x")` with a literal specifier. Strings and template literals
 * that merely contain the word "import" are never matched.
 */
export function runtimeSpecifiers(text, fileName = "file.ts") {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lines = text.split(/\r?\n/);
  const out = [];
  const bare = (s) => !s.startsWith(".") && !s.startsWith("/");
  const push = (specifier, node) => {
    if (!bare(specifier)) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const allowed = [line - 1, line - 2].some(
      (n) => n >= 1 && lines[n - 1]?.includes(ALLOW_COMMENT),
    );
    if (!allowed) out.push({ specifier, line });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) push(node.moduleSpecifier.text, node);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      push(node.moduleSpecifier.text, node);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [arg] = node.arguments;
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isImport || isRequire) && ts.isStringLiteralLike(arg)) push(arg.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function sourceFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(repoRoot, full);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIR.test(rel)) sourceFiles(full, acc);
    } else if (name.endsWith(".ts") && !SKIP_FILE.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function main() {
  const violations = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(path.join(repoRoot, root))) {
      for (const { specifier, line } of runtimeSpecifiers(readFileSync(file, "utf8"), file)) {
        if (!isAllowed(specifier)) {
          violations.push(`${path.relative(repoRoot, file)}:${line} imports "${specifier}"`);
        }
      }
    }
  }
  if (violations.length) {
    console.error(
      "❌ Runtime imports that will not resolve in a git install (devDependencies and peerDependencies are omitted):",
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error(
      `Move the package to "dependencies", use a module Pi's loader aliases (${[...HOST_ALIASES].filter((a) => a.startsWith("typebox")).join(", ")}), or mark an intentional optional import with // ${ALLOW_COMMENT}.`,
    );
    process.exit(1);
  }
  console.log("✅ runtime import check passed");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
