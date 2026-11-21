// Tests für die Höhen in Fuss (index.html). Wunsch vom 19.11.2026: «Zusätzlich bei LSZK die Höhenangaben in Fuss
// umstellen. Nicht in Meter, aber nur bei LSZK.» Job, Prompt und Datensatz bleiben metrisch («m MSL»); die Seite rechnet
// beim Anzeigen um (aiFtText, aiFeet, aiDabsLevel, aiDabsFtMap), DABS-Grenzen mit dem amtlichen ft-Wert aus dem DABS.
// Grundsatz: Eine Höhe ist entweder richtig in ft umgerechnet oder bleibt richtig in m beschriftet, nie eine m-Zahl mit «ft».
// Der Test schneidet den KI-Hilfsblock aus index.html (wie fgzo-chip.test.js). Fixtures: hoehen_faelle.json (Einzelfälle
// des Planers), hoehen_korpus.json (94 echte Texte aus den Datensätzen 18.11. 15:00 bis 19.11. 15:00 mit Sollausgabe).
// Zwischen Zahl und «ft» schreibt die Seite ein geschütztes Leerzeichen (NBSP, kein Umbruch bei 320 px); die Sollwerte
// stehen mit normalem Leerzeichen da, verglichen wird nach plain(), die NBSP prüfen eigene Tests.
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
const CODE = cut('    // Höhen im Schweizer Format', '    var ai = { data: undefined');
const P = new Function(CODE + '\nreturn { aiFtText: aiFtText, aiFeet: aiFeet, aiDabsFtMap: aiDabsFtMap, aiDabsLevel: aiDabsLevel,' +
  ' aiFtRound: aiFtRound, aiThousands: aiThousands };')();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const MAP = { '2150': 7000, '2750': 9000, '3000': 9850, '9600': 31500 };   // DABS-Paare der Datensätze 18./19.11.
const NBSP = String.fromCharCode(0xa0);                                    // geschütztes Leerzeichen
const plain = (s) => String(s).split(NBSP).join(' ');

function check(input, want, map) {
  const got = P.aiFtText(input, map);
  assert.equal(plain(got), want, 'Eingabe: ' + input);
  // jedes neu geschriebene «ft» hängt mit einem NBSP an der Zahl; NBSP steht nur dort
  assert.equal((got.match(/ ft\b/g) || []).length, (input.match(/ ft\b/g) || []).length, 'normales Leerzeichen vor ft: ' + got);
  assert.equal(got.split(NBSP).length, got.split(NBSP + 'ft').length, 'NBSP nicht vor ft: ' + got);
  assert.equal(P.aiFtText(got, map), got, 'nicht idempotent: ' + got);
}

/* ── (a) Einzelfälle des Planers ── */
test('Einzelfälle: Bereiche, Listen, Klammern, FL, DABS-Satz, Höhenunterschied; idempotent', () => {
  const cases = fixture('hoehen_faelle.json');
  assert.equal(cases.length, 40);
  cases.forEach((c) => check(c[0], c[1], MAP));
  assert.equal(P.aiFtText(null, MAP), '');
  assert.equal(P.aiFtText(undefined), '');
});

/* ── (b) echte Texte ── */
test('Korpus: 94 echte Texte wie erwartet, kein «m MSL» mehr', () => {
  const corpus = fixture('hoehen_korpus.json');
  assert.equal(corpus.length, 94);
  corpus.forEach((c) => {
    const got = P.aiFtText(c.in, c.map);
    assert.equal(plain(got), c.out, c.where);
    assert.ok(!/\d\s*m\s*(?:MSL|AGL)\b/.test(got), 'Rest «m MSL»: ' + c.where);
    assert.ok(!/\d ft\b/.test(got), 'normales Leerzeichen vor ft: ' + c.where);
    assert.equal(got.split(NBSP).length, got.split(NBSP + 'ft').length, 'NBSP nicht vor ft: ' + c.where);
    assert.equal(P.aiFtText(got, c.map), got, 'nicht idempotent: ' + c.where);
  });
});

test('Korpus: DABS-Grenzen im Text mit dem amtlichen ft-Wert, übrige Höhen umgerechnet', () => {
  const corpus = fixture('hoehen_korpus.json');
  const t = corpus.find((c) => c.where === 'ai_status_1500.json text');
  assert.ok(t, 'Text vom 19.11. 15:00 fehlt');
  const out = plain(P.aiFtText(t.in, t.map));
  assert.ok(out.includes("GND bis 9'850 ft MSL"), out);             // DABS 3000m / 9850ft (umgerechnet wären es 9'800)
  assert.ok(out.includes("9'000 ft MSL bis FL130"), out);           // DABS 2750m / 9000ft
  assert.ok(out.includes("Wind auf 4'900 ft MSL um 40 kt"), out);   // Druckfläche genau umgerechnet (E3)
  assert.ok(out.includes("Nullgrad um 5'600–5'900 ft MSL"), out);
  assert.ok(out.includes("Basis um 3'900 ft MSL"), out);
  const t2 = corpus.find((c) => c.where === 'ai_status_8eb1def.json text');
  assert.ok(t2, 'Text vom 18.11. 15:00 fehlt');
  assert.ok(plain(P.aiFtText(t2.in, t2.map)).includes("LSR11A 7'000–31'500 ft MSL aktiv"));   // amtlich, umgerechnet wären es 7'100
});

