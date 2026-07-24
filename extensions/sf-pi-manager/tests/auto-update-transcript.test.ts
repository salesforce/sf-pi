/* SPDX-License-Identifier: Apache-2.0 */
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  AUTO_UPDATE_ENTRY_TYPE,
  appendAutoUpdateTranscript,
} from "../lib/auto-update-transcript.ts";

describe("Auto Update human-only transcript", () => {
  it("redacts credentials, home paths, and URLs before persistence", () => {
    const pi = { appendEntry: vi.fn() };

    appendAutoUpdateTranscript(pi as never, {
      title: "Auto Update",
      body: `api_key=secret-value ${os.homedir()}/private https://private.example.test/path`,
      severity: "warning",
    });

    const persisted = JSON.stringify(pi.appendEntry.mock.calls);
    expect(persisted).toContain("<redacted>");
    expect(persisted).toContain("<home>");
    expect(persisted).toContain("<url-redacted>");
    expect(persisted).not.toContain("secret-value");
    expect(persisted).not.toContain(os.homedir());
    expect(persisted).not.toContain("private.example.test");
  });

  it("appends state-only rows that never enter Pi model context", () => {
    const session = SessionManager.inMemory();
    const pi = {
      appendEntry: (customType: string, data: unknown) =>
        session.appendCustomEntry(customType, data),
    };

    appendAutoUpdateTranscript(pi as never, {
      title: "Auto Update planned",
      body: "Pi packages and Salesforce CLI",
      severity: "info",
    });

    expect(session.getEntries()).toEqual([
      expect.objectContaining({ type: "custom", customType: AUTO_UPDATE_ENTRY_TYPE }),
    ]);
    expect(session.buildSessionContext().messages).toEqual([]);
  });
});
