// Tests für die Kurzzeile unter der Briefing-Ampel (perf/perf-ui.js: renderParts) und ihre Lage in index.html.
// Die Kurzzeile zeigt Muster, Piste und die Rollstrecke für Start und Landung. Die Farbe der Zahl folgt dem schlimmsten
// Fall der Karte (rot: Rollstrecke länger als verfügbar, amber: nur die Strecke über 15 m). Keine Vorbehaltszeilen:
// Nässe und Hinweise stehen nur in der aufgeklappten Karte, eine Platzsperre nur in der Ampel der Seite. Zahlen nur,
// wenn die Karte Pistenblöcke zeigt.
// Eine Rechnung (core.compute höchstens einmal), zwei Darstellungen.
// Die Tests des Browserteils (Box, Auswahl, Zustand lszk-perf-open) stehen in tests/perf-ui.test.js.
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
// Tests der Anzeige mit der Ableseregel bis VERSION 6 (tests/helpers/ablesung.js); die ausgelieferte Ablesung (linear)
// prüft tests/perf-interpolation.test.js.
const { alteAblesung } = require('./helpers/ablesung.js');
const C172D = alteAblesung(readJson('perf/aircraft/c172d.json'));
const P2010 = alteAblesung(readJson('perf/aircraft/p2010.json'));
const C152 = alteAblesung(readJson('perf/aircraft/c152.json'));
const AF = readJson('perf/airfields/lszk.json');
const INDEX_RAW = readJson('perf/aircraft/index.json');
const LIST = ui.parseIndex(INDEX_RAW).list;
const CASES = readJson('tests/fixtures/kontrollfaelle.json');
const ACS = { c172d: C172D, p2010: P2010, c152: C152 };
const clone = (o) => JSON.parse(JSON.stringify(o));

// 18.11.2026, 09:15 Uhr in Zürich (wie tests/perf-ui.test.js)
const NOW = Date.UTC(2026, 10, 18, 8, 15);
const MIN = 60000;
const OLD = new Date(NOW - 54 * MIN).toISOString();
const SR_RED = 'Rollstrecke länger als verfügbar';
const SR_AMBER = 'Strecke über 15 m länger als verfügbar';

// K2: QNH 1018, 15 °C, 290°/8 kt, Böe 14, kein Regen
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
// afmTag: false ausdrücklich, damit diese Tests nicht von der ausgelieferten Stellung TEASER_AFM_TAG abhängen
function ctxOf(wx, over) {
  return Object.assign({ dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx, fgzo: fgzo(), nowMs: NOW, detailsOpen: false, afmTag: false }, over);
}
const parts = (wx, over) => ui.renderParts(ctxOf(wx, over));
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
// Sichtbares HTML: ohne die versteckten Hinweiswörter für Screenreader
const visible = (html) => html.replace(/<span class="perf-sr">[^<]*<\/span>/g, '');

// Elemente des Flex-Behälters als [Klasse, sichtbarer Text, HTML]; ausserhalb der Elemente steht nichts
function items(teaser) {
  const out = [];
  let depth = 0, start = 0, m;
  const re = /<(\/?)span\b[^>]*>/g;
  while ((m = re.exec(teaser))) {
    if (!m[1]) {
      if (depth === 0) start = m.index;
      depth++;
    } else if (--depth === 0) {
      const html = teaser.slice(start, re.lastIndex);
      out.push([/^<span class="([^"]+)">/.exec(html)[1], text(visible(html)).trim(), html]);
    }
  }
  assert.equal(depth, 0, 'span nicht geschlossen: ' + teaser);
  assert.equal(out.map((x) => x[2]).join(''), teaser, 'Text ausserhalb der Elemente: ' + teaser);
  return out;
}
// Lesbare Form mit Farbmarken: [amber]/[red] vor der Zahl, [nov] vor «kein Wert»; ohne Hinweiswörter
function marked(teaser) {
  return items(visible(teaser)).map(([cls, , html]) => cls + ': ' +
    text(html.replace(/<b class="perf-(amber|red)">/g, '[$1]').replace(/<span class="perf-nov">/g, '[nov]')).trim());
}
// Zeile «Rollstrecke: Start … · Landung …», streng nach Format, samt Hinweiswort hinter gefärbten Zahlen
const PHASE = '<span class="perf-nw">(Start|Landung) (?:<span class="perf-nov">kein Wert</span>|(bis )?<b(?: class="(perf-amber|perf-red)")?>' +
  '(\\d{1,3}(?:\'\\d{3})*)&nbsp;m</b>(?:<span class="perf-sr"> \\((' + SR_RED + '|' + SR_AMBER + ')\\)</span>)?)</span>';
