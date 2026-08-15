/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded, report-only external Markdown link checking. */

const DEFAULT_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_DELAY_MS = 750;
const USER_AGENT = "sf-pi-external-link-report/1.0 (+https://github.com/salesforce/sf-pi)";

export function extractExternalLinks(entries) {
  const sourcesByUrl = new Map();
  for (const entry of entries) {
    const source = stripFencedCode(String(entry.source));
    const candidates = [];

    for (const match of source.matchAll(
      /(?<!!)\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/g,
    )) {
      candidates.push(match[1]);
    }
    for (const match of source.matchAll(/<(https?:\/\/[^>\s]+)>/g)) {
      candidates.push(match[1]);
    }
    for (const match of source.matchAll(/^\s*\[[^\]]+\]:\s*(https?:\/\/\S+)/gm)) {
      candidates.push(match[1]);
    }

    for (const candidate of candidates) {
      const normalized = normalizeExternalUrl(candidate);
      if (!normalized || isExcludedUrl(normalized)) continue;
      const sources = sourcesByUrl.get(normalized) ?? new Set();
      sources.add(entry.file);
      sourcesByUrl.set(normalized, sources);
    }
  }

  return [...sourcesByUrl.entries()]
    .map(([url, sources]) => ({ url, sources: [...sources].sort() }))
    .sort((left, right) => left.url.localeCompare(right.url));
}

export async function checkExternalLink(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");
  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const attempts = [];

  for (let index = 0; index < maxAttempts; index++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
          "user-agent": USER_AGENT,
        },
      });
      attempts.push({
        status: response.status,
        finalUrl: response.url || url,
      });
      if (response.body && typeof response.body.cancel === "function") {
        await response.body.cancel().catch(() => undefined);
      }
      if (response.status >= 200 && response.status < 400) break;
      if (!shouldRetryStatus(response.status)) break;
    } catch (error) {
      attempts.push({ error: errorMessage(error) });
    } finally {
      clearTimeout(timer);
    }

    if (index + 1 < maxAttempts && retryDelayMs > 0) {
      await delay(retryDelayMs);
    }
  }

  return {
    url,
    classification: classifyLinkAttempts(attempts),
    attempts,
  };
}

export function classifyLinkAttempts(attempts) {
  if (attempts.some((attempt) => attempt.status >= 200 && attempt.status < 400)) return "ok";
  if (
    attempts.length >= 2 &&
    attempts.every((attempt) => attempt.status === 404 || attempt.status === 410)
  ) {
    return "stable_dead";
  }
  return "advisory";
}

export async function buildExternalLinkReport(links, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 6);
  const results = new Array(links.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= links.length) return;
      const link = links[index];
      const checked = await checkExternalLink(link.url, options);
      results[index] = { ...checked, sources: link.sources };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, () => worker()));

  const summary = {
    total: results.length,
    ok: results.filter((result) => result.classification === "ok").length,
    stableDead: results.filter((result) => result.classification === "stable_dead").length,
    advisory: results.filter((result) => result.classification === "advisory").length,
  };
  return {
    generatedAt: new Date().toISOString(),
    summary,
    results,
  };
}

export function renderExternalLinkReport(report) {
  const lines = [
    "# SF Pi external link report",
    "",
    `Generated: \`${report.generatedAt}\``,
    "",
    `Checked **${report.summary.total}** unique authored links: **${report.summary.ok}** reachable, **${report.summary.stableDead}** stable 404/410, **${report.summary.advisory}** advisory.`,
    "",
    "> This report does not fail the workflow for link outcomes. Only a repeated 404/410 is classified as stable dead; authentication failures, rate limits, server errors, and transport failures remain advisory.",
    "",
    "## Stable 404/410 results",
    "",
  ];

  const dead = report.results.filter((result) => result.classification === "stable_dead");
  if (dead.length === 0) lines.push("_None._");
  else for (const result of dead) lines.push(renderResult(result));

  lines.push("", "## Advisory results", "");
  const advisory = report.results.filter((result) => result.classification === "advisory");
  if (advisory.length === 0) lines.push("_None._");
  else for (const result of advisory) lines.push(renderResult(result));

  lines.push("");
  return lines.join("\n");
}

function renderResult(result) {
  const attempts = result.attempts
    .map((attempt) =>
      attempt.status
        ? `${attempt.status}${attempt.finalUrl && attempt.finalUrl !== result.url ? ` → ${attempt.finalUrl}` : ""}`
        : `error: ${attempt.error ?? "unknown"}`,
    )
    .join("; ");
  return `- <${result.url}> — ${attempts} — ${result.sources.map((source) => `\`${source}\``).join(", ")}`;
}

function stripFencedCode(source) {
  const lines = source.split("\n");
  let fence;
  return lines
    .filter((line) => {
      const match = line.match(/^\s*(```+|~~~+)/);
      if (match) {
        if (!fence) fence = match[1][0];
        else if (match[1][0] === fence) fence = undefined;
        return false;
      }
      return !fence;
    })
    .join("\n");
}

function normalizeExternalUrl(value) {
  try {
    const url = new URL(String(value).replace(/[.,;:]$/, ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isExcludedUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "example.com" ||
      hostname.endsWith(".example.com") ||
      hostname.endsWith(".example.test") ||
      hostname.endsWith(".invalid")
    ) {
      return true;
    }
    if (hostname === "img.shields.io") return true;
    if (
      hostname === "github.com" &&
      /^\/salesforce\/sf-pi(?:\/|$)/.test(url.pathname.toLowerCase())
    ) {
      return true;
    }
    return /\.(?:gif|jpe?g|png|svg|webp)$/i.test(url.pathname);
  } catch {
    return true;
  }
}

function shouldRetryStatus(status) {
  return status === 404 || status === 410 || status === 429 || status >= 500;
}

function errorMessage(error) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
