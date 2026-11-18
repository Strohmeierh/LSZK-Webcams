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

/* ── Anzeige Cessna ────────────────────────────────────────── */

test('Cessna trocken (K2): Auswahl, Kopf, Messwerte, nur Gegenwindpiste, Zustand, Fusszeile', () => {
  const html = render(wxPfa());
  assertClean(html, 'K2');
  const t = text(html);
  assert.ok(html.includes('<label class="perf-ac-label" for="perf-ac">Flugzeug</label><select id="perf-ac" class="perf-select">'));
  assert.ok(html.includes('<option value="c172d" selected>Cessna 172 Diesel · HB-TDA, HB-TDB, HB-TDC, HB-TDD</option><option value="p2010">Tecnam P2010 · HB-KMD</option>'), html);
  assert.ok(t.includes("Maximales Abfluggewicht 1'157 kg (2'550 lb) · Kurzstart- und Kurzlandetechnik · Motor TAE 125-02-114, Propeller MTV-6-A/190-69"), t);
  assert.ok(t.includes("Messwerte MeteoSchweiz Pfäffikon ZH, 09:00 Uhr (vor 15 min): 15,0 °C · QNH 1018,0 hPa · Wind 290° / 8 kt, Böen 14 kt · Druckhöhe 1'630 ft"), t);
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
  assert.ok(t.includes('Wind aus 290°: Gegenwindkomponente 7,76 kt aus dem Mittelwind 8,0 kt, abgerundet 7 kt.'), t);
  assert.ok(t.includes('Piste 12: Wind aus 290°, Rückenwindkomponente 7,76 kt aus dem Mittelwind – nicht berechnet.'), t);
  ['Start (Supplement): Ground Roll and Take-Off Distance at 1157 kg (2550 lbs), Short Field Takeoff, Figure 5-1a (Section 5b), Seite 5b-3.',
    'Landung (Grundhandbuch): Short Field Landing Distance at 2550 Pounds, Figure 5-11, Seite 5-24.',
    'Doc.-No. 20-0310-22122', 'EASA STC 10014287', '172SIMBUS-00', 'Seitenkennung 172SPHBUS-00',
    C172D.readingRuleDe + ' Rundung immer zur längeren Strecke', 'Gerechnet wird nur die Piste mit Gegenwind',
    'Nasse Piste: Die Piste gilt als nass', 'AD INFO 1 LSZK'].forEach((s) => assert.ok(t.includes(s), 'fehlt: ' + s));
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

/* ── Pistenwahl, Feststellungen ────────────────────────────── */

test('Pistenwahl: windstill, ohne Richtung, quer, Gegenwind unter 1 kt, Richtung fehlt bei starkem Wind', () => {
  let html = render(wxPfa({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0, gustKt: null }));        // K5
  assert.ok(has(html, 'Windstill (Mittelwind unter 1 kt): keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet.'));
  assert.ok(has(block(html, '12'), 'Piste 12 · ohne Windkorrektur') && has(block(html, '30'), 'Piste 30 · ohne Windkorrektur'));
  assert.ok(text(block(html, '12')).includes('Start 352 m 525 m 520 m'));
  assert.ok(!has(html, 'Böen'), 'ohne Böe keine Böenangabe');
  html = render(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 }));                               // K12
  assert.ok(has(html, 'Windrichtung nicht gemeldet: keine Gegenwindpiste bestimmbar. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.'));
  assert.ok(has(html, 'Wind 2 kt, Richtung unbestimmt, Böen 14 kt'));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 214, windKt: 10 }));                              // K6
  assert.ok(has(html, 'Wind genau quer zur Piste: keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.'));
  assert.ok(block(html, '12') && block(html, '30'));
  assert.ok(has(html, 'Wind aus 214°: genau quer zur Piste, keine Längskomponente.'));
  html = render(wxPfa({ tempC: 25, qnhHpa: 1015, windDir: 215, windKt: 10 }));                              // K17
  assert.ok(has(block(html, '30'), 'Piste 30 · Gegenwind unter 1 kt, nicht angerechnet'));
  assert.equal(block(html, '12'), null);
  assert.ok(!has(html, 'Wind genau quer zur Piste: keine Gegenwindpiste'));
  assert.ok(has(html, 'Wind aus 215°: Gegenwindkomponente 0,17 kt aus dem Mittelwind 10,0 kt, abgerundet 0 kt.'), text(html));
  html = render(wxPfa({ windDir: null, windKt: 6 }));                                                       // K12b
  assert.ok(has(html, 'Windrichtung fehlt bei 6 kt Wind: Die Gegenwindpiste lässt sich nicht bestimmen – keine Berechnung.'));
  assertNoResult(html, 'K12b');
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
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', fetched_at_utc: new Date(NOW - 45 * MIN).toISOString() }) });
  assert.ok(!html.includes('gesperrt'), 'veraltete Sperre');
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER' }) });
  assert.ok(html.includes('<div>Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).</div><div>Piste gilt als nass: FGZO meldet «STANDING WATER»'));
});