const ROW = new RegExp('^<span class="perf-t-row">Rollstrecke: ' + PHASE + ' · ' + PHASE + '</span>$');
function rowOf(html) {
  const m = ROW.exec(html);
  assert.ok(m, 'Zeile: ' + html);
  const phase = (o) => (m[o + 4] === undefined ? { phase: m[o + 1], value: null }
    : { phase: m[o + 1], bis: !!m[o + 2], cls: m[o + 3] || null, value: Number(m[o + 4].replace(/'/g, '')), sr: m[o + 5] || null });
  return [phase(0), phase(5)];
}
// Pistenblöcke der Karte: Rollstrecke, über 15 m, verfügbar je Phase, Farben der Zellen
function cardBlocks(body) {
  const out = [];
  const re = /<section class="perf-block" aria-label="Piste ([^"]*)">(.*?)<\/section>/g;
  let m;
  while ((m = re.exec(body))) {
    const rows = {};
    ['Start', 'Landung'].forEach((label) => {
      const r = new RegExp('<tr><th scope="row">' + label + '</th>(<td>.*?</td>)(<td>.*?</td>)<td>(.*?)</td></tr>').exec(m[2]);
      const num = (s) => { const x = /(\d[\d']*)&nbsp;m/.exec(s); return x ? Number(x[1].replace(/'/g, '')) : null; };
      rows[label] = { gr: num(r[1]), oo: num(r[2]), avail: num(r[3]), red: /perf-red/.test(r[1]), amber: /perf-amber/.test(r[2]) };
    });
    out.push({ id: m[1], rows });
  }
  return out;
}
function assertCleanTeaser(teaser, label) {
  ['NaN', 'undefined', 'null', 'Infinity'].forEach((w) => assert.ok(!teaser.includes(w), label + ': enthält ' + w));
  assert.ok(!/#10b981|var\(--green\)|var\(--accent\)|style=|color:/.test(teaser), label + ': Farbe oder style im HTML');
  (teaser.match(/class="[^"]*"/g) || []).forEach((c) => c.slice(7, -1).split(/\s+/).forEach((k) => assert.ok(k.startsWith('perf-'), label + ': Klasse ' + k)));
  assert.ok(!/ id="/.test(teaser), label + ': id in der Kurzzeile');
  // Keine Vorbehaltszeilen mehr; in Kopf und Zeile sichtbar weder «über 15 m» noch «verfügbar» (die Zustandstexte ohne
  // Zahlen bleiben wie bisher, etwa «Daten nicht verfügbar – keine Berechnung»)
  assert.ok(!teaser.includes('\u26a0') && !teaser.includes('perf-t-warn'), label + ': Warnzeichen oder Vorbehaltszeile');
  items(teaser).filter(([c]) => c !== 'perf-t-state' && c !== 'perf-t-load').forEach(([c, t]) => {
    assert.ok(!/über 15|verfügbar/.test(t), label + ': «über 15 m» oder «verfügbar» sichtbar in ' + c);
  });
}

/* ── Zustandstabelle: genauer Text und Klasse je Zustand ───── */

const HEAD = 'perf-t-head: ';
const C172 = 'Start- und Landestrecke · Cessna 172 Diesel';
const state = (t) => 'perf-t-state: ' + t;
const roll = (s, l) => 'perf-t-row: Rollstrecke: Start ' + s + ' · Landung ' + l;
// Gemischter Belag: Graspiste 12 zuerst, Hartbelagpiste 30 danach; gespiegelt mit der Hartbelagpiste an erster Stelle,
// damit die längste Rollstrecke einmal von der zweiten Piste kommt
const mixed = clone(AF);
mixed.runways[1].surface = 'paved';
const pavedFirst = clone(AF);
pavedFirst.runways[0].surface = 'paved';
const one = clone(AF);
one.runways = one.runways.filter((r) => r.id === '12');
const three = clone(AF);
three.runways.push({ id: '06', bearingTrue: 64, bearingMag: 60, surface: 'grass', takeoffAvailable: { value: 700, unit: 'm' }, landingAvailable: { value: 650, unit: 'm' } });
// Muster ohne Graskorrektur in einer Phase: auf dem gemischten Platz hat die Graspiste dort keinen Wert, die Hartbelagpiste schon
function withoutGrass(ac, ph) {
  const x = clone(ac);
  x.charts[ph].corrections = x.charts[ph].corrections.filter((c) => !(c.kind === 'surface' && c.surface === 'grass'));
  assert.equal(core.validateAircraft(x).ok, true, ac.id + ' ohne Graskorrektur');
  return x;
}
const CALM = (o) => wxPfa(Object.assign({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }, o));
const NODIR = (o) => wxPfa(Object.assign({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }, o));

test('Kurzzeile mit Ergebnis: Kopf und Rollstrecke Start und Landung, Farbe nach dem schlimmsten Fall der Karte', () => {
  const C = HEAD + 'Cessna 172 Diesel · ';
  const cases = [
    ['K2 trocken', parts(wxPfa()), [C + 'Piste 30', roll('331 m', '265 m')]],
    ['K3 nass (FGZO)', parts(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER' }) }), [C + 'Piste 30', roll('397 m', '265 m')]],
    ['K14n nass, nur über 15 m zu lang: amber', parts(wxPfa({ tempC: 10.8, qnhHpa: 998.2, windDir: 247, windKt: 8.7, rain1hMm: 0.4 })),
      [C + 'Piste 30', roll('[amber]437 m', '282 m')]],
    ['K5 windstill', parts(CALM()), [C + 'windstill', roll('[amber]352 m', '279 m')]],
    ['K5n windstill nass', parts(CALM({ rain1hMm: 0.4 })), [C + 'windstill', roll('[amber]423 m', '279 m')]],
    ['K12 ohne Windrichtung (wieder im Kopf)', parts(NODIR()), [C + 'ohne Windrichtung', roll('328 m', '270 m')]],
    ['K6 Wind quer', parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 })), [C + 'Wind quer', roll('[amber]375 m', '[amber]288 m')]],
    ['K17 215°', parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 215, windKt: 10 })), [C + 'Piste 30', roll('375 m', '[amber]288 m')]],
    ['K8 Tecnam', parts(wxPfa(), { aircraft: P2010 }), [HEAD + 'Tecnam P2010 · Piste 30', roll('[amber]409 m', '[amber]423 m')]],
    ['K10a Tecnam, Start ohne Wert', parts(wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · Piste 30', roll('[nov]kein Wert', '[amber]314 m')]],
    ['K11b Gegenwind 41 kt', parts(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 })), [C + 'Piste 30', roll('[nov]kein Wert', '[nov]kein Wert')]],
    ['T1 Tecnam windstill 25 °C: rot', parts(CALM({ tempC: 25 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · windstill', roll('[red]526 m', '[amber]485 m')]],
    ['T4 Tecnam 50 °C: zweimal rot', parts(CALM({ tempC: 50 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · windstill', roll('[red]637 m', '[red]526 m')]],
    ['C2 Cessna 152', parts(wxPfa(), { aircraft: C152 }), [HEAD + 'Cessna 152 · Piste 30', roll('300 m', '219 m')]],
    ['C3 Cessna 152 nass (ohne Nässezuschlag im AFM)', parts(wxPfa(), { aircraft: C152, fgzo: fgzo({ runway_condition: 'STANDING WATER' }) }),
      [HEAD + 'Cessna 152 · Piste 30', roll('300 m', '219 m')]],
    ['C5 Cessna 152 windstill 40 °C', parts(CALM({ tempC: 40 }), { aircraft: C152 }), [HEAD + 'Cessna 152 · windstill', roll('[amber]370 m', '246 m')]],
    ['gemischter Belag: «bis»', parts(CALM(), { airfield: mixed }), [C + 'windstill', roll('bis [amber]352 m', 'bis 279 m')]],
    ['gemischter Belag gespiegelt: grösste Rollstrecke von der zweiten Piste', parts(CALM(), { airfield: pavedFirst }),
      [C + 'windstill', roll('bis 352 m', 'bis 279 m')]],
    ['gespiegelt, Tecnam 40 °C: rot von der zweiten Piste', parts(CALM({ tempC: 40, qnhHpa: 1000 }), { aircraft: P2010, airfield: pavedFirst }),
      [HEAD + 'Tecnam P2010 · windstill', roll('bis [red]647 m', 'bis [red]529 m')]],
    ['drei Pisten', parts(CALM(), { airfield: three }), [C + 'windstill · 3 Pisten', roll('[amber]352 m', '279 m')]],
    ['eine Piste, windstill', parts(CALM(), { airfield: one }), [C + 'windstill · Piste 12', roll('[amber]352 m', '279 m')]],
    ['eine Piste, ohne Windrichtung', parts(NODIR(), { airfield: one }), [C + 'ohne Windrichtung · Piste 12', roll('328 m', '270 m')]],
    ['eine Piste ohne Wert, die andere mit: «kein Wert», nie die Zahl der anderen Piste', parts(CALM(), { aircraft: withoutGrass(C172D, 'takeoff'), airfield: mixed }),
      [C + 'windstill', roll('[nov]kein Wert', 'bis 279 m')]],
    ['dasselbe gespiegelt', parts(CALM(), { aircraft: withoutGrass(C172D, 'takeoff'), airfield: pavedFirst }),
      [C + 'windstill', roll('[nov]kein Wert', 'bis 279 m')]]
  ];
  cases.forEach(([label, p, expected]) => {
    assert.equal(p.kind, 'result', label);
    assert.deepEqual(marked(p.teaser), expected, label);
    assertCleanTeaser(p.teaser, label);
  });
  // Genaues HTML: K2 ohne Farbe, K6 amber mit Hinweiswort, T1 rot und amber
  assert.equal(parts(wxPfa()).teaser,
    '<span class="perf-t-head">Cessna 172 Diesel · Piste&nbsp;30</span>' +
    '<span class="perf-t-row">Rollstrecke: <span class="perf-nw">Start <b>331&nbsp;m</b></span> · <span class="perf-nw">Landung <b>265&nbsp;m</b></span></span>');
  assert.equal(parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 })).teaser,
    '<span class="perf-t-head">Cessna 172 Diesel · Wind quer</span>' +
    '<span class="perf-t-row">Rollstrecke: <span class="perf-nw">Start <b class="perf-amber">375&nbsp;m</b><span class="perf-sr"> (' + SR_AMBER + ')</span></span> · ' +
    '<span class="perf-nw">Landung <b class="perf-amber">288&nbsp;m</b><span class="perf-sr"> (' + SR_AMBER + ')</span></span></span>');
  const t1 = parts(CALM({ tempC: 25 }), { aircraft: P2010 }).teaser;
  assert.ok(t1.includes('<span class="perf-nw">Start <b class="perf-red">526&nbsp;m</b><span class="perf-sr"> (' + SR_RED + ')</span></span>'), t1);
  assert.ok(t1.includes('<span class="perf-nw">Landung <b class="perf-amber">485&nbsp;m</b><span class="perf-sr"> (' + SR_AMBER + ')</span></span>'), t1);
});

test('Kurzzeile ohne Vorbehaltszeilen: Nässe, «unbekannt», unsichere DRY-Meldung, Hinweis und fehlende Windrichtung nur in der Karte, Platzsperre ändert nichts', () => {
  const H = HEAD + 'Cessna 172 Diesel · Piste 30';
  const DRY = [H, roll('331 m', '265 m')], WETR = [H, roll('397 m', '265 m')];
  const cases = [
    ['Nässe durch FGZO', parts(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER' }) }), WETR],
    ['Nässe durch Regen', parts(wxPfa({ rain1hMm: 0.4 })), WETR],
    ['Nässe durch Regenrate', parts(wxPfa({ rain1hMm: null, rainMmH: 0.6 }), { fgzo: null }), WETR],
    ['Nässe aus veralteter FGZO-Meldung', parts(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET', fetched_at_utc: OLD }) }), WETR],
    ['Sperre frisch', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }) }), DRY],
    ['geschlossen frisch und nass', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen', runway_condition: 'WET' }) }), WETR],
    ['Sperre veraltet', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }) }), DRY],
    ['Sperre veraltet, Regen unbekannt', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }) }), DRY],
    ['DRY von gestern', parts(wxPfa(), { fgzo: fgzo({ updated: '17.11.2026, 16:20' }) }), DRY],
    ['DRY ohne Zeitstempel', parts(wxPfa(), { fgzo: fgzo({ updated: '' }) }), DRY],
    ['kein FGZO, kein Regenwert (unbekannt)', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: null }), DRY],
    ['Standardmuster gewählt', parts(wxPfa(), { notice: 'Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.' }), DRY],
    ['ohne Windrichtung, nass und gesperrt', parts(NODIR({ rain1hMm: 0.4 }), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x' }) }),
      [HEAD + 'Cessna 172 Diesel · ohne Windrichtung', roll('[amber]394 m', '270 m')]]
  ];
  cases.forEach(([label, p, expected]) => {
    assert.deepEqual(marked(p.teaser), expected, label);
    assertCleanTeaser(p.teaser, label);
    assert.equal(items(p.teaser).length, 2, label + ': nur Kopf und Zeile');
  });
  // Die Karte zeigt die Vorbehalte weiterhin (gelber Kasten, Hinweisfarbe, grauer Hinweis)
  assert.ok(parts(wxPfa({ rain1hMm: 0.4 })).body.includes('class="perf-cond perf-warn"'));
  assert.ok(parts(wxPfa(), { fgzo: fgzo({ updated: '17.11.2026, 16:20' }) }).body.includes('class="perf-note"'));
  assert.ok(parts(NODIR()).body.includes('<div class="perf-hint">' + ui.TEXT.nodir + '</div>'));
});

