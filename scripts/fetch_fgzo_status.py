#!/usr/bin/env python3
"""Fetch the FGZO airfield status (fgzo.ch/status/) and write data/fgzo_status.json.

The status page is a small server-rendered HTML page with stable ids/classes:
    <body class="open|open-restricted|closed">
    <h1>OPEN</h1>  <span class="trafficBtn lowTraffic|highTraffic">LOW TRAFFIC</span>
    <div id="contact">Kontakt: ...</div>  <h2 id="closing-hour">Betriebsschluss: 18:46 Uhr</h2>
    <main> fixed sentence + free text (runway condition, closures) </main>
    <div id="runway-date">Aktualisiert am 11.10.2026, 07:36 Uhr</div>

Output schema (data/fgzo_status.json):
    {
        "ok": true,                      # last fetch succeeded
        "fetched_at_utc": "...",         # time of the last SUCCESSFUL fetch
        "failed_at_utc": null,           # time of the last failed fetch (if ok == false)
        "error": null,
        "source": "https://fgzo.ch/status/",
        "ampel": "gelb",                 # gruen | gelb | rot | null  (FGZO's own traffic light)
        "status": "OPEN",                # OPEN | CLOSED | ...
        "traffic": "LOW TRAFFIC",        # LOW TRAFFIC | HIGH TRAFFIC | null
        "closing": "18:46",              # local time, null if none
        "notice": "...",                 # free text, newline separated, fixed intro sentence removed
        "runway_line": "Runway condition LSZK / 11.10.2026 / 0700 LT / SLIPPERY WET",
        "runway_condition": "SLIPPERY WET",
        "contact": "Kontakt: ...",
        "updated": "11.10.2026, 07:36"   # FGZO's own timestamp
    }

On failure (HTTP error, timeout, bot-challenge page, unexpected markup) the previous
content is kept and only ok/failed_at_utc/error are updated, so the dashboard can
show the last known state together with a warning.
"""
import html
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "fgzo_status.json"
URL = "https://fgzo.ch/status/"
UA = "LSZK-Webcams-Dashboard/1.0 (+https://strohmeierh.github.io/LSZK-Webcams/)"

AMPEL = {"open": "gruen", "open-restricted": "gelb", "closed": "rot"}

# Fixed intro sentence(s) that precede the actual notice. Summer wording ends with
# "eingetragen sind.", the winter wording has "markieren die Piste!" followed by the
# same hangar sentence -- try the long form first, then the short one.
INTRO_RES = [
    re.compile(r"Leuchtorange Pistenf[^\n]*?eingetragen sind\.\s*", re.IGNORECASE),
    re.compile(r"Leuchtorange Pistenf[^\n]*?markieren die Piste!\s*", re.IGNORECASE),
    # hangar sentence on its own line (if FGZO ever inserts a <br> after "Piste!")
    re.compile(r"^Flieger nach dem Flug hangarieren[^\n]*?eingetragen sind\.\s*", re.IGNORECASE | re.MULTILINE),
]

DATA_KEYS = ("ampel", "status", "traffic", "closing", "notice",
             "runway_line", "runway_condition", "contact", "updated")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_html() -> str:
    req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def text_of(fragment) -> str:
    """Strip tags, decode entities, normalise whitespace (single line). None-safe."""
    if not fragment:
        return ""
    t = re.sub(r"<[^>]+>", " ", fragment)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def multiline_text(fragment) -> str:
    """Like text_of but keeps <br>/<p> as line breaks (raw source newlines are
    plain whitespace, as in HTML)."""
    if not fragment:
        return ""
    t = re.sub(r"[\r\n]+", " ", fragment)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.IGNORECASE)
    t = re.sub(r"</p\s*>", "\n", t, flags=re.IGNORECASE)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in t.split("\n")]
    out = []
    for ln in lines:
        if ln == "" and (not out or out[-1] == ""):
            continue  # collapse blank runs
        out.append(ln)
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def first(pattern: str, src: str, flags=0):
    m = re.search(pattern, src, flags)
    return m.group(1) if m else None


def parse(src: str) -> dict:
    if re.search(r"<title>\s*One moment", src, re.IGNORECASE) or "wsidchk" in src:
        raise ValueError("bot challenge page received")

    body_cls = first(r'<body[^>]*class="([^"]*)"', src, re.IGNORECASE)
    updated_raw = first(r'<div id="runway-date">(.*?)</div>', src, re.IGNORECASE | re.DOTALL)
    if body_cls is None or updated_raw is None:
        raise ValueError("unexpected markup (body class / #runway-date missing)")

    ampel = None
    for cls in body_cls.split():
        if cls in AMPEL:
            ampel = AMPEL[cls]

    status = first(r"<h1>(.*?)</h1>", src, re.IGNORECASE | re.DOTALL)
    traffic = first(r'<span class="trafficBtn[^"]*">(.*?)</span>', src, re.IGNORECASE | re.DOTALL)
    contact = first(r'<div id="contact">(.*?)</div>', src, re.IGNORECASE | re.DOTALL)
    closing_raw = first(r'<h2 id="closing-hour">(.*?)</h2>', src, re.IGNORECASE | re.DOTALL)
    main_raw = first(r"<main>(.*?)</main>", src, re.IGNORECASE | re.DOTALL)

    closing = first(r"(\d{1,2}:\d{2})", text_of(closing_raw)) or None
    upd = re.search(r"(\d{1,2}\.\d{1,2}\.\d{4}),?\s*(\d{1,2}:\d{2})", text_of(updated_raw))
    updated = f"{upd.group(1)}, {upd.group(2)}" if upd else text_of(updated_raw) or None

    notice = multiline_text(main_raw)
    for intro_re in INTRO_RES:
        notice = intro_re.sub("", notice, count=1)
    notice = notice.strip()

    runway_line = None
    runway_condition = None
    for ln in notice.split("\n"):
        if re.search(r"runway\s*condition", ln, re.IGNORECASE):
            runway_line = ln.strip()
            if "/" in runway_line:
                tail = runway_line.rsplit("/", 1)[1].strip()
                runway_condition = tail or None
            break

    return {
        "ampel": ampel,
        "status": text_of(status) or None,
        "traffic": text_of(traffic) or None,
        "closing": closing,
        "notice": notice,
        "runway_line": runway_line,
        "runway_condition": runway_condition,
        "contact": text_of(contact) or None,
        "updated": updated,
    }


def load_previous() -> dict:
    try:
        return json.loads(OUT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write(record: dict) -> None:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    prev = load_previous()
    try:
        data = parse(fetch_html())
    except Exception as e:  # noqa: BLE001 - any failure must end up in the JSON, never a traceback
        record = dict(prev)
        record.update({
            "ok": False,
            "failed_at_utc": now_iso(),
            "error": f"{type(e).__name__}: {e}"[:200],
            "source": URL,
        })
        record.setdefault("fetched_at_utc", None)
        for key in DATA_KEYS:
            record.setdefault(key, None)
        write(record)
        print(f"FAILED — {e} (previous content kept)", file=sys.stderr)
        return 1

    record = {
        "ok": True,
        "fetched_at_utc": now_iso(),
        "failed_at_utc": None,
        "error": None,
        "source": URL,
    }
    record.update(data)
    write(record)
    print(
        f"OK — {data['ampel']} / {data['status']} / {data['traffic']} / "
        f"RWY {data['runway_condition']} / updated {data['updated']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
