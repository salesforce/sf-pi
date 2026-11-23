/* SPDX-License-Identifier: Apache-2.0 */
/** Workspace cards: status, doctor, setup, surfaces, workspaces, admin pages, SDK download, CLI install, and Agent API access. */
import type { FinCard, FinCardStatus, FinRow, FinSpan } from "../fin-card.ts";
import {
  FIX_LABEL,
  stripStatus,
  localTime,
  plural,
  textLines,
  humanize,
  str,
  num,
  isRecord,
  isString,
} from "./helpers.ts";
import type { CardInput, FinText } from "./helpers.ts";

// ─── Doctor, status, setup ─────────────────────────────────────────────────

interface DoctorCheck {
  id: string;
  severity: "ok" | "info" | "warn" | "error";
  title: string;
  detail?: string;
  fix?: string;
}

export function doctorCard(input: CardInput): FinCard {
  const d = input.details;
  const checks = Array.isArray(d.checks) ? (d.checks as DoctorCheck[]) : [];
  const identity = (isRecord(d.identity) ? d.identity : {}) as {
    workspaceName?: string;
    region?: string;
  };
  const ok = str(d.outcome) === "ok";
  const problems = checks.filter((c) => c.severity === "warn" || c.severity === "error");
  const passing = checks.filter((c) => c.severity === "ok");
  const notes = checks.filter((c) => c.severity === "info");
  const lines = textLines(input.text);
  return {
    status: ok ? (problems.length ? "warning" : "success") : "error",
    icon: "🔍",
    title: ok ? "SF Fin is ready" : "SF Fin needs attention",
    meta: [identity.workspaceName, identity.region?.toUpperCase()].filter(isString),
    lead: ok ? undefined : stripStatus(lines[0] ?? ""),
    blocks: [
      ...(passing.length
        ? [{ kind: "grid" as const, cells: passing.map((c) => ({ ok: true, text: c.title })) }]
        : []),
      ...(problems.length
        ? [
            {
              kind: "rows" as const,
              title: "Needs you",
              icon: "⚠",
              rows: problems.flatMap((c) => [
                {
                  icon: c.severity === "error" ? "✕" : "⚠",
                  iconTone: c.severity === "error" ? ("error" as const) : ("warning" as const),
                  value: [{ text: c.title, bold: true }] as FinSpan[],
                },
                ...(c.detail ? [{ value: [{ text: c.detail, tone: "muted" as const }] }] : []),
                ...(c.fix
                  ? [
                      {
                        value: [
                          { text: "→ ", tone: "info" as const },
                          { text: c.fix, tone: "info" as const },
                        ],
                      },
                    ]
                  : []),
              ]),
            },
          ]
        : []),
      ...notes.map((c) => ({
        kind: "text" as const,
        text: [{ text: c.detail ?? c.title, tone: "muted" as const }],
      })),
      {
        kind: "rows",
        title: "Details",
        icon: "🔍",
        rows: checks
          .filter((c) => c.detail)
          .map((c) => ({
            label: c.title,
            value: [{ text: c.detail ?? "", tone: "muted" as const }],
          })),
        expandedOnly: true,
      },
    ],
    next: !ok ? recoverNext(d) : undefined,
  };
}

function recoverNext(d: Record<string, unknown>): FinText | undefined {
  const recover = isRecord(d.recover_via) ? (d.recover_via as { command?: string }) : undefined;
  return recover?.command
    ? [{ text: "Fix it:  " }, { text: recover.command, tone: "info" }]
    : undefined;
}

