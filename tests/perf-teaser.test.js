// Tests für die Kurzzeile unter der Briefing-Ampel (perf/perf-ui.js: renderParts) und ihre Lage in index.html.
// Grundsatz: Die Kurzzeile zeigt nie Zahlen, wenn die Karte keine zeigt, und wirkt nie günstiger als die Karte.
// Eine Rechnung (core.compute höchstens einmal), zwei Darstellungen. Sollwerte aus der Referenz des Planers.
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
const C172D = readJson('perf/aircraft/c172d.json');
const P2010 = readJson('perf/aircraft/p2010.json');
const C152 = readJson('perf/aircraft/c152.json');
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
const WARN = '\u26a0 ';

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
      out.push([/^<span class="([^"]+)">/.exec(html)[1], text(html).trim(), html]);
    }
  }
  assert.equal(depth, 0, 'span nicht geschlossen: ' + teaser);
  assert.equal(out.map((x) => x[2]).join(''), teaser, 'Text ausserhalb der Elemente: ' + teaser);
  return out;
}
// Lesbare Form mit Farbmarken: [amber]/[red] vor der Zahl, [nov] vor «kein Wert»
function marked(teaser) {
  return items(teaser).map(([cls, , html]) => cls + ': ' +
    text(html.replace(/<b class="perf-(amber|red)">/g, '[$1]').replace(/<span class="perf-nov">/g, '[nov]')).trim());
}
// Zeile einer Phase, streng nach Format
const ROW = new RegExp('^<span class="perf-t-row"><span class="perf-nw">(Start|Landung) über 15&nbsp;m: ' +
  '(?:<span class="perf-nov">kein Wert</span></span>|(bis )?<b(?: class="(perf-amber|perf-red)")?>(\\d{1,3}(?:\'\\d{3})*)&nbsp;m</b></span> ' +
  '<span class="perf-nw">· verfügbar (ab )?(\\d{1,3}(?:\'\\d{3})*)&nbsp;m</span>)</span>$');
