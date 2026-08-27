# The Game - Rules as the Code Enforces Them

**Status: Reference.** The authority on the *tabletop* rules is
`docs/GameRules-and-MapTester-Spec.md` (v4, "rules complete"). This file restates
what **`sim/engine.js` actually implements**, and flags every place the two differ.
When they disagree, the spec is the design intent and this file is the truth about
the simulator's numbers.

## The game in one paragraph

Two to five players race Humans around a looping board of four map tiles,
collecting coins for Victory Points. Turn order is not fixed: each turn you play a
card from your hand into the centre, and **the player whose deck that card came
from takes the next turn**. The game ends the instant the last Large Coin is
claimed - possibly mid-turn - and the highest VP total wins.

## Board geometry

- Four map tiles form a **closed square loop around an empty 3x3 centre**: a 9x9
  grid with 72 playable spaces. Played cards go in the middle.
- Top and bottom tiles are horizontal 6x3; left and right are vertical 3x6. The
  shipped sub-boards are all 3x6 and rotated into place ([[Board-Assembly]]).
- **Only map tile 1 is revealed at the start.** When only **one Large Coin remains
  across all revealed tiles**, the next tile clockwise is revealed.
- Each tile's **checkpoint** is the middle space of its first row. The single
  dynamic Checkpoint marker moves there when the tile is revealed.
- **Sky** spaces are void for Humans: you cannot enter bare sky, and being pushed
  into it knocks you down and respawns you on the Checkpoint marker. Objects work
  over sky - mountains and platforms on sky spaces are climbable, rails cross it,
  and boxes and trains can be pushed onto it without falling.

### Levels

| Thing | Level | Notes |
|-------|------:|-------|
| Grass ground | 0 | |
| Box / train (a half-height cube) | 1 | movable platform |
| Mountain (a full-height cube) | 2 | immovable |
| Bare sky | - | not standable at all |

Objects 1-2 levels higher block movement - you climb instead. Moving **down one**
level is part of a normal move; dropping **two** knocks you down.

## Victory points

| Source | Value |
|--------|-------|
| Small Coin | 1 VP. Per tile: one pile of 3 and one pile of 4 |
| Large Coin | double-sided, hidden, **flipped at game end** - 50/50 which face is true |
| Friendship Token | double-sided **1 / 3 VP**, also flipped at game end |

Large coins per tile, in platform order A then B (`LARGE_DEFS` in `sim/model.js`):

| Tile | Coin A | Coin B |
|-----:|--------|--------|
| 1 | 4 / 6 | 5 / 7 |
| 2 | 5 / 7 | 6 / 8 |
| 3 | 6 / 8 | **Friendship x2 / x3** |
| 4 | 7 / 9 | **Small Coins x2 / x3** |

The two multiplier coins multiply the VP their holder earned from that source.

**This table is indexed by the tile's `order` field**, so a mis-numbered sub-board
gets the wrong coins - see [[Board-Assembly]].

## Action economy

Three Action Tokens, refreshed every turn. **Each token pays for one Minor action
and, later in the same turn, one Major action** - so a full turn is up to 3 Minors
plus 3 Majors. Actions may repeat.

| Action | Type | Effect |
|--------|------|--------|
| Grab | Minor | grab an adjacent platform, or a Human sharing your space |
| Interact | Minor | from a Control Panel space, move **any** train along its rails |
| Claim | Minor | collect **all** tokens in your space |
| Move | Major | 1-2 spaces orthogonally |
| Climb | Major | up one level |
| Activate a Card | Major | trigger **this turn's played card** only, once |
| Catch Up | **3 Actions** | place your Human on the Checkpoint marker |

## Knock-down

A knocked-down Human drops **2 Small Coins** (or as many as they hold) into their
space where anyone may Claim them, and their turn ends. Knocked down outside your
own turn, you lie there and **stand up at the start of your next turn**. Squished
or thrown off the map additionally means being placed on the Checkpoint marker.

## Grab

- **A Human**: share their space. Shifting them aside, throwing them off the map
  or squishing them knocks them down; a squished Human also goes to the Checkpoint.
