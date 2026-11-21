// Tests der ausgelieferten Ablesung (seit VERSION 7, Wunsch des Benutzers vom 20.11.2026: «immer auf den aktuellen Wert
// interpolieren, auch bei allen anderen Flugzeugen»): Druckhöhe, Temperatur und beim Start das Gewicht linear zwischen
// den AFM-Tabellenwerten, unter dem kleinsten Tabellenwert dieser, darüber kein Wert. Dazu das neue Muster Tecnam
// P2008 JC (HB-KMG, HB-KMH, HB-KMX) nach Supplement S9 (Propeller MTV-34, MTOW 650 kg).
// Die Rechenmechanik (Wind, Belag, Faktoren, Rundung, Nässe, Texte) prüfen die übrigen Testdateien mit der alten
// Ableseregel (tests/helpers/ablesung.js). Hier wird mit den Daten gerechnet, wie sie ausgeliefert werden, und gegen
// eine eigene, vom Kern unabhängige Nachrechnung verglichen.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));
const ui = require(path.join(ROOT, 'perf', 'perf-ui.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const C172D = readJson('perf/aircraft/c172d.json');
const P2010 = readJson('perf/aircraft/p2010.json');
const C152 = readJson('perf/aircraft/c152.json');
const P2008 = readJson('perf/aircraft/p2008.json');
const AF = readJson('perf/airfields/lszk.json');
const LIST = ui.parseIndex(readJson('perf/aircraft/index.json')).list;
const ISA = readJson('tests/fixtures/p2008_isa.json');
const ALL = [C172D, P2010, C152, P2008];
const { alteAblesung, clone } = require('./helpers/ablesung.js');
const { afmTables, withoutAfm } = require('./helpers/afm.js');

/* ── Tecnam P2008 JC: Tabellen, wörtlich ───────────────────────
   Supplement S9 «MTV-34 Propeller for aircraft with MTOW Increment at 650 kg», Section 5 (Seiten MT5, ersetzen den
   Abschnitt 5 des Grundhandbuchs ganz), Werte in m. Am Seitenbild abgelesen am 20.11.2026, gleich der Textebene des PDF
   und gleich den eingebundenen MT5-Seiten im AFM Doc. No. 2008/100 Ed. 2 Rev. 1. Zeilen S.L. bis 10'000 ft, Spalten −25,
   0, 25, 50 °C (die Spalte ISA steht in tests/fixtures/p2008_isa.json). MT5-7, Start 650 kg: */
const P2008_TO650 = [
  [[149, 262], [187, 328], [231, 401], [280, 484]],
  [[162, 285], [204, 356], [252, 437], [306, 526]],
  [[177, 311], [223, 388], [275, 475], [334, 572]],
  [[193, 338], [244, 422], [301, 517], [365, 623]],
  [[211, 368], [266, 460], [328, 564], [398, 679]],
  [[231, 402], [291, 502], [359, 614], [436, 740]],
  [[253, 438], [319, 547], [393, 670], [477, 808]],
  [[277, 478], [349, 597], [430, 732], [522, 882]],
  [[304, 522], [382, 652], [472, 799], [572, 963]],
  [[333, 571], [419, 713], [517, 874], [627, 1053]],
  [[365, 624], [460, 780], [567, 956], [688, 1152]]
];
// MT5-8, Start 600 kg:
const P2008_TO600 = [
  [[123, 218], [155, 272], [191, 333], [231, 402]],
  [[134, 237], [169, 296], [208, 363], [252, 437]],
  [[146, 258], [184, 322], [227, 395], [275, 476]],
  [[160, 281], [201, 351], [248, 430], [301, 518]],
  [[174, 306], [220, 382], [271, 468], [329, 564]],
  [[191, 334], [240, 417], [296, 510], [360, 615]],
  [[209, 364], [263, 455], [324, 557], [394, 671]],
  [[229, 397], [288, 496], [355, 608], [431, 732]],
  [[251, 434], [315, 542], [389, 664], [472, 800]],
  [[275, 474], [346, 592], [427, 726], [518, 875]],
  [[301, 519], [379, 648], [468, 794], [568, 957]]
];
// MT5-9, Start 550 kg:
const P2008_TO550 = [
  [[100, 178], [125, 223], [155, 273], [188, 329]],
  [[109, 194], [137, 242], [169, 297], [205, 357]],
  [[119, 211], [149, 263], [184, 323], [224, 389]],
  [[130, 230], [163, 287], [201, 351], [244, 423]],
  [[142, 250], [178, 313], [220, 383], [267, 461]],
  [[155, 273], [195, 341], [241, 417], [292, 503]],
  [[169, 298], [213, 372], [263, 455], [319, 549]],
  [[186, 325], [234, 406], [288, 497], [350, 599]],
  [[203, 355], [256, 443], [316, 543], [383, 654]],
  [[223, 388], [281, 484], [346, 593], [420, 715]],
  [[245, 424], [308, 530], [380, 649], [461, 782]]
];
// MT5-14, Landung 650 kg:
const P2008_LA650 = [
  [[149, 358], [164, 373], [179, 388], [194, 403]],
  [[154, 363], [170, 379], [186, 395], [201, 410]],
  [[160, 369], [176, 385], [192, 401], [209, 418]],
  [[166, 375], [183, 392], [200, 409], [216, 425]],
  [[172, 381], [190, 399], [207, 416], [225, 434]],
  [[179, 388], [197, 406], [215, 424], [233, 442]],
  [[186, 395], [205, 414], [223, 432], [242, 451]],
  [[193, 402], [212, 421], [232, 441], [251, 460]],
  [[200, 410], [221, 430], [241, 450], [261, 470]],
  [[208, 417], [229, 438], [250, 459], [271, 480]],
  [[217, 426], [238, 447], [260, 469], [282, 491]]
];

function fp(cells, o, cols) {
  let s = 0, w = 0;
  cells.forEach((row, i) => row.forEach((c, j) => { s += c[o]; w += c[o] * (i * cols + j + 1); }));
  return [s, w];
}
function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b); }

/* ── Unabhängige Nachrechnung (ohne perf.js) ───────────────── */

// Druckhöhe wie im AIP-Modell (Standardatmosphäre), für die Tabellen auf ganze ft aufgerundet
function paTableFt(elevFt, qnh) { return Math.ceil(elevFt + 145442.16 * (1 - Math.pow(qnh / 1013.25, 0.190263)) - 1e-9); }

// Lage auf einer Achse: unter dem kleinsten Wert der kleinste, über dem grössten null
function axisPos(vals, v) {
  if (v > vals[vals.length - 1]) return null;
  if (v <= vals[0]) return { i: 0, j: 0, f: 0 };
  for (let k = 1; k < vals.length; k++) if (v <= vals[k]) return { i: k - 1, j: k, f: (v - vals[k - 1]) / (vals[k] - vals[k - 1]) };
  return null;
}
// Bilinear: zuerst die Temperatur in beiden Höhenzeilen, dann die Höhe
function bilinear(table, pa, t) {
  const p = axisPos(table.axes[0].values, pa), q = axisPos(table.axes[1].values, t);
  if (!p || !q) return null;
  const c = (i, j, o) => table.cells[i][j][o];
  return [0, 1].map((o) => {
    const lo = c(p.i, q.i, o) + (c(p.i, q.j, o) - c(p.i, q.i, o)) * q.f;
    const hi = c(p.j, q.i, o) + (c(p.j, q.j, o) - c(p.j, q.i, o)) * q.f;
    return lo + (hi - lo) * p.f;
  });
}
function startTables(ac) {
  return [{ kg: ac.mass.kg, table: ac.charts.takeoff.table }]
    .concat((ac.charts.takeoff.lowerWeights || []).map((e) => ({ kg: e.mass.kg, table: e.table })));
}
// Start: zwischen zwei Tabellengewichten linear, unter der leichtesten Tabelle diese
function takeoffTableValue(ac, pa, t, kg) {
  const tabs = startTables(ac), m = kg === null ? ac.mass.kg : kg;
  if (m >= tabs[0].kg) return bilinear(tabs[0].table, pa, t);
  for (let i = 1; i < tabs.length; i++) {
    if (m >= tabs[i].kg) {
      const a = bilinear(tabs[i].table, pa, t), b = bilinear(tabs[i - 1].table, pa, t);
      if (!a || !b) return null;
      const f = (m - tabs[i].kg) / (tabs[i - 1].kg - tabs[i].kg);
      return [0, 1].map((o) => a[o] + (b[o] - a[o]) * f);
    }
  }
  return bilinear(tabs[tabs.length - 1].table, pa, t);
}
// Ganze kt Gegenwind wie im Kern beschrieben (null: Piste nicht gerechnet)
function headwindKt(inp, bearing) {
  if (inp.windKt < 1) return 0;
  if (inp.windDirTrue === null) return inp.windKt <= 3 ? 0 : null;
  const along = Math.round(Math.cos((inp.windDirTrue - bearing) * Math.PI / 180) * 1e9) / 1e9;
  if (along < 0) return null;
  return Math.max(0, Math.floor(inp.windKt * along + 1e-9));
}
// Eine Phase von der Tabelle bis zu den Metern; Werte in der Tabelleneinheit vor dem Umrechnen
function referencePhase(ac, ph, inp, rwy, kt) {
  const ch = ac.charts[ph];
  const pa = paTableFt(AF.elevation.value, inp.qnhHpa);
  const tab = ph === 'takeoff' ? takeoffTableValue(ac, pa, inp.tempC, inp.massKg === undefined ? null : inp.massKg) : bilinear(ch.table, pa, inp.tempC);
  if (!tab) return null;
  if (kt > 40) return { ok: false, reason: 'headwind-limit', tab };
  let d = tab.slice();
  const hw = ch.corrections.find((c) => c.kind === 'headwind');
  if (kt > 0 && hw) {
    if (hw.type === 'percentPer') {
      const p = Math.floor(Math.abs(hw.percent) * kt / hw.per + 1e-9);
      d = d.map((v) => v * (100 - p) / 100);
    } else {
      const r = Math.floor(Math.abs(hw.amount) * kt / hw.per + 1e-9);
      d = d.map((v) => v - r);
    }
    if (tab[0] - d[0] > 0.5 * tab[0] + 1e-9 || tab[1] - d[1] > 0.5 * tab[1] + 1e-9) return { ok: false, reason: 'wind-credit-limit', tab };
  }
  if (rwy.surface !== ch.base.surface) {
    const s = ch.corrections.find((c) => c.kind === 'surface' && c.surface === rwy.surface);
    if (!s) return { ok: false, reason: 'no-surface-rule', tab };
    d = d.map((v) => v + s.percent * tab[0] / 100);
  }
  ch.corrections.filter((c) => c.kind === 'factor' && (c.when === 'always' || (c.when === 'wet' && inp.runwayWet && rwy.surface === c.surface)))
    .forEach((c) => { d = d.map((v) => v * Math.round(c.factor * 1000) / 1000); });
  const unit = ch.table.outputs[0].unit;
  const meters = d.map((v) => (unit === 'ft' ? v * 0.3048 : v));
  return { ok: true, tab, final: d, meters, m: meters.map((v) => Math.ceil(v - 1e-9)) };
}
// Aufrunden zweier Rechenwege darf nur dort verschieden ausfallen, wo der Wert fast genau auf einer ganzen Zahl liegt
function sameCeil(a, b, x, msg) {
  if (Math.abs(x - Math.round(x)) < 1e-6) assert.ok(Math.abs(a - b) <= 1, msg);
  else assert.equal(a, b, msg);
}

