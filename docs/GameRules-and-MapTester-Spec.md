# Game Rules & Map Tester Specification

Status: **v4 — rules complete. Part 2 lists only the simulator's working assumptions.**

---

## Part 1 — Game Rules (confirmed)

### 1.1 Overview

- 2–5 players race across a looping map to collect Victory Points (VP).
- The game ends **immediately** (mid-turn) when the last Large Coin is collected.
- Highest total VP wins. Tie-breaker: game owner decides.

### 1.2 Board Geometry

- 4 map tiles form a closed square loop around an empty 3×3 center → the whole board is a **9×9 space grid with the center 3×3 empty** (72 playable spaces). Played cards go to the empty center.
  - Top & bottom tiles: horizontal 6×3. Left & right tiles: vertical 3×6.
- Only map tile 1 is revealed at start. Reveal trigger: when only **one Large Coin remains in total across all revealed tiles**, reveal the next tile clockwise.
- **Checkpoint:** each tile's checkpoint space is the middle space of its first row (checkpoint symbol). The dynamic Checkpoint marker moves there when a tile is revealed.
- Humans all start on tile 1's checkpoint space.
- **Element icons** on tiles show what to place on reveal (platform first, then coins on top).
- **Sky tiles** (ground painted `Sky block.png`): void for Humans — a Human cannot enter bare sky, and one that falls/is pushed into it is knocked down and respawns on the Checkpoint marker. Objects work over sky: mountains and platforms standing on sky spaces are climbable/standable as normal, rails cross sky, and boxes/trains **can** be pushed onto sky spaces (they don't fall).
- **Rails** connect orthogonally *and diagonally* — a train moves freely between any two touching rail spaces.
- **Train movement** (one Interact / Hack activation): the train travels any number of spaces **in a straight line** along the rails; turning requires stopping and spending another action. It cannot pass mountains or other trains and cannot leave the map. It **pushes boxes** ahead of it while the box's next space is free (not a mountain, not out of bounds; sky is fine). A Human on the ground in its path is **instantly killed**: drops 2 Small Coins (claimable) and respawns on the Checkpoint marker. **Ground coins in its path are destroyed.** Humans and coins riding on top of a train (or pushed box) ride along.
- **Dragging platforms**: per the Grab rules, a Human can grab an orthogonally adjacent box *or train* and drag it while moving (both translate together); the platform's path must be free. The simulator's AI uses this to bridge mountains when no train can reach them.

### 1.3 Victory Points

| Type | Value | Notes |
|---|---|---|
| Small Coin | 1 VP | per tile: one pile of 3 + one pile of 4 |
| Large Coin | double-sided, hidden | flipped at game end — 50/50 which side is true |
| Friendship Token | double-sided **1 / 3 VP** | also flipped at game end, 50/50 |

Large Coins per map tile (two large platforms each):

| Map tile | Coin A | Coin B |
|---|---|---|
| 1 | 4 / 6 | 5 / 7 |
| 2 | 5 / 7 | 6 / 8 |
| 3 | 6 / 8 | Friendship ×2 / ×3 |
| 4 | 7 / 9 | Small Coins ×2 / ×3 |

Multiplier coins multiply the VP from that source for their collector.

### 1.4 Movement, Levels & Knock-down

- **Move** (1 Action): 1–2 spaces orthogonally. Moving **down one level** is part of a normal move; dropping from **2 levels** knocks you down.
- **Knocked down:** the Human drops 2 Small Coins (or as many as they have, only 1-value coins) into their space — anyone may Claim them — and their turn ends. If knocked down outside their own turn, they lie knocked down and **stand up at the start of their own turn**.
- Objects 1–2 levels higher block movement (climb instead). Humans may share a space.
- Map edges are "sky": a Human entering sky is placed on the Checkpoint marker space (this is a knock-down when caused by being thrown).
- **Climb** (1 Action): up 1 level; 2-level objects only from an adjacent smaller object you stand on.

### 1.5 Grab

- Grab a **Human**: share their space. Shifting them aside, throwing them off the map, or squishing them **knocks them down**; a squished Human is additionally placed on the Checkpoint marker.
- Grab a **platform** (level-1 object): be orthogonally adjacent ("facing its wall" = orthogonal adjacency; no facing state exists).
- Grabbed platforms move with you while nothing blocks their path. Mountains (level-2) are immovable. Trains act like platforms (carry Humans/coins, can push/block).
- Release any time; auto-release at end of turn.

### 1.6 Action Economy

- 3 Action Tokens, refreshed every turn.
- **Each Action Token pays for one Minor Action AND later one Major Action** (max turn = 3 Minors + 3 Majors). Actions may repeat.

| Action | Type | Effect |
|---|---|---|
| Grab | Minor | see 1.5 |
| Interact | Minor | from a control panel space: move **any train** orthogonally any number of spaces along its tracks |
| Claim | Minor | collect ALL tokens (small, large, friendship) in your space |
| Move | Major | 1–2 spaces orthogonally |
| Climb | Major | up 1 level |
| Activate a Card | Major | trigger **this turn's played initiative card** effect (only that card) |
| Catch Up | 3 Actions | place your Human on the Checkpoint marker |

### 1.7 Initiative & Cards (confirmed)

- **Every player owns an identical 13-card deck** (the 13 effects below), marked as theirs.
- Hands hold **other players' cards**, drawn **at random from the top** of each deck per the player-count table below. Between rounds decks are **not reshuffled**; you draw from each deck's unused cards.
- **Turn flow:** at turn start you must play one card from your hand to the center. The player whose deck that card belongs to **takes the next turn**. During your turn you may spend 1 Action to trigger the played card's effect (optional, once). Played cards stay on the table permanently.
- If the named player has no cards in hand when their turn comes, the **next player clockwise** with cards takes the turn instead.
- A **round** ends when all players have emptied their hands; new hands are drawn and **the player named on the last played card** starts the new round.
- First player of the game: random.

Hand distribution per player count (per round where noted):

| Players | Hand |
|---|---|
| 2 | opponent's 3 cards + 2 cards of a neutral 3rd Human. Both players control the 3rd Human alternately (control passes to the other player after each of its turns); its claims count **for the active player** controlling it. |
| 3 | R1: 1 card of left player + 2 of right; R2 reversed; R3 like R1… |
| 4 | 1 card of each other player (3 total) |
| 5 | R1: 1 card of each of the 3 players to your right; R2: to your left; R3 like R1… |

### 1.8 The 13 Cards (all confirmed except Trample micro-detail)

Card art: `TextureAssets/Cards/` (names printed on the art).

| Card | Effect (rules-complete) |
|---|---|
| Trick | Swap two Humans within Manhattan distance 2 (2 orthogonal steps; diagonal counts as 2). Height ignored. |
| Jump | Move 1–2 spaces, may cross gaps. Landing space must be same height or lower. No fall damage. |
| Parkour | Move or Climb 1 space diagonally. No fall damage. |
| Group Up | Choose a space with a Human. Starting with you, clockwise, each player **may** place their Human there. |
| Motivate | Place one of your Friendship Tokens in your space if able (claimable by anyone). Refresh 2 Action Tokens. |
| Command | Perform any one action controlling another Human (the action itself costs nothing extra — the card's activation covers it). A commanded Claim gives tokens to the **controlled** player. |
| Hug | Attach to a Human in your space until your next turn: you move whenever they move; no early release. Gain a Friendship Token from them if able. |
| Hack | Activate a Control Panel up to 2 times, from anywhere. |
| Mislead | Swap positions of the Checkpoint marker and any Human. |
| Confuse | Swap one card between two players' hands, unseen. |
| Pickpocket | Take half (rounded down) of the **Small Coins** of a Human in your space. |
| Trample | Move any number of spaces in a straight line, announced space by space. Entering a platform's space: pick the platform up, complete the step, then place it in any space without a platform/level-2 object — the placed platform pushes Humans/Coins along the push direction. A Human whose push is blocked (wall, mountain, another platform) is **squished**: knocked down and placed on the Checkpoint marker. Knock down every Human in your path. No climbing: stepping down 2 levels (e.g. level-2 onto where a box was) pushes the box and knocks you down, ending the move. |
| Whine | Until your next turn no player may activate cards. Any other player may pay you one Friendship Token to cancel the **whole** effect. |

### 1.9 Friendship & Deals

- Friendship Tokens: double-sided 1/3 VP; gained via cards, deals, helping.
- Deals bind for the current turn only; breaking a deal is not allowed. Simulation models deals only via card effects and Whine payments — free-form negotiation is out of scope.

### 1.10 Playtime Reference

- 4 players ≈ 7 turns each, 20–30 min per player → 80–120 min. Simulator reports `turns × minutes-per-turn` (configurable, default 3.5 min).

### 1.11 AI Player Personas

1. **Bully** — knock-downs, steals, disruption. 2. **Diplomat** — helping, friendship farming, opportunistic points. 3. **Racer** — beelines for the biggest values, action-optimal.

---

## Part 2 — Simulator Working Assumptions

All rules questions are answered. These small table-ruling assumptions are baked into the simulator — flag any that are wrong:

- **A1.** A **Coin** whose push (by a displaced platform) is blocked simply stays in the platform's space (ends up riding the platform). Coins in a space a train enters hop onto the train and ride it.
- **A2.** A Human thrown off the map / into sky counts as knocked down: drops 2 Small Coins in the space they were thrown from, then respawns on the Checkpoint marker. (Confirmed: blocked pushes = squished → knock-down + checkpoint.)
- **A3.** Hug: if the hugged Human is knocked down, the attachment ends.
- **A4.** Group Up places Humans regardless of height (it's a teleport, no fall damage).
- **A5.** Unrevealed map tiles cannot be entered by Humans or trains.
- **A8.** Train "straight line" includes diagonal directions (a constant diagonal heading counts as straight).
- **A9.** Trains cannot push other trains; a box pushed by a train squishes Humans standing where it lands (knock-down + checkpoint); a Human killed by a train drops coins into the path, where the train destroys them.
- **A10.** Dragged trains behave like boxes (they can be dragged off the rails).
- **A11.** When all decks and hands are exhausted, play continues clockwise without initiative cards until the last Large Coin is collected.
- **A6.** 2-player mode: after the neutral third Human's turn, the next player is chosen clockwise (the third Human plays no initiative card of its own).
- **A7.** New hands are drawn blind from the top of each (never reshuffled) deck; the player named on the last played card opens the new round.

**Simulator limitations:** free-form deals aren't modeled; Command is modeled as repositioning an opponent. (Platform dragging IS modeled: the AI grabs and drags boxes/trains to bridge mountains when trains can't reach them.)

**Map flag:** a 2-space rail segment on the right edge (global (8,5)–(8,6), Tile_3 local (5,2) + Tile_4 local (0,0)) is disconnected from the rest of the rail network even diagonally — no train can ever reach it. Connect it or remove it if unintended.

---

## Part 3 — Map Tester Feature Spec

**Status: BUILT (v1).** The **Map Tester** tab simulates full games on a saved board (`public/js/sim/`: `model.js` extraction, `engine.js` rules+AI, `tester.js` UI). Setup: board, 2–5 players, persona per seat, game count, minutes/turn. **▶ Calculate** runs N games and reports playtime, turns/rounds/moves, win rates by seat & persona, VP source breakdown, tile reveal timing, card usage, knock-downs, plus a visit heatmap on the 3D board. Each listed game has a **▶ Replay**: video-player controls (play/pause, 0.5×–8×, step, turn skip, jump to start/end), a scrubbable timeline with event markers (cards, reveals, knock-downs, large coins), fog-of-war covers on unrevealed tiles, and a **card history strip** — click any played card to jump to the moment it was played. The AI understands the map's core puzzle: driving trains next to mountains to climb them for the Large Coins.

### 3.1 Map Builder prerequisites

1. ~~Card upload~~ ✅ Game Assets tab → Cards (`TextureAssets/Cards`).
2. ~~Character model upload~~ ✅ Game Assets tab → Characters (.fbx/.glb/.obj, `TextureAssets/Characters`); previewed with plain white material until real textures are added.
3. ~~**Gameplay markers**~~ ✅ **Marker tool** (📍, key M) in the Sub-Board Editor stamps invisible game data onto tiles, shown as small corner badges:
   - `CP` Checkpoint · `C3`/`C4` Small Coin piles · `LA`/`LB` Large Coin platforms (collection order A then B) — one each per sub-board (stamping elsewhere moves them)
   - `PN` Control Panel · `RL` Rail/Track — any number
   - Markers save with the sub-board; erase tool and the tile's Selection panel remove them.
4. ✅ **Map tile # (1–4)** field on each placed sub-board in Board Assembly (Selection panel) — defines reveal order; shown as a #n badge in the board list.
5. **Card effect definitions** — implemented in the simulator's code (the 13 effects are fixed rules, not map data); card names are read from the art.

### 3.2 Simulation Engine

- Deterministic rules engine of Part 1 (grid, levels, humans, grab/throw, knock-down, trains, coins, initiative & the 13 cards).
- AI: heuristic search over each turn's action combinations + persona scoring (Bully / Diplomat / Racer).
- N games per configuration (2–5 players, persona mix), randomized coin/friendship faces and initiative draws.

### 3.3 Analysis Output ("Calculate" button)

- Playtime (turns × 3.5 min default): avg / min / max
- Avg moves per game & player; avg rounds; tile reveal timing
- VP stats: winning score, spread, source breakdown (small / large / friendship / multipliers)
- Win rate by seat position and persona
- Large Coin collection order & timing; card usage frequency & impact; knock-down counts
- Space-visit heatmap on the 3D map; flags: unreachable coins, dead zones, degenerate strategies

### 3.4 Replay Player ("Replay" button)

- Play/pause, 0.5×–8× speed, step move-by-move, skip to next turn / round / reveal
- Timeline scrubber with event markers (coin, reveal, card, knock-down)
- **Card history track**: ordered played-card list; click a card to jump the replay to that moment
- State sidebar: active player, action tokens, per-player coins & friendship, revealed tiles
