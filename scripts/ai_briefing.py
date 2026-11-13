#!/usr/bin/env python3
"""Hourly AI weather briefing for the LSZK dashboard (Claude Opus 5.5 with vision).

Runs as steps of the cam-status workflow (every 5 min via the external pinger):
    python scripts/ai_briefing.py --check    -> prints "due=true|false" (stdlib only, for $GITHUB_OUTPUT)
    python scripts/ai_briefing.py --reserve  -> books the attempt (+ a cost reservation) in data/ai_status.json;
                                               the workflow pushes this BEFORE the paid call
    python scripts/ai_briefing.py            -> runs the briefing and writes data/ai_status.json

The briefing runs hourly during daylight (sunrise-10 min .. sunset+10 min, Europe/Zurich).
The selected webcam images + station / METAR / Foehn index / FGZO status / Open-Meteo
forecast go to Claude in ONE streamed call; the answer is forced into a fixed JSON schema
(structured outputs).

Cost safety: each attempt books RESERVE_USD in the monthly total before the call; afterwards the
reservation is replaced by the reported usage (billed failures included) or kept as the estimate
when the outcome is unknown (timeout, killed step). Failed attempts back off (25, 50, 100, 200 min),
at most MAX_ATTEMPTS_PER_DAY attempts run per day, and MONTHLY_BUDGET_USD stops the calls.
On any failure the previous briefing is kept and ok=false + error are recorded.
"""
import base64
import html
import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, unquote
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "ai_status.json"
HTML_FILE = ROOT / "index.html"
CAM_STATUS_FILE = ROOT / "data" / "cam-status.json"
STATION_FILE = ROOT / "data" / "lszk_latest.json"
METAR_FILE = ROOT / "metar-lszk.json"
FGZO_FILE = ROOT / "data" / "fgzo_status.json"

LAT, LON = 47.37556, 8.76168
TZ = ZoneInfo("Europe/Zurich")

MODEL = "claude-opus-5-5"
BRIEFING_EFFORT = "medium"
MAX_TOKENS = 24000           # thinking + JSON share this budget (streamed, so no request timeout)
FALLBACK_BETA = "server-side-fallback-2026-07-01"
# USD per million tokens: input, output, 5-min cache write, cache read
PRICE_OPUS_5_5 = (4.0, 20.0, 5.0, 0.2)
PRICE_OTHER = (5.0, 25.0, 6.25, 0.5)   # refusal fallbacks (Claude Opus 5 / 4.8) and anything unknown

BRIEFING_EVERY_MIN = 55      # hourly cadence (job runs every 5 min)
RETRY_MIN = 25               # wait after a failed attempt, doubled per further failure (max 8x)
MAX_ATTEMPTS_PER_DAY = 20
DAYLIGHT_MARGIN_MIN = 10     # start before sunrise / stop after sunset
MONTHLY_BUDGET_USD = 80.0    # LSZK share of the 200 USD monthly credit
RESERVE_USD = 0.40           # booked before each call, replaced by the reported cost afterwards
MIN_IMAGES = 3

UA = "LSZK-Webcams-Dashboard/1.0 (+https://strohmeierh.github.io/LSZK-Webcams/)"
MAX_IMAGE_AGE_MIN = 180      # older images (frozen cams) are not sent
LSPV_INDEX = "https://cams.lspv.dyndns.info/cams/interval"