function wx(tempC, qnhHpa, windDirTrue, windKt, runwayWet, massKg) {
  const o = { tempC, qnhHpa, windDirTrue, windKt, runwayWet: runwayWet === true };
  if (massKg !== undefined) o.massKg = massKg;
  return o;
}
function run(ac, input, af) {
  const r = core.compute(ac, af || AF, input);
  assert.equal(r.ok, true, 'Rechnung ok erwartet: ' + JSON.stringify(r.error));
  return r;
}
const rwy = (res, id) => res.runways.find((r) => r.id === id);
const meters = (p) => [p.m.groundRoll, p.m.overObstacle];
function field(elevFt) {
  return Object.assign(clone(AF), { elevation: { value: elevFt, unit: 'ft' } });
}

/* ── Daten Tecnam P2008JC ────────────────────────────────────── */

test('P2008 Daten: alle Tabellenwerte wörtlich (4 × 88), Fingerabdrücke', () => {
  assert.deepEqual(P2008.charts.takeoff.table.cells, P2008_TO650);
  assert.deepEqual(P2008.charts.takeoff.lowerWeights.map((e) => e.table.cells), [P2008_TO600, P2008_TO550]);
  assert.deepEqual(P2008.charts.landing.table.cells, P2008_LA650);
  assert.deepEqual([fp(P2008_TO650, 0, 4), fp(P2008_TO650, 1, 4)], [[15129, 397938], [25865, 677046]]);
  assert.deepEqual([fp(P2008_TO600, 0, 4), fp(P2008_TO600, 1, 4)], [[12488, 328445], [21490, 562504]]);
  assert.deepEqual([fp(P2008_TO550, 0, 4), fp(P2008_TO550, 1, 4)], [[10136, 266572], [17572, 459905]]);
  assert.deepEqual([fp(P2008_LA650, 0, 4), fp(P2008_LA650, 1, 4)], [[9139, 220265], [18336, 427208]]);
});

test('P2008 Daten: Plausibilität – monoton, Landung überall 209 m Luftstrecke, leichtere Tabelle nie länger, ISA-Spalte', () => {
  const tabs = [P2008_TO650, P2008_TO600, P2008_TO550, P2008_LA650];
  tabs.forEach((c, t) => c.forEach((row, i) => row.forEach((cell, j) => {
    [0, 1].forEach((o) => {
      if (i > 0) assert.ok(cell[o] > c[i - 1][j][o], 'Höhe ' + t + ' ' + i + '/' + j);
      if (j > 0) assert.ok(cell[o] > row[j - 1][o], 'Temperatur ' + t + ' ' + i + '/' + j);
    });
    assert.ok(cell[1] > cell[0]);
  })));
  // Landung: Strecke über 15 m minus Rollstrecke ist in jeder Zelle 209 m, nur bei 8'000 ft / −25 °C druckt das AFM
  // 200/410 m (210 m, Rundung; am Seitenbild bestätigt). Eine verlesene Zahl fiele so auf.
  P2008_LA650.forEach((row, i) => row.forEach((c, j) => assert.equal(c[1] - c[0], i === 8 && j === 0 ? 210 : 209, i + '/' + j)));
  // Start: 600 kg nie länger als 650 kg, 550 kg nie länger als 600 kg (Zelle für Zelle)
  [[P2008_TO600, P2008_TO650], [P2008_TO550, P2008_TO600]].forEach(([lo, hi]) => lo.forEach((row, i) => row.forEach((c, j) => {
    assert.ok(c[0] < hi[i][j][0] && c[1] < hi[i][j][1], i + '/' + j);
  })));
  // Spalte ISA (am Seitenbild abgelesen) gegen die Interpolation zwischen den Spalten bei ISA-Temperatur:
  // Start −0,5 bis +2,5 m, Landung ±0,5 m; so fiele eine verschobene Spalte oder Zeile auf
  const named = { takeoff650: P2008.charts.takeoff.table, takeoff600: P2008.charts.takeoff.lowerWeights[0].table,
    takeoff550: P2008.charts.takeoff.lowerWeights[1].table, landing650: P2008.charts.landing.table };
  assert.equal(ISA.rows.length, 11);
  ISA.rows.forEach((row, i) => {
    assert.equal(row.pressureAltitudeFt, i * 1000);
    close(row.isaTempC, 15 - 1.98 * i, 1e-9, 'ISA-Temperatur');
    Object.keys(named).forEach((k) => {
      const v = core.lookupTable(named[k], { pressureAltitude: row.pressureAltitudeFt, temperature: row.isaTempC }).values;
      [v.groundRoll - row[k][0], v.overObstacle - row[k][1]].forEach((d) => {
        if (k.startsWith('takeoff')) assert.ok(d >= -0.5 && d <= 2.5, k + ' ' + row.pressureAltitudeFt + ' ft: ' + d);
        else assert.ok(Math.abs(d) <= 0.5, k + ' ' + row.pressureAltitudeFt + ' ft: ' + d);
      });
    });
  });
});

test('P2008 Daten: Gewichte, Quellen, Bedingungen und Korrekturen wie im AFM', () => {
  assert.deepEqual(core.validateAircraft(P2008), { ok: true, errors: [] });
  assert.deepEqual([P2008.id, P2008.label, P2008.schema], ['p2008', 'Tecnam P2008JC', 2]);
  assert.deepEqual(LIST.find((e) => e.id === 'p2008'), { id: 'p2008', label: 'Tecnam P2008JC', file: 'p2008.json', registrations: ['HB-KMG', 'HB-KMH', 'HB-KMX'] });
  // Section 2, Ziffer 14 (S. MT2-12): MTOW = MLW = 650 kg (1433 lb); Starttabellen 650, 600, 550 kg (das AFM nennt dort nur kg)
  assert.deepEqual(P2008.mass, { kg: 650, lb: 1433 });
  assert.deepEqual(P2008.charts.takeoff.lowerWeights.map((e) => [e.mass.kg, e.mass.lb, e.ref.page, e.title]),
    [[600, 1323, 'MT5-8', 'Take-Off Performance, Weight = 600 kg'], [550, 1213, 'MT5-9', 'Take-Off Performance, Weight = 550 kg']]);
  P2008.charts.takeoff.lowerWeights.forEach((e) => assert.ok(Math.abs(e.mass.lb * core.LB_KG - e.mass.kg) < 0.5, 'lb gerundet aus kg'));
  assert.deepEqual([P2008.charts.takeoff.ref, P2008.charts.landing.ref],
    [{ figure: 'Section 5, Ziffer 7', page: 'MT5-7' }, { figure: 'Section 5, Ziffer 11', page: 'MT5-14' }]);
  assert.equal(P2008.charts.takeoff.massRead, 'linear');
  // Die Tabellen gelten für Gras: keine Belagsregel, Hartbelag (−10 % der Rollstrecke) wird nicht gerechnet
  ['takeoff', 'landing'].forEach((ph) => {
    const ch = P2008.charts[ph];
    assert.deepEqual(ch.base, { surface: 'grass', surfaceCondition: 'dry' });
    assert.equal(ch.source, 'afm');
    assert.equal(ch.corrections.filter((c) => c.kind === 'surface').length, 0);
  });
  assert.deepEqual(P2008.charts.takeoff.corrections, [
    { kind: 'headwind', type: 'absolutePer', amount: -5, amountUnit: 'm', per: 1, unit: 'kt' },
    { kind: 'factor', when: 'always', factor: 1.1, minimum: false, labelDe: 'Faktor für Abweichungen im Betrieb', refDe: 'NOTE, MT5-7' }
  ]);
  assert.deepEqual(P2008.charts.landing.corrections, [
    { kind: 'headwind', type: 'absolutePer', amount: -4, amountUnit: 'm', per: 1, unit: 'kt' },
    { kind: 'factor', when: 'always', factor: 1.67, minimum: false, labelDe: 'Faktor für Abweichungen im Betrieb', refDe: 'NOTE, MT5-14' }
  ]);
  assert.ok(!/tailwind/.test(fs.readFileSync(path.join(ROOT, 'perf/aircraft/p2008.json'), 'utf8')), 'keine Rückenwind-Regel');
  assert.equal(P2008.wetNoteDe, undefined, 'das P2008-AFM sagt nichts zu Regen oder nassem Gras');
  const src = P2008.sources.afm;
  assert.deepEqual([src.labelDe, src.number, src.approval], ['AFM', 'Doc. No. 2008/100', 'EASA Type Certificate A.583']);
  ['Ed. 2 – Rev. 1', '12 March 2018', 'Supplement S9', 'MTV-34', '650 kg'].forEach((s) => assert.ok(src.issue.includes(s), s));
  ['HB-KMG', 'HB-KMH', 'HB-KMX', 'S. 9-3'].forEach((s) => assert.ok(src.applicabilityDe.includes(s), s));
  ['Rotax 912 S2', 'MTV-34-1-A/170-202'].forEach((s) => assert.ok(P2008.variantDe.includes(s), s));
  ['50 KIAS', '61 KIAS', 'Graspiste'].forEach((s) => assert.ok(P2008.charts.takeoff.conditionsDe.includes(s), s));
  ['54 KIAS', 'Leerlauf', 'Graspiste'].forEach((s) => assert.ok(P2008.charts.landing.conditionsDe.includes(s), s));
});

