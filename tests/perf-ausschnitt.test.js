// Tests des Tabellenausschnitts im Rechenweg (perf/perf-ui.js VERSION 8, Variante A, Wunsch des Benutzers vom 21.11.2026:
// «die beiden Zeilen, zwischen denen die Interpolation stattgefunden hat, hervorheben – egal ob interpoliert oder direkt
// gelesen»). Mit den ausgelieferten Daten (alles linear). Sollwerte der Ausschnitte aus der unabhängigen Handrechnung
// (scratchpad/tools/afm-hand.js, 21.11.2026: exakte Brüche nur aus den Flugzeugdaten, ohne perf.js und perf-ui.js).
// Kurzformat der Ausschnitte: tests/helpers/afm.js. Den Ausschnitt mit der alten Ableseregel prüfen
// tests/perf-rechenweg.test.js (alle Kontrollfälle), tests/perf-ui.test.js und tests/perf-gewicht.test.js, jede Zelle aller
// Muster gegen die Daten tests/perf-interpolation.test.js.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ui = require(path.join(ROOT, 'perf', 'perf-ui.js'));
const core = require(path.join(ROOT, 'perf', 'perf.js'));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const { afmGrids, withoutAfm, legend } = require('./helpers/afm.js');
const C172D = readJson('perf/aircraft/c172d.json');
const C152 = readJson('perf/aircraft/c152.json');
const P2008 = readJson('perf/aircraft/p2008.json');
const AF = readJson('perf/airfields/lszk.json');
const LIST = ui.parseIndex(readJson('perf/aircraft/index.json')).list;

// 18.11.2026, 09:15 Uhr in Zürich; K2: QNH 1018 (Druckhöhe 1'630 ft), 15 °C, 290°/8 kt (Piste 30, 7 kt Gegenwind)
const NOW = Date.UTC(2026, 10, 18, 8, 15);
const MIN = 60000;
function wxPfa(over) {
  return Object.assign({
    src: 'pfa', srcLabel: 'MeteoSchweiz Pfäffikon ZH', time: NOW - 15 * MIN, ageMin: 15, stale: false,
    windKt: 8, windDir: 290, gustKt: 14, tempC: 15, dewC: 4.1, humPct: 63, qnhHpa: 1018, qfeHpa: 956.4,
    rainMmH: 0, rain1hMm: 0
  }, over);
}
const FGZO = { ok: true, fetched_at_utc: new Date(NOW - 14 * MIN).toISOString(), runway_condition: 'DRY', updated: '18.11.2026, 07:14' };
function render(wx, over) {
  return ui.renderHtml(Object.assign({ dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: wx, fgzo: FGZO, nowMs: NOW, detailsOpen: true }, over));
}
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
const calcOf = (html) => { const m = /<details class="perf-details".*<\/details>/.exec(html); return m ? m[0] : null; };

