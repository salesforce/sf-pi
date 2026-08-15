/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("ESLint rule promotions", () => {
  it("treats useless assignments as errors", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["no-useless-assignment"]?.[0]).toBe(2);
  });

  it("treats CommonJS require imports as errors", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["@typescript-eslint/no-require-imports"]?.[0]).toBe(2);
  });

  it("treats unsafe TypeScript suppression comments as errors", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["@typescript-eslint/ban-ts-comment"]?.[0]).toBe(2);
  });

  it("treats explicit any in production code as an error", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["@typescript-eslint/no-explicit-any"]?.[0]).toBe(2);
  });

  it("treats non-null assertions in production code as errors", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["@typescript-eslint/no-non-null-assertion"]?.[0]).toBe(2);
  });

  it("treats unexpected console output as an error outside CLI scripts", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const productionConfig = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );
    const scriptConfig = await eslint.calculateConfigForFile(
      path.join(ROOT, "scripts/generate-catalog.mjs"),
    );

    expect(productionConfig?.rules?.["no-console"]?.[0]).toBe(2);
    expect(scriptConfig?.rules?.["no-console"]?.[0]).toBe(0);
  });

  it("has no warning-severity rules in the effective production config", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );
    const warningRules = Object.entries(config?.rules ?? {})
      .filter(([, setting]) => setting[0] === 1)
      .map(([rule]) => rule);

    expect(warningRules).toEqual([]);
  });
});