export function statusCard(input: CardInput): FinCard {
  const d = input.details;
  const credential = str(d.credential);
  const cli = str(d.cliVersion);
  const latest = str(d.latestVersion);
  const outcome = str(d.lastOutcome);
  const agent = str(d.agentKey);
  const access = str(d.agentAccess);
  const connected = credential === "pi-auth" || credential === "env";
  const rows: FinRow[] = [
    connected
      ? {
          icon: "✓",
          iconTone: "success",
          label: "Signed in",
          value: [
            {
              text:
                str(d.adminName) ??
                (credential === "env" ? "token from the environment" : "token saved"),
            },
            ...(credential === "pi-auth"
              ? [{ text: "  /login sf-fin", tone: "dim" as const }]
              : []),
          ],
        }
      : {
          icon: "○",
          iconTone: "warning",
          label: "Signed in",
          value: "no token saved · /login sf-fin",
          tone: "warning",
        },
    cli
      ? {
          icon: latest && latest !== cli ? "⚠" : "✓",
          iconTone: latest && latest !== cli ? "warning" : "success",
          label: "Fin CLI",
          value: [
            { text: cli },
            {
              text:
                latest && latest !== cli
                  ? `  latest is ${latest}`
                  : str(d.installSource)
                    ? `  ${str(d.installSource)}`
                    : "",
              tone: latest && latest !== cli ? "warning" : "dim",
            },
          ],
        }
      : {
          icon: "○",
          iconTone: "warning",
          label: "Fin CLI",
          value: "not checked yet",
          tone: "muted",
        },
    {
      icon: agent === "none" ? "○" : access === "granted" ? "✓" : "⚠",
      iconTone: agent === "none" ? "dim" : access === "granted" ? "success" : "warning",
      label: "Agent API",
      value:
        agent === "none"
          ? [{ text: "no key saved (optional)", tone: "muted" }]
          : [
              { text: access ? `key saved · access ${access.replace(/_/g, " ")}` : "key saved" },
              ...(localTime(str(d.agentCheckedAt))
                ? [{ text: `  ${localTime(str(d.agentCheckedAt))}`, tone: "muted" as const }]
                : []),
            ],
    },
    {
      icon: !outcome ? "○" : outcome === "ok" ? "✓" : "✕",
      iconTone: !outcome ? "dim" : outcome === "ok" ? "success" : "error",
      label: "Last check",
      value: !outcome
        ? [{ text: "doctor never run", tone: "muted" }]
        : [
            { text: `doctor ${outcome === "ok" ? "ok" : outcome.replace(/_/g, " ")}` },
            ...(localTime(str(d.lastCheckedAt))
              ? [{ text: `  ${localTime(str(d.lastCheckedAt))}`, tone: "muted" as const }]
              : []),
          ],
    },
  ];
  const healthy = connected && outcome === "ok";
  return {
    status: healthy ? "success" : connected ? "warning" : "error",
    icon: "📋",
    title: "SF Fin",
    meta: [str(d.workspaceName), str(d.region)?.toUpperCase(), "cached, no network"].filter(
      isString,
    ),
    blocks: [
      { kind: "rows", rows },
      ...(str(d.lastMessage)
        ? [{ kind: "text" as const, text: str(d.lastMessage) ?? "", tone: "warning" as const }]
        : []),
    ],
    next: !connected
      ? "Save a Fin token with /login sf-fin, then run /sf-fin doctor."
      : !healthy
        ? "Run /sf-fin doctor to check the workspace live."
        : undefined,
  };
}

const CAPABILITY: Record<string, { label: string; detail: string }> = {
  build: { label: "Build in Fin", detail: "procedures, guidance, connectors, simulations" },
  test: { label: "Test end to end", detail: "Fin Agent API" },
  operator: { label: "Fin Operator", detail: "read data through the Intercom MCP" },
};

