/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMcpReadinessWarning,
  collectVisibleManagedMcpSkills,
  configuredMcpServerNames,
  createMcpReadinessRenderer,
  parseDeclaredMcpServices,
  type ManagedMcpSkill,
  type McpServiceRequirement,
} from "../lib/mcp-readiness.ts";

const tempDirs: string[] = [];

function makeSkill(name: string, frontmatter: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "sf-skills-effective-"));
  tempDirs.push(root);
  const file = path.join(root, "sf-skills", "effective", "skills", name, "SKILL.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `---\nname: ${name}\ndescription: ${name}\n${frontmatter}---\nbody\n`,
    "utf8",
  );
  return file;
}

function service(name: string, tools: string[], semver?: string): McpServiceRequirement {
  return { name, tools, ...(semver ? { semver } : {}) };
}

function managedSkill(name: string, services: McpServiceRequirement[]): ManagedMcpSkill {
  return {
    name,
    filePath: path.join(
      process.env.HOME ?? "/home/example",
      ".pi",
      "agent",
      "sf-skills",
      "effective",
      "skills",
      name,
      "SKILL.md",
    ),
    services,
  };
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MCP skill readiness", () => {
  it("reads declared MCP services, tools, and versions from skill frontmatter", () => {
    expect(
      parseDeclaredMcpServices(
        `---\nmetadata:\n  version: "1.0"\n  mcpTools:\n    metadata-experts:\n      tools: ["execute_metadata_action"]\n      semver: ">=1.0.0"\n    salesforce-api-context:\n      tools:\n        - get_metadata_type_fields\n---\nbody\n`,
      ),
    ).toEqual([
      service("metadata-experts", ["execute_metadata_action"], ">=1.0.0"),
      service("salesforce-api-context", ["get_metadata_type_fields"]),
    ]);
  });

  it("checks only agent-invocable skills from the managed effective tree", () => {
    const visible = makeSkill(
      "experience-lwr-site-generate",
      "metadata:\n  mcpTools:\n    metadata-experts:\n      tools: [execute_metadata_action]\n",
    );
    const manual = makeSkill(
      "manual-skill",
      "metadata:\n  mcpTools:\n    headless-360:\n      tools: [discover]\ndisable-model-invocation: true\n",
    );
    const community = path.join(tempDirs[0]!, "community", "SKILL.md");
    mkdirSync(path.dirname(community), { recursive: true });
    writeFileSync(
      community,
      "---\nname: community\ndescription: community\nmetadata:\n  mcpTools:\n    community-server:\n      tools: [search]\n---\n",
    );

    expect(
      collectVisibleManagedMcpSkills([
        {
          name: "experience-lwr-site-generate",
          filePath: visible,
          disableModelInvocation: false,
        },
        { name: "manual-skill", filePath: manual, disableModelInvocation: true },
        { name: "community", filePath: community, disableModelInvocation: false },
      ]),
    ).toEqual([
      {
        name: "experience-lwr-site-generate",
        filePath: visible,
        services: [service("metadata-experts", ["execute_metadata_action"])],
      },
    ]);
  });

  it("builds one bounded warning for missing configured servers", () => {
    const warning = buildMcpReadinessWarning(
      [
        managedSkill("experience-lwr-site-generate", [
          service("metadata-experts", ["execute_metadata_action"], ">=1.0.0"),
        ]),
        managedSkill("platform-lightning-app-coordinate", [
          service("metadata-experts", ["execute_metadata_action"]),
          service("salesforce-api-context", ["get_metadata_type_fields"]),
        ]),
      ],
      new Set(["salesforce-api-context"]),
      true,
    );

    expect(warning).toEqual(
      expect.objectContaining({
        title: "Salesforce Skill Readiness",
        body: [
          "2 skills may fail or have reduced functionality because declared MCP services are not configured.",
          "Missing: metadata-experts",
          "/mcp setup · /sf-skills toggle",
        ].join("\n"),
        severity: "warning",
        missingServices: ["metadata-experts"],
      }),
    );
    expect(warning?.skills).toHaveLength(2);
    expect(warning?.skills[0]?.services[0]).toEqual(
      service("metadata-experts", ["execute_metadata_action"], ">=1.0.0"),
    );
  });

  it("uses install guidance when the MCP adapter is absent", () => {
    const warning = buildMcpReadinessWarning(
      [
        managedSkill("experience-lwr-site-generate", [
          service("metadata-experts", ["execute_metadata_action"]),
        ]),
      ],
      new Set(),
      false,
    );

    expect(warning?.body).toContain("an MCP adapter is not installed");
    expect(warning?.body).toContain("/sf-pi recommended");
  });

  it("stays silent when every declared server is configured", () => {
    expect(
      buildMcpReadinessWarning(
        [
          managedSkill("experience-lwr-site-generate", [
            service("metadata-experts", ["execute_metadata_action"]),
          ]),
        ],
        new Set(["metadata-experts"]),
        true,
      ),
    ).toBeUndefined();
  });

  it("excludes disabled MCP servers from configured availability", () => {
    expect(
      configuredMcpServerNames({
        version: 1,
        servers: [
          { name: "metadata-experts", disabled: false },
          { name: "headless-360", disabled: true },
        ],
      }),
    ).toEqual(new Set(["metadata-experts"]));
  });

  it("renders an intuitive compact card with source and actions", () => {
    const warning = buildMcpReadinessWarning(
      [
        managedSkill("experience-lwr-site-generate", [
          service("metadata-experts", ["execute_metadata_action"], ">=1.0.0"),
        ]),
      ],
      new Set(),
      true,
    );
    const renderer = createMcpReadinessRenderer();
    const rendered = renderer(
      {
        type: "custom",
        id: "entry-1",
        parentId: null,
        timestamp: Date.now(),
        customType: "sf-skills-mcp-readiness",
        data: warning,
      } as never,
      { expanded: false } as never,
      plainTheme,
    )
      .render(120)
      .join("\n");

    expect(rendered).toContain("Salesforce Skill Readiness");
    expect(rendered).toContain("1 skill may fail or have reduced functionality");
    expect(rendered).toContain("experience-lwr-site-generate");
    expect(rendered).toContain("metadata-experts");
    expect(rendered).toContain("execute_metadata_action");
    expect(rendered).toContain("~/.pi/agent/sf-skills/effective/skills");
    expect(rendered).toContain("/mcp setup");
    expect(rendered).toContain("/sf-skills toggle");
    expect(rendered).toContain("more details");
  });

  it("explains both commands in the expanded card", () => {
    const warning = buildMcpReadinessWarning(
      [
        managedSkill("experience-lwr-site-generate", [
          service("metadata-experts", ["execute_metadata_action"], ">=1.0.0"),
        ]),
      ],
      new Set(),
      true,
    );
    const renderer = createMcpReadinessRenderer();
    const rendered = renderer(
      {
        type: "custom",
        id: "entry-1",
        parentId: null,
        timestamp: Date.now(),
        customType: "sf-skills-mcp-readiness",
        data: warning,
      } as never,
      { expanded: true } as never,
      plainTheme,
    )
      .render(120)
      .join("\n");

    expect(rendered).toContain("Declared MCP configuration");
    expect(rendered).toContain("Version");
    expect(rendered).toContain("What /mcp setup does");
    expect(rendered).toContain("guided MCP setup");
    expect(rendered).toContain("What /sf-skills toggle does");
    expect(rendered).toContain("Agent-invocable");
    expect(rendered).toContain("Manual-only");
    expect(rendered).toContain("No changes were made automatically");
  });
});

