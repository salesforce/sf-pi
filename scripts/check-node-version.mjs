/* SPDX-License-Identifier: Apache-2.0 */
const REQUIRED = { major: 22, minor: 19, patch: 0 };
const current = process.versions.node.split(".").map((part) => Number.parseInt(part, 10));

function isTooOld([major = 0, minor = 0, patch = 0]) {
  if (major !== REQUIRED.major) return major < REQUIRED.major;
  if (minor !== REQUIRED.minor) return minor < REQUIRED.minor;
  return patch < REQUIRED.patch;
}

if (isTooOld(current)) {
  console.error(`
sf-pi requires Node.js >=${REQUIRED.major}.${REQUIRED.minor}.${REQUIRED.patch}.
Detected Node.js ${process.version}.

Install or switch to Node 22, then reinstall pi and sf-pi:
  nvm install 22
  nvm use 22
  npm install -g @earendil-works/pi-coding-agent
  pi install git:github.com/salesforce/sf-pi
`);
  process.exit(1);
}
