// Tests zum Abfluggewicht des Start-/Landestreckenrechners (seit VERSION 5, Nachbesserungen VERSION 6): Abschriften der
// Starttabellen für tiefere Gewichte, Datenschema (charts.takeoff.lowerWeights), Tabellenwahl, «Start möglich bis …» im
// Kern, Eingabe (parseMass) und Anzeige in Karte und Kurzzeile.
// Sollwerte stammen aus den Abschriften und der Sollrechnung des Planers (tests/fixtures/c172d_5b_*kg.json,
// p2010_*kg.json, gewicht_faelle.json) oder aus der eigenen Sollrechnung unten, die keinen Code aus perf/perf.js nutzt.
// Die Tests des Browserteils (Feld, Takt, Fokus, Tageswechsel) stehen in tests/perf-ui.test.js.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));
const ui = require(path.join(ROOT, 'perf', 'perf-ui.js'));
const readBuf = (rel) => fs.readFileSync(path.join(ROOT, rel));
const readJson = (rel) => JSON.parse(readBuf(rel).toString('utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Tests der Anzeige mit der Ableseregel bis VERSION 6 (tests/helpers/ablesung.js); die ausgelieferte Ablesung (linear)
// prüft tests/perf-interpolation.test.js.
const { alteAblesung } = require('./helpers/ablesung.js');
const { afmGrids, legend } = require('./helpers/afm.js');
const C172D = alteAblesung(readJson('perf/aircraft/c172d.json'));
const P2010 = alteAblesung(readJson('perf/aircraft/p2010.json'));
const C152 = alteAblesung(readJson('perf/aircraft/c152.json'));
const AF = readJson('perf/airfields/lszk.json');
const LIST = ui.parseIndex(readJson('perf/aircraft/index.json')).list;
const ACS = { c172d: C172D, p2010: P2010, c152: C152 };
const FIX = {
  c1134: 'tests/fixtures/c172d_5b_1134kg.json', c1111: 'tests/fixtures/c172d_5b_1111kg.json',
  p1060: 'tests/fixtures/p2010_1060kg.json', p960: 'tests/fixtures/p2010_960kg.json', faelle: 'tests/fixtures/gewicht_faelle.json'
};
const FX = { c1134: readJson(FIX.c1134), c1111: readJson(FIX.c1111), p1060: readJson(FIX.p1060), p960: readJson(FIX.p960) };
const M_5A_1111 = readJson('tests/fixtures/c172d_5a_1111kg_m.json');
const P2010_ISA = readJson('tests/fixtures/p2010_isa.json');
const CASES = readJson('tests/fixtures/kontrollfaelle.json');
// Sollrechnung des Planers: [Fall, Muster, Platz, [tempC, QNH, Richtung, Wind, nass], massKg (null: ohne), Tabelle kg,
//  je gerechneter Piste [[Roll, 15 m] oder Grund je Starttabelle, Zustand, maxKg, maxPossibleKg]]
// VERSION 6 (N3): maxPossibleKg ist null, wenn «möglich» bei nasser Piste ohne Nässewert des AFM gerechnet ist; bewusst
// nachgeführt in zwölf Zeilen (K18 Tecnam nass: drei wet-unknown, fünf possible; C3 Cessna 152 nass: vier possible).
const GEWICHT = readJson(FIX.faelle);

// Abschrift spaltenweise (je Temperatur abwechselnd Rollstrecke und über 15 m, Höhe aufsteigend) → Zellen [Höhe][Temperatur]
const T7 = ['-20', '0', '10', '20', '30', '40', '50'], T4 = ['-25', '0', '25', '50'];
function colsToCells(cols, keys) {
  const n = cols[keys[0]].length / 2, out = [];
  for (let i = 0; i < n; i++) out.push(keys.map((k) => [cols[k][2 * i], cols[k][2 * i + 1]]));
  return out;
}
const lw = (ac, k) => ac.charts.takeoff.lowerWeights[k];
// Starttabellen je Muster für die Sollrechnung: Haupttabelle (Höchstgewicht; in tests/perf.test.js wörtlich geprüft),
// dann die tieferen Gewichte aus der zweiten Lesung des Planers (Fixtures, unabhängig von den Datendateien)
const SOLL_TABLES = {
  c172d: [[1157, C172D.charts.takeoff.table.cells], [1134, colsToCells(FX.c1134.mColumns, T7)], [1111, colsToCells(FX.c1111.mColumns, T7)]],
  p2010: [[1160, P2010.charts.takeoff.table.cells], [1060, colsToCells(FX.p1060.mColumns, T4)], [960, colsToCells(FX.p960.mColumns, T4)]],
  c152: [[758, C152.charts.takeoff.table.cells]]
};

// Hartbelag-Testplatz wie in tests/perf.test.js: Piste 36, 1070 m Start, 915 m Landung
function pavedField(elevFt) {
  return {
    schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, bearingMag: 360, surface: 'paved',
      takeoffAvailable: { value: 1070, unit: 'm' }, landingAvailable: { value: 915, unit: 'm' } }]
  };
}
const fieldOf = (f) => (f === 'lszk' ? AF : pavedField(f));
const rwyOf = (res, id) => res.runways.find((r) => r.id === id);
const inputOf = (inp, massKg) => {
  const x = { tempC: inp[0], qnhHpa: inp[1], windDirTrue: inp[2], windKt: inp[3], runwayWet: inp[4] === true };
  if (massKg !== undefined) x.massKg = massKg;
  return x;
};
const kgTxt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'");
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach((k) => deepFreeze(o[k])); }
  return o;
}

/* ── Unabhängige Sollrechnung: Start je Starttabelle ───────────
   Nach der Sollrechnung des Planers (planer3/soll-gewicht.js), ohne Code aus perf/perf.js: eigene Druckhöhe, Pistenwahl,
   Ablesung, Korrekturen und Rundung nach den AFM-Notes. Cessna: −10 % je 9 kt (abgerundet), Gras +15 % der
   Tabellen-Rollstrecke auf beide Strecken, nasses Gras × 1,2 (Mindestzuschlag Note 4). Tecnam: −10 m je kt, Gras +10 %,
   × 1,10 immer (NOTE), Temperatur linear. Cessna 152 wie Cessna, Tabelle in ft. Kein Wert über 40 kt Gegenwind oder wenn
   der Wind eine Strecke um mehr als die Hälfte verkürzt. Nass ohne Nässewert im AFM: Tecnam, Cessna 152, Cessna auf Hartbelag. */
// minimum: ein Mindestzuschlag des AFM ist eingerechnet (Cessna, nasses Gras «mindestens +20 %»); dann sagt die Zeile
// «möglich bis …» «(mit Mindestzuschlag)» (VERSION 6, N7)
const RULES = {
  c172d: { pct: true, grass: 15, factor: (wet, grass) => (wet && grass ? 1.2 : 1), wetValue: (grass) => grass, minimum: (wet, grass) => wet && grass, ft: false, linear: false },
  p2010: { pct: false, grass: 10, factor: () => 1.1, wetValue: () => false, minimum: () => false, ft: false, linear: true },
  c152: { pct: true, grass: 15, factor: () => 1, wetValue: () => false, minimum: () => false, ft: true, linear: false }
};
const up = (x) => Math.ceil(x - 1e-9);
const sollPa = (elevFt, qnh) => elevFt + 145442.16 * (1 - Math.pow(qnh / 1013.25, 0.190263));
// Gerechnete Pisten mit abgerundetem Gegenwind: unter 1 kt und ohne Richtung bis 3 kt alle Pisten ohne Wind, ohne
// Richtung darüber keine, sonst die Pisten ohne Rückenwindkomponente (genau quer: ohne Wind)
function sollRunways(af, dir, windKt) {
  const out = new Map();
  af.runways.forEach((r) => {
    if (windKt < 1) { out.set(r.id, 0); return; }
    if (dir === null) { if (windKt <= 3) out.set(r.id, 0); return; }
    const along = Math.round(Math.cos((dir - r.bearingTrue) * Math.PI / 180) * 1e9) / 1e9;
    if (along >= 0) out.set(r.id, Math.max(0, Math.floor(windKt * along + 1e-9)));
  });
  return out;
}
// [Roll m, 15 m] oder Grund
function sollStart(acId, cells, pa, tempC, kt, grass, wet) {
  const R = RULES[acId], ax = ACS[acId].charts.takeoff.table.axes, alt = ax[0].values, temps = ax[1].values;
  if (kt > 40) return 'headwind-limit';
  let i = 0;
  while (alt[i] < pa) i++;
  let gr, ob;
  if (R.linear && tempC > temps[0]) {
    let j = 1;
    while (temps[j] < tempC) j++;
    const a = cells[i][j - 1], b = cells[i][j], f = (tempC - temps[j - 1]) / (temps[j] - temps[j - 1]);
    gr = a[0] + f * (b[0] - a[0]);
    ob = a[1] + f * (b[1] - a[1]);
  } else {
    let j = 0;
    while (temps[j] < tempC) j++;
    gr = cells[i][j][0];
    ob = cells[i][j][1];
  }
  let g = gr, o = ob;
  if (kt >= 1) {
    if (R.pct) {
      const p = Math.floor(10 * kt / 9 + 1e-9);
      if (p > 50) return 'wind-credit-limit';
      g = g * (100 - p) / 100;
      o = o * (100 - p) / 100;
    } else {
      const r = 10 * kt;
      if (r > gr / 2 + 1e-9 || r > ob / 2 + 1e-9) return 'wind-credit-limit';
      g -= r;
      o -= r;
    }
  }
  if (grass) { const inc = gr * R.grass / 100; g += inc; o += inc; }
  const f = R.factor(wet, grass);
  g *= f;
  o *= f;
  if (R.ft) { g *= 0.3048; o *= 0.3048; }
  return [up(g), up(o)];
}
// Tabelle für das nächsthöhere Gewicht (ohne Gewicht die schwerste, darunter die leichteste)
function sollPick(tables, massKg) {
  let ti = 0;
  if (massKg !== null && massKg !== undefined) tables.forEach(([kg], i) => { if (kg >= massKg) ti = i; });
  return ti;
}
// Zustand wie Plan 3.2: [Zustand, maxKg]; möglich = Wert und beide Strecken ≤ verfügbar
function sollLimit(tables, list, ti, avail, wetMissing) {
  const poss = (x) => Array.isArray(x) && x[0] <= avail && x[1] <= avail;
  const cur = list[ti];
  if (!Array.isArray(cur)) return ['no-value', null];
  if (poss(cur)) return ['possible', null];
  if (ti === list.length - 1) return ['lowest', null];
  let nov = false;
  for (let i = ti + 1; i < list.length; i++) {
    if (!Array.isArray(list[i])) { nov = true; continue; }
    if (poss(list[i])) return wetMissing ? ['wet-unknown', null] : ['limit', tables[i][0]];
  }
  return [nov ? 'unknown' : 'none', null];
}
// Schwerste mögliche Tabelle; ohne Aussage (null), wenn «möglich» bei nasser Piste ohne Nässewert gerechnet ist (N3)
function sollMaxPossible(tables, list, avail, wetMissing) {
  const k = list.findIndex((x) => Array.isArray(x) && x[0] <= avail && x[1] <= avail);
  return k < 0 || wetMissing ? null : tables[k][0];
}
// Grösster Tabellenbereich, in dem beide Phasen einen Wert haben (darüber above-range)
function rangeOf(ac) {
  const max = (ph, k) => { const v = ac.charts[ph].table.axes[k].values; return v[v.length - 1]; };
  return { pa: Math.min(max('takeoff', 0), max('landing', 0)), t: Math.min(max('takeoff', 1), max('landing', 1)) };
}