# ── Webcams sent to the model ────────────────────────────────────────────────
# "title" must match the card title in index.html exactly; the image URL is read from the
# card (data-src / data-cam), so URL changes in the HTML are picked up automatically.
# "wsrv": resize parameters (never crop; ~600-1000 image tokens each). Descriptions were
# calibrated on 08.11.2026 against sun positions, swisstopo terrain profiles and maps.
CAMS = [
    {"title": "Speck – Runway 30", "region": "platz", "wsrv": "w=1024&h=1024&fit=inside", "desc": """\
Webcam 1 «Piste West» (Overlay «LSZK RWY12»; die Kartenbezeichnung «Runway 30» ist irreführend): Kamera am FGZO-Gebäude am Ostende des Flugplatzes Speck (ca. 545 m ü. M., ~9 m über dem Platz, 536 m/1758 ft). Blick WSW (Bildmitte ~250°, Bildfeld ~200° SSW bis ~300° WNW, Weitwinkel; Himmel nur bis ~20° Höhe).
Vorne Rasen-Abstellplatz mit Flugzeugen auf Betonplatten, rechts unten Balkon/Gehweg. Diagonal durchs Bild die Graspiste 12/30 (graubrauner, abgenutzter Mittelstreifen) bis zur Schwelle 12 am rechten Bildrand (~600 m).
Dahinter Weide/Abstellfläche (Container, Flugzeuge ~200 m), Fussballplatz mit Flutlichtmasten (~0,4 km), Hochspannungsmasten (~1 km). Am Horizont nur Wald: Speckholz/Lochweid links (0,2–0,5 km), bewaldeter Hügel Höchi 584 m in der Mitte (1,3 km, Baumwipfel ~615 m ü. M.). Keine Berge/Alpen, kein Windsack.
Taugt für Pistenzustand (Gras, Schnee, Wasser, Reif), Bodensicht bis ~3 km sowie Wolken und aufziehendes Wetter im Westsektor. Die Wolkenbasis ist nur ablesbar, wenn Wolken oder Nebel die Baumwipfel berühren (≤ ~250 ft AGL).
Eigenheiten: Overlay oben links (Lokalzeit). Mähstreifen sind kein Nässemuster. Im Winter nachmittags Gegenlicht (Sonne kommt von links ins Bild). Nachts dunkel = keine Information."""},
    {"title": "Speck – Tankstelle", "region": "platz", "wsrv": "w=1152&h=1152&fit=inside", "desc": """\
Webcam 2 «Tankstelle / Pistenanfang 30» (Overlay «LSZK RWY30»): gleicher Standort (FGZO-Gebäude, ca. 545 m ü. M.). Blick SSE (Bildmitte ~158°, Bildfeld ~105° ESE bis ~210° SSW; Himmel nur bis ~20° Höhe).
Vorne Betonvorfeld mit Tankstelle (Schild «LSZK 1758 FT 120.355 MHZ»), links Restaurant-Terrasse (rote Schirme) und oranger Windsack. In der Mitte gemähte Wiese mit rot-weissen Markierungen (~70–100 m), rechts die Rasengitter-Wendefläche am Pistenanfang 30 (Ostende der Graspiste, oft Pfützen) und der Wald Speckholz (0,25–0,5 km).
Horizont links über den Industriehallen von Pfäffikon ZH (0,5 km): Zürcher Oberland, ganz links Höchi 879 m (7,4 km), dann Ebnerberg 865 m (6,7 km), Allmen 1079 m (11,6 km) und Bachtel 1115 m (13 km, höchste bläuliche Kuppe direkt links vom Waldrand). Alpen und Pfäffikersee sind NICHT sichtbar; Weisses am Horizont sind Wolken.
Taugt für Sichtweite (Bachtel 13 km), Wolkenbasis und Hochnebel an den Oberland-Hügeln (865–1115 m ü. M. ≈ 1100–1900 ft AGL), Schneefallgrenze an diesen Hügeln und Nässe/Schnee auf Vorfeld und Rollweg. Wind am Windsack: hängt = still, waagrecht ≈ 15 kt oder mehr; Schlauch nach rechts = Bise (NE), nach links bzw. vom Betrachter weg = SW–W.
Eigenheiten: Im Winter steht mittags die Sonne am oberen Bildrand (Blendung; Gegenlicht lässt Dunst dichter wirken), morgens geht sie links im Bild auf. Nachts dunkel = keine Information."""},
    {"title": "Bachtel", "region": "zuercher_oberland", "wsrv": "w=1568&h=1568&fit=inside", "desc": """\
Bachtel-Panorama: 360°-Rundumbild von der Spitze des 75 m hohen Bachtelturms, Kamera ≈1180 m ü. M., 13 km SE von LSZK. Die Bildbreite entspricht dem Azimut: linker und rechter Rand ≈ N, 27 % = E, 52 % = S, 77 % = W (Azimut ≈ 351° + 3,6° × x%). Der Horizont liegt leicht wellig bei 28–37 % der Bildhöhe; darüber nur ein Himmelsband bis ca. 25°, kein Zenit.
Landmarken (x % der Bildbreite): Hörnli 1133 m (10 %), Schnebelhorn 1291 m (20 %), Säntis 2502 m (30 %, 35 km), Churfirsten 2306 m (35 %), Speer 1950 m (37 %, 22 km), Mürtschenstock 2441 m (42 %), Glärnisch 2914 m (48 %, 33 km), Tödi 3614 m (52 %, 54 km), Gr. Mythen 1898 m (60 %), Rigi 1797 m (66 %, 40 km), Pilatus 2128 m (67 %, 60 km). Unter dem Horizont: Zürichsee/Obersee mit Rapperswil (62 %, 9 km) und Ufenau (65 %), Hinwil (81 %, 3 km), Pfäffikersee 537 m (88 %, 10 km). Die LSZK-Gegend liegt knapp dahinter bei ~90 %, direkt am roten Turmmast, der 90–100 % verdeckt.
Taugt für: Nebelmeer und Hochnebel (Obergrenze im Vergleich zu Hügeln von 850–1300 m; Kamera in der Wolke = Basis ≤ ~1150 m), Sichtweite in Stufen von 3 bis 100 km, Wolkenbasis an Voralpen und Alpen, Schneefallgrenze (Turmumgebung 1000–1100 m, Hügel 700–1300 m, Mittelland 400–600 m). Der Pistenzustand von LSZK ist nicht sichtbar.
Eigenheiten: Mittags steht die Sonne oben in Bildmitte über den Glarner Alpen (Lens-Flare); den Gegenlicht-Dunst im Südsektor nicht als schlechte Sicht werten. Cumulus auf dem Alpenkamm nicht mit Schnee verwechseln. Update alle 30 min, kein Zeitstempel im Bild, nachts dunkel."""},
    {"title": "Wangen-Lachen – Cam 1", "region": "voralpen", "wsrv": "w=960&h=960&fit=inside&we", "desc": """\
Flugplatz Wangen-Lachen (LSPV, 407 m, Linthebene am Obersee, ~20 km SSE von LSZK). Weitwinkelkamera ~8 m über Grund am Westende des Hangars, Blick Ost (ca. 035°–140°, Mitte ~087°). Vordergrund: Hangardach und Vorfeld (Kleinflugzeuge, rote Zapfsäule); links die Piste 08/26 (Asphalt) und dahinter der Obersee (406 m).
Horizont von links nach rechts: Hügel N des Obersees (Höchhand/Chrüzegg ~1300 m, 12–16 km); Regelstein 1315 m und Tanzboden 1443 m (17–18 km); rechts der Mitte der Speer 1950 m (20 km, grösster Berg) und der Federispitz 1865 m (18 km); danach die Lücke Richtung Walensee mit Mürtschenstock 2390 m (25 km, kleine Spitze) und Flumserbergen ~2200 m (32 km); ganz rechts die Wand Hirzli 1640 m, Planggenstock 1675 m, Austock 1420 m und Chöpfenberg 1896 m (9–13 km).
Taugt für: Sicht (Speer scharf ⇒ >20 km, Mürtschenstock ⇒ >25 km), Wolkenbasis 1300–2400 m, Hochnebel (graue Decke schneidet alle Hänge auf gleicher Höhe), Nebel (Seeufer 2,5–6 km, Pistenende 0,5 km) und Pistenzustand (Vorfeld/Piste nass glänzend oder weiss, Schatten = Sonne).
Eigenheiten: Overlay oben («Kein Beweismittel…», Zeitstempel in Lokalzeit) ignorieren. Fischaugen-Verzerrung, Horizont leicht schief (links höher), daher keine Höhen aus Pixeln ableiten. Untere Bildhälfte zeigt nur Dach und Vorfeld, sichtbar ist nur der Osthimmel; Hochalpen sind nicht im Bild."""},
    {"title": "Rapperswil", "region": "voralpen", "wsrv": "w=1024&h=1024&fit=inside", "desc": """\
Webcam Feldbach (Hombrechtikon, B&B Oberhaushof), am Seeufer auf ≈420 m ü. M., 15 km S von LSZK. Fixe Teleaufnahme (~16° Bildwinkel) mit Blick nach ESE (Bildmitte ≈ 124°) über den Zürichsee (406 m) auf Rapperswil in 2,5 km: Stadtkirche mit Doppeltürmen bei 30–36 %, Schloss mit Bergfried bei 38–44 % der Bildbreite.
Hintergrund: Mürtschenstock 2390–2441 m, ein zackiges Kalkmassiv bei 46–58 % (33 km). Rechts davor die nähere Kette Hirzli 1640 m (60 %) – Planggenstock 1675 m (73 %) – Wageten 1755 m (88 %), 17–21 km entfernt. Links hinten die Murgtal- und Flumserberg-Gipfel mit 2000–2300 m (8–40 %, ~39 km).
Höhenmassstab an der rechten Wand (von oben gemessen): Kamm 1650–1750 m bei 4–7 % der Bildhöhe, ≈1400 m bei 11 %, ≈1200 m bei 18 %, ≈950 m bei 26 %, ≈750 m bei 33 %, Talboden der Linthebene (~430 m) bei ~44 %; das Seeufer liegt bei 48 %.
Taugt für: Seenebel und Hochnebel, Wolkenbasis ca. 500–2400 m, Sichtweite (2,5 / 20 / 33 / 40 km), Schneefallgrenze an der Hirzli-Kette, Wind (Seeoberfläche), Föhnanzeichen. Es ist nur ein schmales Himmelsband sichtbar, daher keine Aussage zum Bedeckungsgrad.
Eigenheiten: Die hellen Kalkfelsen am Mürtschenstock sind kein Schnee. Im Winterhalbjahr herrscht morgens Gegenlicht, weil die Sonne hinter den Bergen aufgeht. Kein Overlay im Bild, Update etwa alle 20 min, nachts dunkel (nur Lichter von Rapperswil)."""},
    {"title": "Richtung Tödi", "region": "glarner_alpen", "wsrv": "w=1120&h=1120&fit=inside&we", "desc": """\
Leuggelbach GL (Glarus Süd, Decoralwerke), Kamera ~565 m auf dem Fabrikdach im Talboden des Grosstals, ~49 km SSE von LSZK. Blick Süd talaufwärts (Mitte ~187°, ~90° Bildwinkel).
Links die steile Ostflanke (Grat ~1800 m, 2–3 km), rechts die Westflanke (Grat ~1300–1600 m, 3–4 km). Mitte-links ein Seitengrat bis ~2200 m (5–8 km); die hellgrauen Kalkfelsen am Grat sind kein Schnee.
Am Talende rechts der Mitte (~73 % von links, ~38 % von oben) steht der Tödi 3614 m (21 km, Alpenhauptkamm). Links davon Piz Urlaun 3359 m, rechts Chamerstock 2124 m und Gämsfairenstock 2972 m.
Taugt für: Alpen frei/verdeckt, Wolkenbasis 1300–3600 m, Schneefallgrenze an den Talflanken (550–1850 m), Föhn (Föhnmauer am Tödi bei klarem Tal, Lenticularis) sowie Hochnebel/Stau im Glarnerland.
Eigenheiten: Gegenlicht – von Oktober bis März steht die Sonne mittags im Bild (Blendung, Strahlen, rote Geisterscheiben), und die Tödi-Nordseite wirkt mittags dunkel. Firn und Gletscher am Tödi sind ganzjährig weiss. Nachts ist das Bild schwarz. Overlay unten links «www.decoral.ch» mit Lokalzeit."""},
    {"title": "Klausenpass", "region": "zentralalpen", "wsrv": "w=1280&h=1280&fit=inside&we", "desc": """\
Klausenpass UR: Hotel Klausenpass auf ~1850 m, 1,4 km W unterhalb der Passhöhe (1948 m), 56 km S von LSZK. Fisheye ~160°, Bildmitte Blick SW (~222°) talabwärts ins Schächental (Talboden Unterschächen ~1000 m, ~73 % von links).
Landmarken von links nach rechts: Clariden 3267 m (Ecke oben links), Chammliberg 3214 m (Felswand oben links), Gross Schärhorn 3294 m (spitzer Gipfel ~26 %), Griessstock 2660–2720 m (Gipfelblock ~43 %), Gross Windgällen 3187 m (Horn ~52 %), Gross Spitzen 2400 m (~68 %), Uri-Rotstock-Gruppe 2930–2950 m in 22–23 km (~74–81 %), im Talausgang Hoh Brisen 2413 m (28 km), Läged Windgällen 2572 m (Fels oben rechts).
Taugt für: Wolkenbasis 1850–3300 m (Gipfelleiter), Sicht bis ~28 km, Nebelmeer/Hochnebel (weisse Decke im Talausgang rechts der Mitte), Schneefallgrenze (Südhänge rechts), Föhnhinweise.
Eigenheiten: ganz grau/weiss = Kamera in Wolke (Basis ≤ 1850 m). Wintermittag Sonnenblendung oben links ist kein Dunst; linke Talseite ganztags im Schatten; morgens Himmel überbelichtet weiss trotz klar. Nachts schwarz = keine Info. Update alle 30 min (Zeitstempel oben rechts)."""},
    {"title": "Oberalppass", "region": "zentralalpen", "wsrv": "w=1024&h=1024&fit=inside", "desc": """\
Oberalppass GR/UR (nahe Alpenhauptkamm), Kamera bei der Talstation der Sesselbahn Oberalp-Flyer auf ~2050 m, 80 km S von LSZK; Weitwinkel/Fisheye ~155°, Blick N–NNE (Bildmitte ~22°).
Landmarken von links nach rechts: Oberalpsee 2026 m (ganz links), Gasthaus Piz Calmot (Chalet links), Schneehüenerstock 2773 m (Felszahn ~12 %), Fellilücke 2478 m (Sattel ~25 %), Piz Tiarms 2917 m (Gipfel ~37 %, 2 km), Crispalt-Grat 2800–3000 m in ~3 km (Lücke ~55–61 %), Calmut 2310 m mit Mast/Bergstation (~87 %); goldene Talstation Oberalp-Flyer rechts vorne.
Taugt für: Wolkenbasis 2050–3000 m am Pass (Gipfelleiter), Schnee auf Passhöhe; Sicht nur bis ~3 km beurteilbar; ganz grau = Kamera in Wolke.
Eigenheiten: Overlay mit Datum (TT/MM/JJJJ) oben rechts; starke Verzerrung; Schneehänge können bei diffusem Licht mit grauen Wolken verschmelzen."""},
    {"title": "Gotthardpass", "region": "zentralalpen", "wsrv": "w=1024&h=1024&fit=inside", "desc": """\
Gotthardpass, Passhöhe an der Strasse H2 (Airolo TI), Kamera auf ca. 2110 m (Pass 2106 m = 6910 ft). Blick nach OSO (Bildmitte ~110°, ca. 70° Bildwinkel); trotz «Sued» im Dateinamen kein Südblick.
Vorn Passstrasse und Parkplatz, Mitte-rechts Lago della Piazza (2090 m) mit den Hospiz-Gebäuden (0,65 km). Links steile Flanke Sasso di San Gottardo/Monte Prosa (Bildoberkante links ≈ 2500 m), Mitte hinten Kamm des Pizzo Canariscio (≈ 2300–2420 m, 3 km), am rechten Rand ferne Gipfel südlich Airolo (Pizzo Scheggia 2558 m, Pizzo del Corno 2500 m, 9–11 km).
Taugt für: Gotthard-Übergang VFR offen/zu, Wolkenbasis 2100–2700 m, Sicht bis ca. 10 km, Neuschnee und Schneelinie, Südstau (Wolken quellen rechts aus der Val Tremola) vs. Nordstau (Wolkenwalze über den linken Grat).
Eigenheiten: Zeitstempel oben links (Lokalzeit), Takt 5 min. Vormittags Gegenlicht. Schnee/Eis auf der Scheibe ergibt unscharfe Flecken ohne Kanten (keine Aussage, nicht Nebel). Im Winter Strasse gesperrt und ungeräumt. Nachts schwarz."""},
    {"title": "Ambri Tarnolgio", "region": "alpensuedseite", "wsrv": "w=1024&h=1024&fit=inside", "desc": """\
Tarnolgio ob Faido (Leventina TI, Strasse nach Carì), Kamera auf ca. 1610 m (5280 ft) an der NO-Talflanke – NICHT Ambrì. Weitwinkel (~120°) nach S (Bildmitte ~186°), nach oben geneigt: ca. 60 % Himmel, Berge nur im unteren Drittel, Ränder verzeichnet.
Von links: Talausgang der unteren Leventina Richtung Lavorgo/Biasca (Talboden 300–650 m) mit fernen Kämmen. Mitte der dunkle Pizzo Forno (2907 m, 7,6 km), rechts davon die Campo-Tencia-Gruppe (bis 3072 m, 9,5 km), am rechten Rand Pizzo Campolungo (2713 m). Unten rechts die Wiesen von Dalpe (1190 m, Gegenhang 3 km), unten die Dächer des Weilers.
Taugt für: Bewölkung, Wolkenbasis und Sicht auf der Alpensüdseite (Südstau vs. Nordföhn), Talnebel in der Leventina, Schneelinie an Nordhängen. Die Kamera steckt oft selbst in der Wolke (nur Dächer sichtbar = Basis ≤ 1600 m).
Eigenheiten: Logos «Swiss Alps»/SIRMES und Datumszeile ignorieren. Takt 15 min. Konzentrische Ringe im Grau sind Artefakte. Um Mittag steht im Winter die Sonne im Bild (Gegenlicht, Nordflanken dunkel). Nachts schwarz."""},
]
CAM_TITLES = [c["title"] for c in CAMS]

