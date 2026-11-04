/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin surface comparison: which surface SF Fin should use for each Fin
 * capability, generated from the installed Fin CLI and the reviewed Intercom
 * MCP contract rather than written by hand.
 *
 * - The CLI inventory comes from crawling `intercom … --help` (local, no
 *   token, no network). Every leaf command must map to a capability; unmapped
 *   commands are reported so a CLI upgrade cannot silently add surface.
 * - The MCP inventory is SF MCP's reviewed Intercom tool contract (the same
 *   one the `intercom` preset uses), so the comparison and the preset cannot
 *   drift apart.
 * - The Fin Agent API column is documented reference: its tools appear only
 *   when the workspace has been granted Fin Agent API access.
 */
import { INTERCOM_MCP_TOOLS } from "../../sf-mcp/lib/tool-contracts-intercom.ts";
import type { CliRunOptions, CliRunResult } from "./cli-runner.ts";

export type Surface = "cli" | "mcp" | "agent-api";

export interface Capability {
  id: string;
  resource: string;
  label: string;
  cli: string[];
  mcp: string[];
  agentApi: string[];
  /** The surface SF Fin uses, and why. */
  sfFin: { surface: Surface | "none"; via: string; why: string };
}

/**
 * The reviewed capability map. Each CLI leaf command and MCP tool belongs to
 * exactly one capability. Change it when Fin adds or reshapes a surface.
 */