/* ── Anzeige: Hilfen ───────────────────────────────────────── */
// 18.11.2026, 09:15 Uhr in Zürich (wie tests/perf-ui.test.js)
const NOW = Date.UTC(2026, 10, 18, 8, 15);
const MIN = 60000;
function wxPfa(over) {
  return Object.assign({
    src: 'pfa', srcLabel: 'MeteoSchweiz Pfäffikon ZH', time: NOW - 15 * MIN, ageMin: 15, stale: false,
    windKt: 8, windDir: 290, gustKt: 14, tempC: 15, dewC: 4.1, humPct: 63, qnhHpa: 1018, qfeHpa: 956.4,
    rainMmH: 0, rain1hMm: 0
  }, over);
}
function fgzo(over) {
  return Object.assign({
    ok: true, fetched_at_utc: new Date(NOW - 14 * MIN).toISOString(), runway_condition: 'DRY', updated: '18.11.2026, 07:14'
  }, over);
}
// Messwerte eines Falls; nass über den Regen von MeteoSchweiz (FGZO meldet DRY)
const wxOf = (inp) => wxPfa({ tempC: inp[0], qnhHpa: inp[1], windDir: inp[2], windKt: inp[3], rain1hMm: inp[4] ? 0.4 : 0 });
// afmTag: false ausdrücklich, damit die Tests nicht von der ausgelieferten Stellung TEASER_AFM_TAG abhängen
function ctxOf(wx, over) {
  return Object.assign({ dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx, fgzo: fgzo(), nowMs: NOW, detailsOpen: true, afmTag: false }, over);
}
const parts = (wx, over) => ui.renderParts(ctxOf(wx, over));
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function assertClean(html, label) {
  ['NaN', 'undefined', 'null', 'Infinity'].forEach((w) => assert.ok(!html.includes(w), label + ': enthält ' + w));
}
// Pistenblöcke der Karte: Start-Zeile (Roll, 15 m, verfügbar) und Feststellungen [Klasse, Text]
function blocksOf(body) {
  const out = {};
  const re = /<section class="perf-block" aria-label="Piste ([^"]*)">(.*?)<\/section>/g;
  let m;
  while ((m = re.exec(body))) {
    const s = /<tr><th scope="row">Start<\/th><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/.exec(m[2]);
    const num = (x) => { const v = /(\d[\d']*)&nbsp;m/.exec(x); return v ? Number(v[1].replace(/'/g, '')) : null; };
    out[m[1]] = {
      start: [num(s[1]), num(s[2])], avail: num(s[3]),
      findings: [...m[2].matchAll(/<div class="perf-finding ([^"]+)">(.*?)<\/div>/g)].map((f) => [f[1], text(f[2]).trim()])
    };
  }
  return out;
}
// Kurzzeile: Kopf und Start der Zeile «Rollstrecke» (Zahl, Farbe; null bei «kein Wert»)
function teaserOf(teaser) {
  const head = /^<span class="perf-t-head">(.*?)<\/span>/.exec(teaser);
  const st = /<span class="perf-nw">Start (?:<span class="perf-nov">kein Wert<\/span>|(?:bis )?<b(?: class="(perf-amber|perf-red)")?>(\d[\d']*)&nbsp;m<\/b>)/.exec(teaser);
  return { head: head ? text(head[1]).trim() : null, start: st ? (st[2] ? Number(st[2].replace(/'/g, '')) : null) : undefined, cls: st ? st[1] || null : undefined };
}
// Zeile «Start möglich bis …» je Zustand (Plan 4.3; «unknown» mit leichteren Tabellen mit und ohne Wert nennt beide)
const TXT = {
  lowest: 'Für ein tieferes Gewicht hat das AFM keine Starttabelle.',
  wet: 'Ob er mit weniger Gewicht möglich wäre, lässt sich bei nasser Piste nicht sagen: Das AFM nennt dafür keinen Wert.',
  noValue: 'Für tiefere Gewichte gibt es keinen Wert.',
  minimum: ' (mit Mindestzuschlag)'
};
function expectLine(state, x, maxKg, tables, byTable, ti, minimum) {
  const no = 'Start mit ' + kgTxt(x) + ' kg laut AFM nicht möglich';
  const list = (ks) => (ks.length > 1 ? ks.slice(0, -1).map(kgTxt).join(', ') + ' und ' : '') + kgTxt(ks[ks.length - 1]) + ' kg';
  switch (state) {
    case 'limit': return no + ', möglich bis ' + kgTxt(maxKg) + ' kg' + (minimum ? TXT.minimum : '') + '.';
    case 'none': return 'Start laut AFM auch mit ' + kgTxt(tables[tables.length - 1][0]) + ' kg nicht möglich.';
    case 'lowest': return no + '. ' + TXT.lowest;
    case 'wet-unknown': return no + '. ' + TXT.wet;
    case 'unknown': {
      const lighter = tables.map(([kg], i) => [kg, byTable[i]]).filter((x, i) => i > ti);
      const val = lighter.filter((x) => Array.isArray(x[1])).map((x) => x[0]), nov = lighter.filter((x) => !Array.isArray(x[1])).map((x) => x[0]);
      return val.length && nov.length ? no + ', auch nicht mit ' + list(val) + '. Für ' + list(nov) + ' gibt es keinen Wert.' : no + '. ' + TXT.noValue;
    }
    default: return null;
  }
}

/* ── Daten: Abschriften ────────────────────────────────────── */

test('Daten: neue Dateien ohne BOM, beide Muster mit zwei weiteren Starttabellen, Cessna 152 ohne', () => {
  Object.keys(FIX).forEach((k) => {
    const buf = readBuf(FIX[k]);
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), FIX[k] + ' hat ein BOM');
  });
  assert.deepEqual([C172D, P2010].map((ac) => ac.charts.takeoff.lowerWeights.length), [2, 2]);
  assert.equal(C152.charts.takeoff.lowerWeights, undefined);
  [C172D, P2010, C152].forEach((ac) => assert.equal(ac.charts.landing.lowerWeights, undefined, ac.id + ': Landung mit einer Tabelle'));
  assert.deepEqual([C172D.schema, P2010.schema], [2, 2], 'additiv in Schema 2');
});

test('Daten: Starttabellen 1134/1111 kg (Section 5b) und 1060/960 kg (APV5-9/-10) gleich der zweiten Lesung des Planers', () => {
  assert.deepEqual(lw(C172D, 0).table.cells, colsToCells(FX.c1134.mColumns, T7));
  assert.deepEqual(lw(C172D, 1).table.cells, colsToCells(FX.c1111.mColumns, T7));
  assert.deepEqual(lw(P2010, 0).table.cells, colsToCells(FX.p1060.mColumns, T4));
  assert.deepEqual(lw(P2010, 1).table.cells, colsToCells(FX.p960.mColumns, T4));
  // Form: Cessna 11 Höhen × 7 Temperaturen, Tecnam 7 × 4, je [Roll, 15 m]
  [[C172D, 11, 7], [P2010, 7, 4]].forEach(([ac, h, t]) => [0, 1].forEach((k) => {
    const c = lw(ac, k).table.cells;
    assert.equal(c.length, h);
    c.forEach((row) => { assert.equal(row.length, t); row.forEach((cell) => assert.equal(cell.length, 2)); });
  }));
});

test('Daten: m-Tabellen gegen die gedruckten ft-Werte (Cessna höchstens 1 m, Tecnam-Klammerwerte höchstens 0,51 ft)', () => {
  [[FX.c1134, 0], [FX.c1111, 1]].forEach(([F, k]) => {
    lw(C172D, k).table.cells.forEach((row, i) => row.forEach((c, j) => [0, 1].forEach((o) => {
      const d = c[o] - F.ftCells[i][j][o] * 0.3048;
      assert.ok(Math.abs(d) <= 1, 'c172d ' + k + ' ' + i + '/' + j + '/' + o + ': ' + d);
    })));
  });
  // Tecnam: Klammerwert = m / 0,3048 gerundet; einzige Ausnahme 454 m = 1489,50 ft, gedruckt 1489 (strenger als ±0,6 m)
  let exact = 0, n = 0;
  [FX.p1060, FX.p960].forEach((F) => T4.concat(['ISA']).forEach((k) => F.mColumns[k].forEach((m, i) => {
    const ft = F.ftColumns[k][i];
    n++;
    if (Math.round(m / 0.3048) === ft) exact++;
    assert.ok(Math.abs(m / 0.3048 - ft) <= 0.51, 'p2010 ' + k + '/' + i + ': ' + m + ' m, ' + ft + ' ft');
  })));
  assert.deepEqual([n, exact], [140, 139]);
});

test('Daten: ISA-Spalte der Tecnam-Tabellen 1060/960 kg (lineare Interpolation 0 bis +2,5 m über dem gedruckten Wert, Rundung −0,5 m)', () => {
  // Plan 1.2: 1060 kg −0,14 bis +1,94 m, 960 kg 0,00 bis +1,74 m; eine Zelle (1060 kg, 6000 ft) 0,14 m kürzer (Tabellenrundung)
  let lo = Infinity, hi = -Infinity;
  [[FX.p1060, 0], [FX.p960, 1]].forEach(([F, k]) => P2010_ISA.rows.forEach((row, i) => {
    const lk = core.lookupTable(lw(P2010, k).table, { pressureAltitude: row.pressureAltitudeFt, temperature: row.isaTempC });
    assert.equal(lk.interpolated, true);
    [0, 1].forEach((o) => {
      const d = lk.values[o ? 'overObstacle' : 'groundRoll'] - F.mColumns.ISA[2 * i + o];
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      assert.ok(d >= -0.5 && d <= 2.5, 'ISA ' + kgTxt(lw(P2010, k).mass.kg) + ' kg, ' + row.pressureAltitudeFt + ' ft: ' + d);
    });
  }));
  assert.ok(lo < 0 && lo > -0.2 && hi > 1.5, lo + ' … ' + hi);
});

function fp(cells, o, cols) {
  let s = 0, w = 0;
  cells.forEach((row, i) => row.forEach((c, j) => { s += c[o]; w += c[o] * (i * cols + j + 1); }));
  return [s, w];
}

test('Daten: Fingerabdrücke der neuen Tabellen (Plan 1.5)', () => {
  assert.deepEqual([fp(lw(C172D, 0).table.cells, 0, 7), fp(lw(C172D, 0).table.cells, 1, 7)], [[29696, 1334556], [46555, 2092850]]);
  assert.deepEqual([fp(lw(C172D, 1).table.cells, 0, 7), fp(lw(C172D, 1).table.cells, 1, 7)], [[28171, 1265798], [44167, 1985202]]);
  assert.deepEqual([fp(lw(P2010, 0).table.cells, 0, 4), fp(lw(P2010, 0).table.cells, 1, 4)], [[9961, 161039], [17609, 283664]]);
  assert.deepEqual([fp(lw(P2010, 1).table.cells, 0, 4), fp(lw(P2010, 1).table.cells, 1, 4)], [[7851, 126941], [14004, 225572]]);
});

test('Daten: Monotonie, 15 m länger als Rollstrecke, die schwerere Tabelle in jeder Zelle länger', () => {
  [C172D, P2010].forEach((ac) => {
    const tabs = [ac.charts.takeoff.table].concat(ac.charts.takeoff.lowerWeights.map((e) => e.table));
    tabs.forEach((t, k) => t.cells.forEach((row, i) => row.forEach((c, j) => {
      [0, 1].forEach((o) => {
        if (i > 0) assert.ok(c[o] > t.cells[i - 1][j][o], ac.id + ' ' + k + ' Höhe ' + i + '/' + j);
        if (j > 0) assert.ok(c[o] > row[j - 1][o], ac.id + ' ' + k + ' Temperatur ' + i + '/' + j);
        if (k > 0) assert.ok(c[o] < tabs[k - 1].cells[i][j][o], ac.id + ' Tabelle ' + k + ' nicht kürzer als die schwerere ' + i + '/' + j + '/' + o);
      });
      assert.ok(c[1] > c[0], ac.id + ' ' + k + ' 15 m ' + i + '/' + j);
    })));
  });
});

test('Daten: Gewicht, Quelle, Achsen und Ausgaben je Tabelle wörtlich; Section 5b ist nicht 5a', () => {
  assert.deepEqual(C172D.charts.takeoff.lowerWeights.map((e) => [e.mass, e.ref]), [
    [{ kg: 1134, lb: 2500 }, { figure: 'Figure 5-1c (Section 5b)', page: '5b-6' }],
    [{ kg: 1111, lb: 2450 }, { figure: 'Figure 5-1e (Section 5b)', page: '5b-9' }]
  ]);
  assert.deepEqual(P2010.charts.takeoff.lowerWeights.map((e) => [e.mass, e.ref]), [
    [{ kg: 1060, lb: 2337 }, { figure: 'Section 5, Ziffer 7', page: 'APV5-9' }],
    [{ kg: 960, lb: 2116 }, { figure: 'Section 5, Ziffer 7', page: 'APV5-10' }]
  ]);
  [C172D, P2010].forEach((ac) => ac.charts.takeoff.lowerWeights.forEach((e) => {
    assert.deepEqual(e.table.axes, ac.charts.takeoff.table.axes, ac.id + ' Achsen');
    assert.deepEqual(e.table.outputs, [{ id: 'groundRoll', unit: 'm' }, { id: 'overObstacle', unit: 'm' }]);
    assert.deepEqual(e.table.obstacle, { value: 50, unit: 'ft' });
    assert.equal(e.table.type, 'grid');
    assert.ok(Math.abs(e.mass.lb * core.LB_KG - e.mass.kg) < 0.35, ac.id + ' kg/lb ' + e.mass.kg);
    assert.ok(e.title.includes(String(e.mass.kg)), ac.id + ' Titel nennt das Gewicht');
  }));
  // Section 5b (Propeller MTV-6-A/190-69) bei 1111 kg ist in jeder Zelle kürzer als 5a; Plan 1.1: 2000 ft / 30 °C
  const b = lw(C172D, 1).table.cells;
  b.forEach((row, i) => row.forEach((c, j) => [0, 1].forEach((o) => assert.ok(c[o] < M_5A_1111.cells[i][j][o], '5b ≥ 5a ' + i + '/' + j))));
  assert.deepEqual([b[2][4], M_5A_1111.cells[2][4]], [[294, 460], [332, 569]]);
  // Texte der neuen Tabellen in tests/fixtures/texte.json (je 20 Texte je Tabelle; die Abschrift prüft tests/perf.test.js)
  const TX = readJson('tests/fixtures/texte.json');
  ['perf/aircraft/c172d.json', 'perf/aircraft/p2010.json'].forEach((f) => {
    assert.equal(Object.keys(TX[f]).filter((k) => k.startsWith('charts.takeoff.lowerWeights[')).length, 40, f);
  });
});

/* ── Datenschema: charts.takeoff.lowerWeights ──────────────── */

test('Schema: Mutationen von lowerWeights ergeben bad-data mit Fehlertext; ohne lowerWeights gültig, Grenzwerte gültig', () => {
  const P = 'charts.takeoff.lowerWeights';
  const cases = [
    ['vertauscht (aufsteigend)', C172D, (l) => l.reverse(), P + '[1].mass nicht absteigend unter dem Höchstgewicht'],
    ['Gewicht = Höchstgewicht', C172D, (l) => { l[0].mass = { kg: 1157, lb: 2550 }; }, P + '[0].mass nicht absteigend unter dem Höchstgewicht'],
    ['Pfund gleich wie die nächstschwerere', C172D, (l) => { l[1].mass.lb = l[0].mass.lb; }, P + '[1].mass nicht absteigend unter dem Höchstgewicht'],
    ['lb passt nicht zu kg', C172D, (l) => { l[0].mass.lb = 2480; }, P + '[0].mass: kg und lb passen nicht zusammen'],
    ['Achse anders', C172D, (l) => { l[0].table.axes[1].values[6] = 45; }, P + '[0].table: Achsen oder Ausgaben anders als in der Haupttabelle'],
    ['Tecnam: Temperatur nicht linear', P2010, (l) => { l[1].table.axes[1].read = 'nextHigher'; }, P + '[1].table: Achsen oder Ausgaben anders als in der Haupttabelle'],
    ['Einheit ft', C172D, (l) => { l[0].table.outputs.forEach((o) => { o.unit = 'ft'; }); }, P + '[0].table: Achsen oder Ausgaben anders als in der Haupttabelle'],
    ['Zeile fehlt', C172D, (l) => { l[0].table.cells.pop(); }, P + '[0].table.cells Form oder Wert falsch'],
    ['Tabelle fehlt', P2010, (l) => { delete l[1].table; }, P + '[1].table: fehlt'],
    ['Gewicht fehlt', C172D, (l) => { delete l[0].mass; }, P + '[0].mass unbekannt'],
    ['länger als die schwerere Tabelle', C172D, (l, ac) => {
      const top = ac.charts.takeoff.table.cells[10][6];                     // grösste Zelle: Monotonie bleibt erhalten
      l[0].table.cells[10][6] = [top[0] + 1, top[1] + 1];
    }, P + '[0].table.cells: länger als die nächstschwerere Tabelle'],
    // VERSION 6 (N1): jede der beiden Strecken für sich; 1'134 kg gegen das Höchstgewicht, 1'111 kg gegen 1'134 kg
    ['nur die Rollstrecke länger als in der schwereren Tabelle', C172D, (l, ac) => {
      const top = ac.charts.takeoff.table.cells[10][6], own = l[0].table.cells[10][6];
      l[0].table.cells[10][6] = [top[0] + 1, own[1]];
    }, P + '[0].table.cells: länger als die nächstschwerere Tabelle'],
    ['nur die Strecke über 15 m länger als in der schwereren Tabelle', C172D, (l, ac) => {
      const top = ac.charts.takeoff.table.cells[10][6], own = l[0].table.cells[10][6];
      l[0].table.cells[10][6] = [own[0], top[1] + 1];
    }, P + '[0].table.cells: länger als die nächstschwerere Tabelle'],
    ['1111 kg: nur die Rollstrecke länger als bei 1134 kg', C172D, (l) => {
      const top = l[0].table.cells[10][6], own = l[1].table.cells[10][6];
      l[1].table.cells[10][6] = [top[0] + 1, own[1]];
    }, P + '[1].table.cells: länger als die nächstschwerere Tabelle'],
    ['1111 kg: nur die Strecke über 15 m länger als bei 1134 kg', C172D, (l) => {
      const top = l[0].table.cells[10][6], own = l[1].table.cells[10][6];
      l[1].table.cells[10][6] = [own[0], top[1] + 1];
    }, P + '[1].table.cells: länger als die nächstschwerere Tabelle'],
    ['Tecnam: nur die Strecke über 15 m länger', P2010, (l, ac) => {
      const top = ac.charts.takeoff.table.cells[6][3], own = l[0].table.cells[6][3];
      l[0].table.cells[6][3] = [own[0], top[1] + 1];
    }, P + '[0].table.cells: länger als die nächstschwerere Tabelle'],
    ['Tabellen getauscht (Gewichte bleiben)', C172D, (l) => { const t = l[0].table; l[0].table = l[1].table; l[1].table = t; },
      P + '[1].table.cells: länger als die nächstschwerere Tabelle'],
    ['Tecnam: Tabellen getauscht', P2010, (l) => { const t = l[0].table; l[0].table = l[1].table; l[1].table = t; },
      P + '[1].table.cells: länger als die nächstschwerere Tabelle'],
    // VERSION 6 (N5): Quelle (Figure und Seite, nicht leer) und Titel (Zeichenkette) je weiterer Tabelle
    ['Quelle fehlt', C172D, (l) => { delete l[0].ref; }, P + '[0].ref fehlt'],
    ['Quelle kein Objekt', P2010, (l) => { l[1].ref = 'APV5-10'; }, P + '[1].ref fehlt'],
    ['Quelle als Liste', C172D, (l) => { l[1].ref = ['Figure 5-1e (Section 5b)', '5b-9']; }, P + '[1].ref fehlt'],
    ['Quelle als Liste mit Feldern', C172D, (l) => { l[1].ref = Object.assign([], { figure: 'Figure 5-1e (Section 5b)', page: '5b-9' }); }, P + '[1].ref fehlt'],
    ['Figure leer', C172D, (l) => { l[0].ref.figure = ''; }, P + '[0].ref fehlt'],
    ['Figure fehlt', P2010, (l) => { delete l[0].ref.figure; }, P + '[0].ref fehlt'],
    ['Seite fehlt', C172D, (l) => { delete l[1].ref.page; }, P + '[1].ref fehlt'],
    ['Seite als Zahl', P2010, (l) => { l[1].ref.page = 10; }, P + '[1].ref fehlt'],
    ['Seite null', C172D, (l) => { l[0].ref.page = null; }, P + '[0].ref fehlt'],
    ['Titel fehlt', C172D, (l) => { delete l[1].title; }, P + '[1].title fehlt'],
    ['Titel als Zahl', P2010, (l) => { l[0].title = 1060; }, P + '[0].title fehlt'],
    ['Titel null', C172D, (l) => { l[0].title = null; }, P + '[0].title fehlt']
  ];
  // Synthetische weitere Tabelle (für Listen ohne Datei): Gewicht i kg unter 1'150 kg, Quelle, Titel, Tabelle der Vorlage
  const entry = (ac, i) => ({ mass: { kg: 1150 - i, lb: Math.round((1150 - i) / core.LB_KG) }, title: 'Test ' + i,
    ref: { figure: 'Test', page: String(i) }, table: clone(ac.charts.takeoff.table) });
  const listCases = [
    ['leere Liste', C172D, () => [], P + ' falsch'],
    ['kein Array', C172D, (l) => l[0], P + ' falsch'],
    ['null', P2010, () => null, P + ' falsch'],
    ['neun Einträge', C172D, (l, ac) => Array.from({ length: 9 }, (x, i) => entry(ac, i)), P + ' falsch']
  ];
  const check = (name, ac, want) => {
    assert.deepEqual(core.validateAircraft(ac), { ok: false, errors: [want] }, name);
    const r = core.compute(ac, AF, inputOf([15, 1013.25, 304, 5, false], 1100));
    assert.deepEqual([r.ok, r.error.code], [false, 'bad-data'], name);
  };
  cases.forEach(([name, base, mutate, want]) => {
    const ac = clone(base);
    mutate(ac.charts.takeoff.lowerWeights, ac);
    check(name, ac, want);
  });
  listCases.forEach(([name, base, make, want]) => {
    const ac = clone(base);
    ac.charts.takeoff.lowerWeights = make(ac.charts.takeoff.lowerWeights, ac);
    check(name, ac, want);
  });
  // bei der Landung: weitere Tabellen nicht erlaubt
  const land = clone(C172D);
  land.charts.landing.lowerWeights = [{ mass: { kg: 1111, lb: 2450 }, table: clone(land.charts.landing.table) }];
  check('bei der Landung', land, 'charts.landing.lowerWeights nur beim Start erlaubt');
  // Haupttabelle schon fehlerhaft: nur deren Meldung (wie «Monotonieprüfung allein» in tests/perf.test.js)
  const both = clone(C172D);
  const c = both.charts.takeoff.table.cells;
  c[3][2] = [c[2][2][0] - 5, c[2][2][1]];
  both.charts.takeoff.lowerWeights.reverse();
  assert.deepEqual(core.validateAircraft(both), { ok: false, errors: ['charts.takeoff.table.cells nicht monoton'] });
  // Gültig: ohne lowerWeights (Stand vor der Gewichtseingabe), acht Einträge, Tabelle gleich der schwereren, kg/lb an der Grenze
  [C172D, P2010].forEach((base) => {
    const ac = clone(base);
    delete ac.charts.takeoff.lowerWeights;
    assert.deepEqual(core.validateAircraft(ac), { ok: true, errors: [] }, base.id + ' ohne lowerWeights');
  });
  const eight = clone(C172D);
  eight.charts.takeoff.lowerWeights = Array.from({ length: 8 }, (x, i) => entry(eight, i));
  assert.deepEqual(core.validateAircraft(eight), { ok: true, errors: [] }, 'acht Einträge, Tabellen gleich der schwereren');
  // Titel darf leer sein (er wird nicht angezeigt), die Quelle nicht; weitere Felder der Quelle stören nicht
  const noTitle = clone(P2010);
  noTitle.charts.takeoff.lowerWeights[1].title = '';
  noTitle.charts.takeoff.lowerWeights[0].ref.note = 'Zusatz';
  assert.deepEqual(core.validateAircraft(noTitle), { ok: true, errors: [] }, 'leerer Titel');
  const edge = clone(C172D);
  edge.charts.takeoff.lowerWeights[0].mass.lb = 2502;                       // 2502 lb = 1134,89 kg: Abstand 0,89 kg
  assert.equal(core.validateAircraft(edge).ok, true, 'kg/lb innerhalb 1 kg');
  edge.charts.takeoff.lowerWeights[0].mass.lb = 2503;                       // 1135,34 kg: Abstand 1,34 kg
  assert.deepEqual(core.validateAircraft(edge).errors, [P + '[0].mass: kg und lb passen nicht zusammen']);
});

/* ── Kern: Tabellenwahl ────────────────────────────────────── */

test('Tabellenwahl an allen Grenzen: nächsthöheres Gewicht, darunter die kleinste Tabelle, über dem Höchstgewicht above-mass', () => {
  const inp = [15, 1018, 290, 8, false];
  const cases = {
    c172d: [[1157, 1157], [1156, 1157], [1135, 1157], [1134, 1134], [1133, 1134], [1112, 1134], [1111, 1111], [1110, 1111], [579, 1111], [1134.01, 1157], [1111.5, 1134]],
    p2010: [[1160, 1160], [1061, 1160], [1060, 1060], [961, 1060], [960, 960], [959, 960], [580, 960]],
    c152: [[758, 758], [757, 758], [379, 758]]
  };
  Object.keys(cases).forEach((id) => {
    const ac = ACS[id], tabs = core.takeoffTables(ac), lightest = tabs[tabs.length - 1].kg;
    cases[id].forEach(([kg, want]) => {
      const r = core.compute(ac, AF, inputOf(inp, kg));
      assert.equal(r.ok, true, id + ' ' + kg);
      const ti = tabs.findIndex((t) => t.kg === want);
      assert.deepEqual(r.mass, {
        inputKg: kg, maxKg: ac.mass.kg, maxLb: ac.mass.lb, tableKg: want, tableLb: tabs[ti].lb, tableIndex: ti, tableCount: tabs.length,
        tableRef: tabs[ti].ref, tableTitle: tabs[ti].title, lightestKg: lightest, belowLowest: kg < lightest, tablesKg: tabs.map((t) => t.kg),
        // seit VERSION 7: Ableseregel und (bei «linear») die nächstleichtere Tabelle; mit der alten Regel nie interpoliert
        read: 'nextHigher', interpolated: false, lowerKg: null, lowerIndex: null, lowerRef: null, lowerTitle: null
      }, id + ' ' + kg);
      // Der Start der Piste rechnet mit der gewählten Tabelle (Ablesung), die Landung nie mit einer Starttabelle
      assert.deepEqual(r.lookups.takeoff.values, core.lookupTable(tabs[ti].table, { pressureAltitude: r.pressureAltitudeFt, temperature: 15 }).values);
      assert.deepEqual(r.lookups.landing, core.compute(ac, AF, inputOf(inp)).lookups.landing);
    });
    // über dem Höchstgewicht: eigener Fehler, kein Wert
    const over = core.compute(ac, AF, inputOf(inp, ac.mass.kg + 1));
    assert.deepEqual([over.ok, over.error], [false, { code: 'above-mass', massKg: ac.mass.kg + 1, maxKg: ac.mass.kg }], id + ' über MTOW');
    assert.equal(over.runways, undefined);
    assert.equal(core.compute(ac, AF, inputOf(inp, ac.mass.kg + 0.5)).error.code, 'above-mass');
  });
  // Ungültige Angabe: invalid-input mit Feld massKg; null und undefined heissen Höchstgewicht
  [0, -1, NaN, Infinity, '1100', true, {}].forEach((v) => {
    const r = core.compute(C172D, AF, inputOf(inp, v));
    assert.deepEqual([r.ok, r.error.code, r.error.fields], [false, 'invalid-input', [{ field: 'massKg', value: v }]], String(v));
  });
  [null, undefined].forEach((v) => {
    const r = core.compute(C172D, AF, inputOf(inp, v));
    assert.deepEqual([r.mass.inputKg, r.mass.tableKg, r.mass.tableIndex, r.mass.belowLowest], [null, 1157, 0, false], String(v));
  });
  // Funktionen direkt
  const tabs = core.takeoffTables(C172D);
  assert.deepEqual(tabs.map((t) => [t.kg, t.lb, t.ref.page]), [[1157, 2550, '5b-3'], [1134, 2500, '5b-6'], [1111, 2450, '5b-9']]);
  assert.equal(tabs[0].table, C172D.charts.takeoff.table);
  assert.equal(tabs[2].table, lw(C172D, 1).table);
  assert.deepEqual(core.takeoffTables(C152).map((t) => t.kg), [758]);
  assert.deepEqual([null, 1157, 1135, 1134, 1112, 1111, 500].map((kg) => core.pickTakeoffTable(tabs, kg)), [0, 0, 0, 1, 1, 2, 2]);
});

/* ── Kern: Sollwerte des Planers und eigene Sollrechnung ───── */

test('Sollwerte des Planers: alle 416 Zeilen aus gewicht_faelle.json (Strecken je Tabelle, Tabellenwahl, Zustand, maxKg, maxPossibleKg)', () => {
  assert.equal(GEWICHT.length, 416);
  const states = {};
  GEWICHT.forEach(([id, acId, field, inp, massKg, tableKg, rws]) => {
    const label = id + ' ' + acId + ' ' + massKg;
    const r = core.compute(ACS[acId], fieldOf(field), inputOf(inp, massKg === null ? undefined : massKg));
    assert.equal(r.ok, true, label);
    assert.equal(r.mass.tableKg, tableKg, label + ': Tabelle');
    assert.equal(r.mass.inputKg, massKg, label);
    const computed = r.runways.filter((x) => x.computed).map((x) => x.id).sort();
    assert.deepEqual(computed, Object.keys(rws).sort(), label + ': gerechnete Pisten');
    Object.keys(rws).forEach((rid) => {
      const [byTable, state, maxKg, maxPossibleKg] = rws[rid], g = rwyOf(r, rid);
      assert.deepEqual(g.takeoffByMass.map((x) => x.ok ? [x.m.groundRoll, x.m.overObstacle] : x.reason), byTable, label + ' ' + rid + ': Strecken je Tabelle');
      assert.deepEqual(g.takeoffByMass.map((x) => x.kg), r.mass.tablesKg);
      assert.deepEqual([g.takeoffLimit.state, g.takeoffLimit.maxKg, g.takeoffLimit.maxPossibleKg, g.takeoffLimit.tableKg], [state, maxKg, maxPossibleKg, tableKg], label + ' ' + rid);
      // gewählte Tabelle = Start der Piste
      const sel = byTable[r.mass.tableIndex];
      assert.deepEqual(g.takeoff.ok ? [g.takeoff.m.groundRoll, g.takeoff.m.overObstacle] : g.takeoff.reason, sel, label + ' ' + rid + ': Start');
      states[acId + ' ' + state] = (states[acId + ' ' + state] || 0) + 1;
    });
    // nicht gerechnete Pisten: ohne Rechnung je Tabelle
    r.runways.filter((x) => !x.computed).forEach((x) => assert.deepEqual([x.takeoffByMass, x.takeoffLimit], [null, null], label + ' ' + x.id));
  });
  // Ohne Gewicht: Start wie in den bestehenden Kontrollfällen (Zeilen mit massKg null)
  GEWICHT.filter((g) => g[4] === null).forEach(([id, , , , , , rws]) => {
    const exp = CASES.find((c) => c[0] === id)[4];
    Object.keys(rws).forEach((rid) => {
      const want = exp[rid][1];
      if (want === null) return;
      assert.deepEqual(rws[rid][0][0], typeof want === 'string' ? want : want.slice(0, 2), id + ' ' + rid + ': Sollzeile ≠ Kontrollfall');
    });
  });
  ['c172d possible', 'c172d limit', 'c172d none', 'c172d lowest', 'c172d no-value', 'p2010 possible', 'p2010 limit', 'p2010 none', 'p2010 lowest',
    'p2010 no-value', 'p2010 wet-unknown', 'c152 possible', 'c152 lowest', 'c152 no-value'].forEach((k) => assert.ok(states[k] > 0, 'nie: ' + k));
});

test('Sollrechnung: Durchlauf über Muster, Plätze, Wetter, Nässe und Gewichte – Strecken je Tabelle, Wahl, Zustand, Invarianten, Landung', () => {
  const temps = [-20, 7.5, 15, 22.37, 30, 38, 46];
  const qnhs = [975, 1013.25, 1035];
  const dirs = [null, 124, 214, 304, 30];
  const winds = [0, 2, 3.5, 7, 13, 17, 41];
  const masses = {
    c172d: [undefined, null, 1157, 1156, 1134, 1133, 1120, 1111, 1110, 579, 1158],
    p2010: [undefined, null, 1160, 1159, 1060, 1059, 1000, 960, 959, 580, 1161],
    c152: [undefined, null, 758, 757, 600, 759]
  };
  // LSZK mit Hartbelag (gleiche Längen): Cessna nass ohne Nässewert des AFM (Note 4 gilt nur für Gras)
  const pavedLszk = clone(AF);
  pavedLszk.runways.forEach((r) => { r.surface = 'paved'; });
  const stats = { n: 0, rows: 0, states: {}, wetNoClaim: 0 };
  Object.keys(ACS).forEach((id) => {
    const ac = ACS[id], tables = SOLL_TABLES[id], R = RULES[id], range = rangeOf(ac);
    [AF, pavedLszk].forEach((af) => temps.forEach((t) => qnhs.forEach((q) => dirs.forEach((d) => winds.forEach((w) => [false, true].forEach((wet) => {
      const pa = sollPa(af.elevation.value, q);
      const base = core.compute(ac, af, { tempC: t, qnhHpa: q, windDirTrue: d, windKt: w, runwayWet: wet });
      const above = pa > range.pa || t > range.t;
      if (above) { assert.equal(base.error && base.error.code, 'above-range', id + ' ' + t + '/' + q); }
      const rws = sollRunways(af, d, w);
      let prev = null;                         // Rechnung der nächstschwereren Gewichtsangabe (Monotonie über das Gewicht)
      masses[id].forEach((mk) => {
        const input = { tempC: t, qnhHpa: q, windDirTrue: d, windKt: w, runwayWet: wet };
        if (mk !== undefined) input.massKg = mk;
        const r = core.compute(ac, af, input);
        stats.n++;
        const label = id + ' ' + af.icao + ' ' + JSON.stringify([t, q, d, w, wet, mk]);
        if (mk && mk > ac.mass.kg) {
          assert.deepEqual([r.ok, r.error.code], [false, 'above-mass'], label);
          return;
        }
        if (above) { assert.equal(r.error.code, 'above-range', label); return; }
        assert.equal(r.ok, true, label + ' ' + JSON.stringify(r.error));
        const ti = sollPick(tables, mk);
        assert.deepEqual([r.mass.tableKg, r.mass.tableIndex, r.mass.belowLowest], [tables[ti][0], ti, !!mk && mk < tables[tables.length - 1][0]], label + ': Wahl');
        r.runways.forEach((rw) => {
          const kt = rws.get(rw.id);
          if (kt === undefined) {
            assert.deepEqual([rw.computed, rw.takeoffByMass, rw.takeoffLimit], [false, null, null], label + ' ' + rw.id);
            return;
          }
          stats.rows++;
          assert.deepEqual([rw.computed, rw.wind.kt], [true, kt], label + ' ' + rw.id + ': Pistenwahl');
          const grass = rw.surface === 'grass', avail = af.runways.find((x) => x.id === rw.id).takeoffAvailable.value;
          const list = tables.map(([, cells]) => sollStart(id, cells, pa, t, kt, grass, wet));
          assert.deepEqual(rw.takeoffByMass.map((x) => x.ok ? [x.m.groundRoll, x.m.overObstacle] : x.reason), list, label + ' ' + rw.id + ': Strecken');
          const wetMissing = wet && !R.wetValue(grass);
          const [state, maxKg] = sollLimit(tables, list, ti, avail, wetMissing);
          const L = rw.takeoffLimit;
          assert.deepEqual([L.state, L.maxKg, L.maxPossibleKg, L.tableKg, L.lightestKg], [state, maxKg, sollMaxPossible(tables, list, avail, wetMissing), tables[ti][0], tables[tables.length - 1][0]], label + ' ' + rw.id + ': Grenze');
          rw.takeoffByMass.forEach((x, i) => {
            assert.equal(x.possible, Array.isArray(list[i]) && list[i][0] <= avail && list[i][1] <= avail, label + ' possible ' + i);
            assert.equal(x.wetFactorMissing, x.ok ? wetMissing : false, label + ' wetFactorMissing ' + i);
          });
          // Start der Piste = gewählte Tabelle; nie «möglich bis» bei nasser Piste ohne Nässewert
          assert.deepEqual(rw.takeoff.ok ? [rw.takeoff.m.groundRoll, rw.takeoff.m.overObstacle] : rw.takeoff.reason, list[ti], label + ': Start');
          if (wetMissing) assert.notEqual(L.state, 'limit', label + ': «möglich bis» bei nasser Piste ohne AFM-Wert');
          // Invariante: nicht möglich mit der gewählten Tabelle → keine schwerere oder gleiche Tabelle möglich
          if (['limit', 'none', 'lowest', 'wet-unknown', 'unknown'].includes(L.state)) {
            assert.ok(L.maxPossibleKg === null || L.maxPossibleKg < L.tableKg, label + ': maxPossibleKg ' + L.maxPossibleKg);
          }
          if (L.state === 'limit') assert.equal(L.maxPossibleKg, L.maxKg, label);
          if (L.state === 'possible' && !wetMissing) assert.ok(L.maxPossibleKg >= L.tableKg, label);
          // Nass ohne Nässewert: «möglich» ist ohne Zuschlag gerechnet, maxPossibleKg ohne Aussage (N3)
          if (wetMissing) assert.equal(L.maxPossibleKg, null, label + ': maxPossibleKg bei nasser Piste ohne AFM-Wert');
          if (wetMissing && list.some((x) => Array.isArray(x) && x[0] <= avail && x[1] <= avail)) stats.wetNoClaim++;
          // Landung unabhängig vom Gewicht
          assert.deepEqual(rw.landing, rwyOf(base, rw.id).landing, label + ': Landung');
          // Monotonie über das Gewicht: leichter nie länger, «möglich» bleibt möglich (sofern ein Wert da ist)
          const p0 = prev && rwyOf(prev, rw.id);
          if (p0 && p0.takeoff.ok && rw.takeoff.ok) {
            assert.ok(rw.takeoff.m.groundRoll <= p0.takeoff.m.groundRoll && rw.takeoff.m.overObstacle <= p0.takeoff.m.overObstacle, label + ': leichter länger');
            if (p0.takeoffLimit.state === 'possible') assert.equal(L.state, 'possible', label + ': leichter nicht mehr möglich');
          }
          stats.states[id + ' ' + L.state] = (stats.states[id + ' ' + L.state] || 0) + 1;
        });
        assert.deepEqual(r.lookups.landing, base.lookups.landing, label + ': Ablesung Landung');
        if (mk !== null && mk !== undefined) prev = r;
      });
      // ohne Angabe = null = Höchstgewicht: gleiche Rechnung
      if (base.ok) {
        const withNull = core.compute(ac, af, { tempC: t, qnhHpa: q, windDirTrue: d, windKt: w, runwayWet: wet, massKg: null });
        const withMax = core.compute(ac, af, { tempC: t, qnhHpa: q, windDirTrue: d, windKt: w, runwayWet: wet, massKg: ac.mass.kg });
        assert.deepEqual(withNull, base);
        assert.deepEqual(withMax.runways, base.runways, id + ': Eingabe = Höchstgewicht wie ohne Eingabe');
      }
    }))))));
  });
  const S = stats.states;
  ['possible', 'limit', 'none', 'lowest', 'no-value', 'wet-unknown', 'unknown'].forEach((s) => assert.ok(S['p2010 ' + s] > 0, 'Tecnam nie: ' + s + ' ' + JSON.stringify(S)));
  ['possible', 'limit', 'none', 'lowest', 'no-value', 'wet-unknown'].forEach((s) => assert.ok(S['c172d ' + s] > 0, 'Cessna nie: ' + s + ' ' + JSON.stringify(S)));
  ['possible', 'lowest'].forEach((s) => assert.ok(S['c152 ' + s] > 0, 'Cessna 152 nie: ' + s));
  assert.ok(stats.n > 70000 && stats.rows > 60000, JSON.stringify({ n: stats.n, rows: stats.rows }));
  assert.ok(stats.wetNoClaim > 1000, 'nass ohne Nässewert mit möglicher Tabelle: ' + stats.wetNoClaim);
});

test('Ohne Gewicht gleich wie vor der Gewichtseingabe: alle 64 Kontrollfälle, mit und ohne lowerWeights in den Daten', () => {
  // Datenstand vor der Gewichtseingabe = Datei ohne lowerWeights (die Erweiterung ist rein additiv)
  const old = {};
  Object.keys(ACS).forEach((id) => { old[id] = clone(ACS[id]); delete old[id].charts.takeoff.lowerWeights; });
  const sample = clone(C172D);
  sample.charts.takeoff.table.cells = M_5A_1111.cells;
  delete sample.charts.takeoff.lowerWeights;
  const OLD_KEYS = ['id', 'bearingTrue', 'bearingMag', 'surface', 'computed', 'reason', 'wind', 'takeoff', 'landing'];
  const strip = (r) => (r.ok ? Object.assign({}, r, { mass: undefined, runways: r.runways.map((x) => { const o = {}; OLD_KEYS.forEach((k) => { o[k] = x[k]; }); return o; }) }) : r);
  assert.equal(CASES.length, 64);
  CASES.forEach(([id, acId, field, inp]) => {
    const ac = acId === 'sample5a1111' ? sample : ACS[acId], before = acId === 'sample5a1111' ? sample : old[acId];
    const a = core.compute(ac, fieldOf(field), inputOf(inp)), b = core.compute(before, fieldOf(field), inputOf(inp));
    assert.deepEqual(strip(a), strip(b), id);
    if (a.ok) {
      assert.deepEqual([a.mass.inputKg, a.mass.tableIndex, a.mass.tableKg], [null, 0, ac.mass.kg], id);
      // Rechnung je Tabelle: die erste ist die Rechnung der Piste selbst (gleiches Objekt-Ergebnis)
      a.runways.filter((x) => x.computed).forEach((x) => {
        assert.deepEqual(x.takeoffByMass[0].m, x.takeoff.m, id + ' ' + x.id);
        assert.deepEqual(x.takeoffByMass[0].ok, x.takeoff.ok, id + ' ' + x.id);
      });
    }
  });
  // Eingabe- und Datenobjekte bleiben unverändert, auch mit Gewicht
  const ac = deepFreeze(clone(P2010)), af = deepFreeze(clone(AF));
  const r = core.compute(ac, af, deepFreeze(inputOf([15, 1018, 290, 8, true], 1000)));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.mass.tableKg, 1060);
});

test('«Start möglich bis» direkt (_takeoffLimit): alle Zustände, Lücken, nass ohne Nässewert, maxPossibleKg', () => {
  const e = (kg, ok, possible, wet) => ({ kg, ok, possible: !!possible, wetFactorMissing: !!wet });
  const L = (list, ti) => { const r = core._takeoffLimit(list, ti); return [r.state, r.maxKg, r.maxPossibleKg, r.tableKg, r.lightestKg]; };
  // possible, no-value
  assert.deepEqual(L([e(1160, true, true), e(1060, true, true), e(960, true, true)], 0), ['possible', null, 1160, 1160, 960]);
  assert.deepEqual(L([e(1160, false), e(1060, true, true), e(960, true, true)], 0), ['no-value', null, 1060, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, true), e(960, false)], 2), ['no-value', null, 1060, 960, 960]);
  // limit: nächste leichtere mögliche Tabelle, auch über eine Lücke ohne Wert
  assert.deepEqual(L([e(1160, true, false), e(1060, true, true), e(960, true, true)], 0), ['limit', 1060, 1060, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, true, true)], 0), ['limit', 960, 960, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, false), e(960, true, true)], 0), ['limit', 960, 960, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, true, true)], 1), ['limit', 960, 960, 1060, 960]);
  // wet-unknown: die leichtere Tabelle wäre möglich, aber ohne Nässewert gerechnet; maxPossibleKg ohne Aussage (N3)
  assert.deepEqual(L([e(1160, true, false, true), e(1060, true, true, true), e(960, true, true, true)], 0), ['wet-unknown', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false, true), e(1060, false), e(960, true, true, true)], 0), ['wet-unknown', null, null, 1160, 960]);
  // possible und no-value auf nasser Piste ohne Nässewert: maxPossibleKg ohne Aussage; trocken bleibt es (N3)
  assert.deepEqual(L([e(1160, true, true, true), e(1060, true, true, true), e(960, true, true, true)], 0), ['possible', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false, true), e(1060, true, true, true), e(960, true, true, true)], 1), ['possible', null, null, 1060, 960]);
  assert.deepEqual(L([e(1160, true, true, true), e(1060, false), e(960, true, true, true)], 1), ['no-value', null, null, 1060, 960]);
  assert.deepEqual(L([e(1160, true, true), e(1060, false), e(960, true, true)], 1), ['no-value', null, 1160, 1060, 960]);
  assert.deepEqual(L([e(758, true, true, true)], 0), ['possible', null, null, 758, 758]);
  assert.deepEqual(L([e(758, true, true)], 0), ['possible', null, 758, 758, 758]);
  // Massgebend ist die schwerste mögliche Tabelle: ist sie ohne Nässewert gerechnet, kein Wert einer leichteren
  // (aus dem Kern kommen die Nässe-Angaben je Piste ohnehin für alle Tabellen gleich)
  assert.deepEqual(L([e(1160, true, true, true), e(1060, true, true), e(960, true, true)], 0), ['possible', null, null, 1160, 960]);
  // none / lowest / unknown
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, true, false)], 0), ['none', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false, true), e(1060, true, false, true), e(960, true, false, true)], 0), ['none', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, true, false)], 2), ['lowest', null, null, 960, 960]);
  assert.deepEqual(L([e(758, true, false)], 0), ['lowest', null, null, 758, 758]);
  assert.deepEqual(L([e(1160, true, false), e(1060, false), e(960, false)], 0), ['unknown', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, false)], 0), ['unknown', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, false), e(960, true, false)], 0), ['unknown', null, null, 1160, 960]);
  assert.deepEqual(L([e(1160, true, false), e(1060, true, false), e(960, false)], 1), ['unknown', null, null, 1060, 960]);
  // Schwerere Tabellen zählen für «möglich bis» nicht (nur leichtere als die gewählte)
  assert.deepEqual(L([e(1160, true, true), e(1060, true, false), e(960, true, false)], 1), ['none', null, 1160, 1060, 960]);
});

