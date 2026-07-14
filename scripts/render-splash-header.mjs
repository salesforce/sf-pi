/* SPDX-License-Identifier: Apache-2.0 */
// Run the real SfWelcomeHeader with stubbed splash data so we can visually
// confirm the Pi + SF + caption rendering matches the picker. Preview only.
import { SfWelcomeHeader } from "../extensions/sf-welcome/lib/splash-component.ts";

const data = {
  modelName: "Claude Opus 4.7 [1M] Global",
  providerName: "[SF LLM Gateway] sf-llm-gateway-internal",
  loadedCounts: { extensions: 19, skills: 40, promptTemplates: 1 },
  recentSessions: [
    { name: "pi", timeAgo: "just now" },
    { name: "jvalaiyapathy", timeAgo: "19h ago" },
  ],
  extensionHealth: Array.from({ length: 11 }, (_, i) => ({
    name: `ext-${i}`,
    status: "active",
    icon: "•",
  })),
  slackConnected: true,
  monthlyCost: 264,
  monthlyBudget: 50000,
  monthlyUsageSource: "gateway",
  nodeRuntime: {
    kind: "supported",
    version: process.version,
    requiredVersion: "22.19.0",
    loading: false,
  },
  herdrRuntime: {
    kind: "ready",
    extensionEnabled: true,
    toolActive: true,
    activeControlEnv: true,
    passiveStatusBridge: true,
    loading: false,
  },
  fontRuntime: {
    kind: "installed",
    fontFamily: "MesloLGM Nerd Font Mono",
    glyphMode: "emoji",
    supportedPlatform: true,
    installed: true,
    loading: false,
  },
  hunk: {
    installed: false,
    loading: false,
  },
  homebrew: {
    kind: "installed",
    version: "4.6.3",
    prefix: "/opt/homebrew",
    loading: false,
    platform: "darwin",
  },
  browserRuntime: {
    installed: true,
    installedVersion: "0.9.0",
    latestVersion: "0.9.0",
    freshness: "latest",
    loading: false,
  },
  autoUpdate: {
    enabled: false,
    status: {},
  },
  lifetimeCost: 6872,
  lifetimeUsageSource: "gateway",
  sfEnvironment: {
    cliInstalled: true,
    cliVersion: "2.132.14",
    defaultOrg: "Vivint-DevInt",
    orgType: "sandbox",
    connected: true,
    apiVersion: "66.0",
    configScope: "Global",
    detectedAt: Date.now() - 24000,
    source: "live",
    refreshing: false,
    loading: false,
  },
};

const header = new SfWelcomeHeader(data);
for (const line of header.render(160)) console.log(line);