/* ── Ablesung linear ───────────────────────────────────────── */

// Pseudozufall mit festem Startwert (wiederholbar)
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function allTables(ac) {
  const out = [['takeoff', ac.mass.kg, ac.charts.takeoff.table], ['landing', ac.mass.kg, ac.charts.landing.table]];
  (ac.charts.takeoff.lowerWeights || []).forEach((e) => out.push(['takeoff', e.mass.kg, e.table]));
  return out;
}

test('Ablesung linear: Tabellenpunkte genau, dazwischen bilinear (eigene Formel), Ecken geordnet, Klemmen und Obergrenze', () => {
  const rnd = rng(20261120);
  let n = 0;
  ALL.forEach((ac) => allTables(ac).forEach(([ph, kg, t]) => {
    const pas = t.axes[0].values, ts = t.axes[1].values;
    const at = (pa, temp) => core.lookupTable(t, { pressureAltitude: pa, temperature: temp });
    // genau auf einem Tabellenpunkt: dieser Wert, keine Interpolation, eine Ecke
    pas.forEach((pa, i) => ts.forEach((temp, j) => {
      const lk = at(pa, temp);
      assert.equal(lk.interpolated, false);
      assert.deepEqual(lk.values, { groundRoll: t.cells[i][j][0], overObstacle: t.cells[i][j][1] });
      assert.deepEqual(lk.corners.map((c) => c.indices), [[i, j]]);
    }));
    // zufällig im Tabellenbereich: wie die eigene Formel, Ecken = Tabellenzellen in der Reihenfolge unten/oben
    for (let k = 0; k < 300; k++) {
      const pa = Math.round(pas[0] + rnd() * (pas[pas.length - 1] - pas[0])), temp = Math.round((ts[0] + rnd() * (ts[ts.length - 1] - ts[0])) * 10) / 10;
      const lk = at(pa, temp), ref = bilinear(t, pa, temp);
      close(lk.values.groundRoll, ref[0], 1e-9, ac.id + ' ' + ph + ' ' + kg + ' ' + pa + '/' + temp);
      close(lk.values.overObstacle, ref[1], 1e-9, ac.id + ' ' + ph + ' ' + kg + ' ' + pa + '/' + temp);
      const nInterp = lk.axes.filter((a) => a.interpolated).length;
      assert.equal(lk.corners.length, Math.pow(2, nInterp));
      lk.corners.forEach((c) => {
        assert.deepEqual(c.axisValues, [pas[c.indices[0]], ts[c.indices[1]]]);
        assert.deepEqual(c.values, { groundRoll: t.cells[c.indices[0]][c.indices[1]][0], overObstacle: t.cells[c.indices[0]][c.indices[1]][1] });
      });
      for (let q = 1; q < lk.corners.length; q++) assert.ok(JSON.stringify(lk.corners[q - 1].indices) < JSON.stringify(lk.corners[q].indices) || lk.corners[q - 1].indices[0] < lk.corners[q].indices[0]);
      n++;
    }
    // unter dem kleinsten Wert: der kleinste (kein Hochrechnen), über dem grössten: kein Wert
    assert.deepEqual(at(pas[0] - 500, ts[0] - 10).values, at(pas[0], ts[0]).values);
    assert.deepEqual(at(pas[0] - 500, ts[0] - 10).axes.map((a) => a.belowLowest), [true, true]);
    assert.deepEqual(at(pas[pas.length - 1] + 0.001, ts[0]).above.map((a) => a.quantity), ['pressureAltitude']);
    assert.deepEqual(at(pas[0], ts[ts.length - 1] + 0.01).above.map((a) => a.quantity), ['temperature']);
  }));
  assert.ok(n >= 3000, n + ' Proben');
});

test('Ablesung linear: kein Sprung an den Tabellengrenzen, steigt mit Druckhöhe und Temperatur', () => {
  ALL.forEach((ac) => allTables(ac).forEach(([ph, kg, t]) => {
    const v = (pa, temp) => core.lookupTable(t, { pressureAltitude: pa, temperature: temp }).values;
    // 0,001 neben einer Tabellengrenze höchstens 0,05 (m bzw. ft) daneben: steilste Stelle rund 15 ft je °C
    t.axes[0].values.slice(1, -1).forEach((pa) => {
      const a = v(pa - 0.001, 15), b = v(pa, 15), c = v(pa + 0.001, 15);
      ['groundRoll', 'overObstacle'].forEach((o) => assert.ok(Math.abs(a[o] - b[o]) < 0.05 && Math.abs(c[o] - b[o]) < 0.05, ac.id + ' ' + ph + ' Sprung bei ' + pa + ' ft'));
    });
    t.axes[1].values.slice(1, -1).forEach((temp) => {
      const a = v(2500, temp - 0.001), b = v(2500, temp), c = v(2500, temp + 0.001);
      ['groundRoll', 'overObstacle'].forEach((o) => assert.ok(Math.abs(a[o] - b[o]) < 0.05 && Math.abs(c[o] - b[o]) < 0.05, ac.id + ' ' + ph + ' Sprung bei ' + temp + ' °C'));
    });
    let prev = null;
    for (let pa = -200; pa <= t.axes[0].values[t.axes[0].values.length - 1]; pa += 37) {
      const cur = v(pa, 12.3);
      if (prev) assert.ok(cur.groundRoll >= prev.groundRoll && cur.overObstacle >= prev.overObstacle, ac.id + ' ' + ph + ' ' + kg + ' Höhe ' + pa);
      prev = cur;
    }
    prev = null;
    for (let temp = t.axes[1].values[0] - 5; temp <= t.axes[1].values[t.axes[1].values.length - 1]; temp += 0.7) {
      const cur = v(1800, temp);
      if (prev) assert.ok(cur.groundRoll >= prev.groundRoll && cur.overObstacle >= prev.overObstacle, ac.id + ' ' + ph + ' ' + kg + ' Temperatur ' + temp);
      prev = cur;
    }
  }));
});

test('Ablesung linear: auf den Tabellenpunkten gleich wie die alte Regel (nächsthöherer Wert)', () => {
  // Platzhöhe so, dass die Druckhöhe genau auf einer Tabellenzeile liegt (QNH 1013,25), Temperatur auf einer Spalte,
  // Gewicht auf einer Tabelle: dann ist nichts zu interpolieren, beide Regeln geben dieselben Meter
  [[C172D, [2000, 20]], [P2010, [3000, 25]], [C152, [1000, 30]], [P2008, [2000, 0]]].forEach(([ac, [elev, temp]]) => {
    const old = ac.id === 'p2008' ? null : alteAblesung(ac);
    startTables(ac).forEach((tb) => [[null, 0], [304, 6], [304, 17]].forEach(([dir, kt]) => [false, true].forEach((wet) => {
      const inp = wx(temp, 1013.25, dir, kt, wet, tb.kg === ac.mass.kg ? undefined : tb.kg);
      const a = run(ac, inp, field(elev));
      assert.equal(a.pressureAltitudeTableFt, elev);
      a.runways.filter((r) => r.computed).forEach((r) => core.PHASES.forEach((ph) => {
        const p = r[ph];
        assert.equal(p.lookup.interpolated, false, ac.id + ' ' + tb.kg + ' ' + ph);
        if (old) {
          const q = rwy(run(old, inp, field(elev)), r.id)[ph];
          assert.deepEqual([p.ok, p.ok && meters(p)], [q.ok, q.ok && meters(q)], ac.id + ' ' + tb.kg + ' ' + ph);
        }
      }));
    })));
  });
});

/* ── Gewicht linear ────────────────────────────────────────── */

test('Gewicht linear: auf einer Tabelle deren Wert, dazwischen linear, darunter die leichteste, stetig und steigend', () => {
  [C172D, P2010, P2008].forEach((ac) => {
    const tabs = startTables(ac), lightest = tabs[tabs.length - 1].kg;
    const inpAt = (kg) => wx(11.3, 1009.6, 304, 4, false, kg);
    const tv = (kg) => run(ac, inpAt(kg)).lookups.takeoff.values;
    const pa = paTableFt(AF.elevation.value, 1009.6);
    for (let kg = Math.ceil(ac.mass.kg / 2); kg <= ac.mass.kg; kg += 1) {
      const r = run(ac, inpAt(kg));
      const ref = takeoffTableValue(ac, pa, 11.3, kg);
      close(r.lookups.takeoff.values.groundRoll, ref[0], 1e-9, ac.id + ' ' + kg);
      close(r.lookups.takeoff.values.overObstacle, ref[1], 1e-9, ac.id + ' ' + kg);
      // Angaben zur Tabellenwahl
      const on = tabs.some((t) => t.kg === kg), below = kg < lightest;
      assert.equal(r.mass.interpolated, !on && !below, ac.id + ' ' + kg);
      assert.equal(r.mass.read, 'linear');
      if (r.mass.interpolated) {
        const hi = tabs.filter((t) => t.kg > kg).pop(), lo = tabs.find((t) => t.kg < kg);
        assert.deepEqual([r.mass.tableKg, r.mass.lowerKg, r.lookups.takeoff.mass.kg], [hi.kg, lo.kg, kg]);
        close(r.lookups.takeoff.mass.weight, (kg - lo.kg) / (hi.kg - lo.kg), 1e-12);
        assert.ok(r.mass.lowerRef && r.mass.lowerRef.page && r.mass.lowerTitle, 'Quelle der leichteren Tabelle');
      } else {
        assert.deepEqual([r.mass.lowerKg, r.mass.lowerIndex, r.mass.lowerRef], [null, null, null]);
        assert.equal(r.lookups.takeoff.mass, undefined);
      }
      assert.equal(r.mass.belowLowest, below);
      // die Landung hängt nie am Gewicht
      assert.deepEqual(r.lookups.landing.values, run(ac, inpAt(undefined)).lookups.landing.values);
    }
    // stetig an den Tabellengewichten und steigend im Gewicht
    tabs.slice(1).forEach((t) => {
      const a = run(ac, inpAt(t.kg - 0.001)).lookups.takeoff.values, b = tv(t.kg), c = run(ac, inpAt(t.kg + 0.001)).lookups.takeoff.values;
      ['groundRoll', 'overObstacle'].forEach((o) => assert.ok(Math.abs(a[o] - b[o]) < 0.01 && Math.abs(c[o] - b[o]) < 0.01, ac.id + ' Sprung bei ' + t.kg + ' kg'));
    });
    let prev = null;
    for (let kg = lightest - 50; kg <= ac.mass.kg; kg += 3) {
      const cur = tv(kg);
      if (prev) assert.ok(cur.groundRoll >= prev.groundRoll && cur.overObstacle >= prev.overObstacle, ac.id + ' ' + kg);
      prev = cur;
    }
    // unter der leichtesten Tabelle genau deren Werte, über dem Höchstgewicht kein Wert
    assert.deepEqual(tv(lightest - 40), tv(lightest));
    assert.equal(core.compute(ac, AF, inpAt(ac.mass.kg + 1)).error.code, 'above-mass');
  });
  // massBracket direkt (über takeoffMassBracket)
  assert.deepEqual([null, 1157, 1150, 1134, 1120, 1111, 1000].map((kg) => core.takeoffMassBracket(C172D, kg)).map((b) => [b.upper, b.lower, b.num, b.den]),
    [[0, null, null, null], [0, null, null, null], [0, 1, 16, 23], [1, null, null, null], [1, 2, 9, 23], [2, null, null, null], [2, null, null, null]]);
  assert.deepEqual(core.takeoffMassBracket(alteAblesung(C172D), 1150), { upper: 0, lower: null, num: null, den: null, weight: null }, 'alte Regel: nächsthöheres Gewicht');
  assert.deepEqual(core.takeoffMassBracket(C152, 700), { upper: 0, lower: null, num: null, den: null, weight: null }, 'eine Starttabelle');
});