function rowOf(html) {
  const m = ROW.exec(html);
  assert.ok(m, 'Zeile: ' + html);
  if (m[4] === undefined) return { phase: m[1], value: null };
  const num = (s) => Number(s.replace(/'/g, ''));
  return { phase: m[1], bis: !!m[2], cls: m[3] || null, value: num(m[4]), ab: !!m[5], avail: num(m[6]) };
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
  assert.ok(!teaser.includes('\ufe0f'), label + ': Variantenwähler beim Warnzeichen');
}

/* ── Zustandstabelle: genauer Text und Klasse je Zustand ───── */

const HEAD = 'perf-t-head: ';
const C172 = 'Start- und Landestrecke · Cessna 172 Diesel';
const state = (t) => 'perf-t-state: ' + t;
const row = (t) => 'perf-t-row: ' + t;
const warn = (t) => 'perf-t-warn: ' + WARN + t;
const DIR = 'Windrichtung unbekannt: Rückenwind möglich';
const WET = 'Piste nass: Strecken deutlich länger möglich';
// Gemischter Belag: Graspiste 12 zuerst, Hartbelagpiste 30 danach; gespiegelt mit der Hartbelagpiste an erster Stelle,
// damit die längste Strecke einmal von der zweiten Piste kommt
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

test('Kurzzeile mit Ergebnis: Kopf, je Phase «über 15 m» gegen «verfügbar», Farben wie die Karte (Sollwerte des Planers)', () => {
  const cases = [
    ['K2 trocken', parts(wxPfa()),
      [HEAD + 'Cessna 172 Diesel · Piste 30', row('Start über 15 m: 492 m · verfügbar 625 m'), row('Landung über 15 m: 489 m · verfügbar 520 m')]],
    ['K14n nass, Start über', parts(wxPfa({ tempC: 10.8, qnhHpa: 998.2, windDir: 247, windKt: 8.7, rain1hMm: 0.4 })),
      [HEAD + 'Cessna 172 Diesel · Piste 30', row('Start über 15 m: [amber]651 m · verfügbar 625 m'), row('Landung über 15 m: 518 m · verfügbar 520 m'),
        warn('Piste nass: Strecken deutlich länger möglich')]],
    ['K5 windstill', parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 })),
      [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten', row('Start über 15 m: [amber]525 m · verfügbar ab 520 m'),
        row('Landung über 15 m: 520 m · verfügbar ab 520 m')]],
    ['K12 ohne Richtung 2 kt: Rückenwind möglich (im Vorbehalt, nicht im Kopf)', parts(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 })),
      [HEAD + 'Cessna 172 Diesel · beide Pisten', row('Start über 15 m: 489 m · verfügbar ab 520 m'),
        row('Landung über 15 m: 506 m · verfügbar ab 520 m'), warn(DIR)]],
    ['K6 quer', parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 })),
      [HEAD + 'Cessna 172 Diesel · Wind quer · beide Pisten', row('Start über 15 m: [amber]560 m · verfügbar ab 520 m'),
        row('Landung über 15 m: [amber]533 m · verfügbar ab 520 m')]],
    ['K17 215°', parts(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 215, windKt: 10 })),
      [HEAD + 'Cessna 172 Diesel · Piste 30', row('Start über 15 m: 560 m · verfügbar 625 m'), row('Landung über 15 m: [amber]533 m · verfügbar 520 m')]],
    ['K8 Tecnam', parts(wxPfa(), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · Piste 30', row('Start über 15 m: [amber]744 m · verfügbar 625 m'), row('Landung über 15 m: [amber]897 m · verfügbar 520 m')]],
    ['K10a Tecnam Start ohne Wert', parts(wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · Piste 30', row('Start über 15 m: [nov]kein Wert'), row('Landung über 15 m: [amber]789 m · verfügbar 520 m')]],
    ['K11b Gegenwind 41 kt', parts(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 })),
      [HEAD + 'Cessna 172 Diesel · Piste 30', row('Start über 15 m: [nov]kein Wert'), row('Landung über 15 m: [nov]kein Wert')]],
    ['T1 Tecnam windstill 25 °C', parts(wxPfa({ tempC: 25, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · windstill · beide Pisten', row('Start über 15 m: [red]886 m · verfügbar ab 520 m'),
        row('Landung über 15 m: [amber]960 m · verfügbar ab 520 m')]],
    ['T4 Tecnam 50 °C, vierstellig', parts(wxPfa({ tempC: 50, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: P2010 }),
      [HEAD + 'Tecnam P2010 · windstill · beide Pisten', row("Start über 15 m: [red]1'068 m · verfügbar ab 520 m"),
        row("Landung über 15 m: [red]1'000 m · verfügbar ab 520 m")]],
    ['C2 Cessna 152', parts(wxPfa(), { aircraft: C152 }),
      [HEAD + 'Cessna 152 · Piste 30', row('Start über 15 m: 521 m · verfügbar 625 m'), row('Landung über 15 m: 432 m · verfügbar 520 m')]],
    ['C3 Cessna 152 nass', parts(wxPfa(), { aircraft: C152, fgzo: fgzo({ runway_condition: 'STANDING WATER' }) }),
      [HEAD + 'Cessna 152 · Piste 30', row('Start über 15 m: 521 m · verfügbar 625 m'), row('Landung über 15 m: 432 m · verfügbar 520 m'),
        warn('Piste nass: Strecken deutlich länger möglich')]],
    ['gemischter Belag: «bis» und «ab»', parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { airfield: mixed }),
      [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten', row('Start über 15 m: bis [amber]525 m · verfügbar ab 520 m'),
        row('Landung über 15 m: bis 520 m · verfügbar ab 520 m')]],
    ['gemischter Belag gespiegelt: längste Strecke von der zweiten Piste', parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { airfield: pavedFirst }),
      [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten', row('Start über 15 m: bis [amber]525 m · verfügbar ab 520 m'),
        row('Landung über 15 m: bis 520 m · verfügbar ab 520 m')]],
    ['drei Pisten', parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { airfield: three }),
      [HEAD + 'Cessna 172 Diesel · windstill · 3 Pisten', row('Start über 15 m: [amber]525 m · verfügbar ab 520 m'),
        row('Landung über 15 m: 520 m · verfügbar ab 520 m')]],
    ['eine Piste, windstill (Hinweis im Kopf)', parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { airfield: one }),
      [HEAD + 'Cessna 172 Diesel · windstill · Piste 12', row('Start über 15 m: [amber]525 m · verfügbar 520 m'), row('Landung über 15 m: 520 m · verfügbar 625 m')]],
    ['eine Piste ohne Wert, die andere mit: «kein Wert», nie die Zahl der anderen Piste',
      parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: withoutGrass(C172D, 'takeoff'), airfield: mixed }),
      [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten', row('Start über 15 m: [nov]kein Wert'), row('Landung über 15 m: bis 520 m · verfügbar ab 520 m')]]
  ];
  cases.forEach(([label, p, expected]) => {
    assert.equal(p.kind, 'result', label);
    assert.deepEqual(marked(p.teaser), expected, label);
    assertCleanTeaser(p.teaser, label);
  });
  // K2 einmal als genaues HTML: Kopf, Zeile aus zwei nicht umbrechenden Teilen, Zahl fett ohne Farbe
  assert.equal(parts(wxPfa()).teaser,
    '<span class="perf-t-head">Cessna 172 Diesel · Piste&nbsp;30</span>' +
    '<span class="perf-t-row"><span class="perf-nw">Start über 15&nbsp;m: <b>492&nbsp;m</b></span> <span class="perf-nw">· verfügbar 625&nbsp;m</span></span>' +
    '<span class="perf-t-row"><span class="perf-nw">Landung über 15&nbsp;m: <b>489&nbsp;m</b></span> <span class="perf-nw">· verfügbar 520&nbsp;m</span></span>');
});

