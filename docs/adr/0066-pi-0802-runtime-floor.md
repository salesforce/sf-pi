# ADR 0066: Pi 0.80.2 runtime floor

Status: accepted

SF Pi will raise its minimum **Pi Runtime** to `0.80.2` as a clean **Runtime Floor Adoption Slice**. Pi 0.80 moves the old global `pi-ai` streaming/catalog API off the root package and removes the short-lived selective-provider base entrypoints. Pi 0.80.2 restores temporary compatibility aliases for runtime continuity, but SF Pi should not rely on that bridge for source code that typechecks against published package types.

The adoption rule is:

- Update package metadata, lockfile, runtime gate, and version-floor tests together.
- Use root Pi package imports for neutral helper types and schema helpers that remain exported there.
- Use `@earendil-works/pi-ai/compat` for legacy streaming/catalog functions that Pi has explicitly moved there.
- Do not add a local compatibility shim when Pi provides a documented migration entrypoint.
- Defer any deeper `createModels()` / provider-factory migration to a separate behavior-proven slice.

This keeps SF Pi aligned with Pi's public package boundaries and avoids carrying local dead compatibility code once older Pi versions are no longer supported.
