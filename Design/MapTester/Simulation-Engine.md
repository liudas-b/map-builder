# Simulation Engine

**Status: Built.** `public/js/sim/engine.js`, 1,241 lines - the largest file in the
project.

A deterministic rules engine plus the AI that drives it. Pure JavaScript: no DOM,
no `Math.random()`, no clock. `simulate(model, cfg, seed)` returns the same game
every time.

## Determinism, and why it matters

```js
const { summary } = simulate(model, cfg, seed, /* log */ false);   // stats pass
const { events }  = simulate(model, cfg, seed, /* log */ true);    // replay pass
```

The stats pass runs N games and **throws the event logs away** - only summaries are
kept, which is why 200 games do not exhaust memory. Pressing **Replay** on game #7
re-runs its seed with logging on and expects the identical game back. Every random
draw goes through `st.rnd`, a seeded `mulberry32`. **Introducing `Math.random()`
anywhere in `sim/` breaks replay silently**, which is the worst way for it to
break.

## The state object

```js
st = {
  model, cfg, rnd, log,
  humans: [...],           // one per seat (+1 neutral in 2-player)
  movables: [{id, kind, at}],
  piles: [{at, small, large:[], friend, ride}],
  checkpointAt, revealedTiles: [], largeLeft,
  decks: [], hands: [], played: [], whineBy,
  turnNo, roundNo, cur, ended, events: [],
  turnSpend: { minor: [], major: [] },
  visits: Uint32Array(S),
  stats: { reveals, knockdowns, claims, largeOrder, moves, played, activated },
}
```

A **human**: `{ s, persona, third, at, small, large[], friend, knocked, hug,
minors, majors, grabbed }`. Everyone starts on tile 1's checkpoint with
**3 Friendship Tokens**.

A **pile** is a stack of tokens on one space. Its `ride` field is the id of the
movable it is sitting on, or `null` for ground - which is exactly the distinction
that decides whether a passing train destroys it or carries it.

## Space semantics

```js
standLevel(st, i)   //  null = not standable
  VOID          -> null
  mountain      -> 2
  movable here  -> 1
  SKY           -> null      (bare sky)
  otherwise     -> 0
```

`revealedSpace(st, i)` gates everything on the tile being revealed. Unrevealed
tiles are simply not enterable, by Humans or trains (spec assumption A5).

## Movement

`stepKind(from, to)` classifies one orthogonal step:

| Result | When |
|--------|------|
| `blocked` | destination unrevealed, or **one or more levels higher** (climb instead) |
| `sky` | destination not standable |
| `fall` | **two or more levels down** - knock-down |
| `ok` | same level or one down |

Pathing is **Dijkstra over standable spaces**, costed in *actions* rather than
steps, because a Move action covers two spaces:

| Transition | Cost |
|------------|-----:|
| flat, or one level down | 0.5 |
| climb one level | 1.0 |
| drop two or more | 3.0 (allowed, heavily discouraged) |
| climb two or more | blocked |

So "distance" throughout the AI means "roughly how many actions away", which is why
utilities can be compared directly against card effects.

`execMoveAction` spends one Major for up to **two** steps, emits one event per grid
step so the replay can animate cell by cell, and stops early if a step turns out to
be a fall. A climb is its own action and cannot be combined with a walk step in the
same Major.

Humans do **not** block movement - they share spaces - which is what lets the card
code reuse one distance field for hypothetical landings.

## Trains

`straightRunStops(train, dx, dy)` is a dry run: from the train's cell, step
repeatedly in one of the **eight** directions and list every legal stop, up to 12.
It stops at a non-rail cell, an unrevealed cell, a mountain, another train, or a
box whose own next space is blocked. A box being pushed is tracked as `boxAhead`
so a two-box chain is correctly refused.

`execTrainRun` then walks the train there for real, and this is where the map's
violence lives:

- a **box in the way** is pushed two cells ahead; its riders ride along; anyone
  standing where it lands is squished (knock-down + checkpoint); a ground pile
  there becomes a riding pile;
- a **Human on the ground** in the path is killed - knocked down and sent to the
  checkpoint;
- a **ground pile** in the path is destroyed outright;
- **riders on the train** (Humans and `ride`-tagged piles) move with it.

