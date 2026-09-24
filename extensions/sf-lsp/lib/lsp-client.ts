/* SPDX-License-Identifier: Apache-2.0 */
/** Native compatibility adapter for the host-independent LSP client engine. */
import { PROJECT_CONFIG_DIR_NAME, globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { createLspClientManager } from "./client-engine.ts";

const clients = createLspClientManager({
  globalDirectory: globalAgentPath("lsp"),
  projectDirectoryName: PROJECT_CONFIG_DIR_NAME,
});
export const getLspDiagnosticsForFile = clients.getLspDiagnosticsForFile;
export const doctorLsp = clients.doctorLsp;
export const shutdownLspClients = clients.shutdownLspClients;