test('Kurzzeile: Vorbehalte in fester Reihenfolge (Sperre, Windrichtung, Nässe bzw. unbekannt, Hinweis in den Details)', () => {
  const R = [row('Start über 15 m: 492 m · verfügbar 625 m'), row('Landung über 15 m: 489 m · verfügbar 520 m')];
  const RW = [row('Start über 15 m: 590 m · verfügbar 625 m'), row('Landung über 15 m: 489 m · verfügbar 520 m')];
  const H = HEAD + 'Cessna 172 Diesel · Piste 30';
  const cases = [
    ['Nässe durch FGZO', parts(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER' }) }), [H].concat(RW, warn('Piste nass: Strecken deutlich länger möglich'))],
    ['Nässe durch Regen', parts(wxPfa({ rain1hMm: 0.4 })), [H].concat(RW, warn('Piste nass: Strecken deutlich länger möglich'))],
    ['Nässe durch Regenrate', parts(wxPfa({ rain1hMm: null, rainMmH: 0.6 }), { fgzo: null }), [H].concat(RW, warn('Piste nass: Strecken deutlich länger möglich'))],
    ['Nässe aus veralteter FGZO-Meldung', parts(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET', fetched_at_utc: OLD }) }),
      [H].concat(RW, warn('Piste nass: Strecken deutlich länger möglich'))],
    ['Sperre frisch', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }) }), [H].concat(R, warn('Platz gesperrt'))],
    ['geschlossen frisch und nass', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen', runway_condition: 'WET' }) }),
      [H].concat(RW, warn('Platz geschlossen'), warn('Piste nass: Strecken deutlich länger möglich'))],
    ['Sperre veraltet (DRY veraltet: Hinweis)', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }) }),
      [H].concat(R, warn('Platz gesperrt (veraltete Meldung)'), warn('Hinweis in den Details'))],
    ['geschlossen veraltet', parts(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen', ok: false, fetched_at_utc: null }) }),
      [H].concat(R, warn('Platz geschlossen (veraltete Meldung)'), warn('Hinweis in den Details'))],
    ['Sperre veraltet, Regen unbekannt', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }) }),
      [H].concat(R, warn('Platz gesperrt (veraltete Meldung)'), warn('Pistenzustand unbekannt'))],
    ['DRY von gestern', parts(wxPfa(), { fgzo: fgzo({ updated: '17.11.2026, 16:20' }) }), [H].concat(R, warn('Hinweis in den Details'))],
    ['DRY mit unklarem Datum', parts(wxPfa(), { fgzo: fgzo({ updated: 'heute früh' }) }), [H].concat(R, warn('Hinweis in den Details'))],
    ['DRY veraltet, Regen bekannt', parts(wxPfa(), { fgzo: fgzo({ fetched_at_utc: OLD }) }), [H].concat(R, warn('Hinweis in den Details'))],
    ['DRY veraltet, Regen unbekannt', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ fetched_at_utc: OLD }) }),
      [H].concat(R, warn('Pistenzustand unbekannt'))],
    ['DRY ohne Zeitstempel', parts(wxPfa(), { fgzo: fgzo({ updated: '' }) }), [H].concat(R, warn('Hinweis in den Details'))],
    ['DRY ohne Zeitstempel, Regen unbekannt', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ updated: '' }) }),
      [H].concat(R, warn('Pistenzustand unbekannt'))],
    ['kein FGZO, kein Regenwert', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: null }), [H].concat(R, warn('Pistenzustand unbekannt'))],
    ['kein FGZO, Regen 0', parts(wxPfa(), { fgzo: null }), [H].concat(R)],
    ['DRY frisch von heute, Regenwert fehlt', parts(wxPfa({ rain1hMm: null, rainMmH: null })), [H].concat(R)],
    ['Standardmuster gewählt', parts(wxPfa(), { notice: 'Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.' }),
      [H].concat(R, warn('Hinweis in den Details'))],
    ['Standardmuster und DRY von gestern: ein Hinweis', parts(wxPfa(), { notice: 'x', fgzo: fgzo({ updated: '17.11.2026, 16:20' }) }),
      [H].concat(R, warn('Hinweis in den Details'))],
    ['Standardmuster, Sperre und unbekannt', parts(wxPfa({ rain1hMm: null, rainMmH: null }), { notice: 'x', fgzo: fgzo({ flaeche: 'gesperrt', fetched_at_utc: OLD }) }),
      [H].concat(R, warn('Platz gesperrt (veraltete Meldung)'), warn('Pistenzustand unbekannt'), warn('Hinweis in den Details'))]
  ];
  // Ohne Windrichtung (bis 3 kt) gerechnet: Rückenwind möglich, auch ohne gelbes Element der Karte; Reihenfolge fest
  const N = HEAD + 'Cessna 172 Diesel · beide Pisten';
  const RN = [row('Start über 15 m: 489 m · verfügbar ab 520 m'), row('Landung über 15 m: 506 m · verfügbar ab 520 m')];
  const nodir = (over) => wxPfa(Object.assign({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }, over));
  cases.push(
    ['ohne Windrichtung, DRY frisch', parts(nodir()), [N].concat(RN, warn(DIR))],
    ['ohne Windrichtung, nass und Sperre', parts(nodir({ rain1hMm: 0.4 }), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x' }) }),
      [N, row('Start über 15 m: [amber]587 m · verfügbar ab 520 m'), row('Landung über 15 m: 506 m · verfügbar ab 520 m'),
        warn('Platz gesperrt'), warn(DIR), warn(WET)]],
    ['ohne Windrichtung, Sperre veraltet, unbekannt', parts(nodir({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'x', fetched_at_utc: OLD }) }),
      [N].concat(RN, warn('Platz gesperrt (veraltete Meldung)'), warn(DIR), warn('Pistenzustand unbekannt'))],
    ['ohne Windrichtung, Hinweis', parts(nodir(), { notice: 'x' }), [N].concat(RN, warn(DIR), warn('Hinweis in den Details'))],
    ['ohne Windrichtung, DRY von gestern', parts(nodir(), { fgzo: fgzo({ updated: '17.11.2026, 16:20' }) }), [N].concat(RN, warn(DIR), warn('Hinweis in den Details'))],
    ['windstill: kein Vorbehalt zur Windrichtung', parts(nodir({ windKt: 0 })),
      [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten'].concat(RN)],
    ['Wind genau quer: kein Vorbehalt zur Windrichtung', parts(nodir({ windDir: 214, windKt: 10 })),
      [HEAD + 'Cessna 172 Diesel · Wind quer · beide Pisten'].concat(RN)]
  );
  cases.forEach(([label, p, expected]) => {
    assert.deepEqual(marked(p.teaser), expected, label);
    assertCleanTeaser(p.teaser, label);
  });
});

