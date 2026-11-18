// Tests für den Platz-Chip der Briefing-Ampel (fgzoItem in index.html).
// Wunsch vom 18.11.2026: Sind die FGZO-Daten veraltet (letzter erfolgreicher Abruf 45 min oder älter), zeigt der Chip
// weiter den letzten Stand mit Farbe und Text, solange dieser Abruf von heute ist (Kalendertag in Zürich). Ein Stand
// von gestern oder ohne lesbare Abrufzeit erscheint grau als «Platz: Daten veraltet». Der Hinweis im Detail-Fenster bleibt.
// Die Funktion steht in index.html: Der Test schneidet sie mit escHtml heraus und ruft sie mit gestellter Uhr auf,
// in mehreren Zeitzonen des Geräts (die Regel muss davon unabhängig sein). Fälle aus der Probe des Prüfers (Runde 4).
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
const CODE = cut('    function escHtml(s) {', '    /* ── Flugplatzstatus FGZO') +
  cut('    var FGZO_SEEN_KEY = ', '    // Gemeinsame Datenbasis für Chips UND Detail-Modal');
const MAKE = new Function('briefing', 'storeGet', 'Date', CODE + '\nreturn fgzoItem("G", "Y", "R", "N");');

// Aufruf mit gestellter Uhr; seen = zuletzt im Detail-Fenster gesehener FGZO-Stand (undefined: nichts gespeichert)
function item(platz, seen, nowMs) {
  class FakeDate extends Date { static now() { return nowMs; } }
  return MAKE({ platz: platz }, () => (seen === undefined ? null : seen), FakeDate);
}

/* ── Zürcher Ortszeit ohne Intl: MEZ +1 h, MESZ +2 h vom letzten Sonntag im März 01:00 UTC
      bis zum letzten Sonntag im Oktober 01:00 UTC ── */
const MIN = 60000;
function lastSunday(year, month) {                     // month 0-basiert; UTC-ms 01:00 UTC an diesem Tag
  const d = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month, d.getUTCDate() - d.getUTCDay(), 1, 0, 0);
}
function zurichOffsetMin(ms) {
  const y = new Date(ms).getUTCFullYear();
  return ms >= lastSunday(y, 2) && ms < lastSunday(y, 9) ? 120 : 60;
}
function zh(y, mo, d, h, mi, s, msec) {                // Zeitpunkt aus Zürcher Ortszeit
  const guess = Date.UTC(y, mo - 1, d, h, mi || 0, s || 0, msec || 0);
  let t = guess - 60 * MIN;
  if (zurichOffsetMin(t) === 120) t = guess - 120 * MIN;
  return t;
}
const isoAt = (ms) => new Date(ms).toISOString().replace('.000Z', '+00:00');     // wie der Job: …T13:30:00+00:00

/* ── Datensätze ── */
const KINDS = {
  offen: {},
  gelb: { ampel: 'gelb', runway_condition: 'SLIPPERY WET' },
  heli: { ampel: 'gelb', runway_condition: 'STANDING WATER', notice: 'Nur Helikopter-Betrieb erlaubt!', updated: '18.11.2026, 10:38',
    flaeche: 'gesperrt', flaeche_grund: 'nur Helikopterbetrieb' },
  gesperrt: { ampel: 'gelb', flaeche: 'gesperrt', flaeche_grund: 'Piste gesperrt' },
  closed: { ampel: 'rot', status: 'CLOSED', traffic: null, closing: null, flaeche: 'gesperrt', flaeche_grund: 'geschlossen' },
  ampelNull: { ampel: null }
};
function platz(kind, over) {
  return Object.assign({
    ok: true, fetched_at_utc: null, failed_at_utc: null, error: null, source: 'https://fgzo.ch/status/',
    ampel: 'gruen', status: 'OPEN', traffic: 'LOW TRAFFIC', closing: '16:50',
    notice: 'Runway condition LSZK / 18.11.2026 / 0700 LT / DRY', runway_line: 'Runway condition LSZK / 18.11.2026 / 0700 LT / DRY',
    runway_condition: 'DRY', contact: 'Kontakt: C-Büro', updated: '18.11.2026, 07:14', flaeche: 'offen', flaeche_grund: null
  }, KINDS[kind], over);
}
// Chip eines Stands, wie ihn ein frischer Abruf zeigt
const CHIP = {
  offen: ['G', 'Platz · LOW TRAFFIC · DRY'], gelb: ['Y', 'Platz · LOW TRAFFIC · SLIPPERY WET'], heli: ['R', 'Platz: nur Heli'],
  gesperrt: ['R', 'Platz: gesperrt'], closed: ['R', 'Platz CLOSED'], ampelNull: ['N', 'Platz · LOW TRAFFIC · DRY']
};
const GREY = ['N', 'Platz: Daten veraltet'];
const NEU = ' · <span class="brf-new">neu</span>';
const HINT = '⚠ Letzter erfolgreicher Abruf';

