/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../lib/common/manager-deep-link.ts";
import { createRuntimeRecorder, createRuntimeSandbox } from "../runtime-surface/harness.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const factoryLoaders = import.meta.glob("../../extensions/*/index.ts");

type CatalogEntry = {
  id: string;
  commands: string[];
};

const commandExtensions = (
  JSON.parse(readFileSync(path.join(ROOT, "catalog/index.json"), "utf8")) as CatalogEntry[]
).filter((entry) => entry.commands.length > 0 && entry.id !== "sf-pi-manager");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Manager-first no-args command contract", { concurrent: false }, () => {
  for (const extension of commandExtensions) {
    it(
      extension.id,
      async () => {
        expect(extension.commands, `${extension.id}: primary command declaration`).toContain(
          `/${extension.id}`,
        );

        const sandbox = createRuntimeSandbox();
        try {
          vi.resetModules();
          const factory = await loadFactory(extension.id);
          const recorder = createRuntimeRecorder();
          let request: SfPiManagerOpenRequest | undefined;
          recorder.pi.events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
            request = payload as SfPiManagerOpenRequest;
            request.accept?.();
            request.resolve?.();
          });

          factory(recorder.pi);
          const command = recorder.commandDefinitions.get(extension.id);
          expect(command?.handler, `${extension.id}: registered command handler`).toBeTypeOf(
            "function",
          );

          await command?.handler?.("", fakeInteractiveContext(sandbox.projectDir));

          expect(request?.route?.extensionId).toBe(extension.id);
          expect(request?.route?.view).toBe("detail");

          request = undefined;
          vi.spyOn(console, "info").mockImplementation(() => undefined);
          await command?.handler?.("", fakeHeadlessContext(sandbox.projectDir));
          expect(request, `${extension.id}: headless no-args must stay text-only`).toBeUndefined();
        } finally {
          sandbox.restore();
        }
      },
      10_000,
    );
  }
});

async function loadFactory(id: string): Promise<(pi: unknown) => unknown> {
  const key = `../../extensions/${id}/index.ts`;
  const loader = factoryLoaders[key];
  if (!loader) throw new Error(`Missing factory loader for ${id}: ${key}`);
  const module = (await loader()) as { default?: (pi: unknown) => unknown };
  if (typeof module.default !== "function") throw new Error(`${id} has no default factory`);
  return module.default;
}

function fakeInteractiveContext(cwd: string): ExtensionCommandContext {
  return fakeContext(cwd, true, "tui");
}

function fakeHeadlessContext(cwd: string): ExtensionCommandContext {
  return fakeContext(cwd, false, "print");
}

function fakeContext(cwd: string, hasUI: boolean, mode: "tui" | "print"): ExtensionCommandContext {
  return {
    cwd,
    hasUI,
    mode,
    ui: {
      theme: {},
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setWorkingVisible: vi.fn(),
      custom: vi.fn(async () => undefined),
      confirm: vi.fn(async () => false),
      select: vi.fn(async () => undefined),
      input: vi.fn(async () => undefined),
      editor: vi.fn(async () => undefined),
    },
  } as unknown as ExtensionCommandContext;
}
