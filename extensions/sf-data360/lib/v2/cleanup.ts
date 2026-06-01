/* SPDX-License-Identifier: Apache-2.0 */

export interface CleanupResource {
  type: "data_stream";
  id: string;
}

export interface CleanupPlan {
  resources: CleanupResource[];
  shouldDeleteDataLakeObject: boolean;
}

export function planCleanup(params: Record<string, unknown>): CleanupPlan {
  const ids = Array.isArray(params.dataStreamIds)
    ? params.dataStreamIds.filter(
        (id): id is string => typeof id === "string" && Boolean(id.trim()),
      )
    : [];
  return {
    resources: ids.map((id) => ({ type: "data_stream", id: id.trim() })),
    shouldDeleteDataLakeObject: params.shouldDeleteDataLakeObject === true,
  };
}
