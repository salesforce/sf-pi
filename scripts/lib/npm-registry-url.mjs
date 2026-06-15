/* SPDX-License-Identifier: Apache-2.0 */

export function npmRegistryPackageUrl(packageName) {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName).replaceAll("%40", "@")}`;
}
