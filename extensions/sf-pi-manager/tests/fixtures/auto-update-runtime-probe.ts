/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic faux provider used by the real-Pi Auto Update lifecycle proof. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";

export default function autoUpdateRuntimeProbe(pi: ExtensionAPI): void {
  const faux = fauxProvider({
    provider: "sf-pi-auto-update-probe",
    models: [{ id: "probe", name: "SF Pi Auto Update Probe" }],
  });
  faux.setResponses([fauxAssistantMessage("done")]);
  pi.registerProvider(faux.provider);
}
