// Daten- und Kerntests für den Start-/Landestreckenrechner (perf/perf.js, Datenschema 2).
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const core = require(path.join(ROOT, 'perf', 'perf.js'));

function readJson(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return { buf, data: JSON.parse(buf.toString('utf8')) };
}
// Die Daten, wie sie ausgeliefert werden (Ablesung linear), für die Datentests; die Tests der Rechenmechanik rechnen
// mit der Ableseregel bis VERSION 6 (tests/helpers/ablesung.js), die Interpolation prüft perf-interpolation.test.js.
const { alteAblesung } = require('./helpers/ablesung.js');
const C172D_DATA = readJson('perf/aircraft/c172d.json').data;
const P2010_DATA = readJson('perf/aircraft/p2010.json').data;
const C152_DATA = readJson('perf/aircraft/c152.json').data;
const P2008_DATA = readJson('perf/aircraft/p2008.json').data;
const C172D = alteAblesung(C172D_DATA);
const P2010 = alteAblesung(P2010_DATA);
const C152 = alteAblesung(C152_DATA);
const INDEX = readJson('perf/aircraft/index.json').data;
const AF = readJson('perf/airfields/lszk.json').data;
const LYC = readJson('tests/fixtures/c172s_lycoming.json').data;
const FT_5B = readJson('tests/fixtures/c172d_5b_1157kg_ft.json').data;
const M_5A_1111 = readJson('tests/fixtures/c172d_5a_1111kg_m.json').data;
const P2010_FT = readJson('tests/fixtures/p2010_ft.json').data;
const P2010_ISA = readJson('tests/fixtures/p2010_isa.json').data;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.keys(o).forEach((k) => deepFreeze(o[k]));
  }
  return o;
}
function rwy(res, id) { return res.runways.find((r) => r.id === id); }
function wx(tempC, qnhHpa, windDirTrue, windKt, runwayWet) {
  return { tempC, qnhHpa, windDirTrue, windKt, runwayWet: runwayWet === true };
}
function run(input, ac, af) {
  const r = core.compute(ac || C172D, af || AF, input);
  assert.equal(r.ok, true, 'Rechnung ok erwartet: ' + JSON.stringify(r.error));
  return r;
}
function meters(p) { return [p.m.groundRoll, p.m.overObstacle]; }
function close(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≠ ' + b); }
// Hartbelag-Testplatz wie beim Planer: Piste 36, 1070 m Start, 915 m Landung
function pavedField(elevFt) {
  return {
    schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, bearingMag: 360, surface: 'paved',
      takeoffAvailable: { value: 1070, unit: 'm' }, landingAvailable: { value: 915, unit: 'm' } }]
  };
}
// Sample Problem des Supplements: Tabelle 1111 kg (Section 5a, Figure 5-1e) mit den Regeln der c172d
function sample5a1111() {
  const a = clone(C172D);
  a.charts.takeoff.table.cells = M_5A_1111.cells;
  return a;
}

/* ── Daten ─────────────────────────────────────────────────── */

test('Daten: JSON ohne BOM, Schema 2, Validierung ok', () => {
  ['perf/aircraft/c172d.json', 'perf/aircraft/p2010.json', 'perf/aircraft/c152.json', 'perf/aircraft/p2008.json', 'perf/aircraft/index.json',
    'perf/airfields/lszk.json', 'tests/fixtures/c172s_lycoming.json', 'tests/fixtures/c172d_5b_1157kg_ft.json', 'tests/fixtures/c172d_5a_1111kg_m.json',
    'tests/fixtures/p2010_ft.json', 'tests/fixtures/p2010_isa.json', 'tests/fixtures/kontrollfaelle.json'].forEach((rel) => {
    const { buf } = readJson(rel);
    assert.ok(!(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf), rel + ' hat ein BOM');
  });
  [C172D_DATA, P2010_DATA, C152_DATA, P2008_DATA, C172D, P2010, C152, LYC].forEach((ac) => {
    assert.deepEqual(core.validateAircraft(ac), { ok: true, errors: [] }, ac.id);
  });
  assert.deepEqual(core.validateAirfield(AF), { ok: true, errors: [] });
  assert.equal(AF.schema, 2);
  assert.equal(INDEX.schema, 2);
});

test('Daten: Auswahl mit vier Mustern und Kennzeichen, Lycoming nicht mehr in perf/aircraft', () => {
  assert.equal(INDEX.default, 'c172d');
  assert.deepEqual(INDEX.aircraft.map((a) => [a.id, a.label, a.file, a.registrations]), [
    ['c172d', 'Cessna 172 Diesel', 'c172d.json', ['HB-TDA', 'HB-TDB', 'HB-TDC', 'HB-TDD']],
    ['p2010', 'Tecnam P2010', 'p2010.json', ['HB-KMD']],
    ['c152', 'Cessna 152', 'c152.json', ['HB-CFA', 'HB-CYF', 'HB-CYP']],
    ['p2008', 'Tecnam P2008', 'p2008.json', ['HB-KMG', 'HB-KMH', 'HB-KMX']]
  ]);
  assert.equal(C172D_DATA.label, 'Cessna 172 Diesel');
  assert.equal(P2010_DATA.label, 'Tecnam P2010');
  assert.deepEqual([C152_DATA.id, C152_DATA.label], ['c152', 'Cessna 152']);
  assert.deepEqual([P2008_DATA.id, P2008_DATA.label], ['p2008', 'Tecnam P2008']);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'perf', 'aircraft')).sort(), ['c152.json', 'c172d.json', 'index.json', 'p2008.json', 'p2010.json']);
});

test('Daten: keine Rückenwind-Regel, Quelle je Chart, Masse wie gedruckt', () => {
  ['perf/aircraft/c172d.json', 'perf/aircraft/p2010.json', 'perf/aircraft/c152.json', 'tests/fixtures/c172s_lycoming.json'].forEach((rel) => {
    assert.ok(!/tailwind/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), rel);
  });
  // Cessna 152: ein Handbuch für Start und Landung, Gewicht im Handbuch nur in Pfund
  assert.deepEqual([C152.charts.takeoff.source, C152.charts.landing.source, Object.keys(C152.sources)], ['poh', 'poh', ['poh']]);
  assert.equal(C152.sources.poh.title, "Pilot's Operating Handbook and FAA Approved Airplane Flight Manual, 1980 Model 152");
  assert.equal(C152.sources.poh.number, 'D1170-1-13PH');
  ['1 July 1979', 'Revision 1', '31 March 1983', '5-11', '5-19'].forEach((s) => assert.ok(C152.sources.poh.issue.includes(s), s));
  ['HB-CYF', 'F1521792', 'HB-CFA', 'HB-CYP'].forEach((s) => assert.ok(C152.sources.poh.applicabilityDe.includes(s), s));
  assert.deepEqual(C152.mass, { kg: 758, lb: 1670 });
  assert.ok(Math.abs(C152.mass.lb * core.LB_KG - C152.mass.kg) < 0.51, 'kg passt zu den gedruckten Pfund');
  assert.deepEqual(C152.charts.takeoff.ref, { figure: 'Figure 5-4', page: '5-11' });
  assert.deepEqual(C152.charts.landing.ref, { figure: 'Figure 5-10', page: '5-19' });
  assert.equal(C172D.charts.takeoff.source, 'supplement');
  assert.equal(C172D.charts.landing.source, 'poh');
  assert.equal(P2010.charts.takeoff.source, 'afm');
  assert.equal(P2010.charts.landing.source, 'afm');
  assert.ok(C172D.sources.supplement.title.includes('TAE 125-02-114'));
  assert.equal(C172D.sources.poh.number, '172SIMBUS-00');
  assert.equal(P2010.sources.afm.number, 'Doc. No. 2010/100');
  assert.deepEqual(C172D.mass, { kg: 1157, lb: 2550 });
  assert.deepEqual(P2010.mass, { kg: 1160, lb: 2557 });
  assert.deepEqual(C172D.charts.takeoff.ref, { figure: 'Figure 5-1a (Section 5b)', page: '5b-3' });
  assert.deepEqual(P2010.charts.takeoff.ref, { figure: 'Section 5, Ziffer 7', page: 'APV5-8' });
  assert.deepEqual(P2010.charts.landing.ref, { figure: 'Section 5, Ziffer 11', page: 'APV5-17' });
});

