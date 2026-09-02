/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { copyToClipboardMock } = vi.hoisted(() => ({
  copyToClipboardMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  copyToClipboard: copyToClipboardMock,
}));

import { handleEvalStudioIntent } from "../lib/eval-studio/actions.ts";

const dirs: string[] = [];

afterEach(async () => {
  copyToClipboardMock.mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function projectWithRun(): Promise<{ cwd: string; runDir: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "eval-studio-actions-"));
  dirs.push(cwd);
  await writeFile(path.join(cwd, "sfdx-project.json"), "{}");

  const runDir = path.join(cwd, ".pi", "state", "sf-agentscript", "runs", "run-copy");
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "metadata.json"),
    JSON.stringify({
      run_id: "run-copy",
      execution_state: "completed",
      evidence_verdict: "passed",
      totals: { tests: 1, test_pass: 1, test_fail: 0, ev_pass: 1, ev_fail: 0, errors: 0 },
    }),
  );
  return { cwd, runDir };
}

describe("Eval Studio actions", () => {
  it("copies the selected Eval Run summary through Pi's clipboard interface", async () => {
    const { cwd, runDir } = await projectWithRun();
    const notify = vi.fn();

    await handleEvalStudioIntent({} as never, { cwd, hasUI: true, ui: { notify } } as never, {
      kind: "copy_summary",
      run_id: "run-copy",
    });

    expect(copyToClipboardMock).toHaveBeenCalledWith(
      [
        "Agent Script Eval Run run-copy",
        "Execution: completed",
        "Evidence: passed",
        "Scope: ad_hoc",
        `Artifacts: ${runDir}`,
      ].join("\n"),
    );
    expect(notify).toHaveBeenCalledWith("Run summary copied.", "info");
  });

  it("does not report success when Pi cannot copy the Eval Run summary", async () => {
    const { cwd } = await projectWithRun();
    const notify = vi.fn();
    copyToClipboardMock.mockRejectedValue(new Error("clipboard unavailable"));

    await expect(
      handleEvalStudioIntent({} as never, { cwd, hasUI: true, ui: { notify } } as never, {
        kind: "copy_summary",
        run_id: "run-copy",
      }),
    ).rejects.toThrow("clipboard unavailable");

    expect(notify).not.toHaveBeenCalled();
  });
});