/* ── Rechnung gegen die unabhängige Nachrechnung ───────────── */

test('Rechnung gleich Nachrechnung: alle vier Muster, Wetter, Nässe und Gewichte (Tabellenwert, Strecken, Meter, Überschreitung)', () => {
  // Raster mit Werten unter, auf und zwischen den Tabellenpunkten (Laufzeit rund 20 s)
  const temps = [-30, -25, -20.1, 0, 7.9, 12.5, 25, 29.9, 40, 45.5];
  const qnhs = [968.2, 1004.4, 1013.25, 1040];
  const dirs = [null, 124, 230, 304, 349];
  const winds = [0, 0.6, 4, 8.7, 23, 39];
  let n = 0, values = 0;
  ALL.forEach((ac) => {
    const masses = [undefined].concat(startTables(ac).length > 1
      ? [ac.mass.kg - 1, Math.round((ac.mass.kg + startTables(ac)[1].kg) / 2), startTables(ac)[1].kg, startTables(ac)[startTables(ac).length - 1].kg + 3, Math.ceil(ac.mass.kg / 2)]
      : []);
    temps.forEach((t) => qnhs.forEach((q) => dirs.forEach((d) => winds.forEach((w) => [false, true].forEach((wet) => masses.forEach((kg) => {
      const inp = wx(t, q, d, w, wet, kg);
      const r = core.compute(ac, AF, inp);
      n++;
      if (!r.ok) {
        assert.equal(r.error.code, 'above-range', ac.id + ' ' + JSON.stringify(inp));
        assert.equal(takeoffTableValue(ac, paTableFt(AF.elevation.value, q), t, kg === undefined ? null : kg) && bilinear(ac.charts.landing.table, paTableFt(AF.elevation.value, q), t) ? 'beide' : 'fehlt', 'fehlt',
          'Nachrechnung hätte einen Wert ' + JSON.stringify(inp));
        return;
      }
      r.runways.forEach((rw) => {
        const af = AF.runways.find((x) => x.id === rw.id);
        const kt = headwindKt(inp, af.bearingTrue);
        assert.equal(rw.computed, kt !== null, ac.id + ' gerechnet ' + rw.id + ' ' + JSON.stringify(inp));
        if (!rw.computed) return;
        assert.equal(rw.wind.kt, kt);
        core.PHASES.forEach((ph) => {
          const p = rw[ph], ref = referencePhase(ac, ph, inp, af, kt);
          const msg = ac.id + ' ' + rw.id + ' ' + ph + ' ' + JSON.stringify(inp);
          close(p.table.groundRoll, ref.tab[0], 1e-9, msg + ' Tabelle');
          close(p.table.overObstacle, ref.tab[1], 1e-9, msg + ' Tabelle');
          assert.equal(p.ok, ref.ok, msg);
          if (!p.ok) { assert.equal(p.reason, ref.reason, msg); return; }
          close(p.final.groundRoll, ref.final[0], 1e-9, msg);
          close(p.final.overObstacle, ref.final[1], 1e-9, msg);
          sameCeil(p.m.groundRoll, ref.m[0], ref.meters[0], msg);
          sameCeil(p.m.overObstacle, ref.m[1], ref.meters[1], msg);
          const avail = ph === 'takeoff' ? af.takeoffAvailable.value : af.landingAvailable.value;
          assert.deepEqual([p.exceeds.groundRoll, p.exceeds.overObstacle], [p.m.groundRoll > avail, p.m.overObstacle > avail], msg);
          values++;
        });
      });
    }))))));
  });
  assert.ok(n > 30000 && values > 20000, n + ' Rechnungen, ' + values + ' Werte');
});

test('Interpolation ist nie kürzer als der Tabellenwert darunter und nie länger als der darüber (Start, Landung, Gewicht)', () => {
  // Zwischen zwei Tabellenpunkten liegt der Wert zwischen der alten Ablesung beim nächsttieferen und beim nächsthöheren Wert
  const rnd = rng(7);
  [C172D, P2010, C152, P2008].forEach((ac) => {
    for (let k = 0; k < 400; k++) {
      const t = -10 + rnd() * 40, q = 975 + rnd() * 60, kgs = startTables(ac);
      const kg = kgs.length > 1 ? Math.round(kgs[kgs.length - 1].kg + rnd() * (ac.mass.kg - kgs[kgs.length - 1].kg)) : undefined;
      const r = core.compute(ac, AF, wx(t, q, null, 0, false, kg));
      if (!r.ok) continue;
      const pa = r.pressureAltitudeTableFt;
      ['takeoff', 'landing'].forEach((ph) => {
        const lk = r.lookups[ph], tables = ph === 'takeoff' && lk.mass ? [lk.mass.upper, lk.mass.lower] : [lk];
        const cs = tables.map((x) => x.corners).flat().map((c) => c.values);
        ['groundRoll', 'overObstacle'].forEach((o) => {
          const lo = Math.min(...cs.map((c) => c[o])), hi = Math.max(...cs.map((c) => c[o]));
          assert.ok(lk.values[o] >= lo - 1e-9 && lk.values[o] <= hi + 1e-9, ac.id + ' ' + ph + ' ' + pa + ' ' + t);
        });
      });
    }
  });
});

/* ── Von Hand nachgerechnet ────────────────────────────────── */

test('Von Hand: Cessna 172 JT-A G1000 mit 1\'120 kg, 7,9 °C, QNH 1004,4, 230°/11,7 kt (zwei Starttabellen, Höhe und Temperatur interpoliert)', () => {
  const r = run(C172D, wx(7.9, 1004.4, 230, 11.7, false, 1120));
  assert.equal(r.pressureAltitudeTableFt, 2002);                 // 2001,56 ft aufgerundet
  const rw = rwy(r, '30');
  assert.equal(rw.wind.kt, 3);                                    // 11,7 kt × cos(74°) = 3,22 kt
  const p = rw.takeoff;
  // 1'134 kg: 2'000 ft 253/395 (0 °C), 271/423 (10 °C); 3'000 ft 271/424, 290/454
  //   2'000 ft: 253 + 0,79 × 18 = 267,22 | 395 + 0,79 × 28 = 417,12; 3'000 ft: 271 + 0,79 × 19 = 286,01 | 424 + 0,79 × 30 = 447,7
  //   2'002 ft: 267,22 + 0,002 × 18,79 = 267,25758 | 417,12 + 0,002 × 30,58 = 417,18116
  const hi = p.lookup.mass.upper.values;
  close(hi.groundRoll, 267.25758, 1e-9);
  close(hi.overObstacle, 417.18116, 1e-9);
  // 1'111 kg: 2'000 ft 240/375, 257/402; 3'000 ft 257/402, 275/431 → 253,43 | 396,33 und 271,22 | 424,91 → 253,46558 | 396,38716
  const lo = p.lookup.mass.lower.values;
  close(lo.groundRoll, 253.46558, 1e-9);
  close(lo.overObstacle, 396.38716, 1e-9);
  // 1'120 kg: 9/23 zwischen 1'111 und 1'134 kg
  close(p.table.groundRoll, 253.46558 + 9 * (267.25758 - 253.46558) / 23, 1e-9);
  close(p.table.overObstacle, 396.38716 + 9 * (417.18116 - 396.38716) / 23, 1e-9);
  close(p.table.groundRoll, 258.862449565, 1e-8);
  close(p.table.overObstacle, 404.523942609, 1e-8);
  // −3 % Gegenwind, +15 % der Tabellen-Rollstrecke Gras: 251,0966 + 38,8294 = 289,926 | 392,3882 + 38,8294 = 431,2176
  close(p.final.groundRoll, 258.862449565 * 0.97 + 0.15 * 258.862449565, 1e-8);
  assert.deepEqual(meters(p), [290, 432]);
  // Landung (Grundhandbuch, 2'550 lb, ft): 2'000 ft 585/1'355, 610/1'385; 3'000 ft 610/1'385, 630/1'425
  //   → 604,75 | 1'378,7 und 625,8 | 1'416,6 → 604,7921 | 1'378,7758 ft
  close(rw.landing.table.groundRoll, 604.7921, 1e-9);
  close(rw.landing.table.overObstacle, 1378.7758, 1e-9);
  assert.deepEqual(meters(rw.landing), [262, 491]);
  // Mit der alten Regel (2'002 → 3'000 ft, 7,9 → 10 °C, 1'120 → 1'134 kg): Start 290/454 m, −3 %, +15 % von 290 m
  // = 324,8/483,88 m → 325/484 m; Landung 630/1'425 ft, −3 %, +45 % von 630 ft = 894,6/1'665,75 ft → 273/508 m
  const old = rwy(run(alteAblesung(C172D), wx(7.9, 1004.4, 230, 11.7, false, 1120)), '30');
  assert.deepEqual([meters(old.takeoff), meters(old.landing)], [[325, 484], [273, 508]]);
});

