/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Bundle-XML pre-flight: assert <bundleType> is present.
 *
 * SDR's deploy step requires this field; without it the deploy fails
 * with `Required fields are missing: [BundleType]` AFTER zipping +
 * uploading. Reading the XML locally turns that into a clean error
 * envelope before any network call.
 */

import { readFile } from "node:fs/promises";

export interface BundleTypeCheckResult {
  ok: boolean;
  reason?: "missing_file" | "missing_bundle_type" | "unparseable_xml" | "wrong_root";
  detail?: string;
  path?: string;
}

const BUNDLE_TYPE_RE = /<bundleType>\s*([A-Za-z0-9_-]+)\s*<\/bundleType>/;
const ROOT_TAG_RE = /<AiAuthoringBundle\b/;

export async function checkBundleType(bundleMetaPath: string): Promise<BundleTypeCheckResult> {
  let xml: string;
  try {
    xml = await readFile(bundleMetaPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      reason: "missing_file",
      detail: `Cannot read ${bundleMetaPath}: ${err instanceof Error ? err.message : String(err)}`,
      path: bundleMetaPath,
    };
  }
  if (!ROOT_TAG_RE.test(xml)) {
    return {
      ok: false,
      reason: "wrong_root",
      detail: "Bundle XML doesn't have an <AiAuthoringBundle> root element.",
      path: bundleMetaPath,
    };
  }
  if (!BUNDLE_TYPE_RE.test(xml)) {
    return {
      ok: false,
      reason: "missing_bundle_type",
      detail: "Missing <bundleType>AGENT</bundleType>. Add it inside <AiAuthoringBundle>.",
      path: bundleMetaPath,
    };
  }
  return { ok: true, path: bundleMetaPath };
}