test('Kurzzeile ohne Ergebnis: keine Zahlen, Text je Zustand wie bisher, Kopf mit Muster sobald geladen, kein Hinweis', () => {
  const T = ui.TEASER;
  const load = (t) => 'perf-t-load: ' + t;
  const fail = (code) => (ac, af, input) => ({ ok: false, error: { code: code } });
  const cases = [
    ['keine Messwerte', parts(undefined), [HEAD + C172, state('Keine aktuellen Messwerte – keine Berechnung')]],
    ['keine Quelle', parts(wxPfa({ src: null })), [HEAD + C172, state('Keine aktuellen Messwerte – keine Berechnung')]],
    ['keine Zeit', parts(wxPfa({ time: null })), [HEAD + C172, state('Keine aktuellen Messwerte – keine Berechnung')]],
    ['nur Station Speck', parts(wxPfa({ src: 'speck' })), [HEAD + C172, state('Nur Werte der Station Speck – keine Berechnung')]],
    ['veraltet (46 min)', parts(wxPfa({ time: NOW - 46 * MIN })), [HEAD + C172, state('Messwerte veraltet – keine Berechnung')]],
    ['als veraltet gemeldet', parts(wxPfa({ stale: true })), [HEAD + C172, state('Messwerte veraltet – keine Berechnung')]],
    ['Messzeit in der Zukunft', parts(wxPfa({ time: NOW + 10 * MIN })), [HEAD + C172, state('Messzeit unplausibel – keine Berechnung')]],
    ['Messwert fehlt', parts(wxPfa({ qnhHpa: null })), [HEAD + C172, state('Messwert fehlt – keine Berechnung')]],
    ['Messwert unplausibel', parts(wxPfa({ qnhHpa: 850 })), [HEAD + C172, state('Messwert unplausibel – keine Berechnung')]],
    ['über dem Tabellenbereich', parts(CALM({ tempC: 50.1 }), { aircraft: P2010 }),
      [HEAD + 'Start- und Landestrecke · Tecnam P2010', state('Über dem Tabellenbereich des AFM – kein Wert')]],
    ['Richtung fehlt über 3 kt', parts(wxPfa({ windDir: null, windKt: 6 })), [HEAD + C172, state('Windrichtung fehlt – keine Berechnung')]],
    ['keine Gegenwindpiste', parts(wxPfa(), { airfield: one }), [HEAD + C172, state('Keine Piste mit Gegenwind – keine Berechnung')]],
    ['FGZO-Abruf läuft', parts(wxPfa(), { fgzoPending: true }), [HEAD + C172, load('Lade Flugplatzstatus …')]],
    ['keine Messwerte, FGZO-Abruf läuft (Messwerte zuerst)', parts(undefined, { fgzoPending: true }), [HEAD + C172, state('Keine aktuellen Messwerte – keine Berechnung')]],
    ['Daten laden', parts(wxPfa(), { dataState: 'loading', aircraft: null, selectedId: 'p2010' }),
      [HEAD + 'Start- und Landestrecke', load('Lade Flugzeug- und Platzdaten …')]],
    ['Daten laden mit Hinweis', parts(wxPfa(), { dataState: 'loading', notice: 'x' }), [HEAD + 'Start- und Landestrecke', load('Lade Flugzeug- und Platzdaten …')]],
    ['Datenfehler', parts(wxPfa(), { dataState: 'error', aircraft: null }), [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung')]],
    ['Datenfehler mit Hinweis (nur in der Karte)', parts(wxPfa(), { dataState: 'error', aircraft: null, notice: 'x' }),
      [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung')]],
    ['ungültige Flugzeugdaten', parts(wxPfa(), { aircraft: Object.assign(clone(C172D), { schema: 1 }) }),
      [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung')]],
    ['veraltet mit Hinweis (nur in der Karte)', parts(wxPfa({ time: NOW - 46 * MIN }), { notice: 'x' }), [HEAD + C172, state('Messwerte veraltet – keine Berechnung')]]
  ];
  cases.forEach(([label, p, expected]) => {
    assert.notEqual(p.kind, 'result', label);
    assert.deepEqual(marked(p.teaser), expected, label);
    assert.ok(!p.teaser.includes('perf-t-row') && !p.teaser.includes('<b') && !p.teaser.includes('&nbsp;m'), label + ': Zahl ohne Ergebnis');
    assert.ok(!p.body.includes('perf-grid'), label);
    assertCleanTeaser(p.teaser, label);
  });
  // Version ungleich: Rechenfehler, ohne Muster
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    const p = parts(wxPfa(), { notice: 'x' });
    assert.equal(p.kind, 'internal');
    assert.deepEqual(marked(p.teaser), [HEAD + 'Start- und Landestrecke', state('Rechenfehler – keine Berechnung')]);
    assert.equal(p.sel, '');
  } finally {
    core.VERSION = v;
  }
  // Fehlercodes des Kerns, die mit geprüften Daten nicht vorkommen: bad-data und internal
  [['bad-data', 'Daten nicht verfügbar – keine Berechnung'], ['internal', 'Rechenfehler – keine Berechnung'], ['neu', 'Rechenfehler – keine Berechnung']].forEach(([code, t]) => {
    const orig = core.compute;
    core.compute = fail(code);
    try {
      const p = parts(wxPfa());
      assert.equal(p.kind, 'calc-error');
      assert.deepEqual(marked(p.teaser), [HEAD + C172, state(t)], code);
    } finally {
      core.compute = orig;
    }
  });
  // Texte ohne Satzpunkt und ohne HTML; keine Texte der früheren Vorbehaltszeilen mehr
  Object.keys(T).forEach((k) => assert.ok(typeof T[k] === 'string' && !/\.$/.test(T[k]) && !/[<>&]/.test(T[k]), 'TEASER.' + k));
  ['closed', 'closedAll', 'closedStale', 'dirUnknown', 'wet', 'unknown', 'inDetails'].forEach((k) => assert.equal(T[k], undefined, 'TEASER.' + k));
});

/* ── Gleichlauf mit der Karte über alle LSZK-Kontrollfälle ─── */

const FG = {
  dryToday: fgzo(), dryYesterday: fgzo({ updated: '17.11.2026, 16:20' }), dryUnclear: fgzo({ updated: 'gestern' }), dryStale: fgzo({ fetched_at_utc: OLD }),
  dryNoStamp: fgzo({ updated: '' }), none: null, wet: fgzo({ runway_condition: 'STANDING WATER' }), wetStale: fgzo({ runway_condition: 'WET', fetched_at_utc: OLD }),
  closed: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }), closedAll: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen' }),
  closedStale: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }), closedWet: fgzo({ flaeche: 'gesperrt', runway_condition: 'WET' }),
  closedStaleNoStamp: fgzo({ flaeche: 'gesperrt', updated: '', fetched_at_utc: OLD })
};
const RAIN = { no: [0, 0], unknown: [null, null], hour: [0.4, 0], rateOnly0: [null, 0], rate: [null, 0.6] };

// Prüft eine Darstellung: Zahlen nur mit Pistenblöcken; je Phase der grösste Wert der Spalte «Rollstrecke» der Karte
// («bis», wenn verschieden); rot genau dann, wenn eine Rollstrecken-Zelle rot ist; amber genau dann, wenn keine rot und
// eine Zelle «über 15 m» amber ist; «kein Wert» genau dann, wenn die Karte «–» zeigt; Hinweiswort passend zur Farbe.
function gleichlauf(ctx, label, stats) {
  const p = ui.renderParts(ctx);
  stats.n++;
  const hasGrid = p.body.includes('<div class="perf-grid">');
  assert.equal(p.kind === 'result', hasGrid, label + ': Zustand ' + p.kind);
  assertCleanTeaser(p.teaser, label);
  const it = items(p.teaser);
  if (!hasGrid) {
    assert.ok(!p.teaser.includes('perf-t-row') && !p.teaser.includes('<b') && !p.teaser.includes('&nbsp;m'), label + ': Zahl ohne Ergebnis');
    assert.deepEqual(it.map(([c]) => c), ['perf-t-head', p.kind === 'loading' || p.kind === 'fgzo-pending' ? 'perf-t-load' : 'perf-t-state'], label);
    return;
  }
  stats.results++;
  assert.deepEqual(it.map(([c]) => c), ['perf-t-head', 'perf-t-row'], label + ': Elemente');
  const blocks = cardBlocks(p.body);
  assert.ok(blocks.length > 0, label);
  const hint = p.body.includes(ui.TEXT.calm) ? 'windstill' : p.body.includes('<div class="perf-hint">' + ui.TEXT.nodir + '</div>') ? 'ohne Windrichtung'
    : p.body.includes(ui.TEXT.cross) ? 'Wind quer' : '';
  // Entscheid E3: zwei Pisten ohne Zusatz («beide Pisten» entfällt), mehr als zwei mit Anzahl
  const where = blocks.length === 1 ? 'Piste ' + blocks[0].id : (blocks.length === 2 ? '' : blocks.length + ' Pisten');
  // Das eingegebene Gewicht steht im Kopf genau dann, wenn es vom Höchstgewicht abweicht (die Karte nennt es dann im Kopf)
  const kg = /<div class="perf-head">Abfluggewicht ([\d']+)&nbsp;kg:/.exec(p.body);
  assert.equal(it[0][1], [ctx.aircraft.label, kg ? kg[1] + ' kg' : '', hint, where].filter((x) => x).join(' · '), label + ': Kopf');
  const phases = rowOf(it[1][2]);
  [['Start', 0], ['Landung', 1]].forEach(([phase, k]) => {
    const r = phases[k];
    assert.equal(r.phase, phase, label);
    const cells = blocks.map((b) => b.rows[phase]);
    if (cells.some((c) => c.gr === null)) {
      assert.equal(r.value, null, label + ' ' + phase + ': «–» in der Karte, Zahl in der Kurzzeile');
      stats.noValue++;
      if (cells.some((c) => c.gr !== null)) stats.noValueMixed++;
      return;
    }
    assert.notEqual(r.value, null, label + ' ' + phase + ': «kein Wert», die Karte hat überall Werte');
    const maxGr = Math.max(...cells.map((c) => c.gr));
    assert.equal(r.value, maxGr, label + ' ' + phase + ': grösste Rollstrecke');
    assert.equal(r.bis, cells.some((c) => c.gr !== maxGr), label + ' ' + phase + ': «bis»');
    const red = cells.some((c) => c.red), amber = !red && cells.some((c) => c.amber);
    assert.equal(r.cls, red ? 'perf-red' : (amber ? 'perf-amber' : null), label + ' ' + phase + ': Farbe');
    assert.equal(r.sr, red ? SR_RED : (amber ? SR_AMBER : null), label + ' ' + phase + ': Hinweiswort');
    if (red) stats.red++;
    if (amber) stats.amber++;
    if (!red && !amber) stats.plain++;
    if (r.bis) stats.bis++;
    if (cells.length > 1 && cells[0].gr !== maxGr) stats.maxFromLater++;
  });
}

test('Gleichlauf: Kurzzeile und Karte aus einer Rechnung, über alle LSZK-Kontrollfälle × FGZO × Regen × Hinweis', () => {
  const stats = { n: 0, results: 0, noValue: 0, noValueMixed: 0, red: 0, amber: 0, plain: 0, bis: 0, maxFromLater: 0 };
  let lszk = 0;
  CASES.forEach(([id, acId, field, inp]) => {
    if (field !== 'lszk') return;
    lszk++;
    const wx = (rk) => wxPfa({ tempC: inp[0], qnhHpa: inp[1], windDir: inp[2], windKt: inp[3], rain1hMm: RAIN[rk][0], rainMmH: RAIN[rk][1] });
    // Muster des Falls: alle FGZO- und Regenvarianten, mit und ohne Hinweis
    Object.keys(FG).forEach((fk) => Object.keys(RAIN).forEach((rk) => [null, 'Hinweis x'].forEach((notice) => {
      gleichlauf(ctxOf(wx(rk), { aircraft: ACS[acId], fgzo: FG[fk], notice }), id + '/' + fk + '/' + rk + '/' + (notice ? 'n' : '-'), stats);
    })));
    // alle drei Muster mit einer Auswahl der Varianten
    Object.keys(ACS).forEach((ac) => ['dryToday', 'wet', 'closedStale', 'dryNoStamp', 'none'].forEach((fk) => ['no', 'unknown'].forEach((rk) => {
      gleichlauf(ctxOf(wx(rk), { aircraft: ACS[ac], fgzo: FG[fk] }), id + '/' + ac + '/' + fk + '/' + rk, stats);
    })));
  });
  // ohne Ergebnis, Sonderplätze (gemischter Belag, gespiegelt, drei Pisten, eine Piste), FGZO-Abruf läuft
  [undefined, wxPfa({ src: 'speck' }), wxPfa({ time: NOW - 46 * MIN }), wxPfa({ time: NOW + 10 * MIN }), wxPfa({ qnhHpa: null }), wxPfa({ qnhHpa: 850 }),
    wxPfa({ tempC: 45 }), wxPfa({ windDir: null, windKt: 6 })].forEach((w, i) => [null, 'x'].forEach((notice) => {
    gleichlauf(ctxOf(w, { fgzo: fgzo({ flaeche: 'gesperrt', runway_condition: 'WET' }), notice }), 'ohne Ergebnis ' + i, stats);
  }));
  gleichlauf(ctxOf(wxPfa(), { fgzoPending: true }), 'FGZO lädt', stats);
  gleichlauf(ctxOf(wxPfa(), { airfield: one }), 'eine Piste, Rückenwind', stats);
  [C172D, P2010, C152].forEach((ac) => [[20, 1013.25], [40, 1000], [-5, 1030]].forEach(([t, q]) => {
    [[0, null], [2, null]].forEach(([kt, dir]) => {
      [0, 0.4].forEach((rain) => {
        const w = wxPfa({ tempC: t, qnhHpa: q, windDir: dir, windKt: kt, rain1hMm: rain });
        const tag = (kt ? ' ohne Richtung ' : ' windstill ') + (rain ? 'nass ' : '') + ac.id + ' ' + t;
        gleichlauf(ctxOf(w, { aircraft: ac, airfield: mixed }), 'gemischter Belag' + tag, stats);
        gleichlauf(ctxOf(w, { aircraft: ac, airfield: pavedFirst }), 'gemischter Belag gespiegelt' + tag, stats);
        gleichlauf(ctxOf(w, { aircraft: ac, airfield: three }), 'drei Pisten' + tag, stats);
        gleichlauf(ctxOf(w, { aircraft: ac, airfield: one }), 'eine Piste' + tag, stats);
        core.PHASES.forEach((ph) => {
          gleichlauf(ctxOf(w, { aircraft: withoutGrass(ac, ph), airfield: mixed }), 'eine Piste ohne Wert ' + ph + tag, stats);
          gleichlauf(ctxOf(w, { aircraft: withoutGrass(ac, ph), airfield: pavedFirst }), 'eine Piste ohne Wert, gespiegelt ' + ph + tag, stats);
        });
      });
    });
  }));
  // Abdeckung: jeder Zweig kommt vor
  assert.ok(lszk >= 50, 'LSZK-Kontrollfälle: ' + lszk);
  assert.ok(stats.n >= 8000 && stats.results >= 7000, JSON.stringify(stats));
  ['noValue', 'noValueMixed', 'red', 'amber', 'plain', 'bis', 'maxFromLater'].forEach((k) => assert.ok(stats[k] > 0, 'nie geprüft: ' + k + ' ' + JSON.stringify(stats)));
});

/* ── Eine Rechnung, zwei Darstellungen ────────────────────── */

test('Eine Rechnung: core.compute je renderParts genau einmal (ab Messwerten) bzw. nie, Kurzzeile gleich dem Rechenergebnis', (t) => {
  const spy = t.mock.method(core, 'compute');
  const cases = [
    [ctxOf(wxPfa()), 1, false], [ctxOf(wxPfa({ rain1hMm: 0.4 })), 1, true], [ctxOf(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET' }) }), 1, true],
    [ctxOf(CALM({ rain1hMm: 0.4 }), { aircraft: P2010 }), 1, true], [ctxOf(CALM({ tempC: 40, qnhHpa: 1000 }), { aircraft: P2010, airfield: pavedFirst }), 1, false],
    [ctxOf(wxPfa({ windDir: null, windKt: 6 })), 1, false], [ctxOf(wxPfa({ qnhHpa: 850 })), 1, false], [ctxOf(wxPfa(), { airfield: one }), 1, false],
    [ctxOf(undefined), 0], [ctxOf(wxPfa({ src: 'speck' })), 0], [ctxOf(wxPfa(), { fgzoPending: true }), 0],
    [ctxOf(wxPfa(), { dataState: 'loading' }), 0], [ctxOf(wxPfa(), { dataState: 'error' }), 0]
  ];
  cases.forEach(([ctx, calls, wet], i) => {
    spy.mock.resetCalls();
    const p = ui.renderParts(ctx);
    assert.equal(spy.mock.callCount(), calls, 'Fall ' + i + ': Aufrufe von compute');
    if (calls) {
      const call = spy.mock.calls[0];
      assert.equal(call.arguments[2].runwayWet, wet, 'Fall ' + i + ': nass');
      const res = call.result;
      if (p.kind === 'result') {
        const computed = res.runways.filter((r) => r.computed);
        const phases = rowOf(items(p.teaser).find(([c]) => c === 'perf-t-row')[2]);
        core.PHASES.forEach((ph, k) => {
          if (computed.some((r) => !r[ph].ok)) return assert.equal(phases[k].value, null);
          assert.equal(phases[k].value, Math.max(...computed.map((r) => r[ph].m.groundRoll)), 'Fall ' + i + ' ' + ph);
          const red = computed.some((r) => r[ph].exceeds.groundRoll), amber = !red && computed.some((r) => r[ph].exceeds.overObstacle);
          assert.equal(phases[k].cls, red ? 'perf-red' : (amber ? 'perf-amber' : null), 'Fall ' + i + ' ' + ph + ': Farbe');
        });
      }
    }
    spy.mock.resetCalls();
    assert.equal(ui.renderHtml(ctx), p.sel + p.mass + p.body, 'Fall ' + i + ': renderHtml = sel + mass + body');
    assert.equal(spy.mock.callCount(), calls, 'Fall ' + i + ': renderHtml rechnet auch nur einmal');
  });
  // selectedId: ab geladenen Daten die id des geladenen Musters, vorher die gewünschte
  assert.equal(ui.renderParts(ctxOf(wxPfa(), { aircraft: P2010, selectedId: 'c172d' })).selectedId, 'p2010');
  assert.equal(ui.renderParts(ctxOf(wxPfa(), { dataState: 'loading', selectedId: 'c152' })).selectedId, 'c152');
});

/* ── Hinweiswörter für Screenreader ───────────────────────── */

test('Hinweiswörter für Screenreader: hinter jeder gefärbten Zahl, passend zur Farbe, visuell versteckt', () => {
  // T1: Start rot, Landung amber
  let p = parts(CALM({ tempC: 25 }), { aircraft: P2010 });
  const ph = rowOf(items(p.teaser)[1][2]);
  assert.deepEqual([ph[0].cls, ph[0].sr, ph[1].cls, ph[1].sr], ['perf-red', SR_RED, 'perf-amber', SR_AMBER]);
  // ohne Farbe kein Hinweiswort, bei «kein Wert» keines
  p = parts(wxPfa());
  assert.ok(!p.teaser.includes('perf-sr'), p.teaser);
  p = parts(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 }));
  assert.ok(!p.teaser.includes('perf-sr'), p.teaser);
  // sichtbar bleibt nur die Zahl: Text ohne die versteckten Wörter
  p = parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 }));
  assert.equal(text(visible(p.teaser)).trim(), 'Cessna 172 Diesel · Wind quer Rollstrecke: Start 375 m · Landung 288 m');
  assert.equal(text(p.teaser).trim(), 'Cessna 172 Diesel · Wind quer Rollstrecke: Start 375 m (' + SR_AMBER + ') · Landung 288 m (' + SR_AMBER + ')');
  // CSS: übliches Clip-Muster, keine Anzeige
  const m = /\n\.perf-sr \{([^}]*)\}/.exec(ui.CSS);
  assert.ok(m, 'Regel .perf-sr fehlt');
  ['position: absolute;', 'width: 1px;', 'height: 1px;', 'overflow: hidden;', 'clip: rect(0, 0, 0, 0);', 'white-space: nowrap;', 'border: 0;']
    .forEach((x) => assert.ok(m[1].includes(x), '.perf-sr: ' + x));
  assert.equal(ui.TEASER.srRed, '(' + SR_RED + ')');
  assert.equal(ui.TEASER.srAmber, '(' + SR_AMBER + ')');
});

