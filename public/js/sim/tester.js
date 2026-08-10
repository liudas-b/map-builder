// Map Tester UI: setup panel, analysis report and the replay player.
import * as THREE from 'three';
import { state } from '../state.js';
import { api, texUrl } from '../api.js';
import { toast } from '../ui.js';
import { buildSubGroup } from '../view3d.js';
import { extractModel, CARDS, cardArt, GROUND } from './model.js';
import { simulate, runSimulations } from './engine.js';

let view = null;
const $ = (id) => document.getElementById(id);
const PLAYER_COLORS = [0xe05c5c, 0x4f8cff, 0xf2c74f, 0x53d18a, 0xb06ce0, 0x9aa2b5];
const PERSONAS = ['racer', 'bully', 'diplomat'];

let model = null;        // extracted board model
let report = null;       // last analysis
let replay = null;       // active replay {events, idx, playing, speed, meshes...}

export function initTester(v) { view = v; }

// ================================================================ mode entry
export async function enterTesterMode() {
  await fillBoardSelect();
  await loadSelectedBoard();
}

async function fillBoardSelect() {
  const sel = $('testBoardSel');
  const cur = sel.value;
  const saves = await api.listSaves('board').catch(() => []);
  sel.innerHTML = '';
  for (const s of saves) {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name;
    sel.append(o);
  }
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

async function loadSelectedBoard() {
  const id = $('testBoardSel').value;
  stopReplay();
  report = null; model = null;
  renderResults();
  if (!id) return;
  try {
    model = await extractModel(id);
    if (model.warnings.length) {
      toast('Board warnings: ' + model.warnings.join('; '), true);
    }
    renderStaticBoard(false);
    view.frame();
  } catch (e) { toast('Could not load board: ' + e.message, true); }
}

// static 3D board; movables excluded during replay (they become dynamic pieces)
function renderStaticBoard(forReplay) {
  view.content.clear();
  const wrap = new THREE.Group();
  model.boardDoc.data.subboards.forEach((sb, i) => {
    const inner = buildSubGroup(model.subDocs[i].data, null,
      { skipMovables: forReplay, skipMarkers: forReplay });
    const g = new THREE.Group();
    g.add(inner);
    g.position.set(sb.x, 0, sb.z);
    g.rotation.y = -THREE.MathUtils.degToRad(sb.rot || 0);
    g.scale.set(sb.sx || 1, ((sb.sx || 1) + (sb.sz || 1)) / 2, sb.sz || 1);
    wrap.add(g);
  });
  view.content.add(wrap);
}

// ================================================================ setup UI
export function renderSetupPanel() {
  const P = parseInt($('testPlayers').value, 10);
  const box = $('testPersonas');
  box.innerHTML = '';
  for (let s = 0; s < P; s++) {
    const sel = document.createElement('select');
    sel.id = `persona${s}`;
    for (const p of PERSONAS) {
      const o = document.createElement('option');
      o.value = p; o.textContent = p[0].toUpperCase() + p.slice(1);
      sel.append(o);
    }
    sel.value = PERSONAS[s % PERSONAS.length];
    const row = document.createElement('div');
    row.className = 'frow';
    const lab = document.createElement('label');
    lab.textContent = `Seat ${s + 1}`;
    lab.style.color = '#' + PLAYER_COLORS[s].toString(16).padStart(6, '0');
    row.append(lab, sel);
    box.append(row);
  }
}

function currentCfg() {
  const P = parseInt($('testPlayers').value, 10);
  return {
    players: P,
    personas: Array.from({ length: P }, (_, s) => $(`persona${s}`)?.value || 'racer'),
    numGames: Math.max(1, parseInt($('testGames').value, 10) || 100),
    minPerTurn: parseFloat($('testMinutes').value) || 3.5,
    baseSeed: 1000,
  };
}

export async function calculate() {
  if (!model) { toast('Pick a board first', true); return; }
  stopReplay();
  const btn = $('btnCalc');
  btn.disabled = true;
  const cfg = currentCfg();
  try {
    report = await runSimulations(model, cfg, (done, total) => {
      btn.textContent = `⏳ ${done} / ${total}…`;
    });
    renderResults();
    renderHeatmap();
    toast(`Simulated ${cfg.numGames} games ✓`);
  } catch (e) {
    console.error(e);
    toast('Simulation failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '▶ Calculate';
  }
}

// ================================================================ results
const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString();
const mins = (m) => `${Math.floor(m / 60)}h ${Math.round(m % 60).toString().padStart(2, '0')}m`;

function renderResults() {
  const box = $('testResults');
  if (!report) {
    box.innerHTML = '<p class="note">Pick a board, set up the players and press <b>▶ Calculate</b>. ' +
      'Results and the replay list appear here.</p>';
    return;
  }
  const r = report, cfg = r.cfg;
  const seatRows = r.seatWins.map((wv, s) =>
    `<tr><td style="color:#${PLAYER_COLORS[s].toString(16).padStart(6, '0')}">Seat ${s + 1}</td>` +
    `<td>${cfg.personas[s]}</td><td>${fmt(wv / r.numGames * 100, 0)}%</td></tr>`).join('');
  // wins per seat-game, so personas with more seats aren't inflated
  const personaRows = Object.entries(r.personaWins).map(([p, wv]) =>
    `<tr><td>${p}</td><td>${fmt(wv / (r.personaGames[p] || 1) * 100, 0)}% per seat</td></tr>`).join('');
  const cardRows = CARDS.map(c =>
    `<tr><td>${c}</td><td>${fmt((r.cardPlays[c] || 0) / r.numGames, 1)}</td>` +
    `<td>${fmt((r.cardActs[c] || 0) / r.numGames, 1)}</td></tr>`).join('');
  const revealRows = Object.entries(r.revealTurns)
    .map(([t, turn]) => `<tr><td>Tile ${t}</td><td>turn ${fmt(turn, 1)}</td></tr>`).join('');

  const games = r.games.slice(0, 15);
  const gameRows = games.map((g, i) => {
    const win = g.scores.find(s => s.seat === g.winners[0]);
    return `<div class="lrow" style="justify-content:space-between">
      <span class="lname">#${i + 1} · ${g.turns} turns · winner S${g.winners[0] + 1} (${win.persona}) ${win.total} VP${g.tie ? ' · tie' : ''}</span>
      <button class="tb" data-replay="${g.seed}">▶</button></div>`;
  }).join('');

  box.innerHTML = `
    <h4>${r.numGames} games · ${cfg.players} players</h4>
    <table class="rtable">
      <tr><td>Playtime</td><td><b>${mins(r.minutes.avg)}</b> (${mins(r.minutes.min)}–${mins(r.minutes.max)})</td></tr>
      <tr><td>Turns / game</td><td><b>${fmt(r.turns.avg)}</b> (${r.turns.min}–${r.turns.max})</td></tr>
      <tr><td>Turns / player</td><td>${fmt(r.turns.avg / cfg.players)}</td></tr>
      <tr><td>Rounds</td><td>${fmt(r.rounds.avg)}</td></tr>
      <tr><td>Moves / player</td><td>${fmt(r.movesPerPlayer)}</td></tr>
      <tr><td>Winning score</td><td><b>${fmt(r.winScore.avg)}</b> VP (${r.winScore.min}–${r.winScore.max})</td></tr>
      <tr><td>Score spread</td><td>${fmt(r.scoreSpread)} VP</td></tr>
      <tr><td>Knock-downs / game</td><td>${fmt(r.knockdowns)}</td></tr>
      <tr><td>Claims / game</td><td>${fmt(r.claims)}</td></tr>
      <tr><td>Ties</td><td>${fmt(r.ties / r.numGames * 100, 0)}%</td></tr>
      <tr><td>Games where cards ran out</td><td>${fmt(r.deckOuts / r.numGames * 100, 0)}%</td></tr>
    </table>
    <h4>Avg VP per player by source</h4>
    <table class="rtable">
      <tr><td>Small coins</td><td>${fmt(r.breakdown.small)}</td></tr>
      <tr><td>Large coins</td><td>${fmt(r.breakdown.large)}</td></tr>
      <tr><td>Friendship</td><td>${fmt(r.breakdown.friend)}</td></tr>
    </table>
    <h4>Win rate by seat</h4>
    <table class="rtable"><tr><th>Seat</th><th>Persona</th><th>Wins</th></tr>${seatRows}</table>
    <h4>Win rate by persona</h4>
    <table class="rtable">${personaRows}</table>
    <h4>Tile reveals (avg turn)</h4>
    <table class="rtable">${revealRows}</table>
    <h4>Cards (played / activated per game)</h4>
    <table class="rtable"><tr><th>Card</th><th>Played</th><th>Used</th></tr>${cardRows}</table>
    <h4>Replay a game</h4>
    <div class="row-list">${gameRows}</div>
    <p class="note">Heatmap of visited spaces is overlaid on the 3D board (red = busy).</p>`;

  box.querySelectorAll('[data-replay]').forEach(b =>
    b.addEventListener('click', () => startReplay(parseInt(b.dataset.replay, 10))));
}

// visit heatmap as translucent overlay quads
function renderHeatmap() {
  if (!report || !model) return;
  renderStaticBoard(false);
  const max = Math.max(...report.heat, 1);
  const geo = new THREE.PlaneGeometry(model.cell * 0.94, model.cell * 0.94);
  for (let i = 0; i < model.S; i++) {
    if (!report.heat[i] || model.spaces[i] === GROUND.VOID) continue;
    const t = report.heat[i] / max;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color().setHSL(0.66 - 0.66 * t, 0.9, 0.5),
      transparent: true, opacity: 0.28 + 0.35 * t, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    const y = model.mountains.has(i) ? 5.15 : 0.15;
    m.position.set(model.world[i * 2], y, model.world[i * 2 + 1]);
    m.renderOrder = 600;
    view.content.add(m);
  }
  view.frame();
}

// ================================================================ replay
function surfaceHeight(snap, i) {
  if (model.mountains.has(i)) return 5;
  if (snap.movables.includes(i)) return 2.5;
  return 0;
}

function startReplay(seed) {
  if (!model || !report) return;
  const cfg = report.cfg;
  const { events } = simulate(model, cfg, seed, true);
  if (!events?.length) { toast('No events for this game', true); return; }
  stopReplay();
  renderStaticBoard(true);

  const dyn = new THREE.Group();
  view.content.add(dyn);
  const seats = events[events.length - 1].snap.humans.length;

  const humans = [];
  for (let s = 0; s < seats; s++) {
    const third = cfg.players === 2 && s === 2;
    const color = third ? 0x9aa2b5 : PLAYER_COLORS[s];
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.95, 1.7, 4, 10),
      new THREE.MeshLambertMaterial({ color }));
    body.position.y = 1.8;
    g.add(body);
    dyn.add(g);
    humans.push(g);
  }
  const movs = model.movables.map(m => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 2.4, 4.6),
      new THREE.MeshLambertMaterial({ color: m.kind === 'train' ? 0xb03434 : 0x8a6b3f }));
    dyn.add(mesh);
    return mesh;
  });
  const cpMark = new THREE.Mesh(
    new THREE.TorusGeometry(2, 0.3, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0x3ecf8e }));
  cpMark.rotation.x = -Math.PI / 2;
  dyn.add(cpMark);
  const pileGroup = new THREE.Group();
  dyn.add(pileGroup);

  // dark covers over not-yet-revealed tiles
  const covers = {};
  const coverGeo = new THREE.BoxGeometry(model.cell, 8, model.cell);
  const coverMat = new THREE.MeshBasicMaterial({
    color: 0x0d0f14, transparent: true, opacity: 0.9, depthWrite: false,
  });
  for (const t of model.tiles) {
    const g = new THREE.Group();
    for (let i = 0; i < model.S; i++) {
      if (model.tileOf[i] !== t) continue;
      const q = new THREE.Mesh(coverGeo, coverMat);
      q.position.set(model.world[i * 2], 4, model.world[i * 2 + 1]);
      q.renderOrder = 900;
      g.add(q);
    }
    covers[t] = g;
    dyn.add(g);
  }

  replay = { seed, cfg, events, idx: 0, playing: false, speed: 1, acc: 0,
    dyn, humans, movs, cpMark, pileGroup, covers, anim: null, last: performance.now() };

  buildTimeline();
  buildCardStrip();
  $('replayBar').classList.remove('hidden');
  $('playerAid').classList.remove('hidden');
  applyEvent(0);
  view.frame();
  tickReplay();
}

