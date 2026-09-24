/* SPDX-License-Identifier: Apache-2.0 */
import { build } from "esbuild";
import { chmod, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApexPackage } from "./build-apex.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildApexCli({ outdir = path.join(root, "packages/cli/dist") } = {}) {
  // Remove the former embedded API, declarations and assets on rebuild.
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: { "sf-pi": "lib/cli/entry.ts" },
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    // Keep the package import external even though source type-checking uses tsconfig paths.
    external: ["@sf-pi/apex"],
    metafile: true,
  });
  for (const source of Object.keys(result.metafile.inputs)) {
    if (!source.startsWith("lib/cli/"))
      throw new Error(`CLI must import its API packages instead of bundling: ${source}`);
  }
  await chmod(path.join(outdir, "sf-pi.js"), 0o755);
  await writeFile(
    path.join(outdir, "metafile.json"),
    JSON.stringify(result.metafile, null, 2) + "\n",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildApexPackage();
  await buildApexCli();
  await cp(path.join(root, "LICENSE.txt"), path.join(root, "packages/cli/LICENSE.txt"));
  console.log("Built @sf-pi/apex and the Apex-only @sf-pi/cli");
}
