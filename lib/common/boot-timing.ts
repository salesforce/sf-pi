/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lightweight boot-timing telemetry shared across sf-pi extensions.
 *
 * Each extension can wrap its `session_start` work in `markBootStep("name")`
 * to record duration + outcome. When `SF_PI_BOOT_TIMING=1` is set, the
 * collected report prints to stderr after a short debounce so the output
 * lands once per session rather than per extension. The same report is
 * also persisted to `~/.pi/agent/state/sf-pi/boot-timing-latest.log` so
 * users can review it after stderr scrolls past — stderr can race with
 * the splash overlay on some terminals.
 *
 * The collector is opt-in to avoid noise in normal sessions, but the API is
 * always callable so call sites don't need to gate every wrap. When the env
 * flag is unset, `markBootStep` simply runs the work and discards timings.
 *
 * Use:
 *   await markBootStep("sf-llm-gateway", () => syncGatewaySessionDefaults(...));
 *   void markBootStep("sf-welcome.fs-scan", () => discoverLoadedCounts(cwd));
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { globalAgentPath } from "./pi-paths.ts";

interface BootStep {
  name: string;
  durationMs: number;
  ok: boolean;
  errorMessage?: string;
}

/**
 * Sample of event-loop responsiveness during boot. We schedule a 50 ms
 * setInterval; each tick records how late it actually fired vs the 50 ms
 * target. Sustained lag means the event loop is choking on synchronous work
 * elsewhere in the process — the most likely cause of inflated `markBootStep`
 * durations on local-only work like `sync-defaults`.
 */
interface LoopLagSample {
  /** ms past the 50 ms tick the callback actually fired. 0 = on time. */
  lagMs: number;
  /** Wall-clock when this tick fired. */
  at: number;
}

