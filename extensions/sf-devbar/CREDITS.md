# Credits

## Inspiration

- **[Nico Bailon (@nicobailon)](https://github.com/nicobailon)** —
  [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer)
  (MIT). `sf-devbar` was inspired by `pi-powerline-footer` and reuses its
  design language: powerline thin-right separators, the teal working-folder
  color (`#00afaf`), the pink/mauve model color (`#d787af`), and the softer
  pastel rainbow palette used for the thinking-level badge. Shout out to
  Nico for establishing the visual conventions.

## What's adapted vs. built from scratch

**Adapted from `pi-powerline-footer`:**

- Powerline separator glyphs and the segment-pill visual style
- Working-folder teal color
- Model name pink/mauve color
- Pastel rainbow palette and rainbow-activation rules (high / xhigh thinking)

**Built from scratch for sf-pi:**

- Salesforce org context (org name, type, connection status)
- SF CLI version and freshness check
- Context-window progress bar
- Git branch + added/modified/deleted change counts
- SF LLM Gateway gold badge
- Per-extension status pills (SF Pi packages, gateway monthly budget,
  Slack connection)
- Bottom bar as a separate surface from the top bar
- Ctrl+Shift+B keyboard toggle

## Acknowledgements

- [Mario Zechner (@mariozechner)](https://github.com/mariozechner) —
  [pi coding agent](https://pi.dev) runtime this extension builds on.
