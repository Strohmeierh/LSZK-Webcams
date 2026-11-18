// Adapter- und Anzeigetests für den Start-/Landestreckenrechner (perf/perf-ui.js, Datenschema 2).
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
const clone = (o) => JSON.parse(JSON.stringify(o));

// 18.11.2026, 09:15 Uhr in Zürich
const NOW = Date.UTC(2026, 10, 18, 8, 15);
const MIN = 60000;

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
function render(wx, over) {
  return ui.renderHtml(Object.assign({
    dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: wx, fgzo: fgzo(), nowMs: NOW, detailsOpen: false
  }, over));
}
// Sichtbarer Text: Tags weg, Entities auflösen, Leerraum zusammenfassen
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function block(html, id) {
  const start = html.indexOf('<section class="perf-block" aria-label="Piste ' + id + '">');
  if (start < 0) return null;
  return html.slice(start, html.indexOf('</section>', start) + 10);
}
function assertClean(html, label) {
  ['NaN', 'undefined', 'null', 'Infinity'].forEach((w) => assert.ok(!html.includes(w), (label || '') + ': enthält ' + w));
}
function assertNoResult(html, label) {
  ['perf-grid', 'perf-table', 'perf-block', 'perf-details', 'perf-meas', '&nbsp;m<'].forEach((w) => {
    assert.ok(!html.includes(w), (label || '') + ': Ergebnisblock (' + w + ')');
  });
  assert.ok(html.includes('class="perf-foot"'), (label || '') + ': Fusszeile fehlt');
}
const has = (html, s) => text(html).includes(s);

/* ── Adapter ───────────────────────────────────────────────── */

test('adaptLszkWx: gültige Werte, Böe nur Anzeige, Regenfelder', () => {
  const a = ui.adaptLszkWx(wxPfa({ rain1hMm: 0.4, rainMmH: 1.2 }), NOW);
  assert.equal(a.ok, true);
  assert.deepEqual(a.wx, { tempC: 15, qnhHpa: 1018, windDirTrue: 290, windKt: 8 });
  assert.deepEqual([a.gustKt, a.rain1hMm, a.rainMmH, a.srcLabel], [14, 0.4, 1.2, 'MeteoSchweiz Pfäffikon ZH']);
  [null, undefined, 'x', NaN, -1].forEach((g) => {
    const b = ui.adaptLszkWx(wxPfa({ gustKt: g }), NOW);
    assert.equal(b.ok, true, 'Böe ' + g);
    assert.equal(b.gustKt, null);
  });
  [[null, null], [undefined, null], ['0.4', null], [-0.1, null], [0, 0], [2.5, 2.5]].forEach(([v, exp]) => {
    assert.equal(ui.adaptLszkWx(wxPfa({ rain1hMm: v, rainMmH: v }), NOW).rain1hMm, exp, 'Regen ' + v);
  });
});

test('adaptLszkWx: Fälle ohne Wert, Alter selbst gerechnet', () => {
  const code = (w) => ui.adaptLszkWx(w, NOW).code;
  assert.equal(code(undefined), 'no-data');
  assert.equal(code(wxPfa({ src: 'speck' })), 'source-speck');
  assert.equal(code(wxPfa({ src: null })), 'no-source');
  assert.equal(code(wxPfa({ time: null })), 'no-time');
  assert.equal(code(wxPfa({ stale: true })), 'stale');
  assert.equal(code(wxPfa({ time: NOW - 46 * MIN, ageMin: 0 })), 'stale');
  assert.equal(ui.adaptLszkWx(wxPfa({ time: NOW - 45 * MIN, ageMin: 99 }), NOW).ok, true);
  assert.equal(ui.adaptLszkWx(wxPfa({ time: NOW + 6 * MIN }), NOW).future, true);
  assert.deepEqual(ui.adaptLszkWx(wxPfa({ qnhHpa: null, windKt: '8' }), NOW).fields, ['qnhHpa', 'windKt']);
  assert.deepEqual(ui.adaptLszkWx(wxPfa({ tempC: '15' }), NOW).fields, ['tempC']);
  assert.deepEqual(ui.adaptLszkWx(wxPfa({ windDir: '290' }), NOW).fields, ['windDir']);
  [[null, 8], [undefined, 2]].forEach(([dir, kt]) => {
    const w = wxPfa({ windKt: kt });
    if (dir === undefined) delete w.windDir; else w.windDir = dir;
    assert.equal(ui.adaptLszkWx(w, NOW).wx.windDirTrue, null);
  });
});

/* ── Nässe: Wahrheitstabelle ───────────────────────────────── */

test('Nässe U1–U8: FGZO frisch DRY/nicht DRY/unbekannt × Regen ja/nein/unbekannt', () => {
  const st = (fg, rain1h, rate) => {
    const f = ui.fgzoState(fg, NOW);
    const r = ui.rainState({ rain1hMm: rain1h, rainMmH: rate });
    return ui.wetState(f, r);
  };
  const stale = fgzo({ fetched_at_utc: new Date(NOW - 45 * MIN).toISOString() });
  const pick = (w) => [w.wet, w.byFgzo, w.byRain, w.unknown];
  assert.deepEqual(pick(st(fgzo(), 0, 0)), [false, false, false, false], 'U1 DRY, kein Regen');
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'STANDING WATER' }), 0, 0)), [true, true, false, false], 'U2 FGZO nass');
  assert.deepEqual(pick(st(fgzo(), 0.4, 0)), [true, false, true, false], 'U3 Regen in der Stunde');
  assert.deepEqual(pick(st(stale, 0, null)), [false, false, false, false], 'U4 ohne FGZO, kein Regen');
  assert.deepEqual(pick(st(stale, null, null)), [false, false, false, true], 'U5 unbekannt');
  assert.deepEqual(pick(st(null, null, 0.6)), [true, false, true, false], 'U6 Regenrate ohne Stundensumme');
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'WET' }), 0.4, 1)), [true, true, true, false], 'U7 beides');
  assert.deepEqual(pick(st(fgzo(), null, null)), [false, false, false, false], 'U8 DRY, Regenwert fehlt');
  assert.deepEqual(pick(st(fgzo(), 0, 0.6)), [true, false, true, false], 'Rate > 0 bei Stundensumme 0');
  assert.deepEqual(ui.rainState({ rain1hMm: 0, rainMmH: 0.6 }).basis, 'rate');
  assert.equal(ui.WET_BY_RAIN, true);
});

test('Nässe aus der letzten FGZO-Meldung: veraltet, ok=false und ohne Zeitstempel nass; DRY nur frisch mit Zeitstempel gesichert', () => {
  const st = (fg, rain1h, rate) => ui.wetState(ui.fgzoState(fg, NOW), ui.rainState({ rain1hMm: rain1h, rainMmH: rate }));
  const pick = (w) => [w.wet, w.byFgzo, w.byRain, w.unknown];
  const old = new Date(NOW - 54 * MIN).toISOString();
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'STANDING WATER', fetched_at_utc: old }), 0, 0)), [true, true, false, false], 'veraltet, nicht DRY');
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'WET', ok: false }), 0, 0)), [true, true, false, false], 'ok=false, nicht DRY');
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'WET', ok: false, fetched_at_utc: null }), null, null)), [true, true, false, false], 'ohne Abrufzeit');
  assert.deepEqual(pick(st(fgzo({ runway_condition: 'WET', updated: undefined }), 0, 0)), [true, true, false, false], 'ohne Zeitstempel');
  assert.deepEqual(pick(st(fgzo({ updated: '' }), null, null)), [false, false, false, true], 'DRY ohne Zeitstempel: unbekannt');
  assert.deepEqual(pick(st(fgzo({ updated: 42 }), null, null)), [false, false, false, true], 'DRY, Zeitstempel kein String');
  assert.deepEqual(pick(st(fgzo({ updated: '  ' }), 0, 0)), [false, false, false, false], 'DRY ohne Zeitstempel, Regenwert da');
  assert.deepEqual(pick(st(fgzo({ fetched_at_utc: old }), null, null)), [false, false, false, true], 'DRY veraltet, ohne Regenwert');
  assert.deepEqual(pick(st(fgzo({ fetched_at_utc: old }), 0.2, null)), [true, false, true, false], 'DRY veraltet, Regen');
  assert.deepEqual(pick(st(fgzo({ updated: '17.11.2026, 16:20' }), null, null)), [false, false, false, false], 'DRY frisch von gestern');
  let f = ui.fgzoState(fgzo({ updated: '17.11.2026, 16:20' }), NOW);
  assert.deepEqual([f.kind, f.fresh, f.today, f.dayKnown], ['dry', true, false, true]);
  f = ui.fgzoState(fgzo(), NOW);
  assert.deepEqual([f.kind, f.fresh, f.today, f.updated], ['dry', true, true, '18.11.2026, 07:14']);
  f = ui.fgzoState(fgzo({ updated: '7.11.2026, 07:14' }), NOW);
  assert.deepEqual([f.today, f.dayKnown], [false, true]);
  f = ui.fgzoState(fgzo({ updated: '18.11.20261, 07:14' }), NOW);
  assert.deepEqual([f.today, f.dayKnown], [false, false]);
  f = ui.fgzoState(fgzo({ updated: { a: 1 }, runway_condition: ' wet ' }), NOW);
  assert.deepEqual([f.kind, f.updated, f.condition], ['notdry', null, 'WET']);
  // Ein vorhandener Zustand, der kein String ist, zählt als «nicht DRY» (nass); fehlt er, gibt es keine Meldung
  for (const rc of [42, true, { a: 1 }, ['WET']]) {
    f = ui.fgzoState(fgzo({ runway_condition: rc }), NOW);
    assert.deepEqual([f.kind, f.condition], ['notdry', 'UNLESBAR'], 'Zustand ' + JSON.stringify(rc));
    assert.deepEqual(pick(st(fgzo({ runway_condition: rc }), 0, 0)), [true, true, false, false], 'nass bei ' + JSON.stringify(rc));
  }
  for (const rc of [null, undefined, '', '   ']) {
    f = ui.fgzoState(fgzo({ runway_condition: rc }), NOW);
    assert.deepEqual([f.kind, f.condition], ['unknown', null], 'kein Zustand ' + JSON.stringify(rc));
  }
  // Datumsvergleich mit Jahr: gleicher Tag und Monat im Vorjahr ist nicht heute
  f = ui.fgzoState(fgzo({ updated: '18.11.2025, 07:14' }), NOW);
  assert.deepEqual([f.today, f.dayKnown], [false, true], 'Vorjahr');
  // Datum ohne führende Nullen wird erkannt: 8.1.2026 am 8. Januar 2026 ist heute
  const jan8 = Date.UTC(2026, 0, 8, 9, 0);
  f = ui.fgzoState(fgzo({ updated: '8.1.2026, 07:14', fetched_at_utc: new Date(jan8 - 5 * MIN).toISOString() }), jan8);
  assert.deepEqual([f.kind, f.fresh, f.today, f.dayKnown], ['dry', true, true, true], 'ohne führende Nullen');
  // Abrufzeit als Zahl ist nicht lesbar: kein Alter, nicht frisch
  f = ui.fgzoState(fgzo({ fetched_at_utc: NOW - 5 * MIN }), NOW);
  assert.deepEqual([f.ageMin, f.fresh], [null, false], 'Abrufzeit als Zahl');
  f = ui.fgzoState(fgzo({ fetched_at_utc: old, flaeche: 'gesperrt', flaeche_grund: 'x' }), NOW);
  assert.deepEqual([f.fresh, f.closed, f.closedStale, f.closedReason], [false, false, true, 'x']);
  // Mitternacht in Zürich: 23:30 UTC am 17.11. ist 00:30 Uhr am 18.11.
  const late = Date.UTC(2026, 10, 17, 23, 30);
  f = ui.fgzoState(fgzo({ updated: '18.11.2026, 00:10', fetched_at_utc: new Date(late - 10 * MIN).toISOString() }), late);
  assert.deepEqual([f.fresh, f.today], [true, true]);
  assert.deepEqual([ui.fgzoState([fgzo()], NOW).kind, ui.fgzoState('DRY', NOW).kind, ui.fgzoState(null, NOW).kind], ['unknown', 'unknown', 'unknown']);
});