test("Ausschnitt: Cessna 172 JT-A bei 1'630 ft und 15 °C – Start in m, Landung in ft, Legende je Phase, Wertzeile gleich dem Schnittpunkt", () => {
  const html = render(wxPfa());
  assert.deepEqual(afmGrids(html), [
    " ‖ 10 °C | [15,0 °C] | 20 °C ‖ 1'000 ft: 266/416 | ~ | 285/447 ‖ [1'630 ft]: ~ | *288,1/451,03* | ~ ‖ 2'000 ft: 285/446 | ~ | 306/479",
    " ‖ 10 °C | [15,0 °C] | 20 °C ‖ 1'000 ft: 585/1'350 | ~ | 605/1'385 ‖ [1'630 ft]: ~ | *610,75/1'389,55* | ~ ‖ 2'000 ft: 610/1'385 | ~ | 630/1'420"
  ]);
  const t = text(withoutAfm(calcOf(html)));
  assert.ok(t.includes("Tabelle 1'157 kg " + legend('m') + " interpoliert für 1'630 ft / 15,0 °C 288,1 m 451,03 m Gegenwind 7 kt"), t);
  assert.ok(t.includes("maximales Landegewicht 1'157 kg " + legend('ft') + " interpoliert für 1'630 ft / 15,0 °C 610,75 ft 1'389,55 ft Gegenwind 7 kt"), t);
  // Reihenfolge: Kopf der Phase, Legende, Ausschnitt, Wertzeile
  const c = calcOf(html);
  const i = ['Start <span', ui.TEXT.calcAfm, '<tr class="perf-steps-afm">', 'interpoliert für 1'].map((s) => c.indexOf(s));
  assert.ok(i[0] >= 0 && i[0] < i[1] && i[1] < i[2] && i[2] < i[3], i.join(' '));
  assert.equal(ui.TEXT.calcAfm, 'oben Rollstrecke, unten über 15&nbsp;m, blau die Eingabe oder der abgelesene Wert');
  // Ausschnitt und Wertzeile kommen aus derselben Rechnung wie die Karte
  const res = core.compute(C172D, AF, { tempC: 15, qnhHpa: 1018, windDirTrue: 290, windKt: 8, runwayWet: false });
  const lk = res.runways.find((r) => r.id === '30').takeoff.lookup;
  assert.deepEqual([ui.fmtExact(lk.values.groundRoll), ui.fmtExact(lk.values.overObstacle)], ['288,1', '451,03']);
});

test('Ausschnitt: Tecnam P2008JC mit 625 kg – je Starttabelle ein Ausschnitt (Kopf = Gewicht), dann «interpoliert für 625 kg»', () => {
  const html = render(wxPfa(), { aircraft: P2008, massText: '625' });
  const g = afmGrids(html);
  assert.deepEqual(g.slice(0, 2), [
    "650 kg ‖ 0 °C | [15,0 °C] | 25 °C ‖ 1'000 ft: 204/356 | ~ | 252/437 ‖ [1'630 ft]: ~ | *246,282/427,028* | ~ ‖ 2'000 ft: 223/388 | ~ | 275/475",
    "600 kg ‖ 0 °C | [15,0 °C] | 25 °C ‖ 1'000 ft: 169/296 | ~ | 208/363 ‖ [1'630 ft]: ~ | *203,362/354,848* | ~ ‖ 2'000 ft: 184/322 | ~ | 227/395"
  ]);
  assert.equal(g.length, 3, 'dazu die Landung');
  assert.ok(g[2].startsWith(' ‖ 0 °C | [15,0 °C] | 25 °C ‖ '), 'Landung ohne Gewicht im Kopf: ' + g[2]);
  const t = text(withoutAfm(calcOf(html)));
  // 625 kg liegt in der Mitte: (246,282 + 203,362) / 2 = 224,822 und (427,028 + 354,848) / 2 = 390,938
  assert.ok(t.includes('Tabellen 650 und 600 kg ' + legend('m') + ' interpoliert für 625 kg 224,822 m 390,938 m Gegenwind'), t);
  assert.ok(!t.includes('kg · interpoliert') && !t.includes('kg · Tabellenwert'), 'keine Wertzeile je Gewichtstabelle');
});

test("Ausschnitt: Cessna 152 genau auf 2'000 ft und 20 °C – eine Zelle, «Tabellenwert»; unter der Tabelle die kleinste Spalte", () => {
  // QNH 1004,46: Druckhöhe 1'999,906 ft, auf ganze ft aufgerundet 2'000 ft
  let html = render(wxPfa({ qnhHpa: 1004.46, tempC: 20 }), { aircraft: C152 });
  assert.ok(text(html).includes("Druckhöhe 2'000 ft"), text(html));
  assert.equal(afmGrids(html)[0], " ‖ [20 °C] ‖ [2'000 ft]: *910/1'690*");
  assert.ok(text(withoutAfm(calcOf(html))).includes(legend('ft') + " Tabellenwert 910 ft 1'690 ft Gegenwind"), text(calcOf(html)));
  // −5 °C (Tabelle ab 0 °C): Spalte 0 °C blau, die Druckhöhe interpoliert; Wertzeile nennt nur die interpolierte Achse
  html = render(wxPfa({ tempC: -5 }), { aircraft: C152 });
  assert.deepEqual(afmGrids(html), [
    " ‖ [0 °C] ‖ 1'000 ft: ~705/1'310 ‖ [1'630 ft]: *749,1/1'395,05* ‖ 2'000 ft: ~775/1'445",
    " ‖ [0 °C] ‖ 1'000 ft: ~465/1'185 ‖ [1'630 ft]: *477,6/1'203,9* ‖ 2'000 ft: ~485/1'215"
  ]);
  assert.ok(text(withoutAfm(calcOf(html))).includes(legend('ft') + " interpoliert für 1'630 ft 749,1 ft 1'395,05 ft Gegenwind"), text(calcOf(html)));
});

