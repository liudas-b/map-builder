# AI Personas

**Status: Built.** Three personas, four weights each, in `sim/engine.js`.

The AI is not a search. It is a **greedy utility loop** with a persona-weighted
scoring function. That was a deliberate trade: a heuristic that runs 200 games in a
couple of seconds in a browser tab, and whose choices a designer can read off the
weights, beats a stronger player nobody can reason about.

## The weights

```js
const PERSONAS = {
  racer:    { coins: 1.3, friend: 0.6, aggro: 0.0, give: 0 },
  bully:    { coins: 1.0, friend: 0.4, aggro: 2.2, give: 0 },
  diplomat: { coins: 0.9, friend: 2.2, aggro: 0.1, give: 1 },
};
```

| Weight | Scales |
|--------|--------|
| `coins` | anything that moves you toward a pile, and Claim |
| `friend` | Friendship-token gains (Hug, and the value of a token in a pile) |
| `aggro` | Pickpocket, Command, Trample victims, Confuse, Whine, the shove |
| `give` | Group Up and Motivate - the cooperative plays |

**Racer** - beelines for the biggest value per action, never fights, never gives.
**Bully** - knock-downs, steals, disruption; `aggro` at 2.2 makes Trample and the
shove dominate its option list. **Diplomat** - farms Friendship, plays Group Up and
Motivate, and is the only persona that will ever help someone else.

Two cards are gated outright rather than weighted: **Group Up** returns `null`
unless `give >= 0.5`, and **Command** returns `null` unless `aggro >= 0.5`. So a
Racer literally cannot play them for effect - it will still play them for turn
order.

## The value function

Everything is scored against one estimate of what a pile is worth:

```js
FRIEND_EV = 2                            // (1 + 3) / 2
largeEV(def) = def.mult ? 4.5 : (lo + hi) / 2

pileValue(p) = p.small
             + p.friend * FRIEND_EV
             + sum over large coins of largeEV(def) * 1.5
```

That **1.5x on large coins is not their VP** - it is urgency. Collecting a large
coin advances the reveal clock and eventually ends the game, so it is worth more
than its face value to whoever wants the game to move. Without it the AI dawdles on
small-coin piles and games run long.

`vpEstimate(h) = small + friend*2 + large*6` is the cruder version used to decide
who the leader is - for Command's target, and for the initiative discount.

## Choosing a target

```js
bestTarget: maximise  pileValue(p) / (1 + distanceInActions(p))
```

over the Dijkstra field described in [[Simulation-Engine]]. Value per action, not
nearest and not richest. Everything else - which card is worth activating, whether
a train run helps - is expressed as a change in *that* number.

## Where the AI is actually clever

Three places, and they are the parts that understand the map's core puzzle rather
than just walking to coins.

**Bridging with trains.** `bestTrainOp` first finds piles that are **unreachable on
foot** (`!isFinite(dist[p.at])`). For a pile on a mountain, every rail space
orthogonally adjacent to that mountain becomes a bridge target - park a train
there and the mountain becomes climbable. It then does something unusual: it
**virtually moves the train to the target, recomputes the reachability metrics, and
rejects the plan unless the actor's world genuinely improved**:

```js
better = m1.bestV > m0.bestV + 0.05
      || (m1.bestV >= m0.bestV - 0.01 && m1.gap < m0.gap - 0.5)
```

That check is what stops the classic failure mode of shuttling a train back and
forth forever because each individual run looks locally good.

**Sky bridging.** If anything is unreachable, bare-sky rail spaces adjacent to the
walkable region are also considered - a parked train over sky is a footbridge. The
comment in the code is worth keeping: *"trains leaving can strand pedestrians on
this map"*.

**Ferrying.** If a pile is riding a train, the AI will drive the train **toward
itself**, scored by how much closer the stop gets it.

Plus the drag plan in [[Simulation-Engine]] - grab a box or train and walk it to a
mountain when no train can reach it - which is the fallback when the rail network
does not cooperate.

## Choosing which card to play

```js
u = min(effectUtility, 6) - vpEstimate(cardOwner) * 0.15 + rnd() * 0.3
```

The middle term is the only place the AI reasons about **turn order as a resource**:
playing a card hands the next turn to its owner, so a card belonging to the leader
is discounted. The `min(..., 6)` cap stops one enormous Trample from overriding
that consideration entirely, and the small random term keeps identical positions
from producing identical games across seeds.

## Known limitations

Say these out loud before reading too much into a report:

- **One move deep.** The loop re-evaluates after every action, but it never plans a
  turn as a whole and never models what an opponent will do next.
- **No modelling of the hidden faces.** A large coin is always worth its mean; the
  AI never gambles on the high face.
- **No deals.** The rules allow turn-scoped deals; the simulator has only card
  effects and the Whine payment ([[Game-Rules]]).
- **Personas are not tuned against real play.** The weights are plausible, not
  measured. They are good for *comparing maps* - the same three personas on two
  different boards - and weaker as a claim about how humans will play.
- **`give` and `friend` overlap.** Diplomat is the only persona with either, so no
  experiment has yet separated their effects.

The right use of persona win rates is **relative**: if Bully wins 65% on one board
and 40% on another, the boards differ in how much disruption pays. Treating the
absolute number as a balance verdict reads more into the heuristic than it can
carry.

## Related

[[Simulation-Engine]] | [[Cards]] | [[Analysis-and-Replay]] | [[Game-Rules]]
