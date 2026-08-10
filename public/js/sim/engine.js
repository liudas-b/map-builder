// Map Tester — rules engine, AI personas and simulation runner.
// Deterministic per seed: simulate(model, cfg, seed) replays identically,
// so the stats pass stores only summaries and replays re-simulate with logging.
import { CARDS, LARGE_DEFS, GROUND } from './model.js';

// ---------------------------------------------------------------- rng
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
function shuffled(rnd, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- geometry
function neighbors4(model, i) {
  const { W, H } = model, x = i % W, y = (i / W) | 0, out = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
}
function neighbors8(model, i) {
  const { W, H } = model, x = i % W, y = (i / W) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) out.push(ny * W + nx);
    }
  }
  return out;
}
const manhattan = (model, a, b) =>
  Math.abs(a % model.W - b % model.W) + Math.abs(((a / model.W) | 0) - ((b / model.W) | 0));

// ---------------------------------------------------------------- state
function movableAt(st, i) { return st.movables.find(m => m.at === i); }

// standing level of the surface at a space: null = not standable (void / bare sky)
function standLevel(st, i) {
  if (st.model.spaces[i] === GROUND.VOID) return null;
  if (st.model.mountains.has(i)) return 2;
  if (movableAt(st, i)) return 1;
  return st.model.spaces[i] === GROUND.SKY ? null : 0;
}
function revealedSpace(st, i) {
  const t = st.model.tileOf[i];
  return t >= 1 && st.revealedTiles.includes(t);
}

function pileAt(st, i) { return st.piles.find(p => p.at === i); }
function ensurePile(st, i) {
  let p = pileAt(st, i);
  if (!p) { p = { at: i, small: 0, large: [], friend: 0, ride: null }; st.piles.push(p); }
  return p;
}
function dropPile(st, i, { small = 0, large = null, friend = 0 }) {
  if (!small && !large && !friend) return;
  const p = ensurePile(st, i);
  p.small += small; p.friend += friend;
  if (large) p.large.push(...large);
  const m = movableAt(st, i);
  p.ride = m ? m.id : null;
}

// ---------------------------------------------------------------- events
function emit(st, ev) {
  if (!st.log) return;
  ev.turn = st.turnNo;
  ev.snap = {
    humans: st.humans.map(h => ({ at: h.at, knocked: h.knocked, small: h.small, friend: h.friend, large: h.large.length })),
    movables: st.movables.map(m => m.at),
    piles: st.piles.filter(p => p.small || p.friend || p.large.length)
      .map(p => ({ at: p.at, small: p.small, friend: p.friend, large: p.large.length })),
    checkpointAt: st.checkpointAt,
    revealed: [...st.revealedTiles],
    cur: st.cur,
    spend: { minor: [...st.turnSpend.minor], major: [...st.turnSpend.major] },
  };
  st.events.push(ev);
}

// action-token bookkeeping shown on the player aid during replay
function useMinor(st, h, label) { h.minors--; st.turnSpend.minor.push(label); }
function useMajor(st, h, label) { h.majors--; st.turnSpend.major.push(label); }

// ---------------------------------------------------------------- reveal / end
function revealTile(st, t) {
  st.revealedTiles.push(t);
  st.checkpointAt = st.model.checkpoints[t] ?? st.checkpointAt;
  const spots = st.model.spots[t] || {};
  if (spots.coin3 != null) dropPile(st, spots.coin3, { small: 3 });
  if (spots.coin4 != null) dropPile(st, spots.coin4, { small: 4 });
  const defs = LARGE_DEFS[t] || [];
  if (spots.largeA != null && defs[0]) { dropPile(st, spots.largeA, { large: [{ tile: t, i: 0 }] }); st.largeLeft++; }
  if (spots.largeB != null && defs[1]) { dropPile(st, spots.largeB, { large: [{ tile: t, i: 1 }] }); st.largeLeft++; }
  st.stats.reveals.push({ tile: t, turn: st.turnNo });
  emit(st, { t: 'reveal', tile: t });
}
function afterLargeCollected(st) {
  if (st.largeLeft <= 1 && st.revealedTiles.length < st.model.tiles.length) {
    revealTile(st, st.model.tiles[st.revealedTiles.length]);
  }
  if (st.largeLeft === 0 && st.revealedTiles.length >= st.model.tiles.length) {
    st.ended = true;
  }
}

// ---------------------------------------------------------------- knockdown
function knockDown(st, h, { toCheckpoint = false } = {}) {
  const drop = Math.min(2, h.small);
  h.small -= drop;
  if (drop) dropPile(st, h.at, { small: drop });
  h.knocked = true;
  for (const o of st.humans) if (o.hug && o.hug.target === h.s) o.hug = null;
  h.hug = null;
  if (toCheckpoint) h.at = st.checkpointAt;
  st.stats.knockdowns++;
  emit(st, { t: 'knock', p: h.s, drop, toCheckpoint });
}

// ---------------------------------------------------------------- claim
function claim(st, actor, beneficiary) {
  const p = pileAt(st, actor.at);
  if (!p || (!p.small && !p.friend && !p.large.length)) return false;
  const got = { small: p.small, friend: p.friend, large: p.large.length };
  beneficiary.small += p.small;
  beneficiary.friend += p.friend;
  beneficiary.large.push(...p.large);
  const nLarge = p.large.length;
  p.small = 0; p.friend = 0; p.large = [];
  st.piles = st.piles.filter(x => x !== p);
  st.stats.claims++;
  emit(st, { t: 'claim', p: actor.s, benef: beneficiary.s, at: actor.at, got });
  if (nLarge) {
    st.largeLeft -= nLarge;
    st.stats.largeOrder.push({ turn: st.turnNo, by: beneficiary.s, at: actor.at });
    afterLargeCollected(st);
  }
  return true;
}

// ---------------------------------------------------------------- movement
// One orthogonal step. Returns 'ok' | 'blocked' | 'fall' (=knockdown) | 'sky'
function stepKind(st, from, to) {
  if (!revealedSpace(st, to)) return 'blocked';
  const cur = standLevel(st, from) ?? 0;
  const lvl = standLevel(st, to);
  if (lvl === null) return 'sky';
  const d = lvl - cur;
  if (d > 0) return 'blocked';
  if (d <= -2) return 'fall';
  return 'ok';
}
function moveHumanTo(st, h, to) {
  h.at = to;
  st.visits[to]++;
  for (const o of st.humans) {
    if (o.hug && o.hug.target === h.s) { o.at = to; st.visits[to]++; }
  }
}

