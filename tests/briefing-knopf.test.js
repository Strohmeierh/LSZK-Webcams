// Kopfknopf des KI-Briefings (index.html): seit 20.11.2026 heisst er «Briefing» (Wunsch des Benutzers: «Bitte im Button
// anstelle von KI-Briefing nur Briefing schreiben»). Sichtbarer Text, Tooltip (title) und Name für Screenreader
// (aria-label) sagen dasselbe; der Titel im Detail-Fenster bleibt «KI-Briefing», damit klar ist, woher der Text stammt.
// Aufruf im Repo-Root: node --test (die Seite heisst im Repo index.html)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Kopfknopf heisst «Briefing» (Text, title, aria-label); das Detail-Fenster bleibt «KI-Briefing»', () => {
  assert.ok(html.includes('<button class="top-btn ai-btn" id="ai-toggle" type="button" onclick="openAiModal()" aria-haspopup="dialog" title="Briefing">'));
  assert.ok(/\n[ \t]*Briefing<span class="ai-time" id="ai-time"><\/span>/.test(html), 'sichtbarer Text im Knopf');
  // title und aria-label setzt das Skript aus label (Zustand, Stand, Sperre hängen sich an)
  assert.ok(html.includes("var st = aiState(), now = new Date(), time = '', label = 'Briefing';"));
  assert.ok(html.includes('btn.title = label;') && html.includes("btn.setAttribute('aria-label', label);"));
  // nirgends mehr «KI-Briefing» am Knopf
  assert.ok(!/>\s*KI-Briefing<span class="ai-time"/.test(html));
  assert.ok(!html.includes('title="KI-Briefing"') && !html.includes("label = 'KI-Briefing'"));
  // Detail-Fenster unverändert
  assert.ok(html.includes('<span id="ai-modal-title">KI-Briefing</span>'));
});