export function stopReplay() {
  if (!replay) return;
  replay.playing = false;
  view.content.remove(replay.dyn);
  replay = null;
  $('replayBar').classList.add('hidden');
  $('playerAid').classList.add('hidden');
  $('cardPreview').classList.add('hidden');
  if (model) { renderStaticBoard(false); if (report) renderHeatmap(); }
}

function applyEvent(i, animate = false) {
  const rp = replay;
  rp.idx = Math.max(0, Math.min(i, rp.events.length - 1));
  const ev = rp.events[rp.idx];
  const snap = ev.snap;

  // collect position targets; lerp toward them when animating
  const targets = [];
  const setPos = (obj, x, y, z) => {
    if (animate) targets.push({ obj, from: obj.position.clone(), to: new THREE.Vector3(x, y, z) });
    else obj.position.set(x, y, z);
  };

  snap.humans.forEach((h, s) => {
    const g = rp.humans[s];
    const stack = snap.humans.filter((o, os) => os < s && o.at === h.at).length;
    setPos(g,
      model.world[h.at * 2] + stack * 0.6 - 0.3,
      surfaceHeight(snap, h.at),
      model.world[h.at * 2 + 1]);
    g.rotation.z = h.knocked ? Math.PI / 2 : 0;
  });
  snap.movables.forEach((at, mi) => {
    setPos(rp.movs[mi], model.world[at * 2], 1.25, model.world[at * 2 + 1]);
  });
  setPos(rp.cpMark,
    model.world[snap.checkpointAt * 2], 0.35, model.world[snap.checkpointAt * 2 + 1]);
  for (const [t, g] of Object.entries(rp.covers)) {
    g.visible = !snap.revealed.includes(parseInt(t, 10));
  }
  rp.anim = animate && targets.some(t => !t.from.equals(t.to))
    ? { t0: performance.now(), dur: Math.max(120, 380 / rp.speed), list: targets }
    : null;
  updatePlayerAid(snap);

  rp.pileGroup.clear();
  for (const p of snap.piles) {
    const base = surfaceHeight(snap, p.at);
    const x = model.world[p.at * 2], z = model.world[p.at * 2 + 1];
    let y = base + 0.2;
    if (p.small) {
      const h = 0.28 * p.small;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, h, 14),
        new THREE.MeshLambertMaterial({ color: 0xf0c33c }));
      m.position.set(x - 0.9, y + h / 2, z);
      rp.pileGroup.add(m);
    }
    for (let k = 0; k < p.large; k++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 0.5, 18),
        new THREE.MeshLambertMaterial({ color: 0xe8842c }));
      m.position.set(x + 0.6, y + 0.3 + k * 0.55, z);
      rp.pileGroup.add(m);
    }
    if (p.friend) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5 * p.friend, 1),
        new THREE.MeshLambertMaterial({ color: 0x53d18a }));
      m.position.set(x - 0.2, y + 0.25 * p.friend, z + 1.2);
      rp.pileGroup.add(m);
    }
  }

  // status line + timeline position
  $('replaySlider').value = rp.idx;
  const cur = snap.cur;
  const persona = cur < rp.cfg.players ? rp.cfg.personas[cur] : 'neutral';
  const desc = describeEvent(ev);
  $('replayStatus').innerHTML =
    `<b>Turn ${ev.turn}</b> · Seat ${cur + 1} (${persona}) — ${desc}` +
    ` &nbsp;·&nbsp; ` + snap.humans.map((h, s) =>
      `<span style="color:#${(rp.cfg.players === 2 && s === 2 ? 0x9aa2b5 : PLAYER_COLORS[s]).toString(16).padStart(6, '0')}">` +
      `S${s + 1}: ${h.small}¢ ${h.large}◎ ${h.friend}♥</span>`).join(' ');
  updateCardStripHighlight();
}