// Dijkstra over standable spaces. Cost: step 0.5 (2 per action), climb 1.
function distanceField(st, from) {
  const S = st.model.S;
  const dist = new Float32Array(S).fill(Infinity);
  const prev = new Int16Array(S).fill(-1);
  dist[from] = 0;
  const q = [[0, from]];
  while (q.length) {
    q.sort((a, b) => a[0] - b[0]);
    const [d, i] = q.shift();
    if (d > dist[i]) continue;
    const lvl = standLevel(st, i);
    for (const n of neighbors4(st.model, i)) {
      if (!revealedSpace(st, n)) continue;
      const nl = standLevel(st, n);
      if (nl === null) continue;
      const delta = nl - lvl;
      let c;
      if (delta <= 0 && delta >= -1) c = 0.5;
      else if (delta === 1) c = 1;          // climb
      else if (delta <= -2) c = 3;          // knockdown drop — heavily discouraged
      else continue;                        // +2 blocked
      if (d + c < dist[n]) { dist[n] = d + c; prev[n] = i; q.push([d + c, n]); }
    }
  }
  return { dist, prev };
}
function pathTo(prev, from, to) {
  const path = [];
  for (let i = to; i !== -1 && i !== from; i = prev[i]) path.push(i);
  path.reverse();
  return path;
}

// ---------------------------------------------------------------- trains
// One Interact moves a train in a STRAIGHT line (any of 8 directions) along
// the rails. Turning requires stopping — a new action. The train cannot pass
// mountains or other trains; it pushes boxes ahead of it while the box's next
// space is free; humans on the ground in its path are killed (knock-down +
// respawn at checkpoint); ground coin piles in its path are destroyed.
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function cellAt(model, x, y) {
  return (x >= 0 && x < model.W && y >= 0 && y < model.H) ? y * model.W + x : -1;
}

// dry-run: list of stop cells a straight run in (dx,dy) can end at,
// starting from `from` (defaults to the train's current cell)
function straightRunStops(st, train, dx, dy, maxSteps = 12, from = null) {
  const { model } = st;
  const stops = [];
  const start = from ?? train.at;
  let x = start % model.W, y = (start / model.W) | 0;
  let boxAhead = null;   // virtual position of a box being pushed
  for (let k = 0; k < maxSteps; k++) {
    x += dx; y += dy;
    const i = cellAt(model, x, y);
    if (i < 0 || !model.rails.has(i) || !revealedSpace(st, i)) break;
    if (model.mountains.has(i)) break;
    const m = movableAt(st, i);
    const boxHere = boxAhead === i || (m && m !== train);
    if (boxHere) {
      if (m && m.kind === 'train' && m !== train) break;   // trains block trains
      const j = cellAt(model, x + dx, y + dy);
      if (j < 0 || model.spaces[j] === GROUND.VOID || model.mountains.has(j)) break;
      const mj = movableAt(st, j);
      if ((mj && mj !== train) || boxAhead === j) break;   // push blocked
      if (!revealedSpace(st, j)) break;
      boxAhead = j;
    }
    stops.push(i);
  }
  return stops;
}

// execute a straight run to `stop` (must come from straightRunStops)
function execTrainRun(st, train, dx, dy, stop) {
  const { model } = st;
  const riders = st.humans.filter(h => h.at === train.at && !model.mountains.has(train.at));
  while (train.at !== stop) {
    const x = train.at % model.W, y = (train.at / model.W) | 0;
    const i = cellAt(model, x + dx, y + dy);
    if (i < 0) break;
    // push a box ahead
    const m = movableAt(st, i);
    if (m && m !== train) {
      const j = cellAt(model, x + 2 * dx, y + 2 * dy);
      m.at = j;
      for (const p of st.piles) if (p.ride === m.id) p.at = j;
      for (const o of st.humans) {                    // riders of the box ride on
        if (o.at === i && !riders.includes(o)) moveHumanTo(st, o, j);
      }
      for (const o of st.humans) {                    // squish at landing spot
        if (o.at === j && standLevel(st, j) === 0) knockDown(st, o, { toCheckpoint: true });
      }
      const jp = pileAt(st, j);
      if (jp && jp.ride == null) jp.ride = m.id;      // ground coins now ride the box
    }
    // humans on the ground in the path are killed
    for (const o of st.humans) {
      if (o.at === i && !riders.includes(o) && standLevel(st, i) === 0) {
        knockDown(st, o, { toCheckpoint: true });
      }
    }
    // ground coins in the path are destroyed
    const gp = pileAt(st, i);
    if (gp && gp.ride == null) st.piles = st.piles.filter(p => p !== gp);
    train.at = i;
    for (const r of riders) moveHumanTo(st, r, i);
    for (const p of st.piles) if (p.ride === train.id) p.at = i;
    emit(st, { t: 'train', id: train.id, to: i, riders: riders.map(r => r.s) });
  }
}

// ---------------------------------------------------------------- personas
const PERSONAS = {
  racer:    { coins: 1.3, friend: 0.6, aggro: 0.0, give: 0 },
  bully:    { coins: 1.0, friend: 0.4, aggro: 2.2, give: 0 },
  diplomat: { coins: 0.9, friend: 2.2, aggro: 0.1, give: 1 },
};
const FRIEND_EV = 2;    // (1+3)/2
const largeEV = d => d.mult ? 4.5 : (d.lo + d.hi) / 2;
function pileValue(p) {
  // large coins carry extra urgency: collecting them is the game clock
  return p.small + p.friend * FRIEND_EV + p.large.reduce((s, l) => s + largeEV(LARGE_DEFS[l.tile][l.i]) * 1.5, 0);
}
function vpEstimate(h) {
  return h.small + h.friend * FRIEND_EV + h.large.length * 6;
}

