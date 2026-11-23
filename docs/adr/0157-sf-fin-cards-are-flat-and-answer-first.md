---
id: "0157"
status: accepted
date: 2026-11-23
---

# SF Fin cards are flat and answer first

## Context

Every `sf_fin` result already keeps two audiences apart, as ADR 0065 and ADR 0143 do for SF Docs and Data 360: the model gets the operation's compact text, and the person gets a Result Card built from structured details. The Fin cards used the shared SF Pi result-card panel. That panel draws a second background box inside Pi's own tool tile and repeats Summary, Scope, and Execution headings on every card.

Pi shows tool results collapsed until the person expands them, so the collapsed card is what most people read. In that view the Fin cards buried the answer. A readiness check put its one open item at row 19 of 33 and cut it off mid-word. Status labels did not match the state: a paused procedure showed success, a failed test showed "Blocked", and a healthy doctor run showed "Info". Six results had no presenter and fell back to the operation's text split into numbered rows.

## Decision

SF Fin owns a flat card shape (`FinCard`) and renderer (`fin-card.ts`), like the Apex, SOQL, and Flow cards. A card has one status headline with quiet facts, an optional lead sentence, typed blocks (rows, meter, stages, bars, flow, chat, grid, text), one plain next step, and an optional hint. It draws directly on Pi's tool tile. Long values wrap under their own column at any width, and every line is padded to the tile width.

Cards answer first and show only what needs the person when collapsed. Full detail sits in `expandedOnly` blocks behind Pi's expand key. Status follows the result: a paused or partly ready result is a review, a failed test or expectation is an error named "failed", and a refused change says why and that nothing changed. Cards use plain words and local times. Fin's resolution states appear as plain outcomes, with the stored values in the expanded view. Next steps are plain sentences. A slash command appears only when it confirms before changing anything, and tool-call syntax stays in the model text.

Every known result has its own presenter, built from structured details. Operations whose facts were only in text now also return them as details: status, doctor checks, setup credentials, and admin page descriptions. The model packet is unchanged. The live sweep (`npm run e2e:sf-fin`) renders every card at two widths and fails on overflow, the old scaffolding headings, or numbered-row fallback.

The shared result-card renderer used by other extensions is unchanged.

## Consequences

- Collapsed cards are shorter and lead with the answer; the readiness card goes from 33 rows to 12.
- Cards stay readable at narrow widths because values wrap instead of being clipped.
- Status icons can be trusted at a glance.
- New sf_fin operations need a presenter and a test, or they fall back to a generic card that shows the first text line.
- Card tests run against sanitized fixtures captured from real results, so a change in a result's shape shows up as a failing card test.