describe("sf-skills MCP readiness lifecycle", () => {
  it("emits the human-only warning once on the first turn", async () => {
    const skill = makeSkill(
      "experience-lwr-site-generate",
      "metadata:\n  mcpTools:\n    metadata-experts:\n      tools: [execute_metadata_action]\n",
    );
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
    const eventListeners = new Map<string, Array<(payload: unknown) => void>>();
    const appendEntry = vi.fn();
    const pi = {
      events: {
        on: vi.fn((name: string, listener: (payload: unknown) => void) => {
          eventListeners.set(name, [...(eventListeners.get(name) ?? []), listener]);
        }),
        emit: vi.fn((name: string, payload: unknown) => {
          for (const listener of eventListeners.get(name) ?? []) listener(payload);
        }),
      },
      on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
      appendEntry,
      getCommands: vi.fn(() => []),
      getAllTools: vi.fn(() => [{ name: "mcp" }]),
    };
    const ctx = {
      hasUI: false,
      mode: "print",
      cwd: process.cwd(),
      sessionManager: { getBranch: () => [], getLeafId: () => null },
      ui: { notify: vi.fn(), custom: vi.fn(), setWorkingVisible: vi.fn() },
    };

    const { default: sfSkills } = await import("../index.ts");
    sfSkills(pi as never);
    for (const handler of handlers.get("session_start") ?? []) {
      await handler({ reason: "startup" }, ctx);
    }
    pi.events.emit("pi-mcp-adapter/status/v1", {
      version: 1,
      servers: [],
      totalTools: 0,
      totalResources: 0,
      connectedCount: 0,
      disabledCount: 0,
    });

    const event = {
      prompt: "hello",
      systemPromptOptions: {
        skills: [
          {
            name: "experience-lwr-site-generate",
            filePath: skill,
            disableModelInvocation: false,
          },
        ],
      },
    };
    for (const handler of handlers.get("before_agent_start") ?? []) {
      await handler(event, ctx);
      await handler(event, ctx);
    }

    expect(appendEntry).toHaveBeenCalledTimes(1);
    expect(appendEntry).toHaveBeenCalledWith(
      "sf-skills-mcp-readiness",
      expect.objectContaining({
        title: "Salesforce Skill Readiness",
        severity: "warning",
      }),
    );
  });
});
