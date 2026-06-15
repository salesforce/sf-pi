/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-guardrail settings` TUI.
 *
 * The first screen is an intent-oriented section chooser. Focused sections then
 * render compact rows with an inline detail card for the selected setting.
 */
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { GuardrailConfig, RuleBehavior } from "./types.ts";
import { behaviorEnabled, ruleBehaviorFromLabel } from "./rule-behavior.ts";
import {
  applyGuardrailPreset,
  buildGuardrailPreferenceDescriptors,
  preferenceValue,
  updateUserPreference,
  type GuardrailPreferenceDescriptor,
  type GuardrailSettingsSection,
} from "./preferences.ts";
import { openProductionAliasesEditor } from "./production-aliases-panel.ts";

interface SettingsSectionItem {
  value: GuardrailSettingsSection;
  label: string;
  description: string;
}

const SECTION_ITEMS: SettingsSectionItem[] = [
  {
    value: "posture",
    label: "Safety posture",
    description: "Apply Power Tool or Strict presets with explanation.",
  },
  {
    value: "core",
    label: "Core controls",
    description: "Master switch, feature toggles, guidance, and timeout.",
  },
  {
    value: "files",
    label: "File protection",
    description: "Rules for secret files, CLI state, and destructive manifests.",
  },
  {
    value: "commands",
    label: "Dangerous commands",
    description: "Rules for rm -rf, force push, credential reveal, and similar commands.",
  },
  {
    value: "orgs",
    label: "Salesforce org operations",
    description: "Rules that depend on detected production org context.",
  },
  {
    value: "aliases",
    label: "Production aliases",
    description: "Tell Guardrail which aliases should be treated as production.",
  },
  {
    value: "advanced",
    label: "Advanced overrides",
    description: "Learn where custom JSON rule overrides live.",
  },
];

export async function openGuardrailPreferencesPanel(
  ctx: ExtensionContext,
  config: GuardrailConfig,
): Promise<void> {
  if (!ctx.hasUI) {
    console.info(renderPreferencesSummary(config));
    return;
  }

  const section = await chooseSection(ctx);
  if (!section) return;

  if (section === "posture") {
    await openPostureSection(ctx, config);
  } else if (section === "aliases") {
    await openProductionAliasesEditor(ctx, config);
  } else if (section === "advanced") {
    await showAdvancedOverrides(ctx);
  } else {
    await openDescriptorSection(ctx, config, section);
  }
}

async function chooseSection(ctx: ExtensionContext): Promise<GuardrailSettingsSection | undefined> {
  if (ctx.mode !== "tui") {
    const doneOption = "Done";
    const selected = await ctx.ui.select("SF Guardrail Settings", [
      ...SECTION_ITEMS.map((item) => `${item.label} — ${item.description}`),
      doneOption,
    ]);
    if (!selected || selected === doneOption) return undefined;
    return SECTION_ITEMS.find((item) => selected.startsWith(item.label))?.value;
  }

  return ctx.ui.custom<GuardrailSettingsSection | undefined>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("🛡 SF Guardrail Settings")), 1, 0));
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          "Choose a focused section. Each section includes examples and recommendations.",
        ),
        1,
        0,
      ),
    );

    const items: SelectItem[] = SECTION_ITEMS.map((item) => ({
      value: item.value,
      label: item.label,
      description: item.description,
    }));
    const list = new SelectList(items, items.length, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    list.onSelect = (item) => done(item.value as GuardrailSettingsSection);
    list.onCancel = () => done(undefined);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "↑↓ choose · Enter open · Esc close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

async function openPostureSection(ctx: ExtensionContext, config: GuardrailConfig): Promise<void> {
  const options = [
    "Apply Power Tool — every risky rule asks you first",
    "Apply Strict — secrets, credentials, and CLI state block; other rules ask",
    "Back",
  ];
  const choice = await ctx.ui.select(
    [
      "Safety posture",
      "",
      "Power Tool keeps SF Pi powerful: risky actions ask the human.",
      "Strict blocks selected sensitive categories while keeping other risks confirmable.",
    ].join("\n"),
    options,
  );
  if (!choice || choice === "Back") return;

  if (choice.startsWith("Apply Power Tool")) {
    applyGuardrailPreset("powerTool", config);
    ctx.ui.notify("Power Tool preset applied: every risky rule is set to Ask me.", "info");
    return;
  }

  applyGuardrailPreset("strict", config);
  ctx.ui.notify(
    "Strict preset applied: secret, credential, and CLI-state rules are set to Block; other rules are Ask me.",
    "info",
  );
}

async function openDescriptorSection(
  ctx: ExtensionContext,
  config: GuardrailConfig,
  section: GuardrailSettingsSection,
): Promise<void> {
  const descriptors = buildGuardrailPreferenceDescriptors(config).filter(
    (descriptor) => descriptor.section === section,
  );
  if (descriptors.length === 0) {
    ctx.ui.notify("No settings in this section.", "info");
    return;
  }

  if (ctx.mode !== "tui") {
    await openDescriptorDialog(ctx, config, descriptors, section);
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const working = cloneConfig(config);
    let selected = 0;

    const applyValue = (direction: 1 | -1) => {
      const descriptor = descriptors[selected];
      if (!descriptor) return;
      const currentValue = preferenceValue(working, descriptor.key);
      const index = Math.max(0, descriptor.values.indexOf(currentValue));
      const nextIndex = (index + direction + descriptor.values.length) % descriptor.values.length;
      const nextValue = descriptor.values[nextIndex];
      updateWorkingConfig(working, descriptor, nextValue);
      updateUserPreference(descriptor.key, nextValue, working);
    };

    return {
      render: (width: number) =>
        renderDescriptorSection(width, theme, working, descriptors, section, selected),
      invalidate: () => undefined,
      handleInput: (data: string) => {
        if (matchesKey(data, "escape") || data === "q") {
          done();
          return;
        }
        if (matchesKey(data, "up") && selected > 0) selected -= 1;
        else if (matchesKey(data, "down") && selected < descriptors.length - 1) selected += 1;
        else if (matchesKey(data, "right") || matchesKey(data, "enter") || data === " ") {
          applyValue(1);
        } else if (matchesKey(data, "left")) {
          applyValue(-1);
        }
        tui.requestRender();
      },
    };
  });
}

async function openDescriptorDialog(
  ctx: ExtensionContext,
  config: GuardrailConfig,
  descriptors: GuardrailPreferenceDescriptor[],
  section: GuardrailSettingsSection,
): Promise<void> {
  const working = cloneConfig(config);
  while (true) {
    const doneOption = "Back";
    const entries = descriptors.map((descriptor, index) => ({
      descriptor,
      option: `${index + 1}. ${descriptor.label} — current: ${displayValue(preferenceValue(working, descriptor.key))}`,
    }));
    const selected = await ctx.ui.select(sectionTitle(section), [
      ...entries.map((entry) => entry.option),
      doneOption,
    ]);
    if (!selected || selected === doneOption) return;

    const entry = entries.find((candidate) => candidate.option === selected);
    if (!entry) return;
    const picked = await ctx.ui.select(
      detailText(entry.descriptor, preferenceValue(working, entry.descriptor.key)),
      entry.descriptor.values.map(displayValue),
    );
    const raw = entry.descriptor.values.find((value) => displayValue(value) === picked);
    if (!raw) continue;
    updateWorkingConfig(working, entry.descriptor, raw);
    updateUserPreference(entry.descriptor.key, raw, working);
  }
}

function renderDescriptorSection(
  width: number,
  theme: Theme,
  config: GuardrailConfig,
  descriptors: GuardrailPreferenceDescriptor[],
  section: GuardrailSettingsSection,
  selected: number,
): string[] {
  const lines: string[] = [];
  const border = "─".repeat(Math.max(0, width - 2));
  lines.push(theme.fg("borderAccent", border));
  lines.push(theme.fg("accent", theme.bold(`🛡 ${sectionTitle(section)}`)));
  lines.push(theme.fg("dim", sectionDescription(section)));
  lines.push("");

  const valueWidth = 12;
  for (let i = 0; i < descriptors.length; i++) {
    const descriptor = descriptors[i];
    if (!descriptor) continue;
    const current = displayValue(preferenceValue(config, descriptor.key));
    const prefix = i === selected ? theme.fg("accent", "→ ") : "  ";
    const labelWidth = Math.max(20, width - valueWidth - 4);
    const label = truncateToWidth(descriptor.label, labelWidth);
    const pad = " ".repeat(Math.max(1, labelWidth - visibleWidth(label) + 1));
    const value = i === selected ? theme.fg("accent", current) : theme.fg("muted", current);
    lines.push(`${prefix}${label}${pad}${value}`);

    if (i === selected) {
      lines.push(...detailLines(theme, descriptor, preferenceValue(config, descriptor.key), width));
    }
  }

  lines.push("");
  lines.push(theme.fg("dim", "↑↓ move · ←→/Enter change · Esc close"));
  lines.push(theme.fg("borderAccent", border));
  return lines.map((line) => truncateToWidth(line, width));
}

function detailLines(
  theme: Theme,
  descriptor: GuardrailPreferenceDescriptor,
  currentValue: string,
  width: number,
): string[] {
  const indent = "    ";
  const lines = [
    `${indent}${theme.fg("muted", descriptor.description)}`,
    descriptor.example
      ? `${indent}${theme.fg("dim", `Example: ${descriptor.example}`)}`
      : undefined,
    `${indent}${theme.fg("dim", `Recommended: Power Tool ${descriptor.powerToolRecommendation ?? displayValue(currentValue)} · Strict ${descriptor.strictRecommendation ?? displayValue(currentValue)}`)}`,
    descriptor.why ? `${indent}${theme.fg("dim", `Why: ${descriptor.why}`)}` : undefined,
    `${indent}${theme.fg("dim", "Values: Ask me = prompt · Block = refuse · Off = do not guard")}`,
  ].filter((line): line is string => !!line);

  return lines.flatMap((line) => wrapPlainLine(line, width));
}

function wrapPlainLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];
  return [truncateToWidth(line, width - 1, "…")];
}

async function showAdvancedOverrides(ctx: ExtensionContext): Promise<void> {
  const text = [
    "Advanced overrides",
    "",
    "Most users do not need JSON overrides.",
    "Path: ~/.pi/agent/sf-guardrail/rules.json",
    "Use this only for custom patterns or full rule replacement by id.",
  ].join("\n");
  await ctx.ui.select(text, ["Back"]);
}

function renderPreferencesSummary(config: GuardrailConfig): string {
  return [
    "SF Guardrail settings require an interactive Pi UI or RPC UI client.",
    "Sections:",
    ...SECTION_ITEMS.map((item) => `- ${item.label}: ${item.description}`),
    "",
    "Current core preferences:",
    ...buildGuardrailPreferenceDescriptors(config)
      .filter((descriptor) => descriptor.section === "core")
      .map(
        (descriptor) =>
          `- ${descriptor.label}: ${displayValue(preferenceValue(config, descriptor.key))}`,
      ),
  ].join("\n");
}

function updateWorkingConfig(
  config: GuardrailConfig,
  descriptor: GuardrailPreferenceDescriptor,
  value: string,
): void {
  if (descriptor.key.startsWith("policies.rules.")) {
    const ruleId = descriptor.key.slice("policies.rules.".length, -".enabled".length);
    const rule = config.policies.rules.find((candidate) => candidate.id === ruleId);
    if (rule) applyRuleBehavior(rule, value);
    return;
  }

  if (descriptor.key.startsWith("commandGate.patterns.")) {
    const patternId = descriptor.key.slice("commandGate.patterns.".length, -".enabled".length);
    const pattern = config.commandGate.patterns.find((candidate) => candidate.id === patternId);
    if (pattern) applyRuleBehavior(pattern, value);
    return;
  }

  if (descriptor.key.startsWith("orgAwareGate.rules.")) {
    const ruleId = descriptor.key.slice("orgAwareGate.rules.".length, -".enabled".length);
    const rule = config.orgAwareGate.rules.find((candidate) => candidate.id === ruleId);
    if (rule) applyRuleBehavior(rule, value);
    return;
  }

  switch (descriptor.key) {
    case "enabled":
      config.enabled = value === "on";
      break;
    case "features.policies":
      config.features.policies = value === "on";
      break;
    case "features.commandGate":
      config.features.commandGate = value === "on";
      break;
    case "features.orgAwareGate":
      config.features.orgAwareGate = value === "on";
      break;
    case "features.promptInjection":
      config.features.promptInjection = value === "on";
      break;
    case "confirmTimeoutMs": {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) config.confirmTimeoutMs = parsed;
      break;
    }
  }
}

function applyRuleBehavior(
  target: { behavior?: RuleBehavior; enabled?: boolean },
  value: string,
): void {
  const behavior = ruleBehaviorFromLabel(value) ?? "confirm";
  target.behavior = behavior;
  target.enabled = behaviorEnabled(behavior);
}

function displayValue(value: string): string {
  switch (value) {
    case "confirm":
      return "Ask me";
    case "hard block":
    case "block":
      return "Block";
    case "off":
      return "Off";
    case "on":
      return "On";
    default:
      return value.endsWith("000") ? `${Number(value) / 1000}s` : value;
  }
}

function detailText(descriptor: GuardrailPreferenceDescriptor, currentValue: string): string {
  return [
    descriptor.label,
    "",
    descriptor.description,
    descriptor.example ? `Example: ${descriptor.example}` : undefined,
    `Recommended: Power Tool ${descriptor.powerToolRecommendation ?? displayValue(currentValue)} · Strict ${descriptor.strictRecommendation ?? displayValue(currentValue)}`,
    descriptor.why ? `Why: ${descriptor.why}` : undefined,
    "Values: Ask me = prompt · Block = refuse · Off = do not guard",
  ]
    .filter(Boolean)
    .join("\n");
}

function sectionTitle(section: GuardrailSettingsSection): string {
  return SECTION_ITEMS.find((item) => item.value === section)?.label ?? "SF Guardrail Settings";
}

function sectionDescription(section: GuardrailSettingsSection): string {
  return SECTION_ITEMS.find((item) => item.value === section)?.description ?? "";
}

function cloneConfig(config: GuardrailConfig): GuardrailConfig {
  return JSON.parse(JSON.stringify(config)) as GuardrailConfig;
}