// best pile target by value/distance
function bestTarget(st, h, dist) {
  let best = null, bestU = 0;
  for (const p of st.piles) {
    if (!p.small && !p.friend && !p.large.length) continue;
    const d = dist[p.at];
    if (!isFinite(d)) continue;
    const u = pileValue(p) / (1 + d);
    if (u > bestU) { bestU = u; best = { pile: p, d, u }; }
  }
  return best;
}

// ---------------------------------------------------------------- cards
// Returns {utility, apply} or null. Utilities are pre-persona-weight.
function cardOption(st, h, card, w) {
  const df = distanceField(st, h.at);
  const tgt = bestTarget(st, h, df.dist);

  // how much closer a landing gets us to the best target (in actions);
  // humans don't block movement, so the real state's field is valid
  const gain = (landing) => {
    if (!tgt || landing == null) return 0;
    const d2 = distanceField(st, landing).dist[tgt.pile.at];
    return isFinite(d2) ? Math.max(0, tgt.d - d2) : 0;
  };

  switch (card) {
    case 'Jump': {
      // landings within 2 orth steps ignoring intermediates, height <= current
      const lvl = standLevel(st, h.at) ?? 0;
      let best = null, bestG = 0.4;
      const cand = new Set(neighbors4(st.model, h.at));
      for (const n of neighbors4(st.model, h.at)) for (const n2 of neighbors4(st.model, n)) cand.add(n2);
      for (const c of cand) {
        if (c === h.at || !revealedSpace(st, c)) continue;
        const l = standLevel(st, c);
        if (l === null || l > lvl) continue;
        const g = gain(c);
        if (g > bestG) { bestG = g; best = c; }
      }
      return best == null ? null : {
        utility: bestG * w.coins,
        apply() { moveHumanTo(st, h, best); emit(st, { t: 'cardfx', p: h.s, card, to: best }); },
      };
    }
    case 'Parkour': {
      const lvl = standLevel(st, h.at) ?? 0;
      const { W } = st.model;
      let best = null, bestG = 0.4;
      for (const n of neighbors8(st.model, h.at)) {
        if (neighbors4(st.model, h.at).includes(n)) continue; // diagonal only
        if (!revealedSpace(st, n)) continue;
        const l = standLevel(st, n);
        if (l === null || l - lvl > 1) continue;
        const g = gain(n) + (l - lvl === 1 ? 0.5 : 0);
        if (g > bestG) { bestG = g; best = n; }
      }
      return best == null ? null : {
        utility: bestG * w.coins,
        apply() { moveHumanTo(st, h, best); emit(st, { t: 'cardfx', p: h.s, card, to: best }); },
      };
    }
    case 'Trick': {
      let best = null, bestG = 0.6;
      for (const o of st.humans) {
        if (o === h || manhattan(st.model, h.at, o.at) > 2) continue;
        const g = gain(o.at);
        if (g > bestG) { bestG = g; best = o; }
      }
      return best == null ? null : {
        utility: bestG * w.coins,
        apply() {
          const a = h.at; moveHumanTo(st, h, best.at); moveHumanTo(st, best, a);
          emit(st, { t: 'cardfx', p: h.s, card, with: best.s });
        },
      };
    }
    case 'Mislead': {
      // teleport self to the checkpoint (swap self with the marker)
      const g = gain(st.checkpointAt);
      if (g < 1) return null;
      return {
        utility: g * w.coins * 0.9,
        apply() {
          const a = h.at; moveHumanTo(st, h, st.checkpointAt); st.checkpointAt = a;
          emit(st, { t: 'cardfx', p: h.s, card });
        },
      };
    }
    case 'Motivate': {
      if (h.friend <= 0) return null;
      return {
        utility: 1.2 + w.give * 1.2,
        apply() {
          h.friend--; dropPile(st, h.at, { friend: 1 });
          h.minors = Math.min(3, h.minors + 2);
          h.majors = Math.min(3, h.majors + 2);
          emit(st, { t: 'cardfx', p: h.s, card });
        },
      };
    }
    case 'Hug': {
      const o = st.humans.find(o => o !== h && o.at === h.at && o.friend > 0);
      if (!o) return null;
      return {
        utility: FRIEND_EV * (w.friend + 0.2),
        apply() {
          o.friend--; h.friend++;
          h.hug = { target: o.s };
          emit(st, { t: 'cardfx', p: h.s, card, with: o.s });
        },
      };
    }
    case 'Pickpocket': {
      const o = st.humans.find(o => o !== h && o.at === h.at && o.small >= 2);
      if (!o) return null;
      const take = Math.floor(o.small / 2);
      return {
        utility: take * (0.8 + w.aggro),
        apply() {
          o.small -= take; h.small += take;
          emit(st, { t: 'cardfx', p: h.s, card, with: o.s, take });
        },
      };
    }
    case 'Command': {
      if (w.aggro < 0.5) return null;
      // push the richest other human 2 steps away from its best pile
      let best = null, bestV = 2;
      for (const o of st.humans) {
        if (o === h) continue;
        const v = vpEstimate(o);
        if (v > bestV) { bestV = v; best = o; }
      }
      if (!best) return null;
      return {
        utility: 1.2 * w.aggro,
        apply() {
          const dfO = distanceField(st, best.at);
          const tgtO = bestTarget(st, best, dfO.dist);
          let worst = best.at, worstD = tgtO ? -Infinity : 0;
          for (const n of neighbors4(st.model, best.at)) {
            if (stepKind(st, best.at, n) !== 'ok') continue;
            const d = tgtO ? manhattan(st.model, n, tgtO.pile.at) : 0;
            if (d > worstD) { worstD = d; worst = n; }
          }
          moveHumanTo(st, best, worst);
          emit(st, { t: 'cardfx', p: h.s, card, with: best.s });
        },
      };
    }
    case 'Hack': {
      const op = bestTrainOp(st, h);
      if (!op || op.utility < 1) return null;
      return {
        utility: op.utility,
        apply() {
          execTrainRun(st, op.train, op.dx, op.dy, op.stop);
          // second activation — may turn and continue
          const op2 = bestTrainOp(st, h);
          if (op2 && op2.utility >= 1) execTrainRun(st, op2.train, op2.dx, op2.dy, op2.stop);
          emit(st, { t: 'cardfx', p: h.s, card: 'Hack' });
        },
      };
    }
    case 'Trample': {
      const opts = trampleOptions(st, h);
      let best = null, bestU = 1;
      for (const o of opts) {
        const u = o.victims * (1 + w.aggro * 2) + gain(o.stop) * w.coins;
        if (u > bestU) { bestU = u; best = o; }
      }
      return best == null ? null : {
        utility: bestU,
        apply() { applyTrample(st, h, best); },
      };
    }
    case 'Group Up': {
      if (w.give < 0.5) return null;
      return {
        utility: 0.8,
        apply() {
          for (const o of st.humans) {
            if (o === h || o.knocked) continue;
            const dfO = distanceField(st, o.at);
            const tgtO = bestTarget(st, o, dfO.dist);
            const dNow = tgtO ? tgtO.d : 0;
            const dfH = distanceField(st, h.at);
            const tgtH = tgtO ? dfH.dist[tgtO.pile.at] : Infinity;
            if (tgtO && isFinite(tgtH) && tgtH < dNow) moveHumanTo(st, o, h.at);
          }
          emit(st, { t: 'cardfx', p: h.s, card });
        },
      };
    }
    case 'Confuse': {
      const withCards = st.humans.filter(o => !o.third && st.hands[o.s]?.length);
      if (withCards.length < 2) return null;
      return {
        utility: 0.4 + w.aggro * 0.4,
        apply() {
          const [a, b] = shuffled(st.rnd, withCards);
          const ha = st.hands[a.s], hb = st.hands[b.s];
          if (ha.length && hb.length) {
            const i = Math.floor(st.rnd() * ha.length), j = Math.floor(st.rnd() * hb.length);
            [ha[i], hb[j]] = [hb[j], ha[i]];
          }
          emit(st, { t: 'cardfx', p: h.s, card });
        },
      };
    }
    case 'Whine': {
      return {
        utility: 0.3 + w.aggro * 0.5,
        apply() { st.whineBy = h.s; emit(st, { t: 'cardfx', p: h.s, card }); },
      };
    }
  }
  return null;
}

