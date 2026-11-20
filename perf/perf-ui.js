/* Start- und Landestreckenrechner – Kurzzeile unter der Briefing-Ampel (<details id="perf-box">, Text in
   #perf-teaser-text) und Karte #perf-card / #perf-content darin (Datenschema 2).
   Liest window.LSZK_WX (vom Wetterteil der Seite gesetzt) und bekommt Updates über window.LszkPerf.update(wx).
   Lädt perf/aircraft/index.json, die gewählte Flugzeugdatei, perf/airfields/<data-airfield>.json und
   data/fgzo_status.json, rechnet mit window.LszkPerfCore (perf/perf.js) und schreibt Kurzzeile und Karte aus einem
   Modell (buildModel, eine Rechnung). In #perf-content legt das Skript #perf-sel (Auswahl, nur bei geänderter Liste
   neu geschrieben), #perf-mass (Kennzeichen und Feld für das Abfluggewicht, nur bei anderem Muster oder neu geladenen
   Daten neu geschrieben, sonst bleibt das Feld derselbe Knoten) und #perf-body (Karteninhalt) an. Auf- und Zuklappen
   merkt sich lszk-perf-open.
   Abfluggewicht: Vorgabe ist das Höchstgewicht. Eine Eingabe gilt nur im Speicher der Seite (kein localStorage) und
   fällt beim Musterwechsel und beim Tageswechsel (Zürich) zurück auf das Höchstgewicht. Gerechnet wird der Start
   zwischen den AFM-Tabellen interpoliert (massRead «linear»; sonst die Tabelle für das nächsthöhere Gewicht), unter der
   leichtesten Tabelle mit dieser, die Landung mit dem maximalen Landegewicht. Ist der Start nicht möglich, nennt die
   Karte je Piste, bis zu welchem Gewicht er laut AFM möglich wäre (nicht bei nasser Piste ohne AFM-Wert).
   Beim Hineingehen ins Feld ist sein Inhalt markiert. Mit Fokus ist ein Text, der durch Weitertippen noch gültig werden
   kann (leer, oder nur Ziffern unter der Untergrenze), kein Fehler: Es gilt das zuletzt übernommene gültige Gewicht.
   Beim Verlassen die volle Prüfung: leer heisst Höchstgewicht, unter der Untergrenze Fehler.
   Fehlen Box und Kurzzeile (alte Seite aus dem Cache), erscheint wie bisher nur die Karte.
   Die Kurzzeile zeigt Muster, Piste und die Rollstrecke für Start und Landung; die Farbe der Zahl folgt dem
   schlimmsten Fall der Karte. Nässe und Hinweise stehen nur in der aufgeklappten Karte. Platzstatus und Sperre zeigt
   die Ampel der Seite, die Karte nicht.
   Grundsatz: lieber kein Wert als ein falscher. Ohne gültige, frische Messwerte keine Zahlen, auch nicht in der
   Kurzzeile.
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

  var VERSION = 7;

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
  var LABEL_MAX = 60;
  var MASS_DEBOUNCE_MS = 700;  // Abfluggewicht: nach so viel Ruhe beim Tippen rechnen (kein Fehler bei «1», «10», «105»)
  var MASS_SELECT_MS = 1000;   // mouseup und click so lange nach Beginn des Antippens gehören noch zum Hineingehen ins Feld
  var NBSP = ' ';         // geschütztes Leerzeichen in reinen Texten (Fehlertext des Gewichtsfelds)
  // Entscheid F-C: Regen von MeteoSchweiz macht die Piste nass (neben einer FGZO-Meldung ungleich DRY)
  var WET_BY_RAIN = true;
  // Entscheid des Benutzers offen: «Richtwert AFM» sichtbar in der Kurzzeile (direkt nach dem Kopf, nur wenn mindestens
  // eine Phase eine Zahl zeigt).
  // Ausgeliefert aus. Umschalten = diese Zeile und den Test der ausgelieferten Stellung in tests/perf-teaser.test.js ändern.
  var TEASER_AFM_TAG = false;

  var TEXT = {
    noData: 'Keine aktuellen Messwerte vom Platz – keine Berechnung.',
    speck: 'Zurzeit nur Werte der Station Speck verfügbar (Wind zu tief gemessen, Richtungsbezug unbekannt) – keine Berechnung.',
    dataError: 'Flugzeug- oder Platzdaten nicht verfügbar – keine Berechnung.',
    internal: 'Rechenfehler – keine Berechnung.',
    loading: 'Lade Flugzeug- und Platzdaten …',
    fgzoLoading: 'Lade Flugplatzstatus …',
    noHeadwindRunway: 'Keine Piste mit Gegenwind in den Platzdaten – keine Berechnung.',
    // Pflichthinweis am Fuss der Karte, in jedem Zustand und ohne Aufklappen sichtbar
    advice: 'Die Werte sind nur ein Anhaltspunkt. Für die Flugvorbereitung in jedem Fall das AFM der Maschine heranziehen.',
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
    // Rechenweg: Lesehilfe unter den Tabellen (readingText setzt sie aus den Ableseregeln der Daten zusammen) und Zeile
    // für eine Phase ohne Nässewert im AFM
    calcLinear: 'linear interpoliert',
    calcNextHigher: 'nächsthöherer Tabellenwert',
    calcBelow: 'Unter dem kleinsten Tabellenwert gilt dieser, über dem grössten gibt es keinen Wert.',
    calcRound: 'Rundung zur längeren Strecke: Druckhöhe auf ganze ft aufgerundet, Gegenwind abgerundet, Ergebnis aufgerundet. ' +
      'Gegenwind voll angerechnet.',
    calcSurface: 'Graszuschlag in % der Tabellen-Rollstrecke, auf beide Strecken.',
    calcLimits: 'Nicht berücksichtigt: Pistenneigung. Kein eigener Sicherheitszuschlag.',
    calcNoWet: 'nasse Piste: kein Wert im AFM, ohne Zuschlag gerechnet',
    // Abfluggewicht: Beschriftung des Felds, Fehlertexte (reiner Text, ohne HTML; Über- und Untergrenze mit Zahlen in
    // parseMass) und Sätze der Zeile «Start möglich bis …» je Piste
    massLabel: 'Abfluggewicht in kg',
    massEmpty: 'Bitte das Abfluggewicht in kg eingeben.',
    massNotInt: 'Bitte eine ganze Zahl in kg eingeben, zum Beispiel 1050.',
    limitMinimum: 'mit Mindestzuschlag',
    limitLowest: 'Für ein tieferes Gewicht hat das AFM keine Starttabelle.',
    limitWet: 'Ob er mit weniger Gewicht möglich wäre, lässt sich bei nasser Piste nicht sagen: Das AFM nennt dafür keinen Wert.',
    limitNoValue: 'Für tiefere Gewichte gibt es keinen Wert.'
  };

  // Kurzzeile unter der Ampel: Zustände ohne Zahlen, Wörter im Kopf, Zeile mit der Rollstrecke und die versteckten
  // Hinweiswörter für Screenreader (ohne Satzpunkt, ohne HTML)
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
    massError: 'Gewicht ungültig – keine Berechnung',
    calm: 'windstill',
    nodir: 'ohne Windrichtung',
    cross: 'Wind quer',
    afmTag: 'Richtwert AFM',
    roll: 'Rollstrecke',
    noValue: 'kein Wert',
    srRed: '(Rollstrecke länger als verfügbar)',
    srAmber: '(Strecke über 15 m länger als verfügbar)'
  };

  // Feldnamen stammen aus dem Adapter bzw. dem Kern, nie aus Daten; unbekannte heissen «Messwert»
  var FIELD_LABEL = {
    tempC: 'Temperatur', qnhHpa: 'QNH', windKt: 'Wind', windDir: 'Windrichtung', windDirTrue: 'Windrichtung', massKg: 'Abfluggewicht'
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
    // Feld für das Abfluggewicht: Rahmen und Fokus wie das Auswahlfeld, 16 px auf allen Breiten (kein Zoom beim Fokus
    // unter iOS), Fingermass 44 px; ungültige Eingabe mit rotem Rahmen und Fehlertext darunter (leer: ausgeblendet)
    '.perf-mass { margin: 0 0 8px; }',
    '.perf-mass-label { display: block; margin: 0 0 4px; color: var(--text-muted); font-weight: 600; font-size: 0.78rem; }',
    '.perf-mass-in { box-sizing: border-box; display: block; width: 100%; max-width: 9rem; min-height: 44px; margin: 0; font: inherit; ' +
      'font-size: 16px; font-weight: 600; line-height: 1.25; font-variant-numeric: tabular-nums; color: var(--text); ' +
      'background-color: var(--bg); border: 1px solid var(--accent); border-radius: 8px; padding: 8px 12px; ' +
      '-webkit-appearance: none; -moz-appearance: none; appearance: none; }',
    '.perf-mass-in:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.perf-mass-in[aria-invalid="true"] { border-color: #ef4444; }',
    '.perf-mass-hint { color: var(--text-muted); font-size: 0.78rem; margin: 4px 0 0; }',
    '.perf-mass-err { color: #f87171; font-size: 0.82rem; font-weight: 600; margin: 4px 0 0; }',
    '.perf-mass-err:empty { display: none; }',
    '.perf-mass-one { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-nw { white-space: nowrap; }',
    '.perf-head { color: var(--text-muted); margin: 0 0 6px; }',
    '.perf-meas { color: var(--text-muted); margin: 0 0 8px; }',
    '.perf-note { color: #fcd34d; font-size: 0.78rem; margin: 0 0 8px; }',
    '.perf-cond { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 12px; }',
    '.perf-cond.perf-warn { color: #fcd34d; background: rgba(245, 158, 11, 0.12); border-left: 3px solid #f59e0b; padding: 8px 10px; font-size: 0.82rem; font-weight: 600; }',
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
    '.perf-factor { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 10px; }',
    '.perf-state { color: #f87171; font-size: 0.85rem; margin: 4px 0 10px; }',
    '.perf-loading { color: var(--text-muted); font-size: 0.85rem; margin: 4px 0 10px; }',
    '.perf-details { margin: 0 0 10px; font-size: 0.78rem; color: var(--text-muted); }',
    '.perf-details summary { cursor: pointer; padding: 2px 0; }',
    '.perf-calc p { margin: 6px 0; }',
    '.perf-calc-h { color: var(--text); font-weight: 600; }',
    // Schritt-Tabelle im Rechenweg: links der Schritt (bricht um), rechts Rollstrecke und über 15 m (brechen nie um).
    // Höchstens 30rem breit, damit die Zahlen am Desktop beim Schritt bleiben.
    '.perf-steps { width: 100%; max-width: 30rem; border-collapse: collapse; font-variant-numeric: tabular-nums; margin: 4px 0 10px; }',
    '.perf-steps th, .perf-steps td { padding: 3px 0 3px 10px; text-align: right; vertical-align: top; font-weight: 400; }',
    '.perf-steps th:first-child, .perf-steps td:first-child { padding-left: 0; text-align: left; }',
    '.perf-steps td { color: var(--text); white-space: nowrap; }',
    '.perf-steps thead th { font-size: 0.7rem; font-weight: 600; vertical-align: bottom; white-space: nowrap; }',
    '.perf-steps tbody tr { border-top: 1px solid var(--card-border); }',
    '.perf-steps .perf-steps-ph th { padding-top: 8px; color: var(--text); font-weight: 600; }',
    '.perf-steps-src { color: var(--text-muted); font-weight: 400; }',
    '.perf-steps .perf-steps-res th, .perf-steps .perf-steps-res td { color: var(--text); font-weight: 700; }',
    '.perf-steps td.perf-steps-note { color: var(--text-muted); white-space: normal; }',
    '.perf-steps td.perf-nov { color: #f87171; }',
    // Pflichthinweis: immer rot und fett (Wunsch 20.11.), gleiche Grösse wie die übrigen kleinen Zeilen der Karte;
    // #f87171 auf --card-bg hat Kontrast 5 : 1
    '.perf-foot { font-size: 0.78rem; color: #f87171; font-weight: 700; line-height: 1.5; border-top: 1px solid var(--card-border); padding-top: 8px; margin-top: 4px; }',
    // Kurzzeile unter der Ampel: <details class="perf-box"> mit <summary class="perf-teaser">; gleiche Aussenmasse wie die Ampel.
    // display:block auf dem summary blendet das Dreieck aus (Safari: ::-webkit-details-marker); Flex sitzt im inneren span,
    // weil display:flex direkt auf <summary> in älterem Safari nicht greift.
    '.perf-box { max-width: 1600px; margin: 0 auto 16px; }',
    // Flach: wenig Innenabstand und enge Zeilenhöhe; am iPhone (375/393 px) zwei Zeilen, am Desktop eine
    '.perf-teaser { display: block; list-style: none; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 6px 12px; }',
    '.perf-teaser::-webkit-details-marker { display: none; }',
    '.perf-teaser:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }',
    '.perf-box[open] > .perf-teaser { margin-bottom: 8px; }',
    '.perf-t { display: flex; align-items: flex-start; gap: 8px; }',
    '.perf-t-ico, .perf-t-chev { flex: none; width: 18px; height: 18px; color: var(--accent); }',
    '.perf-t-chev { transition: transform 0.2s ease; }',
    '.perf-box[open] .perf-t-chev { transform: rotate(180deg); }',
    '.perf-t-body { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 0 18px; font-size: 0.8rem; line-height: 1.3; color: var(--text); overflow-wrap: break-word; }',
    // Elemente dürfen schmaler werden als ihr längstes Wort (sonst schiebt ein langer Name ohne Leerzeichen die Seite
    // seitlich); umbrochen wird dann per overflow-wrap
    '.perf-t-body > span { min-width: 0; }',
    '.perf-t-head { font-weight: 600; }',
    '.perf-t-tag { color: var(--text-muted); font-weight: 400; }',
    '.perf-t-state { color: #f87171; }',
    '.perf-t-load { color: var(--text-muted); }',
    // Nur für Screenreader: Hinweiswort hinter einer gefärbten Zahl (sichtbar ändert sich nichts)
    '.perf-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }',
    '@media (hover: hover) {',
    '  .perf-teaser:hover { border-color: var(--accent); }',
    '}',
    '@media (max-width: 600px) {',
    '  .perf-box { margin-bottom: 10px; }',
    '  .perf-teaser { padding: 5px 8px; border-radius: 6px; }',
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

  // Zwischenwert im Rechenweg: exakt, höchstens vier Nachkommastellen, ohne nachgestellte Nullen; das Runden auf
  // 0,0001 entfernt nur Gleitkommareste. Ist ein Wert so nicht exakt darstellbar (Interpolation, z. B. Gewicht
  // 9/23), steht «≈» davor und er erscheint auf zwei Nachkommastellen gerundet.
  function fmtExact(x) {
    var s = x * 10000, r = Math.round(s);
    if (Math.abs(s - r) > 1e-3) return '≈' + fmtTrim(Math.round(x * 100) / 100, 2);
    return fmtTrim(r / 10000, 4);
  }

  // Mittelwind: auf eine Nachkommastelle abgeschnitten, nicht gerundet (0,97 kt → 0,9 kt passt zu «unter 1 kt»)
  function fmtWind(v) { return fmtDec(Math.floor(v * 10 + 1e-9) / 10, 1); }

  // Gegenwindkomponente im Rechenweg: auf zwei Nachkommastellen abgeschnitten, nicht gerundet
  // (6,996 kt → 6,99 kt passt zu «abgerundet 6 kt»)
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

  /* ── FGZO-Status: Pistenzustand ─────────────────────────────
     Frisch heisst wie in index.html: letzter erfolgreicher Abruf (fetched_at_utc) jünger als 45 min; ok=false zählt nicht.
     Die letzte bekannte Meldung gilt weiter, in die vorsichtige Richtung:
     – «nicht DRY» zählt als nass, auch veraltet, bei ok=false oder ohne Zeitstempel (updated);
     – DRY gilt nur frisch und mit Zeitstempel als gesichert; veraltet oder nicht von heute erscheint sie als Hinweis,
       ohne Zeitstempel gilt sie als unbekannt.
     Eine Platzsperre (flaeche, flaeche_grund) wertet die Karte nicht aus: Platzstatus und Sperre zeigt die Ampel der Seite.
     Texte der FGZO (updated, runway_condition) werden nur als String übernommen. */
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
      dryNoStamp: false };
    if (!p || typeof p !== 'object' || Array.isArray(p)) return st;
    var t = fgzoFetchedMs(p);
    if (isNum(t)) st.ageMin = (nowMs - t) / 60000;
    st.fresh = st.ageMin !== null && st.ageMin < FGZO_FRESH_MIN;
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

  /* ── Abfluggewicht ─────────────────────────────────────────────
     Eingabe als Text: Leerzeichen und Apostrophe (' ’) fallen weg, dann nur ganze kg mit 1 bis 6 Ziffern (so viele lässt
     das Feld zu, maxlength 6; «123456» ergibt den Text «über dem maximalen Abfluggewicht»). Erlaubt ist das halbe
     Höchstgewicht (aufgerundet) bis zum Höchstgewicht. Die Untergrenze fängt Tippfehler wie «115» statt «1150», die sonst
     still mit der leichtesten Starttabelle gerechnet würden. Ergebnis { kg, error }: genau eines ist null. */
  function massMinKg(ac) { return Math.ceil(ac.mass.kg / 2); }

  // Text des Felds ohne Leerzeichen und Apostrophe; leer heisst: kein Gewicht eingegeben
  function massDigits(text) { return String(text == null ? '' : text).replace(/[\s'’]/g, ''); }

  function parseMass(text, ac) {
    var t = massDigits(text);
    if (!t) return { kg: null, error: TEXT.massEmpty };
    if (!/^\d{1,6}$/.test(t)) return { kg: null, error: TEXT.massNotInt };
    var kg = Number(t), max = ac.mass.kg, min = massMinKg(ac);
    if (kg > max) {
      return { kg: null, error: fmtInt(kg) + NBSP + 'kg liegt über dem maximalen Abfluggewicht von ' + fmtInt(max) + NBSP + 'kg – keine Berechnung.' };
    }
    if (kg < min) return { kg: null, error: fmtInt(kg) + NBSP + 'kg ist unplausibel tief (unter ' + fmtInt(min) + NBSP + 'kg) – keine Berechnung.' };
    return { kg: kg, error: null };
  }

  // Kann der Text durch Weitertippen noch ein gültiges Gewicht werden? Leer, oder nur Ziffern (nach dem Entfernen von
  // Leerzeichen und Apostrophen) mit einem Wert unter der Untergrenze («1», «11», «115» auf dem Weg zu «1150»). Über dem
  // Höchstgewicht oder mit anderen Zeichen hilft Weitertippen nicht. Mit Fokus gilt so ein Text als «noch am Tippen».
  function massIncomplete(text, ac) {
    var t = massDigits(text);
    return !t || (/^\d{1,6}$/.test(t) && Number(t) < massMinKg(ac));
  }

  // Gewicht und Starttabelle(n) für Kopf und Kurzzeile, solange es keine Rechnung gibt (gleiche Wahl wie im Kern);
  // mit Rechnung gilt deren Feld mass. inputKg null: keine Eingabe, gerechnet mit dem Höchstgewicht.
  function massInfo(ac, massKg) {
    var tables = core.takeoffTables(ac);
    var br = core.takeoffMassBracket(ac, massKg);
    var ti = br.upper;
    var lightest = tables[tables.length - 1].kg;
    var interp = br.lower !== null;
    return {
      inputKg: massKg, maxKg: ac.mass.kg, maxLb: ac.mass.lb, tableKg: tables[ti].kg, tableIndex: ti, tableCount: tables.length,
      interpolated: interp, lowerKg: interp ? tables[br.lower].kg : null,
      lightestKg: lightest, belowLowest: massKg !== null && massKg < lightest
    };
  }

  // Liest das Muster das Startgewicht linear zwischen den Tabellen?
  function massLinear(ac) { return ac.charts.takeoff.massRead === 'linear'; }

  // Weicht die Eingabe vom Höchstgewicht ab? (Eingabe = Höchstgewicht zählt wie keine Eingabe)
  function massDiffers(mass) { return !!mass && mass.inputKg !== null && mass.inputKg !== mass.maxKg; }

  /* ── HTML-Bausteine ────────────────────────────────────────── */
  // Pflichthinweis am Fuss der Karte: fester Text in jedem Zustand (footerDe der Flugzeugdaten wird nicht mehr angezeigt)
  function footerHtml() { return '<div class="perf-foot">' + TEXT.advice + '</div>'; }
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

  // Unterzeile der Auswahl: Kennzeichen des gewählten Musters (das Höchstgewicht steht im Hinweis des Gewichtsfelds und
  // in der Kopfzeile). Ein Eintrag, der nicht in der Liste steht, zeigt keine Kennzeichen (nie die eines anderen Musters).
  function subLineHtml(list, selectedId) {
    if (!list || !list.length) return '';
    var entry = null;
    if (list.length < 2) entry = list[0];
    else list.forEach(function (e) { if (!entry && e && e.id === selectedId) entry = e; });
    var parts = (entry && Array.isArray(entry.registrations) ? entry.registrations : []).map(function (r) {
      return '<span class="perf-nw">' + esc(r) + '</span>';
    });
    return '<div class="perf-ac-sub" id="perf-ac-sub">' + parts.join(' · ') + '</div>';
  }

  // Feld für das Abfluggewicht. Hängt nur am Muster (Höchstgewicht, Tabellengewichte), nie an der Eingabe oder am
  // Fehler: So bleibt das Feld beim Neuschreiben der Karte derselbe Knoten. Kein value im HTML (boot setzt den Wert).
  // Ein Muster mit nur einer Starttabelle bekommt kein Feld (jede Eingabe ergäbe dasselbe), nur den Satz dazu.
  function massFieldHtml(ac) {
    var tables = core.takeoffTables(ac);
    if (tables.length < 2) {
      return '<div class="perf-mass-one">Abfluggewicht: ' + fmtInt(ac.mass.kg) + '&nbsp;kg – das AFM hat nur diese Starttabelle.</div>';
    }
    var kgs = tables.map(function (t) { return fmtInt(t.kg); });
    var rule = massLinear(ac)
      ? 'zwischen den AFM-Tabellen für ' + kgs.slice(0, -1).join(', ') + ' und ' + kgs[kgs.length - 1] + '&nbsp;kg interpoliert, ' +
        'darunter gilt die Tabelle für ' + kgs[kgs.length - 1] + '&nbsp;kg'
      : 'gerechnet wird mit der AFM-Tabelle für das nächsthöhere Gewicht (' + kgs.slice(0, -1).join(', ') + ' oder ' +
        kgs[kgs.length - 1] + '&nbsp;kg)';
    return '<div class="perf-mass"><label class="perf-mass-label" for="perf-mass-in">' + TEXT.massLabel + '</label>' +
      '<input id="perf-mass-in" class="perf-mass-in" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="6" ' +
      'aria-describedby="perf-mass-hint perf-mass-err">' +
      '<div class="perf-mass-hint" id="perf-mass-hint">höchstens ' + fmtInt(ac.mass.kg) + '&nbsp;kg · ' + rule + '</div>' +
      '<div class="perf-mass-err" id="perf-mass-err" role="alert"></div></div>';
  }

  // Starttabelle(n) zu einem eingegebenen Gewicht: «zwischen den AFM-Tabellen für 1'134 und 1'111 kg interpoliert»,
  // «nach der AFM-Tabelle für 1'134 kg» bzw. «nach der kleinsten AFM-Tabelle (1'111 kg)»
  function massTableText(mass) {
    if (mass.interpolated) {
      return 'zwischen den AFM-Tabellen für ' + fmtInt(mass.tableKg) + ' und ' + fmtInt(mass.lowerKg) + '&nbsp;kg interpoliert';
    }
    return 'nach der ' + (mass.belowLowest ? 'kleinsten AFM-Tabelle (' + fmtInt(mass.tableKg) + '&nbsp;kg)'
      : 'AFM-Tabelle für ' + fmtInt(mass.tableKg) + '&nbsp;kg');
  }

  function headHtml(ac, mass) {
    var parts;
    if (massDiffers(mass)) {
      parts = ['Abfluggewicht ' + fmtInt(mass.inputKg) + '&nbsp;kg: Start ' + massTableText(mass) +
        ', Landung mit dem maximalen Landegewicht ' + fmtInt(mass.maxKg) + '&nbsp;kg'];
    } else {
      parts = ['Maximales Abfluggewicht ' + fmtInt(ac.mass.kg) + '&nbsp;kg (' + fmtInt(ac.mass.lb) + '&nbsp;lb)'];
    }
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
      case 'massKg': return label + ' ' + fmtDec(v, 1) + '&nbsp;kg';
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
    // Rückfallebene: das Feld lässt nur Gewichte bis zum Höchstgewicht zu (parseMass)
    if (e.code === 'above-mass' && isNum(e.massKg) && isNum(e.maxKg)) {
      return [fmtInt(e.massKg) + '&nbsp;kg liegt über dem maximalen Abfluggewicht von ' + fmtInt(e.maxKg) + '&nbsp;kg – keine Berechnung.'];
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

  /* ── Pistenzustand und Nässe ───────────────────────────────── */
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

  // Welche Zustandszeilen die Karte zeigt.
  // Gelb (Kasten): wet. Hinweisfarbe: dryNotToday, dryStale, dryNoStamp, unknown.
  // Gedämpft: dryToday. Die DRY-Flags und unknown gelten nur, wenn die Piste nicht als nass gilt.
  function condFlags(fg, ws) {
    var dry = !ws.wet && fg.kind === 'dry';
    return {
      wet: ws.wet,
      dryToday: dry && fg.fresh && fg.today, dryNotToday: dry && fg.fresh && !fg.today, dryStale: dry && !fg.fresh,
      dryNoStamp: !ws.wet && fg.dryNoStamp, unknown: !ws.wet && ws.unknown
    };
  }

  // Gelber Kasten: Nässe. Hinweisfarbe: unsichere DRY-Meldung, unbekannter Zustand.
  // Gedämpft: frische DRY-Meldung von heute, Regensatz, «Gerechnet für …» und Vorbehalt.
  function conditionHtml(fg, rn, ws, ac, af, res) {
    var f = condFlags(fg, ws);
    var h = '';
    if (f.wet) {
      var wet = [wetSourceText(fg, rn, ws)].concat(wetConsequences(res));
      if (str(ac.wetNoteDe)) wet.push(esc(ac.wetNoteDe));
      h += '<div class="perf-cond perf-warn" role="note"><div>' + wet.join(' ') + '</div></div>';
    }
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

  // Gewichte als Aufzählung: «1'060 kg», «1'060 und 960 kg», «1'110, 1'060 und 960 kg»
  function kgList(list) {
    var s = list.map(function (t) { return fmtInt(t.kg); });
    return (s.length > 1 ? s.slice(0, -1).join(', ') + ' und ' : '') + s[s.length - 1] + '&nbsp;kg';
  }

  /* Zweite Zeile zum Start einer Piste aus dem Zustand des Kerns (takeoffLimit), nur wenn der Start mit der gewählten
     Tabelle einen Wert hat und nicht möglich ist; X ist das eingegebene Gewicht, sonst das Höchstgewicht.
     limit:       «Start mit X kg laut AFM nicht möglich, möglich bis Y kg.»; ist ein Faktor mit minimum: true
                  eingerechnet (Cessna, nasses Gras «mindestens +20 %»), «… möglich bis Y kg (mit Mindestzuschlag).».
                  Die Rechnung mit der Tabelle Y hat dieselben Faktoren wie die mit der gewählten Tabelle (gleiche
                  Korrekturen, gleiche Piste und Nässe; der Kern wendet Faktoren unabhängig von den Tabellenwerten an).
     Bei massRead «linear» ist Y auf ganze kg gesucht (zwischen den Tabellen interpoliert).
     none:        «Start laut AFM auch mit Z kg nicht möglich.» (Z: leichteste Tabelle)
     lowest:      keine leichtere Tabelle
     wet-unknown: nass ohne Nässewert im AFM – nie «möglich bis»
     unknown:     leichtere Tabellen ohne Wert (und keine möglich); mit Wert, aber nicht möglich, werden sie genannt.
                  Bei «linear» (noValueFromKg): «…, auch nicht mit W kg. Für tiefere Gewichte gibt es keinen Wert.»
                  mit W = leichtestes Gewicht mit Wert; gibt es schon direkt unter X keinen Wert, ohne «auch nicht mit».
     possible, no-value: keine Zeile */
  function limitText(rw, mass) {
    var L = rw.takeoffLimit, p = rw.takeoff;
    if (!L || !p || !p.ok || !mass) return null;
    var kgUsed = mass.inputKg !== null ? mass.inputKg : mass.maxKg;
    var no = 'Start mit ' + fmtInt(kgUsed) + '&nbsp;kg laut AFM nicht möglich';
    switch (L.state) {
      case 'limit':
        var minFactor = p.factors.some(function (f) { return f.minimum === true; });
        return no + ', möglich bis ' + fmtInt(L.maxKg) + '&nbsp;kg' + (minFactor ? ' (' + TEXT.limitMinimum + ')' : '') + '.';
      case 'none': return 'Start laut AFM auch mit ' + fmtInt(L.lightestKg) + '&nbsp;kg nicht möglich.';
      case 'lowest': return no + '. ' + TEXT.limitLowest;
      case 'wet-unknown': return no + '. ' + TEXT.limitWet;
      case 'unknown':
        if (isNum(L.noValueFromKg)) {
          if (L.noValueFromKg >= Math.ceil(kgUsed) - 1) return no + '. ' + TEXT.limitNoValue;
          return no + ', auch nicht mit ' + fmtInt(L.noValueFromKg + 1) + '&nbsp;kg. ' + TEXT.limitNoValue;
        }
        var lighter = (rw.takeoffByMass || []).filter(function (t) { return t.kg < L.tableKg; });
        var val = lighter.filter(function (t) { return t.ok; }), noVal = lighter.filter(function (t) { return !t.ok; });
        if (!val.length || !noVal.length) return no + '. ' + TEXT.limitNoValue;
        return no + ', auch nicht mit ' + kgList(val) + '. Für ' + kgList(noVal) + ' gibt es keinen Wert.';
      default: return null;
    }
  }

  // Ist der Start auf dieser Piste laut AFM nicht möglich (mit Wert und zu lang)?
  function startNotPossible(rw) {
    var L = rw.takeoffLimit;
    return !!L && L.state !== 'possible' && L.state !== 'no-value';
  }

  function blockHtml(rw, mass) {
    var phases = [['Start', rw.takeoff], ['Landung', rw.landing]];
    var rows = phases.map(function (x) {
      var p = x[1];
      return '<tr><th scope="row">' + x[0] + '</th>' + distCell(p, 'groundRoll') + distCell(p, 'overObstacle') +
        '<td>' + fmtInt(p.availableM) + '&nbsp;m</td></tr>';
    }).join('');
    var seen = {};
    var findings = [];
    phases.forEach(function (x, k) {
      var label = x[0], p = x[1], h = null;
      if (p.ok) {
        // Je Phase höchstens eine Feststellung, die schwerere gewinnt
        if (p.exceeds.groundRoll) h = '<div class="perf-finding perf-red">' + label + ': Rollstrecke länger als die verfügbare Länge.</div>';
        else if (p.exceeds.overObstacle) h = '<div class="perf-finding perf-amber">' + label + ': Strecke über 15 m länger als die verfügbare Länge.</div>';
      } else {
        h = '<div class="perf-finding perf-nov">' + reasonText(label, p) + '</div>';
      }
      if (h && !seen[h]) { seen[h] = true; findings.push(h); }
      // Nach der Feststellung zum Start: bis zu welchem Gewicht er möglich wäre, in derselben Farbe
      var lim = k === 0 ? limitText(rw, mass) : null;
      if (lim) findings.push('<div class="perf-finding ' + (p.exceeds.groundRoll ? 'perf-red' : 'perf-amber') + '">' + lim + '</div>');
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

  /* ── Rechenweg und Quellen ─────────────────────────────────────
     Aufbau: eine Zeile Eingaben, je Rechnung eine Schritt-Tabelle (Zeilen = Schritte, Spalten = Rollstrecke und
     über 15 m, je Phase ein Block mit Quellenangabe), darunter die Lesehilfe. Pisten mit derselben Rechnung
     (windstill, ohne Windrichtung, Wind quer bei gleichem Belag) teilen sich eine Tabelle.
     Zwischenwerte exakt; nur das letzte Wertepaar vor dem Aufrunden auf ganze Meter (bei Tabellen in ft das Paar
     in m) erscheint auf 0,01 aufgerundet. Das ist zulässig, weil ceil(ceil_0,01(x)) = ceil(x).
     Nicht angezeigt werden footerDe, readingRuleDe, massNoteDe, conditionsDe, notesDe, der Titel der Tabelle und die
     Einzelheiten der Quellen (title, number, issue …); sie bleiben als Beleg in den Flugzeugdaten. */
  var AXIS_UNIT = { pressureAltitude: 'ft', temperature: '°C' };

  function lastStep(p) {
    if (!p.ok) return '';
    if (p.unit === 'ft') return 'meters';
    if (p.factors.length) return 'factor' + (p.factors.length - 1);
    if (p.surface) return 'surface';
    if (p.wind.applied) return 'wind';
    return 'table';
  }

  // Werte der Achsen, «2'000 ft / 20 °C». Der Kern lässt nur Druckhöhe und Temperatur zu; eine andere Achse erschiene
  // ohne Einheit.
  function axesText(lk, vals) {
    return lk.axes.map(function (a, i) {
      var unit = AXIS_UNIT[a.quantity];
      return fmtExact(vals[i]) + (unit ? '&nbsp;' + unit : '');
    }).join(' / ');
  }

  // Punkt der Interpolation: nur die interpolierten Achsen mit ihrer Eingabe, «2'002 ft / 7,9 °C» bzw. «15,0 °C»
  // (die übrigen stehen in den Tabellenzeilen darüber). Temperatur mit einer Nachkommastelle wie in den Eingaben.
  function inputText(lk) {
    return lk.axes.filter(function (a) { return a.interpolated; }).map(function (a) {
      var unit = AXIS_UNIT[a.quantity];
      return (a.quantity === 'temperature' ? fmtDec(a.input, 1) : fmtExact(a.input)) + (unit ? '&nbsp;' + unit : '');
    }).join(' / ');
  }

  // Ablesung einer Tabelle: die verwendeten Zellen (eine, zwei oder vier) und bei Interpolation der Wert dazwischen.
  // pre: Gewicht der Tabelle, wenn zwischen zwei Starttabellen interpoliert wird («1'134 kg»), sonst leer.
  function lookupRows(lk, u, pre, up) {
    var tab = 'Tabelle ' + (pre ? pre + ' · ' : '');
    if (!lk.interpolated) return stepRow(tab + axesText(lk, lk.corners[0].axisValues), lk.values, u, up);
    return lk.corners.map(function (c) { return stepRow(tab + axesText(lk, c.axisValues), c.values, u); }).join('') +
      stepRow((pre ? pre + ' · ' : '') + 'interpoliert für ' + inputText(lk), lk.values, u, up);
  }

  // Zeile eines Schritts: Beschriftung, Rollstrecke, Strecke über 15 m
  function stepRow(label, v, unit, up) {
    var f = up ? fmtUp2 : fmtExact;
    return '<tr><th scope="row">' + label + '</th><td>' + f(v.groundRoll) + '&nbsp;' + unit + '</td><td>' + f(v.overObstacle) + '&nbsp;' + unit + '</td></tr>';
  }
  // Zeile ohne Zahlen
  function noteRow(text) { return '<tr><td class="perf-steps-note" colspan="3">' + text + '</td></tr>'; }
  // Abbruch der Phase: kein Wert
  function stopRow(label) { return '<tr><th scope="row">' + label + '</th><td class="perf-nov" colspan="2">kein Wert</td></tr>'; }

  // Gegenwind-Regel des AFM für die Beschriftung: wie findRule im Kern die erste (der Kern lässt höchstens eine je Tabelle zu)
  function headwindRule(ch) {
    for (var i = 0; i < ch.corrections.length; i++) if (ch.corrections[i].kind === 'headwind') return ch.corrections[i];
    return null;
  }

  // Fundstelle einer Tabelle: «Figure 5-1c (Section 5b), Seite 5b-6»
  function refText(ref) {
    if (!ref || typeof ref !== 'object') ref = {};
    var out = [];
    if (str(ref.figure)) out.push(esc(ref.figure));
    if (str(ref.page)) out.push('Seite ' + esc(ref.page));
    return out.join(', ');
  }

  // Block einer Phase: Kopfzeile mit Quelle (Handbuch, Tabelle, Seite), dann die Schritte bis zum aufgerundeten Ergebnis,
  // danach extra (Zeile je Starttabelle). Beim Start ist die Quelle die gewählte Starttabelle (res.mass.tableRef), bei
  // Interpolation im Gewicht beide Starttabellen (tableRef und lowerRef). Hat das Muster mehrere Starttabellen, nennt
  // der Kopf beim Start deren Gewicht und bei der Landung das maximale Landegewicht.
  function phaseRows(ph, p, ac, mass, extra) {
    var ch = ac.charts[ph];
    var src = ac.sources[ch.source] || {};
    var where = [esc(str(src.labelDe) || ch.source)];
    var two = ph === 'takeoff' && mass && mass.interpolated;
    var r1 = ph === 'takeoff' && mass ? mass.tableRef : ch.ref, r2 = two ? mass.lowerRef : null;
    if (two && r1 && r2 && str(r1.figure) && r1.figure === r2.figure && str(r1.page) && str(r2.page)) {
      // gleiche Fundstelle, zwei Seiten: «Section 5, Ziffer 7, Seiten MT5-7 und MT5-8»
      where.push(esc(r1.figure) + ', Seiten ' + esc(r1.page) + ' und ' + esc(r2.page));
    } else {
      var refs = [refText(r1)].concat(two ? [refText(r2)] : []).filter(Boolean);
      if (refs.length) where.push(refs.join(' und '));
    }
    var add = '';
    if (mass && mass.tableCount > 1) {
      add = ph === 'takeoff'
        ? (two ? ' · Tabellen ' + fmtInt(mass.tableKg) + ' und ' + fmtInt(mass.lowerKg) : ' · Tabelle ' + fmtInt(mass.tableKg)) + '&nbsp;kg'
        : ' · maximales Landegewicht ' + fmtInt(mass.maxKg) + '&nbsp;kg';
    }
    return '<tr class="perf-steps-ph"><th colspan="3" scope="rowgroup">' + PHASE_LABEL[ph] + ' <span class="perf-steps-src">· ' +
      where.join(', ') + add + '</span></th></tr>' + stepRows(p, ac.charts[ph]) + (extra || '');
  }

  // Schritte einer Phase. Alle Werte stammen aus der Rechnung (p). Aus den Flugzeugdaten (ch) kommt nur bei der
  // Prozentregel des Winds deren Satz je kt (das Ergebnis der Rechnung enthält nur das abgerundete Prozent).
  // Ablesung: die verwendeten Tabellenzellen und, wo interpoliert wird, der Wert dazwischen; bei Interpolation im
  // Gewicht zuerst die schwerere, dann die leichtere Starttabelle und zuletzt der Wert für das Gewicht.
  function stepRows(p, ch) {
    var h = '';
    var u = p.unit, lk = p.lookup, last = lastStep(p), w = p.wind;
    if (lk.mass) {
      var mm = lk.mass;
      h += lookupRows(mm.upper, u, fmtInt(mm.upperKg) + '&nbsp;kg', false) +
        lookupRows(mm.lower, u, fmtInt(mm.lowerKg) + '&nbsp;kg', false) +
        stepRow('interpoliert für ' + fmtInt(mm.kg) + '&nbsp;kg', p.table, u, last === 'table');
    } else {
      h += lookupRows(lk, u, '', last === 'table');
    }
    if (!p.ok && p.reason === 'headwind-limit') return h + stopRow('Gegenwind ' + w.kt + '&nbsp;kt: über ' + fmtInt(p.limitKt) + '&nbsp;kt');
    if (w.kt >= 1 && w.applied) {
      // Regel des AFM und ihr Ergebnis: ganzzahlig «= −70 m», sonst «, abgerundet −22 m» (zur längeren Strecke)
      var s = 'Gegenwind ' + w.kt + '&nbsp;kt: ', per = (w.per === 1 ? '' : fmtExact(w.per) + '&nbsp;') + 'kt';
      if (w.type === 'percentPer') {
        var rule = headwindRule(ch);
        var pct = rule && rule.type === 'percentPer' ? Math.abs(rule.percent) : null;
        if (pct !== null) s += '−' + fmtExact(pct) + '&nbsp;% je ' + per + (Math.abs(pct * w.kt / w.per - w.percent) < 1e-9 ? ' = ' : ', abgerundet ');
        s += '−' + w.percent + '&nbsp;%';
      } else {
        s += '−' + fmtExact(w.perKt) + '&nbsp;' + u + ' je ' + per +
          (Math.abs(w.perKt * w.kt / w.per - w.reduction) < 1e-9 ? ' = −' : ', abgerundet −') + fmtInt(w.reduction) + '&nbsp;' + u;
      }
      if (!p.ok && p.reason === 'wind-credit-limit') return h + stopRow(s + ', mehr als die Hälfte');
      h += stepRow(s, p.afterWind, u, last === 'wind');
    } else if (w.kt >= 1) {
      h += noteRow('Gegenwind ' + w.kt + '&nbsp;kt: nicht angerechnet (keine Regel in den Flugzeugdaten)');
    }
    if (!p.ok) return h + stopRow(p.reason === 'no-surface-rule' ? 'keine Korrektur für den Belag' : 'Rechenfehler');
    if (p.surface) {
      // Zuschlag mit Vorzeichen; gerundet «≈+38,83» statt «+≈38,83»
      var inc = fmtExact(p.surface.inc);
      inc = inc.charAt(0) === '≈' ? '≈+' + inc.slice(1) : '+' + inc;
      h += stepRow((SURFACE_LABEL[p.surface.surface] || esc(p.surface.surface)) + ' +' + fmtExact(p.surface.percent) + '&nbsp;% von ' +
        fmtExact(p.surface.base) + '&nbsp;' + u + ' = ' + inc + '&nbsp;' + u, p.surface.after, u, last === 'surface');
    }
    p.factors.forEach(function (f, i) {
      h += stepRow(esc(f.labelDe) + (f.minimum ? ': mindestens × ' : ' × ') + fmtFactor(f.factor), f.after, u, last === 'factor' + i);
    });
    if (p.wetFactorMissing) h += noteRow(TEXT.calcNoWet);
    if (u === 'ft') h += stepRow('in Meter (× ' + fmtExact(core.FT_M) + ')', p.meters, 'm', true);
    return h + '<tr class="perf-steps-res"><th scope="row">aufgerundet</th><td>' + fmtInt(p.m.groundRoll) + '&nbsp;m</td><td>' +
      fmtInt(p.m.overObstacle) + '&nbsp;m</td></tr>';
  }

  // Zusatz zur Piste: ohne Windkorrektur mit Grund, sonst Pistenrichtung und Gegenwindkomponente (abgeschnitten, fmtKt2)
  function runwayNote(rw) {
    var w = rw.wind;
    if (w.mode === 'calm') return ' · windstill, ohne Windkorrektur';
    if (w.mode === 'nodir') return ' · Windrichtung nicht gemeldet, ohne Windkorrektur';
    if (w.along === 0) return ' · Wind genau quer, ohne Windkorrektur';
    return ' (' + fmtInt(rw.bearingTrue) + '° rechtweisend) · Gegenwind ' + fmtKt2(w.componentKt) + '&nbsp;kt, abgerundet ' + w.kt + '&nbsp;kt';
  }

  // Zeile je Starttabelle unter dem Start: Strecke über 15 m mit jeder Tabelle (Grundlage von «möglich bis»). Ohne die
  // verfügbare Länge, damit Pisten mit gleicher Rechnung weiter eine Tabelle teilen.
  function byMassRow(rw) {
    return noteRow('Über 15 m je Starttabelle: ' + rw.takeoffByMass.map(function (t) {
      return fmtInt(t.kg) + '&nbsp;kg ' + (t.ok ? fmtInt(t.m.overObstacle) + '&nbsp;m' : 'kein Wert');
    }).join(' · '));
  }

  function stepsTable(rw, ac, mass, byMass) {
    return '<table class="perf-steps"><thead><tr><th></th><th scope="col">Rollstrecke</th><th scope="col">über 15 m</th></tr></thead>' +
      core.PHASES.map(function (ph) {
        return '<tbody>' + phaseRows(ph, rw[ph], ac, mass, ph === 'takeoff' && byMass ? byMassRow(rw) : '') + '</tbody>';
      }).join('') + '</table>';
  }

  // Erster Eintrag der Eingaben: Gewicht und Starttabelle(n)
  function massEntry(mass) {
    if (mass.tableCount < 2) return 'Gewicht ' + fmtInt(mass.maxKg) + '&nbsp;kg (einzige Starttabelle)';
    if (!massDiffers(mass)) return 'Gewicht ' + fmtInt(mass.maxKg) + '&nbsp;kg (maximales Abfluggewicht)';
    if (mass.interpolated) {
      return 'Gewicht ' + fmtInt(mass.inputKg) + '&nbsp;kg, zwischen den Starttabellen ' + fmtInt(mass.tableKg) + ' und ' +
        fmtInt(mass.lowerKg) + '&nbsp;kg interpoliert';
    }
    return 'Gewicht ' + fmtInt(mass.inputKg) + '&nbsp;kg, Starttabelle ' + fmtInt(mass.tableKg) + '&nbsp;kg';
  }

  var QTY_LABEL = { pressureAltitude: 'Druckhöhe', temperature: 'Temperatur' };

  // Aufzählung «A», «A und B», «A, B und C»
  function listDe(items) {
    return items.length > 1 ? items.slice(0, -1).join(', ') + ' und ' + items[items.length - 1] : (items[0] || '');
  }

  /* Lesehilfe unter dem Rechenweg, so wie die Daten abgelesen werden: Grössen mit «linear» interpoliert, mit
     «nextHigher» nächsthöherer Tabellenwert (je Grösse über Start- und Landetabelle), dazu das Startgewicht bei mehreren
     Starttabellen. Der Graszuschlag nur, wenn er in einer gerechneten Phase eingerechnet ist; sonst bei gleichem Belag
     wie die Tabellen der Hinweis, dass die Tabellen dafür gelten. */
  function readingText(ac, res) {
    var by = { linear: [], nextHigher: [] };
    ['pressureAltitude', 'temperature'].forEach(function (q) {
      var reads = {};
      core.PHASES.forEach(function (ph) {
        ac.charts[ph].table.axes.forEach(function (a) { if (a.quantity === q) reads[a.read] = true; });
      });
      Object.keys(by).forEach(function (r) { if (reads[r]) by[r].push(QTY_LABEL[q]); });
    });
    if (core.takeoffTables(ac).length > 1) by[massLinear(ac) ? 'linear' : 'nextHigher'].push('Startgewicht');
    var s = [];
    if (by.linear.length) s.push(listDe(by.linear) + ' ' + TEXT.calcLinear + '.');
    if (by.nextHigher.length) s.push(listDe(by.nextHigher) + ': ' + TEXT.calcNextHigher + '.');
    s.push(TEXT.calcBelow, TEXT.calcRound);
    var computed = res.runways.filter(function (rw) { return rw.computed; });
    var surf = computed.some(function (rw) {
      return core.PHASES.some(function (ph) { return rw[ph] && rw[ph].ok && rw[ph].surface; });
    });
    if (surf) {
      s.push(TEXT.calcSurface);
    } else {
      var same = {};
      computed.forEach(function (rw) {
        core.PHASES.forEach(function (ph) { if (rw.surface === ac.charts[ph].base.surface) same[rw.surface] = true; });
      });
      var keys = Object.keys(same);
      if (keys.length === 1 && SURFACE_LABEL[keys[0]]) s.push('AFM-Tabellen für ' + SURFACE_LABEL[keys[0]] + ', ohne Belagszuschlag.');
    }
    return s.join(' ');
  }

  function detailsHtml(ac, af, res, open, mass) {
    var h = ['<details class="perf-details"' + (open ? ' open' : '') + '><summary>Rechenweg und Quellen</summary><div class="perf-calc">'];
    // Eingaben der Rechnung, zuerst Gewicht und Starttabelle
    h.push('<p><span class="perf-calc-h">Eingaben:</span> ' + [
      massEntry(mass),
      'Druckhöhe ' + fmtInt(ceilEps(res.pressureAltitudeFt)) + '&nbsp;ft (QNH ' + fmtQnh(res.input.qnhHpa) + '&nbsp;hPa, Platzhöhe ' +
        fmtInt(af.elevation.value) + '&nbsp;ft)',
      'Temperatur ' + fmtDec(res.input.tempC, 1) + '&nbsp;°C',
      res.input.runwayWet ? 'Piste nass gerechnet' : 'Piste trocken gerechnet'
    ].join(' · ') + '</p>');
    // Ist der Start auf einer gerechneten Piste nicht möglich, steht unter jedem Start die Zeile je Starttabelle
    // (nur bei mehreren Starttabellen)
    var byMass = mass.tableCount > 1 && res.runways.some(function (rw) { return rw.computed && rw.takeoffByMass && startNotPossible(rw); });
    // Pisten mit gleicher Zeile und gleicher Tabelle teilen sich einen Block (Vergleich des fertigen HTML)
    var groups = [];
    res.runways.forEach(function (rw) {
      if (!rw.computed) return;
      var body = runwayNote(rw) + '</p>' + stepsTable(rw, ac, mass, byMass && !!rw.takeoffByMass);
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].body === body) { groups[i].ids.push(esc(rw.id)); return; }
      }
      groups.push({ ids: [esc(rw.id)], body: body });
    });
    groups.forEach(function (g) {
      var n = g.ids.length;
      h.push('<p><span class="perf-calc-h">' + (n === 1 ? 'Piste ' + g.ids[0] : 'Pisten ' + g.ids.slice(0, n - 1).join(', ') + ' und ' + g.ids[n - 1]) +
        '</span>' + g.body);
    });
    // Lesehilfe so, wie die Daten abgelesen werden
    h.push('<p>' + readingText(ac, res) + ' ' + TEXT.calcLimits + '</p>');
    h.push('</div></details>');
    return h.join('');
  }

  /* ── Modell: eine Rechnung für alle Darstellungen (rein, für Node-Tests) ── */
  // ctx: { dataState: 'loading'|'ready'|'error', list, selectedId, notice, aircraft, airfield,
  //        wx (window.LSZK_WX), fgzo, fgzoPending, nowMs, detailsOpen, afmTag (Vorgabe TEASER_AFM_TAG),
  //        massText (übernommene Eingabe des Gewichtsfelds; fehlt sie oder ist sie null, gilt das Höchstgewicht) }
  // kind: internal | loading | data-error | no-wx | fgzo-pending | mass-error | calc-error | no-direction | no-runway | result.
  // core.compute läuft höchstens einmal. notice steht nur in den Zuständen, in denen die Karte ihn zeigt;
  // selectedId ist ab geladenen Daten die id des geladenen Musters. massError: Fehlertext des Felds (in jedem Zustand mit
  // geladenem Muster), mass: Gewicht und Starttabelle (mit Rechnung aus deren Feld mass).
  function buildModel(ctx) {
    ctx = ctx || {};
    var m = {
      kind: 'internal', nowMs: isNum(ctx.nowMs) ? ctx.nowMs : Date.now(), list: ctx.list, selectedId: ctx.selectedId,
      notice: null, detailsOpen: !!ctx.detailsOpen, afmTag: typeof ctx.afmTag === 'boolean' ? ctx.afmTag : TEASER_AFM_TAG,
      ac: null, af: null, a: null, fg: null, rn: null, ws: null, res: null, hintKind: null, computed: null,
      mass: null, massError: null
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
    // Abfluggewicht: nur bei mehreren Starttabellen (sonst gibt es kein Feld) und nur, was parseMass zulässt
    var pm = { kg: null, error: null };
    if (typeof ctx.massText === 'string' && core.takeoffTables(ac).length > 1) pm = parseMass(ctx.massText, ac);
    m.mass = massInfo(ac, pm.kg);
    m.massError = pm.error;
    var a = m.a = adaptLszkWx(ctx.wx, m.nowMs);
    if (!a.ok) {
      m.kind = 'no-wx';
      return m;
    }
    if (ctx.fgzoPending) {
      m.kind = 'fgzo-pending';
      return m;
    }
    // Ungültiges Gewicht: keine Zahlen, auch nicht die zum letzten gültigen Gewicht
    if (m.massError) {
      m.kind = 'mass-error';
      return m;
    }
    m.fg = fgzoState(ctx.fgzo, m.nowMs);
    m.rn = rainState(a);
    m.ws = wetState(m.fg, m.rn);
    var input = { tempC: a.wx.tempC, qnhHpa: a.wx.qnhHpa, windDirTrue: a.wx.windDirTrue, windKt: a.wx.windKt, runwayWet: m.ws.wet,
      massKg: pm.kg };
    var res = m.res = core.compute(ac, af, input);
    if (res.ok && res.mass) m.mass = res.mass;   // Kopf, Karte und Kurzzeile so, wie gerechnet wurde
    if (!res.ok) m.kind = 'calc-error';
    else if (res.mode === 'no-direction') m.kind = 'no-direction';
    else if (res.computedCount === 0) m.kind = 'no-runway';
    else {
      if (res.mode === 'calm') m.hintKind = 'calm';
      else if (res.mode === 'nodir') m.hintKind = 'nodir';
      else if (isCross(res)) m.hintKind = 'cross';
      m.computed = res.runways.filter(function (r) { return r.computed; });
      m.kind = 'result';
    }
    return m;
  }

  /* ── Karte als HTML: Auswahl und Inhalt ────────────────────── */
  function selectHtml(m) {
    return m.kind === 'internal' ? '' : selectionHtml(m.list, m.selectedId);
  }

  var HINT_TEXT = { calm: TEXT.calm, nodir: TEXT.nodir, cross: TEXT.cross };

  // Unter der Auswahl: Kennzeichen (Unterzeile), nach dem Laden der Flugzeugdaten das Gewichtsfeld. Hängt nicht an der
  // Eingabe oder am Fehler des Felds, nur an Liste, Wahl und Muster (boot schreibt es nur bei Änderung neu).
  function massHtml(m) {
    if (m.kind === 'internal') return '';
    var sub = subLineHtml(m.list, m.selectedId);
    if (m.kind === 'loading' || m.kind === 'data-error') return sub;
    if (!m.ac) return '';
    return sub + massFieldHtml(m.ac);
  }

  // Karteninhalt unter Auswahl und Gewichtsfeld
  function bodyHtml(m) {
    var foot = footerHtml();
    if (m.kind === 'internal') return stateHtml(TEXT.internal) + foot;
    if (m.kind === 'loading') return '<div class="perf-loading">' + TEXT.loading + '</div>' + foot;
    if (m.kind === 'data-error') return noticeHtml(m.notice) + stateHtml(TEXT.dataError) + foot;
    if (!m.ac) return stateHtml(TEXT.internal) + foot;
    var head = headHtml(m.ac, m.mass) + noticeHtml(m.notice);
    switch (m.kind) {
      case 'no-wx': return head + stateHtml(adapterText(m.a, m.nowMs)) + foot;
      case 'fgzo-pending': return head + '<div class="perf-loading">' + TEXT.fgzoLoading + '</div>' + foot;
      case 'mass-error': return head + stateHtml(esc(m.massError)) + foot;
      case 'calc-error': return head + errorTexts(m.res).map(stateHtml).join('') + foot;
      case 'no-direction': return head + stateHtml(TEXT.noDirection) + foot;
      case 'no-runway': return head + stateHtml(TEXT.noHeadwindRunway) + foot;
      case 'result': break;
      default: return stateHtml(TEXT.internal) + foot;
    }
    var hint = m.hintKind ? HINT_TEXT[m.hintKind] : '';
    return head + measHtml(m.a, m.res, m.nowMs) + conditionHtml(m.fg, m.rn, m.ws, m.ac, m.af, m.res) +
      (hint ? '<div class="perf-hint">' + hint + '</div>' : '') +
      '<div class="perf-grid">' + m.computed.map(function (rw) { return blockHtml(rw, m.mass); }).join('') + '</div>' +
      factorLineHtml(m.ac) +
      detailsHtml(m.ac, m.af, m.res, m.detailsOpen, m.mass) + foot;
  }

  // Gesamte Karte als HTML (rein, für Node-Tests)
  function renderHtml(ctx) {
    var m = buildModel(ctx);
    return selectHtml(m) + massHtml(m) + bodyHtml(m);
  }

  /* ── Kurzzeile unter der Ampel (rein, für Node-Tests) ───────────
     Folge von <span> im Flex-Behälter #perf-teaser-text: Kopf und eine Zeile «Rollstrecke: Start … · Landung …».
     Zahlen nur im Zustand result, also genau dann, wenn die Karte Pistenblöcke zeigt. Je Phase die Rollstrecke, bei
     mehreren gerechneten Pisten die grösste («bis …», falls verschieden). Die Farbe zeigt den schlimmsten Fall aller
     gerechneten Pisten wie die Karte: rot, wenn eine Rollstrecke länger ist als verfügbar, sonst amber, wenn eine
     Strecke über 15 m länger ist als verfügbar; dahinter ein verstecktes Hinweiswort für Screenreader. Fehlt einer
     Piste der Wert, steht «kein Wert». Keine Vorbehaltszeilen: Nässe und Hinweise stehen nur in der aufgeklappten
     Karte. Farben nur über Klassen. */
  // Zeigt diese Phase eine Zahl? Nur wenn jede gerechnete Piste in der Phase einen Wert hat, sonst «kein Wert».
  function phaseHasValue(ph, computed) {
    return computed.every(function (r) { return r[ph] && r[ph].ok; });
  }

  // Eine Phase der Zeile: «Start 449 m» (gefärbt mit Hinweiswort) bzw. «Start kein Wert»
  function teaserPhaseHtml(ph, computed) {
    var label = '<span class="perf-nw">' + PHASE_LABEL[ph] + ' ';
    if (!phaseHasValue(ph, computed)) return label + '<span class="perf-nov">' + TEASER.noValue + '</span></span>';
    var ps = computed.map(function (r) { return r[ph]; });
    var vals = ps.map(function (p) { return p.m.groundRoll; });
    var v = Math.max.apply(null, vals);
    var red = ps.some(function (p) { return p.exceeds.groundRoll; });
    var amber = !red && ps.some(function (p) { return p.exceeds.overObstacle; });
    return label + (vals.some(function (x) { return x !== v; }) ? 'bis ' : '') +
      '<b' + (red ? ' class="perf-red"' : (amber ? ' class="perf-amber"' : '')) + '>' + fmtInt(v) + '&nbsp;m</b>' +
      (red || amber ? '<span class="perf-sr"> ' + (red ? TEASER.srRed : TEASER.srAmber) + '</span>' : '') + '</span>';
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
      case 'mass-error': return TEASER.massError;
      case 'calc-error':
        var code = m.res.error ? m.res.error.code : null;
        if (code === 'invalid-input') return TEASER.invalid;
        if (code === 'above-range') return TEASER.aboveRange;
        if (code === 'above-mass') return TEASER.massError;
        if (code === 'bad-data') return TEASER.dataError;
        return TEASER.internal;
      case 'no-direction': return TEASER.noDirection;
      case 'no-runway': return TEASER.noRunway;
      default: return TEASER.internal;
    }
  }

  var HEAD_WORD = { calm: TEASER.calm, nodir: TEASER.nodir, cross: TEASER.cross };

  // Kopf: Muster, das eingegebene Gewicht (nur wenn es vom Höchstgewicht abweicht), «windstill», «ohne Windrichtung»
  // bzw. «Wind quer», die Piste. Zwei gerechnete Pisten ohne Zusatz (Entscheid: «beide Pisten» entfällt, damit die
  // Kurzzeile am iPhone zweizeilig bleibt; der Grund steht im Wort davor), mehr als zwei (nur Testplätze) mit Anzahl.
  // Mit m.afmTag folgt «Richtwert AFM» als eigenes Element, aber nur, wenn mindestens eine Phase eine Zahl zeigt
  // (nicht bei zweimal «kein Wert»).
  function teaserHtml(m) {
    if (m.kind === 'result') {
      var c = m.computed;
      var head = [esc(clip(m.ac.label, LABEL_MAX))];
      if (massDiffers(m.mass)) head.push(fmtInt(m.mass.inputKg) + '&nbsp;kg');
      if (m.hintKind) head.push(HEAD_WORD[m.hintKind]);
      if (c.length === 1) head.push('Piste&nbsp;' + esc(c[0].id));
      else if (c.length > 2) head.push(c.length + ' Pisten');
      var tag = m.afmTag && core.PHASES.some(function (ph) { return phaseHasValue(ph, c); });
      return '<span class="perf-t-head">' + head.join(' · ') + '</span>' +
        (tag ? '<span class="perf-t-tag">' + TEASER.afmTag + '</span>' : '') +
        '<span class="perf-t-row">' + TEASER.roll + ': ' + core.PHASES.map(function (ph) { return teaserPhaseHtml(ph, c); }).join(' · ') + '</span>';
    }
    var load = m.kind === 'loading' || m.kind === 'fgzo-pending';
    return '<span class="perf-t-head">' + TEASER.title + (m.ac ? ' · ' + esc(clip(m.ac.label, LABEL_MAX)) : '') + '</span>' +
      '<span class="' + (load ? 'perf-t-load' : 'perf-t-state') + '">' + teaserStateText(m) + '</span>';
  }

  // Karte und Kurzzeile aus einer Rechnung: { sel, mass, body, teaser, selectedId, kind, massError };
  // sel + mass + body === renderHtml(ctx)
  function renderParts(ctx) {
    var m = buildModel(ctx);
    return { sel: selectHtml(m), mass: massHtml(m), body: bodyHtml(m), teaser: teaserHtml(m), selectedId: m.selectedId, kind: m.kind,
      massError: m.massError };
  }

  /* ── Browser ───────────────────────────────────────────────── */
  function boot(win) {
    var doc = win.document;
    // box: <details id="perf-box"> mit der Kurzzeile, auf einer alten Seite die Karte selbst; teaser darf fehlen.
    // sel, mass und body liegen in #perf-content; lastSelKey ist das HTML der Auswahl ohne die Markierung «selected».
    // Abfluggewicht nur im Speicher: massDraft = getippt, noch nicht übernommen; massText = übernommen (null: Höchstgewicht);
    // massOk = zuletzt übernommenes gültiges Gewicht (Text; null: Höchstgewicht), massOkDay = Tag (Zürich) dieser
    // Übernahme (ein gültiges Gewicht vom Vortag lebt «am Tippen» nicht wieder auf); massPending = der Text im Feld ist als
    // «noch am Tippen» übernommen und wird beim Verlassen voll geprüft; massSeq macht einen offenen Takt der Eingabe
    // ungültig; massDay = Tag (Zürich) der Eingabe; massErrShown = Fehlertext am Feld; massEnterAt = Beginn eines
    // Antippens des Felds ohne Fokus (0: keines); massSelectArmed = der Takt nach dem Fokus darf noch markieren.
    var S = {
      card: null, content: null, box: null, sel: null, mass: null, body: null, teaser: null, started: false,
      index: null, aircraft: null, airfield: null, selectedId: null, pendingId: null, notice: null,
      dataState: 'loading', lastLoadAttempt: 0, loadSeq: 0,
      wx: null, hasUpdate: false, fatal: false,
      fgzo: null, fgzoSeq: 0, fgzoLoaded: false, fgzoDeadline: 0,
      massDraft: null, massText: null, massOk: null, massOkDay: null, massPending: false, massSeq: 0, massDay: null, massErrShown: '',
      massEnterAt: 0, massSelectArmed: false,
      lastSelKey: null, lastMass: null, lastBody: null, lastTeaser: null
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

    // Erst alles mit Zahlen leeren (Karte, Kurzzeile), dann «Rechenfehler» in Karte und Kurzzeile; Auswahl und
    // Gewichtsfeld leer (beim nächsten Neuschreiben gilt wieder das Höchstgewicht)
    function showFatal() {
      if (!S.content) return;
      try {
        S.body.innerHTML = '';
        if (S.teaser) S.teaser.innerHTML = '';
        S.sel.innerHTML = '';
        if (S.mass) S.mass.innerHTML = '';
        S.body.innerHTML = FATAL_BODY;
        if (S.teaser) S.teaser.innerHTML = FATAL_TEASER;
      } catch (e) { /* nichts mehr zu tun */ }
      S.lastSelKey = '';
      S.lastMass = '';
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

    /* ── Abfluggewicht ── */
    function massField() { return S.mass ? S.mass.querySelector('input') : null; }
    function massFocused() {
      var el = massField();
      return !!el && doc.activeElement === el;
    }
    function massTouched() { return S.massText !== null || S.massDraft !== null || S.massDay !== null; }
    // Höchstgewicht ins Feld, aber nie, solange es den Fokus hat (Cursor und Tastatur bleiben)
    function showMaxMass() {
      var el = massField();
      if (el && S.aircraft && !massFocused()) el.value = String(S.aircraft.mass.kg);
    }
    // Zurück auf das Höchstgewicht; ein offener Takt der Eingabe verfällt
    function resetMass() {
      S.massSeq++;
      S.massDraft = null;
      S.massText = null;
      S.massOk = null;
      S.massOkDay = null;
      S.massPending = false;
      S.massDay = null;
    }
    // Getippten Text übernehmen und rechnen. Mit Fokus ist ein Text, der durch Weitertippen noch gültig werden kann
    // (massIncomplete: leer, oder nur Ziffern unter der Untergrenze), kein Fehler: Es gilt das zuletzt übernommene gültige
    // Gewicht weiter (sonst das Höchstgewicht), ohne Fehlertext und mit Zahlen; voll geprüft wird er beim Verlassen.
    // Ohne Fokus und mit full (Verlassen) die volle Prüfung: leer heisst Höchstgewicht, und es steht im Feld; sonst gilt
    // parseMass, unter der Untergrenze also Fehler und keine Zahlen.
    function commitMass(full) {
      try {
        if (S.massDraft === null) return;
        var draft = S.massDraft;
        S.massSeq++;
        S.massDraft = null;
        if (!full && massFocused() && S.aircraft && massIncomplete(draft, S.aircraft)) {
          // Ein gültiges Gewicht von einem anderen Tag gilt nicht weiter (E2), dann das Höchstgewicht
          if (S.massOkDay !== dayKey(Date.now())) {
            S.massOk = null;
            S.massOkDay = null;
          }
          S.massText = S.massOk;
          S.massPending = true;
          render();
          return;
        }
        S.massPending = false;
        if (!massDigits(draft)) {
          resetMass();
          showMaxMass();
          render();
          return;
        }
        S.massText = draft;
        if (S.aircraft && parseMass(draft, S.aircraft).kg !== null) {
          S.massOk = draft;
          S.massOkDay = dayKey(Date.now());
        }
        S.massDay = dayKey(Date.now());
        render();
      } catch (e) {
        showFatal();
      }
    }
    function isMassEvent(e) { return !!(e && e.target && e.target.id === 'perf-mass-in'); }
    // Tippen: Text merken, nach MASS_DEBOUNCE_MS Ruhe rechnen
    function onMassInput(e) {
      if (!isMassEvent(e)) return;
      S.massEnterAt = 0;
      S.massSelectArmed = false;
      S.massDraft = String(e.target.value);
      if (S.massDay === null) S.massDay = dayKey(Date.now());
      var seq = ++S.massSeq;
      if (typeof win.setTimeout === 'function') win.setTimeout(function () { if (seq === S.massSeq) commitMass(); }, MASS_DEBOUNCE_MS);
    }
    // Verlassen des Felds, «Fertig», Enter: sofort rechnen
    function onMassChange(e) {
      if (!isMassEvent(e)) return;
      S.massDraft = String(e.target.value);
      commitMass();
    }
    // Verlassen des Felds: volle Prüfung des Texts, wenn er leer ist, «noch am Tippen» übernommen wurde oder sein Takt
    // noch offen ist. Leer heisst wieder das Höchstgewicht, und es steht im Feld; unter der Untergrenze Fehler.
    function onMassFocusOut(e) {
      if (!isMassEvent(e)) return;
      S.massEnterAt = 0;
      try {
        if (!massDigits(e.target.value) || S.massPending || S.massDraft !== null) {
          S.massDraft = String(e.target.value);
          commitMass(true);
          return;
        }
        render();
      } catch (e2) {
        showFatal();
      }
    }
    /* Beim Hineingehen ins Feld den ganzen Inhalt markieren, damit die erste Ziffer die alte Zahl ersetzt. Markiert wird
       kurz nach dem Fokus (setTimeout 0, sonst setzt der Browser danach den Cursor an die Tippstelle) und noch einmal beim
       click desselben Antippens: Am iPhone wirkt eine Markierung im focus-Ereignis oft nicht. Beim mouseup dieses
       Antippens wird die Standardaktion verhindert, mit der Safari die Markierung sonst aufhebt (click folgt trotzdem).
       Zum Hineingehen zählt ein Antippen nur, wenn es bei nicht fokussiertem Feld begonnen hat (touchstart, mousedown)
       und höchstens MASS_SELECT_MS her ist; ein Klick ins schon fokussierte Feld setzt den Cursor wie gewohnt. Der Takt
       nach dem Fokus markiert nur, solange seither nicht getippt wurde (ein gedrosselter Takt, etwa im Hintergrund oder auf
       einem langsamen Gerät, käme sonst nach der ersten Ziffer und liesse die nächste sie ersetzen). Der Wert des Felds
       wird dabei nie geschrieben. */
    function selectMass() {
      var el = massField();
      if (!el || !massFocused() || typeof el.setSelectionRange !== 'function') return;
      try {
        el.setSelectionRange(0, String(el.value).length);
      } catch (e) { /* Markieren ist nur eine Hilfe */ }
    }
    function massEntering() { return S.massEnterAt > 0 && Date.now() - S.massEnterAt <= MASS_SELECT_MS; }
    function onMassPointerDown(e) {
      if (isMassEvent(e) && !massFocused()) S.massEnterAt = Date.now();
    }
    function onMassFocusIn(e) {
      if (!isMassEvent(e)) return;
      S.massSelectArmed = true;
      if (typeof win.setTimeout === 'function') win.setTimeout(function () { if (S.massSelectArmed) selectMass(); }, 0);
    }
    function onMassMouseUp(e) {
      if (isMassEvent(e) && massEntering() && typeof e.preventDefault === 'function') e.preventDefault();
    }
    function onMassClick(e) {
      if (!isMassEvent(e)) return;
      if (massEntering()) selectMass();
      S.massEnterAt = 0;
    }

    // Behälter des Gewichtsfelds nur bei geändertem HTML neu schreiben (anderes Muster, neu geladene Daten); dann gilt
    // wieder das Höchstgewicht. Sonst bleibt das Feld derselbe Knoten: Fokus, Cursor und Tastatur bleiben beim Takt.
    function writeMass(html) {
      if (html === S.lastMass) return;
      S.mass.innerHTML = html;
      S.lastMass = html;
      S.massErrShown = '';
      showMaxMass();
    }
    // Fehlertext und aria-invalid am Feld, nur bei Änderung (nie über innerHTML des Behälters)
    function syncMassError(err) {
      err = err || '';
      if (err === S.massErrShown) return;
      var el = massField(), box = S.mass.querySelector('.perf-mass-err');
      if (box) box.textContent = err;
      if (el) el.setAttribute('aria-invalid', err ? 'true' : 'false');
      S.massErrShown = err;
    }

    function parts() {
      var d = S.body.querySelector('details.perf-details');
      return renderParts({
        dataState: S.dataState, list: S.index ? S.index.list : null,
        selectedId: S.pendingId || S.selectedId || (S.index ? S.index.def : null), notice: S.notice,
        aircraft: S.aircraft, airfield: S.airfield,
        wx: S.wx, fgzo: S.fgzo, fgzoPending: !S.fgzoLoaded && Date.now() < S.fgzoDeadline,
        nowMs: Date.now(), detailsOpen: !!(d && d.open), massText: S.massText
      });
    }

    function render() {
      if (!S.content || !S.hasUpdate) return;
      if (S.fatal) {
        if (S.lastBody !== FATAL_BODY || S.lastSelKey !== '' || S.lastMass !== '') showFatal();
        return;
      }
      try {
        // Tageswechsel (Zürich): wieder das Höchstgewicht, aber nicht, solange das Feld den Fokus hat
        if (S.massDay !== null && S.massDay !== dayKey(Date.now()) && !massFocused()) {
          resetMass();
          showMaxMass();
        }
        var p = parts();
        // Neuer Inhalt im Behälter des Gewichtsfelds: zuerst zurück auf das Höchstgewicht, dann mit diesem rechnen
        if (p.mass !== S.lastMass && massTouched()) {
          resetMass();
          p = parts();
        }
        writeSel(p.sel, p.selectedId);
        writeMass(p.mass);
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
        syncMassError(p.massError);
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
      resetMass();                        // Gewichte verschiedener Muster sind nicht übertragbar: wieder das Höchstgewicht
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
      S.mass = child(content, 'perf-mass');
      S.body = child(content, 'perf-body');
      if (!doc.getElementById('perf-style')) {
        var st = doc.createElement('style');
        st.id = 'perf-style';
        st.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(st);
      }
      S.sel.addEventListener('change', onChange);
      // Gewichtsfeld: Ereignisse am stabilen Behälter (das Feld selbst wird beim Musterwechsel ersetzt); focusin und
      // focusout steigen auf, focus und blur nicht
      S.mass.addEventListener('input', onMassInput);
      S.mass.addEventListener('change', onMassChange);
      S.mass.addEventListener('focusout', onMassFocusOut);
      S.mass.addEventListener('focusin', onMassFocusIn);
      S.mass.addEventListener('mousedown', onMassPointerDown);
      S.mass.addEventListener('touchstart', onMassPointerDown, { passive: true });
      S.mass.addEventListener('mouseup', onMassMouseUp);
      S.mass.addEventListener('click', onMassClick);
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
    TEASER_AFM_TAG: TEASER_AFM_TAG,
    MASS_DEBOUNCE_MS: MASS_DEBOUNCE_MS,
    MASS_SELECT_MS: MASS_SELECT_MS,
    TEXT: TEXT,
    TEASER: TEASER,
    CSS: CSS,
    parseMass: parseMass,
    massIncomplete: massIncomplete,
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