// player-aid dot positions (% of the PlayerAid.png image)
const AID_MINOR = { Grab: [16, 25], Interact: [20, 44], Claim: [17, 65] };
const AID_MAJOR = { Move: [46.5, 22], Climb: [58.5, 22], Activate: [46.5, 57], 'Catch Up': [60, 57] };

function updatePlayerAid(snap) {
  const rp = replay;
  const cur = snap.cur;
  const color = (rp.cfg.players === 2 && cur === 2) ? 0x9aa2b5 : PLAYER_COLORS[cur];
  const hex = '#' + color.toString(16).padStart(6, '0');
  const persona = cur < rp.cfg.players ? rp.cfg.personas[cur] : 'neutral';
  $('aidHead').innerHTML = `<span style="color:${hex}">●</span> Seat ${cur + 1} · ${persona} — actions this turn`;
  $('playerAid').style.borderColor = hex;
  const dots = $('aidDots');
  dots.innerHTML = '';
  const counts = {};
  const put = (label, table) => {
    const pos = table[label];
    if (!pos) return;
    const k = (counts[label] = (counts[label] || 0) + 1) - 1;
    const d = document.createElement('div');
    d.className = 'aid-dot';
    d.style.left = (pos[0] + k * 3) + '%';
    d.style.top = pos[1] + '%';
    d.style.background = hex;
    dots.append(d);
  };
  for (const l of snap.spend.minor) put(l, AID_MINOR);
  for (const l of snap.spend.major) put(l, AID_MAJOR);
}

