/* Start- und Landestreckenrechner – Rechenkern ohne DOM (Datenschema 2).
   Rechnet nach den AFM-Tabellen in perf/aircraft/*.json für die Pisten in perf/airfields/*.json.
   Grundsatz: lieber kein Wert als ein falscher oder zu optimistischer. Jede Rundung geht zur längeren Strecke.
   Gerechnet wird nur die Piste mit Gegenwind; bei Windstille, fehlender Richtung (bis 3 kt) oder genau querem
   Wind alle Pisten ohne Windkorrektur. Rückenwind wird nicht gerechnet.
   Die Daten deklarieren ihr Schema, der Kern kennt eine Whitelist: Unbekanntes ergibt keinen Wert.
   Browser: window.LszkPerfCore. Node: module.exports.
   VERSION gleich dem ?v= in index.html und in perf/perf-ui.js halten. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.LszkPerfCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 4;

  var EPS = 1e-9;
  var FT_M = 0.3048;
  var LB_KG = 0.45359237;
  var CALM_BELOW_KT = 1;        // Mittelwind darunter: windstill, alle Pisten ohne Windkorrektur
  var NODIR_MAX_KT = 3;         // ohne Windrichtung bis hier alle Pisten ohne Windkorrektur, darüber kein Wert
  var MAX_HEADWIND_KT = 40;     // Gegenwind darüber: kein Wert (das AFM nennt keine Obergrenze)
  var MAX_WIND_CREDIT = 0.5;    // verkürzt der Wind eine Strecke um mehr als die Hälfte: kein Wert

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
    pressureAltitude: { unit: 'ft', range: [-2000, 20000], reads: ['nextHigher'] },
    temperature: { unit: 'degC', range: [-60, 60], reads: ['nextHigher', 'linear'] }
  };
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
        validateTable(ch.table, p + '.table', err);
        validateCorrections(ch.corrections, tableUnit(ch.table), p + '.corrections', err);
      });
    }
    return { ok: errors.length === 0, errors: errors };
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
    return bad;
  }

  /* ── Tabellenablesung ──────────────────────────────────────────
     nextHigher: erster Wert ≥ Eingabe, darunter der kleinste, darüber kein Wert.
     linear: unter dem kleinsten Wert der kleinste, über dem grössten kein Wert, genau auf einer Spalte deren Wert,
     dazwischen linear mit demselben Gewicht für beide Ausgaben. */
  function lookupTable(table, inputs) {
    var axes = [], above = [];
    var linearAxis = -1;
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
      var a = { quantity: ax.quantity, read: ax.read, input: v, index: j, value: vals[j], belowLowest: v < vals[0] };
      if (ax.read === 'linear' && v > vals[0] && vals[j] !== v) {
        a.lowerIndex = j - 1;
        a.lower = vals[j - 1];
        a.upper = vals[j];
        a.num = v - vals[j - 1];                // Gewicht = num / den
        a.den = vals[j] - vals[j - 1];
        a.weight = a.num / a.den;
        linearAxis = k;
      }
      axes.push(a);
    }
    if (above.length) return { ok: false, above: above };
    var idx = axes.map(function (a) { return a.index; });
    var hi = cellAt(table.cells, idx);
    var values = {}, columns = null;
    if (linearAxis < 0) {
      table.outputs.forEach(function (o, n) { values[o.id] = hi[n]; });
    } else {
      var la = axes[linearAxis];
      var loIdx = idx.slice();
      loIdx[linearAxis] = la.lowerIndex;
      var lo = cellAt(table.cells, loIdx);
      columns = { lowerValue: la.lower, upperValue: la.upper, weight: la.weight, lower: {}, upper: {} };
      table.outputs.forEach(function (o, n) {
        // a + (v − a0)·(b − a)/(a1 − a0): erst multiplizieren, dann teilen
        values[o.id] = lo[n] + la.num * (hi[n] - lo[n]) / la.den;
        columns.lower[o.id] = lo[n];
        columns.upper[o.id] = hi[n];
      });
    }
    return {
      ok: true, axes: axes, values: values, columns: columns, interpolated: linearAxis >= 0,
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
    var pa = pressureAltitudeFt(airfield.elevation.value, inp.qnhHpa);
    var axisInputs = { pressureAltitude: pa, temperature: inp.tempC };
    var lookups = {};
    var above = [];
    PHASES.forEach(function (ph) {
      var lk = lookupTable(aircraft.charts[ph].table, axisInputs);
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
      return { ok: false, error: { code: 'above-range', above: above }, input: inp, pressureAltitudeFt: pa };
    }
    var mode = null;
    var runways = airfield.runways.map(function (rwy) {
      var w = windForRunway(inp, rwy.bearingTrue);
      mode = w.mode;
      var out = {
        id: rwy.id, bearingTrue: rwy.bearingTrue, bearingMag: rwy.bearingMag, surface: rwy.surface,
        computed: w.computed, reason: w.reason, wind: w, takeoff: null, landing: null
      };
      if (w.computed) {
        out.takeoff = computePhase(aircraft.charts.takeoff, lookups.takeoff, rwy, w, inp.runwayWet, rwy.takeoffAvailable.value);
        out.landing = computePhase(aircraft.charts.landing, lookups.landing, rwy, w, inp.runwayWet, rwy.landingAvailable.value);
      }
      return out;
    });
    return {
      ok: true, error: null, input: inp, pressureAltitudeFt: pa, mode: mode,
      lookups: lookups, runways: runways,
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
    validateAircraft: validateAircraft,
    validateAirfield: validateAirfield,
    checkInput: checkInput,
    lookupTable: lookupTable,
    windForRunway: windForRunway,
    compute: compute,
    // nur für Tests: eine Phase direkt rechnen (Schlussprobe ist mit geprüften Daten nicht erreichbar)
    _computePhase: computePhase
  };
}));
