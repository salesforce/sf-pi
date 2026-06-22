#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
 
/**
 * check-panel-consistency.mjs
 *
 * Lint every bundled extension that registers a slash command and make
 * sure it is wired into the standardized panel pattern:
 *
 *   1. Imports `openCommandPanel` (or sf-pi-manager's bespoke overlay,
 *      which is the documented exception).
 *   2. Imports `openInfoPanel` so panel-driven action results land in a
 *      popup overlay instead of dumping a notify line.
 *   3. Imports the shared lifecycle toggle helper from sf-pi-manager so
 *      "Disable this extension" / "Enable this extension" works in
 *      every panel.
 *
 * Prints a concise table of compliance and exits non-zero on any
 * violation. Run from `npm run validate` (CI) or directly during local
 * development.
 *
 * Excluded from the contract:
 *   - sf-pi-manager itself (provides the overlay; not a per-extension panel)
 *   - sf-brain (alwaysActive; no command surface)
 *   - sf-ohana-spinner (no command surface)
 *   - sf-* command surfaces whose no-args command deep-links to the Manager Surface (see ADR 0051)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(REPO_ROOT, "catalog", "index.json");

// Extensions that participate in the contract but are documented exceptions
// (own bespoke overlay, alwaysActive lifecycle, etc.).
const EXEMPT_EXTENSIONS = new Map([
  ["sf-pi-manager", "provides the package overlay; not a per-extension settings panel"],
  ["sf-brain", "alwaysActive; no command surface"],
  ["sf-ohana-spinner", "no command surface"],
  ["sf-agentscript", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-browser", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-code-analyzer", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-data360", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-devbar", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-data-explorer", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-feedback", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-guardrail", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-herdr", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-llm-gateway-internal", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-lsp", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-skills", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-slack", "no-args command deep-links to the Manager Surface; see ADR 0051"],
  ["sf-welcome", "no-args command deep-links to the Manager Surface; see ADR 0051"],
]);

const REQUIRED_IMPORTS = [
  {
    label: "openCommandPanel",
    pattern: /openCommandPanel/,
    rationale: "shared command panel — title, status, grouped actions, exit/quit close",
  },
  {
    label: "openInfoPanel",
    pattern: /openInfoPanel/,
    rationale: "panel action results render in a popup, not a chat notify dump",
  },
  {
    label: "lifecycle toggle helper",
    pattern: /buildToggleExtensionAction|performToggleExtension/,
    rationale: "every panel exposes Disable / Enable this extension",
  },
];

// Panels that route lifecycle.toggle through performToggleExtension MUST
// pass closeBeforeAction so the panel closes BEFORE ctx.reload() runs.
// Skipping it strands the ctx.ui.custom() promise and hangs the surrounding
// slash-command handler. See lib/common/command-panel.ts (closeBeforeAction
// docstring) for the full rationale.
const CLOSE_BEFORE_ACTION_RULE = {
  label: "closeBeforeAction wiring for lifecycle.toggle",
  // Trigger: imports performToggleExtension AND calls openCommandPanel.
  triggers: [/performToggleExtension/, /openCommandPanel\s*\(/],
  // Required evidence: imports the helper AND uses it as closeBeforeAction.
  required: [/isLifecycleToggleAction/, /closeBeforeAction\s*:\s*isLifecycleToggleAction/],
  rationale:
    "actions that call ctx.reload() must close the panel first, otherwise the ctx.ui.custom() promise dangles and the slash-command handler hangs",
};

// Every pi.registerCommand handler MUST wrap its body in
// withSafeCommandHandler so a throw inside the handler surfaces as a visible
// info popup or notify, not a missable red chat line. Without this, handler
// throws (panel-render bugs, CLI failures, stale ctx after reload) look like
// the command did nothing.
//
// The lint is satisfied when:
//   - imports the helper from lib/common/safe-command-handler.ts AND
//   - every `handler: async (...)` block contains the wrapper call.
//
// Note: regex parsing of TS source is best-effort. The intent is to catch
// new commands added without the wrapper, not to be a perfect AST checker.
const SAFE_HANDLER_RULE = {
  label: "safe-command-handler wraps pi.registerCommand handler",
  triggers: [/pi\.registerCommand\s*\(/],
  // Look for an actual call site, not just an import statement. A bare
  // import without a call site at the handler boundary still fails to
  // protect throws.
  required: [/withSafeCommandHandler\s*\(/],
  rationale:
    "every slash-command handler must wrap its body in withSafeCommandHandler so throws surface as a visible info popup instead of a missable red chat line",
};

function loadCatalog() {
  const raw = readFileSync(CATALOG_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("catalog/index.json is not an array");
  }
  return parsed;
}

function safeReadDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readDirRecursive(dir) {
  const out = [];
  for (const entry of safeReadDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readDirRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_FILENAMES = new Map([
  [
    "lib/panel.ts",
    "renamed to lib/command-panel.ts \u2014 reserved name for the no-args slash-command panel",
  ],
  [
    "lib/settings-panel.ts",
    "renamed to lib/preferences-panel.ts \u2014 disambiguates from the manager-invoked lib/config-panel.ts",
  ],
]);

function checkForbiddenFilenames(ext) {
  const extDir = join(REPO_ROOT, "extensions", ext.id);
  const violations = [];
  for (const [rel, reason] of FORBIDDEN_FILENAMES) {
    if (existsSync(join(extDir, rel))) {
      violations.push(`${rel} \u2014 ${reason}`);
    }
  }
  return violations;
}

function checkExtension(ext) {
  if (!Array.isArray(ext.commands) || ext.commands.length === 0) return null;
  // EXEMPT_EXTENSIONS skips the standard panel-pattern checks (those
  // extensions own a bespoke overlay or have no command surface) but the
  // safe-command-handler rule still applies to every extension that
  // registers a slash command — a throwing handler must always be visible.
  const isPanelExempt = EXEMPT_EXTENSIONS.has(ext.id);

  const entryPath = join(REPO_ROOT, ext.entry);
  let entrySource;
  try {
    entrySource = readFileSync(entryPath, "utf8");
  } catch (error) {
    return {
      id: ext.id,
      ok: false,
      missing: ["index.ts entry not readable"],
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // Some extensions split their panel into a sibling file (sf-llm-gateway-internal,
  // sf-lsp). We grep the entry plus every .ts file under lib/ so the import does
  // not have to live in the entry itself.
  const libRoot = join(dirname(entryPath), "lib");
  const libSource = readDirRecursive(libRoot)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  const allSources = [entrySource, libSource].join("\n");

  const missing = isPanelExempt
    ? []
    : REQUIRED_IMPORTS.filter((req) => !req.pattern.test(allSources)).map(
        (req) => `${req.label} — ${req.rationale}`,
      );

  // closeBeforeAction wiring lint. Only applies when the extension uses
  // openCommandPanel AND routes lifecycle.toggle through performToggleExtension.
  // (sf-lsp uses its own ctx.ui.custom layout that already closes the panel
  // before invoking the action, which is why it is on the EXEMPT_EXTENSIONS
  // list at the top.)
  const triggers =
    !isPanelExempt && CLOSE_BEFORE_ACTION_RULE.triggers.every((re) => re.test(allSources));
  const closeBeforeViolations = [];
  if (triggers) {
    for (const re of CLOSE_BEFORE_ACTION_RULE.required) {
      if (!re.test(allSources)) {
        closeBeforeViolations.push(
          `${CLOSE_BEFORE_ACTION_RULE.label} — ${CLOSE_BEFORE_ACTION_RULE.rationale}`,
        );
        break;
      }
    }
  }

  // safe-command-handler lint. Applies to any extension that registers a
  // slash command. The helper is short-circuited for sf-pi-manager,
  // sf-brain, sf-ohana-spinner, sf-lsp via EXEMPT_EXTENSIONS at the top of
  // the file — but for sf-pi-manager and sf-lsp we still want the wrapper
  // (they are exempt from the openCommandPanel rule, not this one), so
  // re-check independently.
  const safeHandlerTriggers = SAFE_HANDLER_RULE.triggers.every((re) => re.test(allSources));
  const safeHandlerViolations = [];
  if (safeHandlerTriggers) {
    for (const re of SAFE_HANDLER_RULE.required) {
      if (!re.test(allSources)) {
        safeHandlerViolations.push(`${SAFE_HANDLER_RULE.label} — ${SAFE_HANDLER_RULE.rationale}`);
        break;
      }
    }
  }

  const forbidden = checkForbiddenFilenames(ext).map((entry) => `forbidden filename ${entry}`);
  const issues = [...missing, ...closeBeforeViolations, ...safeHandlerViolations, ...forbidden];

  return { id: ext.id, ok: issues.length === 0, missing: issues };
}

function main() {
  const catalog = loadCatalog();
  const reports = [];
  for (const ext of catalog) {
    const report = checkExtension(ext);
    if (report) reports.push(report);
  }

  const violations = reports.filter((r) => !r.ok);
  const passing = reports.filter((r) => r.ok);
  const exempt = catalog
    .filter((ext) => EXEMPT_EXTENSIONS.has(ext.id))
    .map((ext) => ({ id: ext.id, reason: EXEMPT_EXTENSIONS.get(ext.id) }));

  console.log(
    `Panel consistency check — ${passing.length} ok, ${violations.length} violation(s), ${exempt.length} exempt`,
  );
  for (const r of passing) {
    console.log(`  ✓ ${r.id}`);
  }
  for (const r of violations) {
    console.log(`  ✗ ${r.id}`);
    for (const reason of r.missing) console.log(`      - missing ${reason}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  for (const e of exempt) {
    console.log(`  ◆ ${e.id} (exempt: ${e.reason})`);
  }

  if (violations.length > 0) {
    console.log("");
    console.log("How to fix:");
    console.log("  See lib/common/command-panel.ts and");
    console.log("  lib/common/extension-toggle.ts for the contract.");
    console.log("  sf-slack and sf-devbar are reference implementations.");
    process.exit(1);
  }
}

main();
