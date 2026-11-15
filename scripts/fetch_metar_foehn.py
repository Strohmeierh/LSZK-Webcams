#!/usr/bin/env python3
"""Latest METAR of Lugano-Agno (LSZA) and Zürich-Kloten (LSZH) for the Föhn index.

Writes data/metar_foehn.json, read by the dashboard (Föhn chip and tile) and by the AI briefing:

    {"schema_version": 1,
     "sued": {"icao": "LSZA", "obs_utc": "2026-11-15T08:20:00+00:00", "qnh": 1021,
              "raw": "METAR LSZA 150820Z ...", "source": "aviationweather.gov"},
     "nord": {"icao": "LSZH", ...},
     "index_hpa": 6}

Föhn index = QNH LSZA minus QNH LSZH in whole hPa, as reported in the METAR Q group;
positive = south föhn, negative = north (bise). index_hpa is null unless both observations
exist and are at most MAX_PAIR_GAP_MIN apart.

The file carries no fetch timestamp, so it only changes when a new METAR arrives. A station
that cannot be fetched keeps its previous entry; the consumers enforce a maximum age.
Always exits 0: the LSMD METAR and the commit must not depend on this step.
Standard library only (runs on the plain runner Python).
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "metar_foehn.json"
STATIONS = (("sued", "LSZA"), ("nord", "LSZH"))
API = "https://aviationweather.gov/api/data/metar?ids=LSZH,LSZA&format=json&hours=3"
TGFTP = "https://tgftp.nws.noaa.gov/data/observations/metar/stations/{}.TXT"
UA = "Mozilla/5.0 (compatible; LSZK-Dashboard/1.0)"
MAX_PAIR_GAP_MIN = 45
Q_RE = re.compile(r"\bQ(\d{4})\b")


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def qnh_of(raw, altim=None):
    """QNH in whole hPa from the Q group, else from the API field altim; None if implausible."""
    m = Q_RE.search(raw or "")
    v = int(m.group(1)) if m else None
    if v is None and isinstance(altim, (int, float)) and not isinstance(altim, bool):
        v = int(round(altim))
    return v if v is not None and 900 < v < 1100 else None


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(value):
    try:
        dt = datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def from_api() -> dict:
    """Newest usable METAR per station from aviationweather.gov: {icao: entry}."""
    data = json.loads(http_get(API))
    best = {}
    for m in data if isinstance(data, list) else []:
        if not isinstance(m, dict):
            continue
        icao, t = m.get("icaoId"), m.get("obsTime")
        if icao not in ("LSZA", "LSZH") or not isinstance(t, (int, float)) or isinstance(t, bool):
            continue
        raw = str(m.get("rawOb") or "").strip()
        q = qnh_of(raw, m.get("altim"))
        if q is None:
            continue
        if icao not in best or t > best[icao][0]:
            best[icao] = (t, {"icao": icao, "obs_utc": iso(datetime.fromtimestamp(t, timezone.utc)),
                              "qnh": q, "raw": raw, "source": "aviationweather.gov"})
    return {icao: entry for icao, (_, entry) in best.items()}


def from_tgftp(icao: str):
    """Fallback: NOAA text file, line 1 'YYYY/MM/DD HH:MM' (UTC), line 2 the METAR."""
    lines = [ln.strip() for ln in http_get(TGFTP.format(icao)).splitlines() if ln.strip()]
    if len(lines) < 2 or icao not in lines[1]:
        return None
    obs = datetime.strptime(lines[0], "%Y/%m/%d %H:%M").replace(tzinfo=timezone.utc)
    q = qnh_of(lines[1])
    if q is None:
        return None
    return {"icao": icao, "obs_utc": iso(obs), "qnh": q, "raw": lines[1], "source": "tgftp.nws.noaa.gov"}


def valid_entry(entry, icao: str) -> bool:
    return (isinstance(entry, dict) and entry.get("icao") == icao
            and isinstance(entry.get("qnh"), int) and not isinstance(entry.get("qnh"), bool)
            and 900 < entry["qnh"] < 1100 and parse_iso(entry.get("obs_utc")) is not None)


def load_prev() -> dict:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return d if isinstance(d, dict) else {}


def main() -> int:
    prev = load_prev()
    try:
        latest = from_api()
    except Exception as e:  # noqa: BLE001 - any failure here just means: try the fallback
        print(f"aviationweather.gov failed: {type(e).__name__}: {e}", file=sys.stderr)
        latest = {}

    out = {"schema_version": 1}
    for side, icao in STATIONS:
        entry = latest.get(icao)
        if entry is None:
            try:
                entry = from_tgftp(icao)
            except Exception as e:  # noqa: BLE001
                print(f"tgftp {icao} failed: {type(e).__name__}: {e}", file=sys.stderr)
                entry = None
        old = prev.get(side) if valid_entry(prev.get(side), icao) else None
        if entry is None:
            print(f"{icao}: no METAR fetched, keeping {'the previous entry' if old else 'nothing'}",
                  file=sys.stderr)
            entry = old
        elif old and parse_iso(old["obs_utc"]) > parse_iso(entry["obs_utc"]):
            entry = old  # never step back to an older observation
        out[side] = entry

    out["index_hpa"] = None
    s, n = out["sued"], out["nord"]
    if s and n:
        gap = abs((parse_iso(s["obs_utc"]) - parse_iso(n["obs_utc"])).total_seconds())
        if gap <= MAX_PAIR_GAP_MIN * 60:
            out["index_hpa"] = s["qnh"] - n["qnh"]

    text = json.dumps(out, ensure_ascii=False, indent=1) + "\n"
    try:
        same = OUT.read_text(encoding="utf-8") == text
    except (OSError, ValueError):
        same = False
    if same:
        print(f"unchanged (index {out['index_hpa']})")
    else:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(text, encoding="utf-8")
        print(f"written: index {out['index_hpa']} hPa "
              f"(LSZA {s and s['qnh']} @ {s and s['obs_utc']}, LSZH {n and n['qnh']} @ {n and n['obs_utc']})")
    return 0


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - never fail the METAR job
        print(f"unexpected: {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(0)