test('Seltene Zustände mit echten Eingaben (LSZK): unknown gemischt und ohne Wert, wet-unknown, none, lowest – Sollrechnung gleich Kern', () => {
  // [Muster, tempC, QNH, Richtung, Wind, nass, Gewicht, Piste, Zustand]; Zustand und Strecken aus der eigenen Sollrechnung
  const cases = [
    ['p2010', 15, 1013.25, 124, 13, false, undefined, '12', 'unknown'],
    ['p2010', -10, 990, 124, 15, false, undefined, '12', 'unknown'],
    ['p2010', -10, 990, null, 0, true, undefined, '12', 'wet-unknown'],
    ['c172d', -10, 990, null, 0, true, undefined, '12', 'none'],
    ['c172d', -10, 990, null, 0, true, 1100, '12', 'lowest'],
    ['p2010', 10, 990, null, 0, false, 950, '12', 'lowest'],
    ['c172d', 35, 990, null, 0, true, undefined, '12', 'none'],
    ['p2010', -10, 990, null, 0, false, undefined, '12', 'limit'],
    ['c172d', -10, 990, 124, 2, true, undefined, '12', 'limit']
  ];
  cases.forEach(([id, t, q, d, w, wet, mk, rid, want]) => {
    const r = core.compute(ACS[id], AF, inputOf([t, q, d, w, wet], mk));
    const rw = rwyOf(r, rid), tables = SOLL_TABLES[id], pa = sollPa(AF.elevation.value, q), kt = sollRunways(AF, d, w).get(rid);
    const list = tables.map(([, cells]) => sollStart(id, cells, pa, t, kt, true, wet));
    const ti = sollPick(tables, mk), avail = AF.runways.find((x) => x.id === rid).takeoffAvailable.value;
    const label = JSON.stringify([id, t, q, d, w, wet, mk]);
    assert.equal(sollLimit(tables, list, ti, avail, wet && !RULES[id].wetValue(true))[0], want, label + ': Sollrechnung');
    assert.equal(rw.takeoffLimit.state, want, label);
    assert.deepEqual(rw.takeoffByMass.map((x) => x.ok ? [x.m.groundRoll, x.m.overObstacle] : x.reason), list, label);
  });
  // gemischt: 1'060 kg mit Wert (nicht möglich), 960 kg ohne Wert
  const mixed = rwyOf(core.compute(P2010, AF, inputOf([15, 1013.25, 124, 13, false])), '12').takeoffByMass;
  assert.deepEqual(mixed.map((x) => [x.ok, x.possible]), [[true, false], [true, false], [false, false]]);
  // Genau gleich lang wie verfügbar ist möglich (Cessna, nass, 2 kt: 520 m über 15 m auf Piste 12 mit 520 m)
  const eq = rwyOf(core.compute(C172D, AF, inputOf([-10, 990, 124, 2, true])), '12');
  assert.equal(eq.takeoffByMass[2].m.overObstacle, AF.runways.find((x) => x.id === '12').takeoffAvailable.value);
  assert.deepEqual([eq.takeoffByMass[2].possible, eq.takeoffLimit.state, eq.takeoffLimit.maxKg], [true, 'limit', 1111]);
});

