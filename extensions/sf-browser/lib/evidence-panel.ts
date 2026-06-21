/* SPDX-License-Identifier: Apache-2.0 */
/** Visible Browser Evidence rendering for SF Browser command output. */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Image, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export interface SplitEvidenceContent {
  text: string;
  image?: ImageContent;
}

export function splitEvidenceContent(
  content: Array<TextContent | ImageContent>,
): SplitEvidenceContent {
  const text = content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const image = content.find((part): part is ImageContent => part.type === "image");
  return { text, image };
}

export async function openEvidencePanel(
  ctx: ExtensionCommandContext,
  options: { title: string; text: string; image: ImageContent },
): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => {
      const panel = new EvidencePanelComponent(theme, options, done);
      return {
        render: (width: number) => panel.render(width),
        invalidate: () => panel.invalidate(),
        handleInput: (data: string) => panel.handleInput(data),
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "72%",
        minWidth: 72,
        maxHeight: "90%",
        anchor: "center",
        margin: 2,
      },
    },
  );
}

class EvidencePanelComponent {
  private imageComponent?: Image;

  constructor(
    private readonly theme: Theme,
    private readonly options: { title: string; text: string; image: ImageContent },
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      matchesKey(data, "return") ||
      data === "q"
    ) {
      this.done();
    }
  }

  invalidate(): void {
    this.imageComponent?.invalidate();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    const lines: string[] = [];
    lines.push(this.theme.fg("success", this.theme.bold(`📸 ${this.options.title}`)));
    lines.push("");

    for (const rawLine of this.options.text.split(/\r?\n/)) {
      if (!rawLine.trim()) {
        lines.push("");
        continue;
      }
      for (const wrapped of wrapTextWithAnsi(rawLine, innerWidth)) {
        lines.push(this.theme.fg("text", wrapped));
      }
    }

    lines.push("");
    lines.push(this.theme.fg("toolTitle", this.theme.bold("Screenshot preview")));
    lines.push(...this.image().render(innerWidth));
    lines.push("");
    lines.push(this.theme.fg("dim", "Enter/Esc/q to close"));

    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  private image(): Image {
    if (!this.imageComponent) {
      this.imageComponent = new Image(
        this.options.image.data,
        this.options.image.mimeType,
        { fallbackColor: (value: string) => this.theme.fg("muted", value) },
        { maxWidthCells: 100, maxHeightCells: 32 },
      );
    }
    return this.imageComponent;
  }
}