/* ── Maskierung ───────────────────────────────────────────── */

test('Maskierung: Marke in Name, Pistenkennung, Liste, FGZO-Feldern und Hinweis erscheint nie roh in der Kurzzeile', () => {
  const MARK = '<img src=x onerror=alert(1)>';
  const ESC = '&lt;img src=x onerror=alert(1)&gt;';
  const raw = (p, label) => {
    assert.ok(!/<img/i.test(p.teaser), label + ': Marke roh in der Kurzzeile');
    assert.ok(!/<img/i.test(p.sel + p.mass + p.body), label + ': Marke roh in der Karte');
    assertCleanTeaser(p.teaser, label);
  };
  // Name der Flugzeugdatei: im Kopf, mit und ohne Ergebnis
  const ac = clone(C172D);
  ac.label = MARK + ac.label;
  let p = parts(wxPfa(), { aircraft: ac });
  raw(p, 'Name');
  assert.ok(p.teaser.startsWith('<span class="perf-t-head">' + ESC + 'Cessna 172 Diesel · Piste&nbsp;30</span>'), p.teaser);
  p = parts(wxPfa({ src: 'speck' }), { aircraft: ac });
  raw(p, 'Name ohne Ergebnis');
  assert.ok(p.teaser.includes('Start- und Landestrecke · ' + ESC + 'Cessna 172 Diesel'));
  // Langer Name gekürzt
  const long = clone(C172D);
  long.label = 'Sehr langer Name '.repeat(6);
  p = parts(wxPfa(), { aircraft: long });
  const head = items(p.teaser)[0][1];
  assert.ok(/^Sehr langer Name .*… · Piste 30$/.test(head) && head.length <= 60 + ' · Piste 30'.length, head);
  // Pistenkennung: im Kopf, wenn eine Piste gerechnet wird
  const af = clone(AF);
  af.runways.forEach((r) => { r.id = MARK + r.id; });
  p = parts(wxPfa(), { airfield: af });
  raw(p, 'Pistenkennung');
  assert.ok(p.teaser.includes('Piste&nbsp;' + ESC + '30'), p.teaser);
  // Liste (Namen und Kennzeichen) und FGZO-Felder stehen nicht in der Kurzzeile
  const list = clone(INDEX_RAW.aircraft).map((e) => Object.assign(e, { label: MARK + e.label, registrations: e.registrations.map((r) => MARK + r) }));
  [list, [list[0]]].forEach((l, i) => {
    p = parts(wxPfa(), { list: l });
    raw(p, 'Liste ' + i);
    assert.ok(!p.teaser.includes('&lt;img') && (p.sel + p.mass + p.body).includes(ESC), 'Liste ' + i);
  });
  [fgzo({ runway_condition: MARK, updated: MARK }), fgzo({ flaeche: 'gesperrt', flaeche_grund: MARK }), fgzo({ updated: MARK, fetched_at_utc: OLD }),
    fgzo({ flaeche: 'gesperrt', flaeche_grund: MARK, fetched_at_utc: OLD, runway_condition: MARK }), fgzo({ updated: '17.11.2026 ' + MARK })].forEach((f, i) => {
    p = parts(wxPfa({ srcLabel: MARK }), { fgzo: f });
    raw(p, 'FGZO ' + i);
    assert.ok(!p.teaser.includes('&lt;img'), 'FGZO ' + i + ': Text der FGZO in der Kurzzeile');
  });
  // Hinweis: weder sein Text noch eine Vorbehaltszeile in der Kurzzeile
  p = parts(wxPfa(), { notice: MARK });
  raw(p, 'Hinweis');
  assert.ok(!p.teaser.includes('&lt;img') && items(p.teaser).length === 2, p.teaser);
});