Multi-run planning is a BFS over a "runs graph": nodes are rail cells, one edge is
one straight run. `trainRunPlan` returns the first run of a shortest plan, so the
AI can commit to a corner-turning route one action at a time.

## Dragging platforms

`bestDragOption` implements the spec's platform-drag rules as a **bridging tool**:
when a valuable pile sits on a mountain the Human cannot reach, drag a box or train
to a space orthogonally adjacent to that mountain and climb from it.

The plan is three-phase and re-derived each time round the action loop: walk to a
cell adjacent to the platform, spend a Minor to Grab, then spend Majors to drag
(the Human and platform translate together, up to two steps per Major).
`findDragStep` only accepts a step where the Human's move is legal - or is into the
space the platform just vacated - and the platform's destination is revealed, not a
mountain, not occupied. Sky is allowed, per the rules.

The AI will not grab something it cannot then drag (`if (!findDragStep(...)) return null`),
which is what stops it burning Minors on a stuck box.

## Reveal and end

```js
revealTile(t):  push t, move the Checkpoint marker to that tile's checkpoint,
                drop 3 and 4 small coins, drop large A and B, largeLeft += 2

afterLargeCollected():
  if largeLeft <= 1 and tiles remain  -> reveal the next tile
  if largeLeft === 0 and all revealed -> st.ended = true      // ends mid-turn
```

That first condition is the game's clock, and it is why `pileValue` weights large
coins by an extra 1.5x - collecting one is not just VP, it advances the map.

## A turn

```
turnStart
  clear whine if it was mine; expire my hug; stand up if knocked down
  chooseInitiative -> play one card to the centre (names the next player)
  takeActions(...)                       <- the AI loop below
  release anything grabbed
  next player = the played card's owner, else clockwise to someone with cards
```

`takeActions` is a **greedy option loop**, not a search. Each iteration builds every
legal option with a utility, sorts, and runs the best - then rebuilds from scratch,
because the world moved:

| Option | Gate |
|--------|------|
| Claim the pile here | a Minor, and a pile with something in it |
| Move toward the best pile | a Major |
| Move toward a control panel | a Major, and a train op worth > 1.2 |
| Catch Up | a Major, full tokens, and the checkpoint route saves > 3.5 actions |
| Activate the played card | a Major, not used yet, and the card returns an option |
| Shove a rich Human sharing my space | a Minor + a Major, `aggro > 0.5` |
| Interact - one train run | a Minor, standing on a panel |
| Grab / drag a platform | as above |

The loop stops when there are no options, when the best scores **below 0.35**, or
after a `guard` of 40 iterations. Claim is multiplied by 3, which makes "pick up
what you are standing on" essentially always the first move - correct, and it keeps
the AI from wandering off a pile.

## Hands and rounds

Decks are shuffled once per game and **never reshuffled**. `dealHands` implements
the per-player-count table from [[Game-Rules]], with the 3- and 5-player left/right
alternation keyed on `roundNo % 2`. When every deck is empty the game continues
clockwise with no initiative cards (`cardsExhausted`), and the report tracks how
often that happened - a high number means the map takes longer than the deck can
cover.

In 2-player games seat 2 is a **neutral third Human**: it plays no card of its own,
its controller alternates after each of its turns, and its claims are credited to
whoever controls it (`claim(st, actor, beneficiary)` with
`beneficiary = st.humans[h.controllerOf]`). It is excluded from `finalScores`.

## Scoring

At the end, every hidden face is flipped:

```js
for (const l of h.large) {
  const v = rnd() < 0.5 ? def.lo : def.hi;
  if (def.mult === 'small')  smallMult  = v;
  else if (def.mult === 'friend') friendMult = v;
  else largeVP += v;
}
for (each friendship token) friendVP += rnd() < 0.5 ? 1 : 3;
total = small * smallMult + largeVP + friendVP * friendMult;
```

Note the multipliers are **assignment, not accumulation** - holding both tile-4
multiplier coins is not possible, but the code would keep only the last if it were.

## Safety rails

Two hard limits keep a bad map from hanging the browser: **300 turns** per game and
**40 option evaluations** per turn. A map that hits the turn cap will show up as a
suspiciously uniform `turns.max` in the report - worth investigating rather than
accepting.

## Related

[[Board-Extraction]] | [[AI-Personas]] | [[Game-Rules]] | [[Cards]] |
[[Analysis-and-Replay]]
