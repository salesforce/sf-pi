/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareRuntimeSurface,
  compareToolUnion,
  createRuntimeSandbox,
  runRuntimeScenario,
} from "../runtime-surface/harness.ts";
import type {
  CapturedRuntimeSurface,
  ManifestRuntimeSurface,
  RuntimeSurfaceScenario,
  RuntimeSurfaceScenarioModule,
} from "../runtime-surface/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const factoryLoaders = import.meta.glob("../../extensions/*/index.ts");
const scenarioLoaders = import.meta.glob("../../extensions/*/tests/runtime-surface-scenarios.ts");

function readManifests(): ManifestRuntimeSurface[] {
  return readdirSync(path.join(ROOT, "extensions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifest = JSON.parse(
        readFileSync(path.join(ROOT, "extensions", entry.name, "manifest.json"), "utf8"),
      ) as Partial<ManifestRuntimeSurface>;
      return {
        id: String(manifest.id),
        commands: manifest.commands ?? [],
        providers: manifest.providers ?? [],
        tools: manifest.tools ?? [],
        events: manifest.events ?? [],
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

const manifests = readManifests();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("runtime surface comparator", () => {
  const manifest: ManifestRuntimeSurface = {
    id: "sample",
    commands: ["/sample"],
    providers: ["sample-provider"],
    tools: ["sample_tool"],
    events: ["session_start"],
  };

  it("reports manifest declarations missing from runtime", () => {
    const differences = compareRuntimeSurface(manifest, emptyCapture());
    expect(differences).toEqual([
      { surface: "commands", missing: ["/sample"], undeclared: [], duplicates: [] },
      {
        surface: "providers",
        missing: ["sample-provider"],
        undeclared: [],
        duplicates: [],
      },
      { surface: "tools", missing: ["sample_tool"], undeclared: [], duplicates: [] },
      { surface: "events", missing: ["session_start"], undeclared: [], duplicates: [] },
    ]);
  });

  it("reports undeclared and duplicate runtime registrations", () => {
    const captured: CapturedRuntimeSurface = {
      commands: ["/sample", "/extra", "/extra"],
      providers: ["sample-provider"],
      tools: ["sample_tool", "extra_tool"],
      events: ["session_start"],
      eventHandlerCounts: { session_start: 1 },
    };
    expect(compareRuntimeSurface(manifest, captured)).toEqual([
      { surface: "commands", missing: [], undeclared: ["/extra"], duplicates: ["/extra"] },
      { surface: "tools", missing: [], undeclared: ["extra_tool"], duplicates: [] },
    ]);
  });

  it("treats duplicate event handlers as one declared event", () => {
    const captured: CapturedRuntimeSurface = {
      commands: ["/sample"],
      providers: ["sample-provider"],
      tools: ["sample_tool"],
      events: ["session_start"],
      eventHandlerCounts: { session_start: 2 },
    };
    expect(compareRuntimeSurface(manifest, captured)).toEqual([]);
  });

  it("normalizes command names at the recorder seam", async () => {
    const sandbox = createRuntimeSandbox();
    try {
      const result = await runRuntimeScenario({
        manifest: { ...manifest, providers: [], tools: [], events: [] },
        projectDir: sandbox.projectDir,
        scenario: { name: "command", invoke: [], expectedTools: "none" },
        factory(pi) {
          (pi as { registerCommand(name: string): void }).registerCommand("sample");
        },
      });
      expect(result.captured.commands).toEqual(["/sample"]);
    } finally {
      sandbox.restore();
    }
  });
});

describe("runtime surface isolation", () => {
  const manifest: ManifestRuntimeSurface = {
    id: "isolation",
    commands: [],
    providers: [],
    tools: [],
    events: ["session_start"],
  };

  it("records a caught network attempt as an attestation failure signal", async () => {
    const sandbox = createRuntimeSandbox();
    try {
      const result = await runRuntimeScenario({
        manifest,
        projectDir: sandbox.projectDir,
        scenario: { name: "network", invoke: ["session_start"], expectedTools: "none" },
        factory(pi) {
          (pi as { on(name: string, handler: () => Promise<void>): void }).on(
            "session_start",
            async () => {
              try {
                await fetch("https://example.invalid/runtime-surface");
              } catch {
                // The harness must record attempts even when extension code catches them.
              }
            },
          );
        },
      });
      expect(result.unexpectedFetches).toEqual(["https://example.invalid/runtime-surface"]);
    } finally {
      sandbox.restore();
    }
  });

  it("records a caught pi.exec attempt as an attestation failure signal", async () => {
    const sandbox = createRuntimeSandbox();
    try {
      const result = await runRuntimeScenario({
        manifest,
        projectDir: sandbox.projectDir,
        scenario: { name: "exec", invoke: ["session_start"], expectedTools: "none" },
        factory(pi) {
          const api = pi as {
            on(name: string, handler: () => Promise<void>): void;
            exec(command: string, args?: string[]): Promise<unknown>;
          };
          api.on("session_start", async () => {
            try {
              await api.exec("sf", ["version"]);
            } catch {
              // The harness must record attempts even when extension code catches them.
            }
          });
        },
      });
      expect(result.unexpectedExecs).toEqual(["sf version"]);
    } finally {
      sandbox.restore();
    }
  });

  it("fails a lifecycle handler that exceeds its bounded timeout", async () => {
    const sandbox = createRuntimeSandbox();
    try {
      await expect(
        runRuntimeScenario({
          manifest,
          projectDir: sandbox.projectDir,
          scenario: {
            name: "timeout",
            invoke: ["session_start"],
            expectedTools: "none",
            timeoutMs: 20,
          },
          factory(pi) {
            (pi as { on(name: string, handler: () => Promise<void>): void }).on(
              "session_start",
              () => new Promise(() => undefined),
            );
          },
        }),
      ).rejects.toThrow("Timed out: isolation/timeout/session_start");
    } finally {
      sandbox.restore();
    }
  });

  it("restores cwd and environment after a scenario sandbox", () => {
    const cwd = process.cwd();
    const previous = process.env.SLACK_USER_TOKEN;
    const sandbox = createRuntimeSandbox();
    process.env.SLACK_USER_TOKEN = "synthetic";
    sandbox.restore();
    expect(process.cwd()).toBe(cwd);
    expect(process.env.SLACK_USER_TOKEN).toBe(previous);
  });
});

describe("real extension factories match manifest runtime surfaces", { concurrent: false }, () => {
  for (const manifest of manifests) {
    it(
      manifest.id,
      async () => {
        for (const surface of ["commands", "providers", "tools", "events"] as const) {
          expect(
            new Set(manifest[surface]).size,
            `${manifest.id}: duplicate manifest ${surface}`,
          ).toBe(manifest[surface].length);
        }

        const captures: CapturedRuntimeSurface[] = [];
        const baseline = await execute(manifest, {
          name: "factory",
          invoke: [],
          expectedTools: "subset",
        });
        captures.push(baseline);
        expectStaticSurfaces(manifest, baseline, "factory");
        expectScenarioTools(manifest, baseline, "subset", "factory");

        const baselineTools = new Set(baseline.tools);
        const missingAfterFactory = manifest.tools.filter((tool) => !baselineTools.has(tool));
        if (missingAfterFactory.length > 0) {
          const adapter = await loadScenarioAdapter(manifest.id);
          const scenarios = adapter?.scenarios ?? [defaultStartupScenario()];
          if (!adapter && ["sf-herdr", "sf-slack"].includes(manifest.id)) {
            throw new Error(`${manifest.id} requires a local runtime-surface scenario adapter`);
          }
          for (const scenario of scenarios) {
            const captured = await execute(manifest, scenario);
            captures.push(captured);
            expectStaticSurfaces(manifest, captured, scenario.name);
            expectScenarioTools(manifest, captured, scenario.expectedTools, scenario.name);
          }
        }

        const unionDifference = compareToolUnion(manifest.tools, captures);
        expect(unionDifference, `${manifest.id}: tool availability union`).toEqual({
          surface: "tools",
          missing: [],
          undeclared: [],
          duplicates: [],
        });
      },
      20_000,
    );
  }
});

async function execute(
  manifest: ManifestRuntimeSurface,
  scenario: RuntimeSurfaceScenario,
): Promise<CapturedRuntimeSurface> {
  const sandbox = createRuntimeSandbox();
  try {
    vi.resetModules();
    const factory = await loadFactory(manifest.id);
    const result = await runRuntimeScenario({
      factory,
      manifest,
      scenario,
      projectDir: sandbox.projectDir,
    });
    const expectedFetchSuffixes = scenario.expectedFetchSuffixes ?? [];
    expect(result.fetchCalls.length, `${manifest.id}/${scenario.name}: fetch call count`).toBe(
      expectedFetchSuffixes.length,
    );
    expectedFetchSuffixes.forEach((suffix, index) => {
      expect(
        result.fetchCalls[index]?.endsWith(suffix),
        `${manifest.id}/${scenario.name}: fetch ${index}`,
      ).toBe(true);
    });
    expect(result.unexpectedFetches, `${manifest.id}/${scenario.name}: unexpected fetch`).toEqual(
      [],
    );
    expect(result.unexpectedExecs, `${manifest.id}/${scenario.name}: unexpected pi.exec`).toEqual(
      [],
    );
    expect(result.invokedEvents).toEqual(scenario.invoke);
    return result.captured;
  } finally {
    sandbox.restore();
  }
}

async function loadFactory(id: string): Promise<(pi: unknown) => unknown> {
  const key = `../../extensions/${id}/index.ts`;
  const loader = factoryLoaders[key];
  if (!loader) throw new Error(`Missing factory loader for ${id}: ${key}`);
  const module = (await loader()) as { default?: (pi: unknown) => unknown };
  if (typeof module.default !== "function") throw new Error(`${id} has no default factory`);
  return module.default;
}

async function loadScenarioAdapter(id: string): Promise<RuntimeSurfaceScenarioModule | undefined> {
  const key = `../../extensions/${id}/tests/runtime-surface-scenarios.ts`;
  const loader = scenarioLoaders[key];
  if (!loader) return undefined;
  return (await loader()) as RuntimeSurfaceScenarioModule;
}

function defaultStartupScenario(): RuntimeSurfaceScenario {
  return {
    name: "startup",
    invoke: ["session_start"],
    expectedTools: "manifest",
  };
}

function expectStaticSurfaces(
  manifest: ManifestRuntimeSurface,
  captured: CapturedRuntimeSurface,
  scenario: string,
): void {
  const differences = compareRuntimeSurface({ ...manifest, tools: captured.tools }, captured);
  expect(differences, `${manifest.id}/${scenario}: commands/providers/events`).toEqual([]);
}

function expectScenarioTools(
  manifest: ManifestRuntimeSurface,
  captured: CapturedRuntimeSurface,
  expectation: RuntimeSurfaceScenario["expectedTools"],
  scenario: string,
): void {
  const manifestTools = new Set(manifest.tools);
  const undeclared = captured.tools.filter((tool) => !manifestTools.has(tool));
  const duplicates = captured.tools.filter((tool, index) => captured.tools.indexOf(tool) !== index);
  expect(undeclared, `${manifest.id}/${scenario}: undeclared tools`).toEqual([]);
  expect([...new Set(duplicates)], `${manifest.id}/${scenario}: duplicate tools`).toEqual([]);
  if (expectation === "none") {
    expect(captured.tools, `${manifest.id}/${scenario}: expected no tools`).toEqual([]);
  } else if (expectation === "manifest") {
    expect(
      [...captured.tools].sort(),
      `${manifest.id}/${scenario}: expected manifest tools`,
    ).toEqual([...manifest.tools].sort());
  }
}

function emptyCapture(): CapturedRuntimeSurface {
  return {
    commands: [],
    providers: [],
    tools: [],
    events: [],
    eventHandlerCounts: {},
  };
}
