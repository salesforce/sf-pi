# ADR 0048: SF Welcome does not own Pi Runtime release notes

SF Welcome may keep a small **Pi Runtime Freshness Row** so users can see when the upstream Pi Runtime should be updated for SF Pi compatibility, but it should not parse or render a **Pi Runtime Release Notes Surface**. Upstream Pi owns its own release-note and changelog experience; SF Pi startup surfaces should stay focused on Salesforce workflows, SF Pi release freshness, extension readiness, and actionable onboarding. This removes a custom changelog parser/acknowledgement path from SF Pi and keeps the product boundary simple.