- **A platform** (level-1 object): be orthogonally adjacent. Grabbed platforms move
  with you while nothing blocks their path. **Mountains are immovable.** Trains
  behave like platforms - they carry Humans and coins, push, and block.
- Release any time; automatic release at end of turn.

## Trains

One Interact (or Hack) activation moves a train **any number of spaces in a
straight line** along the rails. Turning requires stopping and spending another
action. A train:

- cannot pass mountains or other trains, and cannot leave the map;
- **pushes boxes** ahead of it while the box's next space is free (sky is fine);
- **instantly kills** a Human standing on the ground in its path - they drop 2
  Small Coins, which are then **destroyed along with any other ground coins in the
  path**, and respawn on the Checkpoint;
- carries Humans and coins riding on top of it, or on a box it pushes.

**Rails connect orthogonally *and* diagonally**, so a train moves freely between
any two touching rail spaces.

## Initiative and turn order

- Every player owns an **identical 13-card deck** ([[Cards]]), marked as theirs.
- Your hand holds **other players' cards**, drawn at random from the top of each
  deck per the table below. Decks are **never reshuffled** between rounds.
- At the start of your turn you **must play one card to the centre**. The player
  whose deck it came from takes the next turn. During your turn you may spend one
  Action to trigger that card's effect - optional, once.
- If the named player has no cards, the next player clockwise with cards goes.
- A **round** ends when every hand is empty; new hands are dealt and the player
  named on the last played card opens the new round.
- The first player of the game is random.

| Players | Hand |
|--------:|------|
| 2 | opponent's 3 cards + 2 cards of a **neutral third Human**, controlled alternately; its claims count for whoever controls it |
| 3 | R1: 1 from the left player + 2 from the right; R2 reversed; R3 like R1 |
| 4 | 1 card from each other player (3 total) |
| 5 | R1: 1 from each of the 3 players to your right; R2: to your left; alternating |

## Playtime

Four players, roughly 7 turns each. The simulator reports
`turns x minutes-per-turn`, default **3.5 min**, configurable in the setup panel.

---

## Where the simulator diverges from the spec

Honest list. None of these is a bug report; they are modelling choices, and the
first three are called out in the spec itself.

| Area | Spec | `engine.js` |
|------|------|-------------|
| Free-form deals | binding for the current turn | **not modelled** at all - only card effects and the Whine payment |
| Command | perform any one action controlling another Human | **modelled as repositioning**: shove the richest opponent one step away from their best target |
| Grabbing a Human | a full mechanic | only the aggressive case: a `Grab` + `Move` "shove" that knocks the victim down |
| Trample's "no climbing" clause | stepping down 2 levels pushes the box and knocks you down, ending the move | the straight-line scan **stops at mountains and at bare sky**; the level-drop clause is not modelled |
| Whine | no player may activate cards until your next turn | modelled: `st.whineBy`. Another player may pay one Friendship Token to cancel it, but only when their pending card is worth more than 2.5 utility |
| Hand exhaustion | play continues without initiative cards (assumption A11) | implemented: `cardsExhausted`, then clockwise order |
| Starting Friendship | not specified | every Human starts with **3** Friendship Tokens |
| Turn cap | none | the loop hard-stops at **300 turns** to guarantee termination |
| Action loop | none | a `guard` of 40 option evaluations per turn, and options scoring below 0.35 utility are not taken |

Two spec assumptions worth restating because the engine relies on them:

- **A8** - a train's "straight line" includes the four diagonals.
- **A10** - a dragged train behaves like a box and can be dragged off the rails.

And one map flag the spec raised that is worth re-checking whenever the board
changes: a 2-space rail segment on the right edge, global (8,5)-(8,6), was found
**disconnected from the rest of the rail network even diagonally**, so no train can
ever reach it.

## Related

[[Cards]] | [[Gameplay-Markers]] | [[Simulation-Engine]] | [[AI-Personas]] |
[[Board-Extraction]] | [[Board-Assembly]]