interface BootCollector {
  enabled: boolean;
  /** Wall-clock when this collector was first instantiated. Used to report
   * the gap between process start and the LAST step landing — a much truer
   * measure of perceived boot time than summing parallel durations. */
  startedAt: number;
  /** Wall-clock when the first session_start step was recorded. Distinct
   * from `startedAt` so we can separate "pi process startup" (parsing,
   * extension load) from "sf-pi extension session_start work". */
  firstStepAt: number | null;
  steps: BootStep[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Loop-lag samples captured by the heartbeat. Sampled every 50 ms,
   * stops sampling after 60 s or on the first flush — whichever comes
   * first — so we never accumulate unbounded memory. */
  loopLag: LoopLagSample[];
  loopLagInterval: ReturnType<typeof setInterval> | null;
  loopLagLastTick: number;
}

const GLOBAL_SLOT = "__sfPiBootTiming" as const;

function getCollector(): BootCollector {
  const globalObj = globalThis as unknown as Record<string, BootCollector | undefined>;
  let state = globalObj[GLOBAL_SLOT];
  if (!state) {
    state = {
      enabled: process.env.SF_PI_BOOT_TIMING === "1" || process.env.SF_PI_BOOT_TIMING === "true",
      startedAt: Date.now(),
      firstStepAt: null,
      steps: [],
      flushTimer: null,
      loopLag: [],
      loopLagInterval: null,
      loopLagLastTick: Date.now(),
    };
    globalObj[GLOBAL_SLOT] = state;
    if (state.enabled) startLoopLagSampler(state);
  }
  return state;
}

const LOOP_LAG_INTERVAL_MS = 50;
const LOOP_LAG_DURATION_MS = 60_000;
const LOOP_LAG_STALL_THRESHOLD_MS = 100; // ticks slower than this count as stalls

function startLoopLagSampler(collector: BootCollector): void {
  collector.loopLagLastTick = Date.now();
  collector.loopLagInterval = setInterval(() => {
    const now = Date.now();
    const elapsed = now - collector.loopLagLastTick;
    const lag = Math.max(0, elapsed - LOOP_LAG_INTERVAL_MS);
    collector.loopLag.push({ lagMs: lag, at: now });
    collector.loopLagLastTick = now;
    // Auto-stop after 60 s of sampling so we don't run forever in long-lived
    // sessions. Boot is the only window we care about.
    if (now - collector.startedAt >= LOOP_LAG_DURATION_MS) {
      stopLoopLagSampler(collector);
    }
  }, LOOP_LAG_INTERVAL_MS);
  collector.loopLagInterval.unref?.();
}

function stopLoopLagSampler(collector: BootCollector): void {
  if (collector.loopLagInterval) {
    clearInterval(collector.loopLagInterval);
    collector.loopLagInterval = null;
  }
}

/**
 * Wrap a piece of work with boot-timing capture.
 *
 * Always runs `work` and returns its result. When telemetry is enabled,
 * records the duration + success/failure under `name` and schedules a
 * grouped flush. When disabled, the wrapper is essentially free (one
 * Date.now() pair is acceptable in any path).
 *
 * Errors thrown by `work` are recorded but re-thrown so callers see the
 * same exception they would without instrumentation.
 */
export async function markBootStep<T>(name: string, work: () => T | Promise<T>): Promise<T> {
  const collector = getCollector();
  const t0 = Date.now();
  try {
    const result = await work();
    if (collector.enabled) {
      if (collector.firstStepAt === null) collector.firstStepAt = t0;
      collector.steps.push({ name, durationMs: Date.now() - t0, ok: true });
      scheduleFlush(collector);
    }
    return result;
  } catch (err) {
    if (collector.enabled) {
      if (collector.firstStepAt === null) collector.firstStepAt = t0;
      collector.steps.push({
        name,
        durationMs: Date.now() - t0,
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      scheduleFlush(collector);
    }
    throw err;
  }
}

/**
 * Synchronous variant for hot paths where awaiting would change semantics
 * (e.g. inside a setImmediate callback that pi expects to return synchronously).
 */
export function markBootStepSync<T>(name: string, work: () => T): T {
  const collector = getCollector();
  const t0 = Date.now();
  try {
    const result = work();
    if (collector.enabled) {
      if (collector.firstStepAt === null) collector.firstStepAt = t0;
      collector.steps.push({ name, durationMs: Date.now() - t0, ok: true });
      scheduleFlush(collector);
    }
    return result;
  } catch (err) {
    if (collector.enabled) {
      if (collector.firstStepAt === null) collector.firstStepAt = t0;
      collector.steps.push({
        name,
        durationMs: Date.now() - t0,
        ok: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      scheduleFlush(collector);
    }
    throw err;
  }
}

/**
 * Schedule a debounced flush so we get one combined report per session
 * rather than one log line per extension. The 750ms window covers all the
 * extensions that participate in session_start.
 */
function scheduleFlush(collector: BootCollector): void {
  if (collector.flushTimer) clearTimeout(collector.flushTimer);
  collector.flushTimer = setTimeout(() => {
    flushBootTiming();
  }, 750);
  // Don't keep the event loop alive just for this flush.
  collector.flushTimer.unref?.();
}

/**
 * Manually flush the report. Called automatically after a 750ms quiet
 * period; exposed so session_shutdown can force a flush before tearing
 * down the process.
 */
/** Path of the persisted report. Exported so the session_start handler that
 * mentions the file path stays in sync with what we actually write. */
export function bootTimingLogPath(): string {
  return globalAgentPath("state", "sf-pi", "boot-timing-latest.log");
}

export function flushBootTiming(): void {
  const collector = getCollector();
  if (!collector.enabled) return;
  if (collector.steps.length === 0) return;

  const totalMs = collector.steps.reduce((sum, s) => sum + s.durationMs, 0);
  const sorted = [...collector.steps].sort((a, b) => b.durationMs - a.durationMs);

  const now = Date.now();
  // Wall-clock from process start (collector init) to the latest step
  // landing. This is the user-perceived "how long is boot" number;
  // total-tracked above is the sum of parallel work, which is misleading.
  const wallClockMs = now - collector.startedAt;
  // Time between collector init and the FIRST step landing. Approximates
  // "how long pi takes before any sf-pi extension session_start fires":
  // module loading, jiti compile, native bindings, etc.
  const preSessionMs = collector.firstStepAt ? collector.firstStepAt - collector.startedAt : 0;

  // Loop-lag stats give us the smoking gun: if individual steps look
  // inflated but the loop is responsive, we have a real per-step problem.
  // If the loop has multi-second stalls, the inflations are just contention
  // and per-step optimization won't help.
  const stallSamples = collector.loopLag.filter((s) => s.lagMs >= LOOP_LAG_STALL_THRESHOLD_MS);
  const totalStallMs = stallSamples.reduce((sum, s) => sum + s.lagMs, 0);
  const maxStallMs = collector.loopLag.reduce((max, s) => Math.max(max, s.lagMs), 0);
  const stallSummary = stallSamples.length
    ? `${stallSamples.length} stalls totalling ${totalStallMs} ms; longest single stall ${maxStallMs} ms`
    : `no stalls ≥ ${LOOP_LAG_STALL_THRESHOLD_MS} ms`;

  const lines = [
    "[sf-pi boot timing]",
    `  ${new Date(now).toISOString()}`,
    `  wall-clock: ${wallClockMs} ms (collector init → last step)`,
    `  pre-session: ~${preSessionMs} ms (collector init → first step) — pi load + extension factories`,
    `  total tracked: ${totalMs} ms across ${collector.steps.length} steps (sum of parallel durations)`,
    `  loop lag: ${stallSummary} (sampled every ${LOOP_LAG_INTERVAL_MS} ms)`,
    "",
    "  step                                          dur     status",
    "  --------------------------------------------- ------- ------",
  ];
  for (const step of sorted) {
    const status = step.ok ? "ok" : `fail: ${step.errorMessage?.slice(0, 60) ?? ""}`;
    const dur = `${step.durationMs}`.padStart(5) + " ms";
    lines.push(`  ${step.name.padEnd(45).slice(0, 45)} ${dur}  ${status}`);
  }
  const text = lines.join("\n");

  console.warn(text);

  // Persist to disk so post-mortem analysis works even when stderr scrolls
  // off-screen behind the splash overlay. Best-effort — a write failure must
  // not crash the session.
  try {
    const path = bootTimingLogPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${text}\n`, { encoding: "utf8", mode: 0o644 });
  } catch {
    // ignored — telemetry is opportunistic
  }

  // Important: keep `collector.steps` populated. Late-arriving steps (a slow
  // network probe completing after the 750ms quiet window) reschedule a new
  // flush — we want that flush to render the *cumulative* picture, not just
  // the last burst. Otherwise the on-disk report ends up showing a single
  // late entry while every earlier step gets silently overwritten.
  if (collector.flushTimer) {
    clearTimeout(collector.flushTimer);
    collector.flushTimer = null;
  }
}

/**
 * Drop the accumulated steps. Call from `session_shutdown` so the next
 * session_start within the same parent process (e.g. pi reload) starts from
 * a clean baseline. Public counterpart to `__resetBootTimingForTests`.
 */
export function resetBootTiming(): void {
  const collector = getCollector();
  collector.steps = [];
  if (collector.flushTimer) {
    clearTimeout(collector.flushTimer);
    collector.flushTimer = null;
  }
  stopLoopLagSampler(collector);
  collector.loopLag = [];
  collector.startedAt = Date.now();
  collector.firstStepAt = null;
}

/**
 * Test-only: clear collected timings without writing a report. Also re-reads
 * the env flag so tests can flip telemetry on/off mid-suite.
 */
export function __resetBootTimingForTests(): void {
  const collector = getCollector();
  collector.steps = [];
  if (collector.flushTimer) {
    clearTimeout(collector.flushTimer);
    collector.flushTimer = null;
  }
  stopLoopLagSampler(collector);
  collector.loopLag = [];
  collector.startedAt = Date.now();
  collector.firstStepAt = null;
  collector.enabled =
    process.env.SF_PI_BOOT_TIMING === "1" || process.env.SF_PI_BOOT_TIMING === "true";
}

/**
 * Test-only: snapshot of recorded timings for assertions.
 */
export function __getBootTimingForTests(): readonly BootStep[] {
  return [...getCollector().steps];
}