// BFS over the "runs graph": nodes are rail cells, one edge = one straight run.
// Returns the first run of a shortest multi-run plan to targetCell, or null.
function trainRunPlan(st, train, targetCell) {
  const prev = new Map([[train.at, null]]);
  const q = [train.at];
  while (q.length) {
    const c = q.shift();
    if (c === targetCell) {
      let runs = 0, first = c;
      for (let n = c; prev.get(n) !== null; n = prev.get(n)) { first = n; runs++; }
      return { firstStop: first, runs };
    }
    for (const [dx, dy] of DIRS8) {
      for (const stop of straightRunStops(st, train, dx, dy, 12, c)) {
        if (!prev.has(stop)) { prev.set(stop, c); q.push(stop); }
      }
    }
  }
  return null;
}

function bestTrainOp(st, h) {
  const dfH = distanceField(st, h.at);
  const bridgeTargets = [];
  let unreachableValue = 0;
  for (const p of st.piles) {
    if (!p.small && !p.friend && !p.large.length) continue;
    if (isFinite(dfH.dist[p.at])) continue;
    unreachableValue = Math.max(unreachableValue, pileValue(p));
    // mountain piles: park next to them so they become climbable
    if (st.model.mountains.has(p.at)) {
      for (const r of neighbors4(st.model, p.at)) {
        if (st.model.rails.has(r)) bridgeTargets.push({ cell: r, value: pileValue(p) });
      }
    }
  }
  // sky rails next to the actor's reachable area: a parked train is a foot
  // bridge across the gap (trains leaving can strand pedestrians on this map)
  if (unreachableValue > 0) {
    const cand = [];
    for (const r of st.model.rails) {
      if (!revealedSpace(st, r) || standLevel(st, r) !== null) continue;   // bare sky only
      if (neighbors4(st.model, r).some(n => isFinite(dfH.dist[n]))) {
        cand.push({ cell: r, value: unreachableValue * 0.5, d: manhattan(st.model, r, h.at) });
      }
    }
    cand.sort((a, b) => a.d - b.d);
    bridgeTargets.push(...cand.slice(0, 4));
  }
  let best = null;
  const dirTo = (from, to) => {
    const fx = from % st.model.W, fy = (from / st.model.W) | 0;
    const tx = to % st.model.W, ty = (to / st.model.W) | 0;
    return [Math.sign(tx - fx), Math.sign(ty - fy)];
  };

  // how good is the actor's world: best value/dist of reachable piles, and
  // how close the walkable region gets to each unreachable pile
  const reachMetrics = (df) => {
    let bestV = 0, gap = 0;
    for (const p of st.piles) {
      if (!p.small && !p.friend && !p.large.length) continue;
      const d = df.dist[p.at];
      if (isFinite(d)) { bestV = Math.max(bestV, pileValue(p) / (1 + d)); continue; }
      let dmin = 20;
      for (let i = 0; i < st.model.S; i++) {
        if (isFinite(df.dist[i])) {
          const md = manhattan(st.model, i, p.at);
          if (md < dmin) dmin = md;
        }
      }
      gap += dmin;
    }
    return { bestV, gap };
  };
  const m0 = reachMetrics(dfH);

  // bridging: only worth it if the train PARKED AT THE TARGET actually
  // improves the actor's world (prevents pointless ping-pong shuttling)
  const cands = [];
  for (const train of st.movables) {
    if (train.kind !== 'train') continue;
    for (const b of bridgeTargets) {
      const plan = trainRunPlan(st, train, b.cell);
      if (!plan || plan.firstStop === train.at) continue;
      cands.push({ train, b, plan, naive: (b.value * 0.6) / (1 + (plan.runs - 1) * 0.35) });
    }
  }
  cands.sort((a, b) => b.naive - a.naive);
  for (const c of cands.slice(0, 6)) {
    const orig = c.train.at;
    c.train.at = c.b.cell;                      // virtual final position
    const m1 = reachMetrics(distanceField(st, h.at));
    c.train.at = orig;
    const better = m1.bestV > m0.bestV + 0.05 || (m1.bestV >= m0.bestV - 0.01 && m1.gap < m0.gap - 0.5);
    if (!better) continue;
    if (!best || c.naive > best.utility) {
      const [dx, dy] = dirTo(c.train.at, c.plan.firstStop);
      best = { train: c.train, dx, dy, stop: c.plan.firstStop, utility: c.naive };
    }
  }

  // ferrying: bring a riding pile toward the actor (single-run greedy)
  for (const train of st.movables) {
    if (train.kind !== 'train') continue;
    const pile = st.piles.find(p => p.ride === train.id && (p.small || p.friend || p.large.length));
    if (!pile) continue;
    for (const [dx, dy] of DIRS8) {
      for (const stop of straightRunStops(st, train, dx, dy)) {
        const gain = manhattan(st.model, train.at, h.at) - manhattan(st.model, stop, h.at);
        const u = pileValue(pile) * Math.max(0, gain) * 0.25;
        if (u > 0 && (!best || u > best.utility)) best = { train, dx, dy, stop, utility: u };
      }
    }
  }
  return best;
}