test('fgzoAccept: neuer FGZO-Satz nur mit lesbarer, nicht älterer Abrufzeit', () => {
  const a = fgzo();                                   // Abruf vor 14 min
  const at = (min) => fgzo({ fetched_at_utc: new Date(NOW - min * MIN).toISOString() });
  assert.equal(ui.fgzoAccept(null, a), true, 'erster Satz');
  assert.equal(ui.fgzoAccept({}, a), true, 'gespeicherter Satz ohne Abrufzeit');
  // Ohne gespeicherten Satz mit Abrufzeit zählt auch ein Satz ohne lesbare Abrufzeit (ein erstes «WET» geht nicht verloren)
  const wetNoTime = fgzo({ runway_condition: 'WET', fetched_at_utc: null });
  assert.equal(ui.fgzoAccept(null, wetNoTime), true, 'erster Satz ohne Abrufzeit');
  assert.equal(ui.fgzoAccept(fgzo({ fetched_at_utc: 'kaputt' }), wetNoTime), true, 'gespeicherter Satz mit kaputter Abrufzeit');
  assert.equal(ui.fgzoAccept(null, {}), true, 'leerer erster Satz (ergibt «unbekannt» wie bisher)');
  assert.equal(ui.fgzoState(wetNoTime, NOW).kind, 'notdry', 'erstes WET ohne Abrufzeit zählt als nass');
  assert.equal(ui.fgzoAccept(null, null), false, 'kein Objekt');
  assert.equal(ui.fgzoAccept(null, []), false, 'Array');
  assert.equal(ui.fgzoAccept(a, at(5)), true, 'neuer');
  assert.equal(ui.fgzoAccept(a, fgzo({ runway_condition: 'WET', ok: false })), true, 'gleiche Abrufzeit');
  assert.equal(ui.fgzoAccept(a, at(20)), false, 'älter');
  for (const bad of [{}, null, undefined, [], 'DRY', 42, fgzo({ fetched_at_utc: 'kaputt' }), fgzo({ fetched_at_utc: NOW }),
    fgzo({ fetched_at_utc: null }), { ok: false, failed_at_utc: new Date(NOW).toISOString() }]) {
    assert.equal(ui.fgzoAccept(a, bad), false, 'abgelehnt: ' + JSON.stringify(bad));
  }
});

test('Pistenzustand-Texte: letzte Meldung nass, DRY veraltet, nicht von heute oder ohne Zeitstempel in der Hinweisfarbe', () => {
  const old = new Date(NOW - 54 * MIN).toISOString();
  let html = render(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38', ok: false, fetched_at_utc: old }) });
  assert.ok(has(html, 'Piste gilt als nass: letzte FGZO-Meldung «STANDING WATER» (Stand 18.11.2026, 10:38), Abruf vor 54 min – vorsichtshalber weiter nass gerechnet. Start: mindestens +20 % eingerechnet'), text(html));
  assert.ok(html.includes('perf-warn') && has(block(html, '30'), 'Start 397 m 590 m'), 'nass gerechnet');
  html = render(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET', updated: null }) });
  assert.ok(has(html, 'Piste gilt als nass: FGZO meldet «WET» (ohne Zeitstempel).'), text(html));
  html = render(wxPfa(), { fgzo: fgzo({ runway_condition: 'WET', updated: null, fetched_at_utc: 'kaputt' }) });
  assert.ok(has(html, 'Piste gilt als nass: letzte FGZO-Meldung «WET» (ohne Zeitstempel), Abrufzeit unbekannt – vorsichtshalber weiter nass gerechnet.'), text(html));
  html = render(wxPfa(), { fgzo: fgzo({ fetched_at_utc: old }) });
  assert.ok(html.includes('<div class="perf-note">Letzte FGZO-Meldung DRY ist veraltet (Stand 18.11.2026, 07:14, Abruf vor 54 min).</div>'), html);
  assert.ok(has(html, 'MeteoSchweiz hat in der letzten Stunde keinen Regen gemessen. Gerechnet für trockenes Gras.'));
  assert.ok(!has(html, 'Pistenzustand laut FGZO: DRY') && !html.includes('perf-warn'));
  assert.ok(has(block(html, '30'), 'Start 331 m 492 m'), 'trocken gerechnet');
  html = render(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ fetched_at_utc: old }) });
  assert.ok(html.includes('<div class="perf-note">Letzte FGZO-Meldung DRY ist veraltet (Stand 18.11.2026, 07:14, Abruf vor 54 min). ' + ui.TEXT.unknown + '</div>'), html);
  html = render(wxPfa({ rain1hMm: 0.4 }), { fgzo: fgzo({ fetched_at_utc: old }) });
  assert.ok(has(html, 'Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,4 mm Regen gemessen.') && has(block(html, '30'), 'Start 397 m'));
  html = render(wxPfa(), { fgzo: fgzo({ updated: '17.11.2026, 16:20' }) });
  assert.ok(html.includes('<div class="perf-note">Pistenzustand laut FGZO: DRY (Stand 17.11.2026, 16:20) – Meldung nicht von heute.</div>'), html);
  assert.ok(has(block(html, '30'), 'Start 331 m 492 m'));
  html = render(wxPfa(), { fgzo: fgzo({ updated: '' }) });
  assert.ok(html.includes('<div class="perf-note">FGZO meldet DRY ohne Zeitstempel – gilt als unbekannt.</div>'), html);
  assert.ok(!has(html, 'Pistenzustand: keine aktuelle Meldung der FGZO.'));
  html = render(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ updated: undefined }) });
  assert.ok(html.includes('<div class="perf-note">FGZO meldet DRY ohne Zeitstempel – gilt als unbekannt. ' + ui.TEXT.unknown + '</div>'), html);
  html = render(wxPfa());
  assert.ok(!html.includes('perf-note') && has(html, 'Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 07:14). MeteoSchweiz'));
});

test('FGZO-Texte auf 40 Zeichen gekürzt (Pistenzustand und Zeitstempel)', () => {
  const cond = 'STANDING WATER AND PATCHES OF SLUSH ON THE ENTIRE RUNWAY';
  const stamp = '18.11.2026, 10:38 Nachtrag der Flugplatzleitung zum Abschnitt Ost';
  const cut = (s) => s.slice(0, 39) + '…';
  let t = text(render(wxPfa(), { fgzo: fgzo({ runway_condition: cond, updated: stamp }) }));
  assert.ok(t.includes('FGZO meldet «' + cut(cond) + '» (Stand ' + cut(stamp) + ').'), t);
  t = text(render(wxPfa(), { fgzo: fgzo({ updated: stamp }) }));
  assert.ok(t.includes('Pistenzustand laut FGZO: DRY (Stand ' + cut(stamp) + ').'), t);
  assert.equal(cut(cond).length, 40);
});

/* ── Anzeige Cessna ────────────────────────────────────────── */