test('Ausschnitt: CSS – eigene Klassen (keine Doppelung mit dem Kartenraster .perf-grid), Blau der Seite, fetter Schnittpunkt', () => {
  const css = ui.CSS;
  assert.equal((css.match(/\.perf-grid \{/g) || []).length, 1, '.perf-grid nur für das Kartenraster');
  [
    '.perf-steps tr.perf-steps-afm > td { padding: 2px 0 6px; text-align: left; white-space: normal; }',
    '.perf-afm { border-collapse: collapse; font-size: 0.74rem; font-variant-numeric: tabular-nums; }',
    '.perf-steps .perf-afm th:first-child { padding-left: 4px; text-align: left; }',
    '.perf-steps .perf-afm tbody th { color: var(--text-muted); }',
    '.perf-steps .perf-afm .perf-afm-in { color: #38bdf8; background: rgba(56, 189, 248, 0.12); }',
    // Schnittpunkt heller (Kontrast 5,2 : 1 statt 4,0 : 1), in blauen Zellen auch die zweite Zeile voll deckend
    '.perf-steps .perf-afm td.perf-afm-x { color: #7dd3fc; background: rgba(56, 189, 248, 0.26); font-weight: 700; }',
    '.perf-afm-2 { display: block; opacity: 0.75; }',
    '.perf-steps .perf-afm .perf-afm-in .perf-afm-2, .perf-steps .perf-afm td.perf-afm-x .perf-afm-2 { opacity: 1; }'
  ].forEach((s) => assert.ok(css.includes(s), 'CSS fehlt: ' + s));
  // die Regeln des Ausschnitts stehen nach denen der Schritt-Tabelle (gleiche Spezifität: die spätere gilt)
  assert.ok(css.indexOf('.perf-steps .perf-afm th, .perf-steps .perf-afm td {') > css.indexOf('.perf-steps td { color: var(--text); white-space: nowrap; }'));
  assert.ok(css.indexOf('.perf-steps .perf-afm thead th {') > css.indexOf('.perf-steps thead th {'));
});

test('Ausschnitt: Daten – Zeilen Druckhöhe, Spalten Temperatur, in jeder Tabelle jedes Musters (auch je Startgewicht)', () => {
  // der Ausschnitt nimmt Achse 0 als Zeilen und Achse 1 als Spalten; der LSZK-Kern kennt nur diese zwei Achsen
  let n = 0;
  ui.parseIndex(readJson('perf/aircraft/index.json')).list.forEach((it) => {
    const ac = readJson('perf/aircraft/' + it.file);
    core.PHASES.forEach((ph) => {
      const ch = ac.charts[ph];
      [ch.table].concat((ch.lowerWeights || []).map((w) => w.table)).forEach((t) => {
        assert.deepEqual(t.axes.map((a) => a.quantity), ['pressureAltitude', 'temperature'], ac.id + ' ' + ph);
        n++;
      });
    });
  });
  assert.ok(n >= 12, n + ' Tabellen');
});

test('Version: Anzeige und Kern VERSION 9, ?v=9 in index.html', () => {
  assert.deepEqual([ui.VERSION, core.VERSION], [9, 9]);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('<script defer src="perf/perf.js?v=9"></script>') && html.includes('<script defer src="perf/perf-ui.js?v=9"></script>'));
});
