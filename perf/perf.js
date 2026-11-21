/* Start- und Landestreckenrechner – Rechenkern ohne DOM (Datenschema 2).
   Rechnet nach den AFM-Tabellen in perf/aircraft/*.json für die Pisten in perf/airfields/*.json.
   Grundsatz: lieber kein Wert als ein falscher oder zu optimistischer. Jede Rundung geht zur längeren Strecke.
   Gerechnet wird nur die Piste mit Gegenwind; bei Windstille, fehlender Richtung (bis 3 kt) oder genau querem
   Wind alle Pisten ohne Windkorrektur. Rückenwind wird nicht gerechnet.
   Die Daten deklarieren ihr Schema, der Kern kennt eine Whitelist: Unbekanntes ergibt keinen Wert.
   Ablesung je Tabellenachse nach ihrer Regel (read): «linear» interpoliert zwischen den Tabellenwerten, «nextHigher»
   nimmt den nächsthöheren; unter dem kleinsten Tabellenwert gilt dieser, über dem grössten gibt es keinen Wert. Die Druckhöhe
   geht auf ganze ft aufgerundet in die Tabelle.
   Abfluggewicht (freiwillig, input.massKg): Haupttabelle = Höchstgewicht, charts.takeoff.lowerWeights = tiefere
   Gewichte. charts.takeoff.massRead «linear»: zwischen zwei Starttabellen linear interpoliert; sonst (ohne Angabe
   oder «nextHigher») die Tabelle für das nächsthöhere Gewicht. Unter der kleinsten Tabelle gilt diese, ohne Angabe
   das Höchstgewicht. Die Landung rechnet immer mit ihrer einen Tabelle (maximales Landegewicht). Je gerechneter Piste
   zusätzlich der Start mit jeder Starttabelle und daraus «Start möglich bis …» (takeoffLimit; bei «linear» auf
   ganze kg genau).
   Browser: window.LszkPerfCore. Node: module.exports.
   VERSION 8: Rechnung unverändert; nur die Anzeige (perf-ui.js, Tabellenausschnitt im Rechenweg) ist neu.
   VERSION 9: Rechnung unverändert (Anzeige: «≈» in den Gewichtszeilen).
   VERSION gleich dem ?v= in index.html und in perf/perf-ui.js halten. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LszkPerfCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 9;

  var EPS = 1e-9;
  var FT_M = 0.3048;
  var LB_KG = 0.45359237;
  var CALM_BELOW_KT = 1;        // Mittelwind darunter: windstill, alle Pisten ohne Windkorrektur
  var NODIR_MAX_KT = 3;         // ohne Windrichtung bis hier alle Pisten ohne Windkorrektur, darüber kein Wert
  var MAX_HEADWIND_KT = 40;     // Gegenwind darüber: kein Wert (das AFM nennt keine Obergrenze)
  var MAX_WIND_CREDIT = 0.5;    // verkürzt der Wind eine Strecke um mehr als die Hälfte: kein Wert
  var MAX_LOWER_WEIGHTS = 8;    // höchstens so viele weitere Starttabellen je Muster
  var MASS_TOL_KG = 1;          // gedruckte kg und gedruckte Pfund einer Tabelle dürfen höchstens so weit auseinanderliegen

  // Plausible Eingabebereiche, ausserhalb: invalid-input
  var INPUT_RANGES = {
    tempC: [-60, 60],
    qnhHpa: [900, 1100],
    windKt: [0, 100],
    windDirTrue: [0, 360]
  };

  // Whitelist des Datenschemas
  var SCHEMA = 2;
  var PHASES = ['takeoff', 'landing'];
  var AXES = {
    pressureAltitude: { unit: 'ft', range: [-2000, 20000], reads: ['nextHigher', 'linear'] },
    temperature: { unit: 'degC', range: [-60, 60], reads: ['nextHigher', 'linear'] }
  };
  var MASS_READS = ['nextHigher', 'linear'];    // Ablesung über die Starttabellen (charts.takeoff.massRead)
  var OUTPUT_IDS = ['groundRoll', 'overObstacle'];
  var TABLE_MAX = { ft: 30000, m: 9000 };       // Tabellenwerte: 0 < Wert ≤ Grenze der Einheit
  var OBSTACLE_FT = 50;                         // die Anzeige schreibt «über 15 m»
  var CORRECTION_KINDS = ['headwind', 'surface', 'factor'];
  var FACTOR_WHEN = ['wet', 'always'];
  var SURFACE_CONDITIONS = ['dry'];

  // Plausibilitätsgrenzen der Daten (fail-closed)
  var LIMITS = {
    perKt: [1, 50],               // Windregel «… je per kt»
    windPercentMax: 100,          // 0 < |percent| ≤ 100
    absolutePerKtMax: 50,         // 0 < |amount| / per ≤ 50 (Tabelleneinheit je kt)
    surfacePercentMax: 200,       // Belagszuschlag 0 < percent ≤ 200
    factorMax: 3,                 // 1 < Faktor ≤ 3, höchstens drei Dezimalen
    availableM: [100, 6000],
    elevationFt: [-1500, 15000],
    bearingDeg: [1, 360]
  };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isStr(v) { return typeof v === 'string' && v.length > 0; }
  function inList(list, v) { return list.indexOf(v) >= 0; }
  function inRange(v, r) { return isNum(v) && v >= r[0] && v <= r[1]; }
  function inOpenClosed(v, max) { return isNum(v) && v > 0 && v <= max; }   // 0 < v ≤ max
  // Auf ganze Meter aufrunden; ein Gleitkommarest über einer ganzen Zahl (231,00000000000003) rundet nicht auf
  function ceilMeters(x) { return Math.ceil(x - EPS); }

  /* ── Druckhöhe ─────────────────────────────────────────────── */
  function pressureAltitudeFt(elevFt, qnhHpa) {
    return elevFt + 145442.16 * (1 - Math.pow(qnhHpa / 1013.25, 0.190263));
  }

  /* ── Validierung der Daten (fail-closed) ───────────────────── */
  function tableUnit(t) {
    return t && Array.isArray(t.outputs) && t.outputs[0] ? t.outputs[0].unit : null;
  }

  function validateTable(t, path, err) {
    if (!isObj(t)) { err(path + ': fehlt'); return; }
    if (t.type !== 'grid') err(path + '.type unbekannt');
    if (!Array.isArray(t.axes) || t.axes.length < 1) { err(path + '.axes fehlt'); return; }
    var seen = {};
    var axesOk = true;
    t.axes.forEach(function (ax, k) {
      var p = path + '.axes[' + k + ']';
      if (!isObj(ax)) { err(p + ' fehlt'); axesOk = false; return; }
      if (typeof ax.quantity !== 'string' || !has(AXES, ax.quantity)) { err(p + '.quantity unbekannt'); axesOk = false; return; }
      var def = AXES[ax.quantity];
      if (seen[ax.quantity]) err(p + '.quantity doppelt');
      seen[ax.quantity] = true;
      if (ax.unit !== def.unit) err(p + '.unit unbekannt');
      if (!inList(def.reads, ax.read)) err(p + '.read unbekannt');
      if (ax.below !== 'lowest') err(p + '.below unbekannt');
      if (ax.above !== 'none') err(p + '.above unbekannt');
      if (!Array.isArray(ax.values) || ax.values.length < 1) { err(p + '.values fehlt'); axesOk = false; return; }
      for (var i = 0; i < ax.values.length; i++) {
        if (!inRange(ax.values[i], def.range) || (i > 0 && !(ax.values[i] > ax.values[i - 1]))) {
          err(p + '.values nicht streng steigend oder ausserhalb ' + def.range.join('…'));
          axesOk = false;
          return;
        }
      }
      if (ax.read === 'linear' && ax.values.length < 2) { err(p + '.values: Interpolation braucht zwei Werte'); axesOk = false; }
    });
    if (!Array.isArray(t.outputs) || t.outputs.length !== OUTPUT_IDS.length) { err(path + '.outputs falsch'); return; }
    var pos = {};
    var unit = tableUnit(t);
    if (!has(TABLE_MAX, unit)) err(path + '.outputs: Einheit unbekannt');
    t.outputs.forEach(function (o, n) {
      if (!isObj(o) || !inList(OUTPUT_IDS, o.id) || has(pos, o.id)) { err(path + '.outputs[' + n + '] unbekannt'); return; }
      if (o.unit !== unit) err(path + '.outputs[' + n + '].unit verschieden');
      pos[o.id] = n;
    });
    if (!has(pos, 'groundRoll') || !has(pos, 'overObstacle') || !has(TABLE_MAX, unit)) return;
    if (!isObj(t.obstacle) || t.obstacle.value !== OBSTACLE_FT || t.obstacle.unit !== 'ft') err(path + '.obstacle unbekannt');
    if (!axesOk) return;
    if (!shapeOk(t.cells, t.axes, 0, t.outputs.length, TABLE_MAX[unit])) { err(path + '.cells Form oder Wert falsch'); return; }
    var dims = t.axes.map(function (ax) { return ax.values.length; });
    var bad = false;
    forEachIndex(dims, function (idx) {
      if (bad) return;
      var c = cellAt(t.cells, idx);
      if (!(c[pos.overObstacle] >= c[pos.groundRoll])) { bad = true; err(path + '.cells: Strecke über Hindernis kürzer als Rollstrecke'); return; }
      // Nächsthöherer Wert und Interpolation sind nur konservativ, wenn die Tabelle in keiner Achse fällt
      for (var k = 0; k < dims.length && !bad; k++) {
        if (idx[k] + 1 >= dims[k]) continue;
        var nidx = idx.slice(); nidx[k]++;
        var n = cellAt(t.cells, nidx);
        for (var o = 0; o < c.length; o++) {
          if (!(n[o] >= c[o])) { bad = true; err(path + '.cells nicht monoton'); return; }
        }
      }
    });
  }

  function shapeOk(node, axes, depth, nOut, max) {
    var i;
    if (depth === axes.length) {
      if (!Array.isArray(node) || node.length !== nOut) return false;
      for (i = 0; i < node.length; i++) if (!inOpenClosed(node[i], max)) return false;
      return true;
    }
    if (!Array.isArray(node) || node.length !== axes[depth].values.length) return false;
    for (i = 0; i < node.length; i++) if (!shapeOk(node[i], axes, depth + 1, nOut, max)) return false;
    return true;
  }

  function forEachIndex(dims, fn) {
    var total = 1, k;
    for (k = 0; k < dims.length; k++) total *= dims[k];
    var idx = dims.map(function () { return 0; });
    for (var n = 0; n < total; n++) {
      fn(idx.slice());
      for (k = dims.length - 1; k >= 0; k--) {
        idx[k]++;
        if (idx[k] < dims[k]) break;
        idx[k] = 0;
      }
    }
  }

  function cellAt(cells, idx) {
    var c = cells;
    for (var k = 0; k < idx.length; k++) c = c[idx[k]];
    return c;
  }

  function threeDecimals(v) { return Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6; }

  function validateCorrections(list, unit, path, err) {
    if (!Array.isArray(list)) { err(path + ' fehlt'); return; }
    var headwind = 0;
    var surfaces = {};
    list.forEach(function (c, n) {
      var p = path + '[' + n + ']';
      if (!isObj(c) || !inList(CORRECTION_KINDS, c.kind)) { err(p + '.kind unbekannt'); return; }
      if (c.kind === 'headwind') {
        headwind++;
        if (c.unit !== 'kt') err(p + '.unit unbekannt');
        if (!inRange(c.per, LIMITS.perKt)) err(p + '.per ausserhalb ' + LIMITS.perKt.join('–') + ' kt');
        if (c.type === 'percentPer') {
          // Gegenwind verkürzt: percent < 0, Betrag höchstens 100
          if (!inOpenClosed(isNum(c.percent) ? -c.percent : NaN, LIMITS.windPercentMax)) err(p + '.percent falsch');
        } else if (c.type === 'absolutePer') {
          if (!(isNum(c.amount) && c.amount < 0)) err(p + '.amount falsch');
          if (c.amountUnit !== unit) err(p + '.amountUnit nicht gleich der Tabelleneinheit');
          if (isNum(c.amount) && inRange(c.per, LIMITS.perKt) && !inOpenClosed(-c.amount / c.per, LIMITS.absolutePerKtMax)) err(p + '.amount je kt ausserhalb');
        } else {
          err(p + '.type unbekannt');
        }
      } else if (c.kind === 'surface') {
        if (c.type !== 'addPercentOf') err(p + '.type unbekannt');
        if (!isStr(c.surface)) err(p + '.surface fehlt');
        else if (surfaces[c.surface]) err(p + '.surface doppelt');
        else surfaces[c.surface] = true;
        if (!inList(SURFACE_CONDITIONS, c.surfaceCondition)) err(p + '.surfaceCondition unbekannt');
        if (!inOpenClosed(c.percent, LIMITS.surfacePercentMax)) err(p + '.percent ausserhalb 0–' + LIMITS.surfacePercentMax + ' %');
        if (c.of !== 'groundRoll') err(p + '.of unbekannt');
      } else if (c.kind === 'factor') {
        if (!inList(FACTOR_WHEN, c.when)) err(p + '.when unbekannt');
        if (!(isNum(c.factor) && c.factor > 1 && c.factor <= LIMITS.factorMax && threeDecimals(c.factor))) err(p + '.factor ausserhalb (1, ' + LIMITS.factorMax + '] oder mehr als drei Dezimalen');
        if (typeof c.minimum !== 'boolean') err(p + '.minimum fehlt');
        if (!isStr(c.labelDe) || !isStr(c.refDe)) err(p + '.labelDe oder refDe fehlt');
        if (c.when === 'wet' && !isStr(c.surface)) err(p + '.surface fehlt');
        if (c.when === 'always' && c.surface !== undefined) err(p + '.surface bei «always» nicht erlaubt');
      }
    });
    if (headwind > 1) err(path + ': Gegenwind-Regel doppelt');
  }

  /* Weitere Starttabellen für tiefere Gewichte (charts.takeoff.lowerWeights, optional).
     Die Haupttabelle (charts.takeoff.table) gilt für das Höchstgewicht (mass). Die weiteren Tabellen stehen absteigend
     nach Gewicht, alle unter dem Höchstgewicht, mit denselben Achsen, Ausgaben und derselben Einheit, und sind in
     keiner Zelle länger als die nächstschwerere Tabelle. Nur dann ist die Ablesung «Tabelle für das nächsthöhere
     Gewicht» konservativ und die Strecke steigt mit dem Gewicht (auch interpoliert). Jede Tabelle nennt ihre Quelle
     (ref.figure und ref.page, nicht leer; der Rechenweg zeigt sie für die gewählte Tabelle) und hat einen Titel
     (title, Zeichenkette). Bei der Landung sind keine weiteren Tabellen erlaubt. */
  function validateLowerWeights(ch, ph, mass, path, err) {
    var list = ch.lowerWeights;
    if (list === undefined) return;
    var p = path + '.lowerWeights';
    if (ph !== 'takeoff') { err(p + ' nur beim Start erlaubt'); return; }
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_LOWER_WEIGHTS) { err(p + ' falsch'); return; }
    if (!isObj(mass) || !isNum(mass.kg) || !isNum(mass.lb)) return;     // «mass unbekannt» ist schon gemeldet
    var prevKg = mass.kg, prevLb = mass.lb, prevTable = ch.table;
    for (var i = 0; i < list.length; i++) {
      var e = list[i], q = p + '[' + i + ']';
      if (!isObj(e) || !isObj(e.mass) || !(isNum(e.mass.kg) && e.mass.kg > 0) || !(isNum(e.mass.lb) && e.mass.lb > 0)) { err(q + '.mass unbekannt'); return; }
      if (!(e.mass.kg < prevKg) || !(e.mass.lb < prevLb)) { err(q + '.mass nicht absteigend unter dem Höchstgewicht'); return; }
      if (Math.abs(e.mass.lb * LB_KG - e.mass.kg) > MASS_TOL_KG) err(q + '.mass: kg und lb passen nicht zusammen');
      if (!isObj(e.ref) || !isStr(e.ref.figure) || !isStr(e.ref.page)) err(q + '.ref fehlt');
      if (typeof e.title !== 'string') err(q + '.title fehlt');
      var bad = false;
      validateTable(e.table, q + '.table', function (m) { bad = true; err(m); });
      if (bad) return;
      if (JSON.stringify(e.table.axes) !== JSON.stringify(ch.table.axes) || JSON.stringify(e.table.outputs) !== JSON.stringify(ch.table.outputs)) {
        err(q + '.table: Achsen oder Ausgaben anders als in der Haupttabelle');
        return;
      }
      var dims = e.table.axes.map(function (ax) { return ax.values.length; });
      var longer = false;
      forEachIndex(dims, function (idx) {
        var lo = cellAt(e.table.cells, idx), hi = cellAt(prevTable.cells, idx);
        for (var o = 0; o < lo.length; o++) if (!(lo[o] <= hi[o])) longer = true;
      });
      if (longer) { err(q + '.table.cells: länger als die nächstschwerere Tabelle'); return; }
      prevKg = e.mass.kg; prevLb = e.mass.lb; prevTable = e.table;
    }
  }

  // Text einer Ausnahme; wirft selbst nie (auch nicht bei einer Ausnahme mit Fallen)
  function errText(e) {
    try { return String(e && e.message || e); } catch (e2) { return 'unbekannter Fehler'; }
  }

  // Die Prüfungen werfen nie: auch ein Objekt mit Fallen (Getter, die werfen) ergibt nur «bad-data».
  function safeValidate(fn, obj, what) {
    try {
      return fn(obj);
    } catch (e) {
      return { ok: false, errors: [what + ' nicht lesbar: ' + errText(e)] };
    }
  }
  function validateAircraft(ac) { return safeValidate(validateAircraftUnsafe, ac, 'Flugzeugdaten'); }
  function validateAirfield(af) { return safeValidate(validateAirfieldUnsafe, af, 'Platzdaten'); }

  function validateAircraftUnsafe(ac) {
    var errors = [];
    function err(m) { errors.push(m); }
    if (!isObj(ac)) return { ok: false, errors: ['Flugzeugdaten fehlen'] };
    if (ac.schema !== SCHEMA) err('schema unbekannt');
    if (!isStr(ac.id)) err('id fehlt');
    if (!isStr(ac.label)) err('label fehlt');
    if (!isObj(ac.mass) || !(isNum(ac.mass.kg) && ac.mass.kg > 0) || !(isNum(ac.mass.lb) && ac.mass.lb > 0)) err('mass unbekannt');
    if (!isObj(ac.sources)) err('sources fehlt');
    if (!isObj(ac.charts)) {
      err('charts fehlt');
    } else {
      PHASES.forEach(function (ph) {
        var ch = ac.charts[ph];
        var p = 'charts.' + ph;
        if (!isObj(ch)) { err(p + ' fehlt'); return; }
        if (!isStr(ch.source) || !isObj(ac.sources) || !has(ac.sources, ch.source) || !isObj(ac.sources[ch.source])) err(p + '.source unbekannt');
        if (!isObj(ch.base) || !isStr(ch.base.surface) || !inList(SURFACE_CONDITIONS, ch.base.surfaceCondition)) err(p + '.base unbekannt');
        var tableBad = false;
        validateTable(ch.table, p + '.table', function (m) { tableBad = true; err(m); });
        validateCorrections(ch.corrections, tableUnit(ch.table), p + '.corrections', err);
        // Ist die Haupttabelle schon fehlerhaft, bleibt es bei deren Meldung (das Ergebnis ist ohnehin bad-data)
        if (!tableBad) validateLowerWeights(ch, ph, ac.mass, p, err);
        validateMassRead(ch, ph, ac.mass, p, err);
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* Ablesung über die Starttabellen (charts.takeoff.massRead, freiwillig): «nextHigher» oder «linear», nur beim Start.
     Bei «linear» sind alle Tabellengewichte ganze kg: «Start möglich bis …» wird auf ganze kg gesucht. */
  function validateMassRead(ch, ph, mass, path, err) {
    if (ch.massRead === undefined) return;
    var p = path + '.massRead';
    if (ph !== 'takeoff') { err(p + ' nur beim Start erlaubt'); return; }
    if (!inList(MASS_READS, ch.massRead)) { err(p + ' unbekannt'); return; }
    if (ch.massRead !== 'linear') return;
    var kgs = [isObj(mass) ? mass.kg : NaN];
    if (Array.isArray(ch.lowerWeights)) {
      ch.lowerWeights.forEach(function (e) { kgs.push(isObj(e) && isObj(e.mass) ? e.mass.kg : NaN); });
    }
    if (!kgs.every(function (k) { return isNum(k) && Math.floor(k) === k; })) err(p + ': Tabellengewichte nicht ganze kg');
  }

  function validateAirfieldUnsafe(af) {
    var errors = [];
    function err(m) { errors.push(m); }
    if (!isObj(af)) return { ok: false, errors: ['Platzdaten fehlen'] };
    if (af.schema !== SCHEMA) err('schema unbekannt');
    if (!isStr(af.icao)) err('icao fehlt');
    if (!isObj(af.elevation) || !inRange(af.elevation.value, LIMITS.elevationFt) || af.elevation.unit !== 'ft') err('elevation unbekannt');
    if (!Array.isArray(af.runways) || af.runways.length < 1) {
      err('runways fehlt');
    } else {
      var ids = {};
      af.runways.forEach(function (r, n) {
        var p = 'runways[' + n + ']';
        if (!isObj(r)) { err(p + ' fehlt'); return; }
        if (!isStr(r.id) || ids[r.id]) err(p + '.id fehlt oder doppelt');
        else ids[r.id] = true;
        if (!inRange(r.bearingTrue, LIMITS.bearingDeg)) err(p + '.bearingTrue falsch');
        if (r.bearingMag !== undefined && !inRange(r.bearingMag, LIMITS.bearingDeg)) err(p + '.bearingMag falsch');
        if (!isStr(r.surface)) err(p + '.surface fehlt');
        ['takeoffAvailable', 'landingAvailable'].forEach(function (k) {
          var v = r[k];
          if (!isObj(v) || !inRange(v.value, LIMITS.availableM) || v.unit !== 'm') err(p + '.' + k + ' unbekannt');
        });
      });
    }
    return { ok: errors.length === 0, errors: errors };
  }

  /* ── Eingaben ──────────────────────────────────────────────── */
  // { tempC, qnhHpa, windDirTrue (Grad rechtweisend, woher; null = unbestimmt), windKt (10-min-Mittel), runwayWet }
  function checkInput(input) {
    var bad = [];
    if (!isObj(input)) return [{ field: 'input', value: null }];
    ['tempC', 'qnhHpa', 'windDirTrue', 'windKt'].forEach(function (f) {
      var v = input[f];
      if (f === 'windDirTrue' && v === null) return;
      if (!inRange(v, INPUT_RANGES[f])) bad.push({ field: f, value: v });
    });
    if (typeof input.runwayWet !== 'boolean') bad.push({ field: 'runwayWet', value: input.runwayWet });
    // Abfluggewicht in kg, freiwillig: fehlt es (undefined oder null), gilt das Höchstgewicht
    if (input.massKg !== undefined && input.massKg !== null && !(isNum(input.massKg) && input.massKg > 0)) bad.push({ field: 'massKg', value: input.massKg });
    return bad;
  }

  /* ── Tabellenablesung ──────────────────────────────────────────
     Je Achse nach ihrer Regel (read); für beide Regeln gilt unter dem kleinsten Wert der kleinste (es wird nicht
     hochgerechnet), über dem grössten gibt es keinen Wert, genau auf einem Tabellenwert dieser.
     nextHigher: erster Wert ≥ Eingabe.
     linear:     zwischen zwei Tabellenwerten linear, mit demselben Gewicht für beide Ausgaben.
     Mehrere interpolierte Achsen der Reihe nach, die letzte Achse zuerst: bei Druckhöhe × Temperatur zuerst die
     Temperatur in beiden Höhenzeilen, dann die Höhe (gleiches Ergebnis wie bilinear).
     corners: die verwendeten Tabellenzellen (eine, zwei oder vier) mit ihren Achsenwerten, für den Rechenweg. */
  function lookupTable(table, inputs) {
    var axes = [], above = [];
    for (var k = 0; k < table.axes.length; k++) {
      var ax = table.axes[k];
      var v = inputs[ax.quantity];
      var vals = ax.values;
      if (!isNum(v)) return { ok: false, above: [], missing: ax.quantity };
      var last = vals.length - 1;
      if (v > vals[last]) {
        above.push({ quantity: ax.quantity, unit: ax.unit, value: v, max: vals[last] });
        continue;
      }
      var j = 0;
      while (vals[j] < v) j++;                  // erster Wert ≥ Eingabe (unter dem kleinsten: 0)
      var a = { quantity: ax.quantity, read: ax.read, input: v, index: j, value: vals[j], belowLowest: v < vals[0], interpolated: false };
      if (ax.read === 'linear' && v > vals[0] && vals[j] !== v) {
        a.interpolated = true;
        a.lowerIndex = j - 1;
        a.lower = vals[j - 1];
        a.upper = vals[j];
        a.num = v - vals[j - 1];                // Gewicht = num / den
        a.den = vals[j] - vals[j - 1];
        a.weight = a.num / a.den;
      }
      axes.push(a);
    }
    if (above.length) return { ok: false, above: above };
    var nOut = table.outputs.length;
    // Wert an der Eingabe ab Achse k im Teilbaum node; untere vor oberer Zelle, damit corners geordnet ist
    function valueAt(node, k) {
      if (k === axes.length) return node.slice(0, nOut);
      var a = axes[k];
      if (!a.interpolated) return valueAt(node[a.index], k + 1);
      var lo = valueAt(node[a.lowerIndex], k + 1);
      var hi = valueAt(node[a.index], k + 1);
      // a + (v − a0)·(b − a)/(a1 − a0): erst multiplizieren, dann teilen
      return lo.map(function (x, n) { return x + a.num * (hi[n] - x) / a.den; });
    }
    var raw = valueAt(table.cells, 0);
    var values = {};
    table.outputs.forEach(function (o, n) { values[o.id] = raw[n]; });
    // Ecken: je interpolierter Achse untere und obere Zelle, sonst die gewählte
    var corners = [{ indices: [], axisValues: [] }];
    axes.forEach(function (a) {
      var next = [];
      corners.forEach(function (c) {
        var picks = a.interpolated ? [[a.lowerIndex, a.lower], [a.index, a.upper]] : [[a.index, a.value]];
        picks.forEach(function (pk) {
          next.push({ indices: c.indices.concat([pk[0]]), axisValues: c.axisValues.concat([pk[1]]) });
        });
      });
      corners = next;
    });
    corners.forEach(function (c) {
      var cell = cellAt(table.cells, c.indices);
      c.values = {};
      table.outputs.forEach(function (o, n) { c.values[o.id] = cell[n]; });
    });
    var idx = axes.map(function (a) { return a.index; });
    return {
      ok: true, axes: axes, values: values, corners: corners,
      interpolated: axes.some(function (a) { return a.interpolated; }),
      indices: idx, axisValues: axes.map(function (a) { return a.value; }), quantities: axes.map(function (a) { return a.quantity; })
    };
  }

  /* ── Pistenwahl aus dem Mittelwind ─────────────────────────── */
  function windForRunway(inp, bearingTrue) {
    if (inp.windKt < CALM_BELOW_KT) return { mode: 'calm', along: null, componentKt: null, kind: 'none', kt: 0, computed: true, reason: null };
    if (inp.windDirTrue === null) {
      if (inp.windKt <= NODIR_MAX_KT) return { mode: 'nodir', along: null, componentKt: null, kind: 'none', kt: 0, computed: true, reason: null };
      return { mode: 'no-direction', along: null, componentKt: null, kind: 'none', kt: 0, computed: false, reason: 'no-direction' };
    }
    var along = Math.round(Math.cos((inp.windDirTrue - bearingTrue) * Math.PI / 180) * 1e9) / 1e9;
    if (along === 0) along = 0;                 // −0 vermeiden
    if (along < 0) {
      return { mode: 'dir', along: along, componentKt: inp.windKt * -along, kind: 'tailwind', kt: 0, computed: false, reason: 'tailwind' };
    }
    var comp = inp.windKt * along;
    var kt = Math.max(0, Math.floor(comp + EPS));
    return { mode: 'dir', along: along, componentKt: comp, kind: kt > 0 ? 'headwind' : 'none', kt: kt, computed: true, reason: null };
  }

  function findRule(list, kind) {
    for (var i = 0; i < list.length; i++) if (list[i].kind === kind) return list[i];
    return null;
  }

  function findSurfaceRule(list, surface) {
    for (var i = 0; i < list.length; i++) if (list[i].kind === 'surface' && list[i].surface === surface) return list[i];
    return null;
  }

  /* ── Eine Phase (Start oder Landung) auf einer Piste, in der Tabelleneinheit ── */
  function computePhase(chart, lk, rwy, wind, runwayWet, availableM) {
    var unit = tableUnit(chart.table);
    var gr = lk.values.groundRoll, ob = lk.values.overObstacle;
    var res = {
      ok: false, reason: null, limitKt: null, unit: unit, availableM: availableM,
      lookup: lk, table: { groundRoll: gr, overObstacle: ob },
      wind: { kt: wind.kt, applied: false, type: null, percent: null, perKt: null, per: null, reduction: null, noRule: false },
      afterWind: null, surface: null, factors: [], wetFactorMissing: false,
      final: null, meters: null, m: null, exceeds: null
    };
    function none(reason, limitKt) {
      res.reason = reason;
      if (limitKt !== undefined) res.limitKt = limitKt;
      return res;
    }
    var kt = wind.kt;
    if (kt > MAX_HEADWIND_KT) return none('headwind-limit', MAX_HEADWIND_KT);
    var grW = gr, obW = ob;
    if (kt > 0) {
      var hw = findRule(chart.corrections, 'headwind');
      if (!hw) {
        res.wind.noRule = true;                 // ohne Regel keine Gutschrift (konservativ)
      } else if (hw.type === 'percentPer') {
        var p = Math.floor(Math.abs(hw.percent) * kt / hw.per + EPS);
        grW = gr * (100 - p) / 100;
        obW = ob * (100 - p) / 100;
        res.wind = { kt: kt, applied: true, type: 'percentPer', percent: p, perKt: null, per: hw.per, reduction: null, noRule: false };
      } else {
        var r = Math.floor(Math.abs(hw.amount) * kt / hw.per + EPS);
        grW = gr - r;
        obW = ob - r;
        res.wind = { kt: kt, applied: true, type: 'absolutePer', percent: null, perKt: Math.abs(hw.amount), per: hw.per, reduction: r, noRule: false };
      }
      // Verkürzt der Wind eine der beiden Strecken um mehr als die Hälfte: kein Wert (genau 50 % erlaubt)
      if (gr - grW > MAX_WIND_CREDIT * gr + EPS || ob - obW > MAX_WIND_CREDIT * ob + EPS) return none('wind-credit-limit');
    }
    res.afterWind = { groundRoll: grW, overObstacle: obW };
    // Belag: Prozent der (bei Interpolation interpolierten) Tabellen-Rollstrecke auf beide Strecken
    var inc = 0;
    if (rwy.surface !== chart.base.surface) {
      var sr = findSurfaceRule(chart.corrections, rwy.surface);
      if (!sr) return none('no-surface-rule');
      inc = sr.percent * gr / 100;
      res.surface = { surface: sr.surface, percent: sr.percent, base: gr, inc: inc, after: { groundRoll: grW + inc, overObstacle: obW + inc } };
    }
    var grF = grW + inc, obF = obW + inc;
    // Faktoren in der Reihenfolge der Datei: «always» immer, «wet» nur auf nasser Piste mit passendem Belag
    chart.corrections.forEach(function (c) {
      if (c.kind !== 'factor') return;
      var applies = c.when === 'always' || (c.when === 'wet' && runwayWet === true && rwy.surface === c.surface);
      if (!applies) return;
      var f1000 = Math.round(c.factor * 1000);
      grF = grF * f1000 / 1000;
      obF = obF * f1000 / 1000;
      res.factors.push({ factor: c.factor, when: c.when, minimum: c.minimum, labelDe: c.labelDe, refDe: c.refDe, after: { groundRoll: grF, overObstacle: obF } });
    });
    res.wetFactorMissing = runwayWet === true && !res.factors.some(function (f) { return f.when === 'wet'; });
    var grM = unit === 'ft' ? grF * 3048 / 10000 : grF;
    var obM = unit === 'ft' ? obF * 3048 / 10000 : obF;
    var mGr = ceilMeters(grM);
    var mOb = ceilMeters(obM);
    // Schlussprobe
    if (!(isNum(grF) && isNum(obF) && grF > 0 && obF > 0 && obF >= grF &&
          isNum(mGr) && isNum(mOb) && mGr > 0 && mOb >= mGr)) return none('internal');
    res.final = { groundRoll: grF, overObstacle: obF };
    res.meters = { groundRoll: grM, overObstacle: obM };
    res.m = { groundRoll: mGr, overObstacle: mOb };
    res.exceeds = { groundRoll: mGr > availableM, overObstacle: mOb > availableM };
    res.ok = true;
    return res;
  }

  /* ── Abfluggewicht: Starttabellen und «Start möglich bis» ──── */
  // Starttabellen absteigend nach Gewicht: zuerst die Haupttabelle (Höchstgewicht), dann lowerWeights
  function takeoffTables(aircraft) {
    var ch = aircraft.charts.takeoff;
    var list = [{ kg: aircraft.mass.kg, lb: aircraft.mass.lb, table: ch.table, ref: ch.ref, title: ch.title }];
    (ch.lowerWeights || []).forEach(function (e) {
      list.push({ kg: e.mass.kg, lb: e.mass.lb, table: e.table, ref: e.ref, title: e.title });
    });
    return list;
  }

  // Tabelle für das nächsthöhere Gewicht: die leichteste Tabelle mit Gewicht ≥ Eingabe. Unter der leichtesten Tabelle
  // gilt diese (es wird nicht hochgerechnet), ohne Eingabe die schwerste. Gewichte über dem Höchstgewicht fängt compute ab.
  function pickTakeoffTable(tables, massKg) {
    var idx = 0;
    if (massKg !== null) for (var i = 0; i < tables.length; i++) if (tables[i].kg >= massKg) idx = i;
    return idx;
  }

  // Ablesung über die Starttabellen: «linear» nur mit ausdrücklicher Angabe in den Daten
  function massReadOf(aircraft) { return aircraft.charts.takeoff.massRead === 'linear' ? 'linear' : 'nextHigher'; }

  /* Starttabelle(n) für ein Gewicht: upper = Tabelle für das nächsthöhere Gewicht (wie pickTakeoffTable). Bei «linear»
     und einem Gewicht echt zwischen zwei Tabellen zusätzlich lower = die nächstleichtere Tabelle und das Gewicht
     dazwischen (num / den, in kg). Auf einer Tabelle, unter der leichtesten und ohne Eingabe: nur upper. */
  function massBracket(tables, massKg, read) {
    var hi = pickTakeoffTable(tables, massKg);
    var res = { upper: hi, lower: null, num: null, den: null, weight: null };
    if (read === 'linear' && massKg !== null && hi < tables.length - 1 && tables[hi].kg > massKg) {
      res.lower = hi + 1;                       // tables[hi + 1].kg < massKg, sonst wäre hi + 1 gewählt
      res.num = massKg - tables[hi + 1].kg;
      res.den = tables[hi].kg - tables[hi + 1].kg;
      res.weight = res.num / res.den;
    }
    return res;
  }

  // Für die Anzeige: Starttabelle(n) eines Musters für ein Gewicht (null = Höchstgewicht), wie compute sie wählt
  function takeoffMassBracket(aircraft, massKg) {
    return massBracket(takeoffTables(aircraft), massKg === undefined ? null : massKg, massReadOf(aircraft));
  }

  /* Ablesung beim Start für ein Gewicht: ohne lower die Tabelle upper, sonst beide Tabellen gleich abgelesen und
     dazwischen linear im Gewicht (erst multiplizieren, dann teilen). Achsen und Ausgaben sind in allen Starttabellen
     gleich (validateLowerWeights), ein Wert über dem Tabellenbereich trifft also beide. */
  function massLookup(tables, br, axisInputs) {
    var hi = lookupTable(tables[br.upper].table, axisInputs);
    if (br.lower === null || !hi.ok) return hi;
    var lo = lookupTable(tables[br.lower].table, axisInputs);
    if (!lo.ok) return lo;
    var values = {};
    Object.keys(hi.values).forEach(function (k) {
      values[k] = lo.values[k] + br.num * (hi.values[k] - lo.values[k]) / br.den;
    });
    return {
      ok: true, axes: hi.axes, values: values, corners: hi.corners, interpolated: true,
      indices: hi.indices, axisValues: hi.axisValues, quantities: hi.quantities,
      mass: {
        kg: tables[br.lower].kg + br.num, upperKg: tables[br.upper].kg, lowerKg: tables[br.lower].kg,
        num: br.num, den: br.den, weight: br.weight, upper: hi, lower: lo
      }
    };
  }

  // Start-Chart mit einer anderen Tabelle, sonst gleich (Quelle, Belag der Tabelle, Korrekturen); die Daten bleiben unverändert
  function chartWithTable(chart, table) {
    return { source: chart.source, base: chart.base, corrections: chart.corrections, table: table };
  }

  /* «Start möglich» heisst: Wert vorhanden, Rollstrecke und Strecke über 15 m ≤ verfügbare Startstrecke.
     list: Ergebnis je Starttabelle (absteigend nach Gewicht), ti: Index der gewählten Tabelle.
     state: 'possible'    mit der gewählten Tabelle möglich
            'no-value'    die gewählte Tabelle ergibt keinen Wert: keine Aussage
            'limit'       nicht möglich, aber mit einer leichteren Tabelle: maxKg
            'wet-unknown' wie 'limit', aber die Piste ist nass und das AFM nennt keinen Nässewert: keine Aussage «möglich»
            'none'        auch mit der leichtesten Tabelle nicht möglich (lightestKg)
            'lowest'      nicht möglich, und es gibt keine leichtere Tabelle
            'unknown'     nicht möglich, und eine leichtere Tabelle ergibt keinen Wert, keine ist möglich
     maxPossibleKg: schwerste Tabelle überhaupt, mit der der Start möglich ist. null, wenn keine möglich ist, und null
     ohne Aussage, wenn dieses «möglich» bei nasser Piste ohne Nässewert des AFM gerechnet ist (wetFactorMissing; so bei
     'wet-unknown' und bei 'possible' auf nasser Piste ohne Nässewert). */
  function takeoffLimit(list, ti) {
    var cur = list[ti];
    var res = { state: 'no-value', tableKg: cur.kg, maxKg: null, lightestKg: list[list.length - 1].kg, maxPossibleKg: null };
    for (var k = 0; k < list.length; k++) {
      if (list[k].possible) { res.maxPossibleKg = list[k].wetFactorMissing ? null : list[k].kg; break; }
    }
    if (!cur.ok) return res;
    if (cur.possible) { res.state = 'possible'; return res; }
    if (ti === list.length - 1) { res.state = 'lowest'; return res; }
    var noValue = false;
    for (var i = ti + 1; i < list.length; i++) {
      if (!list[i].ok) { noValue = true; continue; }
      if (list[i].possible) {
        if (list[i].wetFactorMissing) { res.state = 'wet-unknown'; return res; }
        res.state = 'limit';
        res.maxKg = list[i].kg;
        return res;
      }
    }
    res.state = noValue ? 'unknown' : 'none';
    return res;
  }

  /* «Start möglich bis …» bei massRead «linear», auf ganze kg. m: Gewicht der Rechnung (Eingabe, sonst Höchstgewicht),
     cur: Start mit m, at(kg): Start mit kg (gleiche Kette). Gesucht wird von unter m abwärts bis zur leichtesten
     Tabelle; darunter gilt deren Wert, eine Suche brächte nichts. Zustände wie takeoffLimit:
     'possible', 'no-value', 'limit' (maxKg: schwerstes ganzes Gewicht unter m, mit dem der Start möglich ist),
     'wet-unknown', 'none' (auch mit lightestKg nicht), 'lowest' (m nicht über der leichtesten Tabelle),
     'unknown' (kein Gewicht möglich, ab noValueFromKg abwärts ergibt sich kein Wert).
     maxPossibleKg: schwerstes ganzes Gewicht bis zum Höchstgewicht, mit dem der Start möglich ist (null wie bei
     takeoffLimit, auch bei nasser Piste ohne Nässewert des AFM). */
  function takeoffLimitLinear(cur, m, maxKg, lightestKg, at) {
    var res = { state: 'no-value', tableKg: null, maxKg: null, lightestKg: lightestKg, maxPossibleKg: null, noValueFromKg: null };
    function possible(p) { return p.ok && !p.exceeds.groundRoll && !p.exceeds.overObstacle; }
    for (var k = maxKg; k >= lightestKg; k--) {
      var q = k === m ? cur : at(k);
      if (possible(q)) { res.maxPossibleKg = q.wetFactorMissing ? null : k; break; }
    }
    if (!cur.ok) return res;
    if (possible(cur)) { res.state = 'possible'; return res; }
    if (!(m > lightestKg)) { res.state = 'lowest'; return res; }
    for (var kg = Math.ceil(m) - 1; kg >= lightestKg; kg--) {
      var p = at(kg);
      if (!p.ok) {
        if (res.noValueFromKg === null) res.noValueFromKg = kg;
        continue;
      }
      if (possible(p)) {
        if (p.wetFactorMissing) { res.state = 'wet-unknown'; return res; }
        res.state = 'limit';
        res.maxKg = kg;
        return res;
      }
    }
    res.state = res.noValueFromKg !== null ? 'unknown' : 'none';
    return res;
  }

  /* ── Hauptfunktion ─────────────────────────────────────────── */
  function compute(aircraft, airfield, input) {
    try {
      return computeUnsafe(aircraft, airfield, input);
    } catch (e) {
      return { ok: false, error: { code: 'internal', message: errText(e) } };
    }
  }

  function computeUnsafe(aircraft, airfield, input) {
    var va = validateAircraft(aircraft);
    var vf = validateAirfield(airfield);
    if (!va.ok || !vf.ok) return { ok: false, error: { code: 'bad-data', errors: va.errors.concat(vf.errors) } };
    var bad = checkInput(input);
    if (bad.length) return { ok: false, error: { code: 'invalid-input', fields: bad } };
    var inp = { tempC: input.tempC, qnhHpa: input.qnhHpa, windDirTrue: input.windDirTrue, windKt: input.windKt, runwayWet: input.runwayWet };
    var massKg = input.massKg === undefined || input.massKg === null ? null : input.massKg;
    if (massKg !== null && massKg > aircraft.mass.kg) {
      return { ok: false, error: { code: 'above-mass', massKg: massKg, maxKg: aircraft.mass.kg }, input: inp };
    }
    var tables = takeoffTables(aircraft);
    var read = massReadOf(aircraft);
    var br = massBracket(tables, massKg, read);
    var ti = br.upper;
    var charts = { takeoff: chartWithTable(aircraft.charts.takeoff, tables[ti].table), landing: aircraft.charts.landing };
    var pa = pressureAltitudeFt(airfield.elevation.value, inp.qnhHpa);
    // Druckhöhe für die Tabellen auf ganze ft aufgerundet (zur längeren Strecke, gleich wie angezeigt)
    var paTable = Math.ceil(pa - EPS);
    var axisInputs = { pressureAltitude: paTable, temperature: inp.tempC };
    var lookups = {};
    var above = [];
    PHASES.forEach(function (ph) {
      var lk = ph === 'takeoff' ? massLookup(tables, br, axisInputs) : lookupTable(charts[ph].table, axisInputs);
      lookups[ph] = lk;
      if (!lk.ok) {
        if (lk.missing) throw new Error('Eingabe für Achse fehlt: ' + lk.missing);
        // je Grösse das kleinste überschrittene Maximum
        lk.above.forEach(function (a) {
          var prev = null;
          above.forEach(function (b) { if (b.quantity === a.quantity) prev = b; });
          if (!prev) above.push({ quantity: a.quantity, unit: a.unit, value: a.value, max: a.max });
          else if (a.max < prev.max) prev.max = a.max;
        });
      }
    });
    if (above.length) {
      return { ok: false, error: { code: 'above-range', above: above }, input: inp, pressureAltitudeFt: pa, pressureAltitudeTableFt: paTable };
    }
    var lightest = tables[tables.length - 1];
    var mode = null;
    var runways = airfield.runways.map(function (rwy) {
      var w = windForRunway(inp, rwy.bearingTrue);
      mode = w.mode;
      var out = {
        id: rwy.id, bearingTrue: rwy.bearingTrue, bearingMag: rwy.bearingMag, surface: rwy.surface,
        computed: w.computed, reason: w.reason, wind: w, takeoff: null, landing: null, takeoffByMass: null, takeoffLimit: null
      };
      if (w.computed) {
        out.takeoff = computePhase(charts.takeoff, lookups.takeoff, rwy, w, inp.runwayWet, rwy.takeoffAvailable.value);
        out.landing = computePhase(charts.landing, lookups.landing, rwy, w, inp.runwayWet, rwy.landingAvailable.value);
        // Start mit einer Tabelle bzw. einem Gewicht mit derselben Kette (Wind, Belag, Faktoren, Nässe)
        var phaseWith = function (lk, table) {
          return computePhase(chartWithTable(aircraft.charts.takeoff, table), lk, rwy, w, inp.runwayWet, rwy.takeoffAvailable.value);
        };
        // Start je Starttabelle und daraus «möglich bis» (bei «linear» als Übersicht im Rechenweg)
        out.takeoffByMass = tables.map(function (t, i) {
          var p = out.takeoff;
          if (i !== ti || br.lower !== null) {
            var lk = lookupTable(t.table, axisInputs);
            if (!lk.ok) return { kg: t.kg, ok: false, reason: 'no-lookup', m: null, possible: false, wetFactorMissing: false };
            p = phaseWith(lk, t.table);
          }
          // Möglich: Wert vorhanden, beide Strecken innerhalb der verfügbaren Länge (heute folgt das eine aus dem anderen,
          // weil die Strecke über 15 m nie kürzer ist als die Rollstrecke; die doppelte Bedingung hält auch ohne das)
          var possible = p.ok && !p.exceeds.groundRoll && !p.exceeds.overObstacle;
          return { kg: t.kg, ok: p.ok, reason: p.reason, m: p.m, possible: possible, wetFactorMissing: p.wetFactorMissing };
        });
        if (read === 'linear') {
          var atKg = function (kg) {
            var b = massBracket(tables, kg, read);
            var lk = massLookup(tables, b, axisInputs);
            if (!lk.ok) return { ok: false, reason: 'no-lookup', m: null, exceeds: null, wetFactorMissing: false };
            return phaseWith(lk, tables[b.upper].table);
          };
          out.takeoffLimit = takeoffLimitLinear(out.takeoff, massKg === null ? aircraft.mass.kg : massKg, aircraft.mass.kg, lightest.kg, atKg);
          out.takeoffLimit.tableKg = tables[ti].kg;
        } else {
          out.takeoffLimit = takeoffLimit(out.takeoffByMass, ti);
        }
      }
      return out;
    });
    var interpKg = br.lower !== null;
    return {
      ok: true, error: null, input: inp, pressureAltitudeFt: pa, pressureAltitudeTableFt: paTable, mode: mode,
      lookups: lookups, runways: runways,
      // inputKg null: kein Gewicht eingegeben, gerechnet mit dem Höchstgewicht. table*: Starttabelle für das
      // nächsthöhere Gewicht; bei Interpolation im Gewicht (interpolated) zusätzlich die nächstleichtere (lower*).
      // Die Landung rechnet immer mit der einen Landetabelle (maximales Landegewicht).
      mass: {
        inputKg: massKg, maxKg: aircraft.mass.kg, maxLb: aircraft.mass.lb, read: read,
        tableKg: tables[ti].kg, tableLb: tables[ti].lb, tableIndex: ti, tableCount: tables.length,
        tableRef: tables[ti].ref, tableTitle: tables[ti].title,
        interpolated: interpKg,
        lowerKg: interpKg ? tables[br.lower].kg : null, lowerIndex: interpKg ? br.lower : null,
        lowerRef: interpKg ? tables[br.lower].ref : null, lowerTitle: interpKg ? tables[br.lower].title : null,
        lightestKg: lightest.kg, belowLowest: massKg !== null && massKg < lightest.kg,
        tablesKg: tables.map(function (t) { return t.kg; })
      },
      computedCount: runways.filter(function (r) { return r.computed; }).length
    };
  }

  return {
    VERSION: VERSION,
    SCHEMA: SCHEMA,
    EPS: EPS,
    FT_M: FT_M,
    LB_KG: LB_KG,
    CALM_BELOW_KT: CALM_BELOW_KT,
    NODIR_MAX_KT: NODIR_MAX_KT,
    MAX_HEADWIND_KT: MAX_HEADWIND_KT,
    MAX_WIND_CREDIT: MAX_WIND_CREDIT,
    INPUT_RANGES: INPUT_RANGES,
    LIMITS: LIMITS,
    PHASES: PHASES,
    pressureAltitudeFt: pressureAltitudeFt,
    ceilMeters: ceilMeters,
    MASS_READS: MASS_READS,
    validateAircraft: validateAircraft,
    validateAirfield: validateAirfield,
    checkInput: checkInput,
    lookupTable: lookupTable,
    windForRunway: windForRunway,
    takeoffTables: takeoffTables,
    pickTakeoffTable: pickTakeoffTable,
    takeoffMassBracket: takeoffMassBracket,
    compute: compute,
    // nur für Tests: Auswertung «möglich bis» aus einer Liste je Starttabelle bzw. auf ganze kg
    _takeoffLimit: takeoffLimit,
    _takeoffLimitLinear: takeoffLimitLinear,
    // nur für Tests: eine Phase direkt rechnen (Schlussprobe ist mit geprüften Daten nicht erreichbar)
    _computePhase: computePhase
  };
}));