function describeEvent(ev) {
  switch (ev.t) {
    case 'turnStart': return 'turn begins';
    case 'playCard': return `plays initiative “${ev.card}” (S${ev.owner + 1} next)`;
    case 'activate': return `activates “${ev.card}”`;
    case 'cardfx': return `card effect: ${ev.card}`;
    case 'grab': return `grabs a ${ev.kind}`;
    case 'move': return ev.drag != null ? 'drags a platform' : 'moves';
    case 'climb': return 'climbs';
    case 'claim': return 'claims tokens';
    case 'knock': return `knocked down${ev.toCheckpoint ? ' → checkpoint' : ''}`;
    case 'shove': return `shoves Seat ${ev.victim + 1}`;
    case 'train': return 'train moves';
    case 'reveal': return `map tile ${ev.tile} revealed!`;
    case 'catchup': return 'Catch Up → checkpoint';
    case 'standup': return 'stands up';
    case 'deal': return `round ${ev.round} — new hands`;
    case 'whineCancel': return 'pays ♥ to cancel Whine';
    case 'end': return '🏁 game over';
    default: return ev.t;
  }
}

function buildTimeline() {
  const rp = replay;
  const slider = $('replaySlider');
  slider.max = rp.events.length - 1;
  slider.value = 0;
  const marks = $('replayMarks');
  marks.innerHTML = '';
  rp.events.forEach((ev, i) => {
    let cls = null;
    if (ev.t === 'reveal') cls = 'mk-reveal';
    else if (ev.t === 'knock') cls = 'mk-knock';
    else if (ev.t === 'claim' && ev.got?.large) cls = 'mk-large';
    else if (ev.t === 'playCard') cls = 'mk-card';
    if (!cls) return;
    const d = document.createElement('div');
    d.className = 'rmark ' + cls;
    d.style.left = (i / (rp.events.length - 1) * 100) + '%';
    marks.append(d);
  });
}

