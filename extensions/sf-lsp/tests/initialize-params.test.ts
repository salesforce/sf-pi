/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for the LSP `initialize` parameters sf-lsp sends to every server. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildInitializeParams } from "../lib/lsp-client.ts";

describe("buildInitializeParams", () => {
  const root = path.resolve("workspace", "my project");

  it("sends rootPath, which the Apex server needs to start its index", () => {
    expect(buildInitializeParams(root, 123).rootPath).toBe(root);
  });

  it("keeps rootUri and workspaceFolders pointing at the same root", () => {
    const params = buildInitializeParams(root, 123);
    const rootUri = pathToFileURL(root).href;
    expect(params.rootUri).toBe(rootUri);
    expect(params.workspaceFolders).toEqual([{ uri: rootUri, name: "my project" }]);
    expect(params.processId).toBe(123);
  });

  it("keeps the client capabilities unchanged", () => {
    expect(buildInitializeParams(root, 1).capabilities).toEqual({
      window: { workDoneProgress: true },
      workspace: { configuration: true },
      textDocument: {
        synchronization: { didSave: true, didOpen: true, didChange: true, didClose: true },
        publishDiagnostics: { versionSupport: true },
        diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
      },
    });
  });
});