/* ── Eingabe: parseMass ────────────────────────────────────── */

test('parseMass: Leerzeichen und Apostrophe weg, ganze kg, halbes Höchstgewicht bis Höchstgewicht, Fehlertexte wörtlich', () => {
  const NB = ' ';
  const over = (kg, max) => kgTxt(kg) + NB + 'kg liegt über dem maximalen Abfluggewicht von ' + kgTxt(max) + NB + 'kg – keine Berechnung.';
  const low = (kg, min) => kgTxt(kg) + NB + 'kg ist unplausibel tief (unter ' + kgTxt(min) + NB + 'kg) – keine Berechnung.';
  const EMPTY = 'Bitte das Abfluggewicht in kg eingeben.', NOT_INT = 'Bitte eine ganze Zahl in kg eingeben, zum Beispiel 1050.';
  const cases = [
    ['', null, EMPTY], ['   ', null, EMPTY], ["'", null, EMPTY], [null, null, EMPTY], [undefined, null, EMPTY],
    ['1050', 1050, null], [" 1'050 ", 1050, null], ['1’050', 1050, null], ['1 050', 1050, null], ['1 050', 1050, null], ['01050', 1050, null],
    ['1050,5', null, NOT_INT], ['1050.5', null, NOT_INT], ['1050 kg', null, NOT_INT], ['abc', null, NOT_INT], ['-1050', null, NOT_INT],
    ['1e3', null, NOT_INT], ['+1050', null, NOT_INT], ['１０５０', null, NOT_INT],
    // bis sechs Ziffern (so viele lässt das Feld zu, maxlength 6) sind eine Zahl (VERSION 6, N2), sieben nicht
    ['123456', null, over(123456, 1157)], ['999999', null, over(999999, 1157)], ["123'456", null, over(123456, 1157)], ['001157', 1157, null],
    ['000578', null, low(578, 579)], ['1234567', null, NOT_INT], ['0001157', null, NOT_INT],
    ['1157', 1157, null], ['1158', null, over(1158, 1157)], ['1200', null, over(1200, 1157)], ['99999', null, over(99999, 1157)],
    ['579', 579, null], ['578', null, low(578, 579)], ['115', null, low(115, 579)], ['0', null, low(0, 579)]
  ];
  cases.forEach(([s, kg, err]) => assert.deepEqual(ui.parseMass(s, C172D), { kg, error: err }, JSON.stringify(s)));
  assert.equal(ui.parseMass(1050, C172D).kg, 1050, 'Zahl statt Text');
  // So viele Ziffern, wie das Feld zulässt, ergeben eine Zahl und damit den Text zur Obergrenze
  const ml = Number(/ maxlength="(\d+)"/.exec(parts(wxPfa()).mass)[1]);
  assert.equal(ml, 6);
  assert.deepEqual(ui.parseMass('9'.repeat(ml), C172D), { kg: null, error: over(Number('9'.repeat(ml)), 1157) });
  assert.deepEqual(ui.parseMass('9'.repeat(ml + 1), C172D), { kg: null, error: NOT_INT });
  // Tecnam: 580 bis 1'160 kg (halbes Höchstgewicht aufgerundet)
  assert.deepEqual([ui.parseMass('1160', P2010), ui.parseMass('580', P2010)], [{ kg: 1160, error: null }, { kg: 580, error: null }]);
  assert.deepEqual(ui.parseMass('1161', P2010), { kg: null, error: over(1161, 1160) });
  assert.deepEqual(ui.parseMass('579', P2010), { kg: null, error: low(579, 580) });
  // Fehlertexte reiner Text (kein HTML), mit geschütztem Leerzeichen vor «kg»
  [EMPTY, NOT_INT].forEach((s) => assert.ok(!/[<>&]/.test(s)));
  assert.ok(!/[<>&]/.test(over(1200, 1157)) && over(1200, 1157).includes('1\'200' + NB + 'kg'));
  assert.deepEqual([ui.TEXT.massEmpty, ui.TEXT.massNotInt], [EMPTY, NOT_INT]);
});