/* ── Seite ────────────────────────────────────────────────── */

test('Seite: <details id="perf-box"> einmal zwischen Ampel und Wetter-Panel, Karte darin ohne display:none, Skripte ab ?v=4', () => {
  const file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, 'utf8');
  const count = (s) => html.split(s).length - 1;
  assert.equal(count('id="perf-box"'), 1);
  assert.equal(count('id="perf-teaser-text"'), 1);
  assert.equal(count('id="perf-content"'), 1);
  const bar = '<div id="briefing-bar" title="Ampel – Klick für Werte &amp; Erklärung"></div>';
  const iBar = html.indexOf(bar);
  const iBox = html.indexOf('<details class="perf-box" id="perf-box" style="display:none;">');
  const iPanel = html.indexOf('<div class="wx-panel" id="wx-panel">');
  assert.ok(iBar > 0 && iBox > iBar && iPanel > iBox, 'Reihenfolge Ampel, Box, Wetter-Panel');
  assert.ok(/^\s*(?:<!--[\s\S]*?-->\s*)?$/.test(html.slice(iBar + bar.length, iBox)), 'zwischen Ampel und Box steht nur ein Kommentar');
  const iEnd = html.indexOf('</details>', iBox);
  assert.ok(/^\s*(?:<!--[\s\S]*?-->\s*)?$/.test(html.slice(iEnd + '</details>'.length, iPanel)), 'zwischen Box und Wetter-Panel steht nur ein Kommentar');
  const box = html.slice(iBox, iEnd);
  assert.ok(/<summary class="perf-teaser" id="perf-teaser" title="[^"]+">\s*<span class="perf-t">\s*<svg class="perf-t-ico" aria-hidden="true"[^>]*>[\s\S]*?<\/svg>\s*<span class="perf-t-body" id="perf-teaser-text"><\/span>\s*<svg class="perf-t-chev" aria-hidden="true"[^>]*>[\s\S]*?<\/svg>\s*<\/span>\s*<\/summary>/.test(box), box);
  // «Details» statt «Karte» (Pilot liest «Karte» als Luftfahrtkarte)
  assert.ok(box.includes(' title="Start- und Landestrecke – Richtwert nach AFM. Klick öffnet oder schliesst die Details mit Rechenweg und Hinweisen.">'), 'Tooltip');
  assert.ok(box.includes('<div class="wx-card" id="perf-card" data-airfield="lszk">'), 'Karte in der Box');
  assert.ok(box.includes('<div id="perf-content"></div>'), '#perf-content leer (Unterbehälter legt das Skript an)');
  assert.ok(!/id="perf-card"[^>]*display/.test(html), 'Karte mit eigenem display');
  assert.ok(!html.slice(iPanel).includes('id="perf-card"'), 'Karte noch im Wetter-Panel');
  const v1 = /<script defer src="perf\/perf\.js\?v=(\d+)"><\/script>/.exec(html), v2 = /<script defer src="perf\/perf-ui\.js\?v=(\d+)"><\/script>/.exec(html);
  assert.ok(v1 && v2 && Number(v1[1]) === core.VERSION && Number(v2[1]) === ui.VERSION && ui.VERSION >= 4, 'Skriptversion');
});