test('Cessna trocken (K2): Auswahl, Kopf, Messwerte, nur Gegenwindpiste, Zustand, Fusszeile', () => {
  const html = render(wxPfa());
  assertClean(html, 'K2');
  const t = text(html);
  assert.ok(html.includes('<label class="perf-ac-label" for="perf-ac">Flugzeug</label><select id="perf-ac" class="perf-select">'));
  assert.ok(html.includes('<select id="perf-ac" class="perf-select"><option value="c172d" selected>Cessna 172 Diesel · HB-TDA, HB-TDB, HB-TDC, HB-TDD</option>' +
    '<option value="p2010">Tecnam P2010 · HB-KMD</option><option value="c152">Cessna 152 · HB-CFA, HB-CYF, HB-CYP</option></select>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 1'157 kg (2'550 lb) · Kurzstart- und Kurzlandetechnik · Motor TAE 125-02-114, Propeller MTV-6-A/190-69"), t);
  assert.ok(t.includes("Messwerte MeteoSchweiz Pfäffikon ZH, 09:00 Uhr (vor 15 min): 15,0 °C · QNH 1018,0 hPa · Wind 290° / 8,0 kt, Böen 14 kt · Druckhöhe 1'630 ft"), t);
  assert.ok(t.includes('Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 07:14). MeteoSchweiz hat in der letzten Stunde keinen Regen gemessen. Gerechnet für trockenes Gras. Tau, Reif, eben einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.'), t);
  assert.equal(block(html, '12'), null, 'Rückenwindpiste ohne Block');
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Piste 30 · Gegenwind 7 kt'), b30);
  assert.ok(b30.includes('Start 331 m 492 m 625 m') && b30.includes('Landung 265 m 489 m 520 m'), b30);
  assert.ok(t.includes('Piste 12: Rückenwind – nicht berechnet.'));
  assert.ok(!html.includes('perf-factor'), 'keine Faktorzeile bei der Cessna');
  assert.ok(!html.includes('perf-warn'));
  assert.ok(t.includes(C172D.footerDe));
  assert.ok(!/#10b981|var\(--green\)|var\(--accent\)/.test(html), 'nie grün, nie Akzentfarbe');
});

test('Cessna trocken (K2): Rechenweg wie im Wortlaut des Planers', () => {
  const t = text(render(wxPfa()));
  assert.ok(t.includes('Start: Tabelle 306 / 479 m · Gegenwind 7 kt: −7 % → 284,58 / 445,47 m · Gras +15 % von 306 m = +45,9 m → 330,48 / 491,37 m → aufgerundet 331 / 492 m'), t);
  assert.ok(t.includes("Landung: Tabelle 630 / 1'420 ft · Gegenwind 7 kt: −7 % → 585,9 / 1'320,6 ft · Gras +45 % von 630 ft = +283,5 ft → 869,4 / 1'604,1 ft = 265 / 488,93 m → aufgerundet 265 / 489 m"), t);
  assert.ok(t.includes("Druckhöhe 1'630 ft (aus QNH 1018,0 hPa und Platzhöhe 1'759 ft) → Tabellenzeile 2'000 ft · Temperatur 15,0 °C → Tabellenspalte 20 °C"), t);
  assert.ok(t.includes('Wind aus 290°: Gegenwindkomponente 7,76 kt aus dem Mittelwind 8,00 kt, abgerundet 7 kt.'), t);
  assert.ok(t.includes('Piste 12: Wind aus 290°, Rückenwindkomponente 7,76 kt aus dem Mittelwind – nicht berechnet.'), t);
  ['Start (Supplement): Ground Roll and Take-Off Distance at 1157 kg (2550 lbs), Short Field Takeoff, Figure 5-1a (Section 5b), Seite 5b-3.',
    'Landung (Grundhandbuch): Short Field Landing Distance at 2550 Pounds, Figure 5-11, Seite 5-24.',
    'Doc.-No. 20-0310-22122', 'EASA STC 10014287', '172SIMBUS-00', 'Seitenkennung 172SPHBUS-00',
    C172D.readingRuleDe + ' Rundung immer zur längeren Strecke', 'Gerechnet wird nur die Piste mit Gegenwind',
    'Nasse Piste: Die Piste gilt als nass', 'AD INFO 1 LSZK',
    "Gewicht 1'157 kg (2'550 lb): " + C172D.massNoteDe].forEach((s) => assert.ok(t.includes(s), 'fehlt: ' + s));
  assert.ok(text(render(wxPfa(), { aircraft: P2010 })).includes("Gewicht 1'160 kg (2'557 lb): " + P2010.massNoteDe));
  const noNote = clone(C172D);
  delete noNote.massNoteDe;
  assert.ok(!text(render(wxPfa(), { aircraft: noNote })).includes("Gewicht 1'157 kg"));
});

test('Cessna nass durch FGZO (K3): gelber Kasten mit Quelle und Folge je Phase, Start × 1,20', () => {
  const html = render(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' }) });
  const t = text(html);
  assert.ok(html.includes('class="perf-cond perf-warn"'));
  assert.ok(t.includes('Piste gilt als nass: FGZO meldet «STANDING WATER» (Stand 18.11.2026, 10:38). Start: mindestens +20 % eingerechnet (Supplement, Note 4). Landung: Das AFM nennt für nasses Gras keinen Wert; die Strecke kann deutlich länger sein.'), t);
  assert.ok(text(block(html, '30')).includes('Start 397 m 590 m 625 m'));
  assert.ok(t.includes('Start: Tabelle 306 / 479 m · Gegenwind 7 kt: −7 % → 284,58 / 445,47 m · Gras +15 % von 306 m = +45,9 m → 330,48 / 491,37 m · nasse Piste: mindestens × 1,20 (Supplement, Note 4) → 396,58 / 589,65 m → aufgerundet 397 / 590 m'), t);
  assert.ok(!t.includes('Gerechnet für trockenes Gras'));
});

test('Cessna nass durch Regen: Quelle Stunde, Rate und beide', () => {
  let t = text(render(wxPfa({ rain1hMm: 0.4 })));
  assert.ok(t.includes('Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,4 mm Regen gemessen. Start: mindestens +20 % eingerechnet'), t);
  t = text(render(wxPfa({ rain1hMm: null, rainMmH: 0.6 }), { fgzo: null }));
  assert.ok(t.includes('Piste gilt als nass: MeteoSchweiz misst Regen (0,6 mm/h).'), t);
  t = text(render(wxPfa({ rain1hMm: 1.25 }), { fgzo: fgzo({ runway_condition: 'WET' }) }));
  assert.ok(t.includes('Piste gilt als nass: FGZO meldet «WET» (Stand 18.11.2026, 07:14); MeteoSchweiz hat in der letzten Stunde 1,25 mm Regen gemessen.'), t);
});

test('Trocken, unbekannt und fehlender Regenwert: Sätze und Farben', () => {
  let html = render(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: null });
  assert.ok(html.includes('<div class="perf-note">Pistenzustand unbekannt: keine aktuelle Meldung der FGZO und kein Regenwert von MeteoSchweiz.</div>'), html);
  assert.ok(has(html, 'Gerechnet für trockenes Gras. Tau, Reif'));
  assert.ok(has(html, 'Start 331 m 492 m'), 'trocken gerechnet');
  html = render(wxPfa({ rain1hMm: null, rainMmH: null }));
  assert.ok(has(html, 'Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 07:14). Ein Regenwert von MeteoSchweiz fehlt.'));
  html = render(wxPfa({ rain1hMm: null, rainMmH: 0 }), { fgzo: null });
  assert.ok(has(html, 'Pistenzustand: keine aktuelle Meldung der FGZO. MeteoSchweiz misst zurzeit keinen Regen; die Stundensumme fehlt.'));
  assert.ok(!html.includes('perf-note'));
});

/* ── Anzeige Tecnam ────────────────────────────────────────── */

test('Tecnam (K8): Kopf, Zahlen, Faktorzeile, interpolierter Rechenweg, Fusszeile', () => {
  const html = render(wxPfa(), { aircraft: P2010 });
  assertClean(html, 'K8');
  const t = text(html);
  assert.ok(html.includes('<option value="p2010" selected>Tecnam P2010 · HB-KMD</option>'));
  assert.ok(t.includes("Maximales Abfluggewicht 1'160 kg (2'557 lb) · Klappen T/O beim Start und LAND bei der Landung, Geschwindigkeiten nach AFM · Lycoming IO-360-M1A, Verstellpropeller MTV-15-B/193-52"), t);
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Start 409 m 744 m 625 m') && b30.includes('Landung 423 m 897 m 520 m'), b30);
  assert.ok(t.includes('Eingerechnet nach AFM: Faktor für Abweichungen im Betrieb – Start × 1,10 (NOTE, APV5-8), Landung × 1,67 (NOTE, APV5-17).'), t);
  assert.ok(t.includes('Start: Tabelle 352 / 622 m bei 0 °C und 434 / 762 m bei 25 °C, Gewicht 0,6 → 401,2 / 706 m · Gegenwind 7 kt: −10 m je kt = −70 m → 331,2 / 636 m · Gras +10 % von 401,2 m = +40,12 m → 371,32 / 676,12 m · Faktor für Abweichungen im Betrieb × 1,10 (NOTE, APV5-8) → 408,46 / 743,74 m → aufgerundet 409 / 744 m'), t);
  assert.ok(t.includes('Landung: Tabelle 242 / 526 m bei 0 °C und 264 / 548 m bei 25 °C, Gewicht 0,6 → 255,2 / 539,2 m · Gegenwind 7 kt: −4 m je kt = −28 m → 227,2 / 511,2 m · Gras +10 % von 255,2 m = +25,52 m → 252,72 / 536,72 m · Faktor für Abweichungen im Betrieb × 1,67 (NOTE, APV5-17) → 422,05 / 896,33 m → aufgerundet 423 / 897 m'), t);
  assert.ok(t.includes('Temperatur 15,0 °C → zwischen den Tabellenspalten 0 °C und 25 °C linear interpoliert (Gewicht 0,6)'), t);
  assert.ok(t.includes(P2010.readingRuleDe), 'Ablesung des Musters');
  assert.ok(t.includes(P2010.footerDe));
  assert.ok(t.includes('AFM: Tecnam P2010 Aircraft Flight Manual, Doc. No. 2010/100'), t);
});

test('Tecnam nass durch Regen: Hinweis ohne Zuschlag, Zahlen unverändert, Gewicht mit drei Stellen', () => {
  let html = render(wxPfa({ rain1hMm: 0.4 }), { aircraft: P2010 });
  assert.ok(has(html, 'Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,4 mm Regen gemessen. Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein. Laut AFM (Section 4, Ziffer 5.16) verschlechtert Regen die Leistung, besonders die Startstrecke.'));
  assert.ok(text(block(html, '30')).includes('Start 409 m 744 m'));
  html = render(wxPfa({ tempC: 10.8, qnhHpa: 998.2, windDir: 247, windKt: 8.7 }), { aircraft: P2010 });   // K21
  assert.ok(has(html, 'Temperatur 10,8 °C → zwischen den Tabellenspalten 0 °C und 25 °C linear interpoliert (Gewicht 0,432)'));
  assert.ok(text(block(html, '30')).includes('Start 468 m 821 m') && text(block(html, '30')).includes('Landung 453 m 927 m'));
  html = render(wxPfa({ tempC: -30, windKt: 0 }), { aircraft: P2010 });                                  // T3
  assert.ok(has(html, 'Temperatur −30,0 °C → Tabellenspalte −25 °C (kleinster Tabellenwert)'), text(html));
});

/* ── Anzeige Cessna 152 ────────────────────────────────────── */

test('Cessna 152 trocken (C2): Auswahl mit drei Mustern, Kopf, Zahlen, Rechenweg in ft, Quellen, Fusszeile', () => {
  const html = render(wxPfa(), { aircraft: C152 });
  assertClean(html, 'C2');
  const t = text(html);
  assert.equal((html.match(/<option /g) || []).length, 3);
  assert.ok(html.includes('<option value="c172d">Cessna 172 Diesel · HB-TDA, HB-TDB, HB-TDC, HB-TDD</option><option value="p2010">Tecnam P2010 · HB-KMD</option>' +
    '<option value="c152" selected>Cessna 152 · HB-CFA, HB-CYF, HB-CYP</option>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 758 kg (1'670 lb) · Kurzstart- und Kurzlandetechnik · Motor Lycoming O-235-L2C, Festpropeller"), t);
  assert.equal(block(html, '12'), null, 'Rückenwindpiste ohne Block');
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Piste 30 · Gegenwind 7 kt'), b30);
  assert.ok(b30.includes('Start 300 m 521 m 625 m') && b30.includes('Landung 219 m 432 m 520 m'), b30);
  assert.ok(t.includes("Druckhöhe 1'630 ft (aus QNH 1018,0 hPa und Platzhöhe 1'759 ft) → Tabellenzeile 2'000 ft · Temperatur 15,0 °C → Tabellenspalte 20 °C"), t);
  assert.ok(t.includes("Start: Tabelle 910 / 1'690 ft · Gegenwind 7 kt: −7 % → 846,3 / 1'571,7 ft · Gras +15 % von 910 ft = +136,5 ft → 982,8 / 1'708,2 ft = 299,56 / 520,66 m → aufgerundet 300 / 521 m"), t);
  assert.ok(t.includes("Landung: Tabelle 520 / 1'270 ft · Gegenwind 7 kt: −7 % → 483,6 / 1'181,1 ft · Gras +45 % von 520 ft = +234 ft → 717,6 / 1'415,1 ft = 218,73 / 431,33 m → aufgerundet 219 / 432 m"), t);
  ['Start (Handbuch): Takeoff Distance, Short Field, 1670 lbs, Figure 5-4, Seite 5-11.',
    'Landung (Handbuch): Landing Distance, Short Field, 1670 lbs, Figure 5-10, Seite 5-19.',
    "Handbuch: Pilot's Operating Handbook and FAA Approved Airplane Flight Manual, 1980 Model 152, Cessna Aircraft Company, D1170-1-13PH",
    'Handbuch der HB-CYF (Titelblatt: Serial No. F1521792). Gilt gleich für die baugleichen HB-CFA und HB-CYP.',
    'Abheben mit 50 KIAS, 54 KIAS in 15 m Höhe', 'Klappen 30°, Leerlauf, maximales Bremsen, 54 KIAS in 15 m Höhe',
    'Für nasses Gras nennt das AFM beim Start keinen Wert.', 'Für nasses Gras nennt das AFM bei der Landung keinen Wert.',
    C152.readingRuleDe + ' Rundung immer zur längeren Strecke',
    "Gewicht 758 kg (1'670 lb): " + C152.massNoteDe].forEach((s) => assert.ok(t.includes(s), 'fehlt: ' + s));
  assert.ok(!html.includes('perf-factor'), 'keine Faktorzeile');
  assert.ok(!html.includes('perf-warn') && !html.includes('perf-note'));
  assert.ok(t.includes(C152.footerDe));
  ['TAE 125', 'MTV-', 'Supplement', 'Doc.-No.', 'APV5', '172S', "1'157", "1'160"].forEach((s) => assert.ok(!t.includes(s), 'Text eines anderen Musters: ' + s));
});

test('Cessna 152 nass und über dem Tabellenbereich: Hinweis ohne Zuschlag, Zahlen unverändert; 40,1 °C ohne Wert', () => {
  let html = render(wxPfa(), { aircraft: C152, fgzo: fgzo({ runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' }) });
  assert.ok(html.includes('class="perf-cond perf-warn"'));
  assert.ok(has(html, 'Piste gilt als nass: FGZO meldet «STANDING WATER» (Stand 18.11.2026, 10:38). Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein.'), text(html));
  assert.ok(!has(html, 'eingerechnet') && !has(html, '× 1,'), 'kein Zuschlag');
  assert.ok(text(block(html, '30')).includes('Start 300 m 521 m 625 m') && text(block(html, '30')).includes('Landung 219 m 432 m 520 m'));
  html = render(wxPfa({ rain1hMm: 0.4 }), { aircraft: C152 });
  assert.ok(has(html, 'Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,4 mm Regen gemessen. Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein.'));
  html = render(wxPfa({ tempC: 40.1 }), { aircraft: C152 });
  assertNoResult(html, '40,1 °C');
  assert.ok(has(html, 'Temperatur 40,1 °C liegt über dem Tabellenbereich des AFM (bis 40 °C) – kein Wert.'), text(html));
  assert.ok(has(html, "Maximales Abfluggewicht 758 kg (1'670 lb)") && has(html, C152.footerDe));
  html = render(wxPfa({ tempC: 40, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: C152 });          // C5
  assert.ok(block(html, '30').includes('<span class="perf-amber">646&nbsp;m</span>') && has(block(html, '30'), 'Start: Strecke über 15 m länger als die verfügbare Länge.'));
  html = render(wxPfa({ tempC: -5, qnhHpa: 1004.5, windDir: null, windKt: 0 }), { aircraft: C152 });         // C7b
  assert.ok(has(html, 'Temperatur −5,0 °C → Tabellenspalte 0 °C (kleinster Tabellenwert)'), text(html));
});

/* ── Pistenwahl, Feststellungen ────────────────────────────── */

test('Pistenwahl: windstill, ohne Richtung, quer, Gegenwind unter 1 kt, Richtung fehlt bei starkem Wind', () => {
  let html = render(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0, gustKt: null }));        // K5
  assert.ok(has(html, 'Windstill (Mittelwind unter 1 kt): keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.'));
  assert.ok(has(block(html, '12'), 'Piste 12 · ohne Windkorrektur') && has(block(html, '30'), 'Piste 30 · ohne Windkorrektur'));
  assert.ok(text(block(html, '12')).includes('Start 352 m 525 m 520 m'));
  assert.ok(!has(html, 'Böen'), 'ohne Böe keine Böenangabe');
  html = render(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }));                               // K12
  assert.ok(has(html, 'Windrichtung nicht gemeldet: keine Gegenwindpiste bestimmbar. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.'));
  assert.ok(has(html, 'Wind 2,0 kt, Richtung unbestimmt, Böen 14 kt'));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 }));                              // K6
  assert.ok(has(html, 'Wind genau quer zur Piste: keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.'));
  assert.ok(block(html, '12') && block(html, '30'));
  assert.ok(has(html, 'Wind aus 214°: genau quer zur Piste, keine Längskomponente.'));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 215, windKt: 10 }));                              // K17
  assert.ok(has(block(html, '30'), 'Piste 30 · Gegenwind unter 1 kt, nicht angerechnet'));
  assert.equal(block(html, '12'), null);
  assert.ok(!has(html, 'Wind genau quer zur Piste: keine Gegenwindpiste'));
  assert.ok(has(html, 'Wind aus 215°: Gegenwindkomponente 0,17 kt aus dem Mittelwind 10,00 kt, abgerundet 0 kt.'), text(html));
  html = render(wxPfa({ windDir: null, windKt: 6 }));                                                       // K12b
  assert.ok(has(html, 'Windrichtung fehlt bei mehr als 3 kt Wind: Die Gegenwindpiste lässt sich nicht bestimmen – keine Berechnung.'));
  assertNoResult(html, 'K12b');
  assert.ok(has(render(wxPfa()), 'ohne gemeldete Windrichtung nur bis 3 kt Mittelwind'), 'Regeltext');
});