test('massIncomplete: «noch am Tippen» heisst leer oder nur Ziffern unter der Untergrenze (Weitertippen kann es gültig machen)', () => {
  const yes = ['', '  ', "'", null, '0', '00', '1', '11', '115', '578', "1'1", '1’1', ' 57 ', '000578'];
  const no = ['579', '1000', "1'157", '1157', '1158', '1200', '99999', '123456', '1234567', '1.5', '-1', '1e1', '1a', '1050,5', '1050 kg', '+1', '１'];
  yes.forEach((s) => assert.equal(ui.massIncomplete(s, C172D), true, JSON.stringify(s)));
  no.forEach((s) => assert.equal(ui.massIncomplete(s, C172D), false, JSON.stringify(s)));
  assert.deepEqual(['579', '580'].map((s) => ui.massIncomplete(s, P2010)), [true, false], 'Tecnam: Untergrenze 580 kg');
  // Was als «noch am Tippen» gilt, wäre übernommen nie ein gültiges Gewicht (leer oder unter der Untergrenze)
  yes.forEach((s) => assert.equal(ui.parseMass(s, C172D).kg, null, JSON.stringify(s)));
  // und alles mit gültigem Gewicht ist nicht «am Tippen»
  ['579', '1000', '1111', '1157', " 1'100 "].forEach((s) => assert.ok(ui.parseMass(s, C172D).kg !== null && !ui.massIncomplete(s, C172D), s));
});

