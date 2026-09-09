/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  CapturedRuntimeSurface,
  ManifestRuntimeSurface,
  RuntimeSurfaceDifference,
  RuntimeSurfaceScenario,
  RuntimeSurfaceName,
} from "./types.ts";

type Handler = (event: unknown, context: unknown) => unknown;
type CommandDefinition = {
  handler?: (args: string, context: unknown) => unknown;
};
type Factory = (pi: unknown) => unknown;

interface RecorderOptions {
  activeTools?: string[];
  providerApiKeys?: Record<string, string | undefined>;
}

export interface RuntimeScenarioResult {
  captured: CapturedRuntimeSurface;
  fetchCalls: string[];
  unexpectedFetches: string[];
  unexpectedExecs: string[];
  invokedEvents: string[];
}

export interface RuntimeSandbox {
  projectDir: string;
  agentDir: string;
  restore(): void;
}

const INTEGRATION_ENV_KEYS = [
  "SLACK_USER_TOKEN",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_REDIRECT_URI",
  "SLACK_TEAM_ID",
  "SLACK_SCOPES",
  "SLACK_ALLOW_HEADLESS_SEND",
  "SLACK_SEND_DRY_RUN",
  "HERDR_ENV",
  "HERDR_PANE_ID",
  "SF_DOCS_MCP_ENDPOINT",
  "SF_PI_ANNOUNCEMENTS_FEED",
  "SF_PI_SAFE_START",
] as const;

export function createRuntimeSandbox(): RuntimeSandbox {
  const root = mkdtempSync(path.join(tmpdir(), "sf-pi-runtime-surface-"));
  const projectDir = path.join(root, "project");
  const agentDir = path.join(root, "agent");
  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  process.chdir(root);
  process.env.HOME = root;
  process.env.USERPROFILE = root;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const key of INTEGRATION_ENV_KEYS) delete process.env[key];

  return {
    projectDir,
    agentDir,
    restore() {
      process.chdir(previousCwd);
      for (const key of Object.keys(process.env)) {
        if (!(key in previousEnv)) delete process.env[key];
      }
      Object.assign(process.env, previousEnv);
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    },
  };
}