// exp = [Farbe, Chip ohne «neu», Hinweis im Detail-Fenster, «neu» im Chip]; «neu» im Titel steht, sobald nicht gesehen
const C = (name, now, fetched, kind, opts, exp) => ({ name, now, fetched, kind, opts, exp });
function check(c, zone) {
  const o = c.opts || {};
  const over = { fetched_at_utc: 'fetchedRaw' in o ? o.fetchedRaw : isoAt(c.fetched) };
  if (o.ok === false) Object.assign(over, { ok: false, failed_at_utc: isoAt(c.now - MIN), error: 'ValueError: bot challenge page received' });
  const p = platz(c.kind, over);
  const it = item(p, o.isNew ? '17.11.2026, 16:00' : p.updated, c.now);
  assert.deepEqual(
    [it.color, it.chip, it.text.includes(HINT), it.title.includes('brf-new')],
    [c.exp[0], c.exp[1] + (c.exp[3] ? NEU : ''), c.exp[2], !!o.isNew],
    c.name + ' (Gerät in ' + zone + ')');
}

// Zeitzone des Geräts für die Dauer eines Laufs; Stunde von 2026-01-01T00:00Z als Probe, dass sie wirkt
const ZONES = [['Europe/Zurich', 1], ['Pacific/Auckland', 13], ['America/Los_Angeles', 16], ['Asia/Kolkata', 5], ['UTC', 0]];
function inZones(cases) {
  const before = process.env.TZ;
  try {
    ZONES.forEach(([zone, hour]) => {
      process.env.TZ = zone;
      assert.equal(new Date(Date.UTC(2026, 0, 1)).getHours(), hour, 'Zeitzone des Geräts ' + zone + ' nicht gesetzt');
      cases.forEach((c) => check(c, zone));
    });
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
}

/* ── Fälle ── */
const T1 = zh(2026, 11, 18, 16, 30);                   // Mittwoch 18.11.2026, 16:30 Uhr (Winterzeit)

test('Platz-Chip: frisch bis 44:59 min, ab 45 min veraltet mit Hinweis, Abrufzeit in der Zukunft gilt als aktuell', () => {
  inZones([
    C('16:30, Abruf vor 5 min, offen', T1, T1 - 5 * MIN, 'offen', {}, ['G', CHIP.offen[1], false]),
    C('16:30, Abruf vor 5 min, offen, noch nicht gesehen', T1, T1 - 5 * MIN, 'offen', { isNew: true }, ['G', CHIP.offen[1], false, true]),
    C('16:30, ok:false, Abruf vor 20 min (ein Fehlabruf)', T1, T1 - 20 * MIN, 'offen', { ok: false }, ['G', CHIP.offen[1], false]),
    C('16:30, Abruf vor 44 min 59 s', T1, T1 - 45 * MIN + 1000, 'offen', {}, ['G', CHIP.offen[1], false]),
    C('16:30, Abruf vor genau 45 min: veraltet, von heute', T1, T1 - 45 * MIN, 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('Abrufzeit 10 min in der Zukunft (Uhr des Geräts geht nach): aktuell', T1, T1 + 10 * MIN, 'offen', {}, ['G', CHIP.offen[1], false])
  ]);
});

test('Platz-Chip: veraltet von heute mit Farbe, Text und «neu»; von gestern, ohne oder mit unlesbarer Abrufzeit grau', () => {
  const cases = [];
  Object.keys(KINDS).forEach((k) => {
    cases.push(
      C('16:30, frisch, ' + k, T1, T1 - 8 * MIN, k, {}, [CHIP[k][0], CHIP[k][1], false]),
      C('16:30, veraltet heute (Abruf 13:30), ' + k, T1, zh(2026, 11, 18, 13, 30), k, { ok: false }, [CHIP[k][0], CHIP[k][1], true]),
      C('16:30, veraltet heute, ' + k + ', noch nicht gesehen: «neu»', T1, zh(2026, 11, 18, 13, 30), k, { ok: false, isNew: true },
        [CHIP[k][0], CHIP[k][1], true, true]),
      C('16:30, veraltet gestern (Abruf 17.11. 15:30), ' + k, T1, zh(2026, 11, 17, 15, 30), k, { ok: false }, [GREY[0], GREY[1], true]),
      C('16:30, veraltet gestern, ' + k + ', noch nicht gesehen: kein «neu» im Chip', T1, zh(2026, 11, 17, 15, 30), k, { ok: false, isNew: true },
        [GREY[0], GREY[1], true, false]),
      C('16:30, ohne Abrufzeit, ' + k, T1, 0, k, { ok: false, fetchedRaw: null }, [GREY[0], GREY[1], true])
    );
  });
  cases.push(
    C('16:30, Abrufzeit unlesbar', T1, 0, 'offen', { fetchedRaw: 'kaputt' }, [GREY[0], GREY[1], true]),
    C('16:30, Abrufzeit unlesbar, noch nicht gesehen', T1, 0, 'heli', { fetchedRaw: 'kaputt', isNew: true }, [GREY[0], GREY[1], true, false])
  );
  inZones(cases);
});

test('Platz-Chip: Kalendertag in Zürich, Sommerzeit, Zeitumstellung, Monats- und Jahreswechsel', () => {
  const T2 = zh(2026, 11, 19, 0, 30);                  // 19.11. 00:30 Uhr = 18.11. 23:30 UTC
  const T3 = zh(2026, 11, 18, 23, 59);
  const T4 = zh(2026, 11, 18, 1, 30);
  const S1 = zh(2026, 7, 15, 1, 30);                   // Sommerzeit: 15.07. 01:30 Uhr = 14.07. 23:30 UTC
  const S2 = zh(2026, 7, 15, 12, 0);
  const D1 = zh(2026, 10, 25, 23, 30);                 // 25.10.2026 hat 25 Stunden
  const D2 = zh(2026, 3, 30, 0, 20);                   // 29.03.2026 hat 23 Stunden
  const D3 = zh(2026, 3, 29, 23, 40);
  inZones([
    C('16:30, Abruf heute 00:01 (= 17.11. 23:01 UTC): von heute', T1, zh(2026, 11, 18, 0, 1), 'heli', { ok: false }, ['R', CHIP.heli[1], true]),
    C('16:30, Abruf heute 00:00:00: von heute', T1, zh(2026, 11, 18, 0, 0), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('16:30, Abruf gestern 23:59:59: gestern', T1, zh(2026, 11, 17, 23, 59, 59), 'heli', { ok: false }, [GREY[0], GREY[1], true]),
    C('00:30, Abruf 23:50 (vor 40 min): noch aktuell, kein Hinweis', T2, zh(2026, 11, 18, 23, 50), 'offen', {}, ['G', CHIP.offen[1], false]),
    C('00:30, Abruf 23:40 (vor 50 min, gleicher UTC-Tag): gestern', T2, zh(2026, 11, 18, 23, 40), 'offen', { ok: false }, [GREY[0], GREY[1], true]),
    C('00:30, Abruf 23:40, nur Heli, noch nicht gesehen: gestern, kein «neu»', T2, zh(2026, 11, 18, 23, 40), 'heli', { ok: false, isNew: true },
      [GREY[0], GREY[1], true, false]),
    C('00:30, Abruf 16:00 des Vortags: gestern', T2, zh(2026, 11, 18, 16, 0), 'closed', { ok: false }, [GREY[0], GREY[1], true]),
    C('23:59, Abruf 00:00:30 desselben Tags (fast 24 h alt): von heute', T3, zh(2026, 11, 18, 0, 0, 30), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('23:59, Abruf 07:00, CLOSED: von heute', T3, zh(2026, 11, 18, 7, 0), 'closed', { ok: false }, ['R', CHIP.closed[1], true]),
    C('01:30, Abruf 00:10 (80 min): von heute', T4, zh(2026, 11, 18, 0, 10), 'gelb', { ok: false }, ['Y', CHIP.gelb[1], true]),
    C('01:30, Abruf 23:59 des Vortags (91 min): gestern', T4, zh(2026, 11, 17, 23, 59), 'gelb', { ok: false }, [GREY[0], GREY[1], true]),
    C('Sommer 01:30, Abruf 00:10 (= Vortag 22:10 UTC): von heute', S1, zh(2026, 7, 15, 0, 10), 'heli', { ok: false }, ['R', CHIP.heli[1], true]),
    C('Sommer 01:30, Abruf 23:50 des Vortags (21:50 UTC): gestern', S1, zh(2026, 7, 14, 23, 50), 'heli', { ok: false }, [GREY[0], GREY[1], true]),
    C('Sommer 12:00, Abruf 00:30 (= Vortag 22:30 UTC): von heute', S2, zh(2026, 7, 15, 0, 30), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('Sommer 12:00, Abruf 01:30 (= Vortag 23:30 UTC): von heute', S2, zh(2026, 7, 15, 1, 30), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('25.10. 23:30, Abruf 00:10 (24 h 20 min alt, gleicher Tag): von heute', D1, zh(2026, 10, 25, 0, 10), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('25.10. 23:30, Abruf 24.10. 23:50: gestern', D1, zh(2026, 10, 24, 23, 50), 'offen', { ok: false }, [GREY[0], GREY[1], true]),
    C('30.03. 00:20, Abruf 29.03. 00:30 (22 h 50 min alt): gestern', D2, zh(2026, 3, 29, 0, 30), 'offen', { ok: false }, [GREY[0], GREY[1], true]),
    C('29.03. 23:40, Abruf 00:05 (22 h 35 min alt, gleicher Tag): von heute', D3, zh(2026, 3, 29, 0, 5), 'offen', { ok: false }, ['G', CHIP.offen[1], true]),
    C('01.12. 10:00, Abruf 01.11. 09:00: zu alt', zh(2026, 12, 1, 10, 0), zh(2026, 11, 1, 9, 0), 'offen', { ok: false }, [GREY[0], GREY[1], true]),
    C('18.11.2027 10:00, Abruf 18.11.2026 09:00: zu alt', zh(2027, 11, 18, 10, 0), zh(2026, 11, 18, 9, 0), 'offen', { ok: false }, [GREY[0], GREY[1], true]),
    C('01.01.2027 00:50, Abruf 31.12.2026 23:59: gestern', zh(2027, 1, 1, 0, 50), zh(2026, 12, 31, 23, 59), 'offen', { ok: false }, [GREY[0], GREY[1], true])
  ]);
});

test('Platz-Chip: Abruf genau um Mitternacht gilt als heute, eine Millisekunde davor als gestern', () => {
  const mid = zh(2026, 11, 18, 0, 0, 0, 0);
  let seed = 4711;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2000; i++) {
    const now = mid + 45 * MIN + Math.floor(rnd() * (23 * 60 + 14) * MIN);       // später am selben Tag
    const label = ', jetzt ' + new Date(now).toISOString();
    assert.equal(item(platz('offen', { ok: false, fetched_at_utc: new Date(mid).toISOString() }), '18.11.2026, 07:14', now).chip,
      CHIP.offen[1], 'Abruf 00:00:00.000' + label);
    assert.equal(item(platz('offen', { ok: false, fetched_at_utc: new Date(mid - 1).toISOString() }), '18.11.2026, 07:14', now).chip,
      GREY[1], 'Abruf 23:59:59.999 des Vortags' + label);
  }
});

test('Platz-Chip: ohne Daten «nicht verfügbar», noch nicht geladen kein Chip', () => {
  const a = item(null, null, T1);
  const b = item({ ok: false, fetched_at_utc: null, updated: null, status: null }, null, T1);
  assert.deepEqual([a.color, a.chip], ['N', 'Platz: nicht verfügbar']);
  assert.deepEqual([b.color, b.chip], ['N', 'Platz: nicht verfügbar']);
  assert.equal(item(undefined, null, T1), null);
});

test('Platz-Chip: Wortlaut des Hinweises im Detail-Fenster und Wertzeile bei veraltetem Stand von heute', () => {
  const it = item(platz('heli', { ok: false, fetched_at_utc: isoAt(zh(2026, 11, 18, 13, 30)) }), null, T1);
  assert.ok(it.text.startsWith('<div class="brf-src" style="color:#f87171;">⚠ Letzter erfolgreicher Abruf 18.11., 13:30 – aktueller Stand nur auf fgzo.ch.</div>'), it.text);
  assert.ok(it.text.includes('abgerufen: 18.11., 13:30'), it.text);
  assert.ok(it.value.startsWith('OPEN – für Flächenflugzeuge gesperrt (nur Helikopterbetrieb)'), it.value);
  assert.deepEqual([it.color, it.chip], ['R', 'Platz: nur Heli' + NEU]);       // noch nicht gesehen
});
