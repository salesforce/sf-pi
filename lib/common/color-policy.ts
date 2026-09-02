/* SPDX-License-Identifier: Apache-2.0 */
/** Shared terminal capability policy for SF Pi-owned ANSI rendering. */
import { getCapabilities } from "@earendil-works/pi-tui";

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[([0-9;]*)m`, "g");
const RGB_COMPONENT_PATTERN = /^\d{1,3}$/;

export function colorsEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NO_COLOR === undefined;
}

export function stripAnsiSgr(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, "");
}

export interface TerminalAnsiOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  trueColor?: boolean;
}

export function normalizeAnsiForTerminal(value: string, options: TerminalAnsiOptions = {}): string {
  const environment = options.environment ?? process.env;
  if (!colorsEnabled(environment)) return stripAnsiSgr(value);

  const trueColor = options.trueColor ?? getCapabilities().trueColor;
  return trueColor ? value : stripTrueColorSgr(value);
}

function stripTrueColorSgr(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, (_sequence, rawParameters: string) => {
    const parameters = rawParameters.split(";");
    const retained: string[] = [];

    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const isTrueColor =
        (parameter === "38" || parameter === "48") &&
        index + 4 < parameters.length &&
        parameters[index + 1] === "2" &&
        parameters.slice(index + 2, index + 5).every((value) => RGB_COMPONENT_PATTERN.test(value));
      if (isTrueColor) {
        index += 4;
        continue;
      }
      retained.push(parameter ?? "");
    }

    return retained.length > 0 ? `${ANSI_ESCAPE}[${retained.join(";")}m` : "";
  });
}
