/* Start- und Landestreckenrechner – Kurzzeile unter der Briefing-Ampel (<details id="perf-box">, Text in
   #perf-teaser-text) und Karte #perf-card / #perf-content darin (Datenschema 2).
   Liest window.LSZK_WX (vom Wetterteil der Seite gesetzt) und bekommt Updates über window.LszkPerf.update(wx).
   Lädt perf/aircraft/index.json, die gewählte Flugzeugdatei, perf/airfields/<data-airfield>.json und
   data/fgzo_status.json, rechnet mit window.LszkPerfCore (perf/perf.js) und schreibt Kurzzeile und Karte aus einem
   Modell (buildModel, eine Rechnung). In #perf-content legt das Skript #perf-sel (Auswahl, nur bei geänderter Liste
   neu geschrieben) und #perf-body (Karteninhalt) an. Auf- und Zuklappen merkt sich lszk-perf-open.
   Fehlen Box und Kurzzeile (alte Seite aus dem Cache), erscheint wie bisher nur die Karte.
   Grundsatz: lieber kein Wert als ein falscher. Ohne gültige, frische Messwerte keine Zahlen, auch nicht in der
   Kurzzeile; sie wirkt nie günstiger als die Karte.
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

  var VERSION = 3;

  var STALE_MIN = 45;          // Messwerte älter: keine Zahlen
  var FUTURE_MIN = 5;          // Messzeit weiter in der Zukunft: keine Zahlen
  var FGZO_FRESH_MIN = 45;     // wie FGZO_FRESH_MIN in index.html (fgzoItem, aiFgzoSperre)
  var FGZO_WAIT_MS = 5000;     // bis zum ersten FGZO-Abruf höchstens so lange «Lade Flugplatzstatus …»
  var RETRY_MS = 60000;        // neuer Ladeversuch der Daten frühestens nach 60 s
  var TICK_MS = 60000;         // Alter neu rechnen
  var STORE_KEY = 'lszk-perf-aircraft';
  var OPEN_KEY = 'lszk-perf-open';     // '1' = Kurzzeile aufgeklappt; zugeklappt: Schlüssel entfernt (Standard zu)
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
    selectLabel: 'Flugzeug wählen',
    calm: 'Windstill (Mittelwind unter 1 kt): keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.',
    noDirection: 'Windrichtung fehlt bei mehr als 3 kt Wind: Die Gegenwindpiste lässt sich nicht bestimmen – keine Berechnung.',
    nodir: 'Windrichtung nicht gemeldet: keine Gegenwindpiste bestimmbar. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.',
    cross: 'Wind genau quer zur Piste: keine Gegenwindpiste. Beide Pisten ohne Windkorrektur gerechnet; mit Rückenwind sind die Strecken länger.',
    noFgzo: 'Pistenzustand: keine aktuelle Meldung der FGZO.',
    noRainHour: 'MeteoSchweiz hat in der letzten Stunde keinen Regen gemessen.',
    noRainRate: 'MeteoSchweiz misst zurzeit keinen Regen; die Stundensumme fehlt.',
    rainMissing: 'Ein Regenwert von MeteoSchweiz fehlt.',
    unknown: 'Pistenzustand unbekannt: keine aktuelle Meldung der FGZO und kein Regenwert von MeteoSchweiz.',
    reserve: 'Tau, Reif, eben einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.',
    ruleWind: 'Wind: Gerechnet wird nur die Piste mit Gegenwind. Der Gegenwind stammt aus dem 10-min-Mittelwind, wird auf ganze kt ' +
      'abgerundet und voll angerechnet. Bei Windstille (Mittelwind unter 1 kt), ohne gemeldete Windrichtung nur bis 3 kt Mittelwind, ' +
      'oder bei Wind genau quer werden beide Pisten ohne Windkorrektur gerechnet. Rückenwind wird nicht gerechnet. Kein Wert bei ' +
      'fehlender Windrichtung und mehr als 3 kt, bei Gegenwind über 40 kt oder wenn die Windkorrektur des AFM eine Strecke um mehr ' +
      'als die Hälfte verkürzen würde.',
    ruleRound: 'Rundung immer zur längeren Strecke: Gegenwind abgerundet, Ergebnis auf ganze Meter aufgerundet. Die Zwischenwerte im ' +
      'Rechenweg sind exakt (höchstens vier Nachkommastellen); nur der letzte Wert vor dem Aufrunden ist auf 0,01 aufgerundet.',
    ruleGrass: 'Gras: Zuschlag laut AFM in Prozent der Tabellen-Rollstrecke (bei Interpolation der interpolierten), auf beide Strecken. ' +
      'Faktoren des AFM wirken auf beide Strecken nach Wind- und Graskorrektur. Kein eigener Sicherheitszuschlag.',
    ruleWet: 'Nasse Piste: Die Piste gilt als nass, wenn die FGZO einen anderen Pistenzustand als DRY meldet oder MeteoSchweiz in der ' +
      'letzten Stunde oder in den letzten 10 min Regen gemessen hat. Der Regenwert kann bis zu 60 min alt sein. Tau, Reif, eben ' +
      'einsetzenden Regen und Nässe von früherem Regen erkennt die Karte nicht.'
  };

  // Kurzzeile unter der Ampel: Zustände ohne Zahlen und Vorbehalte (ohne Satzpunkt, ohne HTML)
  var TEASER = {
    title: 'Start- und Landestrecke',
    internal: 'Rechenfehler – keine Berechnung',
    loading: TEXT.loading,
    dataError: 'Daten nicht verfügbar – keine Berechnung',
    noData: 'Keine aktuellen Messwerte – keine Berechnung',
    stale: 'Messwerte veraltet – keine Berechnung',
    future: 'Messzeit unplausibel – keine Berechnung',
    missing: 'Messwert fehlt – keine Berechnung',
    speck: 'Nur Werte der Station Speck – keine Berechnung',
    fgzoLoading: TEXT.fgzoLoading,
    invalid: 'Messwert unplausibel – keine Berechnung',
    aboveRange: 'Über dem Tabellenbereich des AFM – kein Wert',
    noDirection: 'Windrichtung fehlt – keine Berechnung',
    noRunway: 'Keine Piste mit Gegenwind – keine Berechnung',
    calm: 'windstill',
    nodir: 'ohne Windrichtung',
    cross: 'Wind quer',
    noValue: 'kein Wert',
    closed: 'Platz gesperrt',
    closedAll: 'Platz geschlossen',
    closedStale: ' (veraltete Meldung)',
    dirUnknown: 'Windrichtung unbekannt: Rückenwind möglich',
    wet: 'Piste nass: Strecken deutlich länger möglich',
    unknown: 'Pistenzustand unbekannt',
    inDetails: 'Hinweis in den Details'
  };
  // Warnzeichen wie auf der übrigen Seite: einfaches U+26A0, ohne Variantenwähler
  var WARN_SIGN = '⚠';

  // Feldnamen stammen aus dem Adapter bzw. dem Kern, nie aus Daten; unbekannte heissen «Messwert»
  var FIELD_LABEL = {
    tempC: 'Temperatur', qnhHpa: 'QNH', windKt: 'Wind', windDir: 'Windrichtung', windDirTrue: 'Windrichtung'
  };
  function fieldLabel(f) { return Object.prototype.hasOwnProperty.call(FIELD_LABEL, f) ? FIELD_LABEL[f] : 'Messwert'; }
  var SURFACE_LABEL = { grass: 'Gras', paved: 'Hartbelag' };
  var SURFACE_TEXT = { 'grass/dry': 'trockenes Gras', 'paved/dry': 'trockenen Hartbelag' };
  var SURFACE_WET = { grass: 'nasses Gras', paved: 'nassen Hartbelag' };
  var PHASE_LABEL = { takeoff: 'Start', landing: 'Landung' };

  var CSS = [
    '#perf-content { font-size: 0.82rem; line-height: 1.5; color: var(--text); overflow-wrap: break-word; }',
    '.perf-ac { margin: 0 0 4px; }',
    '.perf-ac-label { display: block; margin: 0 0 4px; color: var(--text-muted); font-weight: 600; font-size: 0.78rem; }',
    // Als Auswahlfeld erkennbar: Rahmen in Akzentfarbe, eigener Pfeil (Daten-URI, Farbe = --accent), Fingermass 44 px.
    // 16 px auf allen Breiten, weil iOS bei kleinerer Schrift beim Fokus zoomt. Kein «outline: none».
    '.perf-select { -webkit-appearance: none; -moz-appearance: none; appearance: none; display: block; width: 100%; max-width: 26rem; ' +
      'min-height: 44px; margin: 0; font: inherit; font-size: 16px; font-weight: 600; line-height: 1.25; color: var(--text); ' +
      'background-color: var(--bg); background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' ' +
      'viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2338bdf8\' stroke-width=\'2.5\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E' +
      '%3Cpolyline points=\'6 9 12 15 18 9\'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center; ' +
      'background-size: 18px 18px; border: 1px solid var(--accent); border-radius: 8px; padding: 8px 40px 8px 12px; cursor: pointer; }',
    '.perf-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.perf-ac-one { font-weight: 600; }',
    '.perf-ac-sub { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-ac-sub:empty { display: none; }',
    '.perf-nw { white-space: nowrap; }',
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
    // Kurzzeile unter der Ampel: <details class="perf-box"> mit <summary class="perf-teaser">; gleiche Aussenmasse wie die Ampel.
    // display:block auf dem summary blendet das Dreieck aus (Safari: ::-webkit-details-marker); Flex sitzt im inneren span,
    // weil display:flex direkt auf <summary> in älterem Safari nicht greift.
    '.perf-box { max-width: 1600px; margin: 0 auto 16px; }',
    '.perf-teaser { display: block; list-style: none; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 8px 12px; }',
    '.perf-teaser::-webkit-details-marker { display: none; }',
    '.perf-teaser:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.perf-box[open] > .perf-teaser { margin-bottom: 8px; }',
    '.perf-t { display: flex; align-items: flex-start; gap: 8px; }',
    '.perf-t-ico, .perf-t-chev { flex: none; width: 18px; height: 18px; color: var(--accent); }',
    '.perf-t-chev { transition: transform 0.2s ease; }',
    '.perf-box[open] .perf-t-chev { transform: rotate(180deg); }',
    '.perf-t-body { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 1px 18px; font-size: 0.8rem; line-height: 1.45; color: var(--text); overflow-wrap: break-word; }',
    // Elemente dürfen schmaler werden als ihr längstes Wort (sonst schiebt ein langer Name ohne Leerzeichen die Seite
    // seitlich); umbrochen wird dann per overflow-wrap
    '.perf-t-body > span { min-width: 0; }',
    '.perf-t-head { font-weight: 600; }',
    '.perf-t-state { color: #f87171; }',
    '.perf-t-load { color: var(--text-muted); }',
    '.perf-t-warn { color: #fcd34d; }',
    '@media (hover: hover) {',
    '  .perf-teaser:hover { border-color: var(--accent); }',
    '}',
    '@media (max-width: 600px) {',
    '  .perf-box { margin-bottom: 10px; }',
    '  .perf-teaser { padding: 8px; border-radius: 6px; }',
    '  .perf-t { gap: 6px; }',
    '  .perf-t-ico, .perf-t-chev { width: 16px; height: 16px; }',
    '}',
    '@media (max-width: 340px) {',
    '  .perf-t-ico { display: none; }',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    '  .perf-t-chev { transition: none; }',
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

  // Letzter Wert vor dem Aufrunden im Rechenweg: auf 0,01 aufgerundet (ceil(ceil_0,01(x)) = ceil(x))
  function fmtUp2(x) { return fmtTrim(Math.ceil(x * 100 - 1e-6) / 100, 2); }

  // Zwischenwert im Rechenweg: exakt, höchstens vier Nachkommastellen, ohne nachgestellte Nullen.
  // Mit Tabellenwerten, Prozenten und Faktoren der Daten und Temperaturen mit höchstens zwei Dezimalen sind alle
  // Zwischenwerte Vielfache von 0,0001; das Runden auf 0,0001 entfernt nur Gleitkommareste. Wäre ein Wert so nicht
  // exakt darstellbar, steht «≈» davor.
  function fmtExact(x) {
    var s = x * 10000, r = Math.round(s);
    return (Math.abs(s - r) > 1e-3 ? '≈' : '') + fmtTrim(r / 10000, 4);
  }

  // Mittelwind: auf eine Nachkommastelle abgeschnitten, nicht gerundet (0,97 kt → 0,9 kt passt zu «unter 1 kt»)
  function fmtWind(v) { return fmtDec(Math.floor(v * 10 + 1e-9) / 10, 1); }

  // Wind im Rechenweg (Mittelwind, Gegenwindkomponente und Rückenwindkomponente der nicht gerechneten Piste):
  // auf zwei Nachkommastellen abgeschnitten, damit beide Pisten dieselbe Zahl zeigen
  // (6,996 kt → 6,99 kt passt zu «abgerundet 6 kt», 0,999 kt → 0,99 kt zu «unter 1 kt»)
  function fmtKt2(v) { return fmtDec(Math.floor(v * 100 + 1e-7) / 100, 2); }

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
     Die letzte bekannte Meldung gilt weiter, in die vorsichtige Richtung:
     – «nicht DRY» zählt als nass, auch veraltet, bei ok=false oder ohne Zeitstempel (updated);
     – DRY gilt nur frisch und mit Zeitstempel als gesichert; veraltet oder nicht von heute erscheint sie als Hinweis,
       ohne Zeitstempel gilt sie als unbekannt;
     – eine Sperre aus einer frischen Meldung steht im gelben Kasten, aus einer veralteten als Hinweis.
     Texte der FGZO (updated, runway_condition, flaeche_grund) werden nur als String übernommen. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // Datum im FGZO-Zeitstempel «18.11.2026, 07:14» als «18.11.2026», sonst null
  function stampDay(stamp) {
    var m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(stamp);
    return m ? pad2(Number(m[1])) + '.' + pad2(Number(m[2])) + '.' + m[3] : null;
  }

  // Zeit des letzten erfolgreichen FGZO-Abrufs (fetched_at_utc) in ms, sonst NaN; nur ein String zählt
  function fgzoFetchedMs(p) {
    return p && typeof p === 'object' && typeof p.fetched_at_utc === 'string' && p.fetched_at_utc
      ? new Date(p.fetched_at_utc).getTime() : NaN;
  }

  // Ein neuer FGZO-Datensatz (Objekt) wird übernommen, wenn noch kein Satz mit lesbarer Abrufzeit gespeichert ist.
  // Sonst nur mit lesbarer Abrufzeit, die nicht älter ist: So verdrängt ein leerer oder älterer Satz
  // (z. B. uneinheitliche Auslieferung) keine gespeicherte Meldung «nicht DRY».
  function fgzoAccept(prev, next) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    var tPrev = fgzoFetchedMs(prev);
    if (!isNum(tPrev)) return true;
    var tNext = fgzoFetchedMs(next);
    return isNum(tNext) && tNext >= tPrev;
  }

  function fgzoState(p, nowMs) {
    var st = { kind: 'unknown', fresh: false, ageMin: null, condition: null, updated: null, today: false, dayKnown: false,
      dryNoStamp: false, closed: false, closedStale: false, closedReason: '' };
    if (!p || typeof p !== 'object' || Array.isArray(p)) return st;
    var t = fgzoFetchedMs(p);
    if (isNum(t)) st.ageMin = (nowMs - t) / 60000;
    st.fresh = st.ageMin !== null && st.ageMin < FGZO_FRESH_MIN;
    if (p.flaeche === 'gesperrt') {
      st.closed = st.fresh;
      st.closedStale = !st.fresh;
      st.closedReason = typeof p.flaeche_grund === 'string' ? p.flaeche_grund : '';
    }
    st.updated = typeof p.updated === 'string' && p.updated.trim() ? p.updated : null;
    // Ein vorhandener Zustand, der kein String ist, zählt vorsichtshalber als «nicht DRY»
    var rc = p.runway_condition;
    var cond = typeof rc === 'string' ? rc.replace(/\s+/g, ' ').trim().toUpperCase()
      : (rc === null || rc === undefined ? '' : 'UNLESBAR');
    if (!cond) return st;
    st.condition = cond;
    if (cond !== 'DRY') {
      st.kind = 'notdry';
    } else if (!st.updated) {
      st.dryNoStamp = true;                       // DRY ohne Zeitstempel: unbekannt
    } else {
      st.kind = 'dry';
      var day = stampDay(st.updated);
      st.dayKnown = day !== null;
      st.today = day !== null && day === dayKey(nowMs);
    }
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

  // Nass: letzte FGZO-Meldung ungleich DRY (auch veraltet) oder Regen.
  // Unbekannt: nicht nass, keine frische DRY-Meldung mit Zeitstempel und kein Regenwert.
  function wetState(fg, rn) {
    var byFgzo = fg.kind === 'notdry';
    var byRain = WET_BY_RAIN && rn.rain;
    var wet = byFgzo || byRain;
    var freshDry = fg.kind === 'dry' && fg.fresh;
    return { wet: wet, byFgzo: byFgzo, byRain: byRain, unknown: !wet && !freshDry && (!WET_BY_RAIN || !rn.known) };
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

  // Name des Musters in der Auswahl (die Kennzeichen stehen in der Unterzeile)
  function optionText(e) { return clip(e.label, LABEL_MAX); }

  // Auswahl ab zwei Mustern mit Beschriftung, sonst der Name ohne <select>
  function selectionHtml(list, selectedId) {
    if (!list || !list.length) return '';
    if (list.length < 2) return '<div class="perf-ac perf-ac-one">' + esc(optionText(list[0])) + '</div>';
    return '<div class="perf-ac"><label class="perf-ac-label" for="perf-ac">' + TEXT.selectLabel + '</label>' +
      '<select id="perf-ac" class="perf-select" aria-describedby="perf-ac-sub">' + list.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(optionText(e)) + '</option>';
      }).join('') + '</select></div>';
  }

  // Unterzeile der Auswahl: Kennzeichen des gewählten Musters, nach dem Laden der Flugzeugdaten auch die Masse.
  // Ein Eintrag, der nicht in der Liste steht, zeigt keine Kennzeichen (nie die eines anderen Musters).
  function subLineHtml(list, selectedId, ac) {
    if (!list || !list.length) return '';
    var entry = null;
    if (list.length < 2) entry = list[0];
    else list.forEach(function (e) { if (!entry && e && e.id === selectedId) entry = e; });
    var parts = (entry && Array.isArray(entry.registrations) ? entry.registrations : []).map(function (r) {
      return '<span class="perf-nw">' + esc(r) + '</span>';
    });
    if (ac) parts.push(fmtInt(ac.mass.kg) + '&nbsp;kg');
    return '<div class="perf-ac-sub" id="perf-ac-sub">' + parts.join(' · ') + '</div>';
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
        // Der Kern lässt als Zustand nur «dry» zu; ein unbekannter Belag erscheint mit seinem Namen
        out.push(SURFACE_TEXT[key] || 'trockenen Belag «' + esc(r.surface) + '»');
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
        return 'Messwert fehlt (' + a.fields.map(fieldLabel).join(', ') + ') – keine Berechnung.';
      default: return TEXT.noData;          // no-data, no-source, no-time
    }
  }

  function fieldValueText(f, v) {
    var label = fieldLabel(f);
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
    if (w.windDirTrue === null) s += fmtWind(w.windKt) + '&nbsp;kt, Richtung unbestimmt';
    else s += fmtInt(w.windDirTrue) + '° / ' + fmtWind(w.windKt) + '&nbsp;kt';
    if (a.gustKt !== null) s += ', Böen ' + fmtKt(a.gustKt) + '&nbsp;kt';
    s += ' · Druckhöhe ' + fmtInt(ceilEps(res.pressureAltitudeFt)) + '&nbsp;ft';
    return '<div class="perf-meas">' + s + '</div>';
  }

  /* ── Pistenzustand, Sperre und Nässe ───────────────────────── */
  function closureText(fg, stale) {
    var tail = stale ? ' (veraltete Meldung).' : '.';
    if (fg.closedReason === 'geschlossen') return 'Platz laut FGZO geschlossen' + tail;
    var reason = clip(fg.closedReason, FGZO_REASON_MAX);
    return 'Platz laut FGZO für Flächenflugzeuge gesperrt' + (reason ? ' (' + esc(reason) + ')' : '') + tail;
  }

  function fmtMm(v) { return fmtTrim(v, 2); }

  // «Stand 18.11.2026, 10:38» oder «ohne Zeitstempel»
  function stampText(fg) { return fg.updated ? 'Stand ' + esc(clip(fg.updated, FGZO_TEXT_MAX)) : 'ohne Zeitstempel'; }
  // Alter des letzten erfolgreichen Abrufs
  function fetchAgeText(fg) { return fg.ageMin === null ? 'Abrufzeit unbekannt' : 'Abruf ' + fmtAge(fg.ageMin); }

  function wetSourceText(fg, rn, ws) {
    var parts = [];
    if (ws.byFgzo) {
      var c = '«' + esc(clip(fg.condition, FGZO_TEXT_MAX)) + '» (' + stampText(fg) + ')';
      parts.push(fg.fresh ? 'FGZO meldet ' + c : 'letzte FGZO-Meldung ' + c + ', ' + fetchAgeText(fg) + ' – vorsichtshalber weiter nass gerechnet');
    }
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

  // Welche Zustandszeilen die Karte zeigt; dieselben Flags bestimmen die Vorbehalte der Kurzzeile.
  // Gelb (Kasten): closed, wet. Hinweisfarbe: closedStale, dryNotToday, dryStale, dryNoStamp, unknown.
  // Gedämpft: dryToday. Die DRY-Flags und unknown gelten nur, wenn die Piste nicht als nass gilt.
  function condFlags(fg, ws) {
    var dry = !ws.wet && fg.kind === 'dry';
    return {
      closed: fg.closed, closedStale: fg.closedStale, wet: ws.wet,
      dryToday: dry && fg.fresh && fg.today, dryNotToday: dry && fg.fresh && !fg.today, dryStale: dry && !fg.fresh,
      dryNoStamp: !ws.wet && fg.dryNoStamp, unknown: !ws.wet && ws.unknown
    };
  }

  // Gelber Kasten: frische Sperre und Nässe. Hinweisfarbe: veraltete Sperre, unsichere DRY-Meldung, unbekannter Zustand.
  // Gedämpft: frische DRY-Meldung von heute, Regensatz, «Gerechnet für …» und Vorbehalt.
  function conditionHtml(fg, rn, ws, ac, af, res) {
    var f = condFlags(fg, ws);
    var h = '';
    var warn = [];
    if (f.closed) warn.push('<div>' + closureText(fg, false) + '</div>');
    if (f.wet) {
      var wet = [wetSourceText(fg, rn, ws)].concat(wetConsequences(res));
      if (str(ac.wetNoteDe)) wet.push(esc(ac.wetNoteDe));
      warn.push('<div>' + wet.join(' ') + '</div>');
    }
    if (warn.length) h += '<div class="perf-cond perf-warn" role="note">' + warn.join('') + '</div>';
    if (f.closedStale) h += '<div class="perf-note">' + closureText(fg, true) + '</div>';
    if (!f.wet) {
      var notes = [], muted = [];
      var dry = 'Pistenzustand laut FGZO: DRY (' + stampText(fg) + ')';
      if (f.dryToday) muted.push(dry + '.');
      else if (f.dryNotToday) notes.push(dry + ' – ' + (fg.dayKnown ? 'Meldung nicht von heute.' : 'Datum der Meldung unklar.'));
      else if (f.dryStale) notes.push('Letzte FGZO-Meldung DRY ist veraltet (' + stampText(fg) + ', ' + fetchAgeText(fg) + ').');
      else if (f.dryNoStamp) notes.push('FGZO meldet DRY ohne Zeitstempel – gilt als unbekannt.');
      if (f.unknown) {
        notes.push(TEXT.unknown);
      } else {
        if (fg.kind !== 'dry' && !fg.dryNoStamp) muted.push(TEXT.noFgzo);
        muted.push(rainSentence(rn));
      }
      var surf = surfaceText(ac, af);
      muted.push((surf ? 'Gerechnet für ' + surf + '. ' : '') + TEXT.reserve);
      if (notes.length) h += '<div class="perf-note">' + notes.join(' ') + '</div>';
      h += '<div class="perf-cond">' + muted.join(' ') + '</div>';
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
      // Der Kern lässt nur Druckhöhe und Temperatur zu; der Ersatztext stammt nie aus den Daten
      var t = AXIS_TEXT[a.quantity] || ['Tabellenachse', ''];
      var shown = a.quantity === 'pressureAltitude' ? fmtInt(ceilEps(a.input)) : fmtDec(a.input, 1);
      var s = t[0] + ' ' + shown + '&nbsp;' + t[1];
      if (a.quantity === 'pressureAltitude') {
        s += ' (aus QNH ' + fmtQnh(res.input.qnhHpa) + '&nbsp;hPa und Platzhöhe ' + fmtInt(af.elevation.value) + '&nbsp;ft)';
      }
      if (a.weight !== undefined) {
        return s + ' → zwischen den Tabellenspalten ' + fmtExact(a.lower) + '&nbsp;' + t[1] + ' und ' + fmtExact(a.upper) + '&nbsp;' + t[1] +
          ' linear interpoliert (Gewicht ' + fmtExact(a.weight) + ')';
      }
      var word = k === 0 ? 'Tabellenzeile' : (k === 1 ? 'Tabellenspalte' : 'Tabellenwert');
      return s + ' → ' + word + ' ' + fmtInt(a.value) + '&nbsp;' + t[1] + (a.belowLowest ? ' (kleinster Tabellenwert)' : '');
    }).join(' · ');
  }

  function windDetail(r, inp) {
    var w = r.wind;
    if (w.mode === 'calm') return 'Mittelwind ' + fmtKt2(inp.windKt) + '&nbsp;kt, unter ' + fmtDec(core.CALM_BELOW_KT, 0) + '&nbsp;kt: windstill, ohne Windkorrektur.';
    if (w.mode === 'nodir') return 'Windrichtung nicht gemeldet: ohne Windkorrektur.';
    var s = 'Wind aus ' + fmtInt(inp.windDirTrue) + '°: ';
    if (w.along === 0) return s + 'genau quer zur Piste, keine Längskomponente.';
    return s + 'Gegenwindkomponente ' + fmtKt2(w.componentKt) + '&nbsp;kt aus dem Mittelwind ' + fmtKt2(inp.windKt) +
      '&nbsp;kt, abgerundet ' + w.kt + '&nbsp;kt.';
  }

  // Rechenweg: Zwischenwerte exakt; nur das letzte Wertepaar vor dem Aufrunden auf ganze Meter (bei Tabellen in ft
  // das Paar in m) erscheint auf 0,01 aufgerundet. Das ist zulässig, weil ceil(ceil_0,01(x)) = ceil(x).
  function pair(a, b, unit, up) {
    var f = up ? fmtUp2 : fmtExact;
    return f(a) + '&nbsp;/&nbsp;' + f(b) + '&nbsp;' + unit;
  }

  function lastStep(p) {
    if (!p.ok) return '';
    if (p.unit === 'ft') return 'meters';
    if (p.factors.length) return 'factor' + (p.factors.length - 1);
    if (p.surface) return 'surface';
    if (p.wind.applied) return 'wind';
    return 'table';
  }

  function phaseLine(label, p) {
    var u = p.unit;
    var lk = p.lookup;
    var last = lastStep(p);
    var s = '<li>' + label + ': Tabelle ';
    if (lk.interpolated) {
      var c = lk.columns;
      s += pair(c.lower.groundRoll, c.lower.overObstacle, u) + ' bei ' + fmtExact(c.lowerValue) + '&nbsp;°C und ' +
        pair(c.upper.groundRoll, c.upper.overObstacle, u) + ' bei ' + fmtExact(c.upperValue) + '&nbsp;°C, Gewicht ' +
        fmtExact(c.weight) + ' → ' + pair(p.table.groundRoll, p.table.overObstacle, u, last === 'table');
    } else {
      s += pair(p.table.groundRoll, p.table.overObstacle, u, last === 'table');
    }
    var w = p.wind;
    if (!p.ok && p.reason === 'headwind-limit') return s + ' · Gegenwind ' + w.kt + '&nbsp;kt: über ' + fmtInt(p.limitKt) + '&nbsp;kt, kein Wert</li>';
    if (w.kt >= 1 && w.applied) {
      s += ' · Gegenwind ' + w.kt + '&nbsp;kt: ';
      if (w.type === 'percentPer') {
        s += '−' + w.percent + '&nbsp;%';
      } else {
        // ganzzahlig: «= −70 m»; sonst abgerundet (zur längeren Strecke)
        var exact = Math.abs(w.perKt * w.kt / w.per - w.reduction) < 1e-9;
        s += '−' + fmtExact(w.perKt) + '&nbsp;' + u + ' je ' + (w.per === 1 ? '' : fmtExact(w.per) + '&nbsp;') + 'kt' +
          (exact ? ' = −' : ', abgerundet −') + fmtInt(w.reduction) + '&nbsp;' + u;
      }
      if (!p.ok && p.reason === 'wind-credit-limit') return s + ', mehr als die Hälfte – kein Wert</li>';
      s += ' → ' + pair(p.afterWind.groundRoll, p.afterWind.overObstacle, u, last === 'wind');
    } else if (w.kt >= 1) {
      s += ' · Gegenwind ' + w.kt + '&nbsp;kt: nicht angerechnet (keine Regel in den Flugzeugdaten)';
    } else {
      s += ' · ohne Windkorrektur';
    }
    if (!p.ok) return s + ' · ' + (p.reason === 'no-surface-rule' ? 'keine Korrektur für den Belag' : 'Rechenfehler') + ' – kein Wert</li>';
    if (p.surface) {
      s += ' · ' + (SURFACE_LABEL[p.surface.surface] || esc(p.surface.surface)) + ' +' + fmtExact(p.surface.percent) + '&nbsp;% von ' +
        fmtExact(p.surface.base) + '&nbsp;' + u + ' = +' + fmtExact(p.surface.inc) + '&nbsp;' + u + ' → ' +
        pair(p.surface.after.groundRoll, p.surface.after.overObstacle, u, last === 'surface');
    }
    p.factors.forEach(function (f, i) {
      s += ' · ' + esc(f.labelDe) + (f.minimum ? ': mindestens × ' : ' × ') + fmtFactor(f.factor) + ' (' + esc(f.refDe) + ') → ' +
        pair(f.after.groundRoll, f.after.overObstacle, u, last === 'factor' + i);
    });
    if (u === 'ft') s += ' = ' + pair(p.meters.groundRoll, p.meters.overObstacle, 'm', true);
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
          h.push('<p>Piste ' + esc(rw.id) + ': Wind aus ' + fmtInt(res.input.windDirTrue) + '°, Rückenwindkomponente ' + fmtKt2(rw.wind.componentKt) +
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
    if (str(ac.massNoteDe)) {
      h.push('<p>Gewicht ' + fmtInt(ac.mass.kg) + '&nbsp;kg (' + fmtInt(ac.mass.lb) + '&nbsp;lb): ' + esc(ac.massNoteDe) + '</p>');
    }
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

  /* ── Modell: eine Rechnung für alle Darstellungen (rein, für Node-Tests) ── */
  // ctx: { dataState: 'loading'|'ready'|'error', list, selectedId, notice, aircraft, airfield,
  //        wx (window.LSZK_WX), fgzo, fgzoPending, nowMs, detailsOpen }
  // kind: internal | loading | data-error | no-wx | fgzo-pending | calc-error | no-direction | no-runway | result.
  // core.compute läuft höchstens einmal. notice steht nur in den Zuständen, in denen die Karte ihn zeigt;
  // selectedId ist ab geladenen Daten die id des geladenen Musters.
  function buildModel(ctx) {
    ctx = ctx || {};
    var m = {
      kind: 'internal', nowMs: isNum(ctx.nowMs) ? ctx.nowMs : Date.now(), list: ctx.list, selectedId: ctx.selectedId,
      notice: null, detailsOpen: !!ctx.detailsOpen,
      ac: null, af: null, a: null, fg: null, rn: null, ws: null, res: null, hintKind: null, computed: null, skipped: null
    };
    if (!core || core.VERSION !== VERSION) return m;
    if (ctx.dataState === 'loading') {
      m.kind = 'loading';
      return m;
    }
    m.notice = ctx.notice;
    var ac = ctx.aircraft, af = ctx.airfield;
    if (ctx.dataState !== 'ready' || !core.validateAircraft(ac).ok || !core.validateAirfield(af).ok) {
      m.kind = 'data-error';
      return m;
    }
    m.ac = ac;
    m.af = af;
    m.selectedId = ac.id;
    var a = m.a = adaptLszkWx(ctx.wx, m.nowMs);
    if (!a.ok) {
      m.kind = 'no-wx';
      return m;
    }
    if (ctx.fgzoPending) {
      m.kind = 'fgzo-pending';
      return m;
    }
    m.fg = fgzoState(ctx.fgzo, m.nowMs);
    m.rn = rainState(a);
    m.ws = wetState(m.fg, m.rn);
    var input = { tempC: a.wx.tempC, qnhHpa: a.wx.qnhHpa, windDirTrue: a.wx.windDirTrue, windKt: a.wx.windKt, runwayWet: m.ws.wet };
    var res = m.res = core.compute(ac, af, input);
    if (!res.ok) m.kind = 'calc-error';
    else if (res.mode === 'no-direction') m.kind = 'no-direction';
    else if (res.computedCount === 0) m.kind = 'no-runway';
    else {
      if (res.mode === 'calm') m.hintKind = 'calm';
      else if (res.mode === 'nodir') m.hintKind = 'nodir';
      else if (isCross(res)) m.hintKind = 'cross';
      m.computed = res.runways.filter(function (r) { return r.computed; });
      m.skipped = res.runways.filter(function (r) { return !r.computed && r.reason === 'tailwind'; });
      m.kind = 'result';
    }
    return m;
  }

  /* ── Karte als HTML: Auswahl und Inhalt ────────────────────── */
  function selectHtml(m) {
    return m.kind === 'internal' ? '' : selectionHtml(m.list, m.selectedId);
  }

  var HINT_TEXT = { calm: TEXT.calm, nodir: TEXT.nodir, cross: TEXT.cross };

  // Beginnt mit der Unterzeile der Auswahl (ausser im Zustand internal, der keine Auswahl zeigt)
  function bodyHtml(m) {
    if (m.kind === 'internal') return stateHtml(TEXT.internal) + footerHtml(null);
    var sub = subLineHtml(m.list, m.selectedId, m.ac);
    if (m.kind === 'loading') return sub + '<div class="perf-loading">' + TEXT.loading + '</div>' + footerHtml(null);
    if (m.kind === 'data-error') return sub + noticeHtml(m.notice) + stateHtml(TEXT.dataError) + footerHtml(null);
    if (!m.ac) return stateHtml(TEXT.internal) + footerHtml(null);
    var head = sub + headHtml(m.ac) + noticeHtml(m.notice);
    var foot = footerHtml(m.ac);
    switch (m.kind) {
      case 'no-wx': return head + stateHtml(adapterText(m.a, m.nowMs)) + foot;
      case 'fgzo-pending': return head + '<div class="perf-loading">' + TEXT.fgzoLoading + '</div>' + foot;
      case 'calc-error': return head + errorTexts(m.res).map(stateHtml).join('') + foot;
      case 'no-direction': return head + stateHtml(TEXT.noDirection) + foot;
      case 'no-runway': return head + stateHtml(TEXT.noHeadwindRunway) + foot;
      case 'result': break;
      default: return stateHtml(TEXT.internal) + footerHtml(null);
    }
    var hint = m.hintKind ? HINT_TEXT[m.hintKind] : '';
    return head + measHtml(m.a, m.res, m.nowMs) + conditionHtml(m.fg, m.rn, m.ws, m.ac, m.af, m.res) +
      (hint ? '<div class="perf-hint">' + hint + '</div>' : '') +
      '<div class="perf-grid">' + m.computed.map(blockHtml).join('') + '</div>' +
      m.skipped.map(function (r) { return '<div class="perf-skip">Piste ' + esc(r.id) + ': Rückenwind – nicht berechnet.</div>'; }).join('') +
      factorLineHtml(m.ac) +
      detailsHtml(m.ac, m.af, m.res, m.detailsOpen) + foot;
  }

  // Gesamte Karte als HTML (rein, für Node-Tests)
  function renderHtml(ctx) {
    var m = buildModel(ctx);
    return selectHtml(m) + bodyHtml(m);
  }

  /* ── Kurzzeile unter der Ampel (rein, für Node-Tests) ───────────
     Folge von <span> im Flex-Behälter #perf-teaser-text: Kopf, je Phase eine Zeile, Vorbehalte. Zahlen nur im Zustand
     result, also genau dann, wenn die Karte Pistenblöcke zeigt; je Phase die Strecke über 15 m gegen die verfügbare
     Länge. Bei mehreren gerechneten Pisten die grösste Strecke («bis …», falls verschieden) gegen die kleinste Länge
     («ab …», falls verschieden), Farbe die schwerste Stufe aller Pisten, mindestens amber, wenn die gezeigte Strecke
     die gezeigte Länge übersteigt; fehlt einer Piste der Wert, steht «kein Wert». So ist die Zeile nie günstiger als
     die Karte. Ein Vorbehalt (⚠) steht genau dann, wenn die Karte ein gelbes Element zeigt oder ohne Windrichtung
     gerechnet wurde (bis 3 kt Rückenwind möglich). Farben nur über Klassen. */
  function teaserRowHtml(ph, computed) {
    var label = '<span class="perf-nw">' + PHASE_LABEL[ph] + ' über 15&nbsp;m: ';
    var ps = computed.map(function (r) { return r[ph]; });
    if (!ps.every(function (p) { return p && p.ok; })) {
      return '<span class="perf-t-row">' + label + '<span class="perf-nov">' + TEASER.noValue + '</span></span></span>';
    }
    var vals = ps.map(function (p) { return p.m.overObstacle; });
    var avail = ps.map(function (p) { return p.availableM; });
    var v = Math.max.apply(null, vals), av = Math.min.apply(null, avail);
    var sev = 0;
    ps.forEach(function (p) { sev = Math.max(sev, p.exceeds.groundRoll ? 2 : (p.exceeds.overObstacle ? 1 : 0)); });
    if (sev === 0 && v > av) sev = 1;
    var cls = sev === 2 ? ' class="perf-red"' : (sev === 1 ? ' class="perf-amber"' : '');
    return '<span class="perf-t-row">' + label + (vals.some(function (x) { return x !== v; }) ? 'bis ' : '') +
      '<b' + cls + '>' + fmtInt(v) + '&nbsp;m</b></span> <span class="perf-nw">· verfügbar ' +
      (avail.some(function (x) { return x !== av; }) ? 'ab ' : '') + fmtInt(av) + '&nbsp;m</span></span>';
  }

  // Vorbehalte im Zustand result, feste Reihenfolge: Sperre (frisch, veraltet), Windrichtung, Nässe bzw. «unbekannt»,
  // Hinweis. Sperre, Nässe und «unbekannt» aus denselben Flags wie conditionHtml. «Windrichtung unbekannt» bei
  // Rechnung ohne Windrichtung: die Zahlen gelten ohne Wind, bis 3 kt Rückenwind sind möglich (in der Karte der graue
  // Hinweis). Jedes andere gelbe Element der Karte (unsichere DRY-Meldung, Hinweis) einmal als «Hinweis in den Details».
  function teaserWarnings(m) {
    var f = condFlags(m.fg, m.ws);
    var closed = m.fg.closedReason === 'geschlossen' ? TEASER.closedAll : TEASER.closed;
    var out = [];
    if (f.closed) out.push(closed);
    if (f.closedStale) out.push(closed + TEASER.closedStale);
    if (m.hintKind === 'nodir') out.push(TEASER.dirUnknown);
    if (f.wet) out.push(TEASER.wet);
    if (f.unknown) out.push(TEASER.unknown);
    if (m.notice || ((f.dryNotToday || f.dryStale || f.dryNoStamp) && !f.unknown)) out.push(TEASER.inDetails);
    return out;
  }

  function teaserStateText(m) {
    switch (m.kind) {
      case 'loading': return TEASER.loading;
      case 'data-error': return TEASER.dataError;
      case 'no-wx':
        if (m.a.code === 'source-speck') return TEASER.speck;
        if (m.a.code === 'stale') return m.a.future ? TEASER.future : TEASER.stale;
        if (m.a.code === 'missing') return TEASER.missing;
        return TEASER.noData;                     // no-data, no-source, no-time
      case 'fgzo-pending': return TEASER.fgzoLoading;
      case 'calc-error':
        var code = m.res.error ? m.res.error.code : null;
        if (code === 'invalid-input') return TEASER.invalid;
        if (code === 'above-range') return TEASER.aboveRange;
        if (code === 'bad-data') return TEASER.dataError;
        return TEASER.internal;
      case 'no-direction': return TEASER.noDirection;
      case 'no-runway': return TEASER.noRunway;
      default: return TEASER.internal;
    }
  }

  function teaserHtml(m) {
    var h, warn;
    if (m.kind === 'result') {
      var c = m.computed;
      var where = c.length === 1 ? 'Piste&nbsp;' + esc(c[0].id) : (c.length === 2 ? 'beide Pisten' : c.length + ' Pisten');
      h = '<span class="perf-t-head">' + esc(clip(m.ac.label, LABEL_MAX)) + ' · ' + (m.hintKind ? TEASER[m.hintKind] + ' · ' : '') + where + '</span>' +
        core.PHASES.map(function (ph) { return teaserRowHtml(ph, c); }).join('');
      warn = teaserWarnings(m);
    } else {
      var load = m.kind === 'loading' || m.kind === 'fgzo-pending';
      h = '<span class="perf-t-head">' + TEASER.title + (m.ac ? ' · ' + esc(clip(m.ac.label, LABEL_MAX)) : '') + '</span>' +
        '<span class="' + (load ? 'perf-t-load' : 'perf-t-state') + '">' + teaserStateText(m) + '</span>';
      warn = m.notice ? [TEASER.inDetails] : [];
    }
    return h + warn.map(function (w) { return '<span class="perf-t-warn">' + WARN_SIGN + ' ' + w + '</span>'; }).join('');
  }

  // Karte und Kurzzeile aus einer Rechnung: { sel, body, teaser, selectedId, kind }; sel + body === renderHtml(ctx)
  function renderParts(ctx) {
    var m = buildModel(ctx);
    return { sel: selectHtml(m), body: bodyHtml(m), teaser: teaserHtml(m), selectedId: m.selectedId, kind: m.kind };
  }

  /* ── Browser ───────────────────────────────────────────────── */
  function boot(win) {
    var doc = win.document;
    // box: <details id="perf-box"> mit der Kurzzeile, auf einer alten Seite die Karte selbst; teaser darf fehlen.
    // sel und body liegen in #perf-content; lastSelKey ist das HTML der Auswahl ohne die Markierung «selected».
    var S = {
      card: null, content: null, box: null, sel: null, body: null, teaser: null, started: false,
      index: null, aircraft: null, airfield: null, selectedId: null, pendingId: null, notice: null,
      dataState: 'loading', lastLoadAttempt: 0, loadSeq: 0,
      wx: null, hasUpdate: false, fatal: false,
      fgzo: null, fgzoSeq: 0, fgzoLoaded: false, fgzoDeadline: 0,
      lastSelKey: null, lastBody: null, lastTeaser: null
    };
    var FATAL_MODEL = { kind: 'internal', ac: null, notice: null };
    var FATAL_BODY = bodyHtml(FATAL_MODEL);
    var FATAL_TEASER = teaserHtml(FATAL_MODEL);

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

    // Erst alles mit Zahlen leeren (Karte, Kurzzeile), dann «Rechenfehler» in Karte und Kurzzeile; Auswahl leer
    function showFatal() {
      if (!S.content) return;
      try {
        S.body.innerHTML = '';
        if (S.teaser) S.teaser.innerHTML = '';
        S.sel.innerHTML = '';
        S.body.innerHTML = FATAL_BODY;
        if (S.teaser) S.teaser.innerHTML = FATAL_TEASER;
      } catch (e) { /* nichts mehr zu tun */ }
      S.lastSelKey = '';
      S.lastBody = FATAL_BODY;
      S.lastTeaser = FATAL_TEASER;
    }

    // Fehler in update: alten Wetterstand verwerfen, «Rechenfehler» bleibt bis zum nächsten gültigen update
    function fatal() {
      S.wx = null;
      S.hasUpdate = true;
      S.fatal = true;
      try { if (S.box) S.box.style.display = 'block'; } catch (e) { /* weiter */ }
      showFatal();
    }

    // Die Auswahl wird nur bei geänderter Liste neu geschrieben (Vergleich ohne «selected»). Sonst bleibt das <select>
    // derselbe Knoten: Fokus und eine offene Auswahlliste gehen beim Neuschreiben der Karte nicht verloren. Ändert sich
    // nur die Wahl (Rückfall auf den Standard), wird höchstens value gesetzt.
    function writeSel(html, selectedId) {
      var key = html.replace(/ selected(?=>)/, '');
      if (key !== S.lastSelKey) {
        S.sel.innerHTML = html;
        S.lastSelKey = key;
        return;
      }
      var el = S.sel.querySelector('select');
      if (el && typeof selectedId === 'string' && el.value !== selectedId) el.value = selectedId;
    }

    function render() {
      if (!S.content || !S.hasUpdate) return;
      if (S.fatal) {
        if (S.lastBody !== FATAL_BODY || S.lastSelKey !== '') showFatal();
        return;
      }
      try {
        var d = S.body.querySelector('details.perf-details');
        var p = renderParts({
          dataState: S.dataState, list: S.index ? S.index.list : null,
          selectedId: S.pendingId || S.selectedId || (S.index ? S.index.def : null), notice: S.notice,
          aircraft: S.aircraft, airfield: S.airfield,
          wx: S.wx, fgzo: S.fgzo, fgzoPending: !S.fgzoLoaded && Date.now() < S.fgzoDeadline,
          nowMs: Date.now(), detailsOpen: !!(d && d.open)
        });
        writeSel(p.sel, p.selectedId);
        // Karte und Kurzzeile nur bei geändertem HTML neu setzen, damit ein offenes <details> offen bleibt.
        // Die Box selbst wird nie neu geschrieben und bleibt darum offen oder zu.
        if (p.body !== S.lastBody) {
          S.body.innerHTML = p.body;
          S.lastBody = p.body;
        }
        if (S.teaser && p.teaser !== S.lastTeaser) {
          S.teaser.innerHTML = p.teaser;
          S.lastTeaser = p.teaser;
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

    // Ein fehlgeschlagener Abruf (Netz, HTTP-Fehler, kaputtes JSON, kein Objekt) lässt den letzten Stand stehen;
    // er altert über fetched_at_utc von selbst. Antworten eines älteren Abrufs werden verworfen, ebenso ein
    // Datensatz ohne lesbare oder mit älterer Abrufzeit (fgzoAccept).
    function loadFgzo() {
      var seq = ++S.fgzoSeq;
      getJson('data/fgzo_status.json')
        .then(function (p) {
          if (seq !== S.fgzoSeq) return;
          if (fgzoAccept(S.fgzo, p)) S.fgzo = p;
          S.fgzoLoaded = true;
          render();
        })
        .catch(function () {
          if (seq !== S.fgzoSeq) return;
          S.fgzoLoaded = true;
          render();
        });
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
        S.box.style.display = 'block';
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

    // Auf- und Zuklappen der Kurzzeile merken (Standard zu), wie lszk-wx-open in index.html
    function onToggle() {
      if (S.box.open) storeSet(OPEN_KEY, '1');
      else storeRemove(OPEN_KEY);
    }

    function child(parent, id) {
      var el = doc.getElementById(id);
      if (el) return el;
      el = doc.createElement('div');
      el.id = id;
      parent.appendChild(el);
      return el;
    }

    function start() {
      var card = doc.getElementById('perf-card');
      var content = doc.getElementById('perf-content');
      if (!card || !content) return;          // ohne Karte nichts tun
      S.card = card;
      S.content = content;
      // Alte Seite aus dem Cache (Karte im Wetter-Panel, ohne Box und Kurzzeile): dann die Karte selbst zeigen
      S.box = doc.getElementById('perf-box') || card;
      S.teaser = doc.getElementById('perf-teaser-text');
      S.sel = child(content, 'perf-sel');
      S.body = child(content, 'perf-body');
      if (!doc.getElementById('perf-style')) {
        var st = doc.createElement('style');
        st.id = 'perf-style';
        st.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(st);
      }
      S.sel.addEventListener('change', onChange);
      if (S.box !== card) {
        if (storeGet(OPEN_KEY) === '1') S.box.open = true;   // vor dem ersten Anzeigen
        S.box.addEventListener('toggle', onToggle);
      }
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
    TEASER: TEASER,
    CSS: CSS,
    escapeHtml: esc,
    fmtInt: fmtInt,
    fmtDec: fmtDec,
    fmtUp2: fmtUp2,
    fmtExact: fmtExact,
    fmtWind: fmtWind,
    fmtKt2: fmtKt2,
    adaptLszkWx: adaptLszkWx,
    fgzoState: fgzoState,
    fgzoAccept: fgzoAccept,
    rainState: rainState,
    wetState: wetState,
    parseIndex: parseIndex,
    renderHtml: renderHtml,
    renderParts: renderParts,
    boot: boot
  };
}));