export const CAPABILITIES: readonly Capability[] = [
  cap("identity", "workspace", "Workspace identity", ["me"], [], [], {
    surface: "cli",
    via: "sf_fin doctor",
    why: "Only the CLI identifies the admin and workspace; doctor uses it to prove the token's workspace.",
  }),
  cap(
    "auth",
    "workspace",
    "CLI authentication",
    [
      "auth login",
      "auth bootstrap",
      "auth status",
      "auth logout",
      "auth signup",
      "auth verify-email",
      "auth list",
      "auth switch",
    ],
    [],
    [],
    {
      surface: "none",
      via: "/login sf-fin",
      why: "Pi owns the token; SF Fin never uses the CLI's own login or keychain.",
    },
  ),
  cap(
    "cli-local",
    "workspace",
    "CLI configuration and help",
    ["config list", "config get", "config set", "config path", "completion bash"],
    [],
    [],
    {
      surface: "none",
      via: "—",
      why: "Local CLI settings; SF Fin runs the CLI with a private config directory.",
    },
    ["completion zsh", "completion fish", "changelog", "pricing"],
  ),
  cap("provisioning", "workspace", "Workspace provisioning", ["setup", "fin enable"], [], [], {
    surface: "none",
    via: "—",
    why: "Out of scope: these create or activate a workspace and need email/password sessions.",
  }),
  cap("raw-api", "workspace", "Raw REST request", ["api"], [], [], {
    surface: "none",
    via: "—",
    why: "Unscoped; SF Fin exposes only named, reviewed operations.",
  }),
  cap(
    "conversation-read",
    "conversation",
    "Find and read conversations",
    ["conversations list", "conversations get", "conversations search"],
    ["search", "fetch", "search_conversations", "get_conversation"],
    [],
    {
      surface: "mcp",
      via: "Intercom MCP preset",
      why: "Reviewed read tools with OAuth; no token handling in SF Fin.",
    },
  ),
  cap(
    "conversation-write",
    "conversation",
    "Reply to or act on conversations",
    ["conversations reply", "fin conversation bulk-send"],
    ["add_internal_note"],
    [],
    {
      surface: "mcp",
      via: "Intercom MCP add_internal_note",
      why: "Teammate-only notes are the safe write; SF Fin does not send customer-visible replies.",
    },
  ),
  cap(
    "contact",
    "contact",
    "Contacts",
    [
      "contacts list",
      "contacts get",
      "contacts create",
      "contacts update",
      "contacts delete",
      "contacts search",
    ],
    ["search_contacts", "get_contact"],
    [],
    {
      surface: "mcp",
      via: "Intercom MCP preset",
      why: "Reads only; contact writes are customer data and stay out of scope.",
    },
  ),
  cap("company", "company", "Companies", [], ["list_companies", "get_company"], [], {
    surface: "mcp",
    via: "Intercom MCP preset",
    why: "Only the MCP has company tools.",
  }),
  cap(
    "article",
    "article",
    "Help Center articles",
    [
      "articles list",
      "articles search",
      "articles get",
      "articles create",
      "articles update",
      "articles delete",
    ],
    ["list_articles", "search_articles", "get_article", "create_article", "update_article"],
    [],
    {
      surface: "mcp",
      via: "Intercom MCP preset",
      why: "Reviewed article tools (create defaults to draft); deletion stays in the UI.",
    },
  ),
  cap(
    "internal-article",
    "article",
    "Internal articles",
    [
      "internal-articles list",
      "internal-articles get",
      "internal-articles create",
      "internal-articles update",
      "internal-articles delete",
      "internal-articles folders list",
      "internal-articles folders get",
      "internal-articles folders articles",
    ],
    [],
    [],
    { surface: "none", via: "—", why: "CLI only; not needed for agent building yet." },
  ),
  cap(
    "help-center",
    "article",
    "Help Center collections",
    ["help-center list", "help-center get", "help-center create"],
    [],
    [],
    { surface: "none", via: "—", why: "CLI only; not needed for agent building yet." },
  ),
  cap(
    "messenger",
    "workspace",
    "Messenger settings",
    ["messenger get", "messenger update", "messenger snippet"],
    [],
    [],
    { surface: "none", via: "—", why: "Customer-facing install settings; out of scope." },
  ),
  cap("sdk-snapshot", "fin-sdk", "Fin-as-code snapshot", ["fin manifest", "fin download"], [], [], {
    surface: "cli",
    via: "sf_fin sdk manifest|download",
    why: "Only the CLI exports Fin-as-code; SF Fin enables the SDK explicitly first.",
  }),
  cap(
    "procedure-author",
    "procedure",
    "Procedures: read and author",
    ["fin procedures list", "fin procedures get", "fin procedures upload"],
    [],
    ["run_fin_procedure"],
    {
      surface: "cli",
      via: "sf_fin sdk validate|upload",
      why: "Deterministic YAML with schema validation and a semantic round-trip check.",
    },
  ),
  cap(
    "procedure-state",
    "procedure",
    "Procedures: publish and pause",
    ["fin procedures publish", "fin procedures pause"],
    [],
    [],
    {
      surface: "cli",
      via: "sf_fin sdk publish|pause",
      why: "Exact, Guardrail-mediated state change with verification.",
    },
  ),
  cap(
    "procedure-history",
    "procedure",
    "Procedure version history",
    ["fin procedures versions"],
    [],
    [],
    {
      surface: "none",
      via: "direct read",
      why: "Separately gated; the CLI command would trip its silent SDK auto-enable on a 403.",
    },
  ),
  cap(
    "simulation",
    "simulation",
    "Simulations",
    [
      "fin simulations list",
      "fin simulations upload",
      "fin simulations run",
      "fin simulations result",
      "fin simulations generate",
    ],
    [],
    [],
    {
      surface: "cli",
      via: "sf_fin sdk upload_simulations|simulate",
      why: "Only the CLI runs simulations.",
    },
  ),
  cap(
    "guidance",
    "guidance",
    "Guidance",
    ["fin guidance list", "fin guidance get", "fin guidance create"],
    [],
    [],
    {
      surface: "cli",
      via: "sf_fin sdk validate|upload (type: guidance)",
      why: "YAML upload keeps guidance paused; going live is a separate Guardrail step.",
    },
  ),
  cap(
    "data-connector",
    "data-connector",
    "Data connectors",
    [
      "fin data-connectors list",
      "fin data-connectors create",
      "fin data-connectors get",
      "fin data-connectors versions",
    ],
    [],
    [],
    {
      surface: "cli",
      via: "sf_fin sdk validate|upload (type: data_connector)",
      why: "JSON upload saves a draft; publishing stays in the Intercom UI.",
    },
  ),
  cap(
    "workflow",
    "workflow",
    "Workflows",
    [
      "fin workflows list",
      "fin workflows get",
      "fin workflows upload",
      "fin workflows enable",
      "fin workflows disable",
      "fin workflows versions",
    ],
    [],
    [],
    { surface: "none", via: "—", why: "Not built yet; workflows route live conversations." },
  ),
  cap(
    "attribute",
    "attribute",
    "Attributes and audiences",
    [
      "fin attributes list",
      "fin attributes get",
      "fin attributes download",
      "fin attributes upload",
      "fin audiences list",
    ],
    [],
    [],
    { surface: "none", via: "—", why: "Not built yet." },
  ),
  cap("qa-monitor", "monitor", "QA monitors", ["fin monitor pull-flagged"], [], [], {
    surface: "none",
    via: "—",
    why: "Not built yet.",
  }),
  cap(
    "operator",
    "operator",
    "Fin Operator (natural-language changes)",
    [],
    [
      "send_operator_message",
      "get_operator_response",
      "get_proposal_details",
      "apply_proposals",
      "reject_proposals",
    ],
    [],
    {
      surface: "mcp",
      via: "Intercom MCP Operator tools",
      why: "Only the MCP has Operator; apply is an exact Guardrail approval.",
    },
  ),
  cap(
    "fin-runtime",
    "conversation",
    "Talk to a deployed Fin",
    [],
    [],
    ["list_fin_capabilities", "ask_fin", "get_fin_response", "reply_to_fin_conversation"],
    {
      surface: "agent-api",
      via: "sf_fin agent",
      why: "End-to-end tests against live Fin; needs Fin Agent API access and its own key.",
    },
  ),
];

function cap(
  id: string,
  resource: string,
  label: string,
  cli: string[],
  mcp: string[],
  agentApi: string[],
  sfFin: Capability["sfFin"],
  extraCli: string[] = [],
): Capability {
  return { id, resource, label, cli: [...cli, ...extraCli], mcp, agentApi, sfFin };
}

/** Run `intercom <path> --help` and return its subcommand names. */
export type HelpRunner = (path: string[]) => Promise<string | undefined>;