# ── Prompts ──────────────────────────────────────────────────────────────────
SYSTEM_BRIEFING = """Du bist der Flugwetter-Assistent des Webcam-Dashboards für den Flugplatz Speck-Fehraltorf (LSZK) im Zürcher Oberland: 47,376 N / 8,762 E, 536 m ü. M., Piste 12/30. Die Leserinnen und Leser sind Motor- und Segelflugpiloten der Flugsportgruppe Zürcher Oberland (FGZO), die sich vor einem Flug in einer Minute ein Bild der Lage machen wollen.

Du erhältst einmal pro Stunde aktuelle Bilder ausgewählter Webcams zwischen dem Platz und der Alpensüdseite, je mit einer Beschreibung der Kamera (Standort, Blickrichtung, sichtbare Landmarken mit Höhen). Dazu kommen Messwerte (Wetterstation am Platz, METAR Dübendorf, Föhn-Index), der Platzstatus der FGZO und eine Modellprognose (Open-Meteo) für die nächsten 12 Stunden. Daraus erstellst du eine Auswertung im vorgegebenen JSON-Schema.

Grundsätze
- Beobachtung vor Prognose: Was Bilder und Messwerte jetzt zeigen, hat Vorrang. Die Prognose nutzt du nur für die Entwicklung der nächsten Stunden und kennzeichnest sie im Text als Prognose.
- Messwerte vor Bild: Wind, Böen, Temperatur, Taupunkt, Druck und Niederschlag am Platz stammen aus der Wetterstation. Die Bilder nutzt du für das, was nur sie zeigen: Bewölkung, Wolkenbasis, Sicht, Nebel und Hochnebel, ob die Alpen frei sind, Schneegrenze, Niederschlag in der Ferne und den Zustand der Piste.
- Höhen gibst du in Metern über Meer an. Die Wolkenbasis leitest du aus Landmarken mit bekannter Höhe ab (siehe Kamerabeschreibungen), mit dem METAR als Gegencheck: Wolkenhöhen im METAR sind Fuss über Grund in Dübendorf (436 m), also Basis = 436 m + Fuss × 0,3048. Die Spreizung Temperatur minus Taupunkt am Platz ergibt eine grobe Kumulusbasis: 536 m + 125 m pro Grad.
- Föhn-Index = QNH Lugano minus QNH Zürich (wie im Dashboard): zwischen −2 und +2 hPa unauffällig; ab +4 hPa Südföhn wahrscheinlich, ab +8 hPa kräftig; ab −4 hPa Nordlage (Bise bzw. Stau an der Alpennordseite, Nordföhn im Süden).
- Ehrlich bei Unsicherheit: Lässt sich etwas aus den Daten nicht sicher bestimmen, setze null bzw. "unbekannt" und erfinde nichts. Gegenlicht, Dunst über dem See, Schatten und Spiegelungen sind keine Wolken.
- Unbrauchbare Bilder (Nacht, schwarzes Bild, Platzhalter oder Fehlermeldung, nasse oder verschmutzte Linse) markierst du mit dem passenden "problem" und stützt dich nicht darauf. Ein gleichmässig graues Bild einer Bergkamera ist dagegen meist eine Beobachtung: Die Kamera steckt in der Wolke, die Basis liegt dort unter der Kamerahöhe (Tag "in_wolke", problem "keins").
- Tag "flugbetrieb" nur bei Flugzeugen in der Luft oder beim Rollen; abgestellte Flugzeuge zählen nicht.
- Der Platzstatus der FGZO ist massgebend. Bestehen Einschränkungen (gesperrte Rollwege, Pistenzustand, Schliessung), erwähnst du sie sinngemäss im Briefing. Erfinde keine Einschränkungen und keine NOTAM.
- Keine Empfehlung, ob geflogen werden soll, keine Anrede, keine Sicherheitsfloskeln: Der Haftungshinweis steht bereits auf der Seite.

Sprache und Form
- Deutsch in Schweizer Rechtschreibung (ss statt ß), sachlich und knapp, in ganzen Sätzen. Fliegerische Fachbegriffe sind erwünscht (Basis, Hochnebel, Bise, Föhn, Thermik, Quellbewölkung).
- Einheiten: Wind in kt, Höhen in m ü. M., Sicht in km, Temperaturen in °C.
- briefing.headline: höchstens 60 Zeichen, das Wichtigste zuerst, zum Beispiel «Hochnebel bis 900 m, darüber sonnig» oder «Alpen frei, Basis um 1800 m».
- briefing.text: 3 bis 5 Sätze, höchstens 600 Zeichen: Einschränkungen aus dem Platzstatus (falls vorhanden) zuerst, dann Lage am Platz, Bewölkung, Basis und Sicht, Zustand der Alpen, Entwicklung der nächsten Stunden laut Prognose.
- himmel.zusammenfassung: 1 bis 2 Sätze. himmel.regionen: je Region ein kurzer Satz, nur für Regionen, zu denen ein brauchbares Bild vorliegt.
- kameras: jede gezeigte Kamera genau einmal, titel exakt wie angegeben, satz höchstens 120 Zeichen über das, was auf dem Bild zu sehen ist (nicht über die Kamera)."""

