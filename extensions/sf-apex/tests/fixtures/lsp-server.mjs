/* SPDX-License-Identifier: Apache-2.0 */
// Deterministic stdio server for lifecycle and diagnostic evidence tests.
import { closeSync, writeFileSync } from "node:fs";
const [mode, pidFile] = process.argv.slice(2);
writeFileSync(pidFile, String(process.pid));
let buffer = Buffer.alloc(0);
function send(message) {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
const input = mode === "closed-stdin" ? undefined : process.stdin;
if (!input) closeSync(0);
input?.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const split = buffer.indexOf("\r\n\r\n");
    if (split < 0) return;
    const size = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, split).toString())[1]);
    if (buffer.length < split + 4 + size) return;
    const msg = JSON.parse(buffer.subarray(split + 4, split + 4 + size));
    buffer = buffer.subarray(split + 4 + size);
    if (msg.method === "initialize" && mode !== "hang-init")
      send(
        msg.params.rootPath
          ? { id: msg.id, result: { capabilities: {} } }
          : { id: msg.id, error: { code: -32602, message: "Missing rootPath" } },
      );
    if (msg.method === "shutdown" && mode !== "hang-shutdown" && mode !== "hang-init")
      send({ id: msg.id, result: null });
    if (msg.method === "exit" && mode !== "hang-shutdown" && mode !== "hang-init") process.exit(0);
    if (msg.method === "textDocument/diagnostic")
      send({ id: msg.id, error: { code: -32601, message: "unsupported" } });
    if (msg.method === "textDocument/didOpen" || msg.method === "textDocument/didChange") {
      if (mode === "exit") process.exit(1);
      if (mode === "silent") continue;
      const doc = msg.params.textDocument;
      send({
        method: "textDocument/publishDiagnostics",
        params: {
          uri: doc.uri,
          version: mode === "stale" ? doc.version - 1 : doc.version,
          diagnostics:
            mode === "error"
              ? [
                  {
                    severity: 1,
                    code: "SYNTAX",
                    message: "Unexpected token",
                    range: { start: { line: 0, character: 7 }, end: { line: 0, character: 8 } },
                  },
                ]
              : [],
        },
      });
    }
  }
});
if (mode === "hang-shutdown" || mode === "hang-init") process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