export function cliHelpRunner(
  run: (args: string[], options: CliRunOptions) => Promise<CliRunResult>,
): HelpRunner {
  return async (path) => {
    const result = await run([...path, "--help"], { timeoutMs: 15_000 });
    if (result.spawnError || result.exitCode === null) return undefined;
    return `${result.stdout}\n${result.stderr}`;
  };
}

/**
 * Subcommand names from a commander-style help page. A command line in the
 * `Commands:` block is `  <name>[ <args>]  <description>`: two-space indent,
 * a name, optional `[options]` / `<arg>` tokens, then a two-space gap. Wrapped
 * or multi-paragraph descriptions inside the block do not match that shape.
 * The block ends at the first unindented, non-empty line.
 */
export function parseSubcommands(help: string): string[] {
  const lines = help.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  if (start < 0) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(" ")) break;
    const match = /^ {2}([a-z][a-z0-9-]*)((?: [[<][^\]>]+[\]>])*)(?: {2,}\S| *$)/.exec(line);
    const name = match?.[1];
    if (name && name !== "help") names.push(name);
  }
  return names;
}

/** Crawl the CLI help tree into leaf commands (bounded depth and count). */
export async function crawlCliCommands(help: HelpRunner): Promise<string[] | undefined> {
  const root = await help([]);
  if (root === undefined) return undefined;
  const leaves: string[] = [];
  const visit = async (path: string[], text: string, depth: number): Promise<void> => {
    const subs = parseSubcommands(text);
    if (subs.length === 0 || depth >= 4) {
      if (path.length) leaves.push(path.join(" "));
      return;
    }
    for (const sub of subs) {
      if (leaves.length >= 500) return;
      const next = [...path, sub];
      const child = await help(next);
      if (child === undefined) leaves.push(next.join(" "));
      else await visit(next, child, depth + 1);
    }
  };
  await visit([], root, 0);
  return leaves;
}

export interface SurfaceReport {
  cliVersion?: string;
  cliCommands: number;
  mcpTools: number;
  capabilities: Capability[];
  unmappedCli: string[];
  missingCli: string[];
  unmappedMcp: string[];
  missingMcp: string[];
}

export function compareSurfaces(input: {
  cliCommands: string[] | undefined;
  cliVersion?: string;
  mcpTools?: readonly string[];
}): SurfaceReport {
  const mcpTools = input.mcpTools ?? INTERCOM_MCP_TOOLS.map((tool) => tool.name);
  const mappedCli = new Set(CAPABILITIES.flatMap((c) => c.cli));
  const mappedMcp = new Set(CAPABILITIES.flatMap((c) => c.mcp));
  const cli = input.cliCommands ?? [];
  return {
    cliVersion: input.cliVersion,
    cliCommands: cli.length,
    mcpTools: mcpTools.length,
    capabilities: [...CAPABILITIES],
    unmappedCli: cli.filter((command) => !mappedCli.has(command)),
    missingCli: input.cliCommands ? [...mappedCli].filter((c) => !cli.includes(c)) : [],
    unmappedMcp: mcpTools.filter((tool) => !mappedMcp.has(tool)),
    missingMcp: [...mappedMcp].filter((tool) => !mcpTools.includes(tool)),
  };
}

const SURFACE_LABEL: Record<Capability["sfFin"]["surface"], string> = {
  cli: "Fin CLI",
  mcp: "Intercom MCP",
  "agent-api": "Fin Agent API",
  none: "—",
};

export function formatSurfaceReport(report: SurfaceReport): string {
  const drift =
    report.unmappedCli.length +
    report.missingCli.length +
    report.unmappedMcp.length +
    report.missingMcp.length;
  const lines = [
    `Fin surfaces — CLI ${report.cliVersion ?? "not installed"} (${report.cliCommands} commands) · Intercom MCP (${report.mcpTools} tools) · Fin Agent API (documented)`,
    drift === 0
      ? "✅ Every CLI command and MCP tool maps to a capability."
      : `⚠ ${drift} surface change${drift === 1 ? "" : "s"} since this map was reviewed:`,
  ];
  if (report.unmappedCli.length) lines.push(`  New CLI commands: ${report.unmappedCli.join(", ")}`);
  if (report.missingCli.length)
    lines.push(`  CLI commands no longer present: ${report.missingCli.join(", ")}`);
  if (report.unmappedMcp.length) lines.push(`  New MCP tools: ${report.unmappedMcp.join(", ")}`);
  if (report.missingMcp.length)
    lines.push(`  MCP tools no longer present: ${report.missingMcp.join(", ")}`);
  if (report.cliVersion === undefined)
    lines.push("  The Fin CLI is not installed; run sf_fin action='install' to compare it.");
  lines.push("", "Capability | CLI | MCP | Agent API | SF Fin uses");
  for (const c of report.capabilities) {
    lines.push(
      `${c.label} | ${c.cli.length || "—"} | ${c.mcp.length || "—"} | ${c.agentApi.length || "—"} | ${SURFACE_LABEL[c.sfFin.surface]}: ${c.sfFin.via}`,
    );
  }
  return lines.join("\n");
}