export function setupCard(input: CardInput): FinCard {
  const d = input.details;
  const ready = d.ready as Record<string, boolean>;
  const wants = Array.isArray(d.wants) ? (d.wants as string[]) : Object.keys(ready);
  const steps = Array.isArray(d.steps)
    ? (d.steps as Array<{ capability: string; text: string; command?: string }>)
    : [];
  const mismatches = Array.isArray(d.mismatches) ? (d.mismatches as string[]) : [];
  const credentials = Array.isArray(d.credentials)
    ? (d.credentials as Array<{ label: string; state: string; detail: string; via?: string }>)
    : [];
  const order = ["build", "test", "operator"].filter((c) => wants.includes(c));
  const readyCount = order.filter((c) => ready[c]).length;
  const missing = order.filter((c) => !ready[c]);
  const status: FinCardStatus = mismatches.length
    ? "error"
    : readyCount === order.length
      ? "success"
      : readyCount === 0
        ? "error"
        : "warning";
  const step = steps[0];
  return {
    status,
    icon: "🧰",
    title: "Fin workspace setup",
    meta: [
      d.workspace ? `${String(d.workspace)}${d.kind ? ` (${String(d.kind)})` : ""}` : undefined,
      str(d.workspaceName),
    ].filter(isString),
    lead: [
      {
        text: `${readyCount} of ${order.length} ready.`,
        bold: true,
        tone: status === "success" ? "success" : undefined,
      },
      ...(missing.length === 1 && !mismatches.length
        ? [
            {
              text: ` Missing: ${CAPABILITY[missing[0] ?? ""]?.label ?? missing[0]}.`,
              tone: "muted" as const,
            },
          ]
        : []),
    ],
    blocks: [
      {
        kind: "rows",
        rows: order.map((c) => ({
          icon: ready[c] ? "✓" : "○",
          iconTone: ready[c] ? ("success" as const) : ("warning" as const),
          label: CAPABILITY[c]?.label ?? c,
          value: [{ text: CAPABILITY[c]?.detail ?? "", tone: "muted" as const }],
        })),
      },
      ...(mismatches.length
        ? [
            {
              kind: "rows" as const,
              title: "Wrong workspace",
              icon: "✕",
              rows: mismatches.map((m) => ({ icon: "✕", iconTone: "error" as const, value: m })),
            },
          ]
        : []),
      ...(credentials.length
        ? [
            {
              kind: "rows" as const,
              title: "Sign-ins",
              icon: "🔑",
              rows: credentials.map((c) => ({
                icon: c.state === "ok" ? "✓" : c.state === "rejected" ? "✕" : "○",
                iconTone:
                  c.state === "ok"
                    ? ("success" as const)
                    : c.state === "rejected"
                      ? ("error" as const)
                      : ("dim" as const),
                label: c.label,
                value: [
                  { text: c.detail, tone: c.state === "ok" ? undefined : ("muted" as const) },
                  ...(c.via && c.state !== "ok"
                    ? [{ text: `  ${c.via}`, tone: "dim" as const }]
                    : []),
                ],
              })),
              expandedOnly: status === "success",
            },
          ]
        : []),
    ],
    next: step
      ? [
          { text: step.text.replace(/\.$/u, "") },
          ...(step.command && step.command.startsWith("/")
            ? [{ text: "  " }, { text: step.command, tone: "info" as const }]
            : []),
        ]
      : undefined,
  };
}