test('Von Hand: Tecnam P2008JC mit 600 kg und 620 kg, 7,9 °C, QNH 1004,4, 230°/11,7 kt', () => {
  let r = run(P2008, wx(7.9, 1004.4, 230, 11.7, false, 600));
  let p = rwy(r, '30').takeoff;
  // 600 kg (MT5-8): 2'000 ft 184/322 (0 °C), 227/395 (25 °C); 3'000 ft 201/351, 248/430; Temperatur 7,9/25 = 0,316
  //   → 197,588 | 345,068 und 215,852 | 375,964 → 2'002 ft: 197,624528 | 345,129792
  assert.equal(p.lookup.mass, undefined, 'genau auf der Tabelle 600 kg');
  close(p.table.groundRoll, 197.624528, 1e-9);
  close(p.table.overObstacle, 345.129792, 1e-9);
  // −5 m je kt × 3 kt = −15 m, Graspiste ohne Zuschlag, × 1,10: 200,8869808 | 363,1427712
  close(p.final.groundRoll, 200.8869808, 1e-9);
  close(p.final.overObstacle, 363.1427712, 1e-9);
  assert.deepEqual(meters(p), [201, 364]);
  assert.equal(p.surface, null, 'Tabelle gilt für Gras');
  // Landung (MT5-14, 650 kg): 2'000 ft 176/385, 192/401; 3'000 ft 183/392, 200/409 → 181,070632 | 390,070632;
  // −4 m × 3 kt = −12 m, × 1,67: 282,34795544 | 631,37795544
  const la = rwy(r, '30').landing;
  close(la.final.groundRoll, 282.34795544, 1e-9);
  close(la.final.overObstacle, 631.37795544, 1e-9);
  assert.deepEqual(meters(la), [283, 632]);
  assert.deepEqual([la.exceeds.groundRoll, la.exceeds.overObstacle], [false, true], 'über 15 m länger als 520 m');
  // 620 kg: 650 kg (MT5-7) 2'000 ft 223/388, 275/475; 3'000 ft 244/422, 301/517 → 239,47716 | 415,565056;
  // 0,4 zwischen 600 und 650 kg: 214,3655808 | 373,3038976; −15 m, × 1,10: 219,30213888 | 394,13428736
  r = run(P2008, wx(7.9, 1004.4, 230, 11.7, false, 620));
  p = rwy(r, '30').takeoff;
  close(p.lookup.mass.upper.values.groundRoll, 239.47716, 1e-9);
  close(p.lookup.mass.upper.values.overObstacle, 415.565056, 1e-9);
  close(p.table.groundRoll, 214.3655808, 1e-9);
  close(p.table.overObstacle, 373.3038976, 1e-9);
  close(p.final.groundRoll, 219.30213888, 1e-9);
  close(p.final.overObstacle, 394.13428736, 1e-9);
  assert.deepEqual(meters(p), [220, 395]);
  assert.deepEqual([r.mass.tableKg, r.mass.lowerKg, r.mass.interpolated], [650, 600, true]);
});

/* ── «Start möglich bis» auf ganze kg ──────────────────────── */

function possible(p) { return p.ok && !p.exceeds.groundRoll && !p.exceeds.overObstacle; }

test('«Start möglich bis …» auf ganze kg: mit Y kg möglich, mit Y + 1 kg nicht; Zustände wie bisher', () => {
  const seen = {};
  [C172D, P2010, P2008].forEach((ac) => {
    const lightest = startTables(ac)[startTables(ac).length - 1].kg;
    [5, 18, 27, 34, 41, 46].forEach((t) => [968, 990, 1013.25].forEach((q) => [null, 304, 124].forEach((d) => [0, 3, 9, 16].forEach((w) => [false, true].forEach((wet) => {
      [undefined, ac.mass.kg - 7, Math.round((ac.mass.kg + lightest) / 2)].forEach((kg) => {
        const inp = wx(t, q, d, w, wet, kg);
        const r = core.compute(ac, AF, inp);
        if (!r.ok) return;
        r.runways.filter((rw) => rw.computed).forEach((rw) => {
          const L = rw.takeoffLimit, m = kg === undefined ? ac.mass.kg : kg;
          seen[L.state] = (seen[L.state] || 0) + 1;
          const at = (x) => rwy(core.compute(ac, AF, Object.assign({}, inp, { massKg: x })), rw.id).takeoff;
          const msg = ac.id + ' ' + rw.id + ' ' + JSON.stringify(inp) + ' ' + JSON.stringify(L);
          assert.equal(L.state === 'possible', possible(rw.takeoff), msg);
          if (L.state === 'limit') {
            assert.ok(Number.isInteger(L.maxKg) && L.maxKg >= lightest && L.maxKg < m, msg);
            assert.ok(possible(at(L.maxKg)), msg + ': mit maxKg möglich');
            assert.ok(!possible(at(L.maxKg + 1)), msg + ': mit maxKg + 1 nicht möglich');
            assert.equal(rw.takeoff.wetFactorMissing, false, msg);
          }
          if (L.state === 'lowest') assert.ok(m <= lightest, msg);
          if (L.state === 'none') assert.ok(!possible(at(lightest)) && at(lightest).ok, msg);
          if (L.state === 'wet-unknown') assert.ok(wet && rw.takeoff.wetFactorMissing, msg);
          if (L.maxPossibleKg !== null) {
            assert.ok(possible(at(L.maxPossibleKg)), msg + ': maxPossibleKg möglich');
            if (L.maxPossibleKg < ac.mass.kg) assert.ok(!possible(at(L.maxPossibleKg + 1)), msg + ': maxPossibleKg + 1 nicht');
          }
        });
      });
    })))));
  });
  ['possible', 'limit', 'none', 'wet-unknown'].forEach((s) => assert.ok(seen[s] > 0, 'Zustand ' + s + ' kommt vor: ' + JSON.stringify(seen)));
});

test('«Start möglich bis …» direkt (_takeoffLimitLinear): lowest, unknown mit Schwelle, wet-unknown, Suche nur bis zur leichtesten Tabelle', () => {
  const P = (ok, ex, wet) => (ok ? { ok: true, exceeds: { groundRoll: false, overObstacle: ex }, wetFactorMissing: !!wet } : { ok: false, exceeds: null, wetFactorMissing: false });
  const calls = [];
  // möglich ab 1'100 kg abwärts (länger als verfügbar darüber)
  let L = core._takeoffLimitLinear(P(true, true), 1150, 1157, 1111, (kg) => { calls.push(kg); return P(true, kg > 1130); });
  assert.deepEqual([L.state, L.maxKg, L.maxPossibleKg], ['limit', 1130, 1130]);
  assert.ok(Math.min(...calls) >= 1111, 'nie unter der leichtesten Tabelle gesucht');
  // nicht über der leichtesten Tabelle: lowest
  L = core._takeoffLimitLinear(P(true, true), 1111, 1157, 1111, () => P(true, true));
  assert.equal(L.state, 'lowest');
  // ab 1'020 kg abwärts kein Wert (Windgutschrift über die Hälfte), darüber zu lang: unknown mit Schwelle
  L = core._takeoffLimitLinear(P(true, true), 1100, 1160, 960, (kg) => (kg <= 1020 ? P(false) : P(true, true)));
  assert.deepEqual([L.state, L.noValueFromKg, L.maxKg], ['unknown', 1020, null]);
  // Grenze zu «lowest» genau: 1 kg über der leichtesten Tabelle wird gesucht (und dort gefunden), auf ihr nicht
  L = core._takeoffLimitLinear(P(true, true), 1112, 1157, 1111, () => P(true, false));
  assert.deepEqual([L.state, L.maxKg], ['limit', 1111]);
  L = core._takeoffLimitLinear(P(true, true), 1111.5, 1157, 1111, () => P(true, false));
  assert.deepEqual([L.state, L.maxKg], ['limit', 1111]);
  assert.equal(core._takeoffLimitLinear(P(true, true), 1111, 1157, 1111, () => P(true, false)).state, 'lowest');
  // nass ohne Nässewert des AFM: kein «möglich bis»
  L = core._takeoffLimitLinear(P(true, true, true), 1100, 1160, 960, (kg) => P(true, kg > 1000, true));
  assert.deepEqual([L.state, L.maxKg, L.maxPossibleKg], ['wet-unknown', null, null]);
  // ohne Wert mit dem Gewicht der Rechnung: keine Aussage
  L = core._takeoffLimitLinear(P(false), 1100, 1160, 960, () => P(true, false));
  assert.equal(L.state, 'no-value');
  // auch mit der leichtesten Tabelle zu lang: none
  L = core._takeoffLimitLinear(P(true, true), 1100, 1160, 960, () => P(true, true));
  assert.deepEqual([L.state, L.lightestKg], ['none', 960]);
});

/* ── Anzeige mit den ausgelieferten Daten ──────────────────── */