/* ── Anzeige ───────────────────────────────────────────────── */

test('Anzeige: Gewichtsfeld hängt nur am Muster, nie an Eingabe, Fehler oder Zustand; Cessna 152 ohne Feld', () => {
  const texts = [undefined, null, '', '1050', " 1'100 ", '115', 'abc', '1157', '99999'];
  const states = [wxPfa(), wxPfa({ windDir: null, windKt: 0, tempC: 20, qnhHpa: 1013.25 }), undefined, wxPfa({ windDir: null, windKt: 6 }), wxPfa({ tempC: 45 })];
  [C172D, P2010, C152].forEach((ac) => {
    const seen = new Set();
    texts.forEach((mt) => states.forEach((w) => [false, true].forEach((pending) => {
      const p = parts(w, { aircraft: ac, massText: mt, fgzoPending: pending });
      seen.add(p.mass);
    })));
    assert.equal(seen.size, 1, ac.id + ': ' + [...seen].join(' || '));
    const mass = [...seen][0];
    assert.ok(!/ value=/.test(mass), ac.id + ': value im HTML');
    assertClean(mass, ac.id);
  });
  const c = parts(wxPfa()).mass, t = parts(wxPfa(), { aircraft: P2010 }).mass;
  assert.ok(c.includes('<input id="perf-mass-in" class="perf-mass-in" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" ' +
    'aria-describedby="perf-mass-hint perf-mass-err">'), c);
  assert.ok(c.includes('<label class="perf-mass-label" for="perf-mass-in">Abfluggewicht in kg</label>'), c);
  assert.ok(c.includes('<div class="perf-mass-hint" id="perf-mass-hint">höchstens 1\'157&nbsp;kg · gerechnet wird mit der AFM-Tabelle für das ' +
    'nächsthöhere Gewicht (1\'157, 1\'134 oder 1\'111&nbsp;kg)</div><div class="perf-mass-err" id="perf-mass-err" role="alert"></div></div>'), c);
  assert.ok(t.includes('höchstens 1\'160&nbsp;kg · gerechnet wird mit der AFM-Tabelle für das nächsthöhere Gewicht (1\'160, 1\'060 oder 960&nbsp;kg)'), t);
  // Cessna 152: kein Feld, nur der Satz; eine Eingabe ändert nichts (es gibt kein Feld, das sie liefern könnte)
  const k = parts(wxPfa(), { aircraft: C152 });
  assert.ok(!k.mass.includes('<input') && k.mass.endsWith('<div class="perf-mass-one">Abfluggewicht: 758&nbsp;kg – das AFM hat nur diese Starttabelle.</div>'), k.mass);
  const k2 = parts(wxPfa(), { aircraft: C152, massText: '600' });
  assert.deepEqual([k2.body, k2.teaser, k2.massError], [k.body, k.teaser, null]);
  // Ohne geladenes Muster (Laden, Fehler, Rechenfehler) kein Feld
  assert.ok(!parts(wxPfa(), { dataState: 'loading', aircraft: null, selectedId: 'c172d' }).mass.includes('perf-mass'));
  assert.ok(!parts(wxPfa(), { dataState: 'error', aircraft: null }).mass.includes('perf-mass'));
  const v = core.VERSION;
  try { core.VERSION = v + 1; assert.equal(parts(wxPfa()).mass, ''); } finally { core.VERSION = v; }
});

test('Anzeige: Kopfzeile in drei Formen, Eintrag «Eingaben», Quelle der gewählten Starttabelle im Rechenweg', () => {
  const head = (p) => /<div class="perf-head">(.*?)<\/div>/.exec(p.body)[1];
  const TAIL_C = ' · Kurzstart- und Kurzlandetechnik · Motor TAE 125-02-114, Propeller MTV-6-A/190-69';
  // ohne Eingabe und mit Eingabe = Höchstgewicht: wie bisher
  [undefined, null, '1157', " 1'157 "].forEach((mt) => {
    assert.equal(head(parts(wxPfa(), { massText: mt })), 'Maximales Abfluggewicht 1\'157&nbsp;kg (2\'550&nbsp;lb)' + TAIL_C, String(mt));
  });
  // tieferes Gewicht: Start mit der Tabelle des nächsthöheren Gewichts, Landung mit dem maximalen Landegewicht
  assert.equal(head(parts(wxPfa(), { massText: '1140' })), 'Abfluggewicht 1\'140&nbsp;kg: Start nach der AFM-Tabelle für 1\'157&nbsp;kg, ' +
    'Landung mit dem maximalen Landegewicht 1\'157&nbsp;kg' + TAIL_C);
  assert.equal(head(parts(wxPfa(), { massText: '1120' })), 'Abfluggewicht 1\'120&nbsp;kg: Start nach der AFM-Tabelle für 1\'134&nbsp;kg, ' +
    'Landung mit dem maximalen Landegewicht 1\'157&nbsp;kg' + TAIL_C);
  assert.equal(head(parts(wxPfa(), { massText: '1111' })), 'Abfluggewicht 1\'111&nbsp;kg: Start nach der AFM-Tabelle für 1\'111&nbsp;kg, ' +
    'Landung mit dem maximalen Landegewicht 1\'157&nbsp;kg' + TAIL_C);
  // unter der kleinsten Tabelle
  assert.ok(head(parts(wxPfa(), { aircraft: P2010, massText: '900' })).startsWith('Abfluggewicht 900&nbsp;kg: Start nach der kleinsten AFM-Tabelle (960&nbsp;kg), ' +
    'Landung mit dem maximalen Landegewicht 1\'160&nbsp;kg · Klappen T/O'));
  assert.ok(head(parts(wxPfa(), { massText: '1050' })).startsWith('Abfluggewicht 1\'050&nbsp;kg: Start nach der kleinsten AFM-Tabelle (1\'111&nbsp;kg), '));
  // Der Kopf steht auch ohne Rechnung (keine Messwerte): mit Eingabe ohne Zahlen der Rechnung
  assert.ok(head(parts(undefined, { massText: '1120' })).startsWith('Abfluggewicht 1\'120&nbsp;kg: Start nach der AFM-Tabelle für 1\'134&nbsp;kg'));
  // Eingaben im Rechenweg: zuerst Gewicht und Starttabelle
  const inputs = (p) => text(/<p><span class="perf-calc-h">Eingaben:<\/span> (.*?)<\/p>/.exec(p.body)[1]).split(' · ')[0];
  assert.equal(inputs(parts(wxPfa())), "Gewicht 1'157 kg (maximales Abfluggewicht)");
  assert.equal(inputs(parts(wxPfa(), { massText: '1157' })), "Gewicht 1'157 kg (maximales Abfluggewicht)");
  assert.equal(inputs(parts(wxPfa(), { massText: '1100' })), "Gewicht 1'100 kg, Starttabelle 1'111 kg");
  assert.equal(inputs(parts(wxPfa(), { aircraft: P2010, massText: '1000' })), "Gewicht 1'000 kg, Starttabelle 1'060 kg");
  assert.equal(inputs(parts(wxPfa(), { aircraft: C152 })), 'Gewicht 758 kg (einzige Starttabelle)');
  // Quelle der gewählten Starttabelle, Landung mit dem maximalen Landegewicht; Tabellenwerte aus der Abschrift (K2: 2'000 ft / 20 °C)
  // Unter dem Kopf der Phase zuerst die Legende (VERSION 8), dann der Ausschnitt mit der abgelesenen Zelle (alte Ableseregel:
  // nächsthöherer Tabellenwert, also eine Zelle)
  const src = (p, ph) => text(new RegExp('<th colspan="3" scope="rowgroup">' + ph + ' <span class="perf-steps-src">(.*?)</span>').exec(p.body)[1]).trim();
  const firstRow = (p) => text(/<tr class="perf-steps-ph">.*?<\/tr>(<tr>.*?<\/tr>)/.exec(p.body)[1]).trim();
  const cellGrid = (c) => " ‖ [20 °C] ‖ [2'000 ft]: *" + ui.fmtExact(c[0]) + '/' + ui.fmtExact(c[1]) + '*';
  let p = parts(wxPfa(), { massText: '1120' });
  assert.equal(src(p, 'Start'), "· Supplement, Figure 5-1c (Section 5b), Seite 5b-6 · Tabelle 1'134 kg");
  assert.equal(src(p, 'Landung'), "· Grundhandbuch, Figure 5-11, Seite 5-24 · maximales Landegewicht 1'157 kg");
  const c1134 = colsToCells(FX.c1134.mColumns, T7)[2][3];
  assert.equal(firstRow(p), legend('m'));
  assert.equal(afmGrids(p.body)[0], cellGrid(c1134));
  assert.ok(text(p.body).includes('Tabellenwert ' + c1134[0] + ' m ' + c1134[1] + ' m'), text(p.body));
  p = parts(wxPfa(), { massText: '700' });
  assert.equal(src(p, 'Start'), "· Supplement, Figure 5-1e (Section 5b), Seite 5b-9 · Tabelle 1'111 kg");
  const c1111 = colsToCells(FX.c1111.mColumns, T7)[2][3];
  assert.equal(afmGrids(p.body)[0], cellGrid(c1111));
  p = parts(wxPfa(), { aircraft: P2010, massText: '1000' });
  assert.equal(src(p, 'Start'), "· AFM, Section 5, Ziffer 7, Seite APV5-9 · Tabelle 1'060 kg");
  assert.equal(src(p, 'Landung'), "· AFM, Section 5, Ziffer 11, Seite APV5-17 · maximales Landegewicht 1'160 kg");
  p = parts(wxPfa(), { aircraft: P2010, massText: '900' });
  assert.equal(src(p, 'Start'), "· AFM, Section 5, Ziffer 7, Seite APV5-10 · Tabelle 960 kg");
  // Cessna 152: Quelle ohne Zusatz
  p = parts(wxPfa(), { aircraft: C152 });
  assert.equal(src(p, 'Start'), '· Handbuch, Figure 5-4, Seite 5-11');
  assert.equal(src(p, 'Landung'), '· Handbuch, Figure 5-10, Seite 5-19');
});

