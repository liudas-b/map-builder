# Gameplay Markers

**Status: Built.** Seven types, defined once in `MARKER_TYPES` (`state.js`).

Markers are **invisible game data stamped onto tiles**. They carry no art and are
not part of the printed map. They exist so a decorated grid can be read as a
playable board: without them, a tile is a picture; with them, the simulator knows
where the checkpoint is, where the coins go, and where a train can run.

They are the hinge between the two halves of the app.

## The seven types

| Badge | Id | Label | Colour | Unique | What it means |
|-------|----|-------|--------|:------:|---------------|
| `CP` | `checkpoint` | Checkpoint | green `#3ecf8e` | ✔ | where the Checkpoint marker goes when this tile is revealed; where Humans respawn |
| `C3` | `coin3` | Small Coins x3 | amber `#d99a0b` | ✔ | the pile of 3 small coins |
| `C4` | `coin4` | Small Coins x4 | amber `#d99a0b` | ✔ | the pile of 4 small coins |
| `LA` | `large-a` | Large Coin A (1st) | orange `#ff7043` | ✔ | the **first** large-coin platform |
| `LB` | `large-b` | Large Coin B (2nd) | orange `#ff7043` | ✔ | the **second** large-coin platform |
| `PN` | `panel` | Control Panel | blue `#4f8cff` | | a space from which Interact moves a train |
| `RL` | `rail` | Rail / Track | purple `#9b59b6` | | a train may occupy and travel through this space |

**Unique** means at most one per sub-board: stamping it elsewhere *moves* it rather
than adding a second. `panel` and `rail` are unlimited.

## Authoring them

Press **M** (or pick the 📍 Marker tool), choose a type in the left panel, and
click tiles to **toggle**. The Erase tool removes them, and the Selection panel for
a tile lists each marker on it with its own remove button.

They render as small rounded-square badges in the tile's corners, cycling through
the four corners so several on one tile stay readable, and they **lift onto the top
of a cube** if one occupies the tile - which is exactly the case for `LA`/`LB`,
since large coins sit on platforms.

In the save they are the sparsest structure in the format:

```json
"markers": { "5,1": ["rail", "panel"], "0,1": ["checkpoint"] }
```

## What the simulator does with them

`extractModel()` reads each marker into a different part of the model
([[Board-Extraction]]):

```
rail       -> model.rails       (Set of cell indices)
panel      -> model.panels      (Set)
checkpoint -> model.checkpoints[tile]
coin3 / coin4 / large-a / large-b -> model.spots[tile].{coin3,coin4,largeA,largeB}
```

and then, when that tile is revealed (`revealTile`):

- the Checkpoint marker moves to `checkpoints[tile]`;
- a pile of 3 small coins drops on `coin3`, a pile of 4 on `coin4`;
- a large coin drops on `largeA` and another on `largeB`, using **that tile's row
  of `LARGE_DEFS`** for their values, and `largeLeft` goes up by two.

`rails` decides where a train may travel; `panels` decides where Interact is legal.

## The completeness check

`extractModel` ends by verifying, **per tile**, that a checkpoint and all four coin
spots exist. Anything missing becomes a line in `model.warnings`:

```
tile 3: largeB
```

which the Map Tester raises as an error toast the moment you select the board. It
does **not** refuse to simulate - a tile short a coin spot simply produces fewer
coins, which will show up as a skewed report rather than a crash.

All four shipped sub-boards pass cleanly: each has exactly one `CP`, `C3`, `C4`,
`LA`, `LB`, one `PN`, and 11-13 `RL` spaces.

## Practical notes

- **`LA` before `LB` is a real ordering.** Tile 3's B slot is the Friendship x2/x3
  multiplier and tile 4's B slot is the Small Coin x2/x3 multiplier. Swapping the
  two badges on those tiles changes what the map is worth ([[Game-Rules]]).
- **Rails are marked per space, not drawn as a path.** The rail *art* is a
  `gameplay` overlay; the rail *data* is an `RL` marker. Painting the art without
  stamping the marker gives you a track no train can use - and stamping the marker
  without the art gives an invisible track that works. Keep them together.
- **Markers survive a grid resize** the same way paint does: out-of-range keys stay
  in the file and are range-checked at render. A tile shrunk away still carries its
  checkpoint, and growing the grid brings it back.
- **Rails must connect.** Trains move between touching rail spaces including
  diagonals, so an isolated rail pair is dead map - see the flagged (8,5)-(8,6)
  segment in [[Game-Rules]].

## Related

[[Sub-Board-Editor]] | [[Board-Extraction]] | [[Game-Rules]] |
[[Simulation-Engine]] | [[Save-Format]]