const NOW = Date.UTC(2026, 10, 20, 9, 0);
const MIN = 60000;
function wxPfa(over) {
  return Object.assign({
    src: 'pfa', srcLabel: 'MeteoSchweiz Pfäffikon ZH', time: NOW - 5 * MIN, ageMin: 5, stale: false,
    windKt: 11.7, windDir: 230, gustKt: 15, tempC: 7.9, qnhHpa: 1004.4, rainMmH: 0, rain1hMm: 0
  }, over);
}
function fgzo() { return { ok: true, fetched_at_utc: new Date(NOW - 10 * MIN).toISOString(), runway_condition: 'DRY', updated: '20.11.2026, 09:40' }; }
function render(wx, over) {
  return ui.renderHtml(Object.assign({
    dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: wx, fgzo: fgzo(), nowMs: NOW, detailsOpen: true
  }, over));
}
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
// Zeilen der ersten Schritt-Tabelle: [Beschriftung, Rollstrecke, über 15 m] als Text, ohne die Tabellenausschnitte
// (VERSION 8; die prüft afmTables aus tests/helpers/afm.js)
function stepRows(html) {
  const h = withoutAfm(html);
  const t = h.slice(h.indexOf('<table class="perf-steps">'), h.indexOf('</table>', h.indexOf('<table class="perf-steps">')));
  const rows = [];
  const re = /<tr(?: class="[^"]*")?><th[^>]*>([\s\S]*?)<\/th>(?:<td[^>]*>([\s\S]*?)<\/td><td[^>]*>([\s\S]*?)<\/td>)?<\/tr>/g;
  let m;
  while ((m = re.exec(t))) rows.push([text(m[1]).trim(), m[2] === undefined ? null : text(m[2]).trim(), m[3] === undefined ? null : text(m[3]).trim()]);
  return rows;
}
// Zahl einer Zelle «≈267,26 m» bzw. «1'378,7758 ft»: Wert und ob gerundet (≈)
function num(s) {
  const m = /^(≈?)(−?[\d']+(?:,\d+)?) (m|ft)$/.exec(s);
  assert.ok(m, 'Zelle ' + s);
  return { v: Number(m[2].replace(/'/g, '').replace(',', '.').replace('−', '-')), approx: m[1] === '≈', dec: (m[2].split(',')[1] || '').length };
}
function shownEquals(cell, x, msg) {
  const n = num(cell);
  if (n.approx) { assert.equal(n.dec <= 2, true, msg); close(n.v, Math.round(x * 100) / 100, 1e-9, msg + ' (≈)'); }
  else close(n.v, x, 1e-9, msg);
}

test('Anzeige (linear): Kopf, Hinweis am Gewichtsfeld und Eingaben für zwischen, auf, unter den Tabellen und Höchstgewicht', () => {
  const head = (kg) => text(render(wxPfa(), { massText: kg === null ? null : String(kg) }));
  let t = head(1120);
  assert.ok(t.includes("Abfluggewicht 1'120 kg: Start zwischen den AFM-Tabellen für 1'134 und 1'111 kg interpoliert, Landung mit dem maximalen Landegewicht 1'157 kg"), t);
  assert.ok(t.includes("höchstens 1'157 kg · zwischen den AFM-Tabellen für 1'157, 1'134 und 1'111 kg interpoliert, darunter gilt die Tabelle für 1'111 kg"), t);
  assert.ok(t.includes("Eingaben: Gewicht 1'120 kg, zwischen den Starttabellen 1'134 und 1'111 kg interpoliert · Druckhöhe 2'002 ft"), t);
  assert.ok(t.includes("Start · Supplement, Figure 5-1c (Section 5b), Seite 5b-6 und Figure 5-1e (Section 5b), Seite 5b-9 · Tabellen 1'134 und 1'111 kg"), t);
  // gerundeter Zuschlag mit «≈» vor dem Vorzeichen (Befund N2 der Prüfung)
  assert.ok(t.includes('Gras +15 % von ≈258,86 m = ≈+38,83 m 289,93 m 431,22 m aufgerundet 290 m 432 m'), t);
  assert.ok(!t.includes('+≈'), t);
  t = head(1134);
  assert.ok(t.includes("Abfluggewicht 1'134 kg: Start nach der AFM-Tabelle für 1'134 kg, Landung") && t.includes("Gewicht 1'134 kg, Starttabelle 1'134 kg"), t);
  assert.ok(t.includes("Start · Supplement, Figure 5-1c (Section 5b), Seite 5b-6 · Tabelle 1'134 kg"), t);
  t = head(1000);
  assert.ok(t.includes("Abfluggewicht 1'000 kg: Start nach der kleinsten AFM-Tabelle (1'111 kg), Landung") && t.includes("Gewicht 1'000 kg, Starttabelle 1'111 kg"), t);
  t = head(null);
  assert.ok(t.includes("Maximales Abfluggewicht 1'157 kg (2'550 lb)") && t.includes("Gewicht 1'157 kg (maximales Abfluggewicht)"), t);
  // P2008: Hinweis am Feld mit den drei Tabellen
  t = text(render(wxPfa(), { aircraft: P2008, massText: '620' }));
  assert.ok(t.includes('höchstens 650 kg · zwischen den AFM-Tabellen für 650, 600 und 550 kg interpoliert, darunter gilt die Tabelle für 550 kg'), t);
  assert.ok(t.includes('Abfluggewicht 620 kg: Start zwischen den AFM-Tabellen für 650 und 600 kg interpoliert, Landung mit dem maximalen Landegewicht 650 kg'), t);
  // gleiche Fundstelle in beiden Tabellen: einmal genannt, mit beiden Seiten
  assert.ok(t.includes('Start · AFM, Section 5, Ziffer 7, Seiten MT5-7 und MT5-8 · Tabellen 650 und 600 kg'), t);
  t = text(render(wxPfa(), { aircraft: P2010, massText: '1111' }));
  assert.ok(t.includes("Start · AFM, Section 5, Ziffer 7, Seiten APV5-8 und APV5-9 · Tabellen 1'160 und 1'060 kg"), t);
});

test("Gewichtszeile: Wert mit acht Nachkommastellen mit «≈» (P2010 1'111 kg, QNH 959, −7,3 °C; VERSION 9)", () => {
  // Rollstrecke des Kerns 334,79459992 m (echter Wert, kein Gleitkommarest), bis VERSION 8 als exakt «334,7946» gezeigt
  const t = text(render(wxPfa({ tempC: -7.3, qnhHpa: 959 }), { aircraft: P2010, massText: '1111' }));
  assert.ok(t.includes("interpoliert für 1'111 kg ≈334,79 m ≈593,66 m"), t);
  assert.ok(!t.includes('334,7946'), 'nicht als exakt');
});

test('Rechenweg (linear): Ausschnitte wie im AFM (Grenzen, Eingabe, Zellen), jede Interpolation aus den angezeigten Zahlen nachgerechnet', () => {
  let checked = 0, cells = 0;
  const val = (s) => Number(s.replace(/'/g, '').replace(',', '.').replace('−', '-').replace('≈', ''));
  [[C172D, '1120'], [C172D, null], [C172D, '1000'], [P2010, '1111'], [P2010, null], [C152, null], [P2008, '620'], [P2008, '600'], [P2008, '577']].forEach(([ac, mt]) => {
    [wxPfa(), wxPfa({ tempC: -27.4, qnhHpa: 1031.2, windDir: 300, windKt: 6 }), wxPfa({ tempC: 25, qnhHpa: 1013.25, windDir: null, windKt: 0 }), wxPfa({ tempC: 13.6, qnhHpa: 997.3 })].forEach((w) => {
      const html = render(w, { aircraft: ac, massText: mt });
      const rows = stepRows(html);
      const label = ac.id + ' ' + mt + ' ' + JSON.stringify([w.tempC, w.qnhHpa]);
      assert.ok(rows.length > 0, label);
      // Welche Starttabelle ohne Gewichtsangabe im Ausschnitt gilt, sagt die Kopfzeile «· Tabelle X kg» (bzw. das
      // Höchstgewicht bei einer einzigen Starttabelle); geprüft wird gegen die Zellen dieser Tabelle in den Daten
      const tableKgShown = (() => {
        const h = rows.find((r) => r[1] === null && r[0].startsWith('Start · '));
        const m = h && /· Tabelle ([\d']+) kg$/.exec(h[0]);
        return m ? Number(m[1].replace(/'/g, '')) : ac.mass.kg;
      })();
      // Abschnitte je Phase: Kopfzeile «Start · …» bzw. «Landung · …» ohne Zahlen; dazu die Ausschnitte derselben Phase
      // (die ersten zwei Phasen im HTML gehören zur ersten Schritt-Tabelle)
      let ph = null, block = [];
      const blocks = [];
      rows.forEach((r) => {
        if (r[1] === null && /^(Start|Landung) · /.test(r[0])) { if (ph) blocks.push([ph, block]); ph = r[0].startsWith('Start') ? 'takeoff' : 'landing'; block = []; }
        else block.push(r);
      });
      blocks.push([ph, block]);
      const chunks = html.split('<tbody><tr class="perf-steps-ph">').slice(1, 3);
      assert.equal(chunks.length, 2, label);
      blocks.forEach(([phase, rs], bi) => {
        const tb = chunks[bi];
        assert.ok(tb.startsWith('<th colspan="3" scope="rowgroup">' + (phase === 'takeoff' ? 'Start' : 'Landung') + ' '), label);
        const tableOf = (kg) => (phase === 'landing' ? ac.charts.landing.table : startTables(ac).find((x) => x.kg === (kg === null ? tableKgShown : kg)).table);
        // direkt nach dem Kopf der Phase die Legende, dann der erste Ausschnitt
        const unit = tableOf(null).outputs[0].unit;
        assert.ok(tb.slice(tb.indexOf('</tr>') + 5).startsWith('<tr><td class="perf-steps-note" colspan="3">AFM-Tabelle in ' + unit + ': ' +
          ui.TEXT.calcAfm + '</td></tr><tr class="perf-steps-afm">'), label + ': Legende vor dem Ausschnitt');
        const perTable = {};
        let inputsText = null;
        afmTables(tb).forEach((g) => {
          assert.ok(g.cap === '' || /^[\d']+ kg$/.test(g.cap), label + ': Kopf «' + g.cap + '»');
          const kg = g.cap ? val(g.cap.replace(/ kg$/, '')) : null;
          const c = tableOf(kg);
          const axisNum = (l, u) => { const m = new RegExp('^(−?[\\d\']+(?:,\\d+)?) ' + u + '$').exec(l); assert.ok(m, label + ': Beschriftung ' + l); return val(m[1]); };
          // Linien einer Achse: ein blauer Tabellenwert (abgelesen) oder untere Grenze, blaue Eingabe, obere Grenze (benachbart)
          const line = (ls, ax, u) => {
            if (ls.length === 1) {
              const v = axisNum(ls[0].label, u);
              assert.ok(ls[0].blue && ax.values.includes(v), label + ': abgelesener Tabellenwert ' + ls[0].label);
              return { read: v, vals: [v] };
            }
            assert.equal(ls.length, 3, label);
            assert.deepEqual(ls.map((l) => l.blue), [false, true, false], label + ': blau nur die Eingabe');
            const lo = axisNum(ls[0].label, u), x = axisNum(ls[1].label, u), hi = axisNum(ls[2].label, u);
            const j = ax.values.indexOf(lo);
            assert.ok(j >= 0 && ax.values[j + 1] === hi && lo < x && x < hi, label + ': Grenzen ' + [lo, x, hi]);
            return { lo, x, hi, label: ls[1].label, vals: [lo, null, hi] };
          };
          const R = line(g.rows, c.axes[0], 'ft'), C = line(g.cols, c.axes[1], '°C');
          const shown = {};
          let X = null;
          g.rows.forEach((r, ri) => r.cells.forEach((cell, ci) => {
            const pa = R.vals[ri], tc = C.vals[ci];
            if (r.blue && g.cols[ci].blue) { assert.equal(cell.kind, 'x', label + ': Schnittpunkt'); X = cell; return; }
            if (pa === null || tc === null) { assert.equal(cell.kind, 'empty', label + ': leer auf der Eingabe'); return; }
            assert.equal(cell.kind, r.blue || g.cols[ci].blue ? 'blue' : 'plain', label + ': Markierung ' + pa + '/' + tc);
            const i = c.axes[0].values.indexOf(pa), j = c.axes[1].values.indexOf(tc);
            assert.ok(!/≈/.test(cell.a + cell.b), label + ': Tabellenzelle gerundet');
            assert.deepEqual([val(cell.a), val(cell.b)], c.cells[i][j], label + ': Tabellenzelle ' + pa + ' ft / ' + tc + ' °C');
            shown[pa + '|' + tc] = [val(cell.a), val(cell.b)];
            cells++;
          }));
          assert.ok(X, label + ': Schnittpunkt fehlt');
          // Schnittpunkt aus den angezeigten Zellen (in jeder Zeile zuerst die Temperatur, dann die Druckhöhe); genau auf
          // einem Tabellenpunkt dessen Wert aus den Daten
          const f = (lo, hi, x) => (x - lo) / (hi - lo);
          const cellOf = (pa, tc, o) => (pa + '|' + tc in shown ? shown[pa + '|' + tc][o] : c.cells[c.axes[0].values.indexOf(pa)][c.axes[1].values.indexOf(tc)][o]);
          const inRow = (pa, o) => (C.read !== undefined ? cellOf(pa, C.read, o) : cellOf(pa, C.lo, o) + (cellOf(pa, C.hi, o) - cellOf(pa, C.lo, o)) * f(C.lo, C.hi, C.x));
          [X.a, X.b].forEach((s, o) => {
            const exp = R.read !== undefined ? inRow(R.read, o) : inRow(R.lo, o) + (inRow(R.hi, o) - inRow(R.lo, o)) * f(R.lo, R.hi, R.x);
            shownEquals(s + ' m', exp, label + ': Schnittpunkt');
          });
          perTable[kg === null ? 'one' : kg] = { gr: val(X.a), ob: val(X.b), a: X.a, b: X.b };
          inputsText = [R, C].filter((x) => x.read === undefined).map((x) => x.label).join(' / ');
          checked++;
        });
        rs.forEach((r) => {
          // Wert der Ablesung (eine Tabelle): gleich dem Schnittpunkt, Beschriftung mit den interpolierten Eingaben
          let m = /^(interpoliert für (.+)|Tabellenwert)$/.exec(r[0]);
          if (m && !/ kg$/.test(r[0])) {
            const one = perTable.one;
            assert.ok(one && Object.keys(perTable).length === 1, label + ': ein Ausschnitt vor ' + r[0]);
            assert.equal(r[0], inputsText ? 'interpoliert für ' + inputsText : 'Tabellenwert', label + ': Beschriftung');
            assert.deepEqual([r[1], r[2]], [one.a + ' ' + unit, one.b + ' ' + unit], label + ': Wert gleich dem Schnittpunkt');
            checked++;
            return;
          }
          m = /^interpoliert für ([\d']+) kg$/.exec(r[0]);
          if (m) {
            const kg = Number(m[1].replace(/'/g, ''));
            const keys = Object.keys(perTable).filter((k) => k !== 'one').map(Number).sort((a, b) => b - a);
            assert.equal(keys.length, 2, label + ': zwei Ausschnitte (Starttabellen) vor ' + r[0]);
            assert.ok(!('one' in perTable), label + ': kein Ausschnitt ohne Gewicht');
            const hiK = keys[0], loK = keys[1];
            // aus den exakten Werten der Tabellen gerechnet (die Anzeige kann ≈ gerundet sein): gegen den Kern geprüft
            const res = core.compute(ac, AF, { tempC: w.tempC, qnhHpa: w.qnhHpa, windDirTrue: w.windDir, windKt: w.windKt, runwayWet: false, massKg: kg });
            const lk = res.lookups.takeoff;
            assert.deepEqual([lk.mass.upperKg, lk.mass.lowerKg], [hiK, loK], label);
            const exp = ['groundRoll', 'overObstacle'].map((o) => lk.mass.lower.values[o] + (kg - loK) * (lk.mass.upper.values[o] - lk.mass.lower.values[o]) / (hiK - loK));
            shownEquals(r[1], exp[0], label + ': ' + r[0]);
            shownEquals(r[2], exp[1], label + ': ' + r[0]);
            // und grob aus den angezeigten Schnittpunkten (höchstens 0,01 m daneben, falls die Anzeige gerundet hat)
            const a = perTable[loK], b = perTable[hiK];
            close(num(r[1]).v, a.gr + (kg - loK) * (b.gr - a.gr) / (hiK - loK), 0.011, label + ': aus der Anzeige');
            close(num(r[2]).v, a.ob + (kg - loK) * (b.ob - a.ob) / (hiK - loK), 0.011, label + ': aus der Anzeige (15 m)');
            checked++;
          }
        });
        // je Phase genau eine Wertzeile: für das Gewicht (zwei Ausschnitte) bzw. für die eine Tabelle
        const kgRows = rs.filter((r) => /^interpoliert für [\d']+ kg$/.test(r[0])).length;
        const oneRows = rs.filter((r) => /^(interpoliert für .+|Tabellenwert)$/.test(r[0]) && !/ kg$/.test(r[0])).length;
        assert.deepEqual([kgRows, oneRows], 'one' in perTable ? [0, 1] : [1, 0], label + ': Wertzeile der Ablesung');
      });
      // Lesehilfe so, wie die ausgelieferten Daten ablesen
      const t = text(html);
      const rule = ac.id === 'c152' ? 'Druckhöhe und Temperatur linear interpoliert.' : 'Druckhöhe, Temperatur und Startgewicht linear interpoliert.';
      const surface = ac.id === 'p2008' ? ' AFM-Tabellen für Gras, ohne Belagszuschlag.' : ' ' + ui.TEXT.calcSurface;
      assert.ok(t.includes(rule + ' ' + ui.TEXT.calcBelow + ' ' + ui.TEXT.calcRound + surface + ' ' + ui.TEXT.calcLimits), label + ': ' + t.slice(-700));
      ['NaN', 'undefined', 'null', 'Infinity'].forEach((x) => assert.ok(!html.includes(x), label + ': ' + x));
    });
  });
  // Abdeckung: Ausschnitte und Wertzeilen, angezeigte Tabellenzellen (ohne Schnittpunkte)
  assert.deepEqual([checked, cells], [160, 282], 'Abdeckung');
});

test('Anzeige (linear): «möglich bis» auf ganze kg in der Karte, Text bei «unknown» mit Schwelle', () => {
  // P2010 an einem heissen Tag auf Piste 30: mit 1'160 kg zu lang, die Grenze liegt zwischen den Tabellen
  const w = wxPfa({ tempC: 27.5, qnhHpa: 1008.1, windDir: 300, windKt: 2 });
  const res = core.compute(P2010, AF, { tempC: 27.5, qnhHpa: 1008.1, windDirTrue: 300, windKt: 2, runwayWet: false });
  const L = rwy(res, '30').takeoffLimit;
  assert.equal(L.state, 'limit', JSON.stringify(L));
  assert.ok(!startTables(P2010).some((x) => x.kg === L.maxKg), 'Grenze zwischen den Tabellen: ' + L.maxKg);
  const t = text(render(w, { aircraft: P2010 }));
  assert.ok(t.includes("Start mit 1'160 kg laut AFM nicht möglich, möglich bis " + ui.fmtInt(L.maxKg) + ' kg.'), t);
  assert.ok(t.includes("Über 15 m je Starttabelle: 1'160 kg"), 'Zeile je Starttabelle im Rechenweg');
  // «unknown» mit Schwelle (an der LSZK kaum erreichbar): Testplatz auf 6'000 ft, Hartbelag, 45 °C, 10 kt Gegenwind,
  // Tecnam mit einer Windregel von −30 m je kt. Mit 1'160 kg zu lang; je leichter, desto kürzer die Rollstrecke, bis
  // die Windgutschrift über die Hälfte geht (kein Wert).
  const ac = clone(P2010);
  ac.charts.takeoff.corrections[0].amount = -30;
  const af = { schema: 2, icao: 'TEST', elevation: { value: 6000, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, surface: 'paved', takeoffAvailable: { value: 625, unit: 'm' }, landingAvailable: { value: 625, unit: 'm' } }] };
  const res2 = core.compute(ac, af, { tempC: 45, qnhHpa: 1013.25, windDirTrue: 360, windKt: 10, runwayWet: false });
  const L2 = res2.runways[0].takeoffLimit;
  assert.equal(L2.state, 'unknown', JSON.stringify(L2));
  assert.ok(L2.noValueFromKg > 960 && L2.noValueFromKg < 1159, JSON.stringify(L2));
  // Schwelle wie die Rechnung: mit noValueFromKg kein Wert, mit einem kg mehr ein Wert (zu lang)
  const at = (kg) => core.compute(ac, af, { tempC: 45, qnhHpa: 1013.25, windDirTrue: 360, windKt: 10, runwayWet: false, massKg: kg }).runways[0].takeoff;
  assert.deepEqual([at(L2.noValueFromKg).ok, at(L2.noValueFromKg).reason, at(L2.noValueFromKg + 1).ok], [false, 'wind-credit-limit', true]);
  const t2 = text(ui.renderHtml({ dataState: 'ready', list: LIST, aircraft: ac, airfield: af, nowMs: NOW, fgzo: fgzo(), detailsOpen: false,
    wx: wxPfa({ tempC: 45, qnhHpa: 1013.25, windDir: 360, windKt: 10 }) }));
  assert.ok(t2.includes("Start mit 1'160 kg laut AFM nicht möglich, auch nicht mit " + ui.fmtInt(L2.noValueFromKg + 1) + ' kg. ' + ui.TEXT.limitNoValue), t2);
  // Eingabe genau auf dem leichtesten Gewicht mit Wert: schon 1 kg darunter kein Wert, also ohne «auch nicht mit …»
  const first = L2.noValueFromKg + 1;
  const t3 = text(ui.renderHtml({ dataState: 'ready', list: LIST, aircraft: ac, airfield: af, nowMs: NOW, fgzo: fgzo(), detailsOpen: false,
    wx: wxPfa({ tempC: 45, qnhHpa: 1013.25, windDir: 360, windKt: 10 }), massText: String(first) }));
  assert.ok(t3.includes('Start mit ' + ui.fmtInt(first) + ' kg laut AFM nicht möglich. ' + ui.TEXT.limitNoValue), t3);
  assert.ok(!t3.includes('auch nicht mit'), t3);
});

test('Rechenweg (linear): Zeile je Starttabelle zeigt bei Interpolation den Wert jeder Tabelle selbst, nicht den interpolierten', () => {
  // P2010, heisser Tag, Piste 30: mit 1'160 kg nicht möglich, möglich erst unter 1'060 kg; Eingabe 1'110 kg liegt
  // zwischen den Tabellen 1'160 und 1'060 kg (interpoliert, ebenfalls nicht möglich), dann steht im Rechenweg die Zeile
  // «Über 15 m je Starttabelle»
  const base = { tempC: 27.5, qnhHpa: 1008.1, windDirTrue: 300, windKt: 2, runwayWet: false };
  const L = rwy(core.compute(P2010, AF, base), '30').takeoffLimit;
  assert.equal(L.state, 'limit');
  const m = 1110;
  assert.ok(L.maxKg < m, 'Grenze unter der Eingabe: ' + L.maxKg);
  const res = core.compute(P2010, AF, Object.assign({}, base, { massKg: m }));
  assert.equal(res.mass.interpolated, true);
  const own = (kg) => rwy(core.compute(P2010, AF, Object.assign({}, base, { massKg: kg })), '30').takeoff.m.overObstacle;
  const row = "Über 15 m je Starttabelle: 1'160 kg " + ui.fmtInt(own(1160)) + " m · 1'060 kg " + ui.fmtInt(own(1060)) + ' m · 960 kg ' + ui.fmtInt(own(960)) + ' m';
  assert.ok(own(1160) > rwy(res, '30').takeoff.m.overObstacle, 'die schwerere Tabelle ist länger als der interpolierte Wert');
  const t = text(render(wxPfa({ tempC: 27.5, qnhHpa: 1008.1, windDir: 300, windKt: 2 }), { aircraft: P2010, massText: String(m) }));
  assert.ok(t.includes(row), row + '\n' + t);
  assert.ok(t.includes('Start mit ' + ui.fmtInt(m) + ' kg laut AFM nicht möglich, möglich bis ' + ui.fmtInt(L.maxKg) + ' kg.'), t);
});

test('Durchlauf (linear): ganze Rechenkette steigt mit Temperatur, Druckhöhe und Gewicht; nass nie kürzer als trocken', () => {
  // Meter je Piste und Phase; nicht gerechnete Piste [0, 0], kein Wert [∞, ∞]
  function allM(res) {
    const out = [];
    ['12', '30'].forEach((id) => core.PHASES.forEach((ph) => {
      const r = res.ok ? rwy(res, id) : null;
      const p = r && r.computed ? r[ph] : null;
      out.push(p && p.ok ? meters(p) : (r && !r.computed ? [0, 0] : [Infinity, Infinity]));
    }));
    return out;
  }
  const notShorter = (cur, prev) => cur.every((pair, k) => pair[0] >= prev[k][0] && pair[1] >= prev[k][1]);
  let n = 0;
  ALL.forEach((ac) => {
    const kgs = [undefined].concat(startTables(ac).length > 1 ? [Math.round((ac.mass.kg + startTables(ac)[1].kg) / 2)] : []);
    [null, 304].forEach((d) => [0, 9].forEach((w) => [false, true].forEach((wet) => kgs.forEach((kg) => {
      for (const q of [990, 1013.25, 1035]) {
        let prev = null;
        for (let t = -35; t <= 52; t += 1.5) {
          const cur = allM(core.compute(ac, AF, wx(t, q, d, w, wet, kg)));
          if (prev) assert.ok(notShorter(cur, prev), ac.id + ' Temperatur ' + t + ' ' + JSON.stringify([q, d, w, wet, kg]));
          prev = cur;
          n++;
        }
      }
      for (const t of [-5, 12, 29]) {
        let prev = null;
        for (let q = 1060; q >= 950; q -= 1.5) {             // fallendes QNH = steigende Druckhöhe
          const cur = allM(core.compute(ac, AF, wx(t, q, d, w, wet, kg)));
          if (prev) assert.ok(notShorter(cur, prev), ac.id + ' QNH ' + q + ' ' + JSON.stringify([t, d, w, wet, kg]));
          prev = cur;
          n++;
        }
      }
      // nass nie kürzer als trocken
      if (wet) {
        const a = allM(core.compute(ac, AF, wx(15, 1018, d, w, false, kg))), b = allM(core.compute(ac, AF, wx(15, 1018, d, w, true, kg)));
        assert.ok(notShorter(b, a), ac.id + ' nass');
      }
    }))));
    // im Gewicht auf ganze kg (Wind bis 6 kt: die Windgutschrift bleibt unter der Hälfte)
    if (startTables(ac).length > 1) {
      [124, 304].forEach((d) => [0, 6].forEach((w) => [false, true].forEach((wet) => {
        let prev = null;
        for (let kg = Math.ceil(ac.mass.kg / 2); kg <= ac.mass.kg; kg += 1) {
          const cur = allM(core.compute(ac, AF, wx(15, 1005, d, w, wet, kg)));
          if (prev) assert.ok(notShorter(cur, prev), ac.id + ' Gewicht ' + kg + ' ' + JSON.stringify([d, w, wet]));
          prev = cur;
          n++;
        }
      })));
    }
  });
  assert.ok(n > 15000, n + ' Rechnungen');
});

test('Anzeige P2008: Auswahl, Kennzeichen, Kopf, Faktorzeile, Rechenweg ohne Graszuschlag, Pflichthinweis rot und fett', () => {
  const html = render(wxPfa(), { aircraft: P2008, detailsOpen: false });
  const t = text(html);
  assert.ok(html.includes('<option value="p2008" selected>Tecnam P2008JC</option>'), html);
  assert.ok(html.includes('<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-KMG</span> · <span class="perf-nw">HB-KMH</span> · <span class="perf-nw">HB-KMX</span></div>'), html);
  assert.ok(t.includes('Maximales Abfluggewicht 650 kg (1\'433 lb) · Klappen T/O beim Start und LAND bei der Landung, Geschwindigkeiten nach AFM · P2008 JC, Rotax 912 S2, Propeller MTV-34-1-A/170-202'), t);
  assert.ok(t.includes('Eingerechnet nach AFM: Faktor für Abweichungen im Betrieb – Start × 1,10 (NOTE, MT5-7), Landung × 1,67 (NOTE, MT5-14).'), t);
  assert.ok(!t.includes('Gras +'), 'kein Graszuschlag: die Tabellen gelten für Gras');
  assert.ok(t.includes('Gerechnet für trockenes Gras.'), t);
  // Zahlen wie von Hand (Test oben): 650 kg ohne Eingabe
  const r = rwy(run(P2008, wx(7.9, 1004.4, 230, 11.7, false)), '30');
  assert.ok(t.includes('Start ' + r.takeoff.m.groundRoll + ' m ' + r.takeoff.m.overObstacle + ' m 625 m'), t);
  assert.ok(t.includes('Landung 283 m 632 m 520 m') && t.includes('Landung: Strecke über 15 m länger als die verfügbare Länge.'), t);
  // nass: das AFM nennt keinen Wert, Zahlen unverändert
  const wet = text(render(wxPfa({ rain1hMm: 0.6 }), { aircraft: P2008 }));
  assert.ok(wet.includes('Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,6 mm Regen gemessen. Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein.'), wet);
  // Pflichthinweis am Schluss, rot und fett
  assert.ok(html.endsWith('<div class="perf-foot">' + ui.TEXT.advice + '</div>'));
  const rule = /\.perf-foot \{([^}]*)\}/.exec(ui.CSS);
  assert.ok(rule && /color: #f87171;/.test(rule[1]) && /font-weight: 700;/.test(rule[1]), rule && rule[1]);
});

test('Durchlauf (linear): nie NaN, undefined, null oder Infinity im HTML; Zahlen der Karte gleich dem Rechenkern', () => {
  let n = 0;
  ALL.forEach((ac) => {
    const masses = [null].concat(startTables(ac).length > 1 ? ['' + (ac.mass.kg - 3), '' + startTables(ac)[1].kg, '' + (startTables(ac)[1].kg - 11), '' + Math.ceil(ac.mass.kg / 2)] : []);
    [-15, 0.4, 9.9, 21.3, 33].forEach((tc) => [985, 1004.4, 1027].forEach((q) => [null, 230, 304, 124].forEach((d) => [0, 2, 9, 22].forEach((wk) => masses.forEach((mt) => {
      const w = wxPfa({ tempC: tc, qnhHpa: q, windDir: d, windKt: wk });
      const parts = ui.renderParts({ dataState: 'ready', list: LIST, aircraft: ac, airfield: AF, wx: w, fgzo: fgzo(), nowMs: NOW, detailsOpen: true, massText: mt });
      const html = parts.sel + parts.mass + parts.body + parts.teaser;
      ['NaN', 'undefined', 'null', 'Infinity'].forEach((x) => assert.ok(!html.includes(x), ac.id + ' ' + mt + ' ' + x));
      n++;
    })))));
  });
  assert.ok(n > 1000, n + ' Karten');
});