function buildCardStrip() {
  const rp = replay;
  const strip = $('replayCards');
  strip.innerHTML = '';
  const preview = $('cardPreview');
  rp.events.forEach((ev, i) => {
    if (ev.t !== 'playCard') return;
    const img = document.createElement('img');
    img.src = texUrl(cardArt(ev.card));
    img.title = `Turn ${ev.turn}: Seat ${ev.p + 1} plays ${ev.card} — click to jump`;
    img.dataset.idx = i;
    img.addEventListener('click', () => { pause(); applyEvent(i); });
    img.addEventListener('mouseenter', () => {
      preview.src = img.src;
      const r = img.getBoundingClientRect();
      preview.classList.remove('hidden');
      const w = 280;
      preview.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      preview.style.bottom = (window.innerHeight - r.top + 10) + 'px';
    });
    img.addEventListener('mouseleave', () => preview.classList.add('hidden'));
    strip.append(img);
  });
}
function updateCardStripHighlight() {
  const rp = replay;
  $('replayCards').querySelectorAll('img').forEach(img => {
    const i = parseInt(img.dataset.idx, 10);
    img.classList.toggle('played', i <= rp.idx);
    img.classList.toggle('current', isCurrentCard(i));
  });
}
function isCurrentCard(i) {
  const rp = replay;
  if (i > rp.idx) return false;
  for (let k = i + 1; k <= rp.idx; k++) if (rp.events[k].t === 'playCard') return false;
  return true;
}