# ── Output schema (structured outputs: every object needs additionalProperties=false,
#    no min/max constraints -> ranges are enforced by enums or client-side) ─────────────
TAGS = ["sonnig", "quellwolken", "bedeckt", "tiefe_wolken", "hochnebel", "nebel", "in_wolke", "dunst",
        "niederschlag", "gewitterwolken", "foehnzeichen", "schnee", "nasse_piste", "schneebedeckte_piste",
        "flugbetrieb", "gegenlicht"]
PROBLEMS = ["keins", "nacht", "zu_dunkel", "eingefroren", "linse_nass", "verschmutzt", "fehlbild"]
REGIONS = ["platz", "zuercher_oberland", "voralpen", "glarner_alpen", "zentralalpen", "alpensuedseite"]


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


BRIEFING_SCHEMA = _obj({
    "briefing": _obj({
        "headline": {"type": "string", "description": "höchstens 60 Zeichen"},
        "text": {"type": "string", "description": "3 bis 5 Sätze, höchstens 600 Zeichen"},
        "lage": {"type": "string", "enum": ["gut", "maessig", "schlecht"],
                 "description": "Gesamteindruck von Sicht und Bewölkung für Lokalflüge"},
    }),
    "himmel": _obj({
        "bedeckung_achtel": _nullable({"type": "integer", "enum": list(range(9)),
                                       "description": "Bedeckungsgrad über dem Raum LSZK/Zürcher Oberland (nicht Alpen)"}),
        "wolkenbasis_m": _nullable({"type": "integer",
                                    "description": "Basis der tiefsten nennenswerten Schicht im Raum LSZK bis Voralpen, m ü. M."}),
        "basis_quelle": {"type": "string",
                         "enum": ["kamera", "metar", "taupunkt", "kombiniert", "keine_wolken", "unbekannt"]},
        "sicht": {"type": "string", "enum": ["gut", "maessig", "schlecht", "unbekannt"]},
        "sicht_km": _nullable({"type": "integer", "description": "geschätzte horizontale Sicht im Raum LSZK in km"}),
        "nebel": {"type": "string", "enum": ["kein", "dunst", "bodennebel", "hochnebel", "unbekannt"]},
        "nebel_obergrenze_m": _nullable({"type": "integer",
                                         "description": "Obergrenze von Hochnebel oder Nebelmeer, m ü. M."}),
        "alpen": {"type": "string", "enum": ["frei", "teilweise", "verhangen", "nicht_sichtbar"]},
        "schneegrenze_m": _nullable({"type": "integer",
                                     "description": "tiefste Höhe mit geschlossener Schneedecke an Hängen, m ü. M."}),
        "niederschlag": {"type": "string", "enum": ["kein", "in_der_ferne", "am_platz", "unbekannt"]},
        "zusammenfassung": {"type": "string"},
        "regionen": {"type": "array", "items": _obj({
            "region": {"type": "string", "enum": REGIONS},
            "zustand": {"type": "string"},
        })},
    }),
    "kameras": {"type": "array", "items": _obj({
        "titel": {"type": "string", "enum": CAM_TITLES},
        "satz": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string", "enum": TAGS}},
        "problem": {"type": "string", "enum": PROBLEMS},
    })},
})