export function surfacesCard(input: CardInput): FinCard {
  const d = input.details;
  const drift = [d.unmappedCli, d.missingCli, d.unmappedMcp, d.missingMcp].flatMap((l) =>
    Array.isArray(l) ? (l as string[]) : [],
  );
  const capabilities = Array.isArray(d.capabilities)
    ? (d.capabilities as Array<{
        id: string;
        cli: number;
        mcp: number;
        agentApi: number;
        sfFin: { surface: string; via: string };
      }>)
    : [];
  const by = (surface: string) => capabilities.filter((c) => c.sfFin.surface === surface).length;
  const list = (key: string, label: string) => {
    const items = Array.isArray(d[key]) ? (d[key] as string[]) : [];
    return items.length
      ? [{ icon: "⚠", iconTone: "warning" as const, label, value: items.join(", ") }]
      : [];
  };
  return {
    status: !d.cliVersion ? "warning" : drift.length ? "warning" : "success",
    icon: "🧭",
    title: "Fin surfaces",
    meta: [d.cliVersion ? `CLI ${String(d.cliVersion)}` : "CLI not installed"],
    lead: [
      {
        text: `${String(d.cliCommands ?? 0)} CLI commands · ${String(d.mcpTools ?? 0)} MCP tools`,
        bold: true,
      },
      {
        text: drift.length
          ? `  ${drift.length} changed since the map was reviewed`
          : "  every one is mapped",
        tone: drift.length ? "warning" : "muted",
      },
    ],
    blocks: [
      {
        kind: "rows",
        title: "SF Fin uses",
        icon: "🧭",
        rows: [
          { label: "Fin CLI", value: plural(by("cli"), "capability", "capabilities") },
          { label: "Intercom MCP", value: plural(by("mcp"), "capability", "capabilities") },
          { label: "Fin Agent API", value: plural(by("agent-api"), "capability", "capabilities") },
        ],
      },
      ...(drift.length
        ? [
            {
              kind: "rows" as const,
              rows: [
                ...list("unmappedCli", "New CLI"),
                ...list("missingCli", "Gone CLI"),
                ...list("unmappedMcp", "New MCP"),
                ...list("missingMcp", "Gone MCP"),
              ],
            },
          ]
        : []),
      {
        kind: "rows",
        title: "Each capability",
        icon: "📋",
        rows: capabilities.map((c) => ({
          label: humanize(c.id),
          value: [
            { text: c.sfFin.via },
            { text: `  CLI ${c.cli || "—"} · MCP ${c.mcp || "—"}`, tone: "dim" as const },
          ],
        })),
        expandedOnly: true,
      },
    ],
  };
}

export function workspacesCard(input: CardInput): FinCard {
  const d = input.details;
  const active = str(d.active);
  const workspaces = Object.values(
    d.workspaces as Record<
      string,
      { name: string; kind?: string; appId?: string; region?: string; workspaceName?: string }
    >,
  );
  return {
    status: "info",
    icon: "🗂️",
    title: "Fin workspaces",
    meta: [`${workspaces.length} profile${workspaces.length === 1 ? "" : "s"}`],
    blocks: [
      {
        kind: "rows",
        rows: workspaces.map((w) => ({
          icon: w.name === active ? "▶" : " ",
          iconTone: "info" as const,
          value: [
            { text: w.name, bold: w.name === active },
            {
              text: `  ${w.kind ?? "test"}`,
              tone: w.kind === "prod" ? ("warning" as const) : ("muted" as const),
            },
            ...(w.workspaceName ? [{ text: `  ${w.workspaceName}`, tone: "muted" as const }] : []),
            ...(w.region ? [{ text: `  ${w.region.toUpperCase()}`, tone: "muted" as const }] : []),
            ...(w.appId ? [] : [{ text: "  not verified yet", tone: "warning" as const }]),
          ],
        })),
      },
    ],
    hint: "▶ is the active workspace.",
  };
}

export function adminPagesCard(input: CardInput): FinCard {
  const d = input.details;
  const pages = d.pageGuide as Array<{ id: string; useFor: string; secret: boolean }>;
  return {
    status: d.appBound === false ? "warning" : "info",
    icon: "🌐",
    title: "Fin admin pages",
    meta: [d.workspace ? `workspace ${String(d.workspace)}` : undefined].filter(isString),
    blocks: [
      {
        kind: "rows",
        rows: pages.map((p) => ({
          icon: p.secret ? "🔒" : "•",
          label: p.id,
          value: p.useFor,
        })),
      },
    ],
    next:
      d.appBound === false
        ? "Run /sf-fin setup first so the workspace's app is verified."
        : undefined,
    hint: `🔒 pages are masked and never screenshotted. Sign-in is saved by Pi${d.loginId ? ` (/login ${String(d.loginId)})` : ""}.`,
  };
}

/**
 * A masked admin page read. The summary lines are accessibility-tree nodes
 * (`heading "…"`, `cell "…"`); the card keeps only their visible text,
 * headings as section breaks, and drops controls.
 */