test('Anzeige: Zeile «Start möglich bis …» je Zustand wörtlich, in der Farbe der Feststellung; keine Zeile bei möglich und ohne Wert', () => {
  const lines = (p, rid) => blocksOf(p.body)[rid].findings;
  const CALM = (o) => wxPfa(Object.assign({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }, o));
  // limit (K8 Tecnam, Sollzeile des Planers: 1'060 kg möglich), amber; mit Eingabe X = Eingabe
  assert.deepEqual(lines(parts(wxPfa(), { aircraft: P2010 }), '30'), [
    ['perf-amber', 'Start: Strecke über 15 m länger als die verfügbare Länge.'],
    ['perf-amber', "Start mit 1'160 kg laut AFM nicht möglich, möglich bis 1'060 kg."],
    ['perf-amber', 'Landung: Strecke über 15 m länger als die verfügbare Länge.']]);
  assert.equal(lines(parts(wxPfa(), { aircraft: P2010, massText: '1100' }), '30')[1][1], "Start mit 1'100 kg laut AFM nicht möglich, möglich bis 1'060 kg.");
  // mit der Tabelle 1'060 kg möglich: keine Zeile
  assert.deepEqual(lines(parts(wxPfa(), { aircraft: P2010, massText: '1060' }), '30').map((x) => x[1]), ['Landung: Strecke über 15 m länger als die verfügbare Länge.']);
  // none, rot (Tecnam windstill 25 °C, Piste 12) und limit auf Piste 30 (Sollzeile T1)
  const t1 = GEWICHT.find((g) => g[0] === 'T1' && g[4] === null)[6];
  assert.deepEqual([t1['12'][1], t1['30'][1], t1['30'][2]], ['none', 'limit', 960]);
  const pT1 = parts(CALM({ tempC: 25 }), { aircraft: P2010 });
  assert.deepEqual(lines(pT1, '12').slice(0, 2), [['perf-red', 'Start: Rollstrecke länger als die verfügbare Länge.'], ['perf-red', 'Start laut AFM auch mit 960 kg nicht möglich.']]);
  assert.deepEqual(lines(pT1, '30').slice(0, 2), [['perf-amber', 'Start: Strecke über 15 m länger als die verfügbare Länge.'],
    ['perf-amber', "Start mit 1'160 kg laut AFM nicht möglich, möglich bis 960 kg."]]);
  // VERSION 6 (N7): Cessna auf nassem Gras (K5n, Sollzeile des Planers) – «möglich bis» beruht auf dem Mindestzuschlag des
  // AFM («mindestens +20 %»); trocken (K5) und Tecnam (Faktor immer, ohne «mindestens», oben K8 und T1) ohne Zusatz
  const k5n = GEWICHT.find((g) => g[0] === 'K5n' && g[4] === null)[6];
  assert.deepEqual([k5n['30'][1], k5n['30'][2], k5n['12'][1]], ['limit', 1134, 'none']);
  const pK5n = parts(CALM({ rain1hMm: 0.4 }));
  assert.deepEqual(lines(pK5n, '30').slice(0, 2), [['perf-amber', 'Start: Strecke über 15 m länger als die verfügbare Länge.'],
    ['perf-amber', "Start mit 1'157 kg laut AFM nicht möglich, möglich bis 1'134 kg (mit Mindestzuschlag)."]]);
  assert.ok(pK5n.body.includes('möglich bis 1\'134&nbsp;kg (mit Mindestzuschlag).</div>'), 'HTML der Zeile');
  assert.equal(lines(pK5n, '12')[1][1], "Start laut AFM auch mit 1'111 kg nicht möglich.");
  assert.equal(lines(parts(CALM({ rain1hMm: 0.4 }), { massText: '1150' }), '30')[1][1],
    "Start mit 1'150 kg laut AFM nicht möglich, möglich bis 1'134 kg (mit Mindestzuschlag).");
  assert.equal(lines(parts(wxPfa({ tempC: -10, qnhHpa: 990, windDir: 124, windKt: 2, rain1hMm: 0.4 })), '12')[1][1],
    "Start mit 1'157 kg laut AFM nicht möglich, möglich bis 1'111 kg (mit Mindestzuschlag).");
  assert.deepEqual(lines(parts(CALM()), '12').slice(0, 2), [['perf-amber', 'Start: Strecke über 15 m länger als die verfügbare Länge.'],
    ['perf-amber', "Start mit 1'157 kg laut AFM nicht möglich, möglich bis 1'134 kg."]]);
  assert.equal(ui.TEXT.limitMinimum, 'mit Mindestzuschlag');
  assert.ok(!parts(CALM()).body.includes('Mindestzuschlag') && !parts(wxPfa(), { aircraft: P2010 }).body.includes('Mindestzuschlag'));
  // Massgebend ist minimum: true eines eingerechneten Faktors, nicht Nässe oder Belag (Daten verändert)
  const cNoMin = clone(C172D), tMin = clone(P2010);
  cNoMin.charts.takeoff.corrections.forEach((c) => { if (c.kind === 'factor') c.minimum = false; });
  tMin.charts.takeoff.corrections.forEach((c) => { if (c.kind === 'factor') c.minimum = true; });
  assert.equal(lines(parts(CALM({ rain1hMm: 0.4 }), { aircraft: cNoMin }), '30')[1][1], "Start mit 1'157 kg laut AFM nicht möglich, möglich bis 1'134 kg.");
  assert.equal(lines(parts(wxPfa(), { aircraft: tMin }), '30')[1][1], "Start mit 1'160 kg laut AFM nicht möglich, möglich bis 1'060 kg (mit Mindestzuschlag).");
  // Zwei eingerechnete Faktoren, nur einer mit minimum: true (Befund B3 der Prüfung von VERSION 6): Zusatz trotzdem
  const cTwo = clone(C172D);
  cTwo.charts.takeoff.corrections.push({ kind: 'factor', when: 'always', factor: 1.05, minimum: false, labelDe: 'Probefaktor', refDe: 'Test' });
  const twoLine = lines(parts(CALM({ rain1hMm: 0.4 }), { aircraft: cTwo }), '30')[1][1];
  assert.match(twoLine, /^Start mit 1'157 kg laut AFM nicht möglich, möglich bis 1'1\d\d kg \(mit Mindestzuschlag\)\.$/, twoLine);
  assert.ok(!parts(CALM(), { aircraft: cTwo }).body.includes('Mindestzuschlag'), 'trocken: nur der Faktor ohne minimum');
  // lowest: Cessna mit 1'100 kg (kleinste Tabelle), nass, −10 °C, Piste 12; Cessna 152 ohne Eingabe (eine Tabelle)
  const wetCold = CALM({ tempC: -10, qnhHpa: 990, rain1hMm: 0.4 });
  assert.deepEqual(lines(parts(wetCold, { massText: '1100' }), '12')[1], ['perf-amber', "Start mit 1'100 kg laut AFM nicht möglich. " + TXT.lowest]);
  assert.deepEqual(lines(parts(wetCold), '12')[1], ['perf-amber', "Start laut AFM auch mit 1'111 kg nicht möglich."]);
  const c152 = GEWICHT.find((g) => g[1] === 'c152' && g[4] === null && Object.values(g[6]).some((x) => x[1] === 'lowest'));
  const rC = Object.keys(c152[6]).find((k) => c152[6][k][1] === 'lowest');
  assert.deepEqual(lines(parts(wxOf(c152[3]), { aircraft: C152, airfield: fieldOf(c152[2]) }), rC).map((x) => x[1])
    .filter((x) => x.includes('laut AFM')), ['Start mit 758 kg laut AFM nicht möglich. ' + TXT.lowest]);
  // wet-unknown: Tecnam nass, −10 °C, windstill – nie «möglich bis»
  const pWet = parts(wetCold, { aircraft: P2010 });
  assert.deepEqual(lines(pWet, '12')[1], ['perf-amber', "Start mit 1'160 kg laut AFM nicht möglich. " + TXT.wet]);
  assert.ok(!pWet.body.includes('möglich bis') && !pWet.teaser.includes('möglich'), 'möglich bis bei nasser Piste ohne AFM-Wert');
  // unknown: leichtere Tabellen mit und ohne Wert, nur ohne Wert
  const pMix = parts(wxPfa({ tempC: 15, qnhHpa: 1013.25, windDir: 124, windKt: 13 }), { aircraft: P2010 });
  assert.deepEqual(lines(pMix, '12')[1], ['perf-amber', "Start mit 1'160 kg laut AFM nicht möglich, auch nicht mit 1'060 kg. Für 960 kg gibt es keinen Wert."]);
  const pNov = parts(wxPfa({ tempC: -10, qnhHpa: 990, windDir: 124, windKt: 15 }), { aircraft: P2010 });
  assert.deepEqual(lines(pNov, '12')[1], ['perf-amber', "Start mit 1'160 kg laut AFM nicht möglich. " + TXT.noValue]);
  assert.deepEqual(lines(parts(wxPfa({ tempC: 15, qnhHpa: 1013.25, windDir: 124, windKt: 13 }), { aircraft: P2010, massText: '1000' }), '12')[1],
    ['perf-amber', "Start mit 1'000 kg laut AFM nicht möglich. " + TXT.noValue]);
  // no-value (Tecnam 950 kg bei 13 kt Gegenwind: kein Wert mit der Tabelle 960 kg): keine Zeile, auch wenn schwerere Tabellen möglich wären
  const pNo = parts(wxPfa({ tempC: -10, qnhHpa: 990, windDir: 124, windKt: 13 }), { aircraft: P2010, massText: '950' });
  assert.ok(!text(pNo.body).includes('laut AFM nicht möglich') && !pNo.body.includes('möglich bis'), text(pNo.body));
  assert.ok(lines(pNo, '12')[0][0] === 'perf-nov', 'kein Wert');
  // possible: keine Zeile (K2)
  assert.ok(!text(parts(wxPfa()).body).includes('laut AFM'));
});

test('Anzeige: Zeile je Starttabelle im Rechenweg nur, wenn der Start auf einer gerechneten Piste nicht möglich ist', () => {
  const notes = (p) => [...p.body.matchAll(/<td class="perf-steps-note" colspan="3">(Über 15 m je Starttabelle: .*?)<\/td>/g)].map((m) => text(m[1]).trim());
  // K8 Tecnam: Strecken je Tabelle aus der Sollzeile des Planers
  const k8 = GEWICHT.find((g) => g[0] === 'K8' && g[4] === null)[6]['30'][0];
  assert.deepEqual(notes(parts(wxPfa(), { aircraft: P2010 })), ["Über 15 m je Starttabelle: 1'160 kg " + kgTxt(k8[0][1]) + ' m · 1\'060 kg ' + k8[1][1] + ' m · 960 kg ' + k8[2][1] + ' m']);
  // möglich: keine Zeile (K2), ebenso bei der Cessna 152 (eine Tabelle)
  assert.deepEqual(notes(parts(wxPfa())), []);
  const c152 = GEWICHT.find((g) => g[1] === 'c152' && g[4] === null && Object.values(g[6]).some((x) => x[1] === 'lowest'));
  assert.deepEqual(notes(parts(wxOf(c152[3]), { aircraft: C152, airfield: fieldOf(c152[2]) })), []);
  // ohne Wert für eine Tabelle: «kein Wert»
  const nov = notes(parts(wxPfa({ tempC: 15, qnhHpa: 1013.25, windDir: 124, windKt: 13 }), { aircraft: P2010 }));
  assert.equal(nov.length, 1);
  assert.ok(nov[0].endsWith(' · 960 kg kein Wert'), nov[0]);
});