function trampleOptions(st, h) {
  const { W } = st.model;
  const out = [];
  const lvl = standLevel(st, h.at) ?? 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let x = h.at % W, y = (h.at / W) | 0;
    let victims = 0, displaced = [], stop = h.at, path = [];
    for (; ;) {
      x += dx; y += dy;
      if (x < 0 || x >= W || y < 0 || y >= st.model.H) break;
      const i = y * W + x;
      if (!revealedSpace(st, i)) break;
      if (st.model.mountains.has(i)) break;
      const g = st.model.spaces[i];
      const m = movableAt(st, i);
      if (g === GROUND.SKY && !m) break;      // would fall into sky
      if (m) {
        // displace platform to any adjacent free spot (sky allowed)
        const spot = neighbors4(st.model, i).find(n =>
          revealedSpace(st, n) && !st.model.mountains.has(n) && !movableAt(st, n) &&
          st.model.spaces[n] !== GROUND.VOID && n !== i);
        if (spot == null) break;
        displaced.push([m.id, spot]);
      }
      victims += st.humans.filter(o => o !== h && o.at === i && !o.knocked).length;
      path.push(i);
      stop = i;
    }
    if (path.length) out.push({ dir: [dx, dy], stop, victims, displaced, path });
  }
  return out;
}
function applyTrample(st, h, opt) {
  for (const [id, spot] of opt.displaced) {
    const m = st.movables.find(m => m.id === id);
    // humans standing where the platform lands get squished
    for (const o of st.humans) {
      if (o.at === spot && standLevel(st, spot) === 0 && o !== h) {
        knockDown(st, o, { toCheckpoint: true });
      }
    }
    m.at = spot;
    for (const p of st.piles) if (p.ride === m.id) p.at = spot;
  }
  for (const i of opt.path) {
    for (const o of st.humans) {
      if (o !== h && o.at === i && !o.knocked) knockDown(st, o);
    }
  }
  moveHumanTo(st, h, opt.stop);
  emit(st, { t: 'cardfx', p: h.s, card: 'Trample', to: opt.stop, victims: opt.victims });
}

// ---------------------------------------------------------------- dragging
const orthAdjacent = (model, a, b) => {
  const ax = a % model.W, ay = (a / model.W) | 0;
  const bx = b % model.W, by = (b / model.W) | 0;
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
};

// one valid drag step (h and grabbed platform m translate together) toward dest
function findDragStep(st, h, m, dest) {
  const { model } = st;
  const hx = h.at % model.W, hy = (h.at / model.W) | 0;
  const mx = m.at % model.W, my = (m.at / model.W) | 0;
  let best = null, bestD = manhattan(model, m.at, dest);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nh = cellAt(model, hx + dx, hy + dy);
    const nm = cellAt(model, mx + dx, my + dy);
    if (nh < 0 || nm < 0 || nm === h.at) continue;
    // human step: normal walk, or into the platform's vacated space
    if (nh === m.at) {
      if (model.spaces[nh] !== GROUND.GRASS || model.mountains.has(nh)) continue;
    } else if (stepKind(st, h.at, nh) !== 'ok') continue;
    // platform step: free, revealed space (sky allowed), no mountain/other movable
    if (!revealedSpace(st, nm) || model.spaces[nm] === GROUND.VOID || model.mountains.has(nm)) continue;
    const occ = movableAt(st, nm);
    if (occ && occ !== m) continue;
    const d = manhattan(model, nm, dest);
    if (d < bestD) { bestD = d; best = { nh, nm }; }
  }
  return best;
}

function execDragStep(st, h, m, step) {
  m.at = step.nm;
  for (const p of st.piles) if (p.ride === m.id) p.at = step.nm;
  const gp = pileAt(st, step.nm);
  if (gp && gp.ride == null) gp.ride = m.id;
  for (const o of st.humans) {           // squish at the platform's new space
    if (o !== h && o.at === step.nm && standLevel(st, step.nm) === 0) {
      knockDown(st, o, { toCheckpoint: true });
    }
  }
  moveHumanTo(st, h, step.nh);
  emit(st, { t: 'move', p: h.s, to: h.at, drag: m.id });
}

