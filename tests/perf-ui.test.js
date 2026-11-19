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
  // Eine Platzsperre wertet die Karte nicht aus (die Ampel der Seite zeigt sie): keine Felder dazu
  assert.deepEqual([f.kind, f.fresh, 'closed' in f, 'closedStale' in f, 'closedReason' in f], ['dry', false, false, false, false]);
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

test('Cessna trocken (K2): Auswahl, Kopf, Messwerte, nur Gegenwindpiste, Zustand, Pflichthinweis', () => {
  const html = render(wxPfa());
  assertClean(html, 'K2');
  const t = text(html);
  assert.ok(html.includes('<label class="perf-ac-label" for="perf-ac">Flugzeug wählen</label><select id="perf-ac" class="perf-select" aria-describedby="perf-ac-sub">'));
  assert.ok(html.includes('<select id="perf-ac" class="perf-select" aria-describedby="perf-ac-sub"><option value="c172d" selected>Cessna 172 Diesel</option>' +
    '<option value="p2010">Tecnam P2010</option><option value="c152">Cessna 152</option></select></div>' +
    '<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-TDA</span> · <span class="perf-nw">HB-TDB</span> · ' +
    '<span class="perf-nw">HB-TDC</span> · <span class="perf-nw">HB-TDD</span> · 1\'157&nbsp;kg</div>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 1'157 kg (2'550 lb) · Kurzstart- und Kurzlandetechnik · Motor TAE 125-02-114, Propeller MTV-6-A/190-69"), t);
  assert.ok(t.includes("Messwerte MeteoSchweiz Pfäffikon ZH, 09:00 Uhr (vor 15 min): 15,0 °C · QNH 1018,0 hPa · Wind 290° / 8,0 kt, Böen 14 kt · Druckhöhe 1'630 ft"), t);
  assert.ok(t.includes('Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 07:14). MeteoSchweiz hat in der letzten Stunde keinen Regen gemessen. Gerechnet für trockenes Gras. Tau, Reif, eben einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.'), t);
  assert.equal(block(html, '12'), null, 'Rückenwindpiste ohne Block');
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Piste 30 · Gegenwind 7 kt'), b30);
  assert.ok(b30.includes('Start 331 m 492 m 625 m') && b30.includes('Landung 265 m 489 m 520 m'), b30);
  assert.ok(!html.includes('perf-skip') && !t.includes('nicht berechnet') && !t.includes('Rückenwind'), 'keine Zeile zur Rückenwindpiste');
  assert.ok(!html.includes('perf-factor'), 'keine Faktorzeile bei der Cessna');
  assert.ok(!html.includes('perf-warn'));
  assert.ok(html.endsWith('</details><div class="perf-foot">' + ui.TEXT.advice + '</div>') && !t.includes('Richtwert'), 'Pflichthinweis direkt unter dem Rechenweg');
  assert.ok(!/#10b981|var\(--green\)|var\(--accent\)/.test(html), 'nie grün, nie Akzentfarbe');
});

test('Cessna nass durch FGZO (K3): gelber Kasten mit Quelle und Folge je Phase, Start × 1,20', () => {
  const html = render(wxPfa(), { fgzo: fgzo({ runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' }) });
  const t = text(html);
  assert.ok(html.includes('class="perf-cond perf-warn"'));
  assert.ok(t.includes('Piste gilt als nass: FGZO meldet «STANDING WATER» (Stand 18.11.2026, 10:38). Start: mindestens +20 % eingerechnet (Supplement, Note 4). Landung: Das AFM nennt für nasses Gras keinen Wert; die Strecke kann deutlich länger sein.'), t);
  assert.ok(text(block(html, '30')).includes('Start 397 m 590 m 625 m'));
  assert.ok(t.includes('Gras +15 % von 306 m = +45,9 m 330,48 m 491,37 m nasse Piste: mindestens × 1,20 396,58 m 589,65 m aufgerundet 397 m 590 m'), t);
  assert.ok(t.includes('Gras +45 % von 630 ft = +283,5 ft 869,4 ft 1\'604,1 ft nasse Piste: kein Wert im AFM, ohne Zuschlag gerechnet in Meter (× 0,3048) 265 m 488,93 m aufgerundet 265 m 489 m'), t);
  assert.ok(t.includes('Temperatur 15,0 °C · Piste nass'), t);
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

test('Tecnam (K8): Kopf, Zahlen, Faktorzeile, interpolierter Rechenweg, Pflichthinweis', () => {
  const html = render(wxPfa(), { aircraft: P2010 });
  assertClean(html, 'K8');
  const t = text(html);
  assert.ok(html.includes('<option value="p2010" selected>Tecnam P2010</option>'));
  assert.ok(html.includes('<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-KMD</span> · 1\'160&nbsp;kg</div>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 1'160 kg (2'557 lb) · Klappen T/O beim Start und LAND bei der Landung, Geschwindigkeiten nach AFM · Lycoming IO-360-M1A, Verstellpropeller MTV-15-B/193-52"), t);
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Start 409 m 744 m 625 m') && b30.includes('Landung 423 m 897 m 520 m'), b30);
  assert.ok(t.includes('Eingerechnet nach AFM: Faktor für Abweichungen im Betrieb – Start × 1,10 (NOTE, APV5-8), Landung × 1,67 (NOTE, APV5-17).'), t);
  assert.ok(t.includes("Start · AFM, Section 5, Ziffer 7, Seite APV5-8 Tabelle 2'000 ft / 0 °C 352 m 622 m Tabelle 2'000 ft / 25 °C 434 m 762 m interpoliert für 15,0 °C 401,2 m 706 m " +
    'Gegenwind 7 kt: −10 m je kt = −70 m 331,2 m 636 m Gras +10 % von 401,2 m = +40,12 m 371,32 m 676,12 m Faktor für Abweichungen im Betrieb × 1,10 408,46 m 743,74 m aufgerundet 409 m 744 m'), t);
  assert.ok(t.includes("Landung · AFM, Section 5, Ziffer 11, Seite APV5-17 Tabelle 2'000 ft / 0 °C 242 m 526 m Tabelle 2'000 ft / 25 °C 264 m 548 m interpoliert für 15,0 °C 255,2 m 539,2 m " +
    'Gegenwind 7 kt: −4 m je kt = −28 m 227,2 m 511,2 m Gras +10 % von 255,2 m = +25,52 m 252,72 m 536,72 m Faktor für Abweichungen im Betrieb × 1,67 422,05 m 896,33 m aufgerundet 423 m 897 m'), t);
  assert.ok(t.includes(ui.TEXT.advice) && !t.includes('Doc. No.') && !t.includes('Die Spalte ISA'), t);
});

test('Tecnam nass durch Regen: Hinweis ohne Zuschlag, Zahlen unverändert, Gewicht mit drei Stellen', () => {
  let html = render(wxPfa({ rain1hMm: 0.4 }), { aircraft: P2010 });
  assert.ok(has(html, 'Piste gilt als nass: MeteoSchweiz hat in der letzten Stunde 0,4 mm Regen gemessen. Das AFM nennt für nasses Gras keinen Wert; Start- und Landestrecke können deutlich länger sein. Laut AFM (Section 4, Ziffer 5.16) verschlechtert Regen die Leistung, besonders die Startstrecke.'));
  assert.ok(text(block(html, '30')).includes('Start 409 m 744 m'));
  html = render(wxPfa({ tempC: 10.8, qnhHpa: 998.2, windDir: 247, windKt: 8.7 }), { aircraft: P2010 });   // K21
  assert.ok(has(html, "Tabelle 3'000 ft / 0 °C 384 m 678 m Tabelle 3'000 ft / 25 °C 474 m 830 m interpoliert für 10,8 °C 422,88 m 743,664 m"), text(html));
  assert.ok(text(block(html, '30')).includes('Start 468 m 821 m') && text(block(html, '30')).includes('Landung 453 m 927 m'));
  html = render(wxPfa({ tempC: -30, windKt: 0 }), { aircraft: P2010 });                                  // T3
  assert.ok(has(html, "Temperatur −30,0 °C · Piste trocken") && has(html, "Tabelle 2'000 ft / −25 °C 279 m 499 m Gras") && !has(html, 'interpoliert'), text(html));
});

/* ── Anzeige Cessna 152 ────────────────────────────────────── */

test('Cessna 152 trocken (C2): Auswahl mit drei Mustern, Kopf, Zahlen, Rechenweg in ft, Quellen, Pflichthinweis', () => {
  const html = render(wxPfa(), { aircraft: C152 });
  assertClean(html, 'C2');
  const t = text(html);
  assert.equal((html.match(/<option /g) || []).length, 3);
  assert.ok(html.includes('<option value="c172d">Cessna 172 Diesel</option><option value="p2010">Tecnam P2010</option>' +
    '<option value="c152" selected>Cessna 152</option>'), html);
  assert.ok(html.includes('<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-CFA</span> · <span class="perf-nw">HB-CYF</span> · ' +
    '<span class="perf-nw">HB-CYP</span> · 758&nbsp;kg</div>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 758 kg (1'670 lb) · Kurzstart- und Kurzlandetechnik · Motor Lycoming O-235-L2C, Festpropeller"), t);
  assert.equal(block(html, '12'), null, 'Rückenwindpiste ohne Block');
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Piste 30 · Gegenwind 7 kt'), b30);
  assert.ok(b30.includes('Start 300 m 521 m 625 m') && b30.includes('Landung 219 m 432 m 520 m'), b30);
  assert.ok(t.includes("Eingaben: Druckhöhe 1'630 ft (QNH 1018,0 hPa, Platzhöhe 1'759 ft) · Temperatur 15,0 °C · Piste trocken gerechnet Piste 30 (304° rechtweisend) · Gegenwind 7,76 kt, abgerundet 7 kt"), t);
  assert.ok(t.includes("Start · Handbuch, Figure 5-4, Seite 5-11 Tabelle 2'000 ft / 20 °C 910 ft 1'690 ft Gegenwind 7 kt: −10 % je 9 kt, abgerundet −7 % 846,3 ft 1'571,7 ft " +
    "Gras +15 % von 910 ft = +136,5 ft 982,8 ft 1'708,2 ft in Meter (× 0,3048) 299,56 m 520,66 m aufgerundet 300 m 521 m"), t);
  assert.ok(t.includes("Landung · Handbuch, Figure 5-10, Seite 5-19 Tabelle 2'000 ft / 20 °C 520 ft 1'270 ft Gegenwind 7 kt: −10 % je 9 kt, abgerundet −7 % 483,6 ft 1'181,1 ft " +
    "Gras +45 % von 520 ft = +234 ft 717,6 ft 1'415,1 ft in Meter (× 0,3048) 218,73 m 431,33 m aufgerundet 219 m 432 m"), t);
  ['KIAS', 'D1170-1-13PH', 'F1521792', 'Für nasses Gras nennt das AFM', 'keine Interpolation', '757,5 kg'].forEach((s) => assert.ok(!t.includes(s), 'nicht mehr angezeigt: ' + s));
  assert.ok(!html.includes('perf-factor'), 'keine Faktorzeile');
  assert.ok(!html.includes('perf-warn') && !html.includes('perf-note'));
  assert.ok(t.includes(ui.TEXT.advice) && !t.includes('Richtwert'));
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
  assert.ok(has(html, "Maximales Abfluggewicht 758 kg (1'670 lb)") && has(html, ui.TEXT.advice));
  html = render(wxPfa({ tempC: 40, qnhHpa: 1013.25, windDir: null, windKt: 0 }), { aircraft: C152 });          // C5
  assert.ok(block(html, '30').includes('<span class="perf-amber">646&nbsp;m</span>') && has(block(html, '30'), 'Start: Strecke über 15 m länger als die verfügbare Länge.'));
  html = render(wxPfa({ tempC: -5, qnhHpa: 1004.5, windDir: null, windKt: 0 }), { aircraft: C152 });         // C7b
  assert.ok(has(html, 'Temperatur −5,0 °C · Piste trocken') && has(html, "Tabelle 2'000 ft / 0 °C 775 ft 1'445 ft"), text(html));
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
  assert.ok(has(html, 'Pisten 12 und 30 · Wind genau quer, ohne Windkorrektur'), text(html));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 215, windKt: 10 }));                              // K17
  assert.ok(has(block(html, '30'), 'Piste 30 · Gegenwind unter 1 kt, nicht angerechnet'));
  assert.equal(block(html, '12'), null);
  assert.ok(!has(html, 'Wind genau quer zur Piste: keine Gegenwindpiste'));
  assert.ok(has(html, 'Piste 30 (304° rechtweisend) · Gegenwind 0,17 kt, abgerundet 0 kt'), text(html));
  html = render(wxPfa({ windDir: null, windKt: 6 }));                                                       // K12b
  assert.ok(has(html, 'Windrichtung fehlt bei mehr als 3 kt Wind: Die Gegenwindpiste lässt sich nicht bestimmen – keine Berechnung.'));
  assertNoResult(html, 'K12b');
  assert.ok(has(render(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 })), 'Pisten 12 und 30 · Windrichtung nicht gemeldet, ohne Windkorrektur'));
});

test('Schwellen: Mittelwind der Messwertzeile auf 0,1 kt, Gegenwind im Rechenweg auf 0,01 kt abgeschnitten', () => {
  assert.deepEqual([ui.fmtWind(0.97), ui.fmtWind(0.99999), ui.fmtWind(1), ui.fmtWind(2.96), ui.fmtWind(3.04), ui.fmtWind(8), ui.fmtWind(0.3 * 3)],
    ['0,9', '0,9', '1,0', '2,9', '3,0', '8,0', '0,9']);
  assert.deepEqual([ui.fmtKt2(6.996), ui.fmtKt2(7.7624), ui.fmtKt2(0.1 * 3 * 10), ui.fmtKt2(0.1736), ui.fmtKt2(0.999)], ['6,99', '7,76', '3,00', '0,17', '0,99']);
  // 8,7 × 100 = 869,999… und 0,29 × 100 = 28,999…: ohne die Toleranz in fmtKt2 stünde «8,69» und «0,28»
  assert.deepEqual([ui.fmtKt2(8.7), ui.fmtKt2(0.29), ui.fmtKt2(4.35)], ['8,70', '0,29', '4,35']);
  let html = render(wxPfa({ windDir: 120, windKt: 0.97 }));
  assert.ok(has(html, 'Wind 120° / 0,9 kt') && has(html, 'Pisten 12 und 30 · windstill, ohne Windkorrektur'), text(html));
  assert.ok(has(html, 'Windstill (Mittelwind unter 1 kt)'));
  html = render(wxPfa({ windDir: null, windKt: 2.96 }));
  assert.ok(has(html, 'Wind 2,9 kt, Richtung unbestimmt') && has(html, 'Windrichtung nicht gemeldet'), text(html));
  html = render(wxPfa({ windDir: null, windKt: 3.04 }));
  assert.ok(has(html, 'Windrichtung fehlt bei mehr als 3 kt Wind'), text(html));
  assertNoResult(html, '3,04 kt ohne Richtung');
  html = render(wxPfa({ windDir: 304, windKt: 6.996 }));                       // Komponente 6,996 kt → abgerundet 6 kt
  assert.ok(has(html, 'Wind 304° / 6,9 kt'), text(html));
  assert.ok(has(html, 'Piste 30 (304° rechtweisend) · Gegenwind 6,99 kt, abgerundet 6 kt') && has(html, 'Gegenwind 6 kt: −10 % je 9 kt, abgerundet −6 %'), text(html));
  assert.ok(!has(html, 'Rückenwind') && !has(html, 'Piste 12'), 'keine Zeile zur Rückenwindpiste');
});

test('Rechenweg: Gegenwindkomponente abgeschnitten (nie gerundet), ganze kt abgerundet; keine Zeile zur Rückenwindpiste', () => {
  let n = 0;
  [[215, 6.6, '0,11', 0], [304, 6.996, '6,99', 6], [290, 8, '7,76', 7], [124, 12.345, '12,34', 12], [200, 9.999, '2,41', 2], [304, 8.7, '8,70', 8]].forEach(([dir, kt, shown, whole]) => {
    const t = text(render(wxPfa({ windDir: dir, windKt: kt })));
    const head = /Piste (12|30) \((124|304)° rechtweisend\) · Gegenwind (\S+) kt, abgerundet (\d+) kt/.exec(t);
    assert.ok(head, dir + '/' + kt + ': ' + t);
    assert.deepEqual([head[3], Number(head[4])], [shown, whole], dir + '/' + kt);
    assert.equal(head[2], head[1] === '12' ? '124' : '304', 'Pistenrichtung zur Piste');
    assert.ok(!t.includes('Rückenwind') && !t.includes('nicht berechnet'), dir + '/' + kt + ': Rückenwindzeile');
    n++;
  });
  assert.equal(n, 6);
});

test('Feststellungen: 50-%-Satz, Gegenwindgrenze, Überschreitungen, Gleichstand', () => {
  let html = render(wxPfa({ tempC: 10, qnhHpa: 1013.25, windDir: 304, windKt: 22 }), { aircraft: P2010 });   // K10a
  const b = text(block(html, '30'));
  assert.ok(b.includes('Start – – 625 m') && b.includes('Landung 314 m 789 m 520 m'), b);
  assert.ok(b.includes('Start: Bei 22 kt Gegenwind würde die Windkorrektur des AFM die Strecke um mehr als die Hälfte verkürzen. Kein Wert.'), b);
  assert.ok(has(html, 'interpoliert für 10,0 °C 384,8 m 678 m Gegenwind 22 kt: −10 m je kt = −220 m, mehr als die Hälfte kein Wert Landung'), text(html));
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

test('Zustände ohne Wert: Text je Fall, Kopf des Musters und Pflichthinweis, kein Ergebnisblock', () => {
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
    assert.ok(t.includes(head) && html.endsWith('<div class="perf-foot">' + ui.TEXT.advice + '</div>'), 'Kopf oder Pflichthinweis fehlt: ' + expected);
  });
  let html = render(wxPfa(), { fgzoPending: true });
  assertNoResult(html, 'FGZO lädt');
  assert.ok(has(html, 'Lade Flugplatzstatus …'));
  html = render(wxPfa(), { dataState: 'error', aircraft: null, airfield: null });
  assert.ok(has(html, 'Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.'));
  assert.ok(html.endsWith('<div class="perf-foot">' + ui.TEXT.advice + '</div>') && !has(html, 'Richtwert'));
  assertNoResult(html, 'Daten');
  html = render(wxPfa(), { dataState: 'loading', aircraft: null });
  assertNoResult(html, 'laden');
  assert.ok(has(html, 'Lade Flugzeug- und Platzdaten …'));
});

/* ── Escaping ──────────────────────────────────────────────── */

test('Escaping: Quelle, FGZO, Auswahl, Kennzeichen, Texte aus den Daten, Quellenangabe, Hinweis', () => {
  const evil = '<img src=x onerror=y>';
  let html = render(wxPfa({ srcLabel: evil }), { fgzo: fgzo({ runway_condition: evil, updated: '<b>7</b>' }) });
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.ok(html.includes('&lt;IMG SRC=X ONERROR=Y&gt;') && html.includes('&lt;img src=x onerror=y&gt;'));
  html = render(wxPfa(), { fgzo: fgzo({ updated: '<b onclick=x>7</b>' }) });
  assert.ok(html.includes('Pistenzustand laut FGZO: DRY (Stand &lt;b onclick=x&gt;7&lt;/b&gt;) – Datum der Meldung unklar.'), html);
  const list = [{ id: 'c172d', label: 'C <i>1</i>', file: 'c172d.json', registrations: ['HB-<s>X'] }, LIST[1]];
  html = render(wxPfa(), { list });
  assert.ok(html.includes('<option value="c172d" selected>C &lt;i&gt;1&lt;/i&gt;</option>'), html);
  assert.ok(html.includes('<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-&lt;s&gt;X</span> · 1\'157&nbsp;kg</div>'), html);
  const ac = clone(C172D);
  ac.techniqueDe = '<u>t</u>';
  ac.variantDe = '<u>v</u>';
  ac.footerDe = '<u>f</u>';
  ac.charts.takeoff.notesDe = ['<script>n()</script>'];
  ac.charts.landing.conditionsDe = '<img src=c>';
  ac.sources.poh.pageMark = '<b>172SPHBUS-00</b>';
  ac.readingRuleDe = '<u>r</u>';
  ac.sources.supplement.labelDe = '<i>s</i>';
  ac.charts.takeoff.ref.figure = '<b>f</b>';
  ac.charts.landing.ref.page = '<s>p</s>';
  html = render(wxPfa(), { aircraft: ac, notice: 'Hinweis <u>x</u>' });
  ['<u>', '<script', '<img', '<b>', '<i>', '<s>'].forEach((s) => assert.ok(!html.includes(s), s));
  ['&lt;u&gt;t&lt;/u&gt;', '&lt;u&gt;v&lt;/u&gt;', 'Start <span class="perf-steps-src">· &lt;i&gt;s&lt;/i&gt;, &lt;b&gt;f&lt;/b&gt;, Seite 5b-3</span>',
    'Figure 5-11, Seite &lt;s&gt;p&lt;/s&gt;</span>', '<div class="perf-note" role="status">Hinweis &lt;u&gt;x&lt;/u&gt;</div>'].forEach((s) => assert.ok(html.includes(s), s));
  // Nicht mehr angezeigt: Fusszeile, Anmerkungen, Bedingungen, Seitenkennung und Ableseregel der Daten
  ['&lt;u&gt;f', 'n()', 'src=c', '172SPHBUS', '&lt;u&gt;r'].forEach((s) => assert.ok(!html.includes(s), 'noch angezeigt: ' + s));
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
  assert.ok(renders >= 2200 && escaped >= 250, renders + ' Darstellungen, ' + escaped + ' mit maskierter Marke');
});

/* ── Auswahl, Format, Technik ──────────────────────────────── */

test('Auswahl: ein Muster ohne select, Laden und Fehler mit erreichbarer Auswahl', () => {
  let html = render(wxPfa(), { list: [LIST[0]] });
  assert.ok(!html.includes('<select'));
  assert.ok(html.includes('<div class="perf-ac perf-ac-one">Cessna 172 Diesel</div><div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-TDA</span> · ' +
    '<span class="perf-nw">HB-TDB</span> · <span class="perf-nw">HB-TDC</span> · <span class="perf-nw">HB-TDD</span> · 1\'157&nbsp;kg</div>'), html);
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
  assert.ok(t.includes("Tabelle 3'000 ft / 0 °C 251 m 535 m Tabelle 3'000 ft / 25 °C 274 m 558 m interpoliert für 10,8 °C 260,936 m 544,936 m Gegenwind 4 kt: −4 m je kt = −16 m 244,936 m 528,936 m " +
    'Gras +10 % von 260,936 m = +26,0936 m 271,0296 m 555,0296 m Faktor für Abweichungen im Betrieb × 1,67 452,62 m 926,9 m aufgerundet 453 m 927 m'), t);
  // Temperatur mit drei Dezimalen (kommt bei MeteoSchweiz nicht vor): nicht exakt darstellbare Werte mit «≈»
  t = text(render(wxPfa({ tempC: 7.123 }), { aircraft: P2010 }));
  assert.ok(t.includes('interpoliert für 7,1 °C ≈375,3634 m 661,8888 m'), t);
  assert.ok(t.includes('Faktor für Abweichungen im Betrieb × 1,10 377,19 m 692,37 m aufgerundet 378 m 693 m'), t);
});

test('Rechenweg: absolute Windkorrektur mit Rest «abgerundet», gebrochene Regelwerte exakt', () => {
  const ac = clone(P2010);
  Object.assign(ac.charts.takeoff.corrections.find((c) => c.kind === 'headwind'), { amount: -15, per: 2 });
  Object.assign(ac.charts.landing.corrections.find((c) => c.kind === 'headwind'), { amount: -2.5, per: 1.5 });
  const t = text(render(wxPfa({ windDir: 304, windKt: 3 }), { aircraft: ac }));
  assert.ok(t.includes('Gegenwind 3 kt: −15 m je 2 kt, abgerundet −22 m 379,2 m 684 m'), t);   // 22,5 → 22
  assert.ok(t.includes('Gegenwind 3 kt: −2,5 m je 1,5 kt = −5 m 250,2 m 534,2 m'), t);
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

test('CSS und HTML: nur Klassen und IDs mit Präfix perf-, Auswahl auf allen Breiten 16 px und 44 px', () => {
  const selectors = ui.CSS.replace(/\{[^}]*\}/g, ' ').replace(/@media[^{]*\{/g, ' ');
  const names = selectors.match(/[.#][a-zA-Z][\w-]*/g) || [];
  assert.ok(names.length > 10);
  names.forEach((n) => assert.ok(n.slice(1).startsWith('perf-'), 'CSS ' + n));
  const html = render(wxPfa({ rain1hMm: 1 }), { aircraft: P2010, fgzo: fgzo({ flaeche: 'gesperrt' }), detailsOpen: true });
  (html.match(/class="[^"]*"/g) || []).forEach((c) => c.slice(7, -1).split(/\s+/).forEach((k) => assert.ok(k.startsWith('perf-'), 'Klasse ' + k)));
  (html.match(/ id="[^"]*"/g) || []).forEach((i) => assert.ok(i.slice(5, -1).startsWith('perf-'), 'ID ' + i));
  assert.ok(ui.CSS.includes('repeat(auto-fit, minmax(min(260px, 100%), 1fr))'));
  // Regel ohne Einzug steht ausserhalb jeder @media-Regel, gilt also auf allen Breiten
  const sel = /\n\.perf-select \{([^}]*)\}/.exec(ui.CSS);
  assert.ok(sel && sel[1].includes('font-size: 16px;') && sel[1].includes('min-height: 44px;') && sel[1].includes('width: 100%;'), ui.CSS);
  assert.ok(!/\n {2}\.perf-select\b/.test(ui.CSS), 'eine @media-Regel überschreibt das Auswahlfeld');
});

function cssRule(selector) {
  const m = new RegExp('\\n' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}').exec(ui.CSS);
  return m ? m[1] : null;
}

test('Auswahlfeld-CSS: als Feld erkennbar (Rahmen in Akzentfarbe, eigener Pfeil), 16 px, 44 px, Fokusrahmen, nie «outline: none»', () => {
  const s = cssRule('.perf-select');
  ['-webkit-appearance: none;', '-moz-appearance: none;', ' appearance: none;', 'display: block;', 'width: 100%;', 'max-width: 26rem;',
    'min-height: 44px;', 'font-size: 16px;', 'color: var(--text);', 'background-color: var(--bg);', 'border: 1px solid var(--accent);',
    'background-repeat: no-repeat;', 'background-position: right 12px center;', 'padding: 8px 40px 8px 12px;', 'cursor: pointer;'].forEach((x) => {
    assert.ok(s.includes(x), 'fehlt: ' + x);
  });
  // Pfeil als Daten-URI: Hochkommas im SVG (kein «"», das die url("…") beendete), Farbe = --accent (#38bdf8)
  const uri = /background-image: url\("(data:image\/svg\+xml,[^"]*)"\);/.exec(s);
  assert.ok(uri, s);
  assert.ok(uri[1].includes("%3Csvg xmlns='http://www.w3.org/2000/svg'") && uri[1].includes("stroke='%2338bdf8'") &&
    uri[1].includes("%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E"), uri[1]);
  assert.ok(!/[\s<>{}]/.test(uri[1].replace(/ /g, '')), 'unmaskierte Zeichen in der Daten-URI');
  assert.equal(cssRule('.perf-select:focus-visible'), ' outline: 2px solid var(--accent); outline-offset: 2px; ');
  assert.ok(!/outline:\s*(?:none|0)\b/.test(ui.CSS), 'outline: none');
  assert.equal(cssRule('.perf-ac-label'), ' display: block; margin: 0 0 4px; color: var(--text-muted); font-weight: 600; font-size: 0.78rem; ');
  assert.equal(cssRule('.perf-ac-sub:empty'), ' display: none; ');
  assert.equal(cssRule('.perf-nw'), ' white-space: nowrap; ');
});

test('Auswahlfeld: «Flugzeug wählen», Namen ohne Kennzeichen, Unterzeile mit Kennzeichen, Masse erst nach dem Laden', () => {
  const sub = (html) => { const m = /<div class="perf-ac-sub" id="perf-ac-sub">(.*?)<\/div>/.exec(html); return m ? m[1] : null; };
  const regs = (r) => r.map((x) => '<span class="perf-nw">' + x + '</span>').join(' · ');
  // Geladen: Kennzeichen und Masse des geladenen Musters; Liste nur mit Namen
  [[C172D, ['HB-TDA', 'HB-TDB', 'HB-TDC', 'HB-TDD'], "1'157"], [P2010, ['HB-KMD'], "1'160"], [C152, ['HB-CFA', 'HB-CYF', 'HB-CYP'], '758']].forEach(([ac, r, kg]) => {
    const html = render(wxPfa(), { aircraft: ac });
    assert.equal(sub(html), regs(r) + ' · ' + kg + '&nbsp;kg', ac.id);
    (html.match(/<option [^>]*>[^<]*<\/option>/g) || []).forEach((o) => assert.ok(!o.includes('HB-'), 'Kennzeichen in der Liste: ' + o));
    assert.equal(html.split('id="perf-ac-sub"').length - 1, 1, 'Unterzeile genau einmal');
    assert.ok(html.indexOf('</select></div><div class="perf-ac-sub"') > 0, 'Unterzeile direkt unter der Auswahl');
  });
  // Laden und Fehler: Kennzeichen der Wahl, keine Masse (die Flugzeugdaten fehlen)
  let html = render(wxPfa(), { dataState: 'loading', selectedId: 'p2010', aircraft: null });
  assert.equal(sub(html), regs(['HB-KMD']));
  html = render(wxPfa(), { dataState: 'error', selectedId: 'c152', aircraft: null });
  assert.equal(sub(html), regs(['HB-CFA', 'HB-CYF', 'HB-CYP']));
  // Wahl nicht in der Liste: keine Kennzeichen eines anderen Musters; leere Unterzeile wird per CSS ausgeblendet
  html = render(wxPfa(), { dataState: 'loading', selectedId: 'x', aircraft: null });
  assert.equal(sub(html), '');
  // Muster ohne Kennzeichen: nur die Masse bzw. nichts
  const noRegs = [Object.assign({}, LIST[0], { registrations: [] }), LIST[1]];
  assert.equal(sub(render(wxPfa(), { list: noRegs })), "1'157&nbsp;kg");
  assert.equal(sub(render(wxPfa(), { list: noRegs, dataState: 'loading', selectedId: 'c172d', aircraft: null })), '');
  // Ein Muster: Name ohne <select>, darunter die Unterzeile
  html = render(wxPfa(), { list: [LIST[1]], aircraft: P2010 });
  assert.ok(html.startsWith('<div class="perf-ac perf-ac-one">Tecnam P2010</div><div class="perf-ac-sub" id="perf-ac-sub">' + regs(['HB-KMD']) +
    " · 1'160&nbsp;kg</div>"), html.slice(0, 200));
  assert.ok(!html.includes('<select') && !html.includes('<label'));
  // Ohne Liste weder Auswahl noch Unterzeile; Version ungleich: nur «Rechenfehler»
  html = render(wxPfa(), { list: null });
  assert.ok(!html.includes('perf-ac') && html.includes('perf-grid'));
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    html = render(wxPfa());
    assert.ok(!html.includes('perf-ac') && has(html, 'Rechenfehler – keine Berechnung.'), html);
  } finally {
    core.VERSION = v;
  }
  // Langer Name gekürzt, maskiert
  const long = [Object.assign({}, LIST[0], { label: '<b>' + 'Sehr langer Name '.repeat(5) }), LIST[1]];
  const opt = /<option value="c172d" selected>([^<]*)<\/option>/.exec(render(wxPfa(), { list: long }));
  assert.ok(opt && opt[1].startsWith('&lt;b&gt;Sehr langer') && opt[1].endsWith('…'), opt && opt[1]);
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

// Nachgebautes Element: innerHTML mit Schreibzähler (gesamt und je id); ein geschriebenes <details class="perf-details">
// und ein <select id="perf-ac"> werden zu Objekten (open bzw. value, wie im Browser aus dem Markup vorbelegt).
// Jedes Schreiben mit <select> legt einen neuen Knoten an (env.selectNodes). Ein Element mit Kindern liefert als
// innerHTML deren Inhalt hintereinander (so zeigt #perf-content Auswahl und Karte zusammen).
function fakeEl(env, id, style) {
  return {
    id, html: '', style: Object.assign({}, style), listeners: {}, children: [], details: null, select: null, open: false,
    get innerHTML() { return this.children.length ? this.children.map((c) => c.innerHTML).join('') : this.html; },
    set innerHTML(v) {
      this.html = String(v);
      env.writes++;
      env.writesBy[this.id] = (env.writesBy[this.id] || 0) + 1;
      this.details = this.html.includes('<details class="perf-details"')
        ? { open: this.html.includes('<details class="perf-details" open>') } : null;
      const s = /<select id="perf-ac"[^>]*>(.*?)<\/select>/.exec(this.html);
      this.select = null;
      if (s) {
        const opts = [...s[1].matchAll(/<option value="([^"]*)"( selected)?>/g)];
        const pick = opts.find((o) => o[2]) || opts[0];
        this.select = { id: 'perf-ac', value: pick ? pick[1] : '' };
        env.selectNodes++;
      }
    },
    querySelector(q) {
      if (q === 'details.perf-details') return this.details;
      if (q === 'select') return this.select;
      return null;
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    appendChild(c) { this.children.push(c); if (c.id) env.nodes[c.id] = c; return c; },
    getAttribute: (n) => (n === 'data-airfield' ? 'lszk' : null)
  };
}

// Seite wie index.html: <details id="perf-box" style="display:none"> mit #perf-teaser-text, darin #perf-card mit leerem
// #perf-content. oldPage: alte Seite aus dem Cache (Karte mit display:none, ohne Box und Kurzzeile).
// noCard / noContent: ohne #perf-card bzw. #perf-content. storeThrows: localStorage wirft (privater Modus).
function fakeBrowser(opts) {
  opts = opts || {};
  const env = {
    clock: NOW, fetchUrls: [], failPerf: !!opts.failPerf, intervals: [], timeouts: [], docListeners: {},
    writes: 0, writesBy: {}, selectNodes: 0, nodes: {},
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
  const card = fakeEl(env, 'perf-card', opts.oldPage ? { display: 'none' } : {});
  const content = fakeEl(env, 'perf-content');
  const box = opts.oldPage ? null : fakeEl(env, 'perf-box', { display: 'none' });
  const teaser = opts.oldPage ? null : fakeEl(env, 'perf-teaser-text');
  [card, content, box, teaser].forEach((el) => { if (el) env.nodes[el.id] = el; });
  if (opts.noContent) delete env.nodes['perf-content'];
  const styles = [];
  const doc = {
    readyState: opts.readyState || 'interactive', hidden: false,
    head: { appendChild: (el) => { styles.push(el); } },
    getElementById: (id) => {
      if (opts.noCard) return null;
      if (id === 'perf-style') return styles.find((s) => s.id === 'perf-style') || null;
      return env.nodes[id] || null;
    },
    createElement: (tag) => (tag === 'style' ? { tagName: 'STYLE', id: '', textContent: '' } : fakeEl(env, '')),
    addEventListener: (type, fn) => { env.docListeners[type] = fn; }
  };
  const fail = () => { throw new Error('SecurityError'); };
  const win = {
    document: doc,
    LSZK_WX: opts.initialWx,
    localStorage: opts.storeThrows ? { getItem: fail, setItem: fail, removeItem: fail } : {
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
  Object.assign(env, { win, doc, card, content, box, teaser, styles });
  // vom Skript angelegt: #perf-sel (Auswahl) und #perf-body (Karteninhalt)
  Object.defineProperty(env, 'sel', { get: () => env.nodes['perf-sel'] || null });
  Object.defineProperty(env, 'body', { get: () => env.nodes['perf-body'] || null });
  return env;
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
// Sichtbarer Text der Kurzzeile: ohne den Zusatz «Richtwert AFM» (damit die boot-Tests nicht von TEASER_AFM_TAG
// abhängen) und ohne die versteckten Hinweiswörter für Screenreader
const teaserText = (env) => text(env.teaser.innerHTML.replace(/<span class="perf-(?:t-tag|sr)">[^<]*<\/span>/g, '')).trim();
// Wahl wie im Browser: value des bestehenden <select> setzen, dann change auf #perf-sel
function choose(env, id) {
  const s = env.sel.querySelector('select');
  s.value = id;
  env.sel.listeners.change({ target: s });
}
function evilWx() {
  const evil = {};
  Object.defineProperty(evil, 'tempC', { enumerable: true, get() { throw new Error('kaputt'); } });
  return evil;
}

test('boot: Kurzzeile und Karte versteckt bis zum ersten update, dann Zahlen nach dem FGZO-Abruf', async (t) => {
  const env = startBrowser(t);
  await settle();
  assert.equal(env.box.style.display, 'none');
  assert.equal(env.content.innerHTML, '');
  assert.equal(env.teaser.innerHTML, '');
  assert.deepEqual(env.content.children.map((c) => c.id), ['perf-sel', 'perf-body'], 'Unterbehälter in #perf-content angelegt');
  assert.equal(env.styles.length, 1);
  assert.equal(env.styles[0].textContent, ui.CSS);
  assert.equal(env.win.LszkPerf.version, ui.VERSION);
  assert.deepEqual(env.intervals.map((i) => i.ms), [60000]);
  env.win.LszkPerf.update(wxPfa());
  assert.equal(env.box.style.display, 'block');
  assert.equal(env.card.style.display, undefined, 'die Karte selbst bekommt kein display');
  assert.ok(shown(env).includes('Lade Flugplatzstatus …'), 'vor dem FGZO-Abruf keine Trockenrechnung');
  assert.equal(teaserText(env), 'Start- und Landestrecke · Cessna 172 Diesel Lade Flugplatzstatus …');
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m 625 m'), shown(env));
  assert.equal(teaserText(env), 'Cessna 172 Diesel · Piste 30 Rollstrecke: Start 331 m · Landung 265 m');
  // Der Weg über boot nimmt die ausgelieferte Stellung des Zusatzes «Richtwert AFM»
  assert.equal(env.teaser.innerHTML.includes('<span class="perf-t-tag">Richtwert AFM</span>'), ui.TEASER_AFM_TAG);
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
  assert.ok(!env.teaser.innerHTML.includes('perf-t-row'), 'Kurzzeile mit Zahlen vor dem FGZO-Abruf');
  env.clock += 200;
  env.timeouts[0].fn();
  assert.ok(shown(env).includes('Pistenzustand: keine aktuelle Meldung der FGZO.'), shown(env));
  assert.ok(shown(env).includes('Start 331 m'));
  assert.ok(teaserText(env).includes('Rollstrecke: Start 331 m'), teaserText(env));
});

test('boot: LSZK_WX beim Start einmal gelesen; ohne #perf-card oder #perf-content nichts tun', async (t) => {
  let env = startBrowser(t, { initialWx: wxPfa() });
  await settle();
  assert.equal(env.box.style.display, 'block');
  assert.ok(shown(env).includes('Start 331 m'));
  assert.ok(teaserText(env).includes('Rollstrecke: Start 331 m'));
  for (const o of [{ noCard: true }, { noContent: true }]) {
    env = fakeBrowser(o);
    ui.boot(env.win);
    assert.doesNotThrow(() => env.win.LszkPerf.update(wxPfa()));
    assert.doesNotThrow(() => env.win.LszkPerf._tick());
    await settle();
    assert.equal(env.fetchUrls.length, 0, JSON.stringify(o));
    assert.equal(env.writes, 0, JSON.stringify(o));
    if (env.box) assert.equal(env.box.style.display, 'none', JSON.stringify(o));
  }
});

test('boot: Altern über Takt, Sichtbarkeit und _tick lässt die Zahlen in Karte und Kurzzeile verschwinden', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa({ time: NOW - 44 * MIN }));
  await settle();
  assert.ok(env.content.innerHTML.includes('perf-grid'));
  assert.ok(env.teaser.innerHTML.includes('perf-t-row'));
  env.clock = NOW + 2 * MIN;
  env.intervals[0].fn();
  assert.ok(!env.content.innerHTML.includes('perf-grid'));
  assert.ok(shown(env).includes('Messwerte veraltet'));
  assert.equal(teaserText(env), 'Start- und Landestrecke · Cessna 172 Diesel Messwerte veraltet – keine Berechnung');
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 44 * MIN }));
  await settle();
  assert.ok(env.content.innerHTML.includes('perf-grid') && env.teaser.innerHTML.includes('perf-t-row'));
  env.clock += 2 * MIN;
  env.docListeners.visibilitychange();
  assert.ok(!env.content.innerHTML.includes('perf-grid'));
  assert.ok(!env.teaser.innerHTML.includes('perf-t-row') && !/\d&nbsp;m/.test(env.teaser.innerHTML), env.teaser.innerHTML);
});

test('boot: kaputtes update wirft nicht, Rechenfehler in Karte und Kurzzeile bleibt bis zum nächsten gültigen update', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('331 m'));
  assert.doesNotThrow(() => env.win.LszkPerf.update(evilWx()));
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.'));
  assert.ok(env.body.innerHTML.endsWith('<div class="perf-foot">' + ui.TEXT.advice + '</div>'), 'Pflichthinweis auch im Fehlerzustand von boot');
  assert.equal(teaserText(env), 'Start- und Landestrecke Rechenfehler – keine Berechnung');
  assert.equal(env.sel.innerHTML, '', 'Auswahl im Zustand Rechenfehler');
  assert.equal(env.box.style.display, 'block');
  env.clock += MIN;
  env.win.LszkPerf._tick();
  env.intervals[0].fn();
  await settle();
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.') && !shown(env).includes('331 m'), 'alte Zahlen zurück');
  assert.ok(teaserText(env).includes('Rechenfehler') && !/\d&nbsp;m/.test(env.teaser.innerHTML), 'alte Zahlen in der Kurzzeile');
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 10 * MIN }));
  await settle();
  assert.ok(shown(env).includes('331 m') && teaserText(env).includes('Start 331 m'));
  assert.ok(env.content.innerHTML.includes('<select id="perf-ac"'), 'Auswahl wieder da');
  [42, 'x', undefined, null, []].forEach((v) => assert.doesNotThrow(() => env.win.LszkPerf.update(v)));
  assert.ok(shown(env).includes('Keine aktuellen Messwerte vom Platz – keine Berechnung.'));
  assert.equal(teaserText(env), 'Start- und Landestrecke · Cessna 172 Diesel Keine aktuellen Messwerte – keine Berechnung');
  // Derselbe Messwert vor und nach einem Rechenfehler: die Karte zeigt danach wieder die Zahlen, nicht «Rechenfehler»
  const same = wxPfa({ time: env.clock - 10 * MIN });
  env.win.LszkPerf.update(same);
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m'), 'vor dem Rechenfehler');
  env.win.LszkPerf.update(evilWx());
  env.win.LszkPerf.update(same);
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m') && !shown(env).includes('Rechenfehler'), 'Karte nach dem Rechenfehler: ' + shown(env).slice(0, 200));
  assert.ok(teaserText(env).includes('Start 331 m'));
});

test('boot: Rechenfehler als erstes update zeigt die Box; ein update vor DOMContentLoaded wird beim Start nachgeholt', async (t) => {
  let env = startBrowser(t);
  await settle();
  assert.equal(env.box.style.display, 'none');
  env.win.LszkPerf.update(evilWx());
  assert.equal(env.box.style.display, 'block', 'Box beim Rechenfehler als erstem update');
  assert.equal(teaserText(env), 'Start- und Landestrecke Rechenfehler – keine Berechnung');
  // Seite noch im Aufbau: update kommt vor dem Start, die Anzeige folgt beim Start ohne Rechenfehler
  env = fakeBrowser({ readyState: 'loading' });
  ui.boot(env.win);
  assert.equal(typeof env.docListeners.DOMContentLoaded, 'function');
  assert.doesNotThrow(() => env.win.LszkPerf.update(wxPfa()));
  assert.equal(env.box.style.display, 'none', 'vor dem Start angezeigt');
  assert.equal(env.fetchUrls.length, 0, 'vor dem Start geladen');
  env.docListeners.DOMContentLoaded();
  assert.equal(env.box.style.display, 'block');
  await settle();
  assert.ok(teaserText(env).includes('Start 331 m') && !shown(env).includes('Rechenfehler'), teaserText(env));
});

test('boot: Übergang vom Ergebnis zu Rechenabbruch und fehlender Windrichtung – die Kurzzeile zeigt keine alten Zahlen', async (t) => {
  const env = startBrowser(t);
  await settle();
  const cases = [
    [wxPfa({ qnhHpa: 850 }), 'Messwert unplausibel – keine Berechnung'],
    [wxPfa({ tempC: 45 }), 'Über dem Tabellenbereich des AFM – kein Wert'],
    [wxPfa({ windDir: null, windKt: 6 }), 'Windrichtung fehlt – keine Berechnung']
  ];
  for (const [w, state] of cases) {
    env.win.LszkPerf.update(wxPfa());
    await settle();
    assert.ok(teaserText(env).includes('Start 331 m'), 'Ergebnis vor «' + state + '»');
    env.win.LszkPerf.update(w);
    await settle();
    assert.equal(teaserText(env), 'Start- und Landestrecke · Cessna 172 Diesel ' + state);
    assert.ok(!env.teaser.innerHTML.includes('perf-t-row') && !/\d&nbsp;m/.test(env.teaser.innerHTML), state + ': ' + env.teaser.innerHTML);
    assert.ok(!env.content.innerHTML.includes('perf-grid'), state + ': Karte');
  }
});

test('boot: Ladefehler, neuer Versuch frühestens nach 60 s', async (t) => {
  const env = startBrowser(t, { failPerf: true });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.'));
  assert.equal(teaserText(env), 'Start- und Landestrecke Daten nicht verfügbar – keine Berechnung');
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
  env.body.details.open = true;
  env.clock += MIN;
  env.win.LszkPerf._tick();
  assert.ok(env.writes > w0);
  assert.ok(env.content.innerHTML.includes('<details class="perf-details" open>'));
});

test('boot: Der Takt schreibt die Karte neu, das Auswahlfeld nicht (gleicher Knoten); Kurzzeile nur bei geändertem Inhalt', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  const node = env.sel.querySelector('select');
  assert.ok(node && node.value === 'c172d');
  const nodes0 = env.selectNodes, w = Object.assign({}, env.writesBy);
  env.clock += MIN;                                     // «vor 16 min»: nur die Karte ändert sich
  env.win.LszkPerf._tick();
  assert.equal(env.writesBy['perf-body'], w['perf-body'] + 1, 'Karte mit neuem Alter');
  assert.equal(env.writesBy['perf-sel'], w['perf-sel'], 'Auswahl neu geschrieben');
  assert.equal(env.writesBy['perf-teaser-text'], w['perf-teaser-text'], 'Kurzzeile ohne Änderung neu geschrieben');
  assert.equal(env.sel.querySelector('select'), node);
  // Neuer Messwert mit anderem Ergebnis: Karte und Kurzzeile neu, die Auswahl bleibt derselbe Knoten
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 5 * MIN, tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 }));     // K6
  await settle();
  assert.equal(teaserText(env), 'Cessna 172 Diesel · Wind quer · beide Pisten Rollstrecke: Start 375 m · Landung 288 m');
  assert.ok(env.teaser.innerHTML.includes('<b class="perf-amber">375&nbsp;m</b>'));
  assert.equal(env.writesBy['perf-sel'], w['perf-sel']);
  assert.equal(env.selectNodes, nodes0);
  assert.equal(env.sel.querySelector('select'), node);
  assert.equal(env.box.style.display, 'block');
  assert.equal(env.writesBy['perf-box'], undefined, 'die Box selbst wird nie geschrieben');
});

test('boot: Auf- und Zuklappen der Kurzzeile gemerkt (lszk-perf-open), beim Start wiederhergestellt, Standard zu', async (t) => {
  const env = startBrowser(t);
  await settle();
  assert.equal(env.box.open, false, 'Standard zu');
  assert.equal(typeof env.box.listeners.toggle, 'function');
  env.box.open = true;
  env.box.listeners.toggle();
  assert.equal(env.store['lszk-perf-open'], '1');
  env.box.open = false;
  env.box.listeners.toggle();
  assert.ok(!Object.prototype.hasOwnProperty.call(env.store, 'lszk-perf-open'), 'beim Zuklappen entfernt');
  env.box.open = true;
  env.box.listeners.toggle();
  // nächster Seitenaufruf: offen, bevor die Box erscheint; Neuschreiben von Karte und Kurzzeile lässt sie offen
  const next = fakeBrowser({ store: env.store, initialWx: wxPfa() });
  ui.boot(next.win);
  assert.equal(next.box.open, true, 'nach Neuladen offen');
  await settle();
  assert.equal(next.box.style.display, 'block');
  assert.ok(teaserText(next).includes('Start 331 m') && next.box.open === true);
  assert.equal(next.writesBy['perf-box'], undefined);
  // ohne gespeicherten Zustand zu, ebenso bei einem anderen Wert als '1'; privater Modus (localStorage wirft): kein Fehler, zu
  const closed = fakeBrowser({ initialWx: wxPfa() });
  ui.boot(closed.win);
  assert.equal(closed.box.open, false);
  ['0', 'true', 'ja', ''].forEach((v) => {
    const other = fakeBrowser({ store: { 'lszk-perf-open': v } });
    ui.boot(other.win);
    assert.equal(other.box.open, false, 'gespeichert ' + JSON.stringify(v));
  });
  const priv = fakeBrowser({ storeThrows: true, initialWx: wxPfa() });
  assert.doesNotThrow(() => ui.boot(priv.win));
  assert.equal(priv.box.open, false);
  priv.box.open = true;
  assert.doesNotThrow(() => priv.box.listeners.toggle());
  await settle();
  assert.ok(teaserText(priv).includes('Start 331 m'), 'Kurzzeile im privaten Modus');
});

test('boot: alte Seite aus dem Cache (Karte im Panel, ohne Box und Kurzzeile) – die Karte erscheint und funktioniert', async (t) => {
  const env = startBrowser(t, { oldPage: true });
  await settle();
  assert.equal(env.box, null);
  assert.equal(env.card.style.display, 'none');
  assert.deepEqual(env.content.children.map((c) => c.id), ['perf-sel', 'perf-body']);
  assert.equal(env.card.listeners.toggle, undefined, 'kein toggle auf der Karte');
  env.win.LszkPerf.update(wxPfa());
  assert.equal(env.card.style.display, 'block', 'Karte beim ersten update sichtbar');
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m 625 m'), shown(env));
  assert.ok(env.content.innerHTML.includes('<select id="perf-ac"'));
  choose(env, 'p2010');
  await settle();
  assert.ok(shown(env).includes('Start 409 m 744 m'), shown(env));
  assert.equal(env.store['lszk-perf-aircraft'], 'p2010');
  env.clock += MIN;
  assert.doesNotThrow(() => env.win.LszkPerf._tick());
  assert.doesNotThrow(() => env.win.LszkPerf.update(evilWx()));
  assert.ok(shown(env).includes('Rechenfehler – keine Berechnung.') && !shown(env).includes('744 m'));
  assert.equal(env.store['lszk-perf-open'], undefined);
});

test('boot: Wechsel Cessna ↔ Tecnam, Wahl erst nach erfolgreichem Laden gespeichert', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(env.content.innerHTML.includes('<option value="c172d" selected>'));
  const node = env.sel.querySelector('select'), selWrites = env.writesBy['perf-sel'];
  choose(env, 'p2010');
  // Der Wechsel schreibt das Auswahlfeld nicht neu: derselbe Knoten zeigt die neue Wahl
  assert.equal(env.sel.querySelector('select'), node);
  assert.equal(env.writesBy['perf-sel'], selWrites, 'Auswahl beim Wechsel neu geschrieben');
  assert.equal(node.value, 'p2010', 'Auswahl während des Ladens');
  assert.ok(!shown(env).includes('331 m'), 'Cessna-Zahlen während des Ladens');
  assert.equal(teaserText(env), 'Start- und Landestrecke Lade Flugzeug- und Platzdaten …', 'Kurzzeile während des Ladens');
  assert.ok(!/\d&nbsp;m/.test(env.teaser.innerHTML), 'alte Zahlen in der Kurzzeile während des Ladens');
  assert.ok(shown(env).includes('HB-KMD') && !shown(env).includes('HB-TDA'), 'Unterzeile zeigt die Kennzeichen der neuen Wahl');
  assert.equal(env.store['lszk-perf-aircraft'], undefined);
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'p2010');
  assert.ok(shown(env).includes('Start 409 m 744 m') && shown(env).includes("1'160 kg"), shown(env));
  assert.ok(shown(env).includes('Start · AFM, Section 5, Ziffer 7, Seite APV5-8') && shown(env).includes(ui.TEXT.advice));
  assert.equal(teaserText(env), 'Tecnam P2010 · Piste 30 Rollstrecke: Start 409 m · Landung 423 m');
  assert.equal(env.sel.querySelector('select'), node);
  assert.equal(env.writesBy['perf-sel'], selWrites);
  choose(env, 'c172d');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
  assert.ok(shown(env).includes('Start 331 m 492 m') && shown(env).includes('Start · Supplement, Figure 5-1a (Section 5b), Seite 5b-3') && !shown(env).includes('APV5'));
  assert.ok(teaserText(env).startsWith('Cessna 172 Diesel · Piste 30'));
  env.sel.listeners.change({ target: { id: 'perf-ac', value: '../x' } });
  env.sel.listeners.change({ target: { id: 'anderes', value: 'p2010' } });
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
  assert.equal(env.sel.querySelector('select'), node);
});

test('boot: Wechsel zur Cessna 152 und zurück; die gespeicherte Wahl gilt beim nächsten Start', async (t) => {
  const env = startBrowser(t);
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.equal((env.content.innerHTML.match(/<option /g) || []).length, 3);
  choose(env, 'c152');
  assert.equal(env.sel.querySelector('select').value, 'c152', 'Auswahl während des Ladens');
  assert.ok(!shown(env).includes('331 m'), 'Zahlen der Cessna 172 während des Ladens');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'c152');
  assert.ok(env.fetchUrls.some((u) => u.startsWith('perf/aircraft/c152.json?t=')));
  assert.equal(env.sel.querySelector('select').value, 'c152');
  assert.ok(env.content.innerHTML.includes('<div class="perf-ac-sub" id="perf-ac-sub"><span class="perf-nw">HB-CFA</span> · <span class="perf-nw">HB-CYF</span> · ' +
    '<span class="perf-nw">HB-CYP</span> · 758&nbsp;kg</div>'));
  let s = shown(env);
  assert.ok(s.includes('Start 300 m 521 m 625 m') && s.includes('Landung 219 m 432 m 520 m') && s.includes("758 kg (1'670 lb)") && s.includes('Start · Handbuch, Figure 5-4, Seite 5-11') && s.includes(ui.TEXT.advice), s);
  assert.equal(teaserText(env), 'Cessna 152 · Piste 30 Rollstrecke: Start 300 m · Landung 219 m');
  // nächster Seitenaufruf mit der gespeicherten Wahl: die Auswahl entsteht gleich mit der gespeicherten Wahl
  const next = fakeBrowser({ store: { 'lszk-perf-aircraft': 'c152' }, initialWx: wxPfa() });
  ui.boot(next.win);
  await settle();
  assert.ok(next.content.innerHTML.includes('<option value="c152" selected>Cessna 152</option>'), next.content.innerHTML.slice(0, 400));
  assert.equal(next.sel.querySelector('select').value, 'c152');
  assert.ok(shown(next).includes('Start 300 m 521 m 625 m'));
  assert.ok(teaserText(next).startsWith('Cessna 152 · Piste 30'));
  choose(env, 'c172d');
  await settle();
  s = shown(env);
  assert.equal(env.store['lszk-perf-aircraft'], 'c172d');
  assert.ok(s.includes('Start 331 m 492 m') && s.includes('Start · Supplement, Figure 5-1a (Section 5b), Seite 5b-3') && !s.includes('O-235'), s);
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
  assert.ok(teaserText(env) === 'Cessna 172 Diesel · Piste 30 Rollstrecke: Start 331 m · Landung 265 m' && !env.teaser.innerHTML.includes('perf-t-warn'),
    'Hinweis «Standardmuster gewählt» nur in der Karte');
  const node = env.sel.querySelector('select'), selWrites = env.writesBy['perf-sel'];
  choose(env, 'x');
  assert.equal(node.value, 'x');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], undefined, 'fehlgeschlagene Wahl gespeichert');
  assert.ok(shown(env).includes('Standardmuster gewählt') && shown(env).includes('Start 331 m'));
  // Rückfall auf den Standard: derselbe Knoten, value zurückgesetzt, nicht neu geschrieben
  assert.equal(env.sel.querySelector('select'), node);
  assert.equal(node.value, 'c172d', 'Rückfall auf den Standard setzt value');
  assert.equal(env.writesBy['perf-sel'], selWrites);
  assert.equal(teaserText(env), 'Cessna 172 Diesel · Piste 30 Rollstrecke: Start 331 m · Landung 265 m');
});

test('boot: Flugzeugdatei mit falscher id gilt als nicht ladbar', async (t) => {
  const wrong = Object.assign(clone(P2010), { id: 'c172d' });
  const env = startBrowser(t, { files: { 'perf/aircraft/p2010.json': wrong } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  choose(env, 'p2010');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], undefined);
  assert.ok(shown(env).includes('Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.'), shown(env));
  assert.equal(env.sel.querySelector('select').value, 'c172d');
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
  assert.equal(teaserText(env), 'Start- und Landestrecke Daten nicht verfügbar – keine Berechnung');
  choose(env, 'p2010');
  await settle();
  assert.equal(env.store['lszk-perf-aircraft'], 'p2010');
  assert.ok(shown(env).includes('Start 409 m'));
  assert.ok(teaserText(env).startsWith('Tecnam P2010 · Piste 30 Rollstrecke: Start 409 m'), teaserText(env));
});

test('boot: FGZO-Status mit jedem update; ein fehlgeschlagener Abruf lässt den letzten Stand stehen, der dann altert', async (t) => {
  const wet = fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' });
  const env = startBrowser(t, { files: { 'data/fgzo_status.json': wet } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  const WET = 'Piste gilt als nass: FGZO meldet «STANDING WATER» (Stand 18.11.2026, 10:38).';
  assert.ok(shown(env).includes(WET) && !/gesperrt|Helikopter/.test(shown(env)), shown(env));
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
    assert.ok(shown(env).includes(WET), 'letzter Stand nach Fehler ' + i);
    assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass nach Fehler ' + i);
  }
  // Leerer Satz, Satz nur mit ok:false, Satz mit älterer Abrufzeit (DRY): der gespeicherte Stand bleibt
  const ignored = [{}, { ok: false, error: 'bot challenge', failed_at_utc: new Date(NOW).toISOString() },
    fgzo({ fetched_at_utc: new Date(NOW - 30 * MIN).toISOString() }), fgzo({ fetched_at_utc: NOW })];
  for (const [i, bad] of ignored.entries()) {
    env.files['data/fgzo_status.json'] = bad;
    env.win.LszkPerf.update(wxPfa());
    await settle();
    assert.ok(shown(env).includes(WET), 'letzter Stand nach Satz ' + i);
    assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass nach Satz ' + i);
  }
  // Der Stand altert über fetched_at_utc (14 min alt): nach weiteren 31 min gilt die Meldung als veraltet, weiter nass
  env.clock = NOW + 31 * MIN;
  env.win.LszkPerf.update(wxPfa({ time: env.clock - 10 * MIN }));
  await settle();
  let s = shown(env);
  assert.ok(!/gesperrt|Helikopter|veraltete Meldung/.test(s), s);
  assert.ok(s.includes('Piste gilt als nass: letzte FGZO-Meldung «STANDING WATER» (Stand 18.11.2026, 10:38), Abruf vor 45 min – vorsichtshalber weiter nass gerechnet.'), s);
  assert.ok(s.includes('Start 397 m 590 m') && !s.includes(WET), 'weiter nass, aber als letzte Meldung');
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
  choose(env, 'p2010');
  await settle();
  assert.equal(teaserText(env), 'Start- und Landestrecke Lade Flugzeug- und Platzdaten …');
  choose(env, 'c172d');
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m'));
  slow.resolve(okResponse(P2010));
  await settle();
  assert.ok(shown(env).includes('Start 331 m 492 m') && !shown(env).includes('409 m'), shown(env));
  assert.ok(teaserText(env).startsWith('Cessna 172 Diesel · Piste 30') && !teaserText(env).includes('409'), teaserText(env));
  assert.equal(env.sel.querySelector('select').value, 'c172d');
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
