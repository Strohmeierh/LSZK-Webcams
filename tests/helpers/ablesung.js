// Ableseregeln der Flugzeugdaten für die Tests (kein eigener Test; node --test sucht nur *.test.js).
//
// Seit VERSION 7 (Wunsch des Benutzers vom 20.11.2026) lesen alle Muster Druckhöhe, Temperatur und beim Start das
// Gewicht linear zwischen den Tabellenwerten (read «linear», charts.takeoff.massRead «linear»). Bis VERSION 6 galt
// der nächsthöhere Tabellenwert für Druckhöhe und Gewicht, für die Temperatur bei der Cessna ebenfalls, beim Tecnam
// P2010 linear. Der Kern kann beide Regeln; die Daten deklarieren sie.
//
// alteAblesung(ac) gibt eine Kopie mit der Regel bis VERSION 6 zurück. Damit behalten die Tests der Rechenmechanik
// (Wind, Belag, Faktoren, Rundung, Nässe, «möglich bis», Texte und Aufbau der Anzeige) ihre von Hand und am Handbuch
// gerechneten Sollwerte. Die Ablesung selbst, wie sie ausgeliefert wird, prüfen eigene Tests mit den Daten, wie sie
// sind (tests/perf-interpolation.test.js).
'use strict';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function alteAblesung(ac) {
  const a = clone(ac);
  const tempLinear = a.id === 'p2010';
  const fix = (t) => t.axes.forEach((ax) => { ax.read = ax.quantity === 'temperature' && tempLinear ? 'linear' : 'nextHigher'; });
  ['takeoff', 'landing'].forEach((ph) => {
    const ch = a.charts[ph];
    fix(ch.table);
    (ch.lowerWeights || []).forEach((e) => fix(e.table));
    delete ch.massRead;
  });
  return a;
}

module.exports = { alteAblesung, clone };