// Wörtliche Zweitkopien der Tabellen. Supplement TAE 125-02-114, Section 5b, Figure 5-1a [m], 1157 kg
// (Zeilen 0 bis 10'000 ft, Spalten −20, 0, 10, 20, 30, 40, 50 °C):
const C172D_TAKEOFF = [
  [[201, 314], [232, 362], [248, 388], [266, 417], [284, 445], [313, 491], [352, 555]],
  [[215, 336], [248, 388], [266, 416], [285, 447], [305, 477], [335, 526], [377, 594]],
  [[230, 360], [266, 416], [285, 446], [306, 479], [326, 511], [359, 564], [404, 637]],
  [[247, 386], [285, 446], [306, 478], [328, 513], [350, 548], [385, 604], [434, 683]],
  [[265, 414], [306, 479], [328, 513], [352, 551], [376, 588], [413, 649], [465, 733]],
  [[284, 445], [329, 514], [352, 550], [378, 591], [403, 631], [444, 696], [499, 787]],
  [[305, 478], [353, 552], [378, 591], [406, 635], [433, 678], [477, 748], [536, 845]],
  [[335, 524], [387, 605], [414, 648], [445, 696], [475, 743], [522, 819], [588, 926]],
  [[367, 574], [424, 663], [454, 710], [487, 763], [520, 814], [573, 898], [644, 1015]],
  [[406, 636], [470, 735], [503, 787], [540, 845], [576, 902], [634, 996], [713, 1125]],
  [[450, 705], [520, 815], [557, 873], [598, 937], [638, 1000], [703, 1104], [790, 1247]]
];
// Grundhandbuch 172S, Figure 5-11, S. 5-24 [ft], 2550 lb (Zeilen 0 bis 8000 ft, Spalten 0 bis 40 °C):
const C172D_LANDING = [
  [[545, 1290], [565, 1320], [585, 1350], [605, 1380], [625, 1415]],
  [[565, 1320], [585, 1350], [605, 1385], [625, 1420], [650, 1450]],
  [[585, 1355], [610, 1385], [630, 1420], [650, 1455], [670, 1490]],
  [[610, 1385], [630, 1425], [655, 1460], [675, 1495], [695, 1530]],
  [[630, 1425], [655, 1460], [675, 1495], [700, 1535], [725, 1570]],
  [[655, 1460], [680, 1500], [705, 1535], [725, 1575], [750, 1615]],
  [[680, 1500], [705, 1540], [730, 1580], [755, 1620], [780, 1660]],
  [[705, 1545], [730, 1585], [760, 1625], [785, 1665], [810, 1705]],
  [[735, 1585], [760, 1630], [790, 1670], [815, 1715], [840, 1755]]
];
// Tecnam P2010 AFM, APV5-8 und APV5-17 [m], 1160 kg (Zeilen S.L. bis 6000 ft, Spalten −25, 0, 25, 50 °C):
const P2010_TAKEOFF = [
  [[234, 421], [295, 526], [364, 644], [442, 776]],
  [[256, 458], [322, 572], [397, 701], [482, 844]],
  [[279, 499], [352, 622], [434, 762], [526, 918]],
  [[305, 543], [384, 678], [474, 830], [575, 1000]],
  [[333, 591], [420, 738], [518, 904], [628, 1089]],
  [[364, 645], [459, 805], [566, 986], [687, 1188]],
  [[399, 703], [502, 878], [620, 1075], [752, 1296]]
];
const P2010_LANDING = [
  [[204, 488], [225, 509], [245, 529], [266, 550]],
  [[212, 496], [233, 517], [254, 538], [276, 560]],
  [[220, 504], [242, 526], [264, 548], [286, 570]],
  [[228, 512], [251, 535], [274, 558], [297, 581]],
  [[236, 520], [260, 544], [284, 568], [308, 592]],
  [[245, 529], [270, 554], [295, 579], [320, 604]],
  [[255, 539], [280, 564], [306, 590], [332, 616]]
];
// Cessna 152, Pilot's Operating Handbook 1980 Model 152 [ft], 1670 lbs, am Seitenbild gelesen (der Scan hat keine Textebene).
// Zeilen S.L. bis 8000 ft, Spalten 0, 10, 20, 30, 40 °C. Figure 5-4, S. 5-11 (Takeoff Distance, Short Field):
const C152_TAKEOFF = [
  [[640, 1190], [695, 1290], [755, 1390], [810, 1495], [875, 1605]],
  [[705, 1310], [765, 1420], [825, 1530], [890, 1645], [960, 1770]],
  [[775, 1445], [840, 1565], [910, 1690], [980, 1820], [1055, 1960]],
  [[855, 1600], [925, 1730], [1000, 1870], [1080, 2020], [1165, 2185]],
  [[940, 1775], [1020, 1920], [1100, 2080], [1190, 2250], [1285, 2440]],
  [[1040, 1970], [1125, 2140], [1215, 2320], [1315, 2525], [1420, 2750]],
  [[1145, 2200], [1245, 2395], [1345, 2610], [1455, 2855], [1570, 3125]],
  [[1270, 2470], [1375, 2705], [1490, 2960], [1615, 3255], [1745, 3590]],
  [[1405, 2800], [1525, 3080], [1655, 3395], [1795, 3765], [1940, 4195]]
];
// Figure 5-10, S. 5-19 (Landing Distance, Short Field):
const C152_LANDING = [
  [[450, 1160], [465, 1185], [485, 1215], [500, 1240], [515, 1265]],
  [[465, 1185], [485, 1215], [500, 1240], [520, 1270], [535, 1295]],
  [[485, 1215], [500, 1240], [520, 1270], [535, 1300], [555, 1330]],
  [[500, 1240], [520, 1275], [540, 1305], [560, 1335], [575, 1360]],
  [[520, 1275], [540, 1305], [560, 1335], [580, 1370], [600, 1400]],
  [[540, 1305], [560, 1335], [580, 1370], [600, 1400], [620, 1435]],
  [[560, 1340], [580, 1370], [605, 1410], [625, 1440], [645, 1475]],
  [[585, 1375], [605, 1410], [625, 1440], [650, 1480], [670, 1515]],
  [[605, 1410], [630, 1450], [650, 1480], [675, 1520], [695, 1555]]
];

test('Daten: alle Tabellenwerte wörtlich (c172d 154 + 90, p2010 56 + 56, c152 90 + 90)', () => {
  assert.deepEqual(C152.charts.takeoff.table.cells, C152_TAKEOFF);
  assert.deepEqual(C152.charts.landing.table.cells, C152_LANDING);
  assert.deepEqual(C172D.charts.takeoff.table.cells, C172D_TAKEOFF);
  assert.deepEqual(C172D.charts.landing.table.cells, C172D_LANDING);
  assert.deepEqual(P2010.charts.takeoff.table.cells, P2010_TAKEOFF);
  assert.deepEqual(P2010.charts.landing.table.cells, P2010_LANDING);
  assert.deepEqual(LYC.charts.landing.table.cells, C172D_LANDING);
});

// Zeichenketten einer Datei mit Pfad, z. B. «charts.takeoff.notesDe[0]»
function strings(o, p, out) {
  if (typeof o === 'string') out[p] = o;
  else if (Array.isArray(o)) o.forEach((v, i) => strings(v, p + '[' + i + ']', out));
  else if (o && typeof o === 'object') Object.keys(o).forEach((k) => strings(o[k], p ? p + '.' + k : k, out));
  return out;
}

test('Daten: alle Texte der Flugzeug-, Listen- und Platzdateien wörtlich (Abschrift tests/fixtures/texte.json)', () => {
  // Die Texte sind am Handbuch geprüft (Bedingungen, Notes, Quellen, Fusszeile). Wer eine Datei ändert, muss die
  // Abschrift bewusst nachführen; ein neues Muster der Auswahl braucht ebenfalls eine.
  const FIX = readJson('tests/fixtures/texte.json').data;
  const files = INDEX.aircraft.map((e) => 'perf/aircraft/' + e.file).concat(['perf/aircraft/index.json', 'perf/airfields/lszk.json']);
  assert.deepEqual(Object.keys(FIX).sort(), files.slice().sort(), 'Abschrift je Datei');
  files.forEach((f) => assert.deepEqual(strings(readJson(f).data, '', {}), FIX[f], f));
  assert.equal(FIX['perf/aircraft/c152.json']['charts.takeoff.notesDe[0]'], 'Gegenwind: −10 % je 9 kt.');
  assert.ok(FIX['perf/aircraft/c152.json'].footerDe.startsWith('Richtwert nach AFM ohne eigenen Sicherheitszuschlag'));
});

test('Daten: Achsen, Einheiten und Ablesung je Tabelle (alles linear, Startgewicht linear; Wunsch 20.11.2026)', () => {
  const ax = (ch) => ch.table.axes.map((a) => [a.quantity, a.values, a.read]);
  const PA = (max) => Array.from({ length: max / 1000 + 1 }, (_, i) => i * 1000);
  assert.deepEqual(ax(C172D_DATA.charts.takeoff), [['pressureAltitude', PA(10000), 'linear'], ['temperature', [-20, 0, 10, 20, 30, 40, 50], 'linear']]);
  assert.deepEqual(ax(C172D_DATA.charts.landing), [['pressureAltitude', PA(8000), 'linear'], ['temperature', [0, 10, 20, 30, 40], 'linear']]);
  [P2010_DATA.charts.takeoff, P2010_DATA.charts.landing].forEach((ch) => {
    assert.deepEqual(ax(ch), [['pressureAltitude', PA(6000), 'linear'], ['temperature', [-25, 0, 25, 50], 'linear']]);
  });
  [P2008_DATA.charts.takeoff, P2008_DATA.charts.landing].forEach((ch) => {
    assert.deepEqual(ax(ch), [['pressureAltitude', PA(10000), 'linear'], ['temperature', [-25, 0, 25, 50], 'linear']]);
  });
  // Starttabellen für tiefere Gewichte: gleiche Achsen wie die Haupttabelle (der Kern prüft das), Ablesung linear
  [C172D_DATA, P2010_DATA, P2008_DATA].forEach((ac) => {
    assert.equal(ac.charts.takeoff.massRead, 'linear', ac.id);
    assert.equal(ac.charts.landing.massRead, undefined, ac.id);
    ac.charts.takeoff.lowerWeights.forEach((e) => assert.deepEqual(ax(e), ax(ac.charts.takeoff), ac.id + ' ' + e.mass.kg));
  });
  assert.equal(C152_DATA.charts.takeoff.lowerWeights, undefined);
  const units = (ch) => ch.table.outputs.map((o) => o.unit);
  assert.deepEqual(units(C172D_DATA.charts.takeoff), ['m', 'm']);
  assert.deepEqual(units(C172D_DATA.charts.landing), ['ft', 'ft']);
  assert.deepEqual(units(P2010_DATA.charts.takeoff), ['m', 'm']);
  assert.deepEqual(units(P2010_DATA.charts.landing), ['m', 'm']);
  assert.deepEqual(units(P2008_DATA.charts.takeoff), ['m', 'm']);
  assert.deepEqual(units(P2008_DATA.charts.landing), ['m', 'm']);
  [C152_DATA.charts.takeoff, C152_DATA.charts.landing].forEach((ch) => {
    assert.deepEqual(ax(ch), [['pressureAltitude', PA(8000), 'linear'], ['temperature', [0, 10, 20, 30, 40], 'linear']]);
    assert.deepEqual(units(ch), ['ft', 'ft']);
    assert.deepEqual(ch.base, { surface: 'paved', surfaceCondition: 'dry' });
  });
  // Die Hilfe für die Mechanik-Tests stellt genau die Regel bis VERSION 6 her
  const old = (ac) => [ac.charts.takeoff.table, ac.charts.landing.table].concat((ac.charts.takeoff.lowerWeights || []).map((e) => e.table))
    .map((t) => t.axes.map((a) => a.read).join('/'));
  assert.deepEqual([old(C172D), old(P2010), old(C152)].map((x) => [...new Set(x)]), [['nextHigher/nextHigher'], ['nextHigher/linear'], ['nextHigher/nextHigher']]);
  assert.deepEqual([C172D, P2010, C152].map((ac) => ac.charts.takeoff.massRead), [undefined, undefined, undefined]);
});

