/* SPDX-License-Identifier: Apache-2.0 */
/** Native artifact writer; standalone callers supply their own root. */
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { createApexArtifactWriter } from "./artifact-writer.ts";
export { artifactTimestamp } from "./artifact-writer.ts";

export const nativeApexArtifacts = createApexArtifactWriter(globalAgentPath("sf-pi", "sf-apex"));
export const apexArtifactDir = nativeApexArtifacts.directory;
export const writeApexArtifact = nativeApexArtifacts.write;
