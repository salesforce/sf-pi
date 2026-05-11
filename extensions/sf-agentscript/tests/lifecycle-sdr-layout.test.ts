/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the SDR-friendly layout shim in lifecycle.ts.
 *
 * SDR's path-based metadata resolver requires bundles to live under a
 * directory named exactly `aiAuthoringBundles` so the metadata registry
 * can map directoryName → AiAuthoringBundle type. When callers (e.g. our
 * recipe harness, third-party scripts, ad-hoc bundles outside an SFDX
 * project) place the bundle elsewhere, SDR fails with "Could not infer a
 * metadata type" before any network call. Our publish path detects this
 * and synthesizes a minimal mirror under os.tmpdir() so the deploy works
 * regardless of where the caller stored the bundle.
 *
 * The shim is private to lifecycle.ts; we exercise it indirectly via the
 * exported `ensureSdrFriendlyLayoutForTests` re-export below — kept on a
 * test-only path to avoid shipping the helper as a public API.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Re-export the private helper for testing. The runtime import lives next
// to the test so the public API surface stays minimal.
const { ensureSdrFriendlyLayoutForTests } = await import("../lib/lifecycle.ts");

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-sdr-test-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function makeBundle(parentDir: string, name: string): Promise<string> {
  const bundleDir = path.join(parentDir, name);
  await mkdir(bundleDir, { recursive: true });
  await writeFile(path.join(bundleDir, `${name}.agent`), 'config:\n   developer_name: "X"\n');
  await writeFile(
    path.join(bundleDir, `${name}.bundle-meta.xml`),
    `<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <bundleType>AGENT</bundleType>
</AiAuthoringBundle>
`,
  );
  return bundleDir;
}

describe("ensureSdrFriendlyLayout", () => {
  it("returns the original path when parent is already aiAuthoringBundles", async () => {
    const parent = path.join(workDir, "aiAuthoringBundles");
    const bundleDir = await makeBundle(parent, "MyAgent");
    const out = await ensureSdrFriendlyLayoutForTests(bundleDir, "MyAgent");
    expect(out.bundleDir).toBe(bundleDir);
    expect(out.tmpRoot).toBeUndefined();
  });

  it("synthesizes a mirror with the right shape when parent is something else", async () => {
    const parent = path.join(workDir, "wherever");
    const bundleDir = await makeBundle(parent, "MyAgent");
    const out = await ensureSdrFriendlyLayoutForTests(bundleDir, "MyAgent");
    expect(out.tmpRoot).toBeDefined();
    expect(out.bundleDir).not.toBe(bundleDir);
    // The synthesized bundleDir must end with aiAuthoringBundles/<name>
    const segments = out.bundleDir.split(path.sep);
    expect(segments[segments.length - 1]).toBe("MyAgent");
    expect(segments[segments.length - 2]).toBe("aiAuthoringBundles");
    // Files are present
    const agent = await readFile(path.join(out.bundleDir, "MyAgent.agent"), "utf-8");
    expect(agent).toMatch(/developer_name/);
    const meta = await readFile(path.join(out.bundleDir, "MyAgent.bundle-meta.xml"), "utf-8");
    expect(meta).toMatch(/bundleType/);
    // Cleanup the synthesized tmpRoot
    if (out.tmpRoot) await rm(out.tmpRoot, { recursive: true, force: true });
  });

  it("preserves the bundle file contents byte-for-byte during the copy", async () => {
    const parent = path.join(workDir, "elsewhere");
    const bundleDir = await makeBundle(parent, "X");
    // Mutate the file with content that includes special characters and a target injection.
    const updatedAgent = 'config:\n   developer_name: "X"\n# special chars: 你好 🚀 «»\n';
    await writeFile(path.join(bundleDir, "X.agent"), updatedAgent);
    const updatedMeta =
      '<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n  <bundleType>AGENT</bundleType>\n  <target>X.v1</target>\n</AiAuthoringBundle>\n';
    await writeFile(path.join(bundleDir, "X.bundle-meta.xml"), updatedMeta);
    const out = await ensureSdrFriendlyLayoutForTests(bundleDir, "X");
    expect(out.tmpRoot).toBeDefined();
    expect(await readFile(path.join(out.bundleDir, "X.agent"), "utf-8")).toBe(updatedAgent);
    expect(await readFile(path.join(out.bundleDir, "X.bundle-meta.xml"), "utf-8")).toBe(
      updatedMeta,
    );
    if (out.tmpRoot) await rm(out.tmpRoot, { recursive: true, force: true });
  });
});
