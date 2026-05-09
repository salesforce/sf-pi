/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Process-scoped registry for per-extension doctor providers.
 *
 * `/sf-pi doctor` runs the built-in `runDoctorDiagnostics` (pi/node/skills/
 * package state) and then aggregates every extension that has registered a
 * provider here. This replaces the historical pattern where each extension
 * shipped its own `lib/doctor.ts` consumed only by `/sf-X doctor` and never
 * surfaced in the manager.
 *
 * Contract:
 * - Each extension that wants to contribute calls
 *   `registerExtensionDoctor("sf-X", runDoctor)` at extension load
 *   (typically inside `session_start` so reloads re-register cleanly).
 * - The registered provider returns an `ExtensionDoctorReport` describing
 *   per-check status. The manager renders the result; each extension's
 *   own `/sf-X doctor` command can also call its provider directly and
 *   render the report locally for backwards compat.
 * - Providers receive an `AbortSignal` so the manager can cancel slow
 *   network checks. Providers that ignore the signal still work — the
 *   manager will simply tag the result as `timeout` if it returns late.
 *
 * The registry is process-scoped; tests and reloads use the unregister
 * function returned by `registerExtensionDoctor` to clean up.
 */

export type DoctorCheckSeverity = "ok" | "info" | "warn" | "error";

export interface ExtensionDoctorCheck {
  /** Stable id, e.g. `gateway.reachable`. Used for grep-friendly output. */
  id: string;
  severity: DoctorCheckSeverity;
  title: string;
  detail: string;
  /** Optional one-line repair advice surfaced under the check. */
  fix?: string;
}

export interface ExtensionDoctorReport {
  /** sf-pi extension id, e.g. `sf-llm-gateway-internal`. */
  extensionId: string;
  /** Display title in the aggregated output. */
  title: string;
  /** Per-check results. Order is preserved. */
  checks: ExtensionDoctorCheck[];
  /** Optional one-line summary surfaced when the manager needs a digest. */
  summary?: string;
  /** Filled in by the registry runner when the provider returned. */
  durationMs?: number;
}

export type ExtensionDoctorProvider = (
  cwd: string,
  signal?: AbortSignal,
) => Promise<ExtensionDoctorReport>;

interface RegisteredDoctor {
  extensionId: string;
  provider: ExtensionDoctorProvider;
}

const registry = new Map<string, RegisteredDoctor>();

/**
 * Register a doctor provider for an extension. Returns an unregister
 * function so tests and `session_shutdown` handlers can clean up.
 *
 * If the same extensionId registers twice (e.g. after a reload) the new
 * provider replaces the previous one — the registry stays at one provider
 * per extension.
 */
export function registerExtensionDoctor(
  extensionId: string,
  provider: ExtensionDoctorProvider,
): () => void {
  registry.set(extensionId, { extensionId, provider });
  return () => {
    const current = registry.get(extensionId);
    if (current && current.provider === provider) {
      registry.delete(extensionId);
    }
  };
}

/**
 * Snapshot of registered doctors. Sorted by extensionId for stable output.
 */
export function getRegisteredDoctors(): RegisteredDoctor[] {
  return [...registry.values()].sort((a, b) => a.extensionId.localeCompare(b.extensionId));
}

/**
 * Process-wide reset for tests. Production code should never call this.
 */
export function resetExtensionDoctorRegistry(): void {
  registry.clear();
}

export interface RunRegisteredDoctorsOptions {
  cwd: string;
  /** Total budget per provider in milliseconds. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export interface RegisteredDoctorOutcome {
  extensionId: string;
  /**
   * `ok` — the provider returned a report.
   * `error` — the provider threw or rejected.
   * `timeout` — the provider exceeded the timeout budget.
   */
  status: "ok" | "error" | "timeout";
  report?: ExtensionDoctorReport;
  error?: string;
  durationMs: number;
}

/**
 * Run every registered provider with a timeout budget. Returns one
 * outcome per provider; the array is sorted by extensionId so the
 * aggregated render order is stable.
 *
 * Slow or failed providers never block the rest — each runs in its own
 * Promise.race against an AbortController.
 */
export async function runRegisteredDoctors(
  options: RunRegisteredDoctorsOptions,
): Promise<RegisteredDoctorOutcome[]> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const providers = getRegisteredDoctors();
  return Promise.all(
    providers.map(({ extensionId, provider }) =>
      runOne(extensionId, provider, options.cwd, timeoutMs),
    ),
  );
}

async function runOne(
  extensionId: string,
  provider: ExtensionDoctorProvider,
  cwd: string,
  timeoutMs: number,
): Promise<RegisteredDoctorOutcome> {
  const controller = new AbortController();
  const start = Date.now();
  const timeout = new Promise<RegisteredDoctorOutcome>((resolve) => {
    const t = setTimeout(() => {
      controller.abort();
      resolve({
        extensionId,
        status: "timeout",
        durationMs: Date.now() - start,
      });
    }, timeoutMs);
    // Don't keep the event loop alive on a stuck timer once the provider settles.
    if (typeof t === "object" && t !== null && "unref" in t) {
      (t as { unref?: () => void }).unref?.();
    }
  });

  const work = (async (): Promise<RegisteredDoctorOutcome> => {
    try {
      const report = await provider(cwd, controller.signal);
      const durationMs = Date.now() - start;
      return {
        extensionId,
        status: "ok",
        report: { ...report, durationMs },
        durationMs,
      };
    } catch (error) {
      return {
        extensionId,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }
  })();

  return Promise.race([work, timeout]);
}
