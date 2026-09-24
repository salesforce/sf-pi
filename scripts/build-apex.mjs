/* SPDX-License-Identifier: Apache-2.0 */
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildApexPackage({
  packageDir = path.join(root, "packages/apex"),
  plugins = [],
} = {}) {
  const outdir = path.join(packageDir, "dist");
  // Rebuild only the API package owned by this invocation.
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: { index: "extensions/sf-apex/public.ts" },
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "external",
    metafile: true,
    plugins: [
      ...plugins,
      {
        name: "apex-package-boundaries",
        setup(build) {
          build.onResolve({ filter: /^@earendil-works\/|^@mariozechner\// }, ({ path }) => ({
            errors: [{ text: `Apex package cannot depend on Pi runtime: ${path}` }],
          }));
        },
      },
    ],
  });
  for (const source of Object.keys(result.metafile.inputs)) {
    if (
      source.startsWith("extensions/") &&
      !source.startsWith("extensions/sf-apex/") &&
      ![
        "extensions/sf-lsp/lib/client-engine.ts",
        "extensions/sf-lsp/lib/types.ts",
        "extensions/sf-lsp/lib/file-classify.ts",
      ].includes(source)
    )
      throw new Error(`Apex package includes an unrelated extension: ${source}`);
  }
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      path.join(root, "tsconfig.apex.json"),
      "--outDir",
      path.join(outdir, "types"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  await cp(
    path.join(root, "extensions/sf-apex/AGENT_GUIDE.md"),
    path.join(outdir, "AGENT_GUIDE.md"),
    { recursive: true },
  );
  await cp(path.join(root, "LICENSE.txt"), path.join(packageDir, "LICENSE.txt"));
  await writeFile(
    path.join(outdir, "metafile.json"),
    JSON.stringify(result.metafile, null, 2) + "\n",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildApexPackage();
  console.log("Built @sf-pi/apex in packages/apex/dist");
}
