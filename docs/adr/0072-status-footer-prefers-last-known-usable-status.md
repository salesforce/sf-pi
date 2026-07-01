# Status Footer Prefers Last-Known Usable Status

Compact status surfaces such as SF DevBar should prefer a **Last-Known Usable Status** with a `⚠ stale` suffix over a raw unavailable or failed probe state when a scoped successful snapshot exists. The current probe failure remains visible in detailed commands and panels, but the footer optimizes for human orientation during resumed sessions and transient probe failures.