// AI plan: drag a box/train next to a mountain pile unreachable on foot
function bestDragOption(st, h, w) {
  const { model } = st;
  const df = distanceField(st, h.at);
  const goals = [];
  for (const p of st.piles) {
    if (!p.small && !p.friend && !p.large.length) continue;
    if (!model.mountains.has(p.at) || isFinite(df.dist[p.at])) continue;
    for (const d of neighbors4(model, p.at)) {
      if (!revealedSpace(st, d) || model.spaces[d] === GROUND.VOID || model.mountains.has(d)) continue;
      if (movableAt(st, d)) continue;
      goals.push({ dest: d, value: pileValue(p) });
    }
  }
  if (!goals.length) return null;

  let plan = null;
  for (const m of st.movables) {
    // approach cost: nearest walkable cell orthogonally adjacent to the platform
    let approach = h.grabbed === m.id ? 0 : Infinity;
    if (approach > 0) {
      for (const a of neighbors4(model, m.at)) {
        if (isFinite(df.dist[a])) approach = Math.min(approach, df.dist[a]);
      }
    }
    if (!isFinite(approach)) continue;
    for (const g of goals) {
      const total = approach + manhattan(model, m.at, g.dest) * 0.5;
      const u = (g.value * 0.45 * w.coins) / (1 + total);
      if (!plan || u > plan.utility) plan = { m, dest: g.dest, utility: u, approach };
    }
  }
  if (!plan || plan.utility < 0.5) return null;
  const { m, dest } = plan;

  if (h.grabbed === m.id) {
    if (m.at === dest || h.majors <= 0) return null;
    if (!findDragStep(st, h, m, dest)) return null;
    return {
      utility: plan.utility,
      run() {
        useMajor(st, h, 'Move');
        st.stats.moves[h.s]++;
        for (let s = 0; s < 2 && m.at !== dest; s++) {
          const step = findDragStep(st, h, m, dest);
          if (!step) break;
          execDragStep(st, h, m, step);
        }
      },
    };
  }
  if (orthAdjacent(model, h.at, m.at)) {
    if (h.minors <= 0 || h.majors <= 0) return null;
    if (!findDragStep(st, h, m, dest)) return null;   // don't grab what we can't drag
    return {
      utility: plan.utility,
      run() {
        useMinor(st, h, 'Grab');
        h.grabbed = m.id;
        emit(st, { t: 'grab', p: h.s, kind: m.kind });
      },
    };
  }
  if (h.majors <= 0) return null;
  let bestA = null, bestD2 = Infinity;
  for (const a of neighbors4(model, m.at)) {
    if (isFinite(df.dist[a]) && df.dist[a] < bestD2) { bestD2 = df.dist[a]; bestA = a; }
  }
  if (bestA == null || bestD2 === 0) return null;
  return {
    utility: plan.utility,
    run() { execMoveAction(st, h, pathTo(df.prev, h.at, bestA)); },
  };
}

// ---------------------------------------------------------------- turn AI
function tryCancelWhine(st, h, utility) {
  if (st.whineBy == null || st.whineBy === h.s) return st.whineBy == null || st.whineBy === h.s;
  if (utility > 2.5 && h.friend > 0) {
    h.friend--;
    st.humans[st.whineBy].friend++;
    emit(st, { t: 'whineCancel', p: h.s, to: st.whineBy });
    st.whineBy = null;
    return true;
  }
  return false;
}

// spend one Major action following `path`: a climb, or up to 2 walk steps.
// Emits one event per grid step so the replay can animate cell by cell.
function execMoveAction(st, h, path) {
  let from = h.at, steps = 0;
  while (steps < 2 && path.length) {
    const nxt = path[0];
    const lvl = standLevel(st, from) ?? 0;
    const nl = standLevel(st, nxt);
    if (nl - lvl === 1) {                     // climb is its own action
      if (steps > 0) break;
      path.shift();
      useMajor(st, h, 'Climb');
      moveHumanTo(st, h, nxt);
      st.stats.moves[h.s]++;
      emit(st, { t: 'climb', p: h.s, to: nxt });
      return;
    }
    path.shift();
    const kind = stepKind(st, from, nxt);
    if (steps === 0) { useMajor(st, h, 'Move'); st.stats.moves[h.s]++; }
    moveHumanTo(st, h, nxt);
    from = nxt; steps++;
    emit(st, { t: 'move', p: h.s, to: h.at });
    if (kind === 'fall') {
      knockDown(st, h);
      return;
    }
  }
  if (steps === 0) h.majors = 0; // path stuck — avoid loop
}

function takeActions(st, h, playedCard) {
  const w = PERSONAS[h.persona] || PERSONAS.racer;
  h.minors = 3; h.majors = 3;
  let cardUsed = false;
  let guard = 40;

  while (guard-- > 0 && !st.ended && !h.knocked) {
    const options = [];

    // claim
    if (h.minors > 0) {
      const p = pileAt(st, h.at);
      if (p && (p.small || p.friend || p.large.length)) {
        options.push({
          utility: pileValue(p) * w.coins * 3,
          run() { useMinor(st, h, 'Claim'); claim(st, h, h.third ? st.humans[h.controllerOf] : h); },
        });
      }
    }

    // movement toward best target
    if (h.majors > 0) {
      const { dist, prev } = distanceField(st, h.at);
      const tgt = bestTarget(st, h, dist);
      if (tgt && tgt.d > 0) {
        const path = pathTo(prev, h.at, tgt.pile.at);
        options.push({
          utility: (pileValue(tgt.pile) * w.coins) / (1 + tgt.d),
          run() { execMoveAction(st, h, path); },
        });
      }

      // walk toward a control panel when a valuable train op is waiting
      if (!st.model.panels.has(h.at)) {
        const op = bestTrainOp(st, h);
        if (op && op.utility > 1.2) {
          let bestP = null, bestD = Infinity;
          for (const p of st.model.panels) {
            if (dist[p] < bestD) { bestD = dist[p]; bestP = p; }
          }
          if (bestP != null && isFinite(bestD) && bestD > 0) {
            const path = pathTo(prev, h.at, bestP);
            options.push({
              utility: op.utility / (1 + bestD),
              run() { execMoveAction(st, h, path); },
            });
          }
        }
      }

      // catch up
      if (h.majors === 3 && h.minors === 3) {
        const { dist: d2 } = distanceField(st, st.checkpointAt);
        const tgt = bestTarget(st, h, distanceField(st, h.at).dist);
        if (tgt) {
          const viaCp = d2[tgt.pile.at];
          if (isFinite(viaCp) && tgt.d - viaCp > 3.5) {
            options.push({
              utility: (tgt.d - viaCp) * 0.8 * w.coins,
              run() {
                h.majors = 0; h.minors = 0;
                st.turnSpend.major.push('Catch Up');
                moveHumanTo(st, h, st.checkpointAt);
                emit(st, { t: 'catchup', p: h.s });
              },
            });
          }
        }
      }
    }

    // card activation (played card only, once)
    if (!cardUsed && playedCard && h.majors > 0) {
      const opt = cardOption(st, h, playedCard, w);
      if (opt) {
        options.push({
          utility: opt.utility,
          run() {
            if (!tryCancelWhine(st, h, opt.utility)) { cardUsed = true; return; }
            useMajor(st, h, 'Activate'); cardUsed = true;
            emit(st, { t: 'activate', p: h.s, card: playedCard });
            opt.apply();
            st.stats.activated[playedCard] = (st.stats.activated[playedCard] || 0) + 1;
          },
        });
      }
    }

    // shove a rich human sharing our space (grab + squish)
    if (h.minors > 0 && h.majors > 0 && w.aggro > 0.5) {
      const victim = st.humans.find(o => o !== h && o.at === h.at && !o.knocked && vpEstimate(o) > 3);
      if (victim) {
        options.push({
          utility: (1.5 + Math.min(3, victim.small)) * w.aggro,
          run() {
            useMinor(st, h, 'Grab'); useMajor(st, h, 'Move');
            emit(st, { t: 'shove', p: h.s, victim: victim.s });
            knockDown(st, victim);
          },
        });
      }
    }

    // interact: one straight train run from a panel
    if (h.minors > 0 && st.model.panels.has(h.at)) {
      const op = bestTrainOp(st, h);
      if (op && op.utility > 1) {
        options.push({
          utility: op.utility,
          run() {
            useMinor(st, h, 'Interact');
            execTrainRun(st, op.train, op.dx, op.dy, op.stop);
          },
        });
      }
    }

    // drag a box/train next to an unreachable mountain pile (bridge on foot)
    const drag = bestDragOption(st, h, w);
    if (drag) options.push(drag);

    if (!options.length) break;
    options.sort((a, b) => b.utility - a.utility);
    if (options[0].utility < 0.35) break;
    options[0].run();
  }
}

