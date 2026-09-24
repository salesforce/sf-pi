#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
import { main } from "./main.ts";

// SDK logging must never corrupt the single JSON result on stdout.
// eslint-disable-next-line no-console -- redirect SDK stdout logging to stderr
console.log = console.error;
console.info = console.error;
const code = await main();
process.stdout.write("", () => process.exit(code));