test('Anzeige: ungültiges Gewicht – keine Zahl in Karte und Kurzzeile, Fehlertext am Feld und in der Karte', () => {
  ['115', '', 'abc', '1200', '123456', '1050,5', '1050 kg', '  '].forEach((mt) => {
    [wxPfa(), wxPfa({ windDir: null, windKt: 0 })].forEach((w) => {
      const p = parts(w, { massText: mt });
      const err = ui.parseMass(mt, C172D).error;
      assert.equal(p.kind, 'mass-error', JSON.stringify(mt));
      assert.equal(p.massError, err);
      assert.ok(p.body.includes('<div class="perf-state" role="status">' + err.replace(/'/g, '&#39;') + '</div>'), p.body);
      assert.ok(!/\d&nbsp;m\b|\d m\b/.test(p.body.replace(/<[^>]+>/g, ' ')) && !p.body.includes('perf-grid') && !p.body.includes('perf-details'), JSON.stringify(mt) + ': Zahl in der Karte');
      assert.ok(!/&nbsp;m|\bm\b/.test(p.teaser.replace(/<[^>]+>/g, ' ')) && !p.teaser.includes('perf-t-row'), JSON.stringify(mt) + ': Zahl in der Kurzzeile');
      assert.equal(text(p.teaser).trim(), 'Start- und Landestrecke · Cessna 172 JT-A G1000 ' + ui.TEASER.massError);
      assert.ok(p.body.includes('<div class="perf-head">Maximales Abfluggewicht'), 'Kopf ohne gültiges Gewicht');
    });
  });
  // Der Fehler am Feld steht in jedem Zustand mit geladenem Muster, ohne Messwerte gilt der Zustand der Messwerte
  const noWx = parts(undefined, { massText: '115' });
  assert.deepEqual([noWx.kind, noWx.massError], ['no-wx', ui.parseMass('115', C172D).error]);
  const pending = parts(wxPfa(), { massText: '115', fgzoPending: true });
  assert.deepEqual([pending.kind, pending.massError], ['fgzo-pending', ui.parseMass('115', C172D).error]);
  // Rückfallebene des Kerns (above-mass) in Karte und Kurzzeile (VERSION 6, N6): Das Feld lässt kein Gewicht über dem
  // Höchstgewicht zu, darum liefert hier ein ersetztes core.compute den Fehler. Eigener Text ohne Zahl der Rechnung;
  // fehlen die Zahlen im Fehler, steht «Rechenfehler» (nie «undefined»), die Kurzzeile bleibt beim Gewichtstext.
  const res = core.compute(C172D, AF, inputOf([15, 1018, 290, 8, false], 1200));
  assert.deepEqual(res.error, { code: 'above-mass', massKg: 1200, maxKg: 1157 });
  const orig = core.compute;
  try {
    const seen = [];
    core.compute = (ac, af, input) => { seen.push(input.massKg); return res; };
    const p = parts(wxPfa(), { massText: '1100' });
    assert.deepEqual([p.kind, seen], ['calc-error', [1100]]);
    assert.ok(p.body.includes('<div class="perf-state" role="status">1\'200&nbsp;kg liegt über dem maximalen Abfluggewicht von 1\'157&nbsp;kg – keine Berechnung.</div>'), p.body);
    assert.equal(text(p.teaser).trim(), 'Start- und Landestrecke · Cessna 172 JT-A G1000 ' + ui.TEASER.massError);
    assert.ok(!p.body.includes('perf-grid') && !p.teaser.includes('perf-t-row'), 'Zahlen bei above-mass');
    core.compute = () => ({ ok: false, error: { code: 'above-mass' }, input: res.input });
    const q = parts(wxPfa(), { massText: '1100' });
    assert.ok(q.body.includes('<div class="perf-state" role="status">' + ui.TEXT.internal + '</div>'), q.body);
    assert.equal(text(q.teaser).trim(), 'Start- und Landestrecke · Cessna 172 JT-A G1000 ' + ui.TEASER.massError);
    assertClean(q.body + q.teaser, 'above-mass ohne Zahlen');
  } finally {
    core.compute = orig;
  }
});

test('Gleichlauf Karte und Kurzzeile über alle Sollzeilen des Planers (Zahl, Farbe, Gewicht im Kopf, Zeile «möglich bis»)', () => {
  const stats = { rows: 0, lines: 0, kgHead: 0, red: 0, amber: 0, noValue: 0, minimum: 0 };
  GEWICHT.forEach(([id, acId, field, inp, massKg, , rws]) => {
    const ac = ACS[acId], af = fieldOf(field), tables = SOLL_TABLES[acId];
    const p = parts(wxOf(inp), { aircraft: ac, airfield: af, massText: massKg === null ? undefined : String(massKg) });
    const label = id + ' ' + acId + ' ' + massKg;
    // Cessna 152: kein Feld, gerechnet wird mit dem Höchstgewicht (eine Tabelle)
    const mk = acId === 'c152' ? null : massKg;
    const ti = sollPick(tables, mk);
    if (!Object.keys(rws).length) { assert.notEqual(p.kind, 'result', label); return; }
    assert.equal(p.kind, 'result', label);
    stats.rows++;
    const differs = mk !== null && mk !== ac.mass.kg;
    const T = teaserOf(p.teaser);
    assert.equal(T.head.includes(' · ' + kgTxt(mk) + ' kg'), differs, label + ': Gewicht im Kopf der Kurzzeile');
    assert.equal(p.body.includes('<div class="perf-head">Abfluggewicht ' + kgTxt(mk) + '&nbsp;kg:'), differs, label + ': Kopf der Karte');
    if (differs) stats.kgHead++;
    const B = blocksOf(p.body);
    assert.deepEqual(Object.keys(B).sort(), Object.keys(rws).sort(), label + ': Pistenblöcke');
    let vals = [], red = false, amber = false, nov = false;
    Object.keys(rws).forEach((rid) => {
      const [byTable, state, maxKg] = rws[rid], sel = byTable[ti], b = B[rid];
      if (Array.isArray(sel)) {
        assert.deepEqual(b.start, sel, label + ' ' + rid + ': Start in der Karte');
        vals.push(sel[0]);
        if (sel[0] > b.avail) red = true;
        else if (sel[1] > b.avail) amber = true;
      } else {
        assert.deepEqual(b.start, [null, null], label + ' ' + rid);
        nov = true;
      }
      const minimum = RULES[acId].minimum(inp[4] === true, af.runways.find((x) => x.id === rid).surface === 'grass');
      const want = expectLine(state, mk === null ? ac.mass.kg : mk, maxKg, tables, byTable, ti, minimum);
      const got = b.findings.filter((f) => /laut AFM/.test(f[1]));
      if (want === null) { assert.deepEqual(got, [], label + ' ' + rid + ': keine Zeile'); return; }
      stats.lines++;
      if (state === 'limit' && minimum) stats.minimum++;
      assert.deepEqual(got, [[sel[0] > b.avail ? 'perf-red' : 'perf-amber', want]], label + ' ' + rid + ': Zeile');
      assert.equal(b.findings.indexOf(got[0]), 1, label + ': direkt nach der Feststellung zum Start');
    });
    if (nov) { assert.equal(T.start, null, label + ': «kein Wert»'); stats.noValue++; return; }
    assert.equal(T.start, Math.max(...vals), label + ': Rollstrecke Start in der Kurzzeile');
    assert.equal(T.cls, red ? 'perf-red' : (amber ? 'perf-amber' : null), label + ': Farbe');
    if (red) stats.red++;
    if (amber) stats.amber++;
  });
  Object.keys(stats).forEach((k) => assert.ok(stats[k] > 0, 'nie: ' + k + ' ' + JSON.stringify(stats)));
  assert.ok(stats.rows >= 380 && stats.lines >= 150, JSON.stringify(stats));
});

test('Anzeige: Kurzzeile mit Gewicht im Kopf, ohne «beide Pisten» (Entscheid E3), Gewicht = Höchstgewicht ohne Zusatz', () => {
  const head = (p) => teaserOf(p.teaser).head;
  const CALM = wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 });
  assert.equal(head(parts(wxPfa(), { massText: '1050' })), "Cessna 172 JT-A G1000 · 1'050 kg · Piste 30");
  assert.equal(head(parts(CALM, { massText: '1050' })), "Cessna 172 JT-A G1000 · 1'050 kg · windstill");
  assert.equal(head(parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 }), { massText: '1100' })), "Cessna 172 JT-A G1000 · 1'100 kg · Wind quer");
  assert.equal(head(parts(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }), { aircraft: P2010, massText: '960' })), 'Tecnam P2010 · 960 kg · ohne Windrichtung');
  [undefined, '1157', " 1'157"].forEach((mt) => assert.equal(head(parts(CALM, { massText: mt })), 'Cessna 172 JT-A G1000 · windstill', String(mt)));
  // ohne Ergebnis kein Gewicht im Kopf (keine Zahlen)
  assert.equal(text(parts(undefined, { massText: '1050' }).teaser).trim(), 'Start- und Landestrecke · Cessna 172 JT-A G1000 ' + ui.TEASER.noData);
});

test('Anzeige: Durchlauf mit Gewicht – nie NaN, undefined, null oder Infinity; Texte aus lowerWeights maskiert', () => {
  [C172D, P2010].forEach((ac) => [null, 124, 304].forEach((dir) => [0, 8.7, 22].forEach((kt) => [-15, 10.8, 30].forEach((t) => [0, 0.4].forEach((rain) => {
    ['1100', '1000', '900', '600', String(ac.mass.kg - 1), '115', ''].forEach((mt) => {
      const p = parts(wxPfa({ windDir: dir, windKt: kt, tempC: t, rain1hMm: rain }), { aircraft: ac, massText: mt });
      [p.sel, p.mass, p.body, p.teaser].forEach((h) => assertClean(h, ac.id + ' ' + dir + '/' + kt + '/' + t + ' ' + mt));
    });
  })))));
  // Marke in Titel, Quelle und Bedingungen der weiteren Tabellen: gezeigt wird nur die Quelle der gewählten Tabelle, maskiert
  const MARK = '<img src=x onerror=alert(1)>', ESC = '&lt;img src=x onerror=alert(1)&gt;';
  [[C172D, ['1120', '1100']], [P2010, ['1000', '900']]].forEach(([base, texts]) => {
    const ac = clone(base);
    ac.charts.takeoff.lowerWeights.forEach((e) => {
      e.title = MARK + e.title;
      e.conditionsRefDe = MARK + e.conditionsRefDe;
      e.ref = { figure: MARK + e.ref.figure, page: MARK + e.ref.page };
    });
    assert.equal(core.validateAircraft(ac).ok, true);
    texts.forEach((mt) => {
      const p = parts(wxPfa({ tempC: 25, qnhHpa: 1000, windDir: null, windKt: 0 }), { aircraft: ac, massText: mt });
      const all = p.sel + p.mass + p.body + p.teaser;
      assert.ok(!/<img/i.test(all), base.id + ' ' + mt + ': Marke unmaskiert');
      assert.ok(p.body.includes(ESC + 'Section') || p.body.includes(ESC + 'Figure'), base.id + ' ' + mt + ': Quelle der gewählten Tabelle fehlt');
      assert.ok(!p.body.includes(ESC + 'Ground Roll') && !p.body.includes(ESC + 'Take-Off') && !p.body.includes(ESC + 'Bedingungen'), 'Titel oder Bedingungen angezeigt');
    });
  });
});

test('Anzeige: CSS des Gewichtsfelds – 16 px, 44 px, Rahmen und Fokus wie das Auswahlfeld, Fehler rot, leerer Fehler ausgeblendet', () => {
  const rule = (sel) => {
    const m = new RegExp('\\n' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(ui.CSS);
    return m ? m[1].trim() : null;
  };
  const f = rule('.perf-mass-in');
  ['box-sizing: border-box;', 'min-height: 44px;', 'font-size: 16px;', 'font-weight: 600;', 'max-width: 9rem;', 'font-variant-numeric: tabular-nums;',
    'border: 1px solid var(--accent);', 'border-radius: 8px;', 'color: var(--text);', 'background-color: var(--bg);'].forEach((x) => assert.ok(f.includes(x), 'fehlt: ' + x));
  assert.equal(rule('.perf-mass-in:focus-visible'), rule('.perf-select:focus-visible'));
  assert.equal(rule('.perf-mass-in[aria-invalid="true"]'), 'border-color: #ef4444;');
  assert.equal(rule('.perf-mass-err:empty'), 'display: none;');
  assert.ok(rule('.perf-mass-err').includes('color: #f87171;') && rule('.perf-mass-err').includes('font-weight: 600;'));
  assert.ok(rule('.perf-mass-hint').includes('color: var(--text-muted);') && rule('.perf-mass-hint').includes('font-size: 0.78rem;'));
  // keine @media-Regel überschreibt das Feld (16 px auf allen Breiten: kein Zoom beim Fokus unter iOS)
  assert.ok(!/\n {2}\.perf-mass/.test(ui.CSS), 'eine @media-Regel überschreibt das Gewichtsfeld');
});