# ── Small helpers ────────────────────────────────────────────────────────────
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="seconds")


def parse_iso(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(record: dict) -> None:
    """Atomic write: a half-written file would reset the budget and backoff state."""
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, OUT_FILE)


def clip(value, limit: int) -> str:
    s = re.sub(r"\s+", " ", str(value or "")).strip()
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def minutes_since(dt, now: datetime):
    return None if dt is None else round((now - dt).total_seconds() / 60)


def sun_times(day: date):
    """Sunrise / sunset (UTC) for LSZK, sunrise equation, accurate to ~1-2 min."""
    rad = math.pi / 180
    n = (day - date(2000, 1, 1)).days
    j_star = n - LON / 360.0
    m = (357.5291 + 0.98560028 * j_star) % 360
    c = 1.9148 * math.sin(m * rad) + 0.0200 * math.sin(2 * m * rad) + 0.0003 * math.sin(3 * m * rad)
    lam = (m + c + 180 + 102.9372) % 360
    j_transit = 2451545.0 + j_star + 0.0053 * math.sin(m * rad) - 0.0069 * math.sin(2 * lam * rad)
    sin_d = math.sin(lam * rad) * math.sin(23.4397 * rad)
    cos_d = math.cos(math.asin(sin_d))
    cos_w = (math.sin(-0.833 * rad) - math.sin(LAT * rad) * sin_d) / (math.cos(LAT * rad) * cos_d)
    w = math.acos(max(-1.0, min(1.0, cos_w))) / rad
    j2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)
    return (j2000 + timedelta(days=j_transit - w / 360 - 2451545.0),
            j2000 + timedelta(days=j_transit + w / 360 - 2451545.0))


def month_key(now: datetime) -> str:
    return now.astimezone(TZ).strftime("%Y-%m")


def day_key(now: datetime) -> str:
    return now.astimezone(TZ).strftime("%Y-%m-%d")


def run_key() -> str:
    """Identifies this workflow run, so the AI step can find the attempt the reserve step booked."""
    run_id = os.environ.get("GITHUB_RUN_ID")
    return f'{run_id}.{os.environ.get("GITHUB_RUN_ATTEMPT", "1")}' if run_id else ""


# ── Cost bookkeeping (record["stats"]) ───────────────────────────────────────
def stats_for(record: dict, now: datetime) -> dict:
    """Current month/day counters; resets them when the month or day changed."""
    st = dict(record.get("stats") or {})
    if st.get("month") != month_key(now):
        st.update(month=month_key(now), cost_month_usd=0.0, attempts_month=0)
    if st.get("date") != day_key(now):
        st.update(date=day_key(now), cost_today_usd=0.0, attempts_today=0)
    st["budget_month_usd"] = MONTHLY_BUDGET_USD
    record["stats"] = st
    return st


def book(record: dict, now: datetime, usd: float) -> None:
    st = stats_for(record, now)
    for k in ("cost_month_usd", "cost_today_usd"):
        st[k] = round(max(0.0, float(st.get(k) or 0) + usd), 4)


def reserve(record: dict, now: datetime, key: str) -> None:
    """Books the attempt BEFORE the paid call: if the step is killed or the result is lost,
    the attempt still counts (backoff, daily limit) and RESERVE_USD stays in the monthly total."""
    st = stats_for(record, now)
    st["attempts_today"] = int(st.get("attempts_today") or 0) + 1
    st["attempts_month"] = int(st.get("attempts_month") or 0) + 1
    st["reserved_usd"] = RESERVE_USD
    book(record, now, RESERVE_USD)
    record.update(schema_version=1, ok=False, attempted_at_utc=iso(now), reserved_run=key,
                  fail_streak=int(record.get("fail_streak") or 0) + 1,
                  error="Versuch läuft oder wurde abgebrochen (kein Ergebnis gespeichert)")


def settle(record: dict, now: datetime, cost) -> None:
    """Replaces the reservation by the real cost; cost=None keeps the reservation as the estimate."""
    st = stats_for(record, now)
    reserved = float(st.get("reserved_usd") or 0)
    st["reserved_usd"] = 0.0
    if cost is not None:
        book(record, now, cost - reserved)


# ── What is due? (stdlib only - also used by --check) ────────────────────────
def briefing_due(prev: dict, now: datetime):
    rise, sset = sun_times(now.astimezone(TZ).date())
    margin = timedelta(minutes=DAYLIGHT_MARGIN_MIN)
    if not (rise - margin <= now <= sset + margin):
        return False, "night"
    st = prev.get("stats") or {}
    if st.get("month") == month_key(now) and float(st.get("cost_month_usd") or 0) >= MONTHLY_BUDGET_USD:
        return False, "monthly budget reached"
    if st.get("date") == day_key(now) and int(st.get("attempts_today") or 0) >= MAX_ATTEMPTS_PER_DAY:
        return False, "daily attempt limit reached"
    last_ok = parse_iso(prev.get("generated_at_utc"))
    last_try = parse_iso(prev.get("attempted_at_utc"))
    if prev.get("ok") is False and last_try and (last_ok is None or last_try > last_ok):
        streak = max(1, int(prev.get("fail_streak") or 1))
        wait = RETRY_MIN * 2 ** min(streak - 1, 3)
        if now - last_try < timedelta(minutes=wait):
            return False, f"waiting {wait} min after failed attempt"
        return True, "retry after failure"
    if last_ok and now - last_ok < timedelta(minutes=BRIEFING_EVERY_MIN):
        return False, "briefing still fresh"
    return True, "due"