test('Schwellen: Mittelwind der Messwertzeile auf 0,1 kt, Wind im Rechenweg auf 0,01 kt abgeschnitten', () => {
  assert.deepEqual([ui.fmtWind(0.97), ui.fmtWind(0.99999), ui.fmtWind(1), ui.fmtWind(2.96), ui.fmtWind(3.04), ui.fmtWind(8), ui.fmtWind(0.3 * 3)],
    ['0,9', '0,9', '1,0', '2,9', '3,0', '8,0', '0,9']);
  assert.deepEqual([ui.fmtKt2(6.996), ui.fmtKt2(7.7624), ui.fmtKt2(0.1 * 3 * 10), ui.fmtKt2(0.1736), ui.fmtKt2(0.999)], ['6,99', '7,76', '3,00', '0,17', '0,99']);
  let html = render(wxPfa({ windDir: 120, windKt: 0.97 }));
  assert.ok(has(html, 'Wind 120° / 0,9 kt') && has(html, 'Mittelwind 0,97 kt, unter 1 kt: windstill'), text(html));
  assert.ok(has(html, 'Windstill (Mittelwind unter 1 kt)'));
  html = render(wxPfa({ windDir: null, windKt: 2.96 }));
  assert.ok(has(html, 'Wind 2,9 kt, Richtung unbestimmt') && has(html, 'Windrichtung nicht gemeldet'), text(html));
  html = render(wxPfa({ windDir: null, windKt: 3.04 }));
  assert.ok(has(html, 'Windrichtung fehlt bei mehr als 3 kt Wind'), text(html));
  assertNoResult(html, '3,04 kt ohne Richtung');
  html = render(wxPfa({ windDir: 304, windKt: 6.996 }));                       // Komponente 6,996 kt → abgerundet 6 kt
  assert.ok(has(html, 'Wind 304° / 6,9 kt'), text(html));
  assert.ok(has(html, 'Gegenwindkomponente 6,99 kt aus dem Mittelwind 6,99 kt, abgerundet 6 kt.'), text(html));
});

test('Feststellungen: 50-%-Satz, Gegenwindgrenze, Überschreitungen, Gleichstand', () => {
  let html = render(wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), { aircraft: P2010 });   // K10a
  const b = text(block(html, '30'));
  assert.ok(b.includes('Start – – 625 m') && b.includes('Landung 314 m 789 m 520 m'), b);
  assert.ok(b.includes('Start: Bei 22 kt Gegenwind würde die Windkorrektur des AFM die Strecke um mehr als die Hälfte verkürzen. Kein Wert.'), b);
  assert.ok(has(html, 'Gegenwind 22 kt: −10 m je kt = −220 m, mehr als die Hälfte – kein Wert'));
  html = render(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 }));                                     // K11b
  assert.equal(text(block(html, '30')).split('Gegenwind 41 kt: ausserhalb des Bereichs, in dem die Windkorrektur des AFM sinnvoll ist. Kein Wert.').length - 1, 1);
  html = render(wxPfa({ tempC: 15, windDir: 290, windKt: 8 }), { aircraft: P2010 });                        // K8: 744 > 625
  assert.ok(block(html, '30').includes('<span class="perf-amber">744&nbsp;m</span>'));
  assert.ok(has(block(html, '30'), 'Start: Strecke über 15 m länger als die verfügbare Länge.'));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: P2010 });      // T1: Piste 12 Rollstrecke 526 > 520
  assert.ok(block(html, '12').includes('<span class="perf-red">526&nbsp;m</span>'));
  assert.ok(has(block(html, '12'), 'Start: Rollstrecke länger als die verfügbare Länge.'));
  // Gleichstand: Rollstrecke genau gleich der verfügbaren Länge ist nicht «länger»
  const af = clone(AF);
  af.runways.find((r) => r.id === '30').takeoffAvailable.value = 331;
  const g = block(render(wxPfa(), { airfield: af }), '30');
  assert.ok(g.includes('<td>331&nbsp;m</td>') && !g.includes('perf-red'), g);
});

test('Keine Piste mit Gegenwind (Test-Platz mit nur Piste 12, Wind von hinten): Meldung statt leerem Raster', () => {
  // In LSZK unerreichbar (Gegenrichtungen 12/30), darum ein Test-Platz mit einer Piste
  const one = clone(AF);
  one.runways = one.runways.filter((r) => r.id === '12');
  const html = render(wxPfa(), { airfield: one });
  assert.ok(has(html, 'Keine Piste mit Gegenwind in den Platzdaten – keine Berechnung.'), text(html));
  assertNoResult(html, 'keine Gegenwindpiste');
  assertClean(html, 'keine Gegenwindpiste');
  assert.ok(has(render(wxPfa({ windDir: 124 }), { airfield: one }), 'Piste 12 · Gegenwind 8 kt'), 'Gegenwind auf derselben Piste');
});

/* ── Zustände ohne Wert ────────────────────────────────────── */

test('Zustände ohne Wert: Text je Fall, Kopf und Fusszeile des Musters, kein Ergebnisblock', () => {
  const head = "Maximales Abfluggewicht 1'157 kg (2'550 lb)";
  const cases = [
    [undefined, 'Keine aktuellen Messwerte vom Platz – keine Berechnung.'],
    [wxPfa({ src: 'speck' }), 'Zurzeit nur Werte der Station Speck verfügbar (Wind zu tief gemessen, Richtungsbezug unbekannt) – keine Berechnung.'],
    [wxPfa({ time: NOW - 46 * MIN }), 'Messwerte veraltet (Stand 08:29 Uhr, vor 46 min) – keine Berechnung.'],
    [wxPfa({ time: NOW + 10 * MIN }), 'Messzeit unplausibel (Stand 09:25 Uhr, liegt in der Zukunft) – keine Berechnung.'],
    [wxPfa({ qnhHpa: null }), 'Messwert fehlt (QNH) – keine Berechnung.'],
    [wxPfa({ qnhHpa: 850 }), 'Messwert unplausibel (QNH 850,0 hPa) – keine Berechnung.'],
    [wxPfa({ tempC: 45 }), 'Temperatur 45,0 °C liegt über dem Tabellenbereich des AFM (bis 40 °C) – kein Wert.']
  ];
  cases.forEach(([w, expected]) => {
    const html = render(w);
    assertClean(html, expected);
    assertNoResult(html, expected);
    const t = text(html);
    assert.ok(t.includes(expected), 'erwartet: ' + expected + '\nerhalten: ' + t);
    assert.ok(t.includes(head) && t.includes(C172D.footerDe), 'Kopf oder Fusszeile fehlt: ' + expected);
  });
  let html = render(wxPfa(), { fgzoPending: true });
  assertNoResult(html, 'FGZO lädt');
  assert.ok(has(html, 'Lade Flugplatzstatus …'));
  html = render(wxPfa(), { dataState: 'error', aircraft: null, airfield: null });
  assert.ok(has(html, 'Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.'));
  assert.ok(has(html, 'Richtwert nach AFM ohne eigenen Sicherheitszuschlag. Massgebend sind das AFM der jeweiligen Maschine und die eigene Beurteilung.'));
  assertNoResult(html, 'Daten');
  html = render(wxPfa(), { dataState: 'loading', aircraft: null });
  assertNoResult(html, 'laden');
  assert.ok(has(html, 'Lade Flugzeug- und Platzdaten …'));
});

/* ── Platzsperre ───────────────────────────────────────────── */

test('Platzsperre: Wortlaut wie die Seite, Grund maskiert und gekürzt, Typfilter', () => {
  let html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }) });
  assert.ok(html.includes('<div class="perf-cond perf-warn" role="note"><div>Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).</div></div>'), html);
  assert.ok(has(html, 'Pistenzustand laut FGZO: DRY'), 'DRY-Zeile bleibt');
  assert.ok(has(block(html, '30'), 'Start 331 m'), 'Zahlen bleiben');
  assert.ok(has(render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen', status: 'CLOSED' }) }), 'Platz laut FGZO geschlossen.'));
  [42, { a: 1 }, null, ['x']].forEach((g) => {
    const h = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: g }) });
    assert.ok(has(h, 'Platz laut FGZO für Flächenflugzeuge gesperrt.'), 'Grund ' + JSON.stringify(g));
  });
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: '<img src=x onerror=y> ' + 'sehr langer Grund '.repeat(6) }) });
  assert.ok(!html.includes('<img'));
  const reason = text(html).match(/für Flächenflugzeuge gesperrt \(([^)]*)\)\./)[1];
  assert.ok(reason.length <= 60 && reason.endsWith('…'), reason);
  // veraltete Sperre (Abruf 45 min alt): Hinweis in der Hinweisfarbe, nicht im gelben Kasten
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', fetched_at_utc: new Date(NOW - 45 * MIN).toISOString() }) });
  assert.ok(html.includes('<div class="perf-note">Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb) (veraltete Meldung).</div>'), html);
  assert.ok(!html.includes('perf-warn'), 'veraltete Sperre im gelben Kasten');
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'geschlossen', ok: false, fetched_at_utc: null }) });
  assert.ok(html.includes('<div class="perf-note">Platz laut FGZO geschlossen (veraltete Meldung).</div>'), html);
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER' }) });
  assert.ok(html.includes('<div>Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).</div><div>Piste gilt als nass: FGZO meldet «STANDING WATER»'));
  assert.ok(!html.includes('veraltete Meldung'));
});

