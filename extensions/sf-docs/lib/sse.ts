/* SPDX-License-Identifier: Apache-2.0 */
/** Small SSE parser for the docs service's `event: message` responses. */

export interface SseEvent {
  event?: string;
  data: string;
}

export function parseSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return;
    }
    events.push({ event: eventName, data: dataLines.join("\n") });
    eventName = undefined;
    dataLines = [];
  };

  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    else if (field === "data") dataLines.push(value);
  }
  flush();
  return events;
}

export function parseJsonRpcSseResponse(body: string): unknown {
  const events = parseSseEvents(body).filter((event) => !event.event || event.event === "message");
  const last = events.at(-1);
  if (!last) {
    throw new Error("Docs service returned no SSE data event.");
  }
  try {
    return JSON.parse(last.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Docs service returned invalid JSON in SSE data: ${message}`, { cause: err });
  }
}
