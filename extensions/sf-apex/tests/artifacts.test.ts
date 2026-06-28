/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("writeApexArtifact", () => {
  it("writes artifacts under the sf-pi sf-apex global directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sf-apex-artifacts-"));
    process.env.PI_CODING_AGENT_DIR = dir;
    const { writeApexArtifact } = await import("../lib/artifacts.ts");

    const artifact = await writeApexArtifact("logs", "unsafe:name.json", { ok: true });

    expect(artifact.kind).toBe("logs");
    expect(artifact.path).toContain(path.join("sf-pi", "sf-apex", "logs"));
    expect(artifact.path.endsWith("unsafe_name.json")).toBe(true);
    await expect(readFile(artifact.path, "utf8")).resolves.toContain('"ok": true');
  });
});