/* ── Escaping ──────────────────────────────────────────────── */

test('Escaping: Quelle, FGZO, Auswahl, Kennzeichen, Texte aus den Daten, Seitenkennung, Hinweis', () => {
  const evil = '<img src=x onerror=y>';
  let html = render(wxPfa({ srcLabel: evil }), { fgzo: fgzo({ runway_condition: evil, updated: '<b>7</b>' }) });
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.ok(html.includes('&lt;IMG SRC=X ONERROR=Y&gt;') && html.includes('&lt;img src=x onerror=y&gt;'));
  html = render(wxPfa(), { fgzo: fgzo({ updated: '<b onclick=x>7</b>' }) });
  assert.ok(html.includes('Pistenzustand laut FGZO: DRY (Stand &lt;b onclick=x&gt;7&lt;/b&gt;) – Datum der Meldung unklar.'), html);
  const list = [{ id: 'c172d', label: 'C <i>1</i>', file: 'c172d.json', registrations: ['HB-<s>X'] }, LIST[1]];
  html = render(wxPfa(), { list });
  assert.ok(html.includes('<option value="c172d" selected>C &lt;i&gt;1&lt;/i&gt; · HB-&lt;s&gt;X</option>'), html);
  const ac = clone(C172D);
  ac.techniqueDe = '<u>t</u>';
  ac.variantDe = '<u>v</u>';
  ac.footerDe = '<u>f</u>';
  ac.charts.takeoff.notesDe = ['<script>n()</script>'];
  ac.charts.landing.conditionsDe = '<img src=c>';
  ac.sources.poh.pageMark = '<b>172SPHBUS-00</b>';
  ac.sources.poh.pageMarkDe = '<i>p</i>';
  ac.readingRuleDe = '<u>r</u>';
  html = render(wxPfa(), { aircraft: ac, notice: 'Hinweis <u>x</u>' });
  ['<u>', '<script', '<img', '<b>', '<i>'].forEach((s) => assert.ok(!html.includes(s), s));
  ['&lt;u&gt;t&lt;/u&gt;', '&lt;u&gt;v&lt;/u&gt;', '&lt;u&gt;f&lt;/u&gt;', '&lt;script&gt;n()&lt;/script&gt;', '&lt;img src=c&gt;',
    'Seitenkennung &lt;b&gt;172SPHBUS-00&lt;/b&gt;: &lt;i&gt;p&lt;/i&gt;', '&lt;u&gt;r&lt;/u&gt;',
    '<div class="perf-note" role="status">Hinweis &lt;u&gt;x&lt;/u&gt;</div>'].forEach((s) => assert.ok(html.includes(s), s));
  const p = clone(P2010);
  p.wetNoteDe = '<i>w</i>';
  html = render(wxPfa({ rain1hMm: 1 }), { aircraft: p });
  assert.ok(html.includes('&lt;i&gt;w&lt;/i&gt;') && !html.includes('<i>w'));
});

// Generischer Maskierungstest: eine Marke in jedem Textfeld der Daten, im FGZO-Status und in srcLabel
const MARK = '<img src=x onerror=alert(1)>';
function stringPaths(o, base, out) {
  out = out || [];
  if (typeof o === 'string') out.push(base);
  else if (o && typeof o === 'object') Object.keys(o).forEach((k) => stringPaths(o[k], base === undefined ? k : base + '.' + k, out));
  return out;
}
function getPath(o, p) { return p.split('.').reduce((x, k) => x[k], o); }
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((x, k) => x[k], o)[last] = v;
}
// Alle Textfelder zugleich mit der Marke; Schlüsselwörter des Schemas bleiben (sonst gälten die Daten nicht)
function markAll(o, skip, key) {
  if (typeof o === 'string') return skip.includes(key) ? o : MARK + o;
  if (Array.isArray(o)) return o.map((x) => markAll(x, skip, key));
  if (!o || typeof o !== 'object') return o;
  const out = {};
  Object.keys(o).forEach((k) => { out[k] = markAll(o[k], skip, k); });
  return out;
}
// Zustände, die zusammen alle Textstellen der Karte erreichen
function maskVariants(ac, af, list) {
  const old = new Date(NOW - 54 * MIN).toISOString();
  const base = { dataState: 'ready', list, aircraft: ac, airfield: af, nowMs: NOW, detailsOpen: true };
  return [
    [wxPfa(), fgzo()],                                                                    // Gegenwind 30, Rückenwind 12
    [wxPfa({ rain1hMm: 0.4 }), fgzo()],                                                   // nass durch Regen, Nässefaktor
    [wxPfa({ windDir: null, windKt: 0 }), null],                                          // windstill, beide Pisten
    [wxPfa({ windDir: 214, windKt: 10 }), fgzo({ runway_condition: 'WET', flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' })],
    [wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), fgzo({ fetched_at_utc: old, flaeche: 'gesperrt' })],
    [wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41, rain1hMm: null, rainMmH: null }), fgzo({ updated: '' })]
  ].map(([w, f]) => Object.assign({}, base, { wx: w, fgzo: f }));
}

test('Maskierung: Marke in jedem Textfeld von Flugzeug-, Platz- und Listendatei, FGZO-Status und srcLabel nie unmaskiert', () => {
  let renders = 0, escaped = 0;
  const check = (ctx, label) => {
    const html = ui.renderHtml(ctx);
    renders++;
    assert.ok(!/<img/i.test(html), label + ': Marke unmaskiert');
    if (/&lt;img/i.test(html)) escaped++;
    return html;
  };
  // 1) jedes Textfeld einzeln
  [C172D, P2010, C152].forEach((acBase) => stringPaths(acBase).forEach((p) => {
    const ac = clone(acBase);
    setPath(ac, p, MARK + getPath(ac, p));
    maskVariants(ac, AF, LIST).forEach((ctx) => check(ctx, acBase.id + ' ' + p));
  }));
  stringPaths(AF).forEach((p) => {
    const af = clone(AF);
    setPath(af, p, MARK + getPath(af, p));
    [C172D, P2010, C152].forEach((ac) => maskVariants(ac, af, LIST).forEach((ctx) => check(ctx, 'Platz ' + p)));
  });
  stringPaths(INDEX_RAW).forEach((p) => {
    const idx = clone(INDEX_RAW);
    setPath(idx, p, MARK + getPath(idx, p));
    const parsed = ui.parseIndex(idx);
    // geprüfte Liste, ungeprüfte Einträge (Anzeige maskiert auch ohne Prüfung) und ein einzelnes Muster
    [parsed ? parsed.list : null, idx.aircraft, [idx.aircraft[0]]].forEach((list) => {
      check({ dataState: 'ready', list, aircraft: C172D, airfield: AF, wx: wxPfa(), fgzo: fgzo(), nowMs: NOW }, 'Liste ' + p);
      check({ dataState: 'loading', list, selectedId: 'p2010', nowMs: NOW }, 'Liste, Laden ' + p);
      check({ dataState: 'error', list, nowMs: NOW }, 'Liste, Fehler ' + p);
    });
  });
  // 2) alle Textfelder zugleich: gleiche Beläge und Pistenkennungen überall, fehlende Quellen- und Kopffelder ergänzt
  const SRC = ['labelDe', 'title', 'publisher', 'number', 'issue', 'approval', 'applicability', 'applicabilityDe', 'pageMark', 'pageMarkDe', 'caveatDe'];
  const HEAD = ['techniqueDe', 'variantDe', 'footerDe', 'readingRuleDe', 'wetNoteDe', 'massNoteDe'];
  const afAll = markAll(AF, ['unit']);
  assert.equal(core.validateAirfield(afAll).ok, true);
  [C172D, P2010, C152].forEach((acBase) => {
    const full = clone(acBase);
    Object.keys(full.sources).forEach((k) => SRC.forEach((f) => { if (typeof full.sources[k][f] !== 'string') full.sources[k][f] = f; }));
    HEAD.forEach((f) => { if (typeof full[f] !== 'string') full[f] = f; });
    const acAll = markAll(full, ['id', 'kind', 'type', 'unit', 'amountUnit', 'quantity', 'read', 'below', 'above', 'when', 'of', 'surfaceCondition', 'source']);
    assert.equal(core.validateAircraft(acAll).ok, true, acBase.id);
    const htmls = maskVariants(acAll, afAll, LIST).map((ctx) => check(ctx, acBase.id + ' alle Felder'));
    assert.ok(htmls[0].includes('perf-grid') && htmls[2].includes('perf-grid'), acBase.id + ': Zahlen erwartet');
    // 3) Quellenschlüssel als Text (ohne labelDe)
    const keyed = clone(acAll);
    Object.keys(keyed.sources).forEach((k) => {
      const s = keyed.sources[k];
      delete s.labelDe;
      delete keyed.sources[k];
      keyed.sources[MARK + k] = s;
    });
    core.PHASES.forEach((ph) => { keyed.charts[ph].source = MARK + keyed.charts[ph].source; });
    assert.equal(core.validateAircraft(keyed).ok, true, acBase.id + ' Quellenschlüssel');
    maskVariants(keyed, afAll, LIST).forEach((ctx) => check(ctx, acBase.id + ' Quellenschlüssel'));
  });
  // 4) FGZO-Status und srcLabel
  const old = new Date(NOW - 54 * MIN).toISOString();
  [fgzo({ runway_condition: MARK, updated: MARK }), fgzo({ runway_condition: 'WET', updated: '18.11.2026, 07:14 ' + MARK, flaeche: 'gesperrt', flaeche_grund: MARK }),
    fgzo({ updated: MARK }), fgzo({ updated: '18.11.2026, 07:14 ' + MARK }), fgzo({ updated: '17.11.2026, 07:14 ' + MARK }),
    fgzo({ updated: MARK, fetched_at_utc: old }), fgzo({ runway_condition: MARK, updated: MARK, fetched_at_utc: old, flaeche: 'gesperrt', flaeche_grund: MARK }),
    fgzo({ runway_condition: MARK, updated: null, fetched_at_utc: MARK }), fgzo({ flaeche: 'gesperrt', flaeche_grund: MARK, fetched_at_utc: old })].forEach((f, i) => {
    [wxPfa({ srcLabel: MARK }), wxPfa({ srcLabel: MARK, rain1hMm: null, rainMmH: null })].forEach((w) => {
      check({ dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: w, fgzo: f, nowMs: NOW, detailsOpen: true }, 'FGZO ' + i);
    });
  });
  assert.ok(renders >= 1500 && escaped >= 600, renders + ' Darstellungen, ' + escaped + ' mit maskierter Marke');
});

/* ── Auswahl, Format, Technik ──────────────────────────────── */

