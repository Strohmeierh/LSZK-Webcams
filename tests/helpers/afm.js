// Tabellenausschnitte des Rechenwegs (perf/perf-ui.js VERSION 8, Variante A, Wunsch des Benutzers vom 21.11.2026) für die
// Tests. Aufbau einer Ausschnitt-Zeile der Schritt-Tabelle:
//   <tr class="perf-steps-afm"><td colspan="3"><table class="perf-afm"><thead><tr><th class="perf-afm-cap" scope="col">Kopf</th>
//   <th scope="col">Spalte</th>…</tr></thead><tbody><tr><th scope="row">Zeile</th><td>a<span class="perf-afm-2">b</span></td>…
//   </tr>…</tbody></table></td></tr>
// Blau (class="perf-afm-in") sind die Linien durch den Schnittpunkt (Eingabe bzw. abgelesener Tabellenwert) und ihre Zellen,
// der Schnittpunkt hat class="perf-afm-x"; je Zelle oben die Rollstrecke (a), darunter über 15 m (b).
// afmTables(html): alle Ausschnitte, streng zerlegt (sonst Fehler): [{ cap, cols: [{ label, blue }], rows: [{ label, blue,
//   cells: [{ kind: 'x' | 'empty' | 'blue' | 'plain', a, b }] }] }]
// afmGrids(html): je Ausschnitt eine Zeile im Kurzformat «Kopf ‖ Spalten ‖ Zeile: Zellen ‖ …» ([x] = blaue Linie,
//   *a/b* = Schnittpunkt, ~ = leere blaue Zelle, ~a/b = Tabellenwert auf der blauen Linie, a/b = übriger Tabellenwert)
// withoutAfm(html): html ohne die Ausschnitt-Zeilen (für Textvergleiche der übrigen Schritte)
// legend(unit): Text der Legende über dem Ausschnitt
// AFM_ROW: Muster einer Ausschnitt-Zeile (global; für eigene Zerlegungen, etwa Platzhalter vor dem Zerlegen in Zeilen)
'use strict';
const assert = require('node:assert/strict');

const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const AFM_ROW = /<tr class="perf-steps-afm"><td colspan="3">((?:<table class="perf-afm">[\s\S]*?<\/table>)+)<\/td><\/tr>/g;
const TABLE = /^<table class="perf-afm"><thead><tr><th class="perf-afm-cap" scope="col">([^<]*)<\/th>((?:<th scope="col"(?: class="perf-afm-in")?>[^<]*<\/th>)+)<\/tr><\/thead><tbody>((?:<tr>[\s\S]*?<\/tr>)+)<\/tbody>$/;
const ROW = /^<tr><th scope="row"( class="perf-afm-in")?>([^<]*)<\/th>((?:<td(?: class="perf-afm-(?:in|x)")?>(?:[^<]*<span class="perf-afm-2">[^<]*<\/span>)?<\/td>)+)$/;
const CELL = /<td( class="perf-afm-(in|x)")?>(?:([^<]*)<span class="perf-afm-2">([^<]*)<\/span>)?<\/td>/g;

function afmTables(html) {
  const out = [];
  for (const row of html.matchAll(AFM_ROW)) {
    row[1].split('</table>').slice(0, -1).forEach((t) => {
      const m = TABLE.exec(t);
      assert.ok(m, 'Ausschnitt: ' + t);
      const cols = [...m[2].matchAll(/<th scope="col"( class="perf-afm-in")?>([^<]*)<\/th>/g)].map((c) => ({ label: plain(c[2]), blue: !!c[1] }));
      const rows = m[3].split('</tr>').slice(0, -1).map((r) => {
        const rm = ROW.exec(r);
        assert.ok(rm, 'Zeile: ' + r);
        const cells = [...rm[3].matchAll(CELL)].map((c) => {
          if (c[2] === 'x') {
            assert.ok(c[3] !== undefined && c[3] !== '' && c[4] !== '', 'Schnittpunkt ohne Wert: ' + r);
            return { kind: 'x', a: plain(c[3]), b: plain(c[4]) };
          }
          if (c[3] === undefined) { assert.equal(c[2], 'in', 'leer nur auf der blauen Linie: ' + r); return { kind: 'empty' }; }
          assert.ok(c[3] !== '' && c[4] !== '', 'Zelle ohne Wert: ' + r);
          return { kind: c[2] === 'in' ? 'blue' : 'plain', a: plain(c[3]), b: plain(c[4]) };
        });
        assert.equal(cells.length, cols.length, 'Zellen je Zeile: ' + r);
        return { label: plain(rm[2]), blue: !!rm[1], cells };
      });
      out.push({ cap: plain(m[1]), cols, rows });
    });
  }
  assert.equal((html.match(/<table class="perf-afm">/g) || []).length, out.length, 'Ausschnitt ausserhalb einer Zeile perf-steps-afm');
  return out;
}

function afmGrids(html) {
  const line = (l) => (l.blue ? '[' + l.label + ']' : l.label);
  const cell = (c) => (c.kind === 'x' ? '*' + c.a + '/' + c.b + '*' : (c.kind === 'empty' ? '~' : (c.kind === 'blue' ? '~' : '') + c.a + '/' + c.b));
  return afmTables(html).map((g) => [g.cap + ' ‖ ' + g.cols.map(line).join(' | ')]
    .concat(g.rows.map((r) => line(r) + ': ' + r.cells.map(cell).join(' | '))).join(' ‖ '));
}

const withoutAfm = (html) => html.replace(AFM_ROW, '');
const legend = (unit) => 'AFM-Tabelle in ' + unit + ': oben Rollstrecke, unten über 15 m, blau die Eingabe oder der abgelesene Wert';

module.exports = { afmTables, afmGrids, withoutAfm, legend, AFM_ROW };
