/* SPDX-License-Identifier: Apache-2.0 */
/** The single SF Fin family tool. v1 exposes only read-only connection actions. */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { runDoctor } from "./doctor.ts";
import { buildStatusText, createFinStatusStore } from "./status.ts";
import { COMMAND_NAME, PROVIDER_NAME, TOOL_NAME } from "./types.ts";

const Params = Type.Object({
  action: StringEnum(["status", "doctor"] as const, {
    description:
      "status: cached, no network. doctor: read-only check of the Fin CLI and the saved credential against the workspace.",
  }),
});

type Params = { action: "status" | "doctor" };

export function registerSfFinTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof Params>({
    name: TOOL_NAME,
    label: "SF Fin",
    description:
      "Check the Fin (formerly Intercom) workspace connection used by SF Fin: cached status, or a read-only doctor run through the user's installed Fin CLI.",
    promptSnippet: "Check the Fin workspace connection (status or read-only doctor).",
    promptGuidelines: [
      `Use sf_fin action='status' first; run action='doctor' only when verified workspace identity is needed.`,
      `Never ask the user to paste a Fin token into chat; direct them to /login ${PROVIDER_NAME}, which masks the token.`,
    ],
    parameters: Params,
    renderCall: (args, theme) =>
      new Text(
        theme.fg("toolTitle", theme.bold("🐟 SF Fin ")) +
          theme.fg("muted", (args as Params).action ?? "status"),
        0,
        0,
      ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Params;
      const store = createFinStatusStore();
      if (input.action === "doctor") {
        const report = await runDoctor(ctx);
        store.write(report.snapshot);
        return {
          content: [
            { type: "text", text: `${report.message}\n\n${buildStatusText(report.snapshot)}` },
          ],
          details: {
            action: "doctor",
            outcome: report.outcome,
            identity: report.snapshot.identity,
            cliVersion: report.snapshot.cliVersion,
            ...(report.outcome === "ok"
              ? {}
              : {
                  recover_via: {
                    command: `/${COMMAND_NAME} doctor`,
                    login: `/login ${PROVIDER_NAME}`,
                  },
                }),
          },
          ...(report.outcome === "ok" ? {} : { isError: true }),
        };
      }
      const snapshot = store.read();
      return {
        content: [{ type: "text", text: buildStatusText(snapshot) }],
        details: { action: "status", outcome: snapshot.lastOutcome, identity: snapshot.identity },
      };
    },
  });
}