function fp(cells, o, cols) {
  let s = 0, w = 0;
  cells.forEach((row, i) => row.forEach((c, j) => { s += c[o]; w += c[o] * (i * cols + j + 1); }));
  return [s, w];
}

test('Daten: Fingerabdrücke (Summe und gewichtete Summe) wie aus der PDF-Textebene', () => {
  assert.deepEqual(fp(C172D_TAKEOFF, 0, 7), [31253, 1404405]);
  assert.deepEqual(fp(C172D_TAKEOFF, 1, 7), [49000, 2202439]);
  assert.deepEqual(fp(P2010_TAKEOFF, 0, 4), [12369, 199993]);
  assert.deepEqual(fp(P2010_TAKEOFF, 1, 4), [21692, 349448]);
  assert.deepEqual(fp(P2010_LANDING, 0, 4), [7368, 111984]);
  assert.deepEqual(fp(P2010_LANDING, 1, 4), [15320, 227288]);
  assert.deepEqual([fp(C172D_LANDING, 0, 5)[0], fp(C172D_LANDING, 1, 5)[0]], [30645, 67630]);
  assert.deepEqual([fp(LYC.charts.takeoff.table.cells, 0, 5)[0], fp(LYC.charts.takeoff.table.cells, 1, 5)[0]], [67205, 117830]);
});

test('Daten: Cessna 152 – Fingerabdrücke aus zwei Lesungen am Seitenbild, Proben gegen andere Blätter des Handbuchs', () => {
  assert.deepEqual(fp(C152_TAKEOFF, 0, 5), [51730, 1366485]);
  assert.deepEqual(fp(C152_TAKEOFF, 1, 5), [100100, 2692830]);
  assert.deepEqual(fp(C152_LANDING, 0, 5), [25315, 615480]);
  assert.deepEqual(fp(C152_LANDING, 1, 5), [60340, 1441315]);
  // alle Werte auf 5 ft gerundet gedruckt
  [C152_TAKEOFF, C152_LANDING].forEach((c) => c.forEach((row) => row.forEach((cell) => cell.forEach((v) => assert.equal(v % 5, 0, String(v))))));
  // Sample Problem (S. 5-4 und 5-7): Zelle 2000 ft / 30 °C
  assert.deepEqual([C152_TAKEOFF[2][3], C152_LANDING[2][3]], [[980, 1820], [535, 1300]]);
  // Performance-Specifications (S. ii): Meereshöhe, Standardtemperatur 15 °C = Mitte zwischen den Spalten 10 und 20 °C
  const mid = (c, o) => (c[0][1][o] + c[0][2][o]) / 2;
  assert.deepEqual([mid(C152_TAKEOFF, 0), mid(C152_TAKEOFF, 1), mid(C152_LANDING, 0), mid(C152_LANDING, 1)], [725, 1340, 475, 1200]);
  // Glatter Verlauf (zweite Differenzen in Höhe und Temperatur, Werte auf 5 ft gerundet): der Start wächst immer
  // schneller (konvex, −5 bis +140 ft), die Landung fast linear (höchstens ±10 ft). Ein verlesener Zehner fällt so auf.
  [[C152_TAKEOFF, -5, 140], [C152_LANDING, -10, 10]].forEach(([c, lo, hi], t) => [0, 1].forEach((o) => {
    for (let i = 0; i < 9; i++) for (let j = 0; j < 5; j++) {
      const d2 = [i > 1 ? c[i][j][o] - 2 * c[i - 1][j][o] + c[i - 2][j][o] : 0, j > 1 ? c[i][j][o] - 2 * c[i][j - 1][o] + c[i][j - 2][o] : 0];
      d2.forEach((d, k) => assert.ok(d >= lo && d <= hi, (t ? 'Landung' : 'Start') + ' ' + (k ? 'Temperatur' : 'Höhe') + ' ' + i + '/' + j + '/' + o + ': ' + d));
    }
  }));
});

test('Daten: m-Tabellen gegen die gedruckten ft-Werte (höchstens 1 m Rundungsunterschied)', () => {
  C172D_TAKEOFF.forEach((row, i) => row.forEach((c, j) => [0, 1].forEach((o) => {
    close(c[o], FT_5B.cells[i][j][o] * 0.3048, 1, 'c172d ' + i + '/' + j + '/' + o);
  })));
  [['takeoff', P2010_TAKEOFF], ['landing', P2010_LANDING]].forEach(([ph, cells]) => cells.forEach((row, i) => row.forEach((c, j) => [0, 1].forEach((o) => {
    close(c[o], P2010_FT[ph].cells[i][j][o] * 0.3048, 1, 'p2010 ' + ph + ' ' + i + '/' + j + '/' + o);
  }))));
});

test('Daten: Tecnam-Landung hat überall 284 m Luftstrecke', () => {
  P2010_LANDING.forEach((row) => row.forEach((c) => assert.equal(c[1] - c[0], 284)));
});

test('Daten: Monotonie und 15-m-Strecke grösser als Rollstrecke', () => {
  [C172D_TAKEOFF, C172D_LANDING, P2010_TAKEOFF, P2010_LANDING, C152_TAKEOFF, C152_LANDING].forEach((c, t) => {
    for (let i = 0; i < c.length; i++) {
      for (let j = 0; j < c[i].length; j++) {
        for (let o = 0; o < 2; o++) {
          if (i > 0) assert.ok(c[i][j][o] > c[i - 1][j][o], 'Höhe ' + t + ' ' + i + '/' + j);
          if (j > 0) assert.ok(c[i][j][o] > c[i][j - 1][o], 'Temperatur ' + t + ' ' + i + '/' + j);
        }
        assert.ok(c[i][j][1] > c[i][j][0]);
      }
    }
  });
});

test('Daten: Tecnam-Start in der Temperatur konvex, Landung linear (Interpolation nicht unter der Kurve)', () => {
  P2010_TAKEOFF.forEach((row) => [0, 1].forEach((o) => {
    for (let j = 1; j < row.length - 1; j++) assert.ok(row[j + 1][o] - 2 * row[j][o] + row[j - 1][o] >= 0);
  }));
  P2010_LANDING.forEach((row) => [0, 1].forEach((o) => {
    for (let j = 1; j < row.length - 1; j++) assert.ok(Math.abs(row[j + 1][o] - 2 * row[j][o] + row[j - 1][o]) <= 1);
  }));
});

test('Daten: Korrekturregeln wie in den AFM-Notes', () => {
  const rules = (ch) => ch.corrections.map((c) => clone(c));
  assert.deepEqual(rules(C172D.charts.takeoff), [
    { kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' },
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 15, of: 'groundRoll' },
    { kind: 'factor', when: 'wet', surface: 'grass', factor: 1.2, minimum: true, labelDe: 'nasse Piste', refDe: 'Supplement, Note 4' }
  ]);
  assert.deepEqual(rules(C172D.charts.landing), [
    { kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' },
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 45, of: 'groundRoll' }
  ]);
  // Cessna 152 (Figure 5-4 Notes 3 und 4, Figure 5-10 Notes 2 und 3): kein Wert für nasses Gras, also kein Faktor
  assert.deepEqual(rules(C152.charts.takeoff), [
    { kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' },
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 15, of: 'groundRoll' }
  ]);
  assert.deepEqual(rules(C152.charts.landing), [
    { kind: 'headwind', type: 'percentPer', percent: -10, per: 9, unit: 'kt' },
    { kind: 'surface', type: 'addPercentOf', surface: 'grass', surfaceCondition: 'dry', percent: 45, of: 'groundRoll' }
  ]);
  const t = P2010.charts.takeoff.corrections, l = P2010.charts.landing.corrections;
  assert.deepEqual(t[0], { kind: 'headwind', type: 'absolutePer', amount: -10, amountUnit: 'm', per: 1, unit: 'kt' });
  assert.deepEqual(l[0], { kind: 'headwind', type: 'absolutePer', amount: -4, amountUnit: 'm', per: 1, unit: 'kt' });
  assert.equal(t[1].percent, 10);
  assert.equal(l[1].percent, 10);
  assert.deepEqual([t[2].when, t[2].factor, t[2].refDe], ['always', 1.1, 'NOTE, APV5-8']);
  assert.deepEqual([l[2].when, l[2].factor, l[2].refDe], ['always', 1.67, 'NOTE, APV5-17']);
});

test('Daten: Platz LSZK', () => {
  assert.deepEqual(AF.elevation, { value: 1759, unit: 'ft' });
  const r12 = AF.runways.find((r) => r.id === '12');
  const r30 = AF.runways.find((r) => r.id === '30');
  assert.deepEqual([r12.bearingTrue, r30.bearingTrue, r12.bearingMag, r30.bearingMag], [124, 304, 120, 300]);
  assert.deepEqual([r12.takeoffAvailable.value, r12.landingAvailable.value, r30.takeoffAvailable.value, r30.landingAvailable.value], [520, 625, 625, 520]);
  assert.deepEqual([r12.surface, r30.surface], ['grass', 'grass']);
});

/* ── Kern: Ablesung ────────────────────────────────────────── */

test('Druckhöhe: Kontrollwerte', () => {
  [[1013.25, 1759.0], [1018, 1629.52], [998.2, 2172.52], [1004.4, 2001.56], [1004.5, 1998.81]].forEach(([q, pa]) => {
    close(core.pressureAltitudeFt(1759, q), pa, 0.1, 'QNH ' + q);
  });
});

test('Ablesung nächsthöherer Wert: Grenzen genau, knapp darüber, darunter, über dem Bereich', () => {
  const t = C172D.charts.takeoff.table;
  const at = (pa, temp) => core.lookupTable(t, { pressureAltitude: pa, temperature: temp });
  assert.deepEqual(at(2000, 20).axisValues, [2000, 20]);
  assert.deepEqual(at(2000, 20).values, { groundRoll: 306, overObstacle: 479 });
  assert.deepEqual(at(2000.001, 20.01).axisValues, [3000, 30]);
  assert.deepEqual(at(-500, -25).axisValues, [0, -20]);
  assert.equal(at(-500, -25).interpolated, false);
  assert.deepEqual(at(10000, 50).values, { groundRoll: 790, overObstacle: 1247 });
  assert.deepEqual(at(10000.1, 10).above.map((a) => a.quantity), ['pressureAltitude']);
  assert.deepEqual(at(1000, 50.01).above.map((a) => a.quantity), ['temperature']);
});