# ── Inputs for the briefing ──────────────────────────────────────────────────
def resolve_cams(page: str) -> dict:
    """title -> {"src": raw data-src (key of cam-status.json), "url": usable URL}
    or {"cam": LSPV cam name from data-cam}."""
    found = {}
    for chunk in page.split('class="cam-card"')[1:]:
        m_title = re.search(r'class="cam-header">\s*<a[^>]*>([^<]+)</a>', chunk)
        if not m_title:
            continue
        title = html.unescape(m_title.group(1)).strip()
        m_src = re.search(r'data-src="(https://wsrv\.nl/\?url=[^"]+)"', chunk)
        m_cam = re.search(r'data-cam="([^"]+)"', chunk)
        if m_src:
            found[title] = {"src": m_src.group(1), "url": html.unescape(m_src.group(1))}
        elif m_cam:
            found[title] = {"cam": html.unescape(m_cam.group(1))}
    return found


def fetch_image(session, url: str) -> bytes:
    r = session.get(url, timeout=20, headers={"User-Agent": UA})
    ctype = r.headers.get("Content-Type", "")
    if r.status_code != 200 or not ctype.startswith("image/"):
        raise RuntimeError(f"HTTP {r.status_code} ({ctype or 'kein Typ'})")
    if len(r.content) < 3000:
        raise RuntimeError(f"Bild zu klein ({len(r.content)} Bytes)")
    return r.content


def wsrv_url(origin: str, params: str, bust=None) -> str:
    """Resize URL for wsrv.nl. A fixed-name origin needs the cache-buster INSIDE the url
    parameter: wsrv/Cloudflare keep identical source URLs for up to a year."""
    if bust is not None:
        origin = f"{origin}{'&' if '?' in origin else '?'}v={bust}"
    return f"https://wsrv.nl/?url={quote(origin, safe='')}&{params}&output=jpg&q=80"


def age_text(age) -> str:
    if age is None:
        return "unbekannt"
    if age >= 2880:
        return f"{age // 1440} Tage"
    return f"{age // 60} h {age % 60} min" if age >= 120 else f"{age} min"


def fetch_cam(session, cam: dict, ref: dict, cam_status: dict, now: datetime):
    """Returns (jpeg bytes, age in minutes or None, key of the dashboard card).
    Raises when the image is missing or older than MAX_IMAGE_AGE_MIN (frozen cam)."""
    params = cam["wsrv"]
    if "src" in ref:
        entry = cam_status.get(ref["src"]) or {}
        changed = entry.get("lastChange")
        age = None
        if isinstance(changed, (int, float)):
            age = minutes_since(datetime.fromtimestamp(changed / 1000, tz=timezone.utc), now)
        if age is not None and age > MAX_IMAGE_AGE_MIN:
            raise RuntimeError(f"Bild seit {age_text(age)} unverändert (Kamera eingefroren?)")
        origin = unquote(ref["url"].split("?url=", 1)[1].split("&", 1)[0])
        return fetch_image(session, wsrv_url(origin, params, int(now.timestamp()))), age, ref["url"]

    # LSPV Wangen-Lachen: the server's index names the newest file (Swiss local time,
    # irregular minutes). wsrv needs the explicit https:// for this host.
    r = session.get(LSPV_INDEX, timeout=10, headers={"User-Agent": UA})
    r.raise_for_status()
    entry = next((e for e in r.json() if isinstance(e, dict) and e.get("camid") == ref["cam"]), None)
    path = (entry or {}).get("imagesrc") or ""
    m = re.search(r"/(\d{10})\.jpg$", path)
    if not m:
        raise RuntimeError("kein aktuelles Bild im LSPV-Index")
    taken = datetime.strptime(m.group(1), "%y%m%d%H%M").replace(tzinfo=TZ)
    age = minutes_since(taken, now)
    if age > MAX_IMAGE_AGE_MIN:
        raise RuntimeError(f"neuestes LSPV-Bild ist {age_text(age)} alt")
    img = fetch_image(session, wsrv_url("https://cams.lspv.dyndns.info" + path, params))
    return img, age, ref["cam"]


GERMAN_STATION = [
    ("Temp", "Temperatur"), ("Dew Point", "Taupunkt"), ("Hum", "Feuchte"),
    ("Wind Direction", "Windrichtung °"), ("10 Min Avg Wind Speed", "Wind 10-min-Mittel"),
    ("10 Min High Wind Speed", "Böe 10 min"), ("Barometer", "Luftdruck Station"), ("Bar Trend", "Drucktendenz"),
    ("Rain Rate", "Regenrate"), ("60 Min Rain Total", "Regen 60 min"),
]


def station_text(station, now: datetime) -> str:
    if not station:
        return "Wetterstation am Platz: keine Daten."
    vals = {}
    for v in ((station.get("summary") or {}).get("currConditionValues") or []):
        name, val = v.get("sensorDataName"), v.get("convertedValue")
        if name and val not in (None, "", "--"):
            vals[name] = f'{val} {html.unescape(v.get("unitLabel") or "")}'.strip()
    parts = [f"{de}: {vals[en]}" for en, de in GERMAN_STATION if en in vals]
    received = (station.get("current") or {}).get("lastReceived")
    age = None
    if isinstance(received, (int, float)):
        age = minutes_since(datetime.fromtimestamp(received / 1000, tz=timezone.utc), now)
    stale = " (VERALTET)" if age is not None and age >= 30 else ""
    when = f"Stand vor {age} min{stale}" if age is not None else "Stand unbekannt"
    return f"Wetterstation am Platz (Speck, 536 m), {when}: " + ("; ".join(parts) or "keine Werte")


def metar_text(metar, now: datetime) -> str:
    m = metar[0] if isinstance(metar, list) and metar else None
    if not isinstance(m, dict) or not m.get("rawOb"):
        return "METAR Dübendorf (LSMD): nicht verfügbar."
    age = ""
    if isinstance(m.get("obsTime"), (int, float)):
        age = f", Beobachtung vor {minutes_since(datetime.fromtimestamp(m['obsTime'], tz=timezone.utc), now)} min"
    return f"METAR Dübendorf LSMD (436 m, 10 km westlich){age}: {m['rawOb']}"


def last_qnh(session, station: str):
    url = f"https://data.geo.admin.ch/ch.meteoschweiz.ogd-smn/{station}/ogd-smn_{station}_t_now.csv"
    r = session.get(url, timeout=20, headers={"User-Agent": UA})
    r.raise_for_status()
    lines = r.text.strip().splitlines()
    idx = lines[0].split(";").index("pp0qnhs0")
    for line in reversed(lines[1:]):
        cells = line.split(";")
        try:
            v = float(cells[idx])
        except (IndexError, ValueError):
            continue
        if 900 < v < 1100:
            return v
    return None


def foehn_text(session) -> str:
    try:
        lug, sma = last_qnh(session, "lug"), last_qnh(session, "sma")
    except Exception as e:  # noqa: BLE001
        return f"Föhn-Index: nicht verfügbar ({type(e).__name__})."
    if lug is None or sma is None:
        return "Föhn-Index: nicht verfügbar."
    return (f"Föhn-Index QNH Lugano minus QNH Zürich-Fluntern: {lug - sma:+.1f} hPa "
            f"(Lugano {lug:.1f} hPa, Zürich {sma:.1f} hPa).")