export function createRuntimeRecorder(options: RecorderOptions = {}) {
  const commands: string[] = [];
  const providers: string[] = [];
  const tools: string[] = [];
  const events: string[] = [];
  const entryRenderers: string[] = [];
  const handlers = new Map<string, Handler[]>();
  const activeTools = new Set(options.activeTools ?? []);
  const registeredTools = new Map<string, unknown>();
  const commandDefinitions = new Map<string, CommandDefinition>();
  const unexpectedExecs: string[] = [];
  const busHandlers = new Map<string, Array<(payload: unknown) => void>>();

  const eventsBus = {
    on(name: string, handler: (payload: unknown) => void) {
      busHandlers.set(name, [...(busHandlers.get(name) ?? []), handler]);
      return () => {
        const next = (busHandlers.get(name) ?? []).filter((candidate) => candidate !== handler);
        busHandlers.set(name, next);
      };
    },
    emit(name: string, payload: unknown) {
      for (const handler of busHandlers.get(name) ?? []) handler(payload);
    },
  };

  const pi = {
    events: eventsBus,
    on(name: string, handler: Handler) {
      events.push(name);
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return () => undefined;
    },
    registerCommand(name: string, definition: CommandDefinition = {}) {
      commands.push(name.startsWith("/") ? name : `/${name}`);
      commandDefinitions.set(name.replace(/^\//, ""), definition);
    },
    registerProvider(provider: { id?: string } | string) {
      const id = typeof provider === "string" ? provider : provider?.id;
      if (!id) throw new Error("registerProvider called without an id");
      providers.push(id);
    },
    registerTool(definition: { name?: string }) {
      if (!definition?.name) throw new Error("registerTool called without a name");
      tools.push(definition.name);
      registeredTools.set(definition.name, definition);
      activeTools.add(definition.name);
    },
    registerEntryRenderer(name: string) {
      entryRenderers.push(name);
    },
    registerMessageRenderer() {},
    registerFlag() {},
    registerShortcut() {},
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return [...registeredTools.values()];
    },
    setActiveTools(names: string[]) {
      activeTools.clear();
      for (const name of names) activeTools.add(name);
    },
    async exec(command: string, args: string[] = []) {
      unexpectedExecs.push([command, ...args].join(" "));
      throw new Error(`Unexpected pi.exec during runtime-surface attestation: ${command}`);
    },
    appendEntry() {},
    sendMessage() {},
    getModelRegistry() {
      return {
        getApiKeyForProvider: async (id: string) => options.providerApiKeys?.[id],
      };
    },
    getAllModels() {
      return [];
    },
    getCurrentModel() {
      return undefined;
    },
    getThinkingLevel() {
      return "off";
    },
  };

  return {
    pi,
    handlers,
    commandDefinitions,
    unexpectedExecs,
    capture(): CapturedRuntimeSurface {
      return {
        commands: [...commands],
        providers: [...providers],
        tools: [...tools],
        events: [...new Set(events)],
        eventHandlerCounts: Object.fromEntries(
          [...handlers.entries()].map(([name, registered]) => [name, registered.length]),
        ),
      };
    },
  };
}

export async function runRuntimeScenario(options: {
  factory: Factory;
  manifest: ManifestRuntimeSurface;
  scenario: RuntimeSurfaceScenario;
  projectDir: string;
}): Promise<RuntimeScenarioResult> {
  const { factory, manifest, scenario, projectDir } = options;
  for (const [key, value] of Object.entries(scenario.env ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const recorder = createRuntimeRecorder({
    activeTools: scenario.activeTools,
    providerApiKeys: scenario.providerApiKeys,
  });
  const fetchCalls: string[] = [];
  const unexpectedFetches: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    fetchCalls.push(target);
    if (scenario.fetch) return scenario.fetch(input, init);
    unexpectedFetches.push(target);
    throw new Error(`Unexpected fetch during ${manifest.id}/${scenario.name}: ${target}`);
  }) as typeof fetch;

  const controller = new AbortController();
  const context = createHeadlessContext(projectDir, controller.signal, scenario.providerApiKeys);
  const invokedEvents: string[] = [];

  try {
    factory(recorder.pi);
    for (const eventName of scenario.invoke) {
      const registered = recorder.handlers.get(eventName) ?? [];
      if (registered.length === 0) {
        throw new Error(
          `${manifest.id}/${scenario.name} requested unregistered event ${eventName}`,
        );
      }
      const event = createEvent(eventName, projectDir);
      for (const handler of registered) {
        await withTimeout(
          Promise.resolve(handler(event, context)),
          scenario.timeoutMs ?? 5_000,
          `${manifest.id}/${scenario.name}/${eventName}`,
        );
      }
      invokedEvents.push(eventName);
    }

    return {
      captured: recorder.capture(),
      fetchCalls,
      unexpectedFetches,
      unexpectedExecs: recorder.unexpectedExecs,
      invokedEvents,
    };
  } finally {
    controller.abort();
    globalThis.fetch = originalFetch;
  }
}

function createHeadlessContext(
  cwd: string,
  signal: AbortSignal,
  providerApiKeys: Record<string, string | undefined> = {},
) {
  const ui = {
    theme: {},
    notify() {},
    setStatus() {},
    setWidget() {},
    setFooter() {},
    setHeader() {},
    setWorkingIndicator() {},
    custom: async () => undefined,
    confirm: async () => false,
    select: async () => undefined,
    input: async () => undefined,
    editor: async () => undefined,
  };
  return {
    cwd,
    hasUI: false,
    mode: "print",
    signal,
    ui,
    modelRegistry: {
      getApiKeyForProvider: async (id: string) => providerApiKeys[id],
    },
    env: async (name: string) => process.env[name],
    getContextUsage: () => undefined,
    getSessionName: () => undefined,
    sessionManager: {
      getSessionId: () => "runtime-surface-session",
      getBranch: () => [],
      getEntries: () => [],
    },
  };
}

function createEvent(name: string, cwd: string): Record<string, unknown> {
  if (name === "session_start") return { type: name, reason: "startup", cwd };
  if (name === "resources_discover") return { type: name, reason: "reload", cwd };
  if (name === "session_shutdown") return { type: name, cwd };
  return { type: name, cwd };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function compareRuntimeSurface(
  manifest: ManifestRuntimeSurface,
  captured: CapturedRuntimeSurface,
): RuntimeSurfaceDifference[] {
  return (["commands", "providers", "tools", "events"] as RuntimeSurfaceName[])
    .map((surface) => compareOne(surface, manifest[surface], captured[surface]))
    .filter(
      (difference) =>
        difference.missing.length + difference.undeclared.length + difference.duplicates.length > 0,
    );
}

export function compareToolUnion(
  manifestTools: string[],
  scenarios: CapturedRuntimeSurface[],
): RuntimeSurfaceDifference {
  const union = [...new Set(scenarios.flatMap((scenario) => scenario.tools))];
  return compareOne("tools", manifestTools, union);
}

function compareOne(
  surface: RuntimeSurfaceName,
  expectedValues: string[],
  actualValues: string[],
): RuntimeSurfaceDifference {
  const expected = new Set(expectedValues);
  const actual = new Set(actualValues);
  return {
    surface,
    missing: [...expected].filter((value) => !actual.has(value)).sort(),
    undeclared: [...actual].filter((value) => !expected.has(value)).sort(),
    duplicates: duplicates(actualValues),
  };
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
}