test('Kurzzeile ohne Ergebnis: keine Zahlen, Text je Zustand, Kopf mit Muster sobald geladen', () => {
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
    ['über dem Tabellenbereich', parts(wxPfa({ tempC: 50.1, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: P2010 }),
      [HEAD + 'Start- und Landestrecke · Tecnam P2010', state('Über dem Tabellenbereich des AFM – kein Wert')]],
    ['Richtung fehlt über 3 kt', parts(wxPfa({ windDir: null, windKt: 6 })), [HEAD + C172, state('Windrichtung fehlt – keine Berechnung')]],
    ['keine Gegenwindpiste', parts(wxPfa(), { airfield: one }), [HEAD + C172, state('Keine Piste mit Gegenwind – keine Berechnung')]],
    ['FGZO-Abruf läuft', parts(wxPfa(), { fgzoPending: true }), [HEAD + C172, load('Lade Flugplatzstatus …')]],
    ['keine Messwerte, FGZO-Abruf läuft (Messwerte zuerst)', parts(undefined, { fgzoPending: true }), [HEAD + C172, state('Keine aktuellen Messwerte – keine Berechnung')]],
    ['Daten laden', parts(wxPfa(), { dataState: 'loading', aircraft: null, selectedId: 'p2010' }),
      [HEAD + 'Start- und Landestrecke', load('Lade Flugzeug- und Platzdaten …')]],
    ['Daten laden mit Hinweis (die Karte zeigt ihn nicht)', parts(wxPfa(), { dataState: 'loading', notice: 'x' }),
      [HEAD + 'Start- und Landestrecke', load('Lade Flugzeug- und Platzdaten …')]],
    ['Datenfehler', parts(wxPfa(), { dataState: 'error', aircraft: null }), [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung')]],
    ['Datenfehler mit Hinweis', parts(wxPfa(), { dataState: 'error', aircraft: null, notice: 'x' }),
      [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung'), warn('Hinweis in den Details')]],
    ['ungültige Flugzeugdaten', parts(wxPfa(), { aircraft: Object.assign(clone(C172D), { schema: 1 }) }),
      [HEAD + 'Start- und Landestrecke', state('Daten nicht verfügbar – keine Berechnung')]],
    ['veraltet mit Hinweis', parts(wxPfa({ time: NOW - 46 * MIN }), { notice: 'x' }),
      [HEAD + C172, state('Messwerte veraltet – keine Berechnung'), warn('Hinweis in den Details')]]
  ];
  cases.forEach(([label, p, expected]) => {
    assert.notEqual(p.kind, 'result', label);
    assert.deepEqual(marked(p.teaser), expected, label);
    assert.ok(!p.teaser.includes('perf-t-row') && !p.teaser.includes('<b') && !p.teaser.includes('&nbsp;m'), label + ': Zahl ohne Ergebnis');
    assert.ok(!p.body.includes('perf-grid'), label);
    assertCleanTeaser(p.teaser, label);
  });
  // Version ungleich: Rechenfehler, ohne Muster und ohne Hinweis (die Karte zeigt beides nicht)
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
  // Texte ohne Satzpunkt, Warnzeichen U+26A0 ohne Variantenwähler
  Object.keys(T).forEach((k) => assert.ok(typeof T[k] === 'string' && !/\.$/.test(T[k]) && !/[<>&]/.test(T[k]), 'TEASER.' + k));
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

// Prüft eine Darstellung: Zahlen nur mit Pistenblöcken, je Phase grösste «über 15 m» und kleinste «verfügbar» der
// Karte, Farbe nie schwächer als die Karte, «–» ergibt «kein Wert», Vorbehalt genau bei gelbem Element der Karte
// oder bei Rechnung ohne Windrichtung (grauer Hinweis der Karte), in fester Reihenfolge.
function gleichlauf(ctx, label, stats) {
  const p = ui.renderParts(ctx);
  stats.n++;
  const hasGrid = p.body.includes('<div class="perf-grid">');
  assert.equal(p.kind === 'result', hasGrid, label + ': Zustand ' + p.kind);
  const it = items(p.teaser);
  assertCleanTeaser(p.teaser, label);
  const warns = it.filter(([c]) => c === 'perf-t-warn').map(([, t]) => t);
  warns.forEach((w) => assert.ok(w.startsWith(WARN), label + ': ' + w));
  assert.equal(new Set(warns).size, warns.length, label + ': Vorbehalt doppelt');
  const yellowCard = /class="perf-cond perf-warn"|class="perf-note"/.test(p.body);
  const nodirCard = p.body.includes('<div class="perf-hint">' + ui.TEXT.nodir + '</div>');
  assert.equal(warns.length > 0, yellowCard || nodirCard, label + ': Vorbehalt ⟺ gelbes Element der Karte oder ohne Windrichtung');
  if (!hasGrid) {
    assert.ok(!p.teaser.includes('perf-t-row') && !p.teaser.includes('<b') && !p.teaser.includes('&nbsp;m'), label + ': Zahl ohne Ergebnis');
    assert.deepEqual(it.map(([c]) => c).slice(0, 2), ['perf-t-head', p.kind === 'loading' || p.kind === 'fgzo-pending' ? 'perf-t-load' : 'perf-t-state'], label);
    assert.equal(it.length, 2 + warns.length, label + ': Elemente');
    return;
  }
  stats.results++;
  const blocks = cardBlocks(p.body);
  assert.ok(blocks.length > 0, label);
  assert.equal(it[0][0], 'perf-t-head', label);
  // Hinweiswort im Kopf nur bei Windstille und Wind quer; ohne Windrichtung sagt es der Vorbehalt
  const hint = p.body.includes(ui.TEXT.calm) ? 'windstill · ' : p.body.includes(ui.TEXT.cross) ? 'Wind quer · ' : '';
  const where = blocks.length === 1 ? 'Piste ' + blocks[0].id : (blocks.length === 2 ? 'beide Pisten' : blocks.length + ' Pisten');
  assert.equal(it[0][1], ctx.aircraft.label + ' · ' + hint + where, label + ': Kopf');
  const rows = it.filter(([c]) => c === 'perf-t-row');
  assert.equal(rows.length, 2, label);
  assert.equal(it.length, 3 + warns.length, label + ': Elemente');
  [['Start', 0], ['Landung', 1]].forEach(([phase, k]) => {
    const r = rowOf(rows[k][2]);
    assert.equal(r.phase, phase, label);
    const cells = blocks.map((b) => b.rows[phase]);
    if (cells.some((c) => c.oo === null)) {
      assert.equal(r.value, null, label + ' ' + phase + ': «–» in der Karte, Zahl in der Kurzzeile');
      stats.noValue++;
      if (cells.some((c) => c.oo !== null)) stats.noValueMixed++;
      return;
    }
    assert.notEqual(r.value, null, label + ' ' + phase + ': «kein Wert», die Karte hat überall Werte');
    const maxOo = Math.max(...cells.map((c) => c.oo)), minAv = Math.min(...cells.map((c) => c.avail));
    assert.equal(r.value, maxOo, label + ' ' + phase + ': grösste Strecke über 15 m');
    assert.equal(r.avail, minAv, label + ' ' + phase + ': kleinste verfügbare Länge');
    assert.equal(r.bis, cells.some((c) => c.oo !== maxOo), label + ' ' + phase + ': «bis»');
    assert.equal(r.ab, cells.some((c) => c.avail !== minAv), label + ' ' + phase + ': «ab»');
    assert.ok(r.value >= Math.max(...cells.map((c) => c.gr)), label + ' ' + phase + ': kleiner als die Rollstrecke');
    const sevCard = cells.some((c) => c.red) ? 2 : (cells.some((c) => c.amber) ? 1 : 0);
    const sev = r.cls === 'perf-red' ? 2 : (r.cls === 'perf-amber' ? 1 : 0);
    assert.equal(sev, Math.max(sevCard, r.value > r.avail ? 1 : 0), label + ' ' + phase + ': Farbe');
    assert.equal(sev > 0, r.value > r.avail, label + ' ' + phase + ': Farbe passt nicht zu den gezeigten Zahlen');
    if (sev > sevCard) stats.bumped++;
    if (sev) stats.colored++;
  });
  // Vorbehalte gegen die Karte, einzeln und in der festen Reihenfolge Sperre, Windrichtung, Nässe bzw. unbekannt, Hinweis
  const closedWord = p.body.includes('Platz laut FGZO geschlossen') ? 'Platz geschlossen' : 'Platz gesperrt';
  const has = (t) => warns.includes(WARN + t);
  const card = {
    closed: /<div class="perf-cond perf-warn" role="note"><div>Platz laut FGZO/.test(p.body),
    closedStale: /<div class="perf-note">Platz laut FGZO[^<]*\(veraltete Meldung\)\.<\/div>/.test(p.body),
    dirUnknown: nodirCard,
    wet: p.body.includes('Piste gilt als nass:'),
    unknown: p.body.includes('Pistenzustand unbekannt:'),
    inDetails: p.body.includes('<div class="perf-note" role="status">') ||
      (/<div class="perf-note">(?:Pistenzustand laut FGZO: DRY|Letzte FGZO-Meldung DRY|FGZO meldet DRY ohne Zeitstempel)/.test(p.body) &&
        !p.body.includes('Pistenzustand unbekannt:'))
  };
  const words = { closed: closedWord, closedStale: closedWord + ' (veraltete Meldung)', dirUnknown: DIR, wet: WET, unknown: 'Pistenzustand unbekannt',
    inDetails: 'Hinweis in den Details' };
  const order = ['closed', 'closedStale', 'dirUnknown', 'wet', 'unknown', 'inDetails'];
  order.forEach((k) => assert.equal(has(words[k]), card[k], label + ': ' + k));
  assert.deepEqual(warns, order.filter((k) => card[k]).map((k) => WARN + words[k]), label + ': Reihenfolge der Vorbehalte');
  order.forEach((k) => { if (card[k]) stats.warn[k]++; });
}

test('Gleichlauf: Kurzzeile und Karte aus einer Rechnung, über alle LSZK-Kontrollfälle × FGZO × Regen × Hinweis', () => {
  const stats = { n: 0, results: 0, noValue: 0, noValueMixed: 0, colored: 0, bumped: 0,
    warn: { closed: 0, closedStale: 0, dirUnknown: 0, wet: 0, unknown: 0, inDetails: 0 } };
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
  // ohne Ergebnis, Sonderplätze (gemischter Belag: «bis»), FGZO-Abruf läuft
  [undefined, wxPfa({ src: 'speck' }), wxPfa({ time: NOW - 46 * MIN }), wxPfa({ time: NOW + 10 * MIN }), wxPfa({ qnhHpa: null }), wxPfa({ qnhHpa: 850 }),
    wxPfa({ tempC: 45 }), wxPfa({ windDir: null, windKt: 6 })].forEach((w, i) => [null, 'x'].forEach((notice) => {
    gleichlauf(ctxOf(w, { fgzo: fgzo({ flaeche: 'gesperrt', runway_condition: 'WET' }), notice }), 'ohne Ergebnis ' + i, stats);
  }));
  gleichlauf(ctxOf(wxPfa(), { fgzoPending: true }), 'FGZO lädt', stats);
  gleichlauf(ctxOf(wxPfa(), { airfield: one }), 'eine Piste, Rückenwind', stats);
  [C172D, P2010, C152].forEach((ac) => [[20, 1013.25], [40, 1000], [-5, 1030]].forEach(([t, q]) => {
    [[0, null], [2, null]].forEach(([kt, dir]) => {
      const w = wxPfa({ tempC: t, qnhHpa: q, windDir: dir, windKt: kt });
      const tag = (kt ? ' ohne Richtung ' : ' windstill ') + ac.id + ' ' + t;
      gleichlauf(ctxOf(w, { aircraft: ac, airfield: mixed }), 'gemischter Belag' + tag, stats);
      gleichlauf(ctxOf(w, { aircraft: ac, airfield: pavedFirst }), 'gemischter Belag gespiegelt' + tag, stats);
      gleichlauf(ctxOf(w, { aircraft: ac, airfield: three }), 'drei Pisten' + tag, stats);
      core.PHASES.forEach((ph) => {
        gleichlauf(ctxOf(w, { aircraft: withoutGrass(ac, ph), airfield: mixed }), 'eine Piste ohne Wert ' + ph + tag, stats);
        gleichlauf(ctxOf(w, { aircraft: withoutGrass(ac, ph), airfield: pavedFirst }), 'eine Piste ohne Wert, gespiegelt ' + ph + tag, stats);
      });
    });
  }));
  // Abdeckung: jeder Zweig kommt vor
  assert.ok(lszk >= 50, 'LSZK-Kontrollfälle: ' + lszk);
  assert.ok(stats.n >= 8000 && stats.results >= 7000, JSON.stringify(stats));
  assert.ok(stats.noValue > 0 && stats.noValueMixed > 0 && stats.colored > 0 && stats.bumped > 0, JSON.stringify(stats));
  Object.keys(stats.warn).forEach((k) => assert.ok(stats.warn[k] > 0, 'Vorbehalt nie geprüft: ' + k));
});

/* ── Eine Rechnung, zwei Darstellungen ────────────────────── */

test('Eine Rechnung: core.compute je renderParts genau einmal (ab Messwerten) bzw. nie, Kurzzeile gleich dem Rechenergebnis', (t) => {
  const spy = t.mock.method(core, 'compute');
  const cases = [
    [ctxOf(wxPfa()), 1, false], [ctxOf(wxPfa({ rain1hMm: 0.4 })), 1, true], [ctxOf(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET' }) }), 1, true],
    [ctxOf(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0, rain1hMm: 0.4 }), { aircraft: P2010 }), 1, true],
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
        const rows = items(p.teaser).filter(([c]) => c === 'perf-t-row').map((x) => rowOf(x[2]));
        core.PHASES.forEach((ph, k) => {
          if (computed.some((r) => !r[ph].ok)) return assert.equal(rows[k].value, null);
          assert.equal(rows[k].value, Math.max(...computed.map((r) => r[ph].m.overObstacle)), 'Fall ' + i + ' ' + ph);
          assert.equal(rows[k].avail, Math.min(...computed.map((r) => r[ph].availableM)), 'Fall ' + i + ' ' + ph);
        });
      }
    }
    spy.mock.resetCalls();
    assert.equal(ui.renderHtml(ctx), p.sel + p.body, 'Fall ' + i + ': renderHtml = sel + body');
    assert.equal(spy.mock.callCount(), calls, 'Fall ' + i + ': renderHtml rechnet auch nur einmal');
  });
  // selectedId: ab geladenen Daten die id des geladenen Musters, vorher die gewünschte
  assert.equal(ui.renderParts(ctxOf(wxPfa(), { aircraft: P2010, selectedId: 'c172d' })).selectedId, 'p2010');
  assert.equal(ui.renderParts(ctxOf(wxPfa(), { dataState: 'loading', selectedId: 'c152' })).selectedId, 'c152');
});

/* ── Maskierung ───────────────────────────────────────────── */

test('Maskierung: Marke in Name, Pistenkennung, Liste, FGZO-Feldern und Hinweis erscheint nie roh in der Kurzzeile', () => {
  const MARK = '<img src=x onerror=alert(1)>';
  const ESC = '&lt;img src=x onerror=alert(1)&gt;';
  const raw = (p, label) => {
    assert.ok(!/<img/i.test(p.teaser), label + ': Marke roh in der Kurzzeile');
    assert.ok(!/<img/i.test(p.sel + p.body), label + ': Marke roh in der Karte');
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
    assert.ok(!p.teaser.includes('&lt;img') && (p.sel + p.body).includes(ESC), 'Liste ' + i);
  });
  [fgzo({ runway_condition: MARK, updated: MARK }), fgzo({ flaeche: 'gesperrt', flaeche_grund: MARK }), fgzo({ updated: MARK, fetched_at_utc: OLD }),
    fgzo({ flaeche: 'gesperrt', flaeche_grund: MARK, fetched_at_utc: OLD, runway_condition: MARK }), fgzo({ updated: '17.11.2026 ' + MARK })].forEach((f, i) => {
    p = parts(wxPfa({ srcLabel: MARK }), { fgzo: f });
    raw(p, 'FGZO ' + i);
    assert.ok(!p.teaser.includes('&lt;img'), 'FGZO ' + i + ': Text der FGZO in der Kurzzeile');
  });
  // Hinweis: nur «Hinweis in den Details», nie sein Text
  p = parts(wxPfa(), { notice: MARK });
  raw(p, 'Hinweis');
  assert.ok(p.teaser.endsWith('<span class="perf-t-warn">' + WARN + 'Hinweis in den Details</span>') && !p.teaser.includes('&lt;img'));
});

/* ── Seite ────────────────────────────────────────────────── */

test('Seite: <details id="perf-box"> einmal zwischen Ampel und Wetter-Panel, Karte darin ohne display:none, Skripte ab ?v=3', () => {
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
  assert.ok(v1 && v2 && Number(v1[1]) === core.VERSION && Number(v2[1]) === ui.VERSION && ui.VERSION >= 3, 'Skriptversion');
});

/* ── CSS der Kurzzeile ────────────────────────────────────── */

test('CSS der Kurzzeile: kein Dreieck, Flex im inneren span, Umbruch statt Überlauf, Fokusrahmen, gleiche Aussenmasse wie die Ampel', () => {
  // Regel ohne Einzug, also ausserhalb jeder @media-Regel
  const rule = (sel) => {
    const m = new RegExp('\\n' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(ui.CSS);
    return m ? m[1].trim() : null;
  };
  assert.equal(rule('.perf-box'), 'max-width: 1600px; margin: 0 auto 16px;');
  assert.ok(rule('.perf-teaser').startsWith('display: block; list-style: none; cursor: pointer;'));
  assert.equal(rule('.perf-teaser::-webkit-details-marker'), 'display: none;');
  assert.equal(rule('.perf-teaser:focus-visible'), 'outline: 2px solid var(--accent); outline-offset: 2px;');
  assert.equal(rule('.perf-t'), 'display: flex; align-items: flex-start; gap: 8px;');
  const body = rule('.perf-t-body');
  ['flex: 1;', 'min-width: 0;', 'display: flex;', 'flex-wrap: wrap;', 'overflow-wrap: break-word;'].forEach((x) => assert.ok(body.includes(x), x));
  // Ein langer Name ohne Leerzeichen darf die Seite nicht seitlich schieben: die Elemente dürfen schmaler werden als ihr längstes Wort
  assert.equal(rule('.perf-t-body > span'), 'min-width: 0;');
  assert.equal(rule('.perf-box[open] .perf-t-chev'), 'transform: rotate(180deg);');
  assert.equal(rule('.perf-box[open] > .perf-teaser'), 'margin-bottom: 8px;');
  assert.equal(rule('.perf-t-head'), 'font-weight: 600;');
  // Zusatz «Richtwert AFM» gedämpft und in normalem Gewicht (steht auch bei ausgeschaltetem Zusatz bereit)
  assert.equal(rule('.perf-t-tag'), 'color: var(--text-muted); font-weight: 400;');
  assert.equal(rule('.perf-t-state'), 'color: #f87171;');
  assert.equal(rule('.perf-t-load'), 'color: var(--text-muted);');
  assert.equal(rule('.perf-t-warn'), 'color: #fcd34d;');
  // Farben der Zahlen und von «kein Wert»: dieselben Regeln wie in der Karte
  assert.equal(rule('.perf-amber'), 'color: #f59e0b; font-weight: 700;');
  assert.equal(rule('.perf-red'), 'color: #ef4444; font-weight: 700;');
  assert.equal(rule('.perf-nov'), 'color: #f87171;');
  assert.ok(/@media \(max-width: 600px\) \{\n {2}\.perf-box \{ margin-bottom: 10px; \}/.test(ui.CSS), 'mobil 10 px wie die Ampel');
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

test('Schalter «Richtwert AFM» eingeschaltet: eigenes Element direkt nach dem Kopf, nur mit Zahlen; Karte und übrige Kurzzeile unverändert', () => {
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
    ['drei Pisten', ctxOf(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { airfield: three })]);
  let results = 0, others = 0;
  ctxs.forEach(([label, ctx]) => {
    const off = ui.renderParts(Object.assign({}, ctx, { afmTag: false }));
    const on = ui.renderParts(Object.assign({}, ctx, { afmTag: true }));
    assert.equal(on.sel + on.body, off.sel + off.body, label + ': Karte');
    assert.ok(!off.teaser.includes('perf-t-tag'), label + ': Zusatz trotz Stellung aus');
    if (off.kind === 'result') {
      results++;
      const end = off.teaser.indexOf('</span>') + '</span>'.length;           // Ende des Kopfs (ohne innere Elemente)
      assert.ok(off.teaser.startsWith('<span class="perf-t-head">'), label);
      assert.equal(on.teaser, off.teaser.slice(0, end) + TAG + off.teaser.slice(end), label + ': Zusatz direkt nach dem Kopf');
      assertCleanTeaser(on.teaser, label);
    } else {
      others++;
      assert.equal(on.teaser, off.teaser, label + ': Zusatz in einem Zustand ohne Zahlen');
    }
  });
  assert.ok(results >= 150 && others >= 20, results + ' mit Ergebnis, ' + others + ' ohne');
  // Beispiele: eine Piste (Kopfzeile), windstill nass (eigene Zeile), ohne Windrichtung
  assert.deepEqual(marked(parts(wxPfa(), { afmTag: true }).teaser), [HEAD + 'Cessna 172 Diesel · Piste 30', 'perf-t-tag: Richtwert AFM',
    row('Start über 15 m: 492 m · verfügbar 625 m'), row('Landung über 15 m: 489 m · verfügbar 520 m')]);
  assert.deepEqual(marked(parts(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0, rain1hMm: 0.4 }), { afmTag: true }).teaser),
    [HEAD + 'Cessna 172 Diesel · windstill · beide Pisten', 'perf-t-tag: Richtwert AFM', row('Start über 15 m: [amber]630 m · verfügbar ab 520 m'),
      row('Landung über 15 m: 520 m · verfügbar ab 520 m'), warn(WET)]);
  assert.deepEqual(marked(parts(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }), { afmTag: true }).teaser),
    [HEAD + 'Cessna 172 Diesel · beide Pisten', 'perf-t-tag: Richtwert AFM', row('Start über 15 m: 489 m · verfügbar ab 520 m'),
      row('Landung über 15 m: 506 m · verfügbar ab 520 m'), warn(DIR)]);
});
