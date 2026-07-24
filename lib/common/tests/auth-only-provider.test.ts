/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for authentication-only Pi providers. */
import { describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore, createModels } from "@earendil-works/pi-ai";
import { createAuthOnlyProvider } from "../auth-only-provider.ts";

describe("createAuthOnlyProvider", () => {
  it("participates in Pi login, auth resolution, and logout without exposing models", async () => {
    const provider = createAuthOnlyProvider({
      id: "fixture-auth",
      name: "Fixture Auth",
      auth: {
        apiKey: {
          name: "Fixture token",
          login: async () => ({ type: "api_key", key: "fixture-private" }),
          resolve: async ({ credential }) =>
            credential?.key
              ? { auth: { apiKey: credential.key }, source: "Pi saved credential" }
              : undefined,
        },
      },
    });
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(provider);

    expect(provider.getModels()).toEqual([]);
    await expect(
      models.login("fixture-auth", "api_key", { prompt: vi.fn(), notify: vi.fn() }),
    ).resolves.toMatchObject({ type: "api_key", key: "fixture-private" });
    await expect(models.getAuth("fixture-auth")).resolves.toMatchObject({
      auth: { apiKey: "fixture-private" },
      source: "Pi saved credential",
    });

    await models.logout("fixture-auth");
    await expect(models.getAuth("fixture-auth")).resolves.toBeUndefined();
  });
});
