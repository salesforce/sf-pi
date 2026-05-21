import { defineConfig } from "vitepress";
import { extensionSidebarItems } from "./generated-extension-sidebar";

const repoUrl = "https://github.com/salesforce/sf-pi";

export default defineConfig({
  lang: "en-US",
  title: "SF Pi",
  description: "Salesforce-focused extensions for the pi coding agent.",
  base: "/sf-pi/",
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["adr/**"],
  head: [["meta", { name: "theme-color", content: "#00d7ff" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/install" },
      { text: "Extensions", link: "/extensions" },
      { text: "Commands", link: "/commands" },
      { text: "Contributing", link: "/contributing" },
    ],
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install", link: "/install" },
          { text: "Quickstart", link: "/quickstart" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Bundled Extensions", link: "/extensions" },
          { text: "Command Reference", link: "/commands" },
          { text: "Privacy & Telemetry", link: "/privacy" },
          { text: "Troubleshooting", link: "/troubleshooting" },
        ],
      },
      {
        text: "Extension pages",
        collapsed: true,
        items: extensionSidebarItems,
      },
      {
        text: "Contributor docs",
        items: [
          { text: "Contributing", link: "/contributing" },
          { text: "Human Orientation", link: "/human-orientation" },
          { text: "Agent Orientation", link: "/agent-orientation" },
          { text: "Documentation Health", link: "/health-report" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repoUrl }],
    editLink: {
      pattern: `${repoUrl}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright © Salesforce, Inc.",
    },
    search: {
      provider: "local",
    },
  },
});