test('Auswahl: ein Muster ohne select, Laden und Fehler mit erreichbarer Auswahl', () => {
  let html = render(wxPfa(), { list: [LIST[0]] });
  assert.ok(!html.includes('<select'));
  assert.ok(html.includes('<div class="perf-ac">Cessna 172 Diesel · HB-TDA, HB-TDB, HB-TDC, HB-TDD</div>'));
  html = render(wxPfa(), { dataState: 'loading', selectedId: 'p2010', aircraft: null });
  assert.ok(html.includes('<option value="p2010" selected>'));
  html = render(wxPfa(), { dataState: 'error', selectedId: 'c172d', aircraft: null, notice: 'Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.' });
  assert.ok(html.includes('<select id="perf-ac"') && has(html, 'Standardmuster gewählt'));
  assert.equal(ui.parseIndex({ schema: 1, default: 'c172d', aircraft: INDEX_RAW.aircraft }), null);
  assert.equal(ui.parseIndex({ schema: 2, default: 'x', aircraft: INDEX_RAW.aircraft }), null);
  assert.equal(ui.parseIndex({ schema: 2, default: 'a', aircraft: [{ id: 'a', label: 'A', file: '../a.json' }] }), null);
  assert.equal(ui.parseIndex({ schema: 2, default: 'a', aircraft: [{ id: 'a', label: 'A', file: 'a.json', registrations: [3] }] }), null);
  assert.deepEqual(ui.parseIndex({ schema: 2, default: 'a', aircraft: [{ id: 'a', label: 'A', file: 'a.json' }] }).list[0].registrations, []);
});

test('Format: QNH ohne Tausendertrenner, Druckhöhe aufgerundet, Zwischenwerte exakt, letzter Wert auf 0,01 aufgerundet', () => {
  let t = text(render(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 })));
  assert.ok(t.includes('QNH 1022,0 hPa') && !t.includes("1'022"), t);
  t = text(render(wxPfa({ tempC: 8, qnhHpa: 1020, windDir: 110, windKt: 3 })));          // PA 1575,15
  assert.ok(t.includes("Druckhöhe 1'576 ft") && !t.includes("1'575"), t);
  assert.deepEqual([ui.fmtUp2(396.576), ui.fmtUp2(589.644), ui.fmtUp2(264.99312), ui.fmtUp2(284.58000000000004), ui.fmtUp2(45.9)],
    ['396,58', '589,65', '265', '284,58', '45,9']);
  assert.deepEqual([ui.fmtExact(743.664), ui.fmtExact(26.0936), ui.fmtExact(1604.1), ui.fmtExact(0.1 + 0.2), ui.fmtExact(401.2 - 70), ui.fmtExact(-25), ui.fmtExact(1420)],
    ['743,664', '26,0936', "1'604,1", '0,3', '331,2', '−25', "1'420"]);
  assert.deepEqual([ui.fmtExact(1 / 3), ui.fmtExact(375.36336)], ['≈0,3333', '≈375,3634'], 'nicht exakt darstellbar: mit «≈»');
  // Tecnam K21: Zwischenwerte mit drei und vier Nachkommastellen exakt, nur der letzte Wert auf 0,01 aufgerundet
  t = text(render(wxPfa({ tempC: 10.8, qnhHpa: 998.2, windDir: 247, windKt: 8.7 }), { aircraft: P2010 }));
  assert.ok(t.includes('Landung: Tabelle 251 / 535 m bei 0 °C und 274 / 558 m bei 25 °C, Gewicht 0,432 → 260,936 / 544,936 m · Gegenwind 4 kt: −4 m je kt = −16 m → 244,936 / 528,936 m · Gras +10 % von 260,936 m = +26,0936 m → 271,0296 / 555,0296 m · Faktor für Abweichungen im Betrieb × 1,67 (NOTE, APV5-17) → 452,62 / 926,9 m → aufgerundet 453 / 927 m'), t);
  // Temperatur mit drei Dezimalen (kommt bei MeteoSchweiz nicht vor): nicht exakt darstellbare Werte mit «≈»
  t = text(render(wxPfa({ tempC: 7.123 }), { aircraft: P2010 }));
  assert.ok(t.includes('Gewicht ≈0,2849 → ≈375,3634 / 661,8888 m'), t);
  assert.ok(t.includes('→ aufgerundet 378 / 693 m'), t);
});

test('Rechenweg: absolute Windkorrektur mit Rest «abgerundet», gebrochene Regelwerte exakt', () => {
  const ac = clone(P2010);
  Object.assign(ac.charts.takeoff.corrections.find((c) => c.kind === 'headwind'), { amount: -15, per: 2 });
  Object.assign(ac.charts.landing.corrections.find((c) => c.kind === 'headwind'), { amount: -2.5, per: 1.5 });
  const t = text(render(wxPfa({ windDir: 304, windKt: 3 }), { aircraft: ac }));
  assert.ok(t.includes('Gegenwind 3 kt: −15 m je 2 kt, abgerundet −22 m → 379,2 / 684 m'), t);   // 22,5 → 22
  assert.ok(t.includes('Gegenwind 3 kt: −2,5 m je 1,5 kt = −5 m → 250,2 / 534,2 m'), t);
});

/* ── Rechenweg geht exakt auf: alle Kontrollfälle des Planers ── */

