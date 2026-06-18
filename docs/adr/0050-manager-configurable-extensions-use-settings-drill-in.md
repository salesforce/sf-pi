# SF Pi Manager configurable extensions use settings drill-in

Configurable extensions in the SF Pi Manager use a detail-to-settings drill-in instead of embedding their config panel directly inside the extension detail page. The extension detail page remains focused on identity, state, and actions. Selecting Settings opens the extension's config panel one page deeper. ADR 0055 refines the detail page into a user-first control page and moves bundle metadata / raw runtime-surface inventories out of the default Manager detail view.

This keeps extension details readable and prevents configurable extensions from crowding metadata and settings into one long panel. It also gives settings panels room to provide their own internal navigation, breadcrumbs, focused pages, and escape-back behavior without forcing every extension detail page to absorb that complexity.

**Consequences**

The Manager Surface has three conceptual levels: extension list, extension detail, and extension settings. Esc returns one level at a time. Config panels remain extension-owned adapters, but they are rendered only after the user explicitly chooses Settings from the detail page.

Existing configurable extensions keep their config panel contract. The Manager changes when that panel is mounted, not the `ConfigPanelFactory` interface itself.
