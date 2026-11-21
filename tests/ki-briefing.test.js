// Tests für das KI-Fenster (index.html), Wünsche des Benutzers vom 21.11.2026:
// – Platz gesperrt: «Es steht 3 Mal Platz gesperrt … einmal prominent dargestellt reicht.» Die Sperre steht nur noch im
//   roten Kasten ganz oben; Headline und Text ohne die wiederholte Sperre am Anfang, kein Statuskasten «Lage für Lokalflüge».
// – DABS: Version 1 eines Tages erscheint am Vortag, gilt aber für den Tag («Gültig für heute, Sa 21.11.»); ein leeres
//   DABS heisst «keine Einschränkung durch das DABS» (grüne Zeile), statt zweier unlesbarer Einträge.
// – Fuss des Fensters: rote Zeile «Diese Information ersetzt keine Flugplanung.»
// Der Test schneidet den KI-Block aus index.html (wie hoehen-ft.test.js) und rechnet mit gestellter Uhr.
// Aufruf im Repo-Root: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function cut(from, to) {
  const a = SRC.indexOf(from);
  if (a < 0 || SRC.indexOf(from, a + 1) >= 0) throw new Error('Anker in index.html fehlt oder ist nicht eindeutig: ' + from);
  const b = SRC.indexOf(to, a);
  if (b < 0) throw new Error('Endanker in index.html fehlt: ' + to);
  return SRC.slice(a, b);
}
const KI = cut('    function escHtml(s) {', '    /* ── Flugplatzstatus FGZO') +
  cut('    /* ── KI-Briefing (data/ai_status.json', '    function aiMetaText()');
const NOW = Date.parse('2026-11-21T07:12:00Z');                 // Sa 21.11.2026, 08:12 in Zürich (wie die Bilder des Benutzers)
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}
// briefing = Ampel-Daten der Seite (briefing.platz = aktueller FGZO-Stand), wie im Browser
function env(briefing) {
  return new Function('briefing', 'storeGet', 'FGZO_FRESH_MIN', 'Date', KI +
    '\nreturn { modal: function (d) { ai.data = d; return aiModalHtml(); }, ohne: aiOhneSperre, box: aiSperreBox, dabs: aiDabsHtml };')(
    briefing || {}, () => null, 45, FakeDate);
}
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');
const MIN = 60000;
const PLATZ_ZU = { flaeche: 'gesperrt', grund: 'nur Helikopterbetrieb',
  text: 'Platz für Flächenflugzeuge gesperrt – nur Helikopterbetrieb erlaubt (FGZO-Stand 20.11.2026, 23:04)' };
const PLATZ_OFFEN = { flaeche: 'offen', grund: null, text: 'Platz offen, LOW TRAFFIC, Piste DRY (FGZO-Stand 21.11.2026, 07:40)' };
// echte Texte des Briefings vom 21.11. 08:07 (Bild LSZK_1 des Benutzers)
const HL_ZU = "Platz gesperrt (nur Heli), Basis um 1'100 m MSL, Regen";
const TX_ZU = 'Platz gesperrt: nur Helikopterbetrieb; am Platz weht Wind aus Südwest mit 4 kt, Böen bis 8 kt. ' +
  "Der Himmel ist bedeckt mit einer Basis um 1'100 m MSL.";
