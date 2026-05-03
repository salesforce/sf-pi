/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Upstream version lookups for sf-lsp first-boot install.
 *
 * Two sources, both queried over plain HTTPS so we don't pull in any
 * new runtime deps:
 *
 *   Apex → VS Code Marketplace Gallery extensionquery
 *          (undocumented but long-stable POST API used by `code` and
 *          `ovsx` clients; returns the latest version + vsixpackage
 *          asset URL for `salesforce.salesforcedx-vscode-apex`.)
 *
 *   LWC  → npm registry metadata
 *          GET https://registry.npmjs.org/@salesforce%2Flwc-language-server/latest
 *
 * Both calls are guarded with an abort-controller timeout so a slow
 * proxy cannot block `session_start` forever. The orchestrator treats
 * a failed lookup as `state: "unknown"` and stays silent — we never
 * prompt on bad data.
 */

// -------------------------------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------------------------------

const MARKETPLACE_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";
const APEX_EXTENSION_ID = "salesforce.salesforcedx-vscode-apex";
const APEX_VSIX_ASSET_TYPE = "Microsoft.VisualStudio.Services.VSIXPackage";

const NPM_LWC_URL = "https://registry.npmjs.org/@salesforce%2Flwc-language-server/latest";

const DEFAULT_TIMEOUT_MS = 5_000;

// -------------------------------------------------------------------------------------------------
// Semver compare (tight enough for this use case)
// -------------------------------------------------------------------------------------------------

/**
 * Compare two semver-ish strings. Returns -1/0/1 like `localeCompare`.
 * Ignores prerelease tags — we always track the latest stable tag and
 * treat any leading non-digit as a reset to zero. Good enough for the
 * "is upstream newer?" question, not a general semver library.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (s: string): number[] =>
    s
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => {
        const n = Number.parseInt(part, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

// -------------------------------------------------------------------------------------------------
// Apex — VS Marketplace gallery lookup
// -------------------------------------------------------------------------------------------------

export interface ApexUpstream {
  version: string;
  /** Direct download URL for the latest .vsix. */
  vsixUrl: string;
}

/**
 * Shape of the marketplace response slice we care about. The API
 * returns much more metadata; we only extract the latest version and
 * its VSIX asset URL.
 */
interface MarketplaceExtension {
  versions?: Array<{
    version: string;
    files?: Array<{ assetType: string; source: string }>;
  }>;
}

interface MarketplaceResponse {
  results?: Array<{
    extensions?: MarketplaceExtension[];
  }>;
}

export async function fetchLatestApex(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApexUpstream | undefined> {
  const body = {
    filters: [
      {
        criteria: [
          { filterType: 7, value: APEX_EXTENSION_ID },
          { filterType: 8, value: "Microsoft.VisualStudio.Code" },
        ],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    // 0x192 = IncludeVersions | IncludeFiles | IncludeAssetUri
    flags: 0x192,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(MARKETPLACE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json; api-version=3.0-preview.1",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as MarketplaceResponse;
    const extension = json.results?.[0]?.extensions?.[0];
    const version = extension?.versions?.[0]?.version;
    if (!version) return undefined;

    const vsixFile = extension?.versions?.[0]?.files?.find(
      (file) => file.assetType === APEX_VSIX_ASSET_TYPE,
    );
    if (!vsixFile?.source) return undefined;

    return { version, vsixUrl: vsixFile.source };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------------------------------------------
// LWC — npm registry lookup
// -------------------------------------------------------------------------------------------------

export interface LwcUpstream {
  version: string;
}

export async function fetchLatestLwc(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LwcUpstream | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(NPM_LWC_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;

    const json = (await res.json()) as { version?: string };
    if (typeof json.version !== "string" || !json.version.trim()) return undefined;

    return { version: json.version.trim() };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