def fgzo_text(fgzo) -> str:
    if not fgzo or not fgzo.get("updated"):
        return "Platzstatus FGZO: nicht verfügbar."
    parts = [f'Platzstatus FGZO (fgzo.ch, aktualisiert {fgzo.get("updated")}): {fgzo.get("status") or "?"}',
             f'Ampel {fgzo.get("ampel") or "?"}']
    if fgzo.get("closing"):
        parts.append(f'Betriebsschluss {fgzo["closing"]} LT')
    if fgzo.get("traffic"):
        parts.append(fgzo["traffic"])
    text = ", ".join(parts) + "."
    if fgzo.get("notice"):
        text += " Hinweistext: " + fgzo["notice"].replace("\n\n", " / ").replace("\n", " / ")
    if fgzo.get("ok") is False:
        text += " (Letzter Abruf fehlgeschlagen, Stand evtl. veraltet.)"
    return text


OM_URL = ("https://api.open-meteo.com/v1/forecast?latitude=47.37556&longitude=8.76168"
          "&hourly=temperature_2m,dew_point_2m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,"
          "visibility,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,"
          "cape,freezing_level_height,wind_speed_850hPa,wind_direction_850hPa,wind_speed_700hPa,"
          "wind_direction_700hPa,temperature_850hPa,temperature_700hPa"
          "&forecast_hours=12&wind_speed_unit=kn&timezone=Europe%2FZurich")


def forecast_text(session) -> str:
    try:
        r = session.get(OM_URL, timeout=20, headers={"User-Agent": UA})
        r.raise_for_status()
        h = r.json()["hourly"]
    except Exception as e:  # noqa: BLE001
        return f"Prognose Open-Meteo: nicht verfügbar ({type(e).__name__})."

    def raw(key, i):
        try:
            return h[key][i]
        except (KeyError, IndexError, TypeError):
            return None

    def g(key, i, fmt="{:.0f}"):
        v = raw(key, i)
        return "–" if not isinstance(v, (int, float)) else fmt.format(v)

    rows = ["Zeit | T/Td °C | Wolken gesamt/tief/mittel/hoch % | Sicht km | Regen mm (Wahrsch. %) | "
            "Wind 10 m °/kt, Böen kt | Wind 850 hPa °/kt | Wind 700 hPa °/kt | T850/T700 °C | Nullgrad m | CAPE"]
    for i, t in enumerate(h.get("time") or []):
        vis = raw("visibility", i)
        rows.append(" | ".join([
            str(t)[11:16],
            f'{g("temperature_2m", i, "{:.1f}")}/{g("dew_point_2m", i, "{:.1f}")}',
            "/".join(g(k, i) for k in ("cloud_cover", "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high")),
            f"{vis / 1000:.0f}" if isinstance(vis, (int, float)) else "–",
            f'{g("precipitation", i, "{:.1f}")} ({g("precipitation_probability", i)})',
            f'{g("wind_direction_10m", i)}/{g("wind_speed_10m", i)}, {g("wind_gusts_10m", i)}',
            f'{g("wind_direction_850hPa", i)}/{g("wind_speed_850hPa", i)}',
            f'{g("wind_direction_700hPa", i)}/{g("wind_speed_700hPa", i)}',
            f'{g("temperature_850hPa", i, "{:.1f}")}/{g("temperature_700hPa", i, "{:.1f}")}',
            g("freezing_level_height", i),
            g("cape", i),
        ]))
    return "Prognose Open-Meteo für LSZK, nächste 12 Stunden (Lokalzeit):\n" + "\n".join(rows)


# ── Claude call ──────────────────────────────────────────────────────────────
class BilledError(RuntimeError):
    """The request ran (and is billed) but gave no usable result; carries the usage."""

    def __init__(self, message: str, usage: dict):
        super().__init__(message)
        self.usage = usage


def usage_dict(usage, served_by) -> dict:
    """Token counts and cost. With a refusal fallback, usage.iterations lists every attempt
    with its own model; each is priced at that model's rate."""
    keys = ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")

    def n(obj, name):
        v = getattr(obj, name, None)
        return int(v) if isinstance(v, (int, float)) else 0

    parts = list(getattr(usage, "iterations", None) or []) or [usage]
    totals = dict.fromkeys(keys, 0)
    cost = 0.0
    for p in parts:
        model = str(getattr(p, "model", None) or (MODEL if getattr(p, "type", "") == "message" else served_by))
        p_in, p_out, p_cw, p_cr = PRICE_OPUS_5_5 if model.startswith(MODEL) else PRICE_OTHER
        t = {k: n(p, k) for k in keys}
        for k in keys:
            totals[k] += t[k]
        cost += (t["input_tokens"] * p_in + t["output_tokens"] * p_out
                 + t["cache_creation_input_tokens"] * p_cw + t["cache_read_input_tokens"] * p_cr) / 1e6
    totals["attempts"] = len(parts)
    totals["cost_usd"] = round(cost, 4)
    return totals


def _final_message(manager):
    """Streams the response to the end. The read timeout then applies between events, and the
    SDK only retries failures before the stream opens (never a generation already running)."""
    with manager as stream:
        return stream.get_final_message(), getattr(stream, "request_id", None)


def call_claude(client, anthropic, content: list):
    """One streamed structured-output request with server-side refusal fallbacks; if the API
    rejects that opt-in, the request is repeated once without it."""
    params = dict(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_BRIEFING,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": BRIEFING_EFFORT,
                       "format": {"type": "json_schema", "schema": BRIEFING_SCHEMA}},
    )
    try:
        resp, req_id = _final_message(client.beta.messages.stream(betas=[FALLBACK_BETA], fallbacks="default", **params))
    except anthropic.BadRequestError as e:
        if "fallback" not in str(e).lower():
            raise
        resp, req_id = _final_message(client.messages.stream(**params))
    served_by = str(getattr(resp, "model", None) or MODEL)
    usage = usage_dict(resp.usage, served_by)
    if resp.stop_reason == "refusal":
        details = getattr(resp, "stop_details", None)
        raise BilledError(f"Anfrage abgelehnt (Kategorie {getattr(details, 'category', None)})", usage)
    if resp.stop_reason == "max_tokens":
        raise BilledError(f"Antwort abgeschnitten (max_tokens {MAX_TOKENS})", usage)
    # all text blocks: after a mid-stream fallback the substitute model continues the text
    text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text")
    try:
        data = json.loads(text)
    except ValueError as e:
        raise BilledError(f"keine gültige JSON-Antwort ({e})", usage) from None
    if not isinstance(data, dict):
        raise BilledError("JSON-Antwort ist kein Objekt", usage)
    return data, usage, served_by, req_id


def failed(record: dict) -> bool:
    print(f'briefing FAILED: {record["error"]} (month {record["stats"]["cost_month_usd"]} USD)', file=sys.stderr)
    return False


