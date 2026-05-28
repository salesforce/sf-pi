/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Back-compat re-export for Data 360 REST path helpers.
 *
 * The implementation lives in `lib/common/sf-rest/path.ts` so other bundled
 * extensions can build Salesforce REST paths without importing sf-data360
 * internals.
 */

export {
  buildApiPath,
  buildQueryString,
  normalizeD360Path,
  normalizeRestPath,
  type QueryParams,
  type QueryValue,
} from "../../../lib/common/sf-rest/path.ts";
