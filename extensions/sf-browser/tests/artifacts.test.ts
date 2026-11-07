/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF Browser Browser Evidence artifact paths. */
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getEvidenceDir,
  getEvidenceIndexPath,
  getLatestEvidencePointerPath,
  planEvidenceCapture,
} from "../lib/artifacts.ts";

const SESSION_ID = "session-1";

/** Artifact paths are built with node:path, so expectations use the platform separator. */
const p = (posixPath: string): string => path.normalize(posixPath);

describe("browser evidence artifacts", () => {
  it("scopes evidence paths by pi session", () => {
    const dir = getEvidenceDir(SESSION_ID);
    const index = getEvidenceIndexPath(SESSION_ID);
    const planned = planEvidenceCapture("Before Enable Agentforce", SESSION_ID);

    expect(dir).toContain(p("browser-artifacts/sessions/session-1"));
    expect(index).toBe(path.join(dir, "index.json"));
    expect(planned.dir).toBe(dir);
    expect(planned.path).toContain("000001-before-enable-agentforce.png");
    expect(planned.thumbnailPath).toContain("000001-before-enable-agentforce.thumb.jpg");
  });

  it("keeps latest as a pointer location, not the canonical evidence directory", () => {
    expect(getLatestEvidencePointerPath()).toContain(p("browser-artifacts/latest/pointer.json"));
    expect(getEvidenceDir(SESSION_ID)).not.toContain(p("browser-artifacts/latest"));
  });
});