test('Interpolation Tecnam: Spaltentreffer, Klemmen unter −25 °C, kein Wert über 50 °C, gleiches Gewicht', () => {
  const t = P2010.charts.takeoff.table;
  const at = (temp, pa) => core.lookupTable(t, { pressureAltitude: pa === undefined ? 2000 : pa, temperature: temp });
  [[-25, 0], [0, 1], [25, 2], [50, 3]].forEach(([temp, j]) => {
    const lk = at(temp);
    assert.equal(lk.interpolated, false, 'Spalte ' + temp);
    assert.deepEqual(lk.values, { groundRoll: P2010_TAKEOFF[2][j][0], overObstacle: P2010_TAKEOFF[2][j][1] });
  });
  assert.deepEqual(at(-30).values, at(-25).values);
  assert.equal(at(-30).axes[1].belowLowest, true);
  assert.deepEqual(at(50.1).above, [{ quantity: 'temperature', unit: 'degC', value: 50.1, max: 50 }]);
  const mid = at(12.5);
  assert.equal(mid.interpolated, true);
  assert.deepEqual([mid.axes[1].lower, mid.axes[1].upper, mid.axes[1].weight], [0, 25, 0.5]);
  assert.deepEqual(mid.values, { groundRoll: (352 + 434) / 2, overObstacle: (622 + 762) / 2 });
  // gleiches Gewicht für beide Ausgaben
  const lk = at(10.8, 3000);
  const w = lk.axes[1].weight;
  close(w, 0.432, 1e-12);
  close(lk.values.groundRoll, 384 + w * (474 - 384), 1e-9);
  close(lk.values.overObstacle, 678 + w * (830 - 678), 1e-9);
});

test('Interpolation Tecnam: kein Sprung an den Spalten, monoton in der Temperatur', () => {
  ['takeoff', 'landing'].forEach((ph) => {
    const t = P2010.charts[ph].table;
    const v = (temp) => core.lookupTable(t, { pressureAltitude: 1759, temperature: temp }).values;
    [-0.001, 24.999].forEach((x) => {
      const a = v(x), b = v(Math.round(x)), c = v(Math.round(x) + 0.001);
      ['groundRoll', 'overObstacle'].forEach((o) => {
        assert.ok(Math.abs(a[o] - b[o]) < 0.01 && Math.abs(c[o] - b[o]) < 0.01, ph + ' Sprung bei ' + Math.round(x));
      });
    });
    let prev = null;
    for (let temp = -40; temp <= 50; temp += 0.25) {
      const cur = v(temp);
      if (prev) assert.ok(cur.groundRoll >= prev.groundRoll && cur.overObstacle >= prev.overObstacle, ph + ' ' + temp);
      prev = cur;
    }
  });
});

test('Interpolation Tecnam: Probe gegen die gedruckte ISA-Spalte (Start 0 bis +2,5 m, Landung ±1 m)', () => {
  P2010_ISA.rows.forEach((row) => {
    ['takeoff', 'landing'].forEach((ph) => {
      const lk = core.lookupTable(P2010.charts[ph].table, { pressureAltitude: row.pressureAltitudeFt, temperature: row.isaTempC });
      [0, 1].forEach((o) => {
        const d = lk.values[o === 0 ? 'groundRoll' : 'overObstacle'] - row[ph][o];
        if (ph === 'takeoff') assert.ok(d >= -1e-9 && d <= 2.5, 'Start ' + row.pressureAltitudeFt + ' ft: ' + d);
        else assert.ok(Math.abs(d) <= 1, 'Landung ' + row.pressureAltitudeFt + ' ft: ' + d);
      });
    });
  });
});

/* ── Kern: Pistenwahl und Wind ─────────────────────────────── */

test('Pistenwahl: nur die Gegenwindpiste, Rückenwindpiste nicht gerechnet', () => {
  const r = run(wx(15, 1018, 290, 8));
  assert.equal(r.mode, 'dir');
  assert.deepEqual([rwy(r, '12').computed, rwy(r, '12').reason, rwy(r, '12').takeoff], [false, 'tailwind', null]);
  assert.deepEqual([rwy(r, '30').computed, rwy(r, '30').wind.kind, rwy(r, '30').wind.kt], [true, 'headwind', 7]);
  close(rwy(r, '30').wind.componentKt, 7.7624, 1e-4);
  close(rwy(r, '12').wind.componentKt, 7.7624, 1e-4);
  assert.equal(r.computedCount, 1);
});

test('Pistenwahl: windstill, ohne Richtung bis 3 kt, darüber kein Wert, genau quer, unter 1 kt Komponente', () => {
  let r = run(wx(15, 1013.25, 90, 0.99));
  assert.equal(r.mode, 'calm');
  r.runways.forEach((x) => assert.deepEqual([x.computed, x.wind.kt, x.takeoff.wind.applied], [true, 0, false]));
  r = run(wx(15, 1013.25, 304, 1.0));
  assert.equal(r.mode, 'dir');
  assert.deepEqual([rwy(r, '30').wind.kt, rwy(r, '12').computed], [1, false]);
  r = run(wx(15, 1013.25, null, 3));
  assert.equal(r.mode, 'nodir');
  assert.equal(r.computedCount, 2);
  r = run(wx(15, 1013.25, null, 3.01));
  assert.equal(r.mode, 'no-direction');
  r.runways.forEach((x) => assert.deepEqual([x.computed, x.reason, x.takeoff], [false, 'no-direction', null]));
  r = run(wx(15, 1013.25, null, 0.5));
  assert.equal(r.mode, 'calm');
  // genau quer: beide Pisten ohne Windkorrektur
  r = run(wx(25, 1015, 214, 10));
  r.runways.forEach((x) => assert.deepEqual([x.computed, x.wind.along, x.wind.kt], [true, 0, 0]));
  r = run(wx(25, 1015, 34, 10));
  r.runways.forEach((x) => assert.deepEqual([x.computed, x.wind.along], [true, 0]));
  // knapp neben quer: Gegenwindkomponente unter 1 kt, nicht angerechnet
  r = run(wx(25, 1015, 215, 10));
  assert.deepEqual([rwy(r, '30').computed, rwy(r, '30').wind.kt, rwy(r, '30').wind.kind], [true, 0, 'none']);
  assert.ok(rwy(r, '30').wind.along > 0);
  assert.equal(rwy(r, '12').computed, false);
});

test('Pistenwahl: Umlauf über 360°, Böe ohne Einfluss', () => {
  const a = run(wx(15, 1013.25, 360, 10)), b = run(wx(15, 1013.25, 0, 10));
  assert.deepEqual(meters(rwy(a, '30').takeoff), meters(rwy(b, '30').takeoff));
  assert.equal(rwy(a, '30').wind.kt, 5);                     // cos 56° · 10 = 5,59
  const base = run(wx(15, 1018, 290, 8));
  [0, 14, 40, 'x', null].forEach((g) => {
    const r = run(Object.assign(wx(15, 1018, 290, 8), { gustKt: g }));
    assert.deepEqual(JSON.stringify(r.runways), JSON.stringify(base.runways), 'Böe ' + g);
  });
});

test('Wind: Prozent (Cessna) und absolut (Tecnam) je kt, abgerundet', () => {
  let p = rwy(run(wx(15, 1018, 290, 8)), '30').takeoff;          // 7,76 → 7 kt → −7 %
  assert.deepEqual([p.wind.type, p.wind.percent], ['percentPer', 7]);
  close(p.afterWind.groundRoll, 306 * 0.93, 1e-9);
  p = rwy(run(wx(15, 1018, 290, 8), P2010), '30').takeoff;       // 7 kt × 10 m = 70 m
  assert.deepEqual([p.wind.type, p.wind.perKt, p.wind.reduction], ['absolutePer', 10, 70]);
  close(p.afterWind.groundRoll, 401.2 - 70, 1e-9);
  close(p.afterWind.overObstacle, 706 - 70, 1e-9);
  p = rwy(run(wx(15, 1018, 290, 8), P2010), '30').landing;       // 7 kt × 4 m = 28 m
  assert.deepEqual([p.wind.reduction, p.wind.perKt], [28, 4]);
});

test('Wind: genau 1 kt Gegenwind wird angerechnet (Cessna −1 %, Tecnam −10 m)', () => {
  let p = rwy(run(wx(15, 1013.25, 304, 1)), '30').takeoff;       // 10 % × 1/9 = 1,1 % → 1 %
  assert.deepEqual([p.wind.kt, p.wind.applied, p.wind.type, p.wind.percent], [1, true, 'percentPer', 1]);
  close(p.afterWind.groundRoll, p.table.groundRoll * 0.99, 1e-9);
  close(p.afterWind.overObstacle, p.table.overObstacle * 0.99, 1e-9);
  p = rwy(run(wx(15, 1013.25, 304, 1), P2010), '30').landing;    // 1 kt × 4 m
  assert.deepEqual([p.wind.kt, p.wind.applied, p.wind.reduction], [1, true, 4]);
  close(p.afterWind.groundRoll, p.table.groundRoll - 4, 1e-9);
});

test('Wind: absolute Korrektur mit gebrochenem Wert wird abgerundet (−15 m je 2 kt, 3 kt → −22 m)', () => {
  const ac = clone(P2010);
  Object.assign(ac.charts.takeoff.corrections.find((c) => c.kind === 'headwind'), { amount: -15, per: 2 });
  assert.equal(core.validateAircraft(ac).ok, true);
  const p = rwy(run(wx(15, 1013.25, 304, 3), ac), '30').takeoff;   // 15 × 3 / 2 = 22,5 → 22
  assert.deepEqual([p.wind.kt, p.wind.perKt, p.wind.per, p.wind.reduction], [3, 15, 2, 22]);
  close(p.afterWind.groundRoll, p.table.groundRoll - 22, 1e-9);
  close(p.afterWind.overObstacle, p.table.overObstacle - 22, 1e-9);
});

test('Wind: Gegenwind 40 kt Wert, 41 kt kein Wert (K11a, K11b)', () => {
  const a = rwy(run(wx(15, 1013.25, 304, 40)), '30');
  assert.deepEqual([meters(a.takeoff), meters(a.landing)], [[218, 315], [194, 329]]);
  const b = rwy(run(wx(15, 1013.25, 304, 41)), '30');
  assert.deepEqual([b.takeoff.reason, b.landing.reason, b.takeoff.limitKt], ['headwind-limit', 'headwind-limit', 40]);
});