const CASES = readJson('tests/fixtures/kontrollfaelle.json');
const E4 = 10000n;
// Angezeigte Zahl («1'604,1», «−25») als Ganzzahl im Massstab 10^4; höchstens vier Nachkommastellen, keine nachgestellte
// Null (ausser beim Faktor, der wie im AFM mit zwei Stellen steht: «1,10»)
function dec(s, ctx, factor) {
  const m = /^(−)?(\d{1,3}(?:'\d{3})*)(?:,(\d{1,4}))?$/.exec(s);
  assert.ok(m, ctx + ': keine exakte Zahl «' + s + '»');
  assert.ok(factor || !m[3] || !m[3].endsWith('0'), ctx + ': nachgestellte Null in «' + s + '»');
  const v = BigInt(m[2].replace(/'/g, '')) * E4 + (m[3] ? BigInt(m[3].padEnd(4, '0')) : 0n);
  return m[1] ? -v : v;
}
const ceilDiv = (a, b) => (a >= 0n ? (a + b - 1n) / b : -(-a / b));
// shown im Massstab 10^4, exact im Massstab 10^8: Zwischenwert exakt gleich, letzter Wert auf 0,01 aufgerundet
function sameValue(shown, exact, last, ctx) {
  if (last) assert.equal(shown, ceilDiv(exact, 1000000n) * 100n, ctx + ': letzter Wert nicht ceil auf 0,01');
  else assert.equal(shown * E4, exact, ctx + ': Zwischenwert nicht exakt');
}
// Eine Zeile «Start: …» bzw. «Landung: …» nachrechnen; gibt die aufgerundeten Meter zurück (oder null ohne Wert)
function checkPhaseLine(line, tempC, ctx) {
  const head = /^(Start|Landung): (.*)$/.exec(line);
  assert.ok(head, ctx + ': ' + line);
  let body = head[2], fin = null, meters = null, m;
  if ((m = / → aufgerundet (\S+) \/ (\S+) m$/.exec(body))) { fin = [dec(m[1], ctx), dec(m[2], ctx)]; body = body.slice(0, m.index); }
  if (fin && (m = / = (\S+) \/ (\S+) m$/.exec(body))) { meters = [dec(m[1], ctx), dec(m[2], ctx)]; body = body.slice(0, m.index); }
  const segs = body.split(' · ');
  const steps = [];
  const P = (a, b) => [dec(a, ctx), dec(b, ctx)];
  m = /^Tabelle (\S+) \/ (\S+) (m|ft)(?: bei (\S+) °C und (\S+) \/ (\S+) (?:m|ft) bei (\S+) °C, Gewicht (\S+) → (\S+) \/ (\S+) (?:m|ft))?$/.exec(segs[0]);
  assert.ok(m, ctx + ': Tabelle «' + segs[0] + '»');
  const unit = m[3];
  let table;
  if (m[4] !== undefined) {
    const lo = P(m[1], m[2]), hi = P(m[5], m[6]), t0 = dec(m[4], ctx), t1 = dec(m[7], ctx), w = dec(m[8], ctx);
    assert.equal(w * (t1 - t0), (BigInt(Math.round(tempC * 10000)) - t0) * E4, ctx + ': Gewicht = (t − t0) / (t1 − t0)');
    table = P(m[9], m[10]);
    steps.push({ what: 'Interpolation', shown: table, exact: () => [0, 1].map((k) => lo[k] * E4 + w * (hi[k] - lo[k])) });
  } else {
    table = P(m[1], m[2]);
    steps.push({ what: 'Tabelle', shown: table, exact: () => table.map((v) => v * E4) });
  }
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    if (s === 'ohne Windkorrektur' || /^Gegenwind \d+ kt: nicht angerechnet/.test(s)) continue;
    if (/^Gegenwind \d+ kt: über \d+ kt, kein Wert$/.test(s) || /kein Wert$/.test(s) && !/je/.test(s)) { assert.equal(fin, null, ctx); break; }
    if ((m = /^Gegenwind (\d+) kt: −(\d+) % → (\S+) \/ (\S+) (?:m|ft)$/.exec(s))) {
      const p = BigInt(m[2]);
      steps.push({ what: 'Wind %', shown: P(m[3], m[4]), exact: (prev) => prev.map((v) => v * (100n - p) * 100n) });
      continue;
    }
    if ((m = /^Gegenwind (\d+) kt: −(\S+) (?:m|ft) je (?:(\S+) )?kt(, abgerundet | = )−(\S+) (?:m|ft)(?:, mehr als die Hälfte – kein Wert| → (\S+) \/ (\S+) (?:m|ft))$/.exec(s))) {
      const kt = BigInt(m[1]), x = dec(m[2], ctx), y = m[3] ? dec(m[3], ctx) : E4, r = dec(m[5], ctx);
      assert.equal(r, (x * kt / y) * E4, ctx + ': Windabzug je kt × kt, abgerundet');
      assert.equal(m[4] === ', abgerundet ', (x * kt) % y !== 0n, ctx + ': «abgerundet» genau bei Rest');
      if (m[6] === undefined) { assert.equal(fin, null, ctx); break; }
      steps.push({ what: 'Wind absolut', shown: P(m[6], m[7]), exact: (prev) => prev.map((v) => (v - r) * E4) });
      continue;
    }
    if ((m = /^\S+ \+(\S+) % von (\S+) (?:m|ft) = \+(\S+) (?:m|ft) → (\S+) \/ (\S+) (?:m|ft)$/.exec(s))) {
      const p = dec(m[1], ctx), b = dec(m[2], ctx), inc = dec(m[3], ctx);
      assert.equal(b, table[0], ctx + ': Gras von der Tabellen-Rollstrecke');
      assert.equal(inc * 1000000n, p * b, ctx + ': Graszuschlag exakt');
      steps.push({ what: 'Gras', shown: P(m[4], m[5]), exact: (prev) => prev.map((v) => (v + inc) * E4) });
      continue;
    }
    if ((m = /^.+ × (\S+) \(.*\) → (\S+) \/ (\S+) (?:m|ft)$/.exec(s))) {
      const f = dec(m[1], ctx, true);
      steps.push({ what: 'Faktor', shown: P(m[2], m[3]), exact: (prev) => prev.map((v) => v * f) });
      continue;
    }
    assert.fail(ctx + ': unbekannter Schritt «' + s + '»');
  }
  assert.equal(!!meters, !!fin && unit === 'ft', ctx + ': Meterzeile genau bei ft');
  if (meters) steps.push({ what: 'ft → m', shown: meters, exact: (prev) => prev.map((v) => v * 3048n) });
  let prev = null;
  steps.forEach((st, k) => {
    const ex = st.exact(prev);
    [0, 1].forEach((j) => sameValue(st.shown[j], ex[j], !!fin && k === steps.length - 1, ctx + ' ' + st.what + (j ? ' (15 m)' : ' (Rollstrecke)')));
    prev = st.shown;
  });
  if (!fin) return null;
  [0, 1].forEach((j) => assert.equal(fin[j], ceilDiv(prev[j], E4) * E4, ctx + ': aufgerundet'));
  return fin.map((v) => Number(v / E4));
}
function pavedTestField(elevFt) {
  return { schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, bearingMag: 360, surface: 'paved', takeoffAvailable: { value: 1070, unit: 'm' }, landingAvailable: { value: 915, unit: 'm' } }] };
}

test('Rechenweg geht exakt auf: jede Zeile aller Kontrollfälle nachgerechnet, letzter Wert aufgerundet gleich der Karte', () => {
  const sample = clone(C172D);
  sample.charts.takeoff.table.cells = readJson('tests/fixtures/c172d_5a_1111kg_m.json').cells;
  let lines = 0, values = 0;
  CASES.forEach(([id, acId, field, inp]) => {
    assert.ok(['c172d', 'p2010', 'c152', 'sample5a1111'].includes(acId), id + ': unbekanntes Muster ' + acId);
    const ac = acId === 'c172d' ? C172D : (acId === 'p2010' ? P2010 : (acId === 'c152' ? C152 : sample));
    const af = field === 'lszk' ? AF : pavedTestField(field);
    const html = render(wxPfa({ tempC: inp[0], qnhHpa: inp[1], windDir: inp[2], windKt: inp[3], rain1hMm: inp[4] ? 0.4 : 0 }),
      { aircraft: ac, airfield: af, detailsOpen: true });
    assertClean(html, id);
    assert.ok(!html.includes('≈'), id + ': nicht exakter Zwischenwert');
    const re = /<p class="perf-calc-h">Piste ([^ <]+) \(.*?<ul>(.*?)<\/ul>/g;
    let m;
    while ((m = re.exec(html))) {
      const rid = m[1];
      const items = m[2].match(/<li>.*?<\/li>/g).map((li) => text(li).trim());
      assert.equal(items.length, 2, id + ' Piste ' + rid);
      const card = text(block(html, rid));
      items.forEach((line, k) => {
        lines++;
        const label = k ? 'Landung' : 'Start';
        const fin = checkPhaseLine(line, inp[0], id + ' Piste ' + rid + ' ' + label);
        const cell = new RegExp(label + ' (\\S+) m (\\S+) m').exec(card);
        if (fin) {
          values++;
          assert.ok(cell, id + ': Kartenzeile ' + label);
          assert.deepEqual([cell[1], cell[2]], fin.map((v) => ui.fmtInt(v)), id + ' Piste ' + rid + ' ' + label + ': Karte');
        } else {
          assert.ok(new RegExp(label + ' – – ').test(card), id + ': ohne Wert auch auf der Karte');
        }
      });
    }
  });
  assert.deepEqual([lines, values], [174, 165], 'Zeilen und Werte im Rechenweg');
});

test('Versionsprüfung: Kern und Anzeige müssen gleich sein', () => {
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    const html = render(wxPfa());
    assert.ok(has(html, 'Rechenfehler – keine Berechnung.'));
    assertNoResult(html, 'Version');
  } finally {
    core.VERSION = v;
  }
  assert.ok(render(wxPfa()).includes('perf-grid'));
});

test('Durchlauf: nie NaN, undefined, null oder Infinity im HTML', () => {
  [C172D, P2010, C152].forEach((ac) => [null, 0, 34, 124, 214, 304].forEach((dir) => [0, 0.6, 2, 8.7, 22, 45].forEach((kt) => [-30, 0, 10.8, 25.1, 39.9].forEach((t) => {
    [[fgzo(), 0], [fgzo({ runway_condition: 'WET', flaeche: 'gesperrt' }), null], [null, null]].forEach(([f, rain]) => {
      const html = render(wxPfa({ windDir: dir, windKt: kt, gustKt: kt ? kt * 1.5 : null, tempC: t, rain1hMm: rain }), { aircraft: ac, fgzo: f, detailsOpen: true });
      assertClean(html, ac.id + ' ' + dir + '/' + kt + '/' + t);
    });
  }))));
});

test('CSS und HTML: nur Klassen und IDs mit Präfix perf-, Auswahl mobil 16 px und 44 px', () => {
  const selectors = ui.CSS.replace(/\{[^}]*\}/g, ' ').replace(/@media[^{]*\{/g, ' ');
  const names = selectors.match(/[.#][a-zA-Z][\w-]*/g) || [];
  assert.ok(names.length > 10);
  names.forEach((n) => assert.ok(n.slice(1).startsWith('perf-'), 'CSS ' + n));
  const html = render(wxPfa({ rain1hMm: 1 }), { aircraft: P2010, fgzo: fgzo({ flaeche: 'gesperrt' }), detailsOpen: true });
  (html.match(/class="[^"]*"/g) || []).forEach((c) => c.slice(7, -1).split(/\s+/).forEach((k) => assert.ok(k.startsWith('perf-'), 'Klasse ' + k)));
  (html.match(/ id="[^"]*"/g) || []).forEach((i) => assert.ok(i.slice(5, -1).startsWith('perf-'), 'ID ' + i));
  assert.ok(ui.CSS.includes('repeat(auto-fit, minmax(min(260px, 100%), 1fr))'));
  assert.ok(/@media \(max-width: 600px\) \{[^@]*\.perf-select \{[^}]*width: 100%; font-size: 16px; min-height: 44px;/.test(ui.CSS));
});

test('Browsercode ohne ?., ?? und Lookbehind', () => {
  ['perf/perf.js', 'perf/perf-ui.js'].forEach((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!src.includes('?.'), rel + ': ?.');
    assert.ok(!src.includes('??'), rel + ': ??');
    assert.ok(!src.includes('(?<'), rel + ': Lookbehind');
    assert.ok(!(src.charCodeAt(0) === 0xfeff), rel + ': BOM');
  });
});

test('Version: perf.js, perf-ui.js und index.html stimmen überein', () => {
  assert.equal(ui.VERSION, core.VERSION);
  const p = path.join(ROOT, 'index.html');
  if (!fs.existsSync(p)) return;
  const html = fs.readFileSync(p, 'utf8');
  const m1 = html.match(/<script defer src="perf\/perf\.js\?v=(\d+)"><\/script>/);
  const m2 = html.match(/<script defer src="perf\/perf-ui\.js\?v=(\d+)"><\/script>/);
  assert.ok(m1 && m2, 'Skript-Einbindung in index.html fehlt');
  assert.equal(Number(m1[1]), core.VERSION);
  assert.equal(Number(m2[1]), ui.VERSION);
  assert.ok(html.indexOf(m1[0]) < html.indexOf(m2[0]), 'erst Rechenkern, dann Anzeige');
  assert.equal(html.split('id="perf-card"').length - 1, 1);
  assert.ok(html.indexOf('id="perf-card"') < html.indexOf('id="om-card"'), 'Karte vor #om-card');
});

/* ── Browserteil boot() mit nachgebautem window/document ────── */

const INDEX_3 = { schema: 2, default: 'c172d', aircraft: INDEX_RAW.aircraft.concat([{ id: 'x', label: 'Fehlt', registrations: ['HB-XXX'], file: 'x.json' }]) };

function fakeBrowser(opts) {
  opts = opts || {};
  const env = {
    clock: NOW, fetchUrls: [], failPerf: !!opts.failPerf, intervals: [], timeouts: [], docListeners: {}, writes: 0,
    store: Object.assign({}, opts.store),
    files: Object.assign({
      'perf/aircraft/index.json': INDEX_RAW,
      'perf/airfields/lszk.json': AF,
      'perf/aircraft/c172d.json': C172D,
      'perf/aircraft/p2010.json': P2010,
      'perf/aircraft/c152.json': C152,
      'data/fgzo_status.json': fgzo()
    }, opts.files)
  };
  const content = {
    html: '', details: null, listeners: {},
    get innerHTML() { return this.html; },
    set innerHTML(v) {
      this.html = String(v);
      env.writes++;
      this.details = this.html.includes('<details class="perf-details"')
        ? { open: this.html.includes('<details class="perf-details" open>') } : null;
    },
    querySelector(sel) { return sel === 'details.perf-details' ? this.details : null; },
    addEventListener(type, fn) { this.listeners[type] = fn; }
  };
  const card = { style: { display: 'none' }, getAttribute: (n) => (n === 'data-airfield' ? 'lszk' : null) };
  const styles = [];
  const doc = {
    readyState: 'interactive', hidden: false,
    head: { appendChild: (el) => { styles.push(el); } },
    getElementById: (id) => {
      if (opts.noCard) return null;
      if (id === 'perf-card') return card;
      if (id === 'perf-content') return content;
      if (id === 'perf-style') return styles.find((s) => s.id === 'perf-style') || null;
      return null;
    },
    createElement: (tag) => ({ tagName: tag, id: '', textContent: '' }),
    addEventListener: (type, fn) => { env.docListeners[type] = fn; }
  };
  const win = {
    document: doc,
    LSZK_WX: opts.initialWx,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(env.store, k) ? env.store[k] : null),
      setItem: (k, v) => { env.store[k] = String(v); },
      removeItem: (k) => { delete env.store[k]; }
    },
    setInterval: (fn, ms) => { env.intervals.push({ fn, ms }); return env.intervals.length; },
    setTimeout: (fn, ms) => { env.timeouts.push({ fn, ms }); return env.timeouts.length; },
    fetch: (url) => {
      env.fetchUrls.push(url);
      const p = url.split('?')[0];
      if (env.failPerf && p.startsWith('perf/')) return Promise.reject(new Error('offline'));
      const data = env.files[p];
      if (typeof data === 'function') return data();
      if (data === undefined) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });
    }
  };
  return Object.assign(env, { win, doc, card, content, styles });
}
async function settle() { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); }
function startBrowser(t, opts) {
  const env = fakeBrowser(opts);
  t.mock.method(Date, 'now', () => env.clock);
  ui.boot(env.win);
  return env;
}
const perfFetches = (env) => env.fetchUrls.filter((u) => u.startsWith('perf/')).length;
const shown = (env) => text(env.content.innerHTML);
function evilWx() {
  const evil = {};
  Object.defineProperty(evil, 'tempC', { enumerable: true, get() { throw new Error('kaputt'); } });
  return evil;
}

test('boot: Karte versteckt bis zum ersten update, dann Zahlen nach dem FGZO-Abruf', async (t) => {
  const env = startBrowser(t);
  await settle();
  assert.equal(env.card.style.display, 'none');
  assert.equal(env.content.innerHTML, '');
  assert.equal(env.styles.length, 1);
  assert.equal(env.styles[0].textContent, ui.CSS);
  assert.equal(env.win.LszkPerf.version, ui.VERSION);
  assert.deepEqual(env.intervals.map((i) => i.ms), [60000]);
  env.win.LszkPerf.update(wxPfa());
  assert.equal(env.card.style.display, 'block');
  assert.ok(shown(env).includes('Lade Flugplatzstatus …'), 'vor dem FGZO-Abruf keine Trockenrechnung');
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m 625 m'), shown(env));
  assert.ok(env.fetchUrls.some((u) => u.startsWith('data/fgzo_status.json?t=')));
});

test('boot: FGZO antwortet nicht – nach höchstens 5 s Rechnung ohne Meldung', async (t) => {
  const env = startBrowser(t, { files: { 'data/fgzo_status.json': () => new Promise(() => {}) } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Lade Flugplatzstatus …'));
  assert.deepEqual(env.timeouts.map((x) => x.ms), [ui.FGZO_WAIT_MS + 50]);
  env.clock += 4900;
  env.win.LszkPerf._tick();
  assert.ok(shown(env).includes('Lade Flugplatzstatus …'));
  env.clock += 200;
  env.timeouts[0].fn();
  assert.ok(shown(env).includes('Pistenzustand: keine aktuelle Meldung der FGZO.'), shown(env));
  assert.ok(shown(env).includes('Start 331 m'));
});

test('boot: LSZK_WX beim Start einmal gelesen; ohne #perf-card nichts tun', async (t) => {
  let env = startBrowser(t, { initialWx: wxPfa() });
  await settle();
  assert.equal(env.card.style.display, 'block');
  assert.ok(shown(env).includes('Start 331 m'));
  env = fakeBrowser({ noCard: true });
  ui.boot(env.win);
  assert.doesNotThrow(() => env.win.LszkPerf.update(wxPfa()));
  assert.doesNotThrow(() => env.win.LszkPerf._tick());
  await settle();
  assert.equal(env.fetchUrls.length, 0);
});

test('boot: Altern über Takt, Sichtbarkeit und _tick lässt die Zahlen verschwinden', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa({ time: NOW - 44 * MIN }));
  await settle();
  assert.ok(env.content.innerHTML.includes('perf-grid'));
  env.clock = NOW + 2 * MIN;
  env.intervals[0].fn();
  assert.ok(!env.content.innerHTML.includes('perf-grid'));
  assert.ok(shown(env).includes('Messwerte veraltet'));
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 44 * MIN }));
  await settle();
  assert.ok(env.content.innerHTML.includes('perf-grid'));
  env.clock += 2 * MIN;
  env.docListeners.visibilitychange();
  assert.ok(!env.content.innerHTML.includes('perf-grid'));
});