function pause() { if (replay) { replay.playing = false; $('btnRpPlay').textContent = '▶'; } }
function play() {
  if (!replay) return;
  if (replay.idx >= replay.events.length - 1) replay.idx = 0;
  replay.playing = true;
  replay.last = performance.now();
  $('btnRpPlay').textContent = '⏸';
}

function tickReplay() {
  if (!replay) return;
  requestAnimationFrame(tickReplay);
  const rp = replay;
  // tween in-flight movement animations (grid-by-grid lerping)
  if (rp.anim) {
    const f = Math.min(1, (performance.now() - rp.anim.t0) / rp.anim.dur);
    const e = f * (2 - f);   // ease-out
    for (const t of rp.anim.list) t.obj.position.lerpVectors(t.from, t.to, e);
    if (f >= 1) rp.anim = null;
  }
  if (!rp.playing) return;
  const now = performance.now();
  rp.acc += (now - rp.last) * rp.speed;
  rp.last = now;
  const EVENT_MS = 460;
  while (rp.acc >= EVENT_MS) {
    rp.acc -= EVENT_MS;
    if (rp.idx >= rp.events.length - 1) { pause(); break; }
    applyEvent(rp.idx + 1, true);
  }
}

function seekEvent(dir, match) {
  const rp = replay;
  if (!rp) return;
  pause();
  let i = rp.idx + dir;
  while (i > 0 && i < rp.events.length - 1 && match && !match(rp.events[i])) i += dir;
  applyEvent(Math.max(0, Math.min(i, rp.events.length - 1)), !match);
}

// ================================================================ wiring
export function wireTesterUI() {
  $('testBoardSel').addEventListener('change', loadSelectedBoard);
  $('testPlayers').addEventListener('change', renderSetupPanel);
  $('btnCalc').addEventListener('click', calculate);
  renderSetupPanel();
  renderResults();

  $('btnRpPlay').addEventListener('click', () => replay?.playing ? pause() : play());
  $('btnRpPrev').addEventListener('click', () => seekEvent(-1));
  $('btnRpNext').addEventListener('click', () => seekEvent(1));
  $('btnRpPrevTurn').addEventListener('click', () => seekEvent(-1, e => e.t === 'turnStart'));
  $('btnRpNextTurn').addEventListener('click', () => seekEvent(1, e => e.t === 'turnStart'));
  $('btnRpStart').addEventListener('click', () => { pause(); applyEvent(0); });
  $('btnRpEnd').addEventListener('click', () => { pause(); applyEvent(replay.events.length - 1); });
  $('btnRpClose').addEventListener('click', stopReplay);
  $('rpSpeed').addEventListener('change', () => { if (replay) replay.speed = parseFloat($('rpSpeed').value); });
  $('replaySlider').addEventListener('input', () => {
    pause();
    applyEvent(parseInt($('replaySlider').value, 10));
  });
}