function record(over) {
  return Object.assign({
    ok: true, generated_at_utc: iso(NOW - 5 * MIN), attempted_at_utc: iso(NOW - 6 * MIN), slot_planned_utc: iso(NOW - 6 * MIN),
    briefing: { lage: 'maessig', headline: HL_ZU, text: TX_ZU, fgzo_hinweis: '' }, platz: PLATZ_ZU,
    himmel: { bedeckung_achtel: 8, wolkenbasis_m: 1100, basis_quelle: 'kombiniert', sicht: 'maessig', sicht_km: 17, nebel: 'kein',
      alpen: 'verhangen', niederschlag: 'am_platz', regionen: [] },
    kameras: [],
    dabs: { ok: true, datum: '2026-11-21', version: 1, stand_utc: '2026-11-20T14:31:00+00:00', eintraege_total: 0, leer: true, treffer: [],
      filter: 'Fluggebiet LSZK–Säntis–Flüela–Julier–Gotthard–Mythen mit 15 km Marge, Untergrenze unter FL150, bis 30 min nach Sonnenuntergang' }
  }, over);
}
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const count = (s, part) => s.split(part).length - 1;
// Seite: Apostroph als &#39; (escHtml), geschütztes Leerzeichen vor «ft» (aiFtText); verglichen wird lesbar
const n = (h) => h.replace(/&#39;/g, "'").split(String.fromCharCode(0xa0)).join(' ');

test('Sperre im Briefing: einmal, ganz oben, rot; Headline und Text ohne die Sperre; kein Kasten «Lage für Lokalflüge»', () => {
  const html = env().modal(record());
  const t = text(html);
  assert.equal(count(t.toLowerCase(), 'gesperrt'), 1, t);
  assert.equal(count(html, '<div class="ai-sperre">'), 1);
  assert.ok(html.indexOf('<div class="ai-sperre">') < html.indexOf('<div class="ai-headline">'), 'Sperre vor der Headline');
  assert.ok(html.includes('<div class="ai-sperre"><div class="ai-sperre-titel"><span class="brf-dot" style="background:#ef4444"></span>' +
    '<span>Platz für Flächenflugzeuge gesperrt</span></div><div class="ai-sperre-sub">nur Helikopterbetrieb erlaubt · FGZO-Stand 20.11.2026, 23:04</div></div>'), html);
  assert.ok(n(html).includes("<div class=\"ai-headline\"><span>Basis um 3'600 ft MSL, Regen</span></div>"), 'Headline ohne Sperre, ohne Punkt');
  assert.ok(t.includes("Am Platz weht Wind aus Südwest mit 4 kt, Böen bis 8 kt. Der Himmel ist bedeckt mit einer Basis um 3'600 ft MSL."), t);
  assert.ok(!html.includes('ai-status" style="border-left-color:#ef4444') && !t.includes('Lage für Lokalflüge') && !t.includes('nicht möglich'), t);
  assert.ok(!t.includes('Helikopterbetrieb;') && count(t, 'Helikopterbetrieb') === 1, t);
});

test('Sperre erst nach dem Briefing laut FGZO: Kasten «Aktuell laut FGZO», aktueller Stand; Text des offenen Briefings bleibt', () => {
  const fz = { flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', updated: '21.11.2026, 07:55', fetched_at_utc: iso(NOW - 4 * MIN) };
  const html = env({ platz: fz }).modal(record({ platz: PLATZ_OFFEN,
    briefing: { lage: 'gut', headline: "Basis um 1'800 m MSL", text: 'Wind schwach. Sicht 40 km.', fgzo_hinweis: 'FGZO-Hinweis: Rollweg C gesperrt.' } }));
  assert.ok(html.includes('<span>Aktuell laut FGZO: Platz für Flächenflugzeuge gesperrt</span></div><div class="ai-sperre-sub">nur Helikopterbetrieb erlaubt · FGZO-Stand 21.11.2026, 07:55</div>'), html);
  assert.ok(n(html).includes("<div class=\"ai-headline\"><span>Basis um 5'900 ft MSL</span></div>"), n(html));
  assert.ok(!html.includes('Rollweg'), 'kein FGZO-Hinweis zum Flugbetrieb bei Sperre');
  assert.ok(text(html).includes('Wind schwach. Sicht 40 km.'));
  // Briefing und FGZO gesperrt: aktueller FGZO-Stand im Kasten, kein «Aktuell laut FGZO»
  const both = env({ platz: fz }).modal(record());
  assert.ok(both.includes('<span>Platz für Flächenflugzeuge gesperrt</span>') && both.includes('FGZO-Stand 21.11.2026, 07:55') && !both.includes('Aktuell laut'), both);
  // FGZO-Stand älter als 45 min: zählt nicht als aktuelle Sperre
  const alt = env({ platz: Object.assign({}, fz, { fetched_at_utc: iso(NOW - 50 * MIN) }) }).modal(record({ platz: PLATZ_OFFEN }));
  assert.ok(!alt.includes('ai-sperre') && alt.includes('Lage für Lokalflüge: mässig'), alt);
});

test('Offener Platz unverändert: Headline mit Lage-Punkt, Statuskasten mit Platzzeile und «Lage für Lokalflüge»', () => {
  const html = env().modal(record({ platz: PLATZ_OFFEN, briefing: { lage: 'maessig', headline: "Bedeckt, Basis um 1'100 m MSL",
    text: 'Platz offen, LOW TRAFFIC, Piste DRY. Wind aus Südwest mit 4 kt.', fgzo_hinweis: '' } }));
  assert.ok(n(html).includes("<div class=\"ai-headline\"><span class=\"brf-dot\" style=\"background:#f59e0b\"></span><span>Bedeckt, Basis um 3'600 ft MSL</span></div>"), html);
  assert.ok(html.includes('<div class="ai-status" style="border-left-color:#10b981"><div class="ai-st-row"><span class="brf-dot" style="background:#10b981"></span>' +
    '<span>Platz offen, LOW TRAFFIC, Piste DRY <span class="ai-muted">(FGZO-Stand 21.11.2026, 07:40)</span></span></div>'), html);
  assert.ok(html.includes('<span>Lage für Lokalflüge: mässig</span>') && !html.includes('ai-sperre'));
  assert.ok(text(html).includes(' Wind aus Südwest mit 4 kt.') && !text(html).includes('Piste DRY. Wind'), 'Platzzeile im Text nicht doppelt');
});

test('Noch kein Briefing, aber Platz laut FGZO gesperrt: derselbe rote Kasten', () => {
  const fz = { flaeche: 'gesperrt', flaeche_grund: 'geschlossen', updated: '21.11.2026, 07:55', fetched_at_utc: iso(NOW - MIN) };
  const html = env({ platz: fz }).modal(null);
  assert.ok(html.includes('<span>Aktuell laut FGZO: Platz geschlossen</span></div><div class="ai-sperre-sub">FGZO-Stand 21.11.2026, 07:55</div>'), html);
  assert.ok(html.includes('Noch kein KI-Briefing vorhanden.') && !html.includes('Lokalflüge nicht möglich'));
});

test('aiOhneSperre: nur die Sperre am Anfang weg, sonst nichts; im Zweifel unverändert', () => {
  const o = env().ohne;
  [ // Headline (satz = false)
    ["Platz gesperrt (nur Heli), bedeckt, Basis um 1'100 m MSL", "Bedeckt, Basis um 1'100 m MSL"],
    ['Platz gesperrt: Hochnebel bis 900 m MSL', 'Hochnebel bis 900 m MSL'],          // Sicherheitsnetz des Jobs
    ['Platz gesperrt: nur Heli, Regen', 'Regen'], ['Platz gesperrt – nur Helikopterbetrieb erlaubt', ''],
    ['Platz gesperrt', ''], ['Platz gesperrt (nur Heli)', ''], ['platz geschlossen, Nebel', 'Nebel'],
    ['Platz gesperrtes Gelände', 'Platz gesperrtes Gelände'], ['Hochnebel, Platz gesperrt', 'Hochnebel, Platz gesperrt'],
    [undefined, ''], [null, ''], [42, '']
  ].forEach(([i, w]) => assert.equal(o(i, false), w, String(i)));
  [ // Text (satz = true)
    ['Platz gesperrt: nur Helikopterbetrieb. Am Platz bedeckt.', 'Am Platz bedeckt.'],
    ['Platz gesperrt: nur Helikopterbetrieb; am Platz weht Wind.', 'Am Platz weht Wind.'],
    ['Platz für Flächenflugzeuge gesperrt, nur Helikopterbetrieb erlaubt. Wind 4 kt.', 'Wind 4 kt.'],
    ['Der Platz ist für Flächenflugzeuge gesperrt (nur Helikopter). Wind 4 kt.', 'Wind 4 kt.'],
    ['Platz gesperrt: siehe fgzo.ch. Wind 4 kt.', 'Wind 4 kt.'], ['Platz gesperrt: geschlossen. Wind 4 kt.', 'Wind 4 kt.'],
    ['Platz gesperrt, Wind 270° mit 9 kt.', 'Wind 270° mit 9 kt.'], ['Platz gesperrt: nur Helikopterbetrieb.', ''],
    ['Platz gesperrt: Nässe, nur Helikopterbetrieb. Wind 4 kt.', 'Platz gesperrt: Nässe, nur Helikopterbetrieb. Wind 4 kt.'],
    ['Wind 4 kt, Platz gesperrt.', 'Wind 4 kt, Platz gesperrt.'], ['Platzrunde gesperrt. Wind.', 'Platzrunde gesperrt. Wind.']
  ].forEach(([i, w]) => assert.equal(o(i, true), w, i));
});

test('Sperre-Text maskiert (Grund und Stand stammen aus Daten)', () => {
  const h = env().box('<img src=x>', '"><b>', true);
  assert.ok(!h.includes('<img') && !h.includes('"><b>') && h.includes('&lt;img src=x&gt;') && h.includes('&quot;&gt;&lt;b&gt;'), h);
  assert.ok(env().box('nur Helikopterbetrieb', '', false).endsWith('<div class="ai-sperre-sub">nur Helikopterbetrieb erlaubt</div></div>'));
  assert.ok(!env().box(null, '', false).includes('ai-sperre-sub'));
});

test('DABS leer (21.11.: «There are no planned activities»): Kopf mit Gültigkeitstag, grüne Zeile, Fusszeile ohne Zähler', () => {
  const html = env().dabs(record(), new FakeDate());
  assert.ok(html.includes('<div class="ai-row"><b>Gültig für heute, Sa 21.11.</b> · Version 1, herausgegeben am Vortag (20.11. 15:31 LT)</div>'), html);
  assert.equal(count(html, '<span>Keine Einträge im DABS – keine Einschränkung durch das DABS.</span>'), 1);
  assert.ok(html.endsWith('<div class="brf-src">neue Versionen um 09:00, 13:00 und 16:00 LT · LT = Lokalzeit</div>'), html);
  assert.ok(!html.includes('0 von 0') && !html.includes('Stand Version') && !html.includes('Keine DABS-Einträge im Fluggebiet'));
  assert.ok(html.includes('<b>Nur eine erste Richtung, ersetzt kein DABS-Briefing.</b>'), 'Pflichthinweis bleibt');
  // «keine Einschränkung» nur, wenn das DABS selbst leer meldet (leer === true vom Job, Befund 1 des Prüfers):
  // 0 Einträge ohne diese Meldung, leer als Text/Zahl oder leer trotz Einträgen -> neutrale Zeile wie bisher
  [{ leer: undefined }, { leer: false }, { leer: 'true' }, { leer: 1 }, { leer: true, eintraege_total: 3 }].forEach((o) => {
    const h = env().dabs(record({ dabs: Object.assign({}, record().dabs, o) }), new FakeDate());
    assert.ok(!h.includes('Keine Einträge im DABS') && h.includes('Keine DABS-Einträge im Fluggebiet gefunden.'), JSON.stringify(o) + ' ' + h);
  });
});

test('DABS-Fusszeile: Filtertext maskiert; Text nur aus dem Sperrsatz ergibt keinen leeren Textblock', () => {
  const d = record({ dabs: Object.assign({}, record().dabs, { leer: false, eintraege_total: 4, filter: '<img src=x onerror=alert(1)>' }) });
  const h = env().dabs(d, new FakeDate());
  assert.ok(!h.includes('<img') && h.includes('&lt;img src=x onerror=alert(1)&gt;'), h);
  const m = env().modal(record({ briefing: { lage: 'schlecht', headline: 'Platz gesperrt (nur Heli)', text: 'Platz gesperrt: nur Helikopterbetrieb.', fgzo_hinweis: '' } }));
  assert.ok(!m.includes('<div class="ai-text"></div>') && !m.includes('<div class="ai-headline">'), 'kein leerer Text- oder Headline-Block');
  assert.equal(count(text(m).toLowerCase(), 'gesperrt'), 1);
});

test('DABS mit Treffern: Kopf «herausgegeben 08:45 LT», Liste, Zähler und Filter in der Fusszeile', () => {
  const d = record({ dabs: { ok: true, datum: '2026-11-21', version: 2, stand_utc: '2026-11-21T07:45:00+00:00', eintraege_total: 12,
    filter: 'Fluggebiet X', treffer: [{ gebiet: 'LSR14', notam: 'W1/26', zeit: '08:00–15:00 LT', unten: 'GND', oben: '3000m / 9850ft', text: 'MIL UAV', karte: true, unsicher: false }] } });
  const html = env().dabs(d, new FakeDate());
  assert.ok(html.includes('<b>Gültig für heute, Sa 21.11.</b> · Version 2, herausgegeben 08:45 LT</div>'));
  assert.ok(n(html).includes("<b>LSR14 · W1/26</b> 08:00–15:00 LT · GND bis 9'850 ft MSL<br>MIL UAV</div>") && !html.includes('Keine Einträge im DABS'), n(html));
  assert.ok(html.endsWith('<div class="brf-src">1 von 12 Einträgen · Fluggebiet X · neue Versionen um 09:00, 13:00 und 16:00 LT · LT = Lokalzeit</div>'), html);
  // keine Treffer im Fluggebiet: wie bisher «Keine DABS-Einträge im Fluggebiet gefunden.», nicht «leer»
  const ohne = env().dabs(record({ dabs: Object.assign({}, d.dabs, { treffer: [] }) }), new FakeDate());
  assert.ok(ohne.includes('Keine DABS-Einträge im Fluggebiet gefunden.') && ohne.includes('0 von 12 Einträgen') && !ohne.includes('Keine Einträge im DABS'), ohne);
  // nicht auswertbar, nicht von heute, Altformat ohne eintraege_total: ohne Kopf bzw. ohne «leer»
  assert.ok(!env().dabs(record({ dabs: { ok: false } }), new FakeDate()).includes('Gültig für'));
  assert.ok(env().dabs(record({ dabs: Object.assign({}, d.dabs, { datum: '2026-11-20' }) }), new FakeDate()).includes('nicht von heute'));
  assert.ok(!env().dabs(record({ dabs: Object.assign({}, d.dabs, { eintraege_total: undefined, treffer: [] }) }), new FakeDate()).includes('Keine Einträge im DABS'));
});

test('Fuss des KI-Fensters: rote Zeile «Diese Information ersetzt keine Flugplanung.»', () => {
  const note = /<div class="brf-note">\s*<strong>KI-generiert[\s\S]*?<\/div>/.exec(SRC)[0];
  assert.ok(/eigene Beobachtung\.\s*<span class="ai-pflicht">Diese Information ersetzt keine Flugplanung\.<\/span>\s*<\/div>$/.test(note), note);
  assert.ok(SRC.includes('.brf-note .ai-pflicht { display: block; margin-top: 4px; color: #f87171; font-weight: 700; }'));
  assert.ok(!SRC.includes('aiSperreText(') && !SRC.includes("'nicht möglich'"), 'alte Sperrzeilen entfernt');
});