test('boot: kaputtes update wirft nicht, Rechenfehler bleibt bis zum nächsten gültigen update', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('331 m'));
  assert.doesNotThrow(() => env.win.LszkPerf.update(evilWx()));
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.'));
  env.clock += MIN;
  env.win.LszkPerf._tick();
  env.intervals[0].fn();
  await settle();
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.') && !shown(env).includes('331 m'), 'alte Zahlen zurück');
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 10 * MIN }));
  await settle();
  assert.ok(shown(env).includes('331 m'));
  [42, 'x', undefined, null, []].forEach((v) => assert.doesNotThrow(() => env.win.LszkPerf.update(v)));
  assert.ok(shown(env).includes('Keine aktuellen Messwerte vom Platz – keine Berechnung.'));
});

test('boot: Ladefehler, neuer Versuch frühestens nach 60 s', async (t) => {
  const env = startBrowser(t, { failPerf: true });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.'));
  const n0 = perfFetches(env);
  env.failPerf = false;
  env.clock = NOW + 30 * 1000;
  env.win.LszkPerf._tick();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.equal(perfFetches(env), n0, 'vor 60 s neu geladen');
  env.clock = NOW + 61 * 1000;
  env.win.LszkPerf._tick();
  await settle();
  assert.ok(perfFetches(env) > n0);
  assert.ok(shown(env).includes('Start 331 m'));
});

test('boot: offenes <details> bleibt offen, gleiches HTML wird nicht neu gesetzt', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  const w0 = env.writes;
  env.win.LszkPerf._tick();
  assert.equal(env.writes, w0, 'gleiches HTML neu gesetzt');
  env.content.details.open = true;
  env.clock += MIN;
  env.win.LszkPerf._tick();
  assert.ok(env.writes > w0);
  assert.ok(env.content.innerHTML.includes('<details class="perf-details" open>'));
});

test('boot: Wechsel Cessna ↔ Tecnam, Wahl erst nach erfolgreichem Laden gespeichert', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(env.content.innerHTML.includes('<option value="c172d" selected>'));
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'p2010' } });
  assert.ok(env.content.innerHTML.includes('<option value="p2010" selected>'), 'Auswahl während des Ladens');
  assert.ok(!shown(env).includes('331 m'), 'Cessna-Zahlen während des Ladens');
  assert.equal(env.store['lszk-perf-aircraft'], undefined);
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'p2010');
  assert.ok(shown(env).includes('Start 409 m 744 m') && shown(env).includes("1'160 kg"), shown(env));
  assert.ok(shown(env).includes(P2010.footerDe));
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'c172d' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
  assert.ok(shown(env).includes('Start 331 m 492 m') && shown(env).includes(C172D.footerDe));
  env.content.listeners.change({ target: { id: 'perf-ac', value: '../x' } });
  env.content.listeners.change({ target: { id: 'anderes', value: 'p2010' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
});

test('boot: Wechsel zur Cessna 152 und zurück; die gespeicherte Wahl gilt beim nächsten Start', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.equal((env.content.innerHTML.match(/<option /g) || []).length, 3);
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'c152' } });
  assert.ok(env.content.innerHTML.includes('<option value="c152" selected>'), 'Auswahl während des Ladens');
  assert.ok(!shown(env).includes('331 m'), 'Zahlen der Cessna 172 während des Ladens');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c152');
  assert.ok(env.fetchUrls.some((u) => u.startsWith('perf/aircraft/c152.json?t=')));
  assert.ok(env.content.innerHTML.includes('<option value="c152" selected>Cessna 152 · HB-CFA, HB-CYF, HB-CYP</option>'));
  let s = shown(env);
  assert.ok(s.includes('Start 300 m 521 m 625 m') && s.includes('Landung 219 m 432 m 520 m') && s.includes("758 kg (1'670 lb)") && s.includes(C152.footerDe), s);
  // nächster Seitenaufruf mit der gespeicherten Wahl
  const next = fakeBrowser({ store: { 'lszk-perf-aircraft': 'c152' }, initialWx: wxPfa() });
  ui.boot(next.win);
  await settle();
  assert.ok(next.content.innerHTML.includes('<option value="c152" selected>'), next.content.innerHTML.slice(0, 400));
  assert.ok(shown(next).includes('Start 300 m 521 m 625 m'));
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'c172d' } });
  await settle();
  s = shown(env);
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
  assert.ok(s.includes('Start 331 m 492 m') && s.includes(C172D.footerDe) && !s.includes('O-235'), s);
});

test('boot: nicht ladbare Wahl fällt auf den Standard zurück, Speicher geleert, Hinweis', async (t) => {
  const env = startBrowser(t, { files: { 'perf/aircraft/index.json': INDEX_3 }, store: { 'lszk-perf-aircraft': 'x' } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], undefined);
  assert.ok(env.content.innerHTML.includes('<option value="c172d" selected>'));
  assert.ok(shown(env).includes('Flugzeugdaten für «Fehlt» nicht verfügbar – Standardmuster gewählt.'));
  assert.ok(shown(env).includes('Start 331 m'));
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'x' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], undefined, 'fehlgeschlagene Wahl gespeichert');
  assert.ok(shown(env).includes('Standardmuster gewählt') && shown(env).includes('Start 331 m'));
});

test('boot: Flugzeugdatei mit falscher id gilt als nicht ladbar', async (t) => {
  const wrong = Object.assign(clone(P2010), { id: 'c172d' });
  const env = startBrowser(t, { files: { 'perf/aircraft/p2010.json': wrong } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'p2010' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], undefined);
  assert.ok(shown(env).includes('Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.'), shown(env));
  assert.ok(env.content.innerHTML.includes('<option value="c172d" selected>'));
});

test('boot: Wahl und Standard nicht ladbar – kein «Standardmuster gewählt», Auswahl bleibt', async (t) => {
  const env = startBrowser(t, { files: { 'perf/aircraft/index.json': INDEX_3, 'perf/aircraft/c172d.json': undefined }, store: { 'lszk-perf-aircraft': 'x' } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  const s = shown(env);
  assert.ok(s.includes('Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.'), s);
  assert.ok(!s.includes('Standardmuster gewählt'), 'Widerspruch');
  assert.ok(env.content.innerHTML.includes('<select id="perf-ac"'));
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'p2010' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'p2010');
  assert.ok(shown(env).includes('Start 409 m'));
});

test('boot: FGZO-Status mit jedem update; ein fehlgeschlagener Abruf lässt den letzten Stand stehen, der dann altert', async (t) => {
  const wet = fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' });
  const env = startBrowser(t, { files: { 'data/fgzo_status.json': wet } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).'));
  assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass gerechnet');
  // 404, Netzfehler, kaputtes JSON, kein Objekt: der letzte Stand bleibt
  const broken = [undefined, () => Promise.reject(new Error('offline')),
    () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError('kaputt')) }), null, [], 'DRY', 42];
  for (const [i, bad] of broken.entries()) {
    const n = env.fetchUrls.length;
    env.files['data/fgzo_status.json'] = bad;
    env.win.LszkPerf.update(wxPfa());
    await settle();
    assert.equal(env.fetchUrls.length, n + 1, 'Abruf ' + i);
    assert.ok(shown(env).includes('Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).'), 'Sperre nach Fehler ' + i);
    assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass nach Fehler ' + i);
  }
  // Leerer Satz, Satz nur mit ok:false, Satz mit älterer Abrufzeit (DRY): der gespeicherte Stand bleibt
  const ignored = [{}, { ok: false, error: 'bot challenge', failed_at_utc: new Date(NOW).toISOString() },
    fgzo({ fetched_at_utc: new Date(NOW - 30 * MIN).toISOString() }), fgzo({ fetched_at_utc: NOW })];
  for (const [i, bad] of ignored.entries()) {
    env.files['data/fgzo_status.json'] = bad;
    env.win.LszkPerf.update(wxPfa());
    await settle();
    assert.ok(shown(env).includes('Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).'), 'Sperre nach Satz ' + i);
    assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass nach Satz ' + i);
  }
  // Der Stand altert über fetched_at_utc (14 min alt): nach weiteren 31 min Sperre nur noch als Hinweis, weiter nass
  env.clock = NOW + 31 * MIN;
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 10 * MIN }));
  await settle();
  let s = shown(env);
  assert.ok(s.includes('Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb) (veraltete Meldung).'), s);
  assert.ok(s.includes('Piste gilt als nass: letzte FGZO-Meldung «STANDING WATER» (Stand 18.11.2026, 10:38), Abruf vor 45 min – vorsichtshalber weiter nass gerechnet.'), s);
  assert.ok(s.includes('Start 397 m 590 m') && !env.content.innerHTML.includes('perf-warn" role="note"><div>Platz'), 'Sperre nicht mehr im gelben Kasten');
  // ein neuer guter Stand ersetzt den alten
  env.files['data/fgzo_status.json'] = fgzo({ fetched_at_utc: new Date(env.clock - 5 * MIN).toISOString(), updated: '18.11.2026, 09:50' });
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 10 * MIN }));
  await settle();
  s = shown(env);
  assert.ok(s.includes('Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 09:50).') && s.includes('Start 331 m 492 m') && !s.includes('gesperrt'), s);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const okResponse = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(data))) });

test('boot: veraltete Antworten werden verworfen (Musterwechsel und FGZO-Abruf)', async (t) => {
  const slow = deferred();
  const env = startBrowser(t, { files: { 'perf/aircraft/p2010.json': () => slow.promise } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  // Tecnam gewählt (Antwort hängt), dann zurück zur Cessna; die späte Tecnam-Antwort darf nichts ändern
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'p2010' } });
  await settle();
  env.content.listeners.change({ target: { id: 'perf-ac', value: 'c172d' } });
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m'));
  slow.resolve(okResponse(P2010));
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m') && !shown(env).includes('409 m'), shown(env));
  assert.ok(env.content.innerHTML.includes('<option value="c172d" selected>'));
  assert.notEqual(env.store['lszk-perf-aircraft'], 'p2010');
  // FGZO: die Antwort des älteren Abrufs (nass, gesperrt) kommt nach der des neueren (DRY)
  const first = deferred();
  env.files['data/fgzo_status.json'] = () => first.promise;
  env.win.LszkPerf.update(wxPfa());
  env.files['data/fgzo_status.json'] = fgzo({ updated: '18.11.2026, 08:59' });
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 08:59).'), shown(env));
  first.resolve(okResponse(fgzo({ runway_condition: 'STANDING WATER', flaeche: 'gesperrt' })));
  await settle();
  const s = shown(env);
  assert.ok(!s.includes('STANDING WATER') && !s.includes('gesperrt') && s.includes('DRY (Stand 18.11.2026, 08:59)') && s.includes('Start 331 m 492 m'), s);
});