test('50-%-Regel: genau die Hälfte erlaubt, mehr kein Wert (K20a/b, T8/T9, T10/T11)', () => {
  let p = run(wx(0, 1013.25, 360, 21), P2010, pavedField(4000)).runways[0].takeoff;   // 210 m von 420 m
  assert.equal(p.ok, true);
  assert.deepEqual(meters(p), [231, 581]);
  close(p.afterWind.groundRoll, 210, 0);                                             // genau die Hälfte von 420 m
  p = run(wx(0, 1013.25, 360, 22), P2010, pavedField(4000)).runways[0].takeoff;
  assert.deepEqual([p.ok, p.reason, p.m], [false, 'wind-credit-limit', null]);
  p = rwy(run(wx(10, 1013.25, 304, 19), P2010), '30').takeoff;                         // 190 m < 192,4 m
  assert.deepEqual(meters(p), [257, 580]);
  p = rwy(run(wx(10, 1013.25, 304, 20), P2010), '30').takeoff;                         // 200 m > 192,4 m
  assert.equal(p.reason, 'wind-credit-limit');
  p = run(wx(10, 1013.25, 360, 21), P2010, pavedField(3000)).runways[0].takeoff;      // interpoliert genau 420 m
  close(p.table.groundRoll, 420, 1e-9);
  assert.deepEqual(meters(p), [231, 582]);
  p = run(wx(10, 1013.25, 360, 22), P2010, pavedField(3000)).runways[0].takeoff;
  assert.equal(p.reason, 'wind-credit-limit');
  // die Landung derselben Fälle hat einen Wert
  assert.deepEqual(meters(run(wx(0, 1013.25, 360, 22), P2010, pavedField(4000)).runways[0].landing), [288, 762]);
});

test('Meter: aufgerundet, ein Gleitkommarest über einer ganzen Zahl rundet nicht auf (EPS)', () => {
  assert.equal(core.ceilMeters(210 * 1.1), 231);              // 231,00000000000003 bei direkter Multiplikation
  assert.equal(core.ceilMeters(230.0001), 231);
  assert.equal(core.ceilMeters(231.00001), 232);              // echter Rest wie beim Planer (kleinster 2,4e-5)
  assert.equal(core.ceilMeters(231), 231);
  assert.equal(210 * 1.1 > 231, true, 'Voraussetzung: der Rest existiert');
});

/* ── Kern: Belag, Faktoren, Einheiten ──────────────────────── */

test('Faktoren: immer (Tecnam), nur nass und nur auf Gras (Cessna), Reihenfolge der Datei', () => {
  let r = rwy(run(wx(15, 1018, 290, 8), P2010), '30');
  assert.deepEqual(r.takeoff.factors.map((f) => [f.factor, f.when, f.refDe]), [[1.1, 'always', 'NOTE, APV5-8']]);
  assert.deepEqual(r.landing.factors.map((f) => [f.factor, f.when]), [[1.67, 'always']]);
  close(r.takeoff.final.groundRoll, 371.32 * 1.1, 1e-9);
  // Tecnam nass: keine Zahl ändert sich (AFM nennt keinen Wert)
  const wet = rwy(run(wx(15, 1018, 290, 8, true), P2010), '30');
  assert.deepEqual([meters(wet.takeoff), meters(wet.landing)], [meters(r.takeoff), meters(r.landing)]);
  assert.deepEqual([wet.takeoff.wetFactorMissing, wet.landing.wetFactorMissing], [true, true]);
  // Cessna: Start nass × 1,20 nach Wind und Gras, Landung ohne Faktor
  const dry = rwy(run(wx(15, 1018, 290, 8)), '30'), nass = rwy(run(wx(15, 1018, 290, 8, true)), '30');
  assert.deepEqual(dry.takeoff.factors, []);
  assert.deepEqual(nass.takeoff.factors.map((f) => [f.factor, f.when, f.minimum]), [[1.2, 'wet', true]]);
  close(nass.takeoff.final.groundRoll, 330.48 * 1.2, 1e-9);
  close(nass.takeoff.final.overObstacle, 491.37 * 1.2, 1e-9);
  assert.deepEqual(meters(nass.takeoff), [397, 590]);
  assert.deepEqual([nass.takeoff.wetFactorMissing, nass.landing.wetFactorMissing], [false, true]);
  assert.deepEqual(meters(nass.landing), meters(dry.landing));
  // Hartbelag nass: Nässefaktor gilt nur für Gras
  r = run(wx(15, 1013.25, 360, 0, true), C172D, pavedField(1759)).runways[0];
  assert.deepEqual(r.takeoff.factors, []);
  assert.equal(r.takeoff.wetFactorMissing, true);
  // Reihenfolge: zwei Faktoren in Datei-Reihenfolge
  const two = clone(P2010);
  two.charts.takeoff.corrections.push({ kind: 'factor', when: 'wet', surface: 'grass', factor: 1.25, minimum: true, labelDe: 'Test', refDe: 'Test' });
  r = rwy(run(wx(15, 1018, 290, 8, true), two), '30');
  assert.deepEqual(r.takeoff.factors.map((f) => f.factor), [1.1, 1.25]);
  close(r.takeoff.factors[0].after.groundRoll, 371.32 * 1.1, 1e-9);
  close(r.takeoff.factors[1].after.groundRoll, 371.32 * 1.1 * 1.25, 1e-9);
});

test('Faktoren: auf 1/1000 gerundet (1,015 wirkt als 1015/1000, nicht abgeschnitten als 1014/1000)', () => {
  assert.ok(1.015 * 1000 < 1015, 'Voraussetzung: Gleitkommarest unter der ganzen Zahl');
  const ac = clone(P2010);
  ac.charts.takeoff.corrections.find((c) => c.kind === 'factor').factor = 1.015;
  const p = rwy(run(wx(15, 1018, 290, 8), ac), '30').takeoff;      // K8 vor dem Faktor: 371,32 / 676,12 m
  close(p.final.groundRoll, 371.32 * 1015 / 1000, 1e-9);
  close(p.final.overObstacle, 676.12 * 1015 / 1000, 1e-9);
  assert.deepEqual(meters(p), [377, 687]);
});

test('Einheiten: Tabelle in m ohne Umrechnung, in ft mit 0,3048', () => {
  const r = rwy(run(wx(15, 1018, 290, 8)), '30');
  assert.equal(r.takeoff.unit, 'm');
  assert.deepEqual(r.takeoff.meters, r.takeoff.final);
  assert.equal(r.landing.unit, 'ft');
  close(r.landing.final.groundRoll, 869.4, 1e-9);
  close(r.landing.meters.groundRoll, 869.4 * 0.3048, 1e-9);
  close(r.landing.meters.overObstacle, 1604.1 * 0.3048, 1e-9);
  assert.deepEqual(meters(r.landing), [265, 489]);
});

test('Belag: Gras aus der Tabellen-Rollstrecke (bei Interpolation der interpolierten)', () => {
  let p = rwy(run(wx(15, 1018, 290, 8)), '30').takeoff;
  assert.deepEqual([p.surface.percent, p.surface.base], [15, 306]);
  close(p.surface.inc, 45.9, 1e-9);
  p = rwy(run(wx(15, 1018, 290, 8), P2010), '30').takeoff;
  close(p.surface.base, 401.2, 1e-9);
  close(p.surface.inc, 40.12, 1e-9);
  p = run(wx(15, 1018, 360, 8), C172D, pavedField(1759)).runways[0].takeoff;
  assert.equal(p.surface, null);
});

/* ── Kontrollbeispiele des Planers (K1–K21, T1–T16) ───────── */

// tests/fixtures/kontrollfaelle.json (auch für den Rechenweg-Test der Anzeige):
// [id, Muster, Platz ('lszk' oder Höhe des Hartbelag-Testplatzes), [tempC, QNH, Richtung, Wind, nass],
//  je Piste: Grund (nicht gerechnet) oder [Gegenwind kt, Start, Landung] mit [m Roll, m 15 m, exceeds Roll, exceeds 15 m] oder Grund]
const CASES = readJson('tests/fixtures/kontrollfaelle.json').data;

function caseAircraft(id) { return id === 'c172d' ? C172D : (id === 'p2010' ? P2010 : (id === 'c152' ? C152 : sample5a1111())); }