def run_briefing(client, anthropic, record: dict, now: datetime) -> bool:
    """Collects the inputs, calls Claude and fills the record. The attempt must already be
    reserved (reserve()); this settles the reservation in every outcome."""
    import requests  # installed by the workflow

    session = requests.Session()
    local = now.astimezone(TZ)
    rise, sset = sun_times(local.date())
    record["sun"] = {"rise": rise.astimezone(TZ).strftime("%H:%M"), "set": sset.astimezone(TZ).strftime("%H:%M")}

    context = "\n\n".join([
        f"Zeitpunkt: {local:%d.%m.%Y %H:%M} Lokalzeit (Europe/Zurich). "
        f'Sonnenaufgang {record["sun"]["rise"]}, Sonnenuntergang {record["sun"]["set"]}.',
        station_text(load_json(STATION_FILE), now),
        metar_text(load_json(METAR_FILE), now),
        foehn_text(session),
        fgzo_text(load_json(FGZO_FILE)),
        forecast_text(session),
    ])

    try:
        page = HTML_FILE.read_text(encoding="utf-8")
    except OSError as e:
        page = ""
        print(f"index.html not readable: {e}", file=sys.stderr)
    refs = resolve_cams(page)
    cam_status = load_json(CAM_STATUS_FILE) or {}

    content = [{"type": "text", "text": "Messwerte, Platzstatus und Prognose:\n\n" + context}]
    used, missing = [], []
    for cam in CAMS:
        ref = refs.get(cam["title"])
        if not ref:
            missing.append({"titel": cam["title"], "grund": "nicht in index.html gefunden"})
            continue
        try:
            img, age, key = fetch_cam(session, cam, ref, cam_status, now)
        except Exception as e:  # noqa: BLE001
            missing.append({"titel": cam["title"], "grund": clip(e, 160)})
            continue
        content.append({"type": "text", "text": (
            f'Kamera {len(used) + 1}: {cam["title"]} (Region: {cam["region"]})\n{cam["desc"]}\n'
            f"Bildalter: {age_text(age)}")})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                    "data": base64.standard_b64encode(img).decode("ascii")}})
        used.append({"titel": cam["title"], "key": key, "bildalter_min": age})
    content.append({"type": "text", "text": (
        "Erstelle jetzt die Auswertung im vorgegebenen Schema. Führe unter kameras jede der "
        f"{len(used)} gezeigten Kameras genau einmal auf, titel exakt wie angegeben.")})
    record["inputs"] = {"kameras": [u["titel"] for u in used], "fehlend": missing}

    if len(used) < MIN_IMAGES:
        settle(record, now, 0.0)  # nothing was sent
        record.update(ok=False, error=f"nur {len(used)} Kamerabilder verfügbar (mindestens {MIN_IMAGES} nötig)")
        print(record["error"], file=sys.stderr)
        return False

    try:
        data, usage, served_by, req_id = call_claude(client, anthropic, content)
    except BilledError as e:  # answered but unusable: book the reported cost
        settle(record, now, e.usage["cost_usd"])
        record.update(ok=False, error=str(e)[:300], usage=e.usage)
        return failed(record)
    except anthropic.APIStatusError as e:
        # A real HTTP 4xx before the stream opened is not billed. 5xx, and error events inside an
        # open stream (these arrive with status 200, e.g. overloaded_error): outcome unknown -> keep the estimate
        settle(record, now, 0.0 if 400 <= e.status_code < 500 else None)
        record.update(ok=False, error=f"{type(e).__name__} {e.status_code} {getattr(e, 'type', None)}: {e}"[:300])
        return failed(record)
    except Exception as e:  # noqa: BLE001 - timeout / broken stream: outcome unknown, keep the estimate
        settle(record, now, None)
        record.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
        return failed(record)

    settle(record, now, usage["cost_usd"])
    b, sky = data.get("briefing") or {}, data.get("himmel") or {}
    by_title = {u["titel"]: u for u in used}
    cams_out, seen = [], set()
    for k in data.get("kameras") or []:
        t = k.get("titel")
        if t not in by_title or t in seen:
            continue
        seen.add(t)
        cams_out.append({**by_title[t], "satz": clip(k.get("satz"), 160),
                         "tags": [x for x in (k.get("tags") or []) if x in TAGS],
                         "problem": k.get("problem") if k.get("problem") in PROBLEMS else "keins"})

    def int_or_none(v, lo, hi):
        return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else None

    record.update(
        ok=True, error=None, fail_streak=0, generated_at_utc=iso(now), model=MODEL, served_by=served_by,
        effort=BRIEFING_EFFORT, request_id=req_id, usage=usage,
        briefing={"headline": clip(b.get("headline"), 80), "text": clip(b.get("text"), 900),
                  "lage": b.get("lage") if b.get("lage") in ("gut", "maessig", "schlecht") else None},
        himmel={
            "bedeckung_achtel": int_or_none(sky.get("bedeckung_achtel"), 0, 8),
            "wolkenbasis_m": int_or_none(sky.get("wolkenbasis_m"), 300, 9000),
            "basis_quelle": sky.get("basis_quelle"),
            "sicht": sky.get("sicht"),
            "sicht_km": int_or_none(sky.get("sicht_km"), 0, 200),
            "nebel": sky.get("nebel"),
            "nebel_obergrenze_m": int_or_none(sky.get("nebel_obergrenze_m"), 300, 4000),
            "alpen": sky.get("alpen"),
            "schneegrenze_m": int_or_none(sky.get("schneegrenze_m"), 200, 4500),
            "niederschlag": sky.get("niederschlag"),
            "zusammenfassung": clip(sky.get("zusammenfassung"), 400),
            "regionen": [{"region": r.get("region"), "zustand": clip(r.get("zustand"), 200)}
                         for r in (sky.get("regionen") or []) if r.get("region") in REGIONS],
        },
        kameras=cams_out,
    )
    print(f'briefing OK: "{record["briefing"]["headline"]}" - {len(used)} images, '
          f'{usage["input_tokens"]} in / {usage["output_tokens"]} out tokens, {usage["cost_usd"]} USD, '
          f'month {record["stats"]["cost_month_usd"]} USD')
    return True


def main(argv) -> int:
    now = now_utc()
    prev = load_json(OUT_FILE)
    if prev is None and OUT_FILE.exists():
        # unreadable state file: never start paid calls with reset counters
        print("due=false" if "--check" in argv else f"{OUT_FILE.name} unreadable - no call")
        return 0 if "--check" in argv else 1
    prev = prev or {}
    record = dict(prev)
    key = run_key()

    if "--check" in argv:
        due, reason = briefing_due(prev, now)
        print(f"due={'true' if due else 'false'}")
        print(f"briefing: {reason}", file=sys.stderr)
        return 0

    if "--reserve" in argv:
        reserve(record, now, key)
        write_json(record)
        print(f"attempt reserved (run {key or 'local'}), {RESERVE_USD} USD booked provisionally")
        return 0

    if not (key and prev.get("reserved_run") == key):
        # no reserve step in this run (e.g. started by hand): check and reserve here
        due, reason = briefing_due(prev, now)
        if not due:
            print(f"nothing due ({reason})")
            return 0
        reserve(record, now, key)
        write_json(record)

    try:
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY ist nicht gesetzt (Repo-Secret fehlt?)")
        import anthropic
        client = anthropic.Anthropic(timeout=anthropic.Timeout(300.0, connect=15.0), max_retries=2)
    except Exception as e:  # noqa: BLE001 - e.g. missing package or API key; nothing was sent
        settle(record, now, 0.0)
        record.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
        write_json(record)
        return failed(record) or 1

    ok = run_briefing(client, anthropic, record, now)
    write_json(record)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