// initiative choice: which card from hand to play
function chooseInitiative(st, h) {
  const hand = st.hands[h.s];
  if (!hand.length) return null;
  const w = PERSONAS[h.persona] || PERSONAS.racer;
  let best = null, bestU = -Infinity;
  for (const c of hand) {
    const opt = cardOption(st, h, c.card, w);
    const fx = opt ? Math.min(opt.utility, 6) : 0;
    // giving the next turn away: prefer the lowest-scoring owner
    const owner = st.humans[c.owner];
    const giveCost = owner ? vpEstimate(owner) * 0.15 : 0;
    const u = fx - giveCost + st.rnd() * 0.3;
    if (u > bestU) { bestU = u; best = c; }
  }
  return best;
}

// ---------------------------------------------------------------- hands
function drawFrom(st, deckSeat, n) {
  const deck = st.decks[deckSeat];
  return deck.splice(0, Math.min(n, deck.length)).map(card => ({ card, owner: deckSeat }));
}
function dealHands(st) {
  const P = st.cfg.players;
  st.roundNo++;
  for (let s = 0; s < st.hands.length; s++) st.hands[s] = [];
  if (P === 2) {
    st.hands[0] = [...drawFrom(st, 1, 3), ...drawFrom(st, 2, 2)];
    st.hands[1] = [...drawFrom(st, 0, 3), ...drawFrom(st, 2, 2)];
  } else if (P === 3) {
    const flip = st.roundNo % 2 === 1;
    for (let s = 0; s < 3; s++) {
      const left = (s + 2) % 3, right = (s + 1) % 3;
      st.hands[s] = flip
        ? [...drawFrom(st, left, 1), ...drawFrom(st, right, 2)]
        : [...drawFrom(st, left, 2), ...drawFrom(st, right, 1)];
    }
  } else if (P === 4) {
    for (let s = 0; s < 4; s++) {
      for (let o = 0; o < 4; o++) if (o !== s) st.hands[s].push(...drawFrom(st, o, 1));
    }
  } else {
    const flip = st.roundNo % 2 === 1;
    for (let s = 0; s < 5; s++) {
      for (let k = 1; k <= 3; k++) {
        const o = flip ? (s + k) % 5 : (s + 5 - k) % 5;
        st.hands[s].push(...drawFrom(st, o, 1));
      }
    }
  }
  emit(st, { t: 'deal', round: st.roundNo });
}
const handsEmpty = (st) => st.hands.every(h => !h.length);

// ---------------------------------------------------------------- scoring
function finalScores(st) {
  return st.humans.filter(h => !h.third).map(h => {
    let small = h.small, friendVP = 0, largeVP = 0, smallMult = 1, friendMult = 1;
    for (const l of h.large) {
      const def = LARGE_DEFS[l.tile][l.i];
      const v = st.rnd() < 0.5 ? def.lo : def.hi;
      if (def.mult === 'small') smallMult = v;
      else if (def.mult === 'friend') friendMult = v;
      else largeVP += v;
    }
    for (let i = 0; i < h.friend; i++) friendVP += st.rnd() < 0.5 ? 1 : 3;
    const total = small * smallMult + largeVP + friendVP * friendMult;
    return {
      seat: h.s, persona: h.persona, total,
      small, smallMult, largeVP, friendTokens: h.friend, friendVP, friendMult,
      largeCoins: h.large.length,
    };
  });
}