/* ── (c) Felder und DABS-Liste ── */
test('aiFeet: Felder des Datensatzes in ft MSL, auf 100 ft', () => {
  [[1000, "3'300 ft MSL"], [2000, "6'600 ft MSL"], [900, "3'000 ft MSL"], [1600, "5'200 ft MSL"], [1300, "4'300 ft MSL"],
   [1200, "3'900 ft MSL"], [1800, "5'900 ft MSL"], [1700, "5'600 ft MSL"], [2600, "8'500 ft MSL"], [2200, "7'200 ft MSL"],
   [2100, "6'900 ft MSL"], [3000, "9'800 ft MSL"], [300, "1'000 ft MSL"], [4500, "14'800 ft MSL"]
  ].forEach((c) => assert.equal(P.aiFeet(c[0]), c[1].replace(' ft', NBSP + 'ft'), String(c[0])));
  [null, undefined, '1400', NaN, Infinity, true, {}].forEach((v) => assert.equal(P.aiFeet(v), null, String(v)));
});

test('aiDabsLevel: amtlicher ft-Teil, GND/FL/SFC/UNL und ft-Angaben wie geliefert, reine m-Angabe ≈ auf 10 ft', () => {
  [['3000m / 9850ft', "9'850 ft MSL"], ['9600m / 31500ft', "31'500 ft MSL"], ['2750m / 9000ft', "9'000 ft MSL"],
   ['2150m / 7000ft', "7'000 ft MSL"], ['GND', 'GND'], ['FL130', 'FL130'], ['SFC', 'SFC'], ['UNL', 'UNL'],
   ['5000FT AMSL', "5'000FT AMSL"], ['2000FT AGL', "2'000FT AGL"], ['1350m', "≈ 4'430 ft MSL"], ['', ''],
   ['2150m / 7000ft AMSL', "7'000 ft AMSL"], ['3000M/9850FT', "9'850 ft MSL"], ['1350m AGL', "≈ 4'430 ft AGL"]
  ].forEach((c) => {
    const got = P.aiDabsLevel(c[0]);
    assert.equal(plain(got), c[1], c[0]);
    assert.ok(!/\d ft|≈ /.test(got), 'normales Leerzeichen: ' + c[0]);   // «≈ 4'430 ft» hält mit NBSP zusammen
  });
});

test('aiDabsFtMap: m-Wert -> amtlicher ft-Wert, robust gegen kaputte Datensätze', () => {
  const d = { dabs: { treffer: [null, { unten: 5 }, { unten: 'GND', oben: '3000m / 9850ft' }, { unten: '2150m / 7000ft', oben: 'FL130' }] } };
  assert.equal(JSON.stringify(P.aiDabsFtMap(d)), '{"2150":7000,"3000":9850}');
  [null, undefined, {}, { dabs: null }, { dabs: [] }, { dabs: { treffer: 'x' } }, { dabs: 'x' }]
    .forEach((x) => assert.equal(JSON.stringify(P.aiDabsFtMap(x)), '{}'));
  // ohne Zuordnung wird umgerechnet, mit Zuordnung nur im DABS-Satz der amtliche Wert
  assert.equal(plain(P.aiFtText("DABS: LSD12 GND bis 3'000 m MSL.", {})), "DABS: LSD12 GND bis 9'800 ft MSL.");
  assert.equal(plain(P.aiFtText("DABS: LSD12 GND bis 3'000 m MSL. Gipfel um 3'000 m MSL.", MAP)),
    "DABS: LSD12 GND bis 9'850 ft MSL. Gipfel um 9'800 ft MSL.");
});

