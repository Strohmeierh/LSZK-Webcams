/* Start- und Landestreckenrechner – Anzeige in #perf-card / #perf-content (Datenschema 2).
   Liest window.LSZK_WX (vom Wetterteil der Seite gesetzt) und bekommt Updates über window.LszkPerf.update(wx).
   Lädt perf/aircraft/index.json, die gewählte Flugzeugdatei, perf/airfields/<data-airfield>.json und
   data/fgzo_status.json, rechnet mit window.LszkPerfCore (perf/perf.js) und schreibt die Karte.
   Grundsatz: lieber kein Wert als ein falscher. Ohne gültige, frische Messwerte keine Zahlen.
   Gezeigt wird nur die Piste mit Gegenwind. Nass gilt die Piste bei einer FGZO-Meldung ungleich DRY oder bei Regen.
   Browser: window.LszkPerf = { update, version, _tick }. Node: reine Funktionen für die Tests.
   VERSION gleich dem ?v= in index.html und in perf/perf.js halten.
   Browsercode in ES2015, ohne Optional Chaining, Nullish Coalescing und Lookbehind. */
(function (root, factory) {
  var isNode = typeof module === 'object' && module && module.exports;
  var core = isNode ? require('./perf.js') : (root && root.LszkPerfCore);
  var api = factory(core);
  if (isNode) module.exports = api;
  else api.boot(root);
}(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  var VERSION = 1;

  var STALE_MIN = 45;          // Messwerte älter: keine Zahlen
  var FUTURE_MIN = 5;          // Messzeit weiter in der Zukunft: keine Zahlen
  var FGZO_FRESH_MIN = 45;     // wie FGZO_FRESH_MIN in index.html (fgzoItem, aiFgzoSperre)
  var FGZO_WAIT_MS = 5000;     // bis zum ersten FGZO-Abruf höchstens so lange «Lade Flugplatzstatus …»
  var RETRY_MS = 60000;        // neuer Ladeversuch der Daten frühestens nach 60 s
  var TICK_MS = 60000;         // Alter neu rechnen
  var STORE_KEY = 'lszk-perf-aircraft';
  var TZ = 'Europe/Zurich';
  var FGZO_TEXT_MAX = 40;      // Pistenzustand und Zeitstempel der FGZO
  var FGZO_REASON_MAX = 60;    // Grund einer Platzsperre (flaeche_grund)
  var LABEL_MAX = 60;
  // Entscheid F-C: Regen von MeteoSchweiz macht die Piste nass (neben einer FGZO-Meldung ungleich DRY)
  var WET_BY_RAIN = true;

  var TEXT = {
    noData: 'Keine aktuellen Messwerte vom Platz – keine Berechnung.',
    speck: 'Zurzeit nur Werte der Station Speck verfügbar (Wind zu tief gemessen, Richtungsbezug unbekannt) – keine Berechnung.',
    dataError: 'Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.',
    internal: 'Rechenfehler – keine Berechnung.',
    loading: 'Lade Flugzeug- und Platzdaten …',
    fgzoLoading: 'Lade Flugplatzstatus …',
    noHeadwindRunway: 'Keine Piste mit Gegenwind in den Platzdaten – keine Berechnung.',
    footerGeneric: 'Richtwert nach AFM ohne eigenen Sicherheitszuschlag. Massgebend sind das AFM der jeweiligen Maschine und die eigene Beurteilung.',
    selectLabel: 'Flugzeug',
    calm: 'Windstill (Mittelwind unter 1 kt): keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet.',
    nodir: 'Windrichtung nicht gemeldet: keine Gegenwindpiste bestimmbar. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.',
    cross: 'Wind genau quer zur Piste: keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.',
    noFgzo: 'Pistenzustand: keine aktuelle Meldung der FGZO.',
    noRainHour: 'MeteoSchweiz hat in der letzten Stunde keinen Regen gemessen.',
    noRainRate: 'MeteoSchweiz misst zurzeit keinen Regen; die Stundensumme fehlt.',
    rainMissing: 'Ein Regenwert von MeteoSchweiz fehlt.',
    unknown: 'Pistenzustand unbekannt: keine aktuelle Meldung der FGZO und kein Regenwert von MeteoSchweiz.',
    reserve: 'Tau, Reif, eben einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.',
    ruleWind: 'Wind: Gerechnet wird nur die Piste mit Gegenwind. Der Gegenwind stammt aus dem 10-min-Mittelwind, wird auf ganze kt ' +
      'abgerundet und voll angerechnet. Bei Windstille (Mittelwind unter 1 kt), ohne gemeldete Windrichtung oder bei Wind genau quer ' +
      'werden beide Pisten ohne Windkorrektur gerechnet. Rückenwind wird nicht gerechnet. Kein Wert bei Gegenwind über 40 kt oder wenn ' +
      'die Windkorrektur des AFM eine Strecke um mehr als die Hälfte verkürzen würde.',
    ruleRound: 'Rundung immer zur längeren Strecke: Gegenwind abgerundet, Ergebnis auf ganze Meter aufgerundet. Die Zwischenwerte im ' +
      'Rechenweg sind auf 0,01 aufgerundet angezeigt; gerechnet wird ungerundet.',
    ruleGrass: 'Gras: Zuschlag laut AFM in Prozent der Tabellen-Rollstrecke (bei Interpolation der interpolierten), auf beide Strecken. ' +
      'Faktoren des AFM wirken auf beide Strecken nach Wind- und Graskorrektur. Kein eigener Sicherheitszuschlag.',
    ruleWet: 'Nasse Piste: Die Piste gilt als nass, wenn die FGZO einen anderen Pistenzustand als DRY meldet oder MeteoSchweiz in der ' +
      'letzten Stunde oder in den letzten 10 min Regen gemessen hat. Der Regenwert kann bis zu 60 min alt sein. Tau, Reif, eben ' +
      'einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.'
  };

  var FIELD_LABEL = {
    tempC: 'Temperatur', qnhHpa: 'QNH', windKt: 'Wind', windDir: 'Windrichtung', windDirTrue: 'Windrichtung'
  };
  var SURFACE_LABEL = { grass: 'Gras', paved: 'Hartbelag' };
  var SURFACE_TEXT = { 'grass/dry': 'trockenes Gras', 'paved/dry': 'trockenen Hartbelag' };
  var SURFACE_WET = { grass: 'nasses Gras', paved: 'nassen Hartbelag' };
  var PHASE_LABEL = { takeoff: 'Start', landing: 'Landung' };

  var CSS = [
    '#perf-content { font-size: 0.82rem; line-height: 1.5; color: var(--text); overflow-wrap: break-word; }',
    '.perf-ac { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: 0 0 6px; font-weight: 600; color: var(--text); }',
    '.perf-ac-label { color: var(--text-muted); font-weight: 600; font-size: 0.78rem; }',
    '.perf-select { font: inherit; font-weight: 600; color: var(--text); background: var(--bg); border: 1px solid var(--card-border); border-radius: 6px; padding: 4px 8px; max-width: 100%; }',
    '.perf-head { color: var(--text-muted); margin: 0 0 6px; }',
    '.perf-meas { color: var(--text-muted); margin: 0 0 8px; }',
    '.perf-note { color: #fcd34d; font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-cond { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 12px; }',
    '.perf-cond.perf-warn { color: #fcd34d; background: rgba(245, 158, 11, 0.12); border-left: 3px solid #f59e0b; padding: 8px 10px; font-size: 0.82rem; font-weight: 600; }',
    '.perf-cond.perf-warn div + div { margin-top: 4px; }',
    '.perf-hint { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; margin: 0 0 8px; }',
    '.perf-block { background: rgba(0, 0, 0, 0.2); border-radius: 8px; padding: 10px 12px; min-width: 0; }',
    '.perf-block-title { margin: 0 0 6px; }',
    '.perf-rwy { font-size: 0.9rem; font-weight: 600; color: var(--text); white-space: nowrap; }',
    '.perf-wind { font-size: 0.78rem; color: var(--text-muted); }',
    '.perf-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }',
    '.perf-table th, .perf-table td { padding: 4px; text-align: right; white-space: nowrap; }',
    '.perf-table thead th { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); white-space: normal; vertical-align: bottom; }',
    '.perf-table th:first-child { text-align: left; }',
    '.perf-table tbody th { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); }',
    '.perf-table td { font-size: 0.85rem; color: var(--text); }',
    '.perf-table tbody tr { border-top: 1px solid var(--card-border); }',
    '.perf-amber { color: #f59e0b; font-weight: 700; }',
    '.perf-red { color: #ef4444; font-weight: 700; }',
    '.perf-findings { margin: 6px 0 0; }',
    '.perf-finding { font-size: 0.78rem; line-height: 1.45; margin: 3px 0 0; }',
    '.perf-finding.perf-red, .perf-finding.perf-amber { font-weight: 600; }',
    '.perf-nov { color: #f87171; }',
    '.perf-skip { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-factor { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 10px; }',
    '.perf-state { color: #f87171; font-size: 0.85rem; margin: 4px 0 10px; }',
    '.perf-loading { color: var(--text-muted); font-size: 0.85rem; margin: 4px 0 10px; }',
    '.perf-details { margin: 0 0 10px; font-size: 0.78rem; color: var(--text-muted); }',
    '.perf-details summary { cursor: pointer; padding: 2px 0; }',
    '.perf-calc p { margin: 6px 0; }',
    '.perf-calc ul { margin: 2px 0 6px; padding-left: 18px; }',
    '.perf-calc li { margin: 2px 0; }',
    '.perf-calc-h { color: var(--text); font-weight: 600; }',
    '.perf-foot { font-size: 0.72rem; color: var(--text-muted); line-height: 1.5; border-top: 1px solid var(--card-border); padding-top: 8px; margin-top: 4px; }',
    '@media (max-width: 600px) {',
    '  .perf-ac { display: block; }',
    '  .perf-ac-label { display: block; margin: 0 0 4px; }',
    '  .perf-select { display: block; width: 100%; font-size: 16px; min-height: 44px; }',
    '}',
    '@media (max-width: 400px) {',
    '  .perf-block { padding: 8px; }',
    '  .perf-table th, .perf-table td { padding: 3px; }',
    '  .perf-table thead th { font-size: 0.62rem; }',
    '  .perf-table tbody th { font-size: 0.72rem; }',
    '  .perf-table td { font-size: 0.78rem; }',
    '}'
  ].join('\n');

  /* ── Hilfen ────────────────────────────────────────────────── */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function str(v) { return typeof v === 'string' ? v : ''; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clip(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  // Tausendertrenner wie aiThousands in index.html
  function thousands(digits) { return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "'"); }

  // Ganze Zahl (kaufmännisch gerundet), Apostroph, echtes Minuszeichen
  function fmtInt(n) {
    var r = Math.round(n);
    if (r === 0) r = 0;
    return (r < 0 ? '−' : '') + thousands(String(Math.abs(r)));
  }

  // Dezimalzahl mit Komma und fester Stellenzahl
  function fmtDec(x, d) {
    var s = Math.abs(x).toFixed(d);
    var neg = x < 0 && Number(s) !== 0;
    var parts = s.split('.');
    return (neg ? '−' : '') + thousands(parts[0]) + (parts.length > 1 ? ',' + parts[1] : '');
  }

  // Höchstens d Nachkommastellen, nachfolgende Nullen weg (Werte ≥ 0)
  function fmtTrim(x, d) {
    var s = fmtDec(x, d);
    return s.indexOf(',') < 0 ? s : s.replace(/0+$/, '').replace(/,$/, '');
  }

  // Zwischenwert im Rechenweg: auf 0,01 aufgerundet, höchstens zwei Nachkommastellen
  function fmtUp2(x) { return fmtTrim(Math.ceil(x * 100 - 1e-6) / 100, 2); }

  // Faktor mit zwei Stellen (1,10), bei drei Dezimalen mit drei
  function fmtFactor(f) { return Math.abs(f * 100 - Math.round(f * 100)) < 1e-9 ? fmtDec(f, 2) : fmtDec(f, 3); }

  // Prozent eines Faktors: 1,2 → 20
  function fmtFactorPct(f) { return fmtTrim(Math.round((f - 1) * 100000) / 1000, 3); }

  // QNH ohne Tausendertrenner, eine Nachkommastelle: «1022,0»
  function fmtQnh(v) {
    var s = Math.abs(v).toFixed(1);
    return (v < 0 && Number(s) !== 0 ? '−' : '') + s.replace('.', ',');
  }

  function ceilEps(x) { return Math.ceil(x - (core ? core.EPS : 1e-9)); }

  // Wind: unter 1 kt mit einer Dezimale, sonst ganze kt
  function fmtKt(v) { return v > 0 && v < 1 ? fmtDec(v, 1) : fmtInt(v); }

  function fmtClock(ms) {
    return new Date(ms).toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  }

  function dayKey(ms) {
    return new Date(ms).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
  }

  function fmtStamp(ms, nowMs) {
    var s = fmtClock(ms) + ' Uhr';
    if (dayKey(ms) !== dayKey(nowMs)) {
      s = new Date(ms).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', timeZone: TZ }) + ', ' + s;
    }
    return s;
  }

  // Alter wie formatRelativeAge in index.html
  function fmtAge(ageMin) {
    var totalMin = Math.floor(ageMin);
    if (totalMin < 1) return 'gerade eben';
    if (totalMin < 60) return 'vor ' + totalMin + ' min';
    var hr = Math.floor(totalMin / 60);
    var rem = totalMin % 60;
    if (hr < 24) return rem === 0 ? 'vor ' + hr + ' h' : 'vor ' + hr + ' h ' + rem + ' min';
    var days = Math.floor(hr / 24);
    return 'vor ' + days + (days === 1 ? ' Tag' : ' Tagen');
  }

  /* ── Adapter: window.LSZK_WX → Eingabe des Rechenkerns ────── */
  function rainValue(v) { return isNum(v) && v >= 0 ? v : null; }

  function adaptLszkWx(w, nowMs) {
    if (!w || typeof w !== 'object') return { ok: false, code: 'no-data' };
    if (w.src !== 'pfa') return { ok: false, code: w.src === 'speck' ? 'source-speck' : 'no-source' };
    if (!isNum(w.time)) return { ok: false, code: 'no-time' };
    var ageMin = (nowMs - w.time) / 60000;
    if (w.stale === true || ageMin > STALE_MIN || ageMin < -FUTURE_MIN) {
      return { ok: false, code: 'stale', time: w.time, ageMin: ageMin, future: ageMin < -FUTURE_MIN };
    }
    var missing = [];
    ['tempC', 'qnhHpa', 'windKt'].forEach(function (k) {
      if (!isNum(w[k])) missing.push(k);
    });
    var dir = w.windDir;
    if (dir === undefined || dir === null) dir = null;          // Richtung unbestimmt
    else if (!isNum(dir)) missing.push('windDir');
    if (missing.length) return { ok: false, code: 'missing', fields: missing, time: w.time, ageMin: ageMin };
    return {
      ok: true, time: w.time, ageMin: ageMin,
      srcLabel: typeof w.srcLabel === 'string' ? w.srcLabel : '',
      wx: { tempC: w.tempC, qnhHpa: w.qnhHpa, windDirTrue: dir, windKt: w.windKt },
      gustKt: isNum(w.gustKt) && w.gustKt >= 0 ? w.gustKt : null,      // nur Anzeige
      rain1hMm: rainValue(w.rain1hMm),
      rainMmH: rainValue(w.rainMmH)
    };
  }

  /* ── FGZO-Status: Pistenzustand und Platzsperre ─────────────
     Frisch heisst wie in index.html: letzter erfolgreicher Abruf (fetched_at_utc) jünger als 45 min; ok=false zählt nicht.
     Sperre wie aiFgzoSperre: frischer Abruf und flaeche «gesperrt». Pistenzustand wie fgzoItem: mit FGZO-Zeitstempel. */
  function fgzoState(p, nowMs) {
    var st = { kind: 'unknown', closed: false, closedReason: '' };
    if (!p || typeof p !== 'object') return st;
    var t = p.fetched_at_utc ? new Date(p.fetched_at_utc).getTime() : NaN;
    if (!isNum(t)) return st;
    if ((nowMs - t) / 60000 >= FGZO_FRESH_MIN) { st.stale = true; return st; }
    if (p.flaeche === 'gesperrt') {
      st.closed = true;
      st.closedReason = typeof p.flaeche_grund === 'string' ? p.flaeche_grund : '';
    }
    if (!p.updated) return st;
    var cond = p.runway_condition == null ? '' : String(p.runway_condition).replace(/\s+/g, ' ').trim().toUpperCase();
    if (!cond) return st;
    st.kind = cond === 'DRY' ? 'dry' : 'notdry';
    st.condition = cond;
    st.updated = String(p.updated);
    return st;
  }

  /* ── Regen und Nässe ───────────────────────────────────────── */
  // Regen: Stundensumme > 0 oder 10-min-Rate > 0. Bekannt, wenn mindestens einer der beiden Werte vorliegt.
  function rainState(a) {
    var h = a ? a.rain1hMm : null, r = a ? a.rainMmH : null;
    h = isNum(h) && h >= 0 ? h : null;
    r = isNum(r) && r >= 0 ? r : null;
    if (h !== null && h > 0) return { rain: true, known: true, basis: 'hour', mm: h, mmH: r };
    if (r !== null && r > 0) return { rain: true, known: true, basis: 'rate', mm: h, mmH: r };
    if (h !== null) return { rain: false, known: true, basis: 'hour', mm: h, mmH: r };
    if (r !== null) return { rain: false, known: true, basis: 'rate', mm: null, mmH: r };
    return { rain: false, known: false, basis: null, mm: null, mmH: null };
  }

  // Nass: frische FGZO-Meldung ungleich DRY oder Regen. Unbekannt: keine frische Meldung und kein Regenwert.
  function wetState(fg, rn) {
    var byFgzo = fg.kind === 'notdry';
    var byRain = WET_BY_RAIN && rn.rain;
    var wet = byFgzo || byRain;
    return { wet: wet, byFgzo: byFgzo, byRain: byRain, unknown: !wet && fg.kind === 'unknown' && (!WET_BY_RAIN || !rn.known) };
  }

  /* ── Flugzeugliste ─────────────────────────────────────────── */
  function parseIndex(x) {
    if (!x || typeof x !== 'object' || x.schema !== 2 || !Array.isArray(x.aircraft) || !x.aircraft.length) return null;
    var ids = {};
    var list = [];
    for (var i = 0; i < x.aircraft.length; i++) {
      var e = x.aircraft[i];
      if (!e || typeof e.id !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(e.id) || ids[e.id] ||
          typeof e.file !== 'string' || !/^[a-z0-9_-]{1,40}\.json$/.test(e.file) ||
          typeof e.label !== 'string' || !e.label) return null;
      var regs = e.registrations === undefined ? [] : e.registrations;
      if (!Array.isArray(regs) || !regs.every(function (r) { return typeof r === 'string' && r.length > 0 && r.length <= 20; })) return null;
      ids[e.id] = true;
      list.push({ id: e.id, label: e.label, file: e.file, registrations: regs.slice() });
    }
    if (!ids[x.default]) return null;
    return { list: list, def: x.default };
  }

  function pickEntry(index, wantedId) {
    var i;
    for (i = 0; i < index.list.length; i++) if (index.list[i].id === wantedId) return index.list[i];
    for (i = 0; i < index.list.length; i++) if (index.list[i].id === index.def) return index.list[i];
    return null;
  }

  /* ── HTML-Bausteine ────────────────────────────────────────── */
  function footerHtml(ac) {
    var t = ac && typeof ac.footerDe === 'string' && ac.footerDe ? esc(ac.footerDe) : TEXT.footerGeneric;
    return '<div class="perf-foot">' + t + '</div>';
  }
  function stateHtml(text) { return '<div class="perf-state" role="status">' + text + '</div>'; }

  function optionText(e) {
    return clip(e.label, LABEL_MAX) + (e.registrations && e.registrations.length ? ' · ' + e.registrations.join(', ') : '');
  }

  // Erste Zeile: Auswahl ab zwei Mustern, sonst derselbe Text ohne <select>
  function selectionHtml(list, selectedId) {
    if (!list || !list.length) return '';
    if (list.length < 2) return '<div class="perf-ac">' + esc(optionText(list[0])) + '</div>';
    return '<div class="perf-ac"><label class="perf-ac-label" for="perf-ac">' + TEXT.selectLabel + '</label>' +
      '<select id="perf-ac" class="perf-select">' + list.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(optionText(e)) + '</option>';
      }).join('') + '</select></div>';
  }

  function headHtml(ac) {
    var parts = ['Maximales Abfluggewicht ' + fmtInt(ac.mass.kg) + '&nbsp;kg (' + fmtInt(ac.mass.lb) + '&nbsp;lb)'];
    if (str(ac.techniqueDe)) parts.push(esc(ac.techniqueDe));
    if (str(ac.variantDe)) parts.push(esc(ac.variantDe));
    return '<div class="perf-head">' + parts.join(' · ') + '</div>';
  }

  function noticeHtml(notice) {
    return notice ? '<div class="perf-note" role="status">' + esc(notice) + '</div>' : '';
  }

  // Belag, für den gerechnet wird (Tabellenbasis bei gleichem Belag, sonst angewendete Belagsregel)
  function surfaceText(ac, af) {
    var seen = {};
    var out = [];
    af.runways.forEach(function (r) {
      core.PHASES.forEach(function (ph) {
        var ch = ac.charts[ph];
        var cond = null;
        if (r.surface === ch.base.surface) {
          cond = ch.base.surfaceCondition;
        } else {
          ch.corrections.forEach(function (c) {
            if (c.kind === 'surface' && c.surface === r.surface) cond = c.surfaceCondition;
          });
        }
        if (cond === null) return;
        var key = r.surface + '/' + cond;
        if (seen[key]) return;
        seen[key] = true;
        out.push(SURFACE_TEXT[key] || esc(r.surface) + ' (' + esc(cond) + ')');
      });
    });
    return out.join(', ');
  }

  function adapterText(a, nowMs) {
    switch (a.code) {
      case 'source-speck': return TEXT.speck;
      case 'stale':
        if (a.future) return 'Messzeit unplausibel (Stand ' + fmtStamp(a.time, nowMs) + ', liegt in der Zukunft) – keine Berechnung.';
        return 'Messwerte veraltet (Stand ' + fmtStamp(a.time, nowMs) + ', ' + fmtAge(a.ageMin) + ') – keine Berechnung.';
      case 'missing':
        return 'Messwert fehlt (' + a.fields.map(function (f) { return FIELD_LABEL[f] || esc(f); }).join(', ') + ') – keine Berechnung.';
      default: return TEXT.noData;          // no-data, no-source, no-time
    }
  }

  function fieldValueText(f, v) {
    var label = FIELD_LABEL[f] || esc(f);
    if (!isNum(v)) return label;
    switch (f) {
      case 'tempC': return label + ' ' + fmtDec(v, 1) + '&nbsp;°C';
      case 'qnhHpa': return label + ' ' + fmtQnh(v) + '&nbsp;hPa';
      case 'windDirTrue': return label + ' ' + fmtDec(v, 0) + '°';
      default: return label + ' ' + fmtDec(v, 1) + '&nbsp;kt';
    }
  }

  function errorTexts(res) {
    var e = res.error || {};
    if (e.code === 'invalid-input') {
      return ['Messwert unplausibel (' + (e.fields || []).map(function (x) { return fieldValueText(x.field, x.value); }).join(', ') +
        ') – keine Berechnung.'];
    }
    if (e.code === 'above-range') {
      return (e.above || []).map(function (a) {
        if (a.quantity === 'temperature') {
          return 'Temperatur ' + fmtDec(a.value, 1) + '&nbsp;°C liegt über dem Tabellenbereich des AFM (bis ' + fmtInt(a.max) + '&nbsp;°C) – kein Wert.';
        }
        if (a.quantity === 'pressureAltitude') {
          return 'Druckhöhe ' + fmtInt(ceilEps(a.value)) + '&nbsp;ft liegt über dem Tabellenbereich des AFM (bis ' + fmtInt(a.max) + '&nbsp;ft) – kein Wert.';
        }
        return 'Eingabe liegt über dem Tabellenbereich des AFM – kein Wert.';
      });
    }
    if (e.code === 'bad-data') return [TEXT.dataError];
    return [TEXT.internal];
  }

  function measHtml(a, res, nowMs) {
    var w = a.wx;
    var s = 'Messwerte' + (a.srcLabel ? ' ' + esc(clip(a.srcLabel, LABEL_MAX)) : '') + ', ' + fmtStamp(a.time, nowMs) +
      ' (' + fmtAge(a.ageMin) + '): ' + fmtDec(w.tempC, 1) + '&nbsp;°C · QNH ' + fmtQnh(w.qnhHpa) + '&nbsp;hPa · Wind ';
    if (w.windDirTrue === null) s += fmtKt(w.windKt) + '&nbsp;kt, Richtung unbestimmt';
    else s += fmtInt(w.windDirTrue) + '° / ' + fmtKt(w.windKt) + '&nbsp;kt';
    if (a.gustKt !== null) s += ', Böen ' + fmtKt(a.gustKt) + '&nbsp;kt';
    s += ' · Druckhöhe ' + fmtInt(ceilEps(res.pressureAltitudeFt)) + '&nbsp;ft';
    return '<div class="perf-meas">' + s + '</div>';
  }

  /* ── Pistenzustand, Sperre und Nässe ───────────────────────── */
  function closureText(fg) {
    if (fg.closedReason === 'geschlossen') return 'Platz laut FGZO geschlossen.';
    var reason = clip(fg.closedReason, FGZO_REASON_MAX);
    return 'Platz laut FGZO für Flächenflugzeuge gesperrt' + (reason ? ' (' + esc(reason) + ')' : '') + '.';
  }

  function fmtMm(v) { return fmtTrim(v, 2); }

  function wetSourceText(fg, rn, ws) {
    var parts = [];
    if (ws.byFgzo) parts.push('FGZO meldet «' + esc(clip(fg.condition, FGZO_TEXT_MAX)) + '» (Stand ' + esc(clip(fg.updated, FGZO_TEXT_MAX)) + ')');
    if (ws.byRain) {
      parts.push(rn.basis === 'hour'
        ? 'MeteoSchweiz hat in der letzten Stunde ' + fmtMm(rn.mm) + '&nbsp;mm Regen gemessen'
        : 'MeteoSchweiz misst Regen (' + fmtMm(rn.mmH) + '&nbsp;mm/h)');
    }
    return 'Piste gilt als nass: ' + parts.join('; ') + '.';
  }

  function wetWording(res) {
    var surfaces = {};
    res.runways.forEach(function (r) { if (r.computed) surfaces[r.surface] = true; });
    var keys = Object.keys(surfaces);
    return keys.length === 1 && SURFACE_WET[keys[0]] ? SURFACE_WET[keys[0]] : 'nasse Piste';
  }

  // Folge je Phase aus der Rechnung: eingerechneter Nässefaktor oder Hinweis, dass das AFM keinen Wert nennt
  function wetConsequences(res) {
    var info = {};
    core.PHASES.forEach(function (ph) {
      var factor = null, missing = false;
      res.runways.forEach(function (r) {
        var p = r.computed ? r[ph] : null;
        if (!p || !p.ok) return;
        p.factors.forEach(function (f) { if (f.when === 'wet' && !factor) factor = f; });
        if (p.wetFactorMissing) missing = true;
      });
      info[ph] = { factor: factor, missing: missing && !factor };
    });
    var what = wetWording(res);
    var out = [];
    if (info.takeoff.missing && info.landing.missing) {
      out.push('Das AFM nennt für ' + what + ' keinen Wert; Start- und Landestrecke können deutlich länger sein.');
      return out;
    }
    core.PHASES.forEach(function (ph) {
      var x = info[ph];
      if (x.factor) {
        out.push(PHASE_LABEL[ph] + ': ' + (x.factor.minimum ? 'mindestens ' : '') + '+' + fmtFactorPct(x.factor.factor) + '&nbsp;% eingerechnet (' +
          esc(x.factor.refDe) + ').');
      } else if (x.missing) {
        out.push(PHASE_LABEL[ph] + ': Das AFM nennt für ' + what + ' keinen Wert; die Strecke kann deutlich länger sein.');
      }
    });
    return out;
  }

  function rainSentence(rn) {
    if (!rn.known) return TEXT.rainMissing;
    return rn.basis === 'hour' ? TEXT.noRainHour : TEXT.noRainRate;
  }

  function conditionHtml(fg, rn, ws, ac, af, res) {
    var h = '';
    var warn = [];
    if (fg.closed) warn.push('<div>' + closureText(fg) + '</div>');
    if (ws.wet) {
      var wet = [wetSourceText(fg, rn, ws)].concat(wetConsequences(res));
      if (str(ac.wetNoteDe)) wet.push(esc(ac.wetNoteDe));
      warn.push('<div>' + wet.join(' ') + '</div>');
    }
    if (warn.length) h += '<div class="perf-cond perf-warn" role="note">' + warn.join('') + '</div>';
    if (!ws.wet) {
      var surf = surfaceText(ac, af);
      var tail = (surf ? 'Gerechnet für ' + surf + '. ' : '') + TEXT.reserve;
      if (ws.unknown) {
        h += '<div class="perf-note">' + TEXT.unknown + '</div><div class="perf-cond">' + tail + '</div>';
      } else {
        var state = fg.kind === 'dry' ? 'Pistenzustand laut FGZO: DRY (Stand ' + esc(clip(fg.updated, FGZO_TEXT_MAX)) + ').' : TEXT.noFgzo;
        h += '<div class="perf-cond">' + state + ' ' + rainSentence(rn) + ' ' + tail + '</div>';
      }
    }
    return h;
  }

  /* ── Pistenblöcke ──────────────────────────────────────────── */
  function isCross(res) {
    if (res.mode !== 'dir') return false;
    var computed = res.runways.filter(function (r) { return r.computed; });
    return computed.length > 0 && computed.every(function (r) { return r.wind.along === 0; });
  }

  function windTitle(r) {
    var w = r.wind;
    if (w.mode !== 'dir' || w.along === 0) return 'ohne Windkorrektur';
    if (w.kt >= 1) return 'Gegenwind ' + w.kt + '&nbsp;kt';
    return 'Gegenwind unter 1&nbsp;kt, nicht angerechnet';
  }

  function reasonText(label, p) {
    switch (p.reason) {
      case 'headwind-limit':
        return 'Gegenwind ' + p.wind.kt + '&nbsp;kt: ausserhalb des Bereichs, in dem die Windkorrektur des AFM sinnvoll ist. Kein Wert.';
      case 'wind-credit-limit':
        return label + ': Bei ' + p.wind.kt + '&nbsp;kt Gegenwind würde die Windkorrektur des AFM die Strecke um mehr als die Hälfte verkürzen. Kein Wert.';
      case 'no-surface-rule':
        return label + ': keine Korrektur für den Pistenbelag in den Flugzeugdaten. Kein Wert.';
      default:
        return label + ': Rechenfehler – kein Wert.';
    }
  }

  function distCell(p, key) {
    if (!p.ok) return '<td>–</td>';
    var v = fmtInt(p.m[key]) + '&nbsp;m';
    if (p.exceeds[key]) v = '<span class="' + (key === 'groundRoll' ? 'perf-red' : 'perf-amber') + '">' + v + '</span>';
    return '<td>' + v + '</td>';
  }

  function blockHtml(rw) {
    var phases = [['Start', rw.takeoff], ['Landung', rw.landing]];
    var rows = phases.map(function (x) {
      var p = x[1];
      return '<tr><th scope="row">' + x[0] + '</th>' + distCell(p, 'groundRoll') + distCell(p, 'overObstacle') +
        '<td>' + fmtInt(p.availableM) + '&nbsp;m</td></tr>';
    }).join('');
    var seen = {};
    var findings = [];
    phases.forEach(function (x) {
      var label = x[0], p = x[1], h = null;
      if (p.ok) {
        // Je Phase höchstens eine Feststellung, die schwerere gewinnt
        if (p.exceeds.groundRoll) h = '<div class="perf-finding perf-red">' + label + ': Rollstrecke länger als die verfügbare Länge.</div>';
        else if (p.exceeds.overObstacle) h = '<div class="perf-finding perf-amber">' + label + ': Strecke über 15 m länger als die verfügbare Länge.</div>';
      } else {
        h = '<div class="perf-finding perf-nov">' + reasonText(label, p) + '</div>';
      }
      if (h && !seen[h]) { seen[h] = true; findings.push(h); }
    });
    return '<section class="perf-block" aria-label="Piste ' + esc(rw.id) + '">' +
      '<div class="perf-block-title"><span class="perf-rwy">Piste ' + esc(rw.id) + '</span> · <span class="perf-wind">' + windTitle(rw) + '</span></div>' +
      '<table class="perf-table"><thead><tr><th></th><th scope="col">Rollstrecke</th><th scope="col">über 15 m</th><th scope="col">verfügbar</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      (findings.length ? '<div class="perf-findings">' + findings.join('') + '</div>' : '') +
      '</section>';
  }

  // Faktorzeile nur für Faktoren, die immer gelten
  function factorLineHtml(ac) {
    var items = [];
    core.PHASES.forEach(function (ph) {
      ac.charts[ph].corrections.forEach(function (c) {
        if (c.kind === 'factor' && c.when === 'always') items.push({ ph: ph, c: c });
      });
    });
    if (!items.length) return '';
    var sameLabel = items.every(function (x) { return x.c.labelDe === items[0].c.labelDe; });
    var parts = items.map(function (x) {
      return PHASE_LABEL[x.ph] + ' × ' + fmtFactor(x.c.factor) + ' (' + (sameLabel ? '' : esc(x.c.labelDe) + ', ') + esc(x.c.refDe) + ')';
    });
    return '<div class="perf-factor">Eingerechnet nach AFM: ' + (sameLabel ? esc(items[0].c.labelDe) + ' – ' : '') + parts.join(', ') + '.</div>';
  }

  /* ── Rechenweg und Quellen ─────────────────────────────────── */
  var AXIS_TEXT = { pressureAltitude: ['Druckhöhe', 'ft'], temperature: ['Temperatur', '°C'] };

  function axisLine(lk, res, af) {
    return lk.axes.map(function (a, k) {
      var t = AXIS_TEXT[a.quantity] || [esc(a.quantity), ''];
      var shown = a.quantity === 'pressureAltitude' ? fmtInt(ceilEps(a.input)) : fmtDec(a.input, 1);
      var s = t[0] + ' ' + shown + '&nbsp;' + t[1];
      if (a.quantity === 'pressureAltitude') {
        s += ' (aus QNH ' + fmtQnh(res.input.qnhHpa) + '&nbsp;hPa und Platzhöhe ' + fmtInt(af.elevation.value) + '&nbsp;ft)';
      }
      if (a.weight !== undefined) {
        return s + ' → zwischen den Tabellenspalten ' + fmtInt(a.lower) + '&nbsp;' + t[1] + ' und ' + fmtInt(a.upper) + '&nbsp;' + t[1] +
          ' linear interpoliert (Gewicht ' + fmtTrim(Math.round(a.weight * 1000) / 1000, 3) + ')';
      }
      var word = k === 0 ? 'Tabellenzeile' : (k === 1 ? 'Tabellenspalte' : 'Tabellenwert');
      return s + ' → ' + word + ' ' + fmtInt(a.value) + '&nbsp;' + t[1] + (a.belowLowest ? ' (kleinster Tabellenwert)' : '');
    }).join(' · ');
  }

  function windDetail(r, inp) {
    var w = r.wind;
    if (w.mode === 'calm') return 'Mittelwind ' + fmtDec(inp.windKt, 1) + '&nbsp;kt, unter ' + fmtDec(core.CALM_BELOW_KT, 0) + '&nbsp;kt: windstill, ohne Windkorrektur.';
    if (w.mode === 'nodir') return 'Windrichtung nicht gemeldet: ohne Windkorrektur.';
    var s = 'Wind aus ' + fmtInt(inp.windDirTrue) + '°: ';
    if (w.along === 0) return s + 'genau quer zur Piste, keine Längskomponente.';
    return s + 'Gegenwindkomponente ' + fmtDec(w.componentKt, 2) + '&nbsp;kt aus dem Mittelwind ' + fmtDec(inp.windKt, 1) +
      '&nbsp;kt, abgerundet ' + w.kt + '&nbsp;kt.';
  }

  // Wert der Tabelle oder Zwischenwert: ganze Zahlen bleiben ganz, sonst auf 0,01 aufgerundet
  function num(x) { return Math.abs(x - Math.round(x)) < 1e-9 ? fmtInt(x) : fmtUp2(x); }
  function pair(a, b, unit) { return num(a) + '&nbsp;/&nbsp;' + num(b) + '&nbsp;' + unit; }

  function phaseLine(label, p) {
    var u = p.unit;
    var lk = p.lookup;
    var s = '<li>' + label + ': Tabelle ';
    if (lk.interpolated) {
      var c = lk.columns;
      s += pair(c.lower.groundRoll, c.lower.overObstacle, u) + ' bei ' + fmtInt(c.lowerValue) + '&nbsp;°C und ' +
        pair(c.upper.groundRoll, c.upper.overObstacle, u) + ' bei ' + fmtInt(c.upperValue) + '&nbsp;°C, Gewicht ' +
        fmtTrim(Math.round(c.weight * 1000) / 1000, 3) + ' → ' + pair(p.table.groundRoll, p.table.overObstacle, u);
    } else {
      s += pair(p.table.groundRoll, p.table.overObstacle, u);
    }
    var w = p.wind;
    if (!p.ok && p.reason === 'headwind-limit') return s + ' · Gegenwind ' + w.kt + '&nbsp;kt: über ' + fmtInt(p.limitKt) + '&nbsp;kt, kein Wert</li>';
    if (w.kt >= 1 && w.applied) {
      s += ' · Gegenwind ' + w.kt + '&nbsp;kt: ';
      if (w.type === 'percentPer') s += '−' + w.percent + '&nbsp;%';
      else s += '−' + fmtInt(w.perKt) + '&nbsp;' + u + ' je ' + (w.per === 1 ? '' : fmtInt(w.per) + '&nbsp;') + 'kt = −' + fmtInt(w.reduction) + '&nbsp;' + u;
      if (!p.ok && p.reason === 'wind-credit-limit') return s + ', mehr als die Hälfte – kein Wert</li>';
      s += ' → ' + pair(p.afterWind.groundRoll, p.afterWind.overObstacle, u);
    } else if (w.kt >= 1) {
      s += ' · Gegenwind ' + w.kt + '&nbsp;kt: nicht angerechnet (keine Regel in den Flugzeugdaten)';
    } else {
      s += ' · ohne Windkorrektur';
    }
    if (!p.ok) return s + ' · ' + (p.reason === 'no-surface-rule' ? 'keine Korrektur für den Belag' : 'Rechenfehler') + ' – kein Wert</li>';
    if (p.surface) {
      s += ' · ' + (SURFACE_LABEL[p.surface.surface] || esc(p.surface.surface)) + ' +' + fmtTrim(p.surface.percent, 2) + '&nbsp;% von ' +
        num(p.surface.base) + '&nbsp;' + u + ' = +' + num(p.surface.inc) + '&nbsp;' + u + ' → ' +
        pair(p.surface.after.groundRoll, p.surface.after.overObstacle, u);
    }
    p.factors.forEach(function (f) {
      s += ' · ' + esc(f.labelDe) + (f.minimum ? ': mindestens × ' : ' × ') + fmtFactor(f.factor) + ' (' + esc(f.refDe) + ') → ' +
        pair(f.after.groundRoll, f.after.overObstacle, u);
    });
    if (u === 'ft') s += ' = ' + pair(p.meters.groundRoll, p.meters.overObstacle, 'm');
    return s + ' → aufgerundet ' + fmtInt(p.m.groundRoll) + '&nbsp;/&nbsp;' + fmtInt(p.m.overObstacle) + '&nbsp;m</li>';
  }

  function sourceText(src) {
    var s = [src.title, src.publisher, src.number, src.issue, src.approval].filter(function (x) { return typeof x === 'string' && x; }).map(esc).join(', ');
    // englische Geltung (Seriennummern) in Klammern, deutsche Geltung als eigener Satz
    if (str(src.applicability)) s += ' (' + esc(src.applicability) + ')';
    s += '.';
    if (str(src.applicabilityDe)) s += ' ' + esc(src.applicabilityDe);
    if (str(src.pageMark)) s += ' Seitenkennung ' + esc(src.pageMark) + (str(src.pageMarkDe) ? ': ' + esc(src.pageMarkDe) : '.');
    if (str(src.caveatDe)) s += ' ' + esc(src.caveatDe);
    return s;
  }

  function chartSource(label, ch, ac) {
    var ref = ch.ref && typeof ch.ref === 'object' ? ch.ref : {};
    var src = ac.sources[ch.source] || {};
    var notes = Array.isArray(ch.notesDe) ? ch.notesDe.filter(function (n) { return typeof n === 'string'; }) : [];
    return '<p>' + label + ' (' + esc(str(src.labelDe) || ch.source) + '): ' + esc(str(ch.title)) + (ref.figure ? ', ' + esc(str(ref.figure)) : '') +
      (ref.page ? ', Seite ' + esc(str(ref.page)) : '') + '. ' + esc(str(ch.conditionsDe)) + '</p>' +
      (notes.length ? '<ul>' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '');
  }

  function detailsHtml(ac, af, res, open) {
    var h = [];
    var lt = res.lookups.takeoff, ll = res.lookups.landing;
    var lineT = axisLine(lt, res, af), lineL = axisLine(ll, res, af);
    h.push('<details class="perf-details"' + (open ? ' open' : '') + '><summary>Rechenweg und Quellen</summary><div class="perf-calc">');
    if (lineT === lineL) h.push('<p>' + lineT + '.</p>');
    else h.push('<p>Start: ' + lineT + '.</p><p>Landung: ' + lineL + '.</p>');
    res.runways.forEach(function (rw) {
      if (!rw.computed) {
        if (rw.reason === 'tailwind') {
          h.push('<p>Piste ' + esc(rw.id) + ': Wind aus ' + fmtInt(res.input.windDirTrue) + '°, Rückenwindkomponente ' + fmtDec(rw.wind.componentKt, 2) +
            '&nbsp;kt aus dem Mittelwind – nicht berechnet.</p>');
        }
        return;
      }
      h.push('<p class="perf-calc-h">Piste ' + esc(rw.id) + ' (' + fmtInt(rw.bearingTrue) + '° rechtweisend)</p>');
      h.push('<p>' + windDetail(rw, res.input) + '</p>');
      h.push('<ul>' + phaseLine('Start', rw.takeoff) + phaseLine('Landung', rw.landing) + '</ul>');
    });
    h.push('<p class="perf-calc-h">Regeln</p>');
    h.push('<p>' + TEXT.ruleWind + '</p>');
    h.push('<p>' + (str(ac.readingRuleDe) ? esc(ac.readingRuleDe) + ' ' : '') + TEXT.ruleRound + '</p>');
    h.push('<p>' + TEXT.ruleGrass + '</p>');
    h.push('<p>' + TEXT.ruleWet + '</p>');
    h.push('<p class="perf-calc-h">Quellen</p>');
    h.push(chartSource('Start', ac.charts.takeoff, ac));
    h.push(chartSource('Landung', ac.charts.landing, ac));
    var used = {};
    core.PHASES.forEach(function (ph) { used[ac.charts[ph].source] = true; });
    Object.keys(used).forEach(function (k) {
      h.push('<p>' + esc(str(ac.sources[k].labelDe) || k) + ': ' + sourceText(ac.sources[k]) + '</p>');
    });
    var as = af.source && typeof af.source === 'object' ? af.source : {};
    var rwys = af.runways.map(function (r) {
      return 'Piste ' + esc(r.id) + ': ' + fmtInt(r.bearingTrue) + '° rechtweisend' +
        (isNum(r.bearingMag) ? ' (' + fmtInt(r.bearingMag) + '° missweisend)' : '') + ', ' +
        (SURFACE_LABEL[r.surface] || esc(r.surface)) + ', Start ' + fmtInt(r.takeoffAvailable.value) + '&nbsp;m, Landung ' +
        fmtInt(r.landingAvailable.value) + '&nbsp;m verfügbar';
    }).join('; ');
    h.push('<p>Pistendaten: ' + [as.title, as.edition, as.lengthsRef, as.transcribed].filter(function (x) { return typeof x === 'string' && x; }).map(esc).join(', ') +
      '. Platzhöhe ' + fmtInt(af.elevation.value) + '&nbsp;ft. ' + rwys + '.</p>');
    h.push('</div></details>');
    return h.join('');
  }

  /* ── Gesamte Karte als HTML (rein, für Node-Tests) ──────────── */
  // ctx: { dataState: 'loading'|'ready'|'error', list, selectedId, notice, aircraft, airfield,
  //        wx (window.LSZK_WX), fgzo, fgzoPending, nowMs, detailsOpen }
  function renderHtml(ctx) {
    ctx = ctx || {};
    var nowMs = isNum(ctx.nowMs) ? ctx.nowMs : Date.now();
    if (!core || core.VERSION !== VERSION) return stateHtml(TEXT.internal) + footerHtml(null);
    var sel = selectionHtml(ctx.list, ctx.selectedId);
    if (ctx.dataState === 'loading') return sel + '<div class="perf-loading">' + TEXT.loading + '</div>' + footerHtml(null);
    var ac = ctx.aircraft, af = ctx.airfield;
    if (ctx.dataState !== 'ready' || !core.validateAircraft(ac).ok || !core.validateAirfield(af).ok) {
      return sel + noticeHtml(ctx.notice) + stateHtml(TEXT.dataError) + footerHtml(null);
    }
    if (ctx.list && ctx.list.length >= 2) sel = selectionHtml(ctx.list, ac.id);
    var head = sel + headHtml(ac) + noticeHtml(ctx.notice);
    var foot = footerHtml(ac);
    var a = adaptLszkWx(ctx.wx, nowMs);
    if (!a.ok) return head + stateHtml(adapterText(a, nowMs)) + foot;
    if (ctx.fgzoPending) return head + '<div class="perf-loading">' + TEXT.fgzoLoading + '</div>' + foot;
    var fg = fgzoState(ctx.fgzo, nowMs);
    var rn = rainState(a);
    var ws = wetState(fg, rn);
    var input = { tempC: a.wx.tempC, qnhHpa: a.wx.qnhHpa, windDirTrue: a.wx.windDirTrue, windKt: a.wx.windKt, runwayWet: ws.wet };
    var res = core.compute(ac, af, input);
    if (!res.ok) return head + errorTexts(res).map(stateHtml).join('') + foot;
    if (res.mode === 'no-direction') {
      return head + stateHtml('Windrichtung fehlt bei ' + fmtKt(input.windKt) + '&nbsp;kt Wind: Die Gegenwindpiste lässt sich nicht bestimmen – keine Berechnung.') + foot;
    }
    if (res.computedCount === 0) return head + stateHtml(TEXT.noHeadwindRunway) + foot;
    var hint = '';
    if (res.mode === 'calm') hint = TEXT.calm;
    else if (res.mode === 'nodir') hint = TEXT.nodir;
    else if (isCross(res)) hint = TEXT.cross;
    var computed = res.runways.filter(function (r) { return r.computed; });
    var skipped = res.runways.filter(function (r) { return !r.computed && r.reason === 'tailwind'; });
    return head + measHtml(a, res, nowMs) + conditionHtml(fg, rn, ws, ac, af, res) +
      (hint ? '<div class="perf-hint">' + hint + '</div>' : '') +
      '<div class="perf-grid">' + computed.map(blockHtml).join('') + '</div>' +
      skipped.map(function (r) { return '<div class="perf-skip">Piste ' + esc(r.id) + ': Rückenwind – nicht berechnet.</div>'; }).join('') +
      factorLineHtml(ac) +
      detailsHtml(ac, af, res, !!ctx.detailsOpen) + foot;
  }

  /* ── Browser ───────────────────────────────────────────────── */
  function boot(win) {
    var doc = win.document;
    var S = {
      card: null, content: null, started: false,
      index: null, aircraft: null, airfield: null, selectedId: null, pendingId: null, notice: null,
      dataState: 'loading', lastLoadAttempt: 0, loadSeq: 0,
      wx: null, hasUpdate: false, fatal: false,
      fgzo: null, fgzoSeq: 0, fgzoLoaded: false, fgzoDeadline: 0,
      lastHtml: null
    };
    var FATAL_HTML = stateHtml(TEXT.internal) + footerHtml(null);

    function storeGet(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
    function storeSet(k, v) { try { win.localStorage.setItem(k, v); } catch (e) { /* privat: nur im Speicher */ } }
    function storeRemove(k) { try { win.localStorage.removeItem(k); } catch (e) { /* privat */ } }

    function getJson(url) {
      return win.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        });
    }

    function showFatal() {
      if (!S.content) return;
      try {
        S.content.innerHTML = '';
        S.content.innerHTML = FATAL_HTML;
      } catch (e) { /* nichts mehr zu tun */ }
      S.lastHtml = FATAL_HTML;
    }

    // Fehler in update: alten Wetterstand verwerfen, «Rechenfehler» bleibt bis zum nächsten gültigen update
    function fatal() {
      S.wx = null;
      S.hasUpdate = true;
      S.fatal = true;
      try { if (S.card) S.card.style.display = 'block'; } catch (e) { /* weiter */ }
      showFatal();
    }

    function render() {
      if (!S.content || !S.hasUpdate) return;
      if (S.fatal) {
        if (S.lastHtml !== FATAL_HTML) showFatal();
        return;
      }
      try {
        var d = S.content.querySelector('details.perf-details');
        var html = renderHtml({
          dataState: S.dataState, list: S.index ? S.index.list : null,
          selectedId: S.pendingId || S.selectedId || (S.index ? S.index.def : null), notice: S.notice,
          aircraft: S.aircraft, airfield: S.airfield,
          wx: S.wx, fgzo: S.fgzo, fgzoPending: !S.fgzoLoaded && Date.now() < S.fgzoDeadline,
          nowMs: Date.now(), detailsOpen: !!(d && d.open)
        });
        // Nur bei geändertem HTML neu setzen, damit ein offenes <details> offen bleibt
        if (html !== S.lastHtml) {
          S.content.innerHTML = html;
          S.lastHtml = html;
        }
      } catch (e) {
        showFatal();
      }
    }

    function loadAircraft(entry) {
      return getJson('perf/aircraft/' + entry.file).then(function (ac) {
        if (!core.validateAircraft(ac).ok || ac.id !== entry.id) throw new Error('Flugzeugdaten ungültig');
        return ac;
      });
    }

    // Lädt ein Muster. Gespeichert wird die Wahl erst nach erfolgreichem Laden (remember); schlägt es fehl,
    // gilt wieder der Standard, und die Auswahl bleibt erreichbar. Der Hinweis «Standardmuster gewählt»
    // erscheint nur, wenn der Standard danach wirklich geladen ist.
    function chooseAircraft(entry, seq, remember, failedEntry) {
      S.pendingId = entry.id;
      return loadAircraft(entry).then(function (ac) {
        if (seq !== S.loadSeq) return;
        S.aircraft = ac;
        S.selectedId = entry.id;
        S.pendingId = null;
        S.dataState = 'ready';
        S.notice = failedEntry ? 'Flugzeugdaten für «' + clip(failedEntry.label, LABEL_MAX) + '» nicht verfügbar – Standardmuster gewählt.' : null;
        if (remember) storeSet(STORE_KEY, entry.id);
        render();
      }, function () {
        if (seq !== S.loadSeq) return;
        S.pendingId = null;
        if (storeGet(STORE_KEY) === entry.id) storeRemove(STORE_KEY);
        var def = pickEntry(S.index, S.index.def);
        if (!def || def.id === entry.id) {
          S.aircraft = null;
          S.selectedId = null;
          S.dataState = 'error';
          S.notice = null;
          render();
          return;
        }
        S.selectedId = null;
        return chooseAircraft(def, seq, false, entry);
      });
    }

    function loadData() {
      var seq = ++S.loadSeq;
      S.dataState = 'loading';
      S.lastLoadAttempt = Date.now();
      var afId = String(S.card.getAttribute('data-airfield') || '').toLowerCase();
      var fail = function () {
        if (seq !== S.loadSeq) return;
        S.dataState = 'error';
        S.aircraft = null;
        S.pendingId = null;
        render();
      };
      if (!core || !/^[a-z0-9_-]{1,32}$/.test(afId)) { fail(); return; }
      Promise.all([getJson('perf/aircraft/index.json'), getJson('perf/airfields/' + afId + '.json')])
        .then(function (r) {
          var index = parseIndex(r[0]);
          if (!index || !core.validateAirfield(r[1]).ok) throw new Error('Daten ungültig');
          if (seq !== S.loadSeq) return;
          S.index = index;
          S.airfield = r[1];
          var entry = pickEntry(index, S.selectedId || storeGet(STORE_KEY));
          return chooseAircraft(entry, seq, false);
        })
        .catch(fail);
    }

    function maybeRetry() {
      if (S.dataState === 'error' && Date.now() - S.lastLoadAttempt >= RETRY_MS) loadData();
    }

    function loadFgzo() {
      var seq = ++S.fgzoSeq;
      getJson('data/fgzo_status.json')
        .then(function (p) { if (seq === S.fgzoSeq) { S.fgzo = p; S.fgzoLoaded = true; render(); } })
        .catch(function () { if (seq === S.fgzoSeq) { S.fgzo = null; S.fgzoLoaded = true; render(); } });
    }

    function update(wx) {
      try {
        var copy = null;
        if (wx && typeof wx === 'object') {
          copy = {};
          for (var k in wx) if (Object.prototype.hasOwnProperty.call(wx, k)) copy[k] = wx[k];
        }
        S.wx = copy;
        S.hasUpdate = true;
        S.fatal = false;
        if (!S.started) return;          // start() holt das nach
        S.card.style.display = 'block';
        if (!S.fgzoLoaded && !S.fgzoDeadline) {
          // bis zum ersten FGZO-Abruf höchstens FGZO_WAIT_MS «Lade Flugplatzstatus …», dann ohne Meldung weiter
          S.fgzoDeadline = Date.now() + FGZO_WAIT_MS;
          if (typeof win.setTimeout === 'function') win.setTimeout(function () { tick(); }, FGZO_WAIT_MS + 50);
        }
        maybeRetry();
        render();
        loadFgzo();
      } catch (e) {
        fatal();
      }
    }

    function tick() {
      try {
        if (!S.started) return;
        maybeRetry();
        render();
      } catch (e) {
        showFatal();
      }
    }

    function onChange(e) {
      var t = e && e.target;
      if (!t || t.id !== 'perf-ac' || !S.index) return;
      var entry = pickEntry(S.index, t.value);
      if (!entry || entry.id !== t.value) return;
      if (entry.id === S.selectedId && S.dataState === 'ready') return;
      var seq = ++S.loadSeq;
      S.dataState = 'loading';            // alte Zahlen weg, Auswahl bleibt sichtbar
      S.pendingId = entry.id;
      S.notice = null;
      render();
      chooseAircraft(entry, seq, true);
    }

    function start() {
      var card = doc.getElementById('perf-card');
      var content = doc.getElementById('perf-content');
      if (!card || !content) return;          // ohne Karte nichts tun
      S.card = card;
      S.content = content;
      if (!doc.getElementById('perf-style')) {
        var st = doc.createElement('style');
        st.id = 'perf-style';
        st.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(st);
      }
      content.addEventListener('change', onChange);
      S.started = true;
      loadData();
      if (S.fatal) fatal();
      else if (S.hasUpdate) update(S.wx);
      else if (win.LSZK_WX) update(win.LSZK_WX);   // einmal lesen, falls schon gesetzt
      win.setInterval(function () { if (!doc.hidden) tick(); }, TICK_MS);
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) tick(); });
    }

    win.LszkPerf = { update: update, version: VERSION, _tick: tick };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
    else start();
  }

  return {
    VERSION: VERSION,
    STALE_MIN: STALE_MIN,
    FUTURE_MIN: FUTURE_MIN,
    FGZO_FRESH_MIN: FGZO_FRESH_MIN,
    FGZO_WAIT_MS: FGZO_WAIT_MS,
    WET_BY_RAIN: WET_BY_RAIN,
    TEXT: TEXT,
    CSS: CSS,
    escapeHtml: esc,
    fmtInt: fmtInt,
    fmtDec: fmtDec,
    fmtUp2: fmtUp2,
    adaptLszkWx: adaptLszkWx,
    fgzoState: fgzoState,
    rainState: rainState,
    wetState: wetState,
    parseIndex: parseIndex,
    renderHtml: renderHtml,
    boot: boot
  };
}));