// ---------------------------------------------------------------- main sim
export function simulate(model, cfg, seed, log = false) {
  const rnd = mulberry32(seed);
  const P = cfg.players;
  const seats = P === 2 ? 3 : P;
  const st = {
    model, cfg, rnd, log,
    humans: [], movables: model.movables.map(m => ({ ...m })), piles: [],
    checkpointAt: model.checkpoints[model.tiles[0]],
    revealedTiles: [], largeLeft: 0,
    decks: [], hands: [], played: [], whineBy: null,
    turnNo: 0, roundNo: 0, cur: 0, ended: false, events: [],
    turnSpend: { minor: [], major: [] },
    visits: new Uint32Array(model.S),
    stats: {
      reveals: [], knockdowns: 0, claims: 0, largeOrder: [],
      moves: new Array(seats).fill(0), played: {}, activated: {},
    },
  };
  for (let s = 0; s < seats; s++) {
    st.humans.push({
      s, persona: s < P ? (cfg.personas[s] || 'racer') : 'racer',
      third: P === 2 && s === 2,
      at: st.checkpointAt, small: 0, large: [], friend: 3,
      knocked: false, hug: null, minors: 0, majors: 0, grabbed: null,
    });
    st.decks.push(shuffled(rnd, CARDS));
    st.hands.push([]);
  }
  revealTile(st, model.tiles[0]);
  for (const h of st.humans) h.at = st.checkpointAt;
  dealHands(st);

  let cur = Math.floor(rnd() * P);
  let thirdController = 0;

  let cardsExhausted = false;
  while (!st.ended && st.turnNo < 300) {
    if (handsEmpty(st) && !cardsExhausted) {
      if (st.decks.every(d => !d.length)) cardsExhausted = true; // play on without cards
      else dealHands(st);
    }
    const h = st.humans[cur];
    st.cur = cur;
    st.turnNo++;
    st.turnSpend = { minor: [], major: [] };
    emit(st, { t: 'turnStart', p: cur });

    if (st.whineBy === cur) st.whineBy = null;
    if (h.hug) h.hug = null;                       // hug expires at hugger's next turn
    if (h.knocked) { h.knocked = false; emit(st, { t: 'standup', p: cur }); }

    // initiative
    let played = null;
    if (!h.third) {
      const c = chooseInitiative(st, h);
      if (c) {
        st.hands[cur].splice(st.hands[cur].indexOf(c), 1);
        st.played.push({ card: c.card, owner: c.owner, by: cur, turn: st.turnNo });
        st.stats.played[c.card] = (st.stats.played[c.card] || 0) + 1;
        emit(st, { t: 'playCard', p: cur, card: c.card, owner: c.owner });
        played = c;
      }
    }

    // actions (third human acts for its controller)
    if (h.third) h.controllerOf = thirdController;
    takeActions(st, h, played?.card ?? null);
    h.grabbed = null;   // grabbed objects auto-release at end of turn

    if (st.ended) break;

    // next player
    let next = null;
    if (played) {
      next = played.owner;
      if (P === 2 && next === 2) thirdController = 1 - cur; // opponent controls the third
    }
    if (next == null || (!st.humans[next].third && !st.hands[next].length && !handsEmpty(st))) {
      // named player out of cards (or no card played): clockwise fallback
      let k = (cur + 1) % P;
      for (let tries = 0; tries < P; tries++, k = (k + 1) % P) {
        if (st.hands[k].length) break;
      }
      next = st.hands[k]?.length ? k : (cur + 1) % P;
    }
    cur = next;
  }

  const scores = finalScores(st);
  const max = Math.max(...scores.map(s => s.total));
  const winners = scores.filter(s => s.total === max);
  emit(st, { t: 'end', scores });

  const summary = {
    seed, cardsExhausted, turns: st.turnNo, rounds: st.roundNo,
    scores, winners: winners.map(w => w.seat), tie: winners.length > 1,
    reveals: st.stats.reveals, knockdowns: st.stats.knockdowns,
    claims: st.stats.claims, largeOrder: st.stats.largeOrder,
    moves: st.stats.moves, played: st.stats.played, activated: st.stats.activated,
    visits: st.visits,
    minutes: st.turnNo * (cfg.minPerTurn ?? 3.5),
  };
  return { summary, events: log ? st.events : null };
}

// ---------------------------------------------------------------- runner
export async function runSimulations(model, cfg, onProgress) {
  const games = [];
  const heat = new Float64Array(model.S);
  for (let g = 0; g < cfg.numGames; g++) {
    const { summary } = simulate(model, cfg, cfg.baseSeed + g, false);
    for (let i = 0; i < model.S; i++) heat[i] += summary.visits[i];
    delete summary.visits;
    games.push(summary);
    if (g % 10 === 9 || g === cfg.numGames - 1) {
      onProgress?.(g + 1, cfg.numGames);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  return aggregate(model, cfg, games, heat);
}

function aggregate(model, cfg, games, heat) {
  const n = games.length;
  const avg = (f) => games.reduce((s, g) => s + f(g), 0) / n;
  const P = cfg.players;
  const seatWins = new Array(P).fill(0);
  const personaWins = {};
  const personaGames = {};
  let ties = 0;
  for (const g of games) {
    if (g.tie) ties++;
    for (const w of g.winners) {
      seatWins[w] += 1 / g.winners.length;
      const p = cfg.personas[w];
      personaWins[p] = (personaWins[p] || 0) + 1 / g.winners.length;
    }
    for (let s = 0; s < P; s++) personaGames[cfg.personas[s]] = (personaGames[cfg.personas[s]] || 0) + 1;
  }
  const winScores = games.map(g => Math.max(...g.scores.map(s => s.total)));
  const cardPlays = {}, cardActs = {};
  for (const g of games) {
    for (const [c, k] of Object.entries(g.played)) cardPlays[c] = (cardPlays[c] || 0) + k;
    for (const [c, k] of Object.entries(g.activated)) cardActs[c] = (cardActs[c] || 0) + k;
  }
  const revealAvg = {};
  for (const g of games) {
    for (const r of g.reveals) {
      (revealAvg[r.tile] = revealAvg[r.tile] || []).push(r.turn);
    }
  }
  const breakdown = {
    small: avg(g => g.scores.reduce((s, x) => s + x.small * x.smallMult, 0) / P),
    large: avg(g => g.scores.reduce((s, x) => s + x.largeVP, 0) / P),
    friend: avg(g => g.scores.reduce((s, x) => s + x.friendVP * x.friendMult, 0) / P),
  };
  return {
    model, cfg, games,
    numGames: n,
    turns: { avg: avg(g => g.turns), min: Math.min(...games.map(g => g.turns)), max: Math.max(...games.map(g => g.turns)) },
    rounds: { avg: avg(g => g.rounds) },
    minutes: { avg: avg(g => g.minutes), min: Math.min(...games.map(g => g.minutes)), max: Math.max(...games.map(g => g.minutes)) },
    movesPerPlayer: avg(g => g.moves.reduce((a, b) => a + b, 0) / P),
    knockdowns: avg(g => g.knockdowns),
    claims: avg(g => g.claims),
    winScore: { avg: winScores.reduce((a, b) => a + b, 0) / n, min: Math.min(...winScores), max: Math.max(...winScores) },
    scoreSpread: avg(g => Math.max(...g.scores.map(s => s.total)) - Math.min(...g.scores.map(s => s.total))),
    seatWins, personaWins, personaGames, ties,
    deckOuts: games.filter(g => g.cardsExhausted).length,
    breakdown, cardPlays, cardActs,
    revealTurns: Object.fromEntries(Object.entries(revealAvg).map(([t, a]) => [t, a.reduce((x, y) => x + y, 0) / a.length])),
    heat,
  };
}