/* ── (d) Wächter: keine m-Zahl, die nach der Umrechnung wie ft aussähe ── */
test('Wächter: Zahl ohne Einheit vor, nach oder in einer Gruppe -> ganze Gruppe bleibt in m', () => {
  [
    ["Basis 1'400 bis gegen 1'600 m MSL", "Basis 1'400 bis gegen 1'600 m MSL"],
    ["Basis 1'400 respektive 1'600 m MSL", "Basis 1'400 respektive 1'600 m MSL"],
    ["Basis 1'000 und Gipfel 1'500 m MSL", "Basis 1'000 und Gipfel 1'500 m MSL"],
    ["Kammhöhe von 2'700 und Arbeitshöhe um 2'000 m MSL", "Kammhöhe von 2'700 und Arbeitshöhe um 2'000 m MSL"],
    ["Basis 1'400—1'600 m MSL", "Basis 1'400—1'600 m MSL"],
    ["Basis 1'400, später 1'600 m MSL", "Basis 1'400, später 1'600 m MSL"],
    ["Säntis 2'502, Speer (1'950 m MSL)", "Säntis 2'502, Speer (1'950 m MSL)"],
    ["Basis 1'000 m MSL bis 1'200.", "Basis 1'000 m MSL bis 1'200."],
    ["Basis 1'000 m MSL bis 1'200 im Süden", "Basis 1'000 m MSL bis 1'200 im Süden"],
    ["Basis 1'000 m MSL, Gipfel 2'505 frei.", "Basis 1'000 m MSL, Gipfel 2'505 frei."],
    ["zwischen 1'100 (Bachtel 1'115) und 1'300 m MSL", "zwischen 1'100 (Bachtel 1'115) und 1'300 m MSL"]
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Wächter greifen nicht bei Zahlen mit Einheit oder bei einer folgenden Gruppe', () => {
  [
    ["Basis 1'400 m bis gegen 1'600 m MSL", "Basis 1'400 m bis gegen 5'200 ft MSL"],
    ["zwischen 1'100 (Bachtel 1'115 m) und 1'300 m MSL", "zwischen 3'600 (Bachtel 1'115 m) und 4'300 ft MSL"],
    ["Basis 1'000 m MSL, Gipfel 2'000 bis 2'500 m MSL", "Basis 3'300 ft MSL, Gipfel 6'600 bis 8'200 ft MSL"],
    ["Gipfel 2'000 bis 2'500 m MSL, Basis 1'000 m MSL", "Gipfel 6'600 bis 8'200 ft MSL, Basis 3'300 ft MSL"],
    ["1'000 m MSL bis 1'200 und 1'400 m MSL", "3'300 ft MSL bis 3'900 und 4'600 ft MSL"],
    ["QNH 1013 hPa und Basis 1'000 m MSL", "QNH 1013 hPa und Basis 3'300 ft MSL"],
    ["Basis 1'000 m MSL, QNH 1013 hPa", "Basis 3'300 ft MSL, QNH 1013 hPa"],
    ["(100 % in den nächsten 3 h), Wind auf 1'500 m MSL", "(100 % in den nächsten 3 h), Wind auf 4'900 ft MSL"],
    ["100 % Bedeckung, Basis 600 m über Platz", "100 % Bedeckung, Basis 2'000 ft über Platz"],
    ["Wind 240°, 1'000 m MSL", "Wind 240°, 3'300 ft MSL"],
    ["CAPE bis 500 J/kg, Basis 1'800 m MSL", "CAPE bis 500 J/kg, Basis 5'900 ft MSL"],
    ["Basis 1'000 m MSL bis 1400 LT", "Basis 3'300 ft MSL bis 1400 LT"],
    ["Stand 18.11.2026, Basis 1'000 m MSL", "Stand 18.11.2026, Basis 3'300 ft MSL"],
    ["Speer (1'950 m MSL) und Säntis (2'502 m MSL) frei", "Speer (6'400 ft MSL) und Säntis (8'200 ft MSL) frei"],
    ["Basis um 1'200 m MSL, darüber eine zweite Schicht um 2'000 m MSL.", "Basis um 3'900 ft MSL, darüber eine zweite Schicht um 6'600 ft MSL."],
    ["Wind auf 1'500 m MSL um 20 kt, auf 3'000 m MSL um 40 kt aus Südwest.", "Wind auf 4'900 ft MSL um 20 kt, auf 9'800 ft MSL um 40 kt aus Südwest."],
    ["LSR11 S-chanf 14:00–18:30 LT GND bis 9'600 m MSL", "LSR11 S-chanf 14:00–18:30 LT GND bis 31'500 ft MSL"]
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Sichtweiten bleiben in m, Höhen über Grund/Platz werden umgerechnet', () => {
  [
    ['Sicht 800 m über dem See', 'Sicht 800 m über dem See'],
    ['Bodensicht nur 800 m über dem Talboden', 'Bodensicht nur 800 m über dem Talboden'],
    ["Sicht 800 m, 1'000 m MSL", "Sicht 800 m, 1'000 m MSL"],
    ["Sicht 7 km, Basis 300 m über Platz", "Sicht 7 km, Basis 1'000 ft über Platz"],
    ['Wolkenuntergrenze 400 m über Grund', "Wolkenuntergrenze 1'300 ft über Grund"],
    ['Wolken 50 m über Grund', 'Wolken 50 m über Grund'],                    // unter 100: bleibt, richtig beschriftet
    ["Basis 1'200 m oberhalb des Sees", "Basis 1'200 m oberhalb des Sees"],
    ["Bachtel auf 1'115 m ü. M.", "Bachtel auf 1'115 m ü. M."],
    ['Pistenlänge 600 m, Rollstrecke 300 m', 'Pistenlänge 600 m, Rollstrecke 300 m']
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Bereiche mit «auf» und Höhenunterschiede als Gruppe, FL und AGL', () => {
  [
    ["Nullgrad sinkt von 2'200 auf 1'600 m MSL", "Nullgrad sinkt von 7'200 auf 5'200 ft MSL"],
    ["Prognose: Basis steigt bis 16 Uhr von 1'200 auf 1'800 m MSL.", "Prognose: Basis steigt bis 16 Uhr von 3'900 auf 5'900 ft MSL."],
    ['zwischen 200 und 300 m über Grund', "zwischen 700 und 1'000 ft über Grund"],
    ["300 m unter der Kammhöhe von 2'700 m MSL", "1'000 ft unter der Kammhöhe von 8'900 ft MSL"],
    ["Arbeitshöhe um 2'000 m MSL und damit rund 700 m unter der Kammhöhe.", "Arbeitshöhe um 6'600 ft MSL und damit rund 2'300 ft unter der Kammhöhe."],
    ["FL  130 bis 3'000 m MSL", "FL  130 bis 9'850 ft MSL"],               // Flugfläche auch mit zwei Leerzeichen
    ["DABS: LSD12 GND bis 3'000 m AGL", "DABS: LSD12 GND bis 9'800 ft AGL"],   // AGL nie mit dem amtlichen AMSL-Wert (9'850)
    ["2'750 m MSL bis FL130", "9'000 ft MSL bis FL130"],
    ['Basis 1000m MSL', "Basis 3'300 ft MSL"]
  ].forEach((c) => check(c[0], c[1], MAP));
});

/* ── (d2) Nachbesserung nach der Prüfung (19.11.): kleine Zahl davor, lose Zahl im Satz, Stichwort, Leerzeichen als
   Tausendertrenner, Strecke mit «m über/unter». Grundsatz: nie eine m-Zahl, die neben «ft» steht. ── */
test('Wächter: ein- oder zweistellige Zahl ohne Einheit kurz vor der Gruppe -> Gruppe bleibt in m', () => {
  [
    'Hochnebel zwischen 50 und 150 m über Grund.',
    'Nebelobergrenze 80–150 m über Grund.',
    'Basis 80 bis 150 m AGL.',
    'Wolkenuntergrenze 30, 60 und 150 m über Grund.',
    "Böen 25 und 1'500 m MSL",
    'Thermik reicht ab 600 auf 30 oder 800 m über dem Talboden.',   // die 30 verdeckte früher auch die 600
    'Bodennebel bis 80—100 m AGL.',                                   // Geviertstrich: kein Trenner der Gruppe
    'Hochnebel 30 respektive 400 m über dem See.',
    'Hochnebel 50 bzw. im Süden 150 m über Grund.',
    "Nebel ca. 30 (Bachtel 1'115 m) bis 700 m über dem See.",         // Klammer dazwischen
    'Nebel 50/80–600 m AGL.'
  ].forEach((s) => check(s, s, MAP));
});

test('kleine Zahl: mit Einheit, nach Version/Nr./FL/Piste oder mit Vorzeichen sperrt sie nicht', () => {
  [
    ["Gegenwind auf Piste 12, Basis um 1'000 m MSL", "Gegenwind auf Piste 12, Basis um 3'300 ft MSL"],
    ["Pfützen am Pistenanfang 30, Basis 1'000 m MSL", "Pfützen am Pistenanfang 30, Basis 3'300 ft MSL"],
    ["Piste 12/30 nass, Basis 1'000 m MSL", "Piste 12/30 nass, Basis 3'300 ft MSL"],
    ["Föhn-Index +1, Basis 1'000 m MSL", "Föhn-Index +1, Basis 3'300 ft MSL"],
    ["FL 95 bis 3'000 m MSL", "FL 95 bis 9'850 ft MSL"],
    ["Nr. 3, Basis 1'000 m MSL", "Nr. 3, Basis 3'300 ft MSL"],
    ["Regen in 2 Stunden, Basis 1'000 m MSL", "Regen in 2 Stunden, Basis 3'300 ft MSL"],
    ["Bedeckt (7/8), Basis um 1'000 m MSL", "Bedeckt (7/8), Basis um 3'300 ft MSL"],
    ["Wind 20 kt auf 1'500 m MSL", "Wind 20 kt auf 4'900 ft MSL"],
    ['Basis 50 m und 150 m über Grund', 'Basis 50 m und 500 ft über Grund']
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Satzwächter: lose Zahl ab 100 irgendwo im selben Satz -> der Satz bleibt in m', () => {
  [
    "Basis 1'000 bis 14 Uhr, dann 1'500 m MSL.",
    "Basis 1'400; Gipfel 1'800 m MSL.",
    "Basis 1'400, z. B. am Bachtel 1'100 m MSL.",
    "Basis 1'000 m MSL, ab 14 Uhr 1'500.",
    "Basis 1'400 bzw. im Süden 1'600 m MSL.",                        // Abkürzung beendet keinen Satz
    "Basis 1'400 resp. weiter südlich 1'600 m MSL.",
    "Basis 1'400 bis evtl. 1'600 m MSL.",
    "Basis 900, im Süden 1'200 m MSL.",                              // auch dreistellige Zahlen
    'Hochnebel bis 800 und darüber Fetzen bis 1\'200 m MSL.',
    "Basis 900 bis ca. 13 Uhr, dann 1'200 m MSL.",
    "Gipfel um 2'500; Basis 1'000 m MSL.",
    "Basis 1'000 m MSL; Gipfel um 2'500.",
    "Basis 1'000 m MSL, im Laufe des Nachmittags gegen Süden ansteigend, dort dann 1'500."
  ].forEach((s) => check(s, s, MAP));
  // die Zahl im Satz davor oder danach zählt nicht, ebenso Flugflächen, Zahlen mit Einheit und Folgegruppen
  [
    ["Säntis 2'502: frei. Speer 1'950 m MSL frei.", "Säntis 2'502: frei. Speer 6'400 ft MSL frei."],
    ["Gipfel 2'505 frei. Am 19.11. Basis 1'000 m MSL.", "Gipfel 2'505 frei. Am 19.11. Basis 3'300 ft MSL."],
    ["Basis 1'000 m MSL bis FL 130.", "Basis 3'300 ft MSL bis FL 130."],
    ["Basis 1'000 m MSL, QNH 1013 hPa, Wind 240° mit 10 kt.", "Basis 3'300 ft MSL, QNH 1013 hPa, Wind 240° mit 10 kt."]
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Stichwort einer Nicht-Höhe vor einer Gruppe mit mehreren Zahlen -> Gruppe bleibt in m', () => {
  [
    "QNH 1013, 1'000 m MSL.",
    "CAPE 500, 1'800 m MSL.",
    "Winter 2025/2026, 1'000 m MSL",
    "Wind 240 auf 1'500 m MSL",
    "Wind aus 240 bis 260 auf 1'500 m MSL",
    "Höhenwind 240 auf 3'000 m MSL"
  ].forEach((s) => check(s, s, MAP));
  [
    ["Wind 3'000 m MSL um 40 kt", "Wind 9'800 ft MSL um 40 kt"],
    ["Wind auf 1'500 und 3'000 m MSL um 20 kt", "Wind auf 4'900 und 9'800 ft MSL um 20 kt"],
    ["QNH 1013 hPa, Basis 1'000 m MSL", "QNH 1013 hPa, Basis 3'300 ft MSL"]
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Leerzeichen als Tausendertrenner (auch geschützt oder schmal) -> bleibt in m', () => {
  [' ', NBSP, String.fromCharCode(0x202f), String.fromCharCode(0x2009)].forEach((sp) => {
    ['Basis 1' + sp + '400 m MSL.', 'Basis 1' + sp + '400 bis 1' + sp + '600 m MSL.', 'Nebel 1' + sp + '200 m über Grund.']
      .forEach((s) => assert.equal(P.aiFtText(s, MAP), s, JSON.stringify(s)));
  });
  check("Stand 08:45 1'400 m MSL", "Stand 08:45 4'600 ft MSL", MAP);
  check("am 19.11. 1'400 m MSL", "am 19.11. 4'600 ft MSL", MAP);
});

test('«m über/unter» nur mit Höhenbezug umgerechnet, Strecken bleiben in m', () => {
  [
    'Rollweg auf den ersten 200 m über die Graspiste gesperrt.',
    'Starts nur auf den letzten 400 m über Piste 30.',
    'Rollen 200 m über den Platz hinaus.',                            // «den Platz»: Strecke
    'Die Sicht reicht 800 m über den See.'
  ].forEach((s) => check(s, s, MAP));
  [
    ['Nebel bis 200 m über dem Talboden', "Nebel bis 700 ft über dem Talboden"],
    ['Basis 200 m über dem Platz', 'Basis 700 ft über dem Platz'],   // «dem Platz»: Höhe
    ['Nebel 100 m über dem Zürichsee', 'Nebel 300 ft über dem Zürichsee'],
    ['Thermik bis rund 300 m unter die Gipfel', "Thermik bis rund 1'000 ft unter die Gipfel"],
    ['Kämme rund 200 m über der Basis', 'Kämme rund 700 ft über der Basis'],
    ['Hochnebel 300 m unter den höchsten Gipfeln', "Hochnebel 1'000 ft unter den höchsten Gipfeln"],
    ['Wolken 300 m über der Nebelobergrenze', "Wolken 1'000 ft über der Nebelobergrenze"],
    ["Basis 1'000 m über Meer", "Basis 3'300 ft über Meer"]
  ].forEach((c) => check(c[0], c[1], MAP));
});

test('Geschütztes Leerzeichen zwischen Zahl und «ft» (kein Umbruch «9\'000 | ft» bei 320 px)', () => {
  assert.equal(P.aiFtText("Basis 1'400 m MSL", {}), "Basis 4'600" + NBSP + 'ft MSL');
  assert.equal(P.aiFtText("1'400 m, 1'800 m und 2'600 m MSL", {}), "4'600" + NBSP + "ft, 5'900" + NBSP + "ft und 8'500" + NBSP + 'ft MSL');
  assert.equal(P.aiFtText('rund 300 m unter der Kammhöhe', {}), "rund 1'000" + NBSP + 'ft unter der Kammhöhe');
  assert.equal(P.aiFtText('LSD12 GND bis 3000m / 9850ft MSL', MAP), "LSD12 GND bis 9'850" + NBSP + 'ft MSL');
  assert.equal(P.aiFeet(1400), "4'600" + NBSP + 'ft MSL');
  assert.equal(P.aiDabsLevel('3000m / 9850ft'), "9'850" + NBSP + 'ft MSL');
  assert.equal(P.aiDabsLevel('1350m'), '≈' + NBSP + "4'430" + NBSP + 'ft MSL');
  // die Erkennung bleibt: «ft» mit NBSP gilt als Einheit (kein Satzwächter), der zweite Durchlauf ändert nichts
  const once = P.aiFtText("Basis 1'000 m MSL, Gipfel 2'000 bis 2'500 m MSL.", {});
  assert.equal(plain(once), "Basis 3'300 ft MSL, Gipfel 6'600 bis 8'200 ft MSL.");
  assert.equal(P.aiFtText(once, {}), once);
});

/* ── (e) Zufallsfälle: jede Zahl einer Gruppe umgerechnet, Füllwörter unverändert, idempotent ── */
test('Zufall: 5000 Gruppen mit festem Seed', () => {
  let seed = 4711;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const fmtM = (m) => { let s = String(m); if (m >= 1000) s = s.slice(0, -3) + pick(["'", '', '’', '.']) + s.slice(-3); return s; };
  const FILL = ['Sicht 7 km (Höchi),', 'Wind 5 kt,', 'um 08:45', 'LSR11A', 'Version 2,', 'Föhn-Index +1 hPa,', 'bei 100 %',
    'am 19.11.', 'Basis', 'zwischen 14 und 16 Uhr', 'Regen 0,5 mm,', 'Spreizung 1,5 °C,', 'Wind 240°,', 'FL130'];
  const SEPS = ['–', '-', ' bis ', ' und ', ', ', '/', ' oder ', ' auf '];
  const ENDS = [' m MSL', ' m AGL', ' m über Grund', ' m unter der Kammhöhe'];
  for (let i = 0; i < 5000; i++) {
    const k = 1 + Math.floor(rnd() * 3), each = rnd() < 0.3, apx = rnd() < 0.2 ? pick(['~', '≈ ', 'ca. ', 'rund ']) : '';
    let inp = '', exp = '';
    for (let j = 0; j < k; j++) {
      const m = 100 + Math.floor(rnd() * 4900), sep = j ? (j === k - 1 && k > 2 ? ' und ' : pick(SEPS)) : '';
      inp += sep + (j ? '' : apx) + fmtM(m) + (each && j < k - 1 ? ' m' : '');
      exp += sep + (j ? '' : apx) + P.aiThousands(P.aiFtRound(m)) + (each && j < k - 1 ? ' ft' : '');
    }
    const f1 = pick(FILL), f2 = pick(FILL), end = pick(ENDS);
    const got = P.aiFtText(f1 + ' ' + inp + end + ', ' + f2 + '.', {});
    const want = P.aiFtText(f1, {}) + ' ' + exp + end.replace(' m ', ' ft ') + ', ' + P.aiFtText(f2, {}) + '.';
    if (plain(got) !== want) assert.equal(plain(got), want, 'Fall ' + i);
    if (/\d ft\b/.test(got)) assert.fail('normales Leerzeichen vor ft: ' + got);
    if (P.aiFtText(got, {}) !== got) assert.fail('nicht idempotent: ' + got);
  }
});

/* ── (f) Laufzeit und Maskierung ── */
test('Laufzeit: kein katastrophales Backtracking (unter 200 ms)', () => {
  let big = ''; for (let i = 0; i < 300; i++) big += "1'000 m und ";
  const t0 = Date.now();
  P.aiFtText(big + ' m', {}); P.aiFtText(big + ' m über', {});
  P.aiFtText(new Array(400).join("Basis um 1'400 m MSL, Sicht 7 km. "), MAP);
  P.aiFtText(new Array(300).join("1'000 m MSL bis 1'000 "), {}); P.aiFtText(new Array(300).join('Basis 1000 und '), {});
  P.aiFtText(new Array(200).join("(1'000) und 1'000 m MSL, "), {});
  // ein einziger langer Satz mit vielen Gruppen und Abkürzungen (Satzwächter einmal je Text, nicht je Gruppe)
  P.aiFtText(new Array(300).join("Basis 1'000 m MSL, Gipfel 2'000 m MSL, "), {});
  P.aiFtText(new Array(300).join("ca. 1'000 m MSL bzw. z. B. "), {}); P.aiFtText(new Array(300).join("Basis 1'000, Gipfel 2'000 m MSL, "), {});
  P.aiFtText(new Array(300).join('Nebel 300 m über dem höchsten Talboden, '), {});
  const dt = Date.now() - t0;
  assert.ok(dt < 200, dt + ' ms');
});

test('Umrechnung fügt nur Ziffern, Apostroph und «ft» ein (escHtml folgt danach)', () => {
  assert.equal(plain(P.aiFtText('<b>1400 m MSL</b>', {})), "<b>4'600 ft MSL</b>");
  assert.equal(plain(P.aiFtText('<img src=x onerror=alert(1)> 900 m MSL', {})), "<img src=x onerror=alert(1)> 3'000 ft MSL");
});

/* ── (g) KI-Fenster als Ganzes: aiModalHtml mit gestellter Uhr und einem Datensatz aus echten Texten ── */
test('KI-Fenster: Text, Headline, Regionen, Kameras mit DABS-Zuordnung; Himmel, Thermik und DABS-Liste in ft', () => {
  const NOW = Date.parse('2026-11-19T14:10:00Z');                        // 15:10 in Zürich
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
  }
  const KI = cut('    function escHtml(s) {', '    /* ── Flugplatzstatus FGZO') +
    cut('    /* ── KI-Briefing (data/ai_status.json', '    function aiMetaText()');
  const make = new Function('briefing', 'storeGet', 'FGZO_FRESH_MIN', 'Date',
    KI + '\nreturn function (d) { ai.data = d; return aiModalHtml(); };');
  const corpus = fixture('hoehen_korpus.json');
  const txt = (w) => corpus.find((c) => c.where === 'ai_status_8eb1def.json ' + w).in;
  const iso = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');
  const d = {
    ok: true, generated_at_utc: iso(NOW - 5 * 60000), attempted_at_utc: iso(NOW - 6 * 60000), slot_planned_utc: iso(NOW - 10 * 60000),
    briefing: { lage: 'maessig', headline: "Basis 1'600 m MSL, LSD12 GND bis 3'000 m MSL", text: txt('text'), fgzo_hinweis: '' },
    platz: { flaeche: 'offen', text: 'Platz offen (FGZO-Stand 19.11.2026, 10:20)' },
    himmel: { bedeckung_achtel: 6, wolkenbasis_m: 1600, basis_quelle: 'kombiniert', sicht: 'gut', sicht_km: 21, nebel: 'hochnebel',
      nebel_obergrenze_m: 900, alpen: 'teilweise', schneegrenze_m: 1800, niederschlag: 'in_der_ferne',
      regionen: [{ region: 'voralpen', zustand: txt('region voralpen') }, { region: 'zentralalpen', zustand: 'Sihltal: LSD12 GND bis 3\'000 m MSL.' }] },
    kameras: [{ titel: 'Säntis', satz: txt('kamera Säntis') }, { titel: 'Elm – Schabell', satz: 'DABS: LSD12 GND bis 3\'000 m MSL, Station 2\'015 m MSL.' }],
    thermik: { zusammenfassung: "Prognose: Arbeitshöhe um 2'600 m MSL, Wind auf 3'000 m MSL um 34 kt, Lee beachten.",
      regionen: [{ region: 'urseren', nutzbar: true, von: '12:00', bis: '13:00', arbeitshoehe_m: 2200, basis_m: 2600, blau: false,
        risiko: 'gering', wind700_kt: 34, wind_stark: true }] },
    dabs: { ok: true, datum: '2026-11-19', stand_utc: iso(NOW - 60 * 60000), version: 3, eintraege_total: 40, treffer: [
      { gebiet: 'LSD12', unten: 'GND', oben: '3000m / 9850ft', zeit: '13:00–22:00 LT', text: 'Sihltal' },
      { gebiet: 'LSR11A', unten: '2150m / 7000ft', oben: '9600m / 31500ft', zeit: '14:00–18:30 LT', text: 'S-chanf' },
      { gebiet: 'LSR39B', unten: '2750m / 9000ft', oben: 'FL130', zeit: '14:00–16:00 LT', text: 'Brisen' }] }
  };
  const html = make({}, () => null, 45, FakeDate)(d);
  // keine Zahl mit normalem Leerzeichen vor «ft»: Text, Felder, Thermik und DABS-Liste halten mit NBSP zusammen
  assert.ok(!/\d ft\b/.test(html.replace(/&#39;/g, "'")), 'normales Leerzeichen vor ft: ' + (/.{40}\d ft\b.{10}/.exec(html) || [''])[0]);
  const flat = plain(html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'")).replace(/\s+/g, ' ');
  assert.ok(!/\d\s*m\s*(?:MSL|AGL)\b/.test(flat), 'Rest «m MSL»: ' + (/.{40}\d\s*m\s*(?:MSL|AGL).{10}/.exec(flat) || [''])[0]);
  [
    "Basis 5'200 ft MSL, LSD12 GND bis 9'850 ft MSL",                     // Headline mit DABS-Zuordnung
    "LSR11A 7'000–31'500 ft MSL aktiv", "Wind auf 4'900 ft MSL um 45 kt",  // Text
    "Hirzli-Kette bis 5'700 ft MSL frei", 'Sihltal: LSD12 GND bis 9\'850 ft MSL.',   // Regionen
    "Basis unter 8'200 ft MSL", "DABS: LSD12 GND bis 9'850 ft MSL, Station 6'600 ft MSL.",   // Kameras
    "5'200 ft MSL (kombiniert)", "Hochnebel bis 3'000 ft MSL", "≈ 5'900 ft MSL",              // Himmel
    "Arbeitshöhe ≈ 7'200 ft MSL", "Basis ≈ 8'500 ft MSL", "Wind 9'800 ft MSL 34 kt (zerrissen, Lee)",   // Thermik
    "Prognose: Arbeitshöhe um 8'500 ft MSL, Wind auf 9'800 ft MSL um 34 kt",
    "GND bis 9'850 ft MSL", "7'000 ft MSL bis 31'500 ft MSL", "9'000 ft MSL bis FL130"         // DABS-Liste
  ].forEach((s) => assert.ok(flat.includes(s), 'fehlt: ' + s + '\n' + flat));
});

/* ── (g2) Wolkenbasis-Kachel im Wetter-Panel: Spread × 122 m über Platz 536 m, Anzeige in ft ── */
test('Wolkenbasis-Kachel: Spread × 122 m über Platz 536 m, in ft MSL und ft über Platz, auf 100 ft', () => {
  const WB = cut('      // Wolkenbasis-Schätzung', '      // Föhn-Index-Kachel');
  const run = new Function('temp', 'dewp', CODE + WB + '\nreturn cbHtml;');
  // Spread 10 K: 1'220 m über Platz -> 4'003 ft -> «4'000 ft»; 536 + 1'220 = 1'756 m MSL -> 5'761 ft -> «5'800 ft»
  // (mit 125 m/K wären es «4'100» und «5'900»)
  const h10 = run(15, 5);
  assert.ok(h10.includes(">5'800&nbsp;ft</div>"), h10);
  assert.ok(h10.includes("MSL<br>≈&nbsp;4'000&nbsp;ft über Platz"), h10);
  // Spread 3 K (Beispiel im Plan): «3'000 ft», «≈ 1'200 ft über Platz»
  const h3 = run(10, 7);
  assert.ok(h3.includes(">3'000&nbsp;ft</div>") && h3.includes("≈&nbsp;1'200&nbsp;ft über Platz"), h3);
  assert.equal(run(null, 5), '');
  assert.equal(run(12, null), '');
});

/* ── (h) Thermik-Karte (renderThermik) mit einem warmen Modellprofil ── */
test('Thermik-Karte: Arbeitshöhe und Cu-Basis in ft, Auslösetemperatur weiter für 2000 m gerechnet', () => {
  const RT = cut('    function renderThermik(d) {', '    /* ── Wetterradar LSZK');
  const els = { 'thermik-card': { style: { display: 'none' } }, 'thermik-content': { innerHTML: '' } };
  const run = new Function('document', 'calcSunTimes', 'renderBriefing', 'briefing',
    CODE + RT + '\nreturn renderThermik;')({ getElementById: (id) => els[id] || null }, () => ({ rise: '07:30', set: '17:00' }), () => {}, {});
  const H = 24, at = (f) => Array.from({ length: H }, (x, i) => f(i));
  run({ elevation: 536, hourly: {
    time: at((i) => '2026-11-19T' + String(i).padStart(2, '0') + ':00'),
    temperature_2m: at((i) => (i >= 10 && i <= 16 ? 20 : 8)), dew_point_2m: at(() => 8),
    cloud_cover: at(() => 20), precipitation: at(() => 0),
    geopotential_height_850hPa: at(() => 1500), temperature_850hPa: at(() => 8),
    geopotential_height_700hPa: at(() => 3100), temperature_700hPa: at(() => -4),
    geopotential_height_500hPa: at(() => 5700), temperature_500hPa: at(() => -22) } });
  const html = els['thermik-content'].innerHTML;
  // Basis 536 m + 125 m/K × 12 K = 2'036 m -> 6'700 ft (vorher «~2'000 m»); Thermik trägt höher (Cumulus)
  ['10:00–15:00', "~6'700&nbsp;ft", 'MSL · um 10:00', 'Cumulus', "Cu-Basis ~6'700&nbsp;ft MSL", "Auslösetemp. (6'600&nbsp;ft)",
   '17,1&nbsp;°C', 'erreicht ab ca. 10:00'].forEach((s) => assert.ok(html.includes(s), 'fehlt: ' + s + '\n' + html));
  assert.ok(!/\d&nbsp;m\b/.test(html), 'm-Angabe: ' + html);
});

/* ── (i) statische Prüfungen der übrigen Stellen ── */
test('index.html: Wetter-Panel, Thermik-Karte, Ampel und KI-Fenster zeigen ft', () => {
  ["536 m (1'759 ft)", '400&nbsp;m über Grund', 'aiMeter(', "' m MSL'", "'000 m MSL '", '&nbsp;m über Platz',
   'densAlt / 3.28084', 'fmt100(', "(2'000&nbsp;m)", 'aiSwissAlt((aiMslBand(', 'tsd(f.max_alt)+" m"',
   'tsd(f.max_height)+" m"', 'tsd(af.elevation)+" m"', '&nbsp;m MSL\'', "+ '&nbsp;m',", "mindestens rund 1'300"
  ].forEach((s) => assert.ok(!SRC.includes(s), 'noch vorhanden: ' + s));
  ["Wetter LSZK – Flugplatz Speck · 1'759 ft", 'function aiFeet(', 'function aiDabsFtMap(', 'function aiFtText(',
   'function aiDabsLevel(', "Auslösetemp. (6'600&nbsp;ft)", "mindestens etwa 1'300&nbsp;ft über Grund",
   "aiThousands(aiFtRound(536 + aglM)) + '&nbsp;ft</div>'", ">MSL<br>≈&nbsp;' + aiThousands(aiFtRound(aglM)) + '&nbsp;ft über Platz",
   "'~' + fmtFt(Math.min(best.top, best.lcl)) + '&nbsp;ft'", "'Cu-Basis ~' + fmtFt(best.lcl) + '&nbsp;ft MSL'",
   'function fmtFt(m2) { return aiThousands(aiFtRound(m2)); }',
   "\">Wind ' + aiFeet(3000) + ' ' + w + ' (zerrissen, Lee)","aiDabsLevel(str(t.unten))", "aiDabsLevel(str(t.oben))", 'ftMap = aiDabsFtMap(d)'
  ].forEach((s) => assert.ok(SRC.includes(s), 'fehlt: ' + s));
  // Auslösetemperatur weiter mit 2'000 m MSL gerechnet (nur die Beschriftung ist neu)
  assert.ok(SRC.includes('var eZiel = envT(noon.pts, 2000);') && SRC.includes('DALR * (2000 - elev) - EXC'));
  // Dichtehöhe ohne m-Zeile, Wert weiter in ft
  assert.ok(SRC.includes("aiThousands(densAlt) + '&nbsp;ft</div></div>';"));
  // aiSwiss nur noch in der Definition und in aiFtText; alle KI-Texte laufen über aiFtText
  assert.equal(SRC.split('aiSwiss(').length - 1, 2);
  // seit 21.11.: bei Platzsperre läuft die Headline ohne Sperre (hl) über aiFtText, der Text als «full» (Hinweis + Text)
  ['aiFtText(b.headline', 'aiFtText(hl, ftMap)', 'aiFtText(full, ftMap)', 'aiFtText(r.zustand', 'aiFtText(k.satz', 'aiFtText(t.zusammenfassung']
    .forEach((s) => assert.equal(SRC.split(s).length - 1, 1, s));
  assert.ok(SRC.includes("var full = hint ? hint + ' ' + txt : txt;"));
  ['aiFeet(sky.wolkenbasis_m)', 'aiFeet(sky.nebel_obergrenze_m)', 'aiFeet(sky.schneegrenze_m)', 'aiFeet(r.arbeitshoehe_m)', 'aiFeet(r.basis_m)']
    .forEach((s) => assert.equal(SRC.split(s).length - 1, 1, s));
});

test('KI-Hilfsblock: Browsercode ohne Lookbehind, Pfeilfunktion, ?. und ??', () => {
  assert.ok(!CODE.includes('(?<'), 'Lookbehind');
  assert.ok(!CODE.includes('=>'), 'Pfeilfunktion');
  assert.ok(!CODE.includes('?.'), '?.');
  assert.ok(!CODE.includes('??'), '??');
  assert.ok(!/\b(?:let|const)\s/.test(CODE), 'let/const');
});

test('Hauptskript der Seite lässt sich übersetzen', () => {
  const m = /\n  <script>\r?\n([\s\S]*?)\n  <\/script>/.exec(SRC);
  assert.ok(m, 'Hauptskript nicht gefunden');
  assert.doesNotThrow(() => new Function(m[1]));
});

test('Fluganalyse: Höhen in ft auf 10 ft, Vorlage ohne neuen Backslash oder Platzhalter', () => {
  const a = SRC.indexOf('return `<!DOCTYPE html>'), b = SRC.indexOf('</body></html>`;', a);
  assert.ok(a > 0 && b > a, 'Vorlage nicht gefunden');
  const tpl = SRC.slice(a, b);
  assert.equal(tpl.split('\\').length - 1, 1, 'Backslash (nur <\\/script>)');
  assert.deepEqual((tpl.match(/\$\{[^}]*\}/g) || []).sort(), ['${icaoJs}'].concat(new Array(6).fill('${icao}')).sort());
  const build = new Function(cut('    function buildFlightsHtml(icao) {', '    // Blob-URL für jeden') + '\nreturn buildFlightsHtml;')();
  const html = build('LSZK');
  const s = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(s, 'Skript der Fluganalyse fehlt');
  assert.doesNotThrow(() => new Function(s[1]), 'Skript der Fluganalyse nicht übersetzbar');
  ['tsd(Math.round(af.elevation/0.3048/10)*10)+" ft"', 'tsd(Math.round(f.max_height/0.3048/10)*10)+" ft"',
   'tsd(Math.round(f.max_alt/0.3048/10)*10)+" ft"'].forEach((x) => assert.ok(s[1].includes(x), 'fehlt: ' + x));
  // tsd und esc aus der erzeugten Seite: OGN-Platzhöhe 534 m -> «1'750», 2'952 m -> «9'690»
  const fns = /function tsd\(v\)\{[^\n]*\}\r?\nfunction esc\(s\)\{[^\n]*\}/.exec(s[1]);
  assert.ok(fns, 'tsd/esc nicht gefunden');
  const tsd = new Function(fns[0] + '\nreturn tsd;')();
  const ft = (m) => tsd(Math.round(m / 0.3048 / 10) * 10);
  assert.equal(ft(534), "1'750");
  assert.equal(ft(2952), "9'690");
  assert.equal(ft(418), "1'370");
});
