/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proofs for the shared Fin admin surface rules (synthetic values only). */
import { describe, expect, it } from "vitest";
import {
  finAdminLocation,
  finAdminPageUrl,
  isFinAdminSignedOut,
  maskFinSecrets,
  snapshotShowsFinSecretSurface,
} from "../fin-admin-surface.ts";

// Built at runtime so no key-shaped literal is committed. Synthetic: it
// decodes to "tok:fake_…", not a real credential.
const FAKE_KEY = Buffer.from(`tok:fake_${"0123456789abcdef"}:1:0x${"fake".repeat(4)}`).toString(
  "base64",
);
const FAKE_HEX = "0f1e2d3c4b5a6978".repeat(3).slice(0, 40);

describe("finAdminLocation", () => {
  it("recognises exactly the three regional HTTPS admin hosts", () => {
    expect(finAdminLocation("https://app.intercom.com/a/apps/abc123/settings")?.region).toBe("us");
    expect(finAdminLocation("https://app.eu.intercom.com/a/apps/abc123/x")?.region).toBe("eu");
    expect(finAdminLocation("https://app.au.intercom.com/a/apps/abc123/x")?.region).toBe("au");
    for (const url of [
      "http://app.intercom.com/a/apps/abc123/x",
      "https://app.intercom.com.example.net/a/apps/abc123/x",
      "https://evil-app.intercom.com/a/apps/abc123/x",
      "https://intercom.com/a/apps/abc123/x",
      "https://app.intercom.io/a/apps/abc123/x",
      "not a url",
      undefined,
    ]) {
      expect(finAdminLocation(url), String(url)).toBeUndefined();
    }
  });

  it("reads the app id and maps verified pages, ignoring query and hash", () => {
    const location = finAdminLocation(
      "https://app.intercom.com/a/apps/abc123/standalone/deploy/fin-agent-api?tab=1#x",
    );
    expect(location).toMatchObject({ appId: "abc123", page: "agent-api" });
    expect(finAdminLocation("https://app.intercom.com/a/apps/abc123/getting-started")?.page).toBe(
      undefined,
    );
  });

  it("treats the sign-in page as signed out (no app open)", () => {
    const location = finAdminLocation("https://app.intercom.com/admins/sign_in")!;
    expect(isFinAdminSignedOut(location)).toBe(true);
  });

  it("refuses to build a URL for a malformed app id", () => {
    expect(() => finAdminPageUrl("us", "../../evil", "agent-api")).toThrow(/Invalid Fin app id/);
    expect(finAdminPageUrl("eu", "abc123", "help-centers")).toBe(
      "https://app.eu.intercom.com/a/apps/abc123/settings/helpcenter/all",
    );
  });
});

describe("maskFinSecrets", () => {
  it("masks a revealed key in a field, a cell, plain text, JSON, and a bearer header", () => {
    for (const shape of [
      `- textbox "API key" [ref=e1]: ${FAKE_KEY}`,
      `- cell "${FAKE_KEY}" [ref=e2]`,
      `  - StaticText "${FAKE_KEY}"`,
      `{"value":"${FAKE_KEY}"}`,
      `Authorization: Bearer ${FAKE_KEY}`,
      `- StaticText "${FAKE_HEX}"`,
    ]) {
      const masked = maskFinSecrets(shape);
      expect(masked, shape).not.toContain(FAKE_KEY.slice(0, 16));
      expect(masked, shape).not.toContain(FAKE_HEX.slice(0, 16));
      expect(masked).toContain("<masked>");
    }
  });

  it("masks any value shown after a secret-labelled field, even a short one", () => {
    expect(maskFinSecrets('- textbox "Client secret" [ref=e9]: s3cr3t')).toBe(
      '- textbox "Client secret" [ref=e9]: <masked>',
    );
  });

  it("keeps dotted placeholders, labels, and admin URLs readable", () => {
    for (const line of [
      '- textbox "API key" [ref=e1]: ••••••••••••••••••••',
      '- cell "****************" [ref=e2]',
      '- button "Manage API key" [expanded=false, ref=e3]',
      "https://app.intercom.com/a/apps/abc123/standalone/deploy/channel/salesforce/cases",
      '- heading "Answer anywhere with Fin Agent API" [level=2, ref=e4]',
    ]) {
      expect(maskFinSecrets(line)).toBe(line);
    }
  });
});

describe("snapshotShowsFinSecretSurface", () => {
  it("flags an open key dialog or key field, not the button that opens it", () => {
    expect(snapshotShowsFinSecretSurface('- dialog "Manage API key"')).toBe(true);
    expect(snapshotShowsFinSecretSurface('- textbox "Access token" [ref=e1]: ••••')).toBe(true);
    expect(snapshotShowsFinSecretSurface('- button "Manage API key" [ref=e1]')).toBe(false);
    expect(snapshotShowsFinSecretSurface('- heading "Data connectors" [level=1]')).toBe(false);
  });
});
