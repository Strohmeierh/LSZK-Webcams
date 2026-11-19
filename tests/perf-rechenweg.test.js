// Tests für den Rechenweg der Karte (perf/perf-ui.js: Schritt-Tabellen unter «Rechenweg und Quellen»), den Pflichthinweis
// und die aus der Karte entfernten Teile (Zeile zur Rückenwindpiste, Sperrmeldung der FGZO, lange Fusszeile).
// Grundsatz: Jede Zahl im Rechenweg stammt aus der Rechnung. Geprüft wird (A) die Tabellenablesung gegen die Flugzeugdaten
// und das Ergebnis gegen core.compute, die Kontrollfälle und die Pistentabelle der Karte, (B) jede Zeile aus der vorigen
// nachgerechnet (BigInt, exakt; letzter Wert vor dem Aufrunden auf 0,01 aufgerundet).
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
const LIST = ui.parseIndex(readJson('perf/aircraft/index.json')).list;
const CASES = readJson('tests/fixtures/kontrollfaelle.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

// 18.11.2026, 09:15 Uhr in Zürich (wie tests/perf-ui.test.js)
const NOW = Date.UTC(2026, 10, 18, 8, 15);
const MIN = 60000;
const OLD = new Date(NOW - 54 * MIN).toISOString();
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
function text(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}
function block(html, id) {
  const start = html.indexOf('<section class="perf-block" aria-label="Piste ' + id + '">');
  if (start < 0) return null;
  return html.slice(start, html.indexOf('</section>', start) + 10);
}
function pavedTestField(elevFt) {
  return { schema: 2, icao: 'TEST', elevation: { value: elevFt, unit: 'ft' },
    runways: [{ id: '36', bearingTrue: 360, bearingMag: 360, surface: 'paved', takeoffAvailable: { value: 1070, unit: 'm' }, landingAvailable: { value: 915, unit: 'm' } }] };
}
const FOOT = '<div class="perf-foot">' + ui.TEXT.advice + '</div>';
const calcOf = (html) => { const m = /<details class="perf-details".*<\/details>/.exec(html); return m ? m[0] : null; };

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

// Zerlegt den Rechenweg in Eingaben, Blöcke (Pisten, Zusatz, je Phase die Zeilen) und Lesehilfe. Streng: Dazwischen steht nichts.
const ROW = {
  ph: /^<tr class="perf-steps-ph"><th colspan="3" scope="rowgroup">(Start|Landung) <span class="perf-steps-src">· ([^<]*)<\/span><\/th><\/tr>$/,
  step: /^<tr><th scope="row">([^<]*)<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>$/,
  note: /^<tr><td class="perf-steps-note" colspan="3">([^<]*)<\/td><\/tr>$/,
  stop: /^<tr><th scope="row">([^<]*)<\/th><td class="perf-nov" colspan="2">kein Wert<\/td><\/tr>$/,
  res: /^<tr class="perf-steps-res"><th scope="row">aufgerundet<\/th><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>$/
};
function parseCalc(html, ctx) {
  const m = /<details class="perf-details"(?: open)?><summary>Rechenweg und Quellen<\/summary><div class="perf-calc">(.*?)<\/div><\/details>/.exec(html);
  assert.ok(m, ctx + ': Rechenweg fehlt');
  let rest = m[1];
  const inp = /^<p><span class="perf-calc-h">Eingaben:<\/span> ([^<]*)<\/p>/.exec(rest);
  assert.ok(inp, ctx + ': Zeile Eingaben');
  rest = rest.slice(inp[0].length);
  const G = /^<p><span class="perf-calc-h">(Pisten? )([^<]*)<\/span>([^<]*)<\/p><table class="perf-steps"><thead><tr><th><\/th><th scope="col">Rollstrecke<\/th><th scope="col">über 15 m<\/th><\/tr><\/thead>((?:<tbody>.*?<\/tbody>)+)<\/table>/;
  const groups = [];
  let g;
  while ((g = G.exec(rest))) {
    rest = rest.slice(g[0].length);
    const ids = g[1] === 'Piste ' ? [g[2]] : g[2].split(/, | und /);
    assert.equal(g[1] === 'Pisten ', ids.length > 1, ctx + ': «Pisten» genau bei mehreren');
    const phases = {};
    g[4].match(/<tbody>.*?<\/tbody>/g).forEach((tb) => {
      const trs = tb.slice(7, -8).match(/<tr.*?<\/tr>/g);
      const head = ROW.ph.exec(trs[0]);
      assert.ok(head, ctx + ': Kopfzeile der Phase «' + trs[0] + '»');
      assert.ok(!phases[head[1]], ctx + ': Phase doppelt');
      phases[head[1]] = { src: text(head[2]), rows: trs.slice(1).map((tr) => {
        let x;
        if ((x = ROW.step.exec(tr))) return { kind: 'step', label: text(x[1]).trim(), a: text(x[2]).trim(), b: text(x[3]).trim() };
        if ((x = ROW.res.exec(tr))) return { kind: 'res', label: 'aufgerundet', a: text(x[1]).trim(), b: text(x[2]).trim() };
        if ((x = ROW.note.exec(tr))) return { kind: 'note', label: text(x[1]).trim() };
        if ((x = ROW.stop.exec(tr))) return { kind: 'stop', label: text(x[1]).trim() };
        return assert.fail(ctx + ': unbekannte Zeile «' + tr + '»');
      }) };
    });
    assert.deepEqual(Object.keys(phases), ['Start', 'Landung'], ctx + ': Phasen');
    groups.push({ ids, note: text(g[3]), phases });
  }
  const rules = /^<p>([^<]*)<\/p>$/.exec(rest);
  assert.ok(rules, ctx + ': nach den Tabellen nur die Lesehilfe, gefunden «' + rest.slice(0, 120) + '»');
  return { inputs: text(inp[1]), groups, rules: rules[1] };
}

// Eigene Ablesung der Tabelle aus den Flugzeugdaten (ohne den Rechenkern): Zeilen der Schritt-Tabelle und Interpolation
function expectTable(chart, pa, tempC) {
  const [axPa, axT] = chart.table.axes;
  assert.deepEqual([axPa.quantity, axT.quantity, axPa.read], ['pressureAltitude', 'temperature', 'nextHigher']);
  const next = (vals, v) => { let j = 0; while (vals[j] < v) j++; return j; };
  const i = next(axPa.values, pa), j = next(axT.values, tempC);
  const lab = (t) => 'Tabelle ' + ui.fmtInt(axPa.values[i]) + ' ft / ' + ui.fmtInt(t) + ' °C';
  const cell = (jj) => chart.table.cells[i][jj].map((v) => BigInt(v) * E4);
  if (axT.read === 'linear' && tempC > axT.values[0] && axT.values[j] !== tempC) {
    return { rows: [[lab(axT.values[j - 1]), cell(j - 1)], [lab(axT.values[j]), cell(j)]], t0: axT.values[j - 1], t1: axT.values[j] };
  }
  return { rows: [[lab(axT.values[j]), cell(j)]], t0: null, t1: null };
}
function pairOf(r, unit, ctx) {
  return [r.a, r.b].map((s) => {
    const m = /^(\S+) (m|ft)$/.exec(s);
    assert.ok(m && m[2] === unit, ctx + ': Wert «' + s + '» nicht in ' + unit);
    return dec(m[1], ctx);
  });
}
// Kette prüfen: jeder Schritt aus dem vorigen; mit fin ist der letzte Schritt auf 0,01 aufgerundet
function checkSteps(steps, fin, ctx) {
  let prev = null;
  steps.forEach((st, k) => {
    const ex = st.exact(prev);
    [0, 1].forEach((j) => sameValue(st.shown[j], ex[j], fin && k === steps.length - 1, ctx + ' ' + st.what + (j ? ' (15 m)' : ' (Rollstrecke)')));
    prev = st.shown;
  });
  return prev;
}

// Eine Phase nachrechnen. Gibt die aufgerundeten Meter zurück oder null (kein Wert). stats zählt Zeilen und Werte.
// Welche Zeilen dastehen müssen, folgt aus Flugzeugdaten und Eingabe, nicht aus dem Rechenkern.
function checkPhase(P, ph, ac, rwy, inp, pa, kt, ctx, stats) {
  const chart = ac.charts[ph];
  const unit = chart.table.outputs[0].unit;
  const rows = P.rows.slice();
  const take = (kind) => {
    const r = rows.shift();
    assert.ok(r && r.kind === kind, ctx + ': erwartet ' + kind + ', gefunden ' + JSON.stringify(r));
    stats.rows++;
    return r;
  };
  const src = ac.sources[chart.source];
  assert.equal(P.src, [src.labelDe, chart.ref.figure, 'Seite ' + chart.ref.page].join(', '), ctx + ': Quelle');
  const steps = [];
  const exp = expectTable(chart, pa, inp[0]);
  const shownTab = exp.rows.map(([lab, cells]) => {
    const r = take('step');
    assert.equal(r.label, lab, ctx + ': Beschriftung der Tabellenzeile');
    const v = pairOf(r, unit, ctx);
    assert.deepEqual(v, cells, ctx + ': Tabellenwert aus den Flugzeugdaten');
    return v;
  });
  let table;
  if (exp.t0 !== null) {
    const r = take('step');
    assert.equal(r.label, 'interpoliert für ' + ui.fmtDec(inp[0], 1) + ' °C', ctx);
    table = pairOf(r, unit, ctx);
    const t0 = BigInt(exp.t0) * E4, t1 = BigInt(exp.t1) * E4, t = BigInt(Math.round(inp[0] * 10000));
    assert.equal(((t - t0) * E4) % (t1 - t0), 0n, ctx + ': Anteil der Interpolation mit höchstens vier Dezimalen');
    const w = (t - t0) * E4 / (t1 - t0);
    steps.push({ what: 'Interpolation', shown: table, exact: () => [0, 1].map((k) => shownTab[0][k] * E4 + w * (shownTab[1][k] - shownTab[0][k])) });
  } else {
    table = shownTab[0];
    steps.push({ what: 'Tabelle', shown: table, exact: () => table.map((v) => v * E4) });
  }
  const stop = (label) => {
    assert.equal(take('stop').label, label, ctx + ': Abbruchzeile');
    assert.equal(rows.length, 0, ctx + ': Zeilen nach dem Abbruch');
    checkSteps(steps, false, ctx);
    return null;
  };
  const hw = chart.corrections.find((c) => c.kind === 'headwind');
  if (kt > 40) return stop('Gegenwind ' + kt + ' kt: über 40 kt');
  if (kt >= 1 && hw) {
    const per = hw.per === 1 ? '' : ui.fmtExact(hw.per) + ' ';
    const rest = (hw.type === 'percentPer' ? -hw.percent : -hw.amount) * kt % hw.per !== 0;
    let label, step, tooMuch;
    if (hw.type === 'percentPer') {
      const p = BigInt(Math.floor(-hw.percent * kt / hw.per + 1e-9));
      label = 'Gegenwind ' + kt + ' kt: −' + ui.fmtExact(-hw.percent) + ' % je ' + per + 'kt' + (rest ? ', abgerundet ' : ' = ') + '−' + p + ' %';
      step = { what: 'Wind %', exact: (prev) => prev.map((v) => v * (100n - p) * 100n) };
      tooMuch = p > 50n;
    } else {
      const x = BigInt(Math.floor(-hw.amount * kt / hw.per + 1e-9)) * E4;
      label = 'Gegenwind ' + kt + ' kt: −' + ui.fmtExact(-hw.amount) + ' ' + unit + ' je ' + per + 'kt' + (rest ? ', abgerundet −' : ' = −') + ui.fmtInt(Number(x / E4)) + ' ' + unit;
      step = { what: 'Wind absolut', exact: (prev) => prev.map((v) => (v - x) * E4) };
      tooMuch = table.some((v) => x * 2n > v);
    }
    if (tooMuch) return stop(label + ', mehr als die Hälfte');
    const r = take('step');
    assert.equal(r.label, label, ctx + ': Beschriftung Gegenwind');
    step.shown = pairOf(r, unit, ctx);
    steps.push(step);
  }
  if (rwy.surface !== chart.base.surface) {
    const sr = chart.corrections.find((c) => c.kind === 'surface' && c.surface === rwy.surface);
    const r = take('step');
    const m = /^Gras \+(\S+) % von (\S+) (m|ft) = \+(\S+) (m|ft)$/.exec(r.label);
    assert.ok(sr && m && m[3] === unit && m[5] === unit, ctx + ': Beschriftung Gras «' + r.label + '»');
    const p = dec(m[1], ctx), b = dec(m[2], ctx), inc = dec(m[4], ctx);
    assert.equal(p, BigInt(sr.percent) * E4, ctx + ': Grasprozent aus den Flugzeugdaten');
    assert.equal(b, table[0], ctx + ': Gras von der Tabellen-Rollstrecke');
    assert.equal(inc * 1000000n, p * b, ctx + ': Graszuschlag exakt');
    steps.push({ what: 'Gras', shown: pairOf(r, unit, ctx), exact: (prev) => prev.map((v) => (v + inc) * E4) });
  }
  let wetFactor = false;
  chart.corrections.filter((c) => c.kind === 'factor').forEach((c) => {
    if (!(c.when === 'always' || (c.when === 'wet' && inp[4] && rwy.surface === c.surface))) return;
    if (c.when === 'wet') wetFactor = true;
    const r = take('step');
    assert.equal(r.label, c.labelDe + (c.minimum ? ': mindestens × ' : ' × ') + c.factor.toFixed(2).replace('.', ','), ctx + ': Beschriftung Faktor');
    const f = BigInt(Math.round(c.factor * 10000));
    steps.push({ what: 'Faktor', shown: pairOf(r, unit, ctx), exact: (prev) => prev.map((v) => v * f) });
  });
  if (inp[4] && !wetFactor) assert.equal(take('note').label, ui.TEXT.calcNoWet, ctx + ': Zeile ohne Nässewert');
  if (unit === 'ft') {
    const r = take('step');
    assert.equal(r.label, 'in Meter (× 0,3048)', ctx);
    steps.push({ what: 'ft → m', shown: pairOf(r, 'm', ctx), exact: (prev) => prev.map((v) => v * 3048n) });
  }
  const last = checkSteps(steps, true, ctx);
  const fin = pairOf(take('res'), 'm', ctx);
  assert.equal(rows.length, 0, ctx + ': Zeilen nach dem Ergebnis');
  [0, 1].forEach((j) => assert.equal(fin[j], ceilDiv(last[j], E4) * E4, ctx + ': aufgerundet'));
  stats.values++;
  return fin.map((v) => Number(v / E4));
}

/* ── Aufbau und Wortlaut ──────────────────────────────────── */

test('Rechenweg K2: genauer Aufbau und Wortlaut, direkt darunter der Pflichthinweis', () => {
  const html = render(wxPfa());
  const row = (label, a, b) => '<tr><th scope="row">' + label + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
  const expected = '<details class="perf-details"><summary>Rechenweg und Quellen</summary><div class="perf-calc">' +
    '<p><span class="perf-calc-h">Eingaben:</span> Druckhöhe 1\'630&nbsp;ft (QNH 1018,0&nbsp;hPa, Platzhöhe 1\'759&nbsp;ft) · Temperatur 15,0&nbsp;°C · Piste trocken</p>' +
    '<p><span class="perf-calc-h">Piste 30</span> (304° rechtweisend) · Gegenwind 7,76&nbsp;kt, abgerundet 7&nbsp;kt</p>' +
    '<table class="perf-steps"><thead><tr><th></th><th scope="col">Rollstrecke</th><th scope="col">über 15 m</th></tr></thead>' +
    '<tbody><tr class="perf-steps-ph"><th colspan="3" scope="rowgroup">Start <span class="perf-steps-src">· Supplement, Figure 5-1a (Section 5b), Seite 5b-3</span></th></tr>' +
    row('Tabelle 2\'000&nbsp;ft / 20&nbsp;°C', '306&nbsp;m', '479&nbsp;m') +
    row('Gegenwind 7&nbsp;kt: −10&nbsp;% je 9&nbsp;kt, abgerundet −7&nbsp;%', '284,58&nbsp;m', '445,47&nbsp;m') +
    row('Gras +15&nbsp;% von 306&nbsp;m = +45,9&nbsp;m', '330,48&nbsp;m', '491,37&nbsp;m') +
    '<tr class="perf-steps-res"><th scope="row">aufgerundet</th><td>331&nbsp;m</td><td>492&nbsp;m</td></tr></tbody>' +
    '<tbody><tr class="perf-steps-ph"><th colspan="3" scope="rowgroup">Landung <span class="perf-steps-src">· Grundhandbuch, Figure 5-11, Seite 5-24</span></th></tr>' +
    row('Tabelle 2\'000&nbsp;ft / 20&nbsp;°C', '630&nbsp;ft', '1\'420&nbsp;ft') +
    row('Gegenwind 7&nbsp;kt: −10&nbsp;% je 9&nbsp;kt, abgerundet −7&nbsp;%', '585,9&nbsp;ft', '1\'320,6&nbsp;ft') +
    row('Gras +45&nbsp;% von 630&nbsp;ft = +283,5&nbsp;ft', '869,4&nbsp;ft', '1\'604,1&nbsp;ft') +
    row('in Meter (× 0,3048)', '265&nbsp;m', '488,93&nbsp;m') +
    '<tr class="perf-steps-res"><th scope="row">aufgerundet</th><td>265&nbsp;m</td><td>489&nbsp;m</td></tr></tbody></table>' +
    '<p>' + ui.TEXT.calcRules + ' ' + ui.TEXT.calcLimits + '</p></div></details>';
  assert.equal(calcOf(html), expected);
  assert.ok(html.endsWith(expected + FOOT), 'Pflichthinweis direkt nach dem Rechenweg');
  assert.equal(calcOf(render(wxPfa(), { detailsOpen: true })), expected.replace('<details class="perf-details">', '<details class="perf-details" open>'));
  // Wortlaut der festen Texte
  assert.equal(ui.TEXT.advice, 'Die Werte sind nur ein Anhaltspunkt. Für die Flugvorbereitung in jedem Fall das AFM der Maschine heranziehen.');
  assert.equal(ui.TEXT.calcRules, 'Rundung immer zur längeren Strecke: nächsthöherer Tabellenwert, Gegenwind abgerundet, Ergebnis aufgerundet. ' +
    'Gegenwind voll angerechnet. Graszuschlag in % der Tabellen-Rollstrecke, auf beide Strecken.');
  assert.equal(ui.TEXT.calcLimits, 'Nicht berücksichtigt: Pistenneigung. Kein eigener Sicherheitszuschlag.');
  assert.equal(ui.TEXT.calcNoWet, 'nasse Piste: kein Wert im AFM, ohne Zuschlag gerechnet');
  ['footerGeneric', 'ruleWind', 'ruleRound', 'ruleGrass', 'ruleWet'].forEach((k) => assert.equal(ui.TEXT[k], undefined, 'TEXT.' + k));
});

/* ── Rechenweg gleich Rechnung: alle Kontrollfälle ────────── */

// Wind zur Piste ohne den Rechenkern: Zusatz hinter dem Pistennamen und ganze kt Gegenwind; null = Piste nicht gerechnet
function expectRunway(inp, rwy) {
  const dir = inp[2], kts = inp[3];
  if (kts < 1) return { note: ' · windstill, ohne Windkorrektur', kt: 0 };
  if (dir === null) return kts <= 3 ? { note: ' · Windrichtung nicht gemeldet, ohne Windkorrektur', kt: 0 } : null;
  const along = Math.round(Math.cos((dir - rwy.bearingTrue) * Math.PI / 180) * 1e9) / 1e9;
  if (along < 0) return null;
  if (along === 0) return { note: ' · Wind genau quer, ohne Windkorrektur', kt: 0 };
  const kt = Math.floor(kts * along + 1e-9);
  return { note: ' (' + rwy.bearingTrue + '° rechtweisend) · Gegenwind ' + ui.fmtKt2(kts * along) + ' kt, abgerundet ' + kt + ' kt', kt };
}

test('Rechenweg gleich Rechnung: alle Kontrollfälle – Eingaben, Tabellenablesung, jede Zeile nachgerechnet, Ergebnis gleich Rechenkern, Kontrollfall und Karte', () => {
  const sample = clone(C172D);
  sample.charts.takeoff.table.cells = readJson('tests/fixtures/c172d_5a_1111kg_m.json').cells;
  const stats = { cases: 0, noResult: 0, tables: 0, merged: 0, phases: 0, rows: 0, values: 0, noValue: 0 };
  CASES.forEach(([id, acId, field, inp, want]) => {
    assert.ok(['c172d', 'p2010', 'c152', 'sample5a1111'].includes(acId), id + ': unbekanntes Muster ' + acId);
    const ac = acId === 'c172d' ? C172D : (acId === 'p2010' ? P2010 : (acId === 'c152' ? C152 : sample));
    const af = field === 'lszk' ? AF : pavedTestField(field);
    const html = render(wxPfa({ tempC: inp[0], qnhHpa: inp[1], windDir: inp[2], windKt: inp[3], rain1hMm: inp[4] ? 0.4 : 0 }), { aircraft: ac, airfield: af, detailsOpen: true });
    stats.cases++;
    ['NaN', 'undefined', 'null', 'Infinity', '≈', 'perf-skip', 'nicht berechnet', 'laut FGZO für', 'Richtwert'].forEach((w) => assert.ok(!html.includes(w), id + ': enthält ' + w));
    const shown = af.runways.map((r) => [r, expectRunway(inp, r)]).filter((x) => x[1]);
    if (typeof want === 'string' || !shown.length) {
      stats.noResult++;
      assert.ok(!html.includes('perf-details') && !html.includes('perf-steps') && html.endsWith(FOOT), id + ': ohne Ergebnis kein Rechenweg, aber der Pflichthinweis');
      return;
    }
    const calc = parseCalc(html, id);
    const pa = core.pressureAltitudeFt(af.elevation.value, inp[1]);
    assert.equal(calc.inputs, 'Druckhöhe ' + ui.fmtInt(Math.ceil(pa - 1e-9)) + ' ft (QNH ' + inp[1].toFixed(1).replace('.', ',') + ' hPa, Platzhöhe ' +
      ui.fmtInt(af.elevation.value) + ' ft) · Temperatur ' + ui.fmtDec(inp[0], 1) + ' °C · Piste ' + (inp[4] ? 'nass' : 'trocken'), id + ': Eingaben');
    assert.equal(calc.rules, ui.TEXT.calcRules + ' ' + ui.TEXT.calcLimits, id + ': Lesehilfe');
    assert.deepEqual(calc.groups.map((g) => g.ids).flat(), shown.map((x) => x[0].id), id + ': jede gerechnete Piste genau einmal, keine Rückenwindpiste');
    const res = core.compute(ac, af, { tempC: inp[0], qnhHpa: inp[1], windDirTrue: inp[2], windKt: inp[3], runwayWet: inp[4] });
    calc.groups.forEach((g) => {
      stats.tables++;
      if (g.ids.length > 1) stats.merged++;
      g.ids.forEach((rid) => {
        const [rwy, exp] = shown.find((x) => x[0].id === rid);
        assert.equal(g.note, exp.note, id + ' Piste ' + rid + ': Zusatz zur Piste');
        const card = text(block(html, rid));
        [['Start', 'takeoff'], ['Landung', 'landing']].forEach(([label, ph], k) => {
          const first = rid === g.ids[0], local = { rows: 0, values: 0 };
          const ctx = id + ' Piste ' + rid + ' ' + label;
          const fin = checkPhase(g.phases[label], ph, ac, rwy, inp, pa, exp.kt, ctx, local);
          if (first) { stats.phases++; stats.rows += local.rows; stats.values += local.values; if (!fin) stats.noValue++; }
          const p = res.runways.find((r) => r.id === rid)[ph];
          const fix = want[rid][k + 1];
          if (fin) {
            assert.deepEqual(fin, [p.m.groundRoll, p.m.overObstacle], ctx + ': Rechenkern');
            if (fix !== null) assert.deepEqual(fin, fix.slice(0, 2), ctx + ': Kontrollfall');   // K1: Landung ohne Sollwert
            const cell = new RegExp(label + ' ([^ ]+) m ([^ ]+) m').exec(card);
            assert.ok(cell, ctx + ': Kartenzeile');
            assert.deepEqual([cell[1], cell[2]], fin.map((v) => ui.fmtInt(v)), ctx + ': Karte');
          } else {
            assert.equal(p.ok, false, ctx + ': Rechenkern ohne Wert');
            assert.equal(typeof fix, 'string', ctx + ': Kontrollfall ohne Wert');
            assert.ok(new RegExp(label + ' – – ').test(card), ctx + ': ohne Wert auch auf der Karte');
          }
        });
      });
    });
  });
  assert.deepEqual(stats, { cases: 64, noResult: 5, tables: 59, merged: 28, phases: 118, rows: 556, values: 109, noValue: 9 }, 'Abdeckung');
});

/* ── Zusammenfassen, Sonderzeilen ─────────────────────────── */

const mixed = clone(AF);
mixed.runways[1].surface = 'paved';
const three = clone(AF);
three.runways.push({ id: '06', bearingTrue: 64, bearingMag: 60, surface: 'grass', takeoffAvailable: { value: 700, unit: 'm' }, landingAvailable: { value: 650, unit: 'm' } });
const one = clone(AF);
one.runways = one.runways.filter((r) => r.id === '12');
const CALM = (o) => wxPfa(Object.assign({ tempC: 20, qnhHpa: 1013.25, windDir: null, windKt: 0 }, o));

test('Rechenweg: Pisten mit gleicher Rechnung teilen sich eine Tabelle; anderer Belag oder andere Pistenrichtung getrennt', () => {
  const heads = (html) => (html.match(/<p><span class="perf-calc-h">Pisten? [^<]*<\/span>[^<]*<\/p>/g) || []).map((x) => text(x).trim());
  const tables = (html) => html.split('<table class="perf-steps">').length - 1;
  let html = render(CALM());
  assert.deepEqual([heads(html), tables(html)], [['Pisten 12 und 30 · windstill, ohne Windkorrektur'], 1]);
  html = render(CALM(), { airfield: mixed });
  assert.deepEqual([heads(html), tables(html)], [['Piste 12 · windstill, ohne Windkorrektur', 'Piste 30 · windstill, ohne Windkorrektur'], 2]);
  assert.ok(text(calcOf(html)).includes('Gras +15 % von 306 m = +45,9 m 351,9 m 524,9 m aufgerundet 352 m 525 m') &&
    text(calcOf(html)).includes("Tabelle 2'000 ft / 20 °C 306 m 479 m aufgerundet 306 m 479 m"), 'Graspiste mit, Hartbelagpiste ohne Graszeile');
  html = render(CALM(), { airfield: three });
  assert.deepEqual([heads(html), tables(html)], [['Pisten 12, 30 und 06 · windstill, ohne Windkorrektur'], 1]);
  // Wind aus 94°: gleicher Gegenwind auf 12 (124°) und 06 (64°), aber andere Richtung in der Zeile; 30 hat Rückenwind
  html = render(wxPfa({ windDir: 94, windKt: 8 }), { airfield: three });
  assert.deepEqual([heads(html), tables(html)], [['Piste 12 (124° rechtweisend) · Gegenwind 6,92 kt, abgerundet 6 kt', 'Piste 06 (64° rechtweisend) · Gegenwind 6,92 kt, abgerundet 6 kt'], 2]);
  // Parallelpisten gleicher Richtung: eine Tabelle; Pistenkennungen maskiert
  const par = clone(AF);
  par.runways = [Object.assign(clone(AF.runways[1]), { id: '30<b>L' }), Object.assign(clone(AF.runways[1]), { id: '30R' })];
  html = render(wxPfa(), { airfield: par });
  assert.ok(html.includes('<p><span class="perf-calc-h">Pisten 30&lt;b&gt;L und 30R</span> (304° rechtweisend) · Gegenwind 7,76&nbsp;kt, abgerundet 7&nbsp;kt</p>') && tables(html) === 1, calcOf(html));
  assert.deepEqual([heads(render(wxPfa())), heads(render(CALM(), { airfield: one }))], [['Piste 30 (304° rechtweisend) · Gegenwind 7,76 kt, abgerundet 7 kt'], ['Piste 12 · windstill, ohne Windkorrektur']]);
});

test('Rechenweg: Sonderzeilen – keine Windregel, kein Belag, über 40 kt, mehr als die Hälfte, Prozent ohne Rest, nasse Piste ohne Wert', () => {
  const t = (html) => text(calcOf(html));
  const noWind = clone(C172D);
  core.PHASES.forEach((ph) => { noWind.charts[ph].corrections = noWind.charts[ph].corrections.filter((c) => c.kind !== 'headwind'); });
  let s = t(render(wxPfa(), { aircraft: noWind }));
  assert.ok(s.includes("Tabelle 2'000 ft / 20 °C 306 m 479 m Gegenwind 7 kt: nicht angerechnet (keine Regel in den Flugzeugdaten) Gras +15 % von 306 m = +45,9 m 351,9 m 524,9 m aufgerundet 352 m 525 m"), s);
  const noGrass = clone(C172D);
  noGrass.charts.takeoff.corrections = noGrass.charts.takeoff.corrections.filter((c) => c.kind !== 'surface');
  s = t(render(wxPfa(), { aircraft: noGrass }));
  assert.ok(s.includes('Gegenwind 7 kt: −10 % je 9 kt, abgerundet −7 % 284,58 m 445,47 m keine Korrektur für den Belag kein Wert Landung'), s);
  let html = render(wxPfa({ qnhHpa: 1013.25, windDir: 304, windKt: 41 }));
  assert.equal(t(html).split("Tabelle 2'000 ft / 20 °C").length - 1, 2);
  assert.equal(calcOf(html).split('<tr><th scope="row">Gegenwind 41&nbsp;kt: über 40&nbsp;kt</th><td class="perf-nov" colspan="2">kein Wert</td></tr></tbody>').length - 1, 2, calcOf(html));
  assert.ok(!calcOf(html).includes('perf-steps-res'), 'kein Ergebnis nach dem Abbruch');
  s = t(render(wxPfa({ windDir: 304, windKt: 9 })));
  assert.ok(s.includes('Gegenwind 9 kt: −10 % je 9 kt = −10 % 275,4 m 431,1 m'), s);
  const steep = clone(C172D);
  steep.charts.takeoff.corrections.find((c) => c.kind === 'headwind').per = 1;               // −10 % je kt
  s = t(render(wxPfa({ windDir: 304, windKt: 6 }), { aircraft: steep }));
  assert.ok(s.includes('Gegenwind 6 kt: −10 % je kt = −60 %, mehr als die Hälfte kein Wert Landung'), s);
  const notes = (h) => calcOf(h).split('<tr><td class="perf-steps-note" colspan="3">' + ui.TEXT.calcNoWet + '</td></tr>').length - 1;
  assert.deepEqual([notes(render(wxPfa())), notes(render(wxPfa({ rain1hMm: 0.4 }))), notes(render(wxPfa({ rain1hMm: 0.4 }), { aircraft: C152 })),
    notes(render(wxPfa({ rain1hMm: 0.4 }), { aircraft: P2010 })), notes(render(CALM({ rain1hMm: 0.4 }), { aircraft: C152, airfield: mixed }))], [0, 1, 2, 2, 4]);
  // Hartbelagpiste des gemischten Platzes: Nässefaktor für Gras gilt dort nicht, also auch dort die Hinweiszeile
  assert.equal(notes(render(CALM({ rain1hMm: 0.4 }), { airfield: mixed })), 3);
});

test('Rechenweg: Rechenfehler in einer Phase (Schlussprobe des Kerns) – Tabelle und Wind wie gerechnet, dann «Rechenfehler, kein Wert», danach nichts', () => {
  // Mit geprüften Daten nicht erreichbar: Landung auf Piste 30 nachträglich so gesetzt, wie der Kern sie mit none('internal') liefert
  const orig = core.compute;
  core.compute = (ac, af, input) => {
    const res = orig(ac, af, input);
    const rw = res.runways.find((r) => r.id === '30');
    rw.landing = Object.assign({}, rw.landing, { ok: false, reason: 'internal', final: null, meters: null, m: null, exceeds: null });
    return res;
  };
  let html;
  try {
    html = render(wxPfa(), { detailsOpen: true });
  } finally {
    core.compute = orig;
  }
  const row = (label, a, b) => '<tr><th scope="row">' + label + '</th><td>' + a + '</td><td>' + b + '</td></tr>';
  const calc = calcOf(html);
  assert.ok(calc.includes('<tbody><tr class="perf-steps-ph"><th colspan="3" scope="rowgroup">Landung <span class="perf-steps-src">· Grundhandbuch, Figure 5-11, Seite 5-24</span></th></tr>' +
    row('Tabelle 2\'000&nbsp;ft / 20&nbsp;°C', '630&nbsp;ft', '1\'420&nbsp;ft') +
    row('Gegenwind 7&nbsp;kt: −10&nbsp;% je 9&nbsp;kt, abgerundet −7&nbsp;%', '585,9&nbsp;ft', '1\'320,6&nbsp;ft') +
    '<tr><th scope="row">Rechenfehler</th><td class="perf-nov" colspan="2">kein Wert</td></tr></tbody></table>'), calc);
  // Der Start bleibt mit Ergebnis; die Karte zeigt für die Landung keinen Wert; der Pflichthinweis steht am Schluss
  assert.ok(text(calc).includes('Gras +15 % von 306 m = +45,9 m 330,48 m 491,37 m aufgerundet 331 m 492 m'), calc);
  assert.equal(calc.split('perf-steps-res').length - 1, 1, 'nur der Start mit Ergebnis');
  const b30 = text(block(html, '30'));
  assert.ok(b30.includes('Start 331 m 492 m 625 m') && b30.includes('Landung – – 520 m') && b30.includes('Landung: Rechenfehler – kein Wert.'), b30);
  assert.ok(html.endsWith('</details>' + FOOT), 'Pflichthinweis am Schluss');
});

/* ── Entfernte Teile ──────────────────────────────────────── */

test('Nicht mehr angezeigt: Fusszeile der Daten, Ableseregel, Massenhinweis, Bedingungen, Anmerkungen, Titel und Nummern der Quellen, Regelabsätze, Pistendaten', () => {
  let n = 0;
  [C172D, P2010, C152].forEach((ac) => {
    const gone = [ac.footerDe, ac.readingRuleDe, ac.massNoteDe];
    core.PHASES.forEach((ph) => { gone.push(ac.charts[ph].conditionsDe, ac.charts[ph].title); ac.charts[ph].notesDe.forEach((x) => gone.push(x)); });
    Object.keys(ac.sources).forEach((k) => ['title', 'publisher', 'number', 'issue', 'approval', 'applicability', 'applicabilityDe', 'pageMark', 'pageMarkDe', 'caveatDe'].forEach((f) => {
      if (ac.sources[k][f] !== undefined) gone.push(ac.sources[k][f]);
    }));
    [wxPfa(), wxPfa({ rain1hMm: 0.4 }), wxPfa({ windDir: null, windKt: 0 }), wxPfa({ src: 'speck' })].forEach((w) => {
      const t = text(render(w, { aircraft: ac, detailsOpen: true }));
      gone.forEach((s) => { assert.ok(typeof s === 'string' && s.length > 8 && !t.includes(s), ac.id + ': noch angezeigt «' + s + '»'); n++; });
      ['Pistendaten', 'AD INFO', 'missweisend', 'Regeln', 'Tabellenzeile', 'Tabellenspalte', 'Richtwert', 'Rückenwindkomponente', 'Mittelwind'].forEach((s) => {
        assert.ok(!t.includes(s) || (s === 'Mittelwind' && t.includes('Windstill (Mittelwind unter 1 kt)')), ac.id + ': noch angezeigt «' + s + '»');
      });
    });
  });
  assert.ok(n >= 250, n + ' Proben');
  // Die Daten selbst bleiben unverändert (Beleg der Quelle): die Felder gibt es weiter
  [C172D, P2010, C152].forEach((ac) => assert.ok(ac.footerDe && ac.readingRuleDe && ac.massNoteDe && ac.charts.takeoff.notesDe.length, ac.id));
});

test('Platzsperre der FGZO: nie in der Karte, weder frisch noch veraltet – die Karte hängt nicht von flaeche, flaeche_grund und status ab', () => {
  const variants = [{ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }, { flaeche: 'gesperrt', flaeche_grund: 'geschlossen', status: 'CLOSED' },
    { flaeche: 'gesperrt', flaeche_grund: 42 }, { flaeche: 'gesperrt' }, { flaeche: 'gesperrt', flaeche_grund: '<img src=x onerror=y> ' + 'sehr langer Grund '.repeat(6) }];
  const bases = [fgzo(), fgzo({ runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' }), fgzo({ fetched_at_utc: OLD }), fgzo({ runway_condition: 'WET', fetched_at_utc: OLD }),
    fgzo({ updated: '' }), fgzo({ updated: '17.11.2026, 16:20' }), fgzo({ ok: false, fetched_at_utc: null })];
  const wxs = [wxPfa(), wxPfa({ rain1hMm: 0.4 }), wxPfa({ rain1hMm: null, rainMmH: null }), wxPfa({ windDir: null, windKt: 0 }), wxPfa({ src: 'speck' })];
  let n = 0;
  [C172D, P2010, C152].forEach((ac) => wxs.forEach((w) => bases.forEach((b) => [false, true].forEach((open) => {
    const ctx = (f) => ({ dataState: 'ready', list: LIST, aircraft: ac, airfield: AF, wx: w, fgzo: f, nowMs: NOW, detailsOpen: open, notice: open ? 'x' : null });
    const plain = ui.renderParts(ctx(b));
    variants.forEach((v) => {
      const p = ui.renderParts(ctx(Object.assign({}, b, v)));
      assert.deepEqual([p.body, p.teaser, p.sel, p.kind], [plain.body, plain.teaser, plain.sel, plain.kind], ac.id + ': Karte hängt von der Sperre ab');
      assert.ok(!/gesperrt|geschlossen|Helikopter|veraltete Meldung|laut FGZO für|<img/.test(p.body + p.teaser), ac.id + ': Sperrmeldung in der Karte');
      n++;
    });
  }))));
  assert.equal(n, 3 * 5 * 7 * 2 * 5);
  // Gelber Kasten: nur noch der Nässetext (wörtlich wie bisher); ohne Nässe kein Kasten und kein gelber Hinweis
  let html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb', runway_condition: 'STANDING WATER', updated: '18.11.2026, 10:38' }) });
  assert.ok(html.includes('<div class="perf-cond perf-warn" role="note"><div>Piste gilt als nass: FGZO meldet «STANDING WATER» (Stand 18.11.2026, 10:38). ' +
    'Start: mindestens +20&nbsp;% eingerechnet (Supplement, Note 4). Landung: Das AFM nennt für nasses Gras keinen Wert; die Strecke kann deutlich länger sein.</div></div>'), html);
  assert.equal(html.split('perf-warn').length - 1, 1);
  html = render(wxPfa(), { fgzo: fgzo({ flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' }) });
  assert.ok(!html.includes('perf-warn') && !html.includes('perf-note') && text(html).includes('Pistenzustand laut FGZO: DRY (Stand 18.11.2026, 07:14).') &&
    text(block(html, '30')).includes('Start 331 m 492 m 625 m'), html);
  // Die übrigen Hinweise bleiben: DRY nicht von heute, Pistenzustand unbekannt, Standardmuster gewählt
  html = render(wxPfa({ rain1hMm: null, rainMmH: null }), { fgzo: fgzo({ flaeche: 'gesperrt', updated: '17.11.2026, 16:20', fetched_at_utc: OLD }), notice: 'Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.' });
  assert.ok(html.includes('<div class="perf-note" role="status">Flugzeugdaten für «Tecnam P2010» nicht verfügbar – Standardmuster gewählt.</div>') &&
    html.includes('<div class="perf-note">Letzte FGZO-Meldung DRY ist veraltet (Stand 17.11.2026, 16:20, Abruf vor 54 min). ' + ui.TEXT.unknown + '</div>'), html);
  assert.ok(!ui.CSS.includes('div + div'), 'Regel für die zweite Zeile im gelben Kasten');
});

test('Rückenwindpiste: keine Zeile in der Karte, kein Absatz im Rechenweg; «Rückenwind» steht nur in den Hinweisen zu Windstille, fehlender Richtung und Querwind', () => {
  let dirs = 0;
  for (let dir = 1; dir <= 360; dir++) {
    const body = ui.renderParts({ dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: wxPfa({ windDir: dir, windKt: 8 }), fgzo: fgzo(), nowMs: NOW, detailsOpen: true }).body;
    const ids = (body.match(/<section class="perf-block" aria-label="Piste [^"]*">/g) || []).map((x) => /Piste ([^"]*)"/.exec(x)[1]);
    const cross = dir === 34 || dir === 214;
    assert.deepEqual(ids, cross ? ['12', '30'] : [dir > 34 && dir < 214 ? '12' : '30'], 'Richtung ' + dir + ': nur die Gegenwindpiste');
    assert.ok(!body.includes('perf-skip') && !body.includes('nicht berechnet') && !body.includes('Rückenwindkomponente'), 'Richtung ' + dir);
    assert.equal(body.includes('Rückenwind'), cross, 'Richtung ' + dir + ': «Rückenwind» nur im Hinweis bei Querwind');
    const calc = text(calcOf(body));
    assert.equal(calc.includes('Pisten 12 und 30 · Wind genau quer, ohne Windkorrektur'), cross, 'Richtung ' + dir + ': Querwind im Rechenweg');
    if (!cross) assert.ok(calc.includes('Piste ' + ids[0] + ' (') && !calc.includes('Piste ' + (ids[0] === '12' ? '30' : '12')) && !/Pisten [0-9]/.test(calc), 'Richtung ' + dir + ': Rückenwindpiste im Rechenweg');
    dirs++;
  }
  assert.equal(dirs, 360);
  [[CALM(), ui.TEXT.calm], [wxPfa({ windDir: null, windKt: 2 }), ui.TEXT.nodir]].forEach(([w, hint]) => {
    const html = render(w);
    assert.ok(html.includes('<div class="perf-hint">' + hint + '</div>') && html.split('Rückenwind').length - 1 === 1 && !html.includes('nicht berechnet'), html);
  });
  assert.ok(!ui.CSS.includes('perf-skip'), 'CSS-Regel der entfallenen Zeile');
});

/* ── Pflichthinweis ───────────────────────────────────────── */

test('Pflichthinweis: in jedem Zustand genau einmal am Schluss der Karte, ausserhalb des aufklappbaren Rechenwegs, nie in der Kurzzeile', () => {
  const base = { dataState: 'ready', list: LIST, aircraft: C172D, airfield: AF, wx: wxPfa(), fgzo: fgzo(), nowMs: NOW, detailsOpen: false };
  const ctxs = [{ dataState: 'loading', aircraft: null }, { dataState: 'error', aircraft: null, notice: 'x' }, { wx: undefined }, { wx: wxPfa({ src: 'speck' }) },
    { wx: wxPfa({ time: NOW - 46 * MIN }) }, { wx: wxPfa({ time: NOW + 10 * MIN }) }, { wx: wxPfa({ qnhHpa: null }) }, { fgzoPending: true }, { wx: wxPfa({ qnhHpa: 850 }) },
    { wx: wxPfa({ tempC: 45 }) }, { wx: wxPfa({ windDir: null, windKt: 6 }) }, { airfield: one }, {}, { detailsOpen: true }, { aircraft: P2010, detailsOpen: true },
    { aircraft: C152, wx: wxPfa({ rain1hMm: 0.4 }) }, { wx: CALM(), detailsOpen: true }, { fgzo: fgzo({ flaeche: 'gesperrt', runway_condition: 'WET' }), notice: 'x' }];
  const kinds = {};
  const check = (p, label) => {
    kinds[p.kind] = true;
    assert.equal(p.body.split('class="perf-foot"').length - 1, 1, label + ': genau einmal');
    assert.ok(p.body.endsWith(FOOT), label + ': am Schluss');
    assert.ok(p.body.lastIndexOf('</details>') < p.body.lastIndexOf(FOOT), label + ': nicht im Rechenweg');
    assert.ok(!p.teaser.includes('Anhaltspunkt') && !p.sel.includes('Anhaltspunkt'), label + ': nicht in Kurzzeile und Auswahl');
  };
  ctxs.forEach((over, i) => check(ui.renderParts(Object.assign({}, base, over)), 'Fall ' + i));
  const v = core.VERSION;
  try {
    core.VERSION = v + 1;
    check(ui.renderParts(base), 'Version ungleich');
  } finally {
    core.VERSION = v;
  }
  assert.deepEqual(Object.keys(kinds).sort(), ['calc-error', 'data-error', 'fgzo-pending', 'internal', 'loading', 'no-direction', 'no-runway', 'no-wx', 'result']);
  // Fester Text: Die Fusszeile der Flugzeugdaten ändert die Karte nicht mehr
  const ac = clone(C172D);
  ac.footerDe = 'ANDERER TEXT';
  assert.equal(render(wxPfa(), { aircraft: ac }), render(wxPfa()));
  delete ac.footerDe;
  assert.equal(render(wxPfa(), { aircraft: ac }), render(wxPfa()));
  // Sichtbar: gleiche Grösse wie die übrigen gedämpften Zeilen, keine Regel blendet ihn aus
  const rule = /\n\.perf-foot \{([^}]*)\}/.exec(ui.CSS);
  assert.equal(rule && rule[1].trim(), 'font-size: 0.78rem; color: var(--text-muted); line-height: 1.5; border-top: 1px solid var(--card-border); padding-top: 8px; margin-top: 4px;');
  assert.equal(ui.CSS.split('.perf-foot').length - 1, 1, 'genau eine Regel für den Pflichthinweis');
});

/* ── CSS ──────────────────────────────────────────────────── */

test('CSS des Rechenwegs: Zahlen ohne Umbruch, Beschriftung mit Umbruch, höchstens 30rem breit; Regeln der entfallenen Teile fehlen', () => {
  const rule = (sel) => {
    const i = ui.CSS.indexOf('\n' + sel + ' {');
    return i < 0 ? null : ui.CSS.slice(i + sel.length + 3, ui.CSS.indexOf('}', i)).trim();
  };
  assert.equal(rule('.perf-steps'), 'width: 100%; max-width: 30rem; border-collapse: collapse; font-variant-numeric: tabular-nums; margin: 4px 0 10px;');
  assert.equal(rule('.perf-steps th, .perf-steps td'), 'padding: 3px 0 3px 10px; text-align: right; vertical-align: top; font-weight: 400;');
  assert.equal(rule('.perf-steps th:first-child, .perf-steps td:first-child'), 'padding-left: 0; text-align: left;');
  assert.equal(rule('.perf-steps td'), 'color: var(--text); white-space: nowrap;');
  assert.equal(rule('.perf-steps thead th'), 'font-size: 0.7rem; font-weight: 600; vertical-align: bottom; white-space: nowrap;');
  assert.equal(rule('.perf-steps td.perf-steps-note'), 'color: var(--text-muted); white-space: normal;');
  assert.equal(rule('.perf-steps td.perf-nov'), 'color: #f87171;');
  ['.perf-skip', '.perf-calc ul', '.perf-calc li', '.perf-cond.perf-warn div + div'].forEach((s) => assert.equal(rule(s), null, 'Regel ' + s));
  const html = calcOf(render(wxPfa({ rain1hMm: 0.4 }), { aircraft: P2010, detailsOpen: true }));
  (html.match(/class="[^"]*"/g) || []).forEach((c) => c.slice(7, -1).split(' ').forEach((k) => assert.ok(k.startsWith('perf-'), 'Klasse ' + k)));
  assert.ok(!/ style=| id=|#[0-9a-f]{6}|var\(--/.test(html), 'Farbe, style oder id im Rechenweg');
});