test('Kontrollbeispiele des Planers: 64 Fälle (davon 18 Cessna 152), Meter, exceeds und Gründe', () => {
  assert.equal(CASES.length, 64);
  assert.deepEqual(CASES.filter((c) => c[1] === 'c152').map((c) => c[0]),
    ['C1', 'C1b', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C7b', 'C8', 'C9', 'C10a', 'C10b', 'C11', 'C12', 'C13', 'C13b', 'C14']);
  CASES.forEach(([id, ac, field, inp, exp]) => {
    const r = core.compute(caseAircraft(ac), field === 'lszk' ? AF : pavedField(field), wx(inp[0], inp[1], inp[2], inp[3], inp[4]));
    if (exp === 'above-range') {
      assert.equal(r.ok, false, id);
      assert.equal(r.error.code, 'above-range', id);
      return;
    }
    assert.equal(r.ok, true, id + ' ' + JSON.stringify(r.error));
    Object.keys(exp).forEach((rid) => {
      const e = exp[rid], g = rwy(r, rid);
      if (typeof e === 'string') {
        assert.deepEqual([g.computed, g.reason], [false, e], id + ' Piste ' + rid);
        return;
      }
      assert.equal(g.computed, true, id + ' Piste ' + rid);
      assert.equal(g.wind.kt, e[0], id + ' Gegenwind ' + rid);
      [['takeoff', e[1]], ['landing', e[2]]].forEach(([ph, x]) => {
        if (x === null) return;
        const p = g[ph];
        if (typeof x === 'string') {
          assert.deepEqual([p.ok, p.reason], [false, x], id + ' ' + rid + ' ' + ph);
          return;
        }
        assert.equal(p.ok, true, id + ' ' + rid + ' ' + ph + ' ' + p.reason);
        assert.deepEqual([p.m.groundRoll, p.m.overObstacle, p.exceeds.groundRoll ? 1 : 0, p.exceeds.overObstacle ? 1 : 0], x, id + ' ' + rid + ' ' + ph);
      });
    });
  });
});

test('Kontrollbeispiele: ungerundete Zwischenwerte (K1, K3, K8, K20a, K21)', () => {
  let p = run(wx(28, 1013.25, 360, 12), sample5a1111(), pavedField(1500)).runways[0].takeoff;
  assert.deepEqual([p.lookup.axisValues, p.wind.percent], [[2000, 30], 13]);
  close(p.final.groundRoll, 288.84, 1e-9);
  close(p.final.overObstacle, 495.03, 1e-9);
  p = rwy(run(wx(15, 1018, 290, 8, true)), '30').takeoff;
  close(p.final.groundRoll, 396.576, 1e-9);
  close(p.final.overObstacle, 589.644, 1e-9);
  const k8 = rwy(run(wx(15, 1018, 290, 8), P2010), '30');
  close(k8.takeoff.table.groundRoll, 401.2, 1e-9);
  close(k8.takeoff.final.groundRoll, 408.452, 1e-9);
  close(k8.takeoff.final.overObstacle, 743.732, 1e-9);
  close(k8.landing.final.groundRoll, 422.0424, 1e-9);
  close(k8.landing.final.overObstacle, 896.3224, 1e-9);
  p = run(wx(0, 1013.25, 360, 21), P2010, pavedField(4000)).runways[0].takeoff;
  close(p.final.groundRoll, 231, 1e-9);                       // 210 × 1,1: Gleitkommarest darf nicht aufrunden
  assert.equal(p.m.groundRoll, 231);
  const k21 = rwy(run(wx(10.8, 998.2, 247, 8.7), P2010), '30').takeoff;
  assert.deepEqual([k21.lookup.axes[1].lower, k21.lookup.axes[1].upper], [0, 25]);
  close(k21.lookup.axes[1].weight, 0.432, 1e-12);
  close(k21.final.groundRoll, 467.6848, 1e-9);
});

/* ── Cessna 152: Sample Problem des Handbuchs, nasse Piste ─── */

test('Cessna 152: Sample Problem des Handbuchs (S. 5-3, 5-4 und 5-7) mit ungerundeten Zwischenwerten', () => {
  // Start: Druckhöhe 1500 ft, 28 °C, 12 kt Gegenwind, Hartbelag. Handbuch: Zelle 2000 ft / 30 °C = 980 / 1820 ft,
  // 12 kt / 9 kt × 10 % = 13 % weniger, 853 / 1583 ft.
  let p = run(wx(28, 1013.25, 360, 12), C152, pavedField(1500)).runways[0].takeoff;
  assert.deepEqual([p.lookup.axisValues, p.table, p.wind.percent, p.unit, p.surface],
    [[2000, 30], { groundRoll: 980, overObstacle: 1820 }, 13, 'ft', null]);
  close(p.final.groundRoll, 852.6, 1e-9);
  close(p.final.overObstacle, 1583.4, 1e-9);
  assert.deepEqual([Math.round(p.final.groundRoll), Math.round(p.final.overObstacle)], [853, 1583], 'wie im Handbuch gedruckt');
  assert.deepEqual(meters(p), [260, 483]);
  // Landung: Druckhöhe 2000 ft, 25 °C, ohne Wind. Handbuch: Zelle 2000 ft / 30 °C = 535 / 1300 ft.
  p = run(wx(25, 1013.25, 360, 0), C152, pavedField(2000)).runways[0].landing;
  assert.deepEqual([p.lookup.axisValues, p.final, meters(p)], [[2000, 30], { groundRoll: 535, overObstacle: 1300 }, [164, 397]]);
});

test('Cessna 152 auf Gras: Start +15 %, Landung +45 % der Rollstrecke; nass ohne Wert des Handbuchs, Zahlen unverändert', () => {
  const dry = rwy(run(wx(15, 1018, 290, 8), C152), '30'), wet = rwy(run(wx(15, 1018, 290, 8, true), C152), '30');
  assert.deepEqual([meters(dry.takeoff), meters(dry.landing)], [[300, 521], [219, 432]]);
  assert.deepEqual([dry.takeoff.surface.percent, dry.takeoff.surface.base, dry.landing.surface.percent, dry.landing.surface.base], [15, 910, 45, 520]);
  close(dry.takeoff.surface.inc, 136.5, 1e-9);
  close(dry.landing.surface.inc, 234, 1e-9);
  close(dry.takeoff.final.groundRoll, 982.8, 1e-9);
  close(dry.takeoff.final.overObstacle, 1708.2, 1e-9);
  close(dry.landing.final.groundRoll, 717.6, 1e-9);
  close(dry.landing.final.overObstacle, 1415.1, 1e-9);
  assert.deepEqual([meters(wet.takeoff), meters(wet.landing)], [meters(dry.takeoff), meters(dry.landing)]);
  assert.deepEqual([wet.takeoff.factors, wet.landing.factors], [[], []]);
  assert.deepEqual([dry.takeoff.wetFactorMissing, wet.takeoff.wetFactorMissing, wet.landing.wetFactorMissing], [false, true, true]);
  // Tabellenbereich: bis 40 °C und 8000 ft, darunter die kleinste Spalte
  assert.deepEqual(core.compute(C152, AF, wx(40.1, 1013.25, null, 0)).error.above, [{ quantity: 'temperature', unit: 'degC', value: 40.1, max: 40 }]);
  assert.deepEqual(meters(rwy(run(wx(-25, 1013.25, null, 0), C152), '30').takeoff), meters(rwy(run(wx(0, 1013.25, null, 0), C152), '30').takeoff));
});

/* ── Lycoming-Regression (Fixture, alte Startzahlen) und Landezahlen c172d ── */

test('Lycoming-Fixture: bisherige Start-Regressionszahlen, Landung c172d wie bisher', () => {
  let p = run(wx(28, 1013.25, 360, 12), LYC, pavedField(1500)).runways[0].takeoff;   // B1
  close(p.final.groundRoll, 1117.95, 1e-9);
  close(p.final.overObstacle, 1905.3, 1e-9);
  const cases = [
    // [Name, Eingabe, Piste, Start Lycoming, Landung c172d]
    ['B2', wx(15, 1018, 290, 8), '30', [394, 632], [265, 489]],
    ['B3', wx(20, 1013.25, null, 0), '30', [419, 675], [279, 520]],
    ['B4', wx(8, 1020, 110, 3), '12', [383, 616], [266, 498]],
    ['B5', wx(20.1, 1004.4, null, 0), '30', [495, 803], [299, 549]],
    ['B5b', wx(-5, 1004.5, null, 0), '12', [360, 582], [259, 494]],
    ['B6', wx(10.8, 998.2, 247, 8.7), '30', [444, 716], [282, 518]],
    ['B7', wx(25, 1015, 214, 10), '30', [451, 727], [288, 533]],
    ['B10', wx(30, 1010, 304, 18), '30', [373, 593], [248, 444]]
  ];
  cases.forEach(([name, input, id, to, la]) => {
    assert.deepEqual(meters(rwy(run(input, LYC), id).takeoff), to, name + ' Start');
    assert.deepEqual(meters(rwy(run(input, C172D), id).landing), la, name + ' Landung');
  });
});

/* ── Eingaben, Durchlauf, Fail-closed ──────────────────────── */

test('Eingaben: unplausibel, kein Zahlentyp oder runwayWet nicht boolesch ergibt invalid-input', () => {
  const base = wx(15, 1013.25, 304, 5);
  [['tempC', 61], ['tempC', NaN], ['tempC', '15'], ['qnhHpa', 899], ['qnhHpa', 1101], ['windKt', -1], ['windKt', 101],
    ['windDirTrue', 361], ['windDirTrue', undefined], ['windDirTrue', '304'], ['runwayWet', 'ja'], ['runwayWet', 1], ['runwayWet', undefined]].forEach(([f, v]) => {
    const inp = Object.assign({}, base);
    inp[f] = v;
    const r = core.compute(C172D, AF, inp);
    assert.equal(r.ok, false, f + '=' + v);
    assert.equal(r.error.code, 'invalid-input', f + '=' + v);
    assert.deepEqual(r.error.fields.map((x) => x.field), [f]);
  });
  assert.equal(core.compute(C172D, AF, null).error.code, 'invalid-input');
  assert.equal(core.compute(C172D, AF, wx(15, 1013, null, 2)).ok, true);
});

test('Über dem Tabellenbereich: die Meldung nennt das kleinste überschrittene Maximum', () => {
  let r = core.compute(C172D, AF, wx(45, 1013.25, null, 0));       // Start bis 50 °C, Landung bis 40 °C
  assert.deepEqual([r.ok, r.error.code, r.error.above], [false, 'above-range', [{ quantity: 'temperature', unit: 'degC', value: 45, max: 40 }]]);
  r = core.compute(C172D, AF, wx(55, 1013.25, null, 0));
  assert.deepEqual(r.error.above.map((a) => a.max), [40]);
  assert.equal(core.compute(C172D, AF, wx(40, 1013.25, null, 0)).ok, true);
  r = core.compute(P2010, Object.assign(clone(AF), { elevation: { value: 6000, unit: 'ft' } }), wx(15, 1000, null, 0));
  assert.deepEqual(r.error.above.map((a) => [a.quantity, a.max]), [['pressureAltitude', 6000]]);
});

// Ungerundete Vergleichsrechnung: Druckhöhe und Temperatur linear interpoliert (unter dem kleinsten Wert der
// kleinste), Gegenwind ohne Abrunden, Meter ohne Aufrunden. Der Kern darf nie kürzer rechnen.
function interp(table, pa, t) {
  function pos(vals, v) {
    if (v <= vals[0]) return { i: 0, f: 0 };
    for (let i = 1; i < vals.length; i++) if (v <= vals[i]) return { i: i - 1, f: (v - vals[i - 1]) / (vals[i] - vals[i - 1]) };
    return null;
  }
  const p = pos(table.axes[0].values, pa), q = pos(table.axes[1].values, t);
  if (!p || !q) return null;
  const nP = table.axes[0].values.length - 1, nT = table.axes[1].values.length - 1;
  const cell = (i, j, o) => table.cells[Math.min(i, nP)][Math.min(j, nT)][o];
  return [0, 1].map((o) => {
    const a = cell(p.i, q.i, o) + (cell(p.i, q.i + 1, o) - cell(p.i, q.i, o)) * q.f;
    const b = cell(p.i + 1, q.i, o) + (cell(p.i + 1, q.i + 1, o) - cell(p.i + 1, q.i, o)) * q.f;
    return a + (b - a) * p.f;
  });
}
function reference(ac, input, runway, phase) {
  const pa = core.pressureAltitudeFt(AF.elevation.value, input.qnhHpa);
  const chart = ac.charts[phase];
  const tab = interp(chart.table, pa, input.tempC);
  if (!tab) return null;
  let head = 0;
  if (input.windKt >= 1 && input.windDirTrue !== null) head = Math.max(0, input.windKt * Math.cos((input.windDirTrue - runway.bearingTrue) * Math.PI / 180));
  const hw = chart.corrections.find((c) => c.kind === 'headwind');
  let d = tab.slice();
  if (hw.type === 'percentPer') d = d.map((v) => v * (1 - Math.abs(hw.percent) * head / hw.per / 100));
  else d = d.map((v) => v - Math.abs(hw.amount) * head / hw.per);
  const g = chart.corrections.find((c) => c.kind === 'surface');
  d = d.map((v) => v + g.percent / 100 * tab[0]);
  chart.corrections.filter((c) => c.kind === 'factor' && (c.when === 'always' || input.runwayWet)).forEach((c) => { d = d.map((v) => v * c.factor); });
  const unit = chart.table.outputs[0].unit;
  return d.map((v) => (unit === 'ft' ? v * 0.3048 : v));
}

test('Durchlauf: nie NaN, ganze Meter, 15 m ≥ Rollstrecke, nie kürzer als ungerundet, Eingaben unverändert', () => {
  const temps = [-30, -20, -0.1, 0, 0.1, 9.9, 10, 15, 19.99, 20, 25, 27.5, 30, 39.9, 40, 40.1, 50, 52];
  const qnhs = [960, 985, 1004.45, 1004.46, 1013.25, 1030, 1050];
  const dirs = [null, 0, 34, 79, 124, 169, 214, 247, 290, 304, 349, 360];
  const winds = [0, 0.6, 1, 2.5, 3.5, 8.7, 14, 21, 25, 39];
  const snaps = [C172D, P2010, C152, AF].map((o) => JSON.stringify(o));
  let n = 0, values = 0;
  [C172D, P2010, C152].forEach((ac) => temps.forEach((t) => qnhs.forEach((q) => dirs.forEach((d) => winds.forEach((w) => [false, true].forEach((wet) => {
    const input = wx(t, q, d, w, wet);
    const snap = JSON.stringify(input);
    const r = core.compute(ac, AF, input);
    n++;
    assert.equal(JSON.stringify(input), snap);
    if (!r.ok) {
      assert.equal(r.error.code, 'above-range', JSON.stringify(input));
      return;
    }
    r.runways.forEach((rw) => {
      if (!rw.computed) {
        assert.ok(['tailwind', 'no-direction'].includes(rw.reason));
        return;
      }
      core.PHASES.forEach((ph) => {
        const p = rw[ph];
        if (!p.ok) {
          assert.ok(['wind-credit-limit', 'headwind-limit'].includes(p.reason), p.reason);
          return;
        }
        values++;
        assert.ok(Number.isInteger(p.m.groundRoll) && Number.isInteger(p.m.overObstacle));
        assert.ok(p.m.overObstacle >= p.m.groundRoll);
        const ref = reference(ac, input, AF.runways.find((x) => x.id === rw.id), ph);
        assert.ok(ref, 'Vergleichsrechnung fehlt ' + JSON.stringify(input));
        assert.ok(p.m.groundRoll >= ref[0] - 1e-6, ac.id + ' Rollstrecke kürzer als ungerundet: ' + JSON.stringify(input) + ' ' + rw.id + ' ' + ph);
        assert.ok(p.m.overObstacle >= ref[1] - 1e-6, ac.id + ' 15 m kürzer als ungerundet: ' + JSON.stringify(input) + ' ' + rw.id + ' ' + ph);
      });
    });
  }))))));
  assert.deepEqual([C172D, P2010, C152, AF].map((o) => JSON.stringify(o)), snaps);
  assert.ok(n > 45000 && values > 45000, n + ' Rechnungen, ' + values + ' Werte');
});

function allMeters(res) {
  const out = [];
  ['12', '30'].forEach((id) => core.PHASES.forEach((ph) => {
    const rw = res.ok ? rwy(res, id) : null;
    const p = rw && rw.computed ? rw[ph] : null;
    out.push(p && p.ok ? meters(p) : (rw && !rw.computed ? [0, 0] : [Infinity, Infinity]));
  }));
  return out;
}
function assertSeries(series, cmp, label) {
  for (let i = 1; i < series.length; i++) {
    series[i].m.forEach((pair, k) => {
      const prev = series[i - 1].m[k];
      assert.ok(cmp(pair[0], prev[0]) && cmp(pair[1], prev[1]), label + ' bei ' + series[i].x + ' (Wert ' + k + ')');
    });
  }
}

test('Durchlauf: monoton in Temperatur und QNH, beide Muster, trocken und nass', () => {
  const ge = (a, b) => a >= b, le = (a, b) => a <= b;
  [C172D, P2010, C152].forEach((ac) => [null, 124, 247, 304].forEach((d) => [0, 2, 9].forEach((w) => [false, true].forEach((wet) => {
    for (const q of [990, 1013.25, 1035]) {
      const s = [];
      for (let t = -35; t <= 52; t += 0.5) s.push({ x: t, m: allMeters(core.compute(ac, AF, wx(t, q, d, w, wet))) });
      assertSeries(s, ge, ac.id + ' Temperatur');
    }
    for (const t of [-5, 12, 29]) {
      const s = [];
      for (let q = 950; q <= 1060; q += 0.5) s.push({ x: q, m: allMeters(core.compute(ac, AF, wx(t, q, d, w, wet))) });
      assertSeries(s, le, ac.id + ' QNH');
    }
  }))));
  // nass ist nie kürzer als trocken
  [C172D, P2010, C152].forEach((ac) => {
    const a = allMeters(core.compute(ac, AF, wx(15, 1018, 290, 8, false)));
    const b = allMeters(core.compute(ac, AF, wx(15, 1018, 290, 8, true)));
    b.forEach((pair, k) => assert.ok(pair[0] >= a[k][0] && pair[1] >= a[k][1]));
  });
});

test('Eingabe- und Datenobjekte bleiben unverändert (eingefroren)', () => {
  const ac = deepFreeze(clone(P2010)), af = deepFreeze(clone(AF));
  const r = core.compute(ac, af, deepFreeze(wx(15, 1018, 290, 8, true)));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(meters(rwy(r, '30').takeoff), [409, 744]);
});

function badData(mutate, base) {
  const ac = clone(base || C172D), af = clone(AF);
  mutate(ac, af);
  return core.compute(ac, af, wx(15, 1013.25, 304, 5));
}

test('Fail-closed: unbekannte oder unplausible Schema-Werte ergeben bad-data', () => {
  const T = 'takeoff', L = 'landing';
  const rule = (ac, ph, kind) => ac.charts[ph].corrections.find((c) => c.kind === kind);
  const cases = {
    'schema 1': (ac) => { ac.schema = 1; },
    'Platz schema 1': (ac, af) => { af.schema = 1; },
    'type': (ac) => { ac.charts[T].table.type = 'bilinear'; },
    'quantity': (ac) => { ac.charts[L].table.axes[1].quantity = 'weight'; },
    'Achseinheit': (ac) => { ac.charts[T].table.axes[1].unit = 'degF'; },
    'read unbekannt': (ac) => { ac.charts[T].table.axes[0].read = 'interpolate'; },
    // Druckhöhe linear ist seit VERSION 7 erlaubt, aber alle Starttabellen müssen gleich ablesen
    'linear nur in der Haupttabelle': (ac) => { ac.charts[T].table.axes[0].read = 'linear'; },
    'linear mit einem Wert': (ac) => { const a = ac.charts[L].table.axes[1]; a.read = 'linear'; a.values = [20]; ac.charts[L].table.cells = ac.charts[L].table.cells.map((r) => [r[2]]); },
    'massRead unbekannt': (ac) => { ac.charts[T].massRead = 'interpolate'; },
    'massRead leer': (ac) => { ac.charts[T].massRead = ''; },
    'massRead bei der Landung': (ac) => { ac.charts[L].massRead = 'linear'; },
    'massRead linear, Tabellengewicht nicht ganz': (ac) => {
      ac.charts[T].massRead = 'linear';
      ac.charts[T].lowerWeights[0].mass = { kg: 1133.98, lb: 2500 };
    },
    'massRead linear, Höchstgewicht nicht ganz': (ac) => { ac.charts[T].massRead = 'linear'; ac.mass.kg = 1156.6; },
    'Druckhöhe 25000 ft': (ac) => { ac.charts[T].table.axes[0].values[10] = 25000; },
    'Temperatur 70 °C': (ac) => { ac.charts[T].table.axes[1].values[6] = 70; },
    'Ausgabe km': (ac) => { ac.charts[T].table.outputs.forEach((o) => { o.unit = 'km'; }); },
    'Ausgaben verschieden': (ac) => { ac.charts[T].table.outputs[1].unit = 'ft'; },
    'm-Wert 9001': (ac) => { ac.charts[T].table.cells[10][6][1] = 9001; },
    'ft-Wert 30001': (ac) => { ac.charts[L].table.cells[8][4][1] = 30001; },
    'NaN-Zelle': (ac) => { ac.charts[T].table.cells[2][3][0] = NaN; },
    'Zeile zu kurz': (ac) => { ac.charts[T].table.cells[4].pop(); },
    '15 m kürzer als Rollstrecke': (ac) => { ac.charts[T].table.cells[3][2][1] = 100; },
    'Rückenwind-Regel': (ac) => { ac.charts[T].corrections.push({ kind: 'tailwind', type: 'percentPer', percent: 10, per: 2, unit: 'kt', max: 10 }); },
    'kind unbekannt': (ac) => { ac.charts[L].corrections.push({ kind: 'slope', percent: 10 }); },
    'per 0,5': (ac) => { rule(ac, T, 'headwind').per = 0.5; },
    'per 51': (ac) => { rule(ac, T, 'headwind').per = 51; },
    'percent −101': (ac) => { rule(ac, L, 'headwind').percent = -101; },
    'percent positiv': (ac) => { rule(ac, L, 'headwind').percent = 10; },
    'Windtyp unbekannt': (ac) => { rule(ac, T, 'headwind').type = 'factorPer'; },
    'absolut zu gross': (ac) => { const h = rule(ac, T, 'headwind'); delete h.percent; Object.assign(h, { type: 'absolutePer', amount: -60, amountUnit: 'm', per: 1 }); },
    'absolut falsche Einheit': (ac) => { const h = rule(ac, T, 'headwind'); delete h.percent; Object.assign(h, { type: 'absolutePer', amount: -10, amountUnit: 'ft', per: 1 }); },
    'Gras 201 %': (ac) => { rule(ac, L, 'surface').percent = 201; },
    'Faktor 1': (ac) => { rule(ac, T, 'factor').factor = 1; },
    'Faktor 3,5': (ac) => { rule(ac, T, 'factor').factor = 3.5; },
    'Faktor 4 Dezimalen': (ac) => { rule(ac, T, 'factor').factor = 1.2345; },
    'Faktor when unbekannt': (ac) => { rule(ac, T, 'factor').when = 'sometimes'; },
    'Faktor nass ohne Belag': (ac) => { delete rule(ac, T, 'factor').surface; },
    'Faktor immer mit Belag': (ac) => { const f = rule(ac, T, 'factor'); f.when = 'always'; },
    'Faktor ohne minimum': (ac) => { delete rule(ac, T, 'factor').minimum; },
    'Faktor ohne refDe': (ac) => { rule(ac, T, 'factor').refDe = ''; },
    'Quelle fehlt': (ac) => { delete ac.charts[T].source; },
    'Quelle unbekannt': (ac) => { ac.charts[L].source = 'afm'; },
    'Masse ohne kg': (ac) => { delete ac.mass.kg; },
    'Hindernis 35 ft': (ac) => { ac.charts[T].table.obstacle.value = 35; },
    'Länge 99 m': (ac, af) => { af.runways[0].takeoffAvailable.value = 99; },
    'Richtung 0': (ac, af) => { af.runways[0].bearingTrue = 0; }
  };
  Object.keys(cases).forEach((name) => {
    const r = badData(cases[name]);
    assert.equal(r.ok, false, name);
    assert.equal(r.error.code, 'bad-data', name);
  });
  // Grenzwerte selbst gültig
  [(ac) => { rule(ac, T, 'headwind').per = 1; }, (ac) => { rule(ac, T, 'headwind').per = 50; },
    (ac) => { rule(ac, T, 'factor').factor = 3; }, (ac) => { rule(ac, T, 'factor').factor = 1.001; },
    (ac) => { ac.charts[T].table.cells[10][6][1] = 9000; }].forEach((m, i) => {
    assert.equal(badData(m).ok, true, 'Grenzwert ' + i);
  });
  // Seit VERSION 7 gültig: Druckhöhe linear in allen Tabellen, massRead «nextHigher» oder «linear» beim Start
  const allLinear = (ac) => [ac.charts[T].table, ac.charts[L].table].concat(ac.charts[T].lowerWeights.map((e) => e.table))
    .forEach((t) => t.axes.forEach((a) => { a.read = 'linear'; }));
  [allLinear, (ac) => { ac.charts[T].massRead = 'nextHigher'; }, (ac) => { ac.charts[T].massRead = 'linear'; },
    (ac) => { allLinear(ac); ac.charts[T].massRead = 'linear'; }].forEach((m, i) => {
    assert.equal(badData(m).ok, true, 'gültig ' + i);
  });
  // Die Fehlertexte der neuen Fälle sind eindeutig (nicht nur irgendein bad-data)
  const errs = (m) => badData(m).error.errors;
  assert.deepEqual(errs(cases['linear nur in der Haupttabelle']), ['charts.takeoff.lowerWeights[0].table: Achsen oder Ausgaben anders als in der Haupttabelle']);
  assert.deepEqual(errs(cases['linear mit einem Wert']), ['charts.landing.table.axes[1].values: Interpolation braucht zwei Werte']);
  assert.deepEqual(errs(cases['massRead unbekannt']), ['charts.takeoff.massRead unbekannt']);
  assert.deepEqual(errs(cases['massRead leer']), ['charts.takeoff.massRead unbekannt']);
  assert.deepEqual(errs(cases['massRead bei der Landung']), ['charts.landing.massRead nur beim Start erlaubt']);
  assert.deepEqual(errs(cases['massRead linear, Tabellengewicht nicht ganz']), ['charts.takeoff.massRead: Tabellengewichte nicht ganze kg']);
  assert.ok(errs(cases['massRead linear, Höchstgewicht nicht ganz']).includes('charts.takeoff.massRead: Tabellengewichte nicht ganze kg'));
});

test('Fail-closed: fehlende Gras-Regel ergibt für diese Phase keinen Wert, fehlende Gegenwind-Regel keine Gutschrift', () => {
  let r = badData((ac) => { ac.charts.takeoff.corrections = ac.charts.takeoff.corrections.filter((c) => c.kind !== 'surface'); });
  assert.equal(r.ok, true);
  assert.deepEqual([rwy(r, '30').takeoff.reason, rwy(r, '30').landing.ok], ['no-surface-rule', true]);
  r = badData((ac) => { ac.charts.landing.corrections = ac.charts.landing.corrections.filter((c) => c.kind !== 'headwind'); });
  const p = rwy(r, '30').landing;
  assert.deepEqual([p.ok, p.wind.applied, p.wind.noRule], [true, false, true]);
  close(p.afterWind.groundRoll, p.table.groundRoll, 0);
});

test('Fail-closed: Monotonieprüfung allein (eine fallende Zelle, sonst gültig)', () => {
  const ac = clone(C172D);
  // 3000 ft / 10 °C: [306, 478] → [280, 470]. Kleiner als 2000 ft / 10 °C [285, 446], 15 m bleibt über der Rollstrecke.
  ac.charts.takeoff.table.cells[3][2] = [280, 470];
  assert.deepEqual(core.validateAircraft(ac), { ok: false, errors: ['charts.takeoff.table.cells nicht monoton'] });
  const r = core.compute(ac, AF, wx(15, 1013.25, 304, 5));
  assert.deepEqual([r.ok, r.error.code], [false, 'bad-data']);
});

test('Schlussprobe im Kern: unplausible Zwischenwerte ergeben internal (direkt aufgerufen)', () => {
  // Mit geprüften Daten unerreichbar; darum computePhase direkt mit konstruierter Ablesung.
  const chart = C172D.charts.takeoff;                     // Hartbelag, Tabelle in m, Nässefaktor nur auf Gras
  const lk = (gr, ob) => ({ values: { groundRoll: gr, overObstacle: ob } });
  const rw = { surface: 'paved' }, calm = { kt: 0 };
  let p = core._computePhase(chart, lk(300, 450.2), rw, calm, false, 1000);
  assert.deepEqual([p.ok, p.reason, p.m], [true, null, { groundRoll: 300, overObstacle: 451 }]);
  // [300,5, 300,2]: beide ergeben 301 m, nur der Vergleich der ungerundeten Werte fängt es
  [[450, 300], [300.5, 300.2], [NaN, 450], [300, NaN], [300, Infinity], [0, 450], [-5, 450]].forEach(([gr, ob]) => {
    p = core._computePhase(chart, lk(gr, ob), rw, calm, false, 1000);
    assert.deepEqual([p.ok, p.reason, p.m, p.final], [false, 'internal', null, null], gr + ' / ' + ob);
  });
});

test('Validierung wirft nie (bad-data), Ausnahmen in der Rechnung ergeben internal', () => {
  const trap = clone(C172D);
  Object.defineProperty(trap.charts.takeoff, 'corrections', { get() { throw new Error('kaputt'); } });
  const fail = () => { throw new Error('Falle'); };
  const hostile = new Proxy({}, { get: fail, has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail });
  // Ausnahme, deren Text selbst wirft
  const nasty = clone(C172D);
  Object.defineProperty(nasty, 'schema', { get() { throw { get message() { throw new Error('m'); }, toString() { throw new Error('s'); } }; } });
  // Eigener Fang: eine geworfene Falle darf nie bis zum Testrunner gelangen (sein Fehlerbericht würde sie anfassen)
  const attempt = (fn) => { try { return fn(); } catch (e) { return 'geworfen'; } };
  assert.deepEqual(attempt(() => core.validateAircraft(nasty)), { ok: false, errors: ['Flugzeugdaten nicht lesbar: unbekannter Fehler'] });
  [trap, hostile, nasty, undefined, null, 0, 'x', [], {}, { schema: 2, charts: [] }, { schema: 2, runways: [null] }].forEach((x, i) => {
    let v = attempt(() => core.validateAircraft(x));
    assert.ok(v !== 'geworfen' && v.ok === false && v.errors.length > 0, 'Flugzeug ' + i + ': ' + (v === 'geworfen' ? 'Ausnahme' : 'ok'));
    v = attempt(() => core.validateAirfield(x));
    assert.ok(v !== 'geworfen' && v.ok === false && v.errors.length > 0, 'Platz ' + i + ': ' + (v === 'geworfen' ? 'Ausnahme' : 'ok'));
  });
  let r = attempt(() => core.compute(trap, AF, wx(15, 1013.25, 304, 5)));
  assert.deepEqual([r.ok, r.error && r.error.code], [false, 'bad-data']);
  r = attempt(() => core.compute(C172D, hostile, wx(15, 1013.25, 304, 5)));
  assert.deepEqual([r.ok, r.error && r.error.code], [false, 'bad-data']);
  // Ausnahme erst in der Rechnung: der Getter wirft ab dem zweiten Zugriff (nach der Validierung)
  const late = clone(C172D);
  const corr = late.charts.takeoff.corrections;
  let reads = 0;
  Object.defineProperty(late.charts.takeoff, 'corrections', { get() { reads++; if (reads > 1) throw new Error('kaputt'); return corr; } });
  r = core.compute(late, AF, wx(15, 1013.25, 304, 5));
  assert.deepEqual([r.ok, r.error.code], [false, 'internal']);
  assert.equal(reads, 2);
});
