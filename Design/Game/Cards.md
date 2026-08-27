# The 13 Initiative Cards

**Status: Built.** All 13 are implemented in `cardOption()` in `sim/engine.js`.

Every player owns an identical 13-card deck. A card does two things at once: it
**hands the next turn to its owner**, and it **offers an effect you may spend a
Major action to activate, once, on the turn you played it**.

The list, and its order, is `CARDS` in `sim/model.js`. That order is not
cosmetic - it indexes the card art (`cardArt()`), so `Trick` is
`Human Fall Flat - Card list-02.png` and `Whine` is `-14.png`
([[Game-Assets]]).

## The cards

| # | Card | Rules effect | How the simulator models it |
|--:|------|--------------|------------------------------|
| 1 | **Trick** | Swap two Humans within Manhattan distance 2 (diagonal counts as 2). Height ignored. | Swaps **self** with the other Human whose position most improves the walk to the best pile. Threshold 0.6 |
| 2 | **Jump** | Move 1-2 spaces, may cross gaps. Landing must be same height or lower. No fall damage. | Candidate set = all cells within two orthogonal steps, ignoring what is between. Picks the biggest distance gain, threshold 0.4 |
| 3 | **Parkour** | Move or Climb 1 space diagonally. No fall damage. | Diagonal neighbours only, level delta <= +1. A climb gets a +0.5 bonus - the point of the card |
| 4 | **Group Up** | Choose a space with a Human. Clockwise from you, each player **may** place their Human there. | Only played by a persona with `give >= 0.5` (Diplomat). Moves each other Human onto your space **when that actually shortens their route** |
| 5 | **Motivate** | Place a Friendship Token in your space if able (anyone may Claim it). Refresh 2 Action Tokens. | Requires `friend > 0`. Drops one and refreshes 2 Minors + 2 Majors, capped at 3 |
| 6 | **Command** | Perform any one action controlling another Human; a commanded Claim benefits the **controlled** player. | **Narrowed**: pushes the richest opponent one step *away* from their best pile. Aggressive personas only (`aggro >= 0.5`) |
| 7 | **Hug** | Attach to a Human in your space until your next turn - you move whenever they move, no early release. Gain a Friendship Token from them if able. | Full attachment (`h.hug`), expires at the hugger's next turn, breaks if either is knocked down. Takes one Friendship Token |
| 8 | **Hack** | Activate a Control Panel up to 2 times, **from anywhere**. | Runs `bestTrainOp` twice, so it can turn a corner in one card. Utility must clear 1.0 |
| 9 | **Mislead** | Swap positions of the Checkpoint marker and any Human. | Swaps **self** with the marker - a teleport to the checkpoint that drags the checkpoint back to where you were. Requires a distance gain >= 1 |
| 10 | **Confuse** | Swap one card between two players' hands, unseen. | Picks two random card-holding players and swaps one random card each way |
| 11 | **Pickpocket** | Take half (rounded down) of the **Small Coins** of a Human in your space. | Exactly that. Utility scales with the take and with `aggro` |
| 12 | **Trample** | Move any number of spaces in a straight line. Entering a platform's space picks it up and re-places it anywhere free, pushing Humans and coins; a blocked push **squishes** (knock-down + checkpoint). Knock down every Human in your path. | Scans four orthogonal directions; stops at mountains, at bare sky and at unrevealed spaces. Displaced platforms go to any free orthogonal neighbour. Every Human in the path is knocked down; landing squishes are checkpointed |
| 13 | **Whine** | Until your next turn no player may activate cards. Any other player may pay you one Friendship Token to cancel the **whole** effect. | `st.whineBy`. `tryCancelWhine` pays when the blocked card is worth more than 2.5 utility and the payer has a token |

## Two things every card shares

**A distance-gain helper.** Most movement cards score themselves through the same
function:

```js
gain(landing) = max(0, distanceToBestPile(now) - distanceToBestPile(landing))
```

measured in *actions*, over the Dijkstra field described in [[Simulation-Engine]].
That is why Jump, Parkour, Trick and Mislead all have a small floor threshold - a
card that saves less than half an action is not worth a Major.

**A persona weight.** `cardOption(st, h, card, w)` receives the acting persona's
weights, so the same card is worth different amounts to different seats. Group Up
and Command are the extreme cases - they return `null` outright for the wrong
persona ([[AI-Personas]]).

## How a card is chosen

`chooseInitiative()` scores every card in hand:

```js
u = min(effectUtility, 6) - vpEstimate(cardOwner) * 0.15 + rnd() * 0.3
```

Three forces, and the middle one is the interesting one: **playing a card hands the
next turn to its owner**, so the AI discounts a card by how well its owner is
already doing. A great effect on the leader's card is worth less than a mediocre
effect on the last-place player's. The random term breaks ties so identical
positions do not always produce identical games.

## Cards in the analysis

The report tracks two separate numbers per card, because they mean different
things:

- **Played** - how often it was put down for initiative.
- **Used** - how often its effect was actually activated.

A card played often and used rarely is one the AI wants for turn-order control, not
for its effect. A card never played at all is one the AI can never find a use for -
which, on a given map, is a design signal worth reading.

The replay's card strip shows each played card's art in order, clickable to jump to
that moment ([[Analysis-and-Replay]]).

## Related

[[Game-Rules]] | [[Simulation-Engine]] | [[AI-Personas]] | [[Analysis-and-Replay]] |
[[Game-Assets]]