export function adminReadCard(input: CardInput): FinCard {
  const d = input.details;
  const nodes = (d.lines as string[]).flatMap((line) => {
    // A bare `cell` (no text) ends a table row in Fin's tables.
    if (/^cell\s*$/u.test(line)) return [{ role: "row-end", text: "" }];
    const m = /^(\w+)\s+"((?:[^"\\]|\\.)*)"/u.exec(line);
    return m ? [{ role: m[1] ?? "", text: (m[2] ?? "").trim() }] : [];
  });
  const label = str(d.label) ?? humanize(str(d.page) ?? "page");
  const rows: FinRow[] = [];
  let cells: string[] = [];
  const flushCells = () => {
    if (cells.length) rows.push({ icon: "•", iconTone: "muted", value: cells.join("  ·  ") });
    cells = [];
  };
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.role === "row-end") {
      flushCells();
      continue;
    }
    if (!node.text || seen.has(`${node.role}:${node.text}`)) continue;
    if (node.role !== "cell") seen.add(`${node.role}:${node.text}`);
    if (node.role === "heading") {
      flushCells();
      if (node.text !== label) rows.push({ value: [{ text: node.text, bold: true }] });
    } else if (node.role === "cell") {
      if (node.text === "-" || /^Drag to reorder$|actions$/iu.test(node.text)) continue;
      cells.push(node.text);
      if (cells.length >= 8) flushCells();
    }
  }
  flushCells();
  const shown = rows.slice(0, 10);
  return {
    status: "info",
    icon: d.secretPage === true ? "🔒" : "🌐",
    title: label,
    meta: [d.workspace ? `workspace ${String(d.workspace)}` : undefined, "masked"].filter(isString),
    blocks: [
      ...(shown.length
        ? [{ kind: "rows" as const, rows: shown }]
        : [
            {
              kind: "text" as const,
              text: [{ text: "Nothing readable on the page.", tone: "muted" as const }],
            },
          ]),
      ...(rows.length > shown.length
        ? [
            {
              kind: "text" as const,
              text: [
                { text: `+${rows.length - shown.length} more in the page`, tone: "muted" as const },
              ],
            },
          ]
        : []),
    ],
    hint:
      d.secretPage === true
        ? "Secret page: text is masked and screenshots are refused."
        : undefined,
  };
}

/** SDK download: counted by top folder; the full list stays in the model text. */
export function downloadCard(input: CardInput): FinCard {
  const d = input.details;
  const files = d.files as Array<{ path: string; bytes?: number }>;
  const total = Number(/(\d+) files/u.exec(input.text)?.[1] ?? files.length);
  const groups = new Map<string, number>();
  for (const file of files) {
    const parts = file.path.split("/");
    const key =
      parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts.length === 2 ? (parts[0] ?? "") : ".";
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return {
    status: input.ok ? "success" : "error",
    icon: "📥",
    title: input.ok ? "Fin SDK downloaded" : "Fin SDK download failed",
    meta: [`${total} files`, d.enabledNow === true ? "SDK enabled now" : undefined].filter(
      isString,
    ),
    blocks: [
      {
        kind: "rows",
        rows: [...groups].map(([folder, n]) => ({
          icon: "📁",
          label: folder === "." ? "(top level)" : folder,
          value: [{ text: `${n} file${n === 1 ? "" : "s"}`, tone: "muted" as const }],
        })),
      },
      ...(total > files.length
        ? [
            {
              kind: "text" as const,
              text: [
                {
                  text: `Counts cover the first ${files.length} of ${total} files.`,
                  tone: "muted" as const,
                },
              ],
            },
          ]
        : []),
      ...(str(d.extractDir)
        ? [
            {
              kind: "rows" as const,
              rows: [
                {
                  icon: "📂",
                  label: "Saved in",
                  value: [{ text: shortPath(str(d.extractDir) ?? ""), tone: "muted" as const }],
                },
              ],
            },
          ]
        : []),
    ],
  };
}

function shortPath(p: string): string {
  const home = /^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)$/u.exec(p);
  return home ? `~${home[2]}` : p;
}

