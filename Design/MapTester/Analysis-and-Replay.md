# Analysis and Replay

**Status: Built.** `public/js/sim/tester.js`, 572 lines.

The Map Tester's UI: pick a board, set up seats, run N games, read the report,
watch any of them back in 3D.

## Setup

Left panel, `tester-only`:

| Field | Default | Notes |
|-------|---------|-------|
| Board | first save | changing it re-extracts the model and re-renders the 3D board |
| Players | 4 | 2-5 |
| Persona per seat | cycles Racer / Bully / Diplomat | one dropdown per seat, coloured to match its piece |
| Games | 200 | 1-2000 |
| Min / turn | 3.5 | only affects the reported playtime |

`baseSeed` is fixed at **1000**, so game #1 of one run is game #1 of the next.
Re-running the same configuration gives the same report - which is what makes A/B
comparisons between two boards meaningful.

Seat colours: `#e05c5c #4f8cff #f2c74f #53d18a #b06ce0`, and grey `#9aa2b5` for the
neutral third Human in 2-player games.

## Running

`runSimulations` loops `simulate(model, cfg, baseSeed + g, false)`, accumulates the
per-game `visits` array into one heat buffer, **deletes `visits` from the summary**
so N summaries stay small, and yields to the event loop every 10 games so the
button can show `⏳ 137 / 200…` and the tab stays responsive.

Then `aggregate()` reduces the summaries into the report.

## The report

Right panel. Five tables plus a replay list.

**Headline**

| Row | Read it as |
|-----|------------|
| Playtime avg (min-max) | `turns x minPerTurn`. The number the design targets - 80-120 min for 4 players |
| Turns / game, turns / player | is the game the right length in *decisions*, not minutes |
| Rounds | how many times hands were dealt |
| Moves / player | how much walking the map demands |
| Winning score, score spread | is the finish close or a blowout |
| Knock-downs / game, claims / game | how violent, how busy |
| Ties | tie-breaker is "the owner decides", so a high number is a real problem |
| **Games where cards ran out** | the deck did not cover the map's length |

**Avg VP per player by source** - small / large / friendship. This is the balance
table. If friendship is near zero the Diplomat has nothing to do; if large coins
dominate, the small-coin piles are decoration.

**Win rate by seat** - first-player advantage, and any positional bias the map's
geometry creates.

**Win rate by persona** - normalised **per seat-game** (`personaWins / personaGames`),
not per game, so a persona that occupies two seats is not inflated. Read it
relatively, per the limitations in [[AI-Personas]].

**Tile reveals (avg turn)** - when each tile came into play. Uneven spacing means
the reveal clock is lumpy.

**Cards (played / activated per game)** - two separate columns; the gap between them
is the interesting part ([[Cards]]).

**Replay a game** - the first 15 games, each with its winner, turn count and a ▶.

## The heatmap

Every space visited by any Human in any game is counted (`st.visits[to]++` inside
`moveHumanTo`, which also counts a hugged passenger being dragged along). The
aggregate is drawn as translucent quads over the board, hue-mapped blue -> red:

```js
color   = HSL(0.66 - 0.66 * t, 0.9, 0.5)
opacity = 0.28 + 0.35 * t          // t = heat / max
```

lifted to y = 5.15 on mountains so a busy summit is not hidden inside the cube.

This is the fastest read in the whole tool: **dead zones show as bare board**. A
corner nobody ever walks into is either unreachable or not worth reaching, and
either way it is map that is not doing any work.

## The replay player

Pressing ▶ re-simulates that seed **with logging on** and gets the full event
stream back. Every event carries a `snap` - a compact snapshot of every Human's
position, coins and knocked state, every movable's position, every non-empty pile,
the checkpoint, the revealed tiles, the active seat, and the actions spent this
turn. So seeking is just "apply snapshot at index i", not a re-run.

The static board is rebuilt with `skipMovables` and `skipMarkers`, and the tester
adds its own dynamic layer:

| Piece | Geometry |
|-------|----------|
| Human | capsule in the seat colour; **rotates 90 deg on its side when knocked down** |
| Box / train | box, brown `0x8a6b3f` / red `0xb03434` |
| Checkpoint | green torus ring |
| Small coins | gold cylinder, height 0.28 per coin |
| Large coins | orange discs, stacked |
| Friendship | green box, height 0.5 per token |
| Unrevealed tiles | near-black boxes, 8 tall - **fog of war** |

Controls: play/pause, **0.5x - 8x**, step one event, previous / next turn, jump to
start / end, and a scrubbable slider. Playback advances one event per 460 ms
divided by the speed, and positions **lerp with an ease-out** between events, which
is why a two-step Move reads as walking rather than teleporting.

**The timeline is marked** with coloured ticks: card played (blue), tile revealed
(purple, tall), knock-down (red), large coin claimed (orange, tall). The shape of
that strip tells you the rhythm of a game before you press play.

**The card strip** below shows every played card's real art in order. Hovering
enlarges it; clicking jumps the replay to the moment it was played. The card
currently in force is highlighted (`isCurrentCard` - played at or before the
current index, with no later card in between).

**The player aid overlay** shows the real `PlayerAid.png` component with dots
positioned over the action boxes the active player has actually spent this turn -
`AID_MINOR` for Grab / Interact / Claim, `AID_MAJOR` for Move / Climb / Activate /
Catch Up, as percentages of the image. Repeated uses of the same action shift 3%
right so three Moves read as three dots. It is a literal answer to "is the action
economy being used".

The status line names the turn, the seat, its persona and a human-readable
description of the current event (`describeEvent`), followed by each player's
`coins ¢ / large ◎ / friendship ♥`.

## How to actually use this

A workflow that has proved itself:

1. **Fix the warnings first.** A board missing markers produces a report that looks
   fine and is wrong ([[Gameplay-Markers]]).
2. **Run 200 games at 4 players**, all three personas represented.
3. **Read playtime and the VP-source table.** These catch gross problems - a map
   that takes 40 turns, a friendship economy nobody touches.
4. **Look at the heatmap for dead zones.** Then go fix the map, not the numbers.
5. **Replay two or three games**, including a fast one and a slow one. The
   heuristic AI does things a human would not, and watching it is the only way to
   tell "the map has a degenerate line" from "the AI is being silly".
6. **Change one thing, re-run.** Same `baseSeed`, so the comparison is honest.

## Known gaps

- Only the **first 15 games** get a replay button; the rest are aggregated only.
- The report is built as an HTML string. Fine for these fixed fields, but it is the
  one place in the UI that is not `el()`-constructed.
- No export. Reading a report means having the app open; comparing two boards means
  writing the numbers down.
- `largeLabel()` exists in `model.js` and is unused - per-coin reporting was
  designed and never built.

## Related

[[Simulation-Engine]] | [[AI-Personas]] | [[Board-Extraction]] | [[Cards]] |
[[Gameplay-Markers]] | [[Rendering-3D]]
