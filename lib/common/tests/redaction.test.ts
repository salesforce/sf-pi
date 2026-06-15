/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

import { openInfoPanel } from "../info-panel.ts";
import { redactDisplayText } from "../redaction.ts";

describe("shared display redaction", () => {
  it("redacts common secret values without removing surrounding context", () => {
    const redacted = redactDisplayText(
      "apiKey: abc123 access_token=secret Bearer very-secret-token-value github ghp_abcdefghijklmnopqrstuvwxyz1234567890",
    );

    expect(redacted).toContain("apiKey: <redacted>");
    expect(redacted).toContain("access_token: <redacted>");
    expect(redacted).toContain("Bearer <redacted>");
    expect(redacted).toContain("<github-token-redacted>");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("very-secret-token-value");
  });

  it("redacts headless info-panel output", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await openInfoPanel({ hasUI: false, cwd: process.cwd() } as never, {
      title: "Status",
      body: "apiKey=secret-token",
    });

    expect(info).toHaveBeenCalledWith("apiKey: <redacted>");
    info.mockRestore();
  });

  it("redacts non-TUI notifications", async () => {
    const notify = vi.fn();

    await openInfoPanel({ hasUI: true, mode: "rpc", cwd: process.cwd(), ui: { notify } } as never, {
      title: "Status",
      body: "client_secret: should-not-render",
    });

    expect(notify).toHaveBeenCalledWith("client_secret: <redacted>", "info");
  });
});