/* ── CSS der Kurzzeile ────────────────────────────────────── */

test('CSS der Kurzzeile: flach (wenig Innenabstand, enge Zeilen), kein Dreieck, Umbruch statt Überlauf, gleiche Aussenmasse wie die Ampel', () => {
  // Regel ohne Einzug, also ausserhalb jeder @media-Regel
  const rule = (sel) => {
    const m = new RegExp('\\n' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(ui.CSS);
    return m ? m[1].trim() : null;
  };
  assert.equal(rule('.perf-box'), 'max-width: 1600px; margin: 0 auto 16px;');
  assert.equal(rule('.perf-teaser'), 'display: block; list-style: none; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); ' +
    'border-radius: 8px; padding: 6px 12px;');
  assert.equal(rule('.perf-teaser::-webkit-details-marker'), 'display: none;');
  assert.equal(rule('.perf-teaser:focus-visible'), 'outline: 2px solid var(--accent); outline-offset: 2px;');
  assert.equal(rule('.perf-t'), 'display: flex; align-items: flex-start; gap: 8px;');
  const body = rule('.perf-t-body');
  ['flex: 1;', 'min-width: 0;', 'display: flex;', 'flex-wrap: wrap;', 'gap: 0 18px;', 'font-size: 0.8rem;', 'line-height: 1.3;', 'overflow-wrap: break-word;']
    .forEach((x) => assert.ok(body.includes(x), x));
  // Ein langer Name ohne Leerzeichen darf die Seite nicht seitlich schieben: die Elemente dürfen schmaler werden als ihr längstes Wort
  assert.equal(rule('.perf-t-body > span'), 'min-width: 0;');
  assert.equal(rule('.perf-box[open] .perf-t-chev'), 'transform: rotate(180deg);');
  assert.equal(rule('.perf-box[open] > .perf-teaser'), 'margin-bottom: 8px;');
  assert.equal(rule('.perf-t-head'), 'font-weight: 600;');
  // Zusatz «Richtwert AFM» gedämpft und in normalem Gewicht (steht auch bei ausgeschaltetem Zusatz bereit)
  assert.equal(rule('.perf-t-tag'), 'color: var(--text-muted); font-weight: 400;');
  assert.equal(rule('.perf-t-state'), 'color: #f87171;');
  assert.equal(rule('.perf-t-load'), 'color: var(--text-muted);');
  assert.ok(!ui.CSS.includes('perf-t-warn'), 'Regel der entfallenen Vorbehaltszeile');
  // Farben der Zahlen und von «kein Wert»: dieselben Regeln wie in der Karte
  assert.equal(rule('.perf-amber'), 'color: #f59e0b; font-weight: 700;');
  assert.equal(rule('.perf-red'), 'color: #ef4444; font-weight: 700;');
  assert.equal(rule('.perf-nov'), 'color: #f87171;');
  assert.ok(/@media \(max-width: 600px\) \{\n {2}\.perf-box \{ margin-bottom: 10px; \}\n {2}\.perf-teaser \{ padding: 5px 8px; border-radius: 6px; \}/.test(ui.CSS),
    'mobil 10 px Abstand wie die Ampel, flacher Innenabstand');
  assert.ok(/@media \(max-width: 340px\) \{\n {2}\.perf-t-ico \{ display: none; \}\n\}/.test(ui.CSS), 'Symbol unter 340 px ausgeblendet');
  assert.ok(/@media \(prefers-reduced-motion: reduce\) \{\n {2}\.perf-t-chev \{ transition: none; \}/.test(ui.CSS));
  assert.ok(!/outline:\s*(?:none|0)\b/.test(ui.CSS));
});

/* ── Schalter «Richtwert AFM» (TEASER_AFM_TAG) ────────────── */

test('Schalter «Richtwert AFM»: ausgeliefert aus (Umschalten ändert genau die Konstante und diesen Test)', () => {
  assert.equal(ui.TEASER_AFM_TAG, false, 'ausgelieferte Stellung');
  // ohne Angabe gilt die Konstante
  const p = ui.renderParts(Object.assign(ctxOf(wxPfa()), { afmTag: undefined }));
  assert.equal(p.kind, 'result');
  assert.equal(p.teaser.includes('perf-t-tag'), ui.TEASER_AFM_TAG);
});

test('Schalter «Richtwert AFM» eingeschaltet: eigenes Element direkt nach dem Kopf, nur wenn eine Phase eine Zahl zeigt; Karte und übrige Kurzzeile unverändert', () => {
  const TAG = '<span class="perf-t-tag">Richtwert AFM</span>';
  const ctxs = [];
  CASES.forEach(([id, acId, field, inp]) => {
    if (field !== 'lszk') return;
    [['dryToday', null, 0], ['closedWet', 'x', 0], ['dryStale', null, null]].forEach(([fk, notice, rain]) => {
      ctxs.push([id + '/' + fk, ctxOf(wxPfa({ tempC: inp[0], qnhHpa: inp[1], windDir: inp[2], windKt: inp[3], rain1hMm: rain, rainMmH: rain }),
        { aircraft: ACS[acId], fgzo: FG[fk], notice })]);
    });
  });
  [undefined, wxPfa({ src: 'speck' }), wxPfa({ time: NOW - 46 * MIN }), wxPfa({ time: NOW + 10 * MIN }), wxPfa({ qnhHpa: null }), wxPfa({ qnhHpa: 850 }),
    wxPfa({ tempC: 45 }), wxPfa({ windDir: null, windKt: 6 })].forEach((w, i) => [null, 'x'].forEach((notice) => {
    ctxs.push(['ohne Zahlen ' + i, ctxOf(w, { notice })]);
  }));
  ctxs.push(['FGZO lädt', ctxOf(wxPfa(), { fgzoPending: true })], ['Daten laden', ctxOf(wxPfa(), { dataState: 'loading', aircraft: null })],
    ['Datenfehler', ctxOf(wxPfa(), { dataState: 'error', aircraft: null, notice: 'x' })], ['keine Gegenwindpiste', ctxOf(wxPfa(), { airfield: one })],
    ['drei Pisten', ctxOf(CALM(), { airfield: three })]);
  let results = 0, others = 0, noNumber = 0;
  ctxs.forEach(([label, ctx]) => {
    const off = ui.renderParts(Object.assign({}, ctx, { afmTag: false }));
    const on = ui.renderParts(Object.assign({}, ctx, { afmTag: true }));
    assert.equal(on.sel + on.mass + on.body, off.sel + off.mass + off.body, label + ': Karte');
    assert.ok(!off.teaser.includes('perf-t-tag'), label + ': Zusatz trotz Stellung aus');
    // Eine Phase zeigt eine Zahl genau dann, wenn sie ein <b> enthält; bei zweimal «kein Wert» kein Zusatz
    if (off.kind === 'result' && off.teaser.includes('<b')) {
      results++;
      const end = off.teaser.indexOf('</span>') + '</span>'.length;           // Ende des Kopfs (ohne innere Elemente)
      assert.ok(off.teaser.startsWith('<span class="perf-t-head">'), label);
      assert.equal(on.teaser, off.teaser.slice(0, end) + TAG + off.teaser.slice(end), label + ': Zusatz direkt nach dem Kopf');
      assertCleanTeaser(on.teaser, label);
    } else {
      if (off.kind === 'result') noNumber++; else others++;
      assert.equal(on.teaser, off.teaser, label + ': Zusatz ohne Zahl in der Kurzzeile');
    }
  });
  assert.ok(results >= 140 && others >= 20 && noNumber >= 2, results + ' mit Zahl, ' + noNumber + ' Ergebnis ohne Zahl, ' + others + ' ohne Ergebnis');
  // Zweimal «kein Wert» (304°/41 kt): kein Zusatz; eine Phase mit Zahl (Tecnam K10a): Zusatz
  assert.deepEqual(marked(parts(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 }), { afmTag: true }).teaser),
    [HEAD + 'Cessna 172 Diesel · Piste 30', roll('[nov]kein Wert', '[nov]kein Wert')]);
  assert.deepEqual(marked(parts(wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), { aircraft: P2010, afmTag: true }).teaser),
    [HEAD + 'Tecnam P2010 · Piste 30', 'perf-t-tag: Richtwert AFM', roll('[nov]kein Wert', '[amber]314 m')]);
  // Beispiele: eine Piste, windstill nass, ohne Windrichtung
  assert.deepEqual(marked(parts(wxPfa(), { afmTag: true }).teaser), [HEAD + 'Cessna 172 Diesel · Piste 30', 'perf-t-tag: Richtwert AFM', roll('331 m', '265 m')]);
  assert.deepEqual(marked(parts(CALM({ rain1hMm: 0.4 }), { afmTag: true }).teaser),
    [HEAD + 'Cessna 172 Diesel · windstill', 'perf-t-tag: Richtwert AFM', roll('[amber]423 m', '279 m')]);
  assert.deepEqual(marked(parts(NODIR(), { afmTag: true }).teaser),
    [HEAD + 'Cessna 172 Diesel · ohne Windrichtung', 'perf-t-tag: Richtwert AFM', roll('328 m', '270 m')]);
});