export function errorLogsCard(input: CardInput): FinCard {
  const d = input.details;
  const diagnoses = d.diagnoses as Array<{
    code: string;
    object?: string;
    advice: string;
    fix?: string;
    count: number;
    latest?: string;
  }>;
  const total = num(d.errorCount) ?? 0;
  return {
    status: total ? "warning" : "success",
    icon: "🧾",
    title: "Fin error logs",
    meta: [total ? `${total} error${total === 1 ? "" : "s"}` : "no errors"],
    lead: total ? undefined : "No API errors. Fin clears an entry once its retry succeeds.",
    blocks: diagnoses.length
      ? [
          {
            kind: "rows",
            rows: diagnoses.flatMap((g) => [
              {
                icon: "⚠",
                iconTone: "warning" as const,
                value: [
                  { text: g.code, bold: true },
                  ...(g.object ? [{ text: ` on ${g.object}` }] : []),
                  { text: `  ×${g.count}`, tone: "muted" as const },
                  ...(g.latest ? [{ text: `  ${g.latest}`, tone: "muted" as const }] : []),
                ],
              },
              { value: [{ text: g.advice, tone: "muted" as const }] },
              ...(g.fix
                ? [
                    {
                      value: [
                        { text: `→ ${FIX_LABEL[g.fix] ?? humanize(g.fix)}`, tone: "info" as const },
                      ],
                    },
                  ]
                : []),
            ]),
          },
        ]
      : [],
    hint: total ? "System error text can hold record data, so it is not shown." : undefined,
  };
}

export function installCard(input: CardInput): FinCard {
  const d = input.details;
  const plan = d.plan as { kind: string; version?: string; reason?: string; command?: string };
  if (str(d.phase) === "execute") {
    const ok = d.ok !== false;
    return {
      status: ok ? "success" : "error",
      icon: "📦",
      title: ok
        ? `Fin CLI ${str(d.cliVersion) ?? plan.version ?? ""} installed`.trim()
        : "Fin CLI install failed",
      lead: stripStatus(textLines(input.text)[0] ?? ""),
      next: ok ? [{ text: "Check it:  " }, { text: "/sf-fin doctor", tone: "info" }] : undefined,
    };
  }
  if (plan.kind === "noop") {
    return {
      status: "success",
      icon: "📦",
      title: `Fin CLI ${plan.version ?? ""} is installed`.replace("  ", " "),
      meta: ["nothing to do"],
    };
  }
  if (plan.kind === "refused") {
    return {
      status: "error",
      icon: "📦",
      title: "Fin CLI install refused",
      lead: plan.reason ?? stripStatus(textLines(input.text)[0] ?? ""),
    };
  }
  return {
    status: "warning",
    icon: "📦",
    title: `${plan.kind === "update" ? "Update" : "Install"} the Fin CLI${plan.version ? ` ${plan.version}` : ""}`,
    meta: ["plan · nothing changed yet"],
    lead: plan.reason,
    blocks: plan.command
      ? [
          {
            kind: "rows",
            rows: [
              { icon: "🛠️", label: "Runs", value: [{ text: plan.command, tone: "info" }] },
              {
                icon: "🔒",
                label: "Approval",
                value: [
                  { text: "SF Guardrail asks you first  " },
                  { text: "native-sf-fin-cli-install", tone: "dim" },
                ],
              },
            ],
          },
        ]
      : [],
    next: [
      { text: "To go ahead, ask the agent or run  " },
      { text: "/sf-fin install", tone: "info" },
      { text: "  · you approve first", tone: "muted" },
    ],
  };
}

export function accessCard(input: CardInput): FinCard {
  const d = input.details;
  const access = str(d.access);
  const granted = access === "granted";
  return {
    status: granted ? "success" : "warning",
    icon: "🤖",
    title: granted ? "Fin Agent API access granted" : "Fin Agent API access not ready",
    lead: [{ text: stripStatus(textLines(input.text)[0] ?? ""), tone: "muted" }],
    next: granted
      ? undefined
      : access === "no_key"
        ? [{ text: "Save the key:  " }, { text: "/login sf-fin-agent", tone: "info" }]
        : undefined,
    hint: granted ? "Checking access creates no conversation and costs nothing." : undefined,
  };
}
