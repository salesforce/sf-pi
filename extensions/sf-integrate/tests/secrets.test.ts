/* SPDX-License-Identifier: Apache-2.0 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSecretInput } from "../lib/secrets.ts";

afterEach(() => {
  delete process.env.SF_PI_TEST_SECRET;
});

describe("outbound secret resolution", () => {
  it("uses the masked prompt by default", async () => {
    const prompt = vi.fn(async () => "prompt-secret");

    await expect(resolveSecretInput({ action: "secret.populate" }, prompt)).resolves.toBe(
      "prompt-secret",
    );
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("reads only a named environment variable", async () => {
    process.env.SF_PI_TEST_SECRET = "environment-secret";
    const prompt = vi.fn();

    await expect(
      resolveSecretInput(
        {
          action: "secret.populate",
          secret_source: "env",
          secret_env: "SF_PI_TEST_SECRET",
        },
        prompt,
      ),
    ).resolves.toBe("environment-secret");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("rejects shell expressions and missing environment variables", async () => {
    const prompt = vi.fn();
    await expect(
      resolveSecretInput(
        {
          action: "secret.populate",
          secret_source: "env",
          secret_env: "$(cat secret)",
        },
        prompt,
      ),
    ).rejects.toThrow("uppercase environment-variable name");
    await expect(
      resolveSecretInput(
        {
          action: "secret.populate",
          secret_source: "env",
          secret_env: "SF_PI_TEST_SECRET",
        },
        prompt,
      ),
    ).rejects.toThrow("is not set");
  });
});