/* ── Escaping ──────────────────────────────────────────────── */

test('Escaping: Quelle, FGZO, Auswahl, Kennzeichen, Texte aus den Daten, Seitenkennung, Hinweis', () => {
  const evil = '<img src=x onerror=y>';
  let html = render(wxPfa({ srcLabel: evil }), { fgzo: fgzo({ runway_condition: evil, updated: '<b>7</b>' }) });
  assert.ok(!html.includes('<img') && !html.includes('<b>'));
  assert.ok(html.includes('&lt;IMG SRC=X ONERROR=Y&gt;') && html.includes('&lt;img src=x onerror=y&gt;'));
  html = render(wxPfa(), { fgzo: fgzo({ updated: '<b onclick=x>7</b>' }) });
  assert.ok(html.includes('Pistenzustand laut FGZO: DRY (Stand &lt;b onclick=x&gt;7&lt;/b&gt;).'));
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

test('Format: QNH ohne Tausendertrenner, Druckhöhe aufgerundet, Zwischenwerte auf 0,01 aufgerundet', () => {
  let t = text(render(wxPfa({ tempC: 3, qnhHpa: 1022, windDir: null, windKt: 2 })));
  assert.ok(t.includes('QNH 1022,0 hPa') && !t.includes("1'022"), t);
  t = text(render(wxPfa({ tempC: 8, qnhHpa: 1020, windDir: 110, windKt: 3 })));          // PA 1575,15
  assert.ok(t.includes("Druckhöhe 1'576 ft") && !t.includes("1'575"), t);
  assert.deepEqual([ui.fmtUp2(396.576), ui.fmtUp2(589.644), ui.fmtUp2(264.99312), ui.fmtUp2(284.58000000000004), ui.fmtUp2(45.9)],
    ['396,58', '589,65', '265', '284,58', '45,9']);
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
  [C172D, P2010].forEach((ac) => [null, 0, 34, 124, 214, 304].forEach((dir) => [0, 0.6, 2, 8.7, 22, 45].forEach((kt) => [-30, 0, 10.8, 25.1, 39.9].forEach((t) => {
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

test('boot: FGZO-Status mit jedem update, Sperre und Nässe', async (t) => {
  const env = startBrowser(t, { files: { 'data/fgzo_status.json': fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER' }) } });
  await settle();
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(shown(env).includes('Platz laut FGZO für Flächenflugzeuge gesperrt (nur Helikopterbetrieb).'));
  assert.ok(shown(env).includes('Start 397 m 590 m'), 'nass gerechnet');
  env.files['data/fgzo_status.json'] = undefined;
  env.win.LszkPerf.update(wxPfa());
  await settle();
  assert.ok(!shown(env).includes('gesperrt'));
  assert.ok(shown(env).includes('Start 331 m 492 m'), 'ohne FGZO und ohne Regen trocken');
});
