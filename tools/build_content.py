"""Build the content feed: YAML -> content.json, Thai audio, manifest.json.

Usage: python tools/build_content.py            (on the PC: makes missing audio, builds site/)
       python tools/build_content.py --check    (in GitHub Actions: no audio generation, fails if any is missing)

Microsoft blocks edge-tts from GitHub's servers, so audio is generated on the PC
and committed in audio/. Each file is generated once per phrase text + voice;
audio/index.json remembers what each file was made from.
"""
import asyncio
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
AUDIO = ROOT / "audio"
SITE = ROOT / "site"
VOICES = {"m": "th-TH-NiwatNeural", "f": "th-TH-PremwadeeNeural"}
KINDS = {"say", "hear", "word"}
LEVELS = {"avoid", "care", "ok"}

# Prices for the ear trainer: common amounts, each spoken "<number> baht" by a shop voice.
PRICES = sorted(set(
    list(range(1, 21))
    + list(range(25, 101, 5))
    + [21, 23, 27, 32, 38, 41, 46, 53, 59, 64, 69, 72, 78, 89, 94, 99]
    + list(range(110, 301, 10))
    + list(range(350, 1001, 50))
    + [125, 129, 149, 159, 199, 249, 299, 399, 499, 599, 799, 999]
    + [1200, 1500, 2000, 2500, 3000, 5000]
))

D = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"]
PLACE = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"]


def thai_number(n: int) -> str:
    if n == 0:
        return "ศูนย์"
    s, out = str(n), []
    for i, ch in enumerate(s):
        d, pos = int(ch), len(s) - 1 - i
        if d == 0:
            continue
        if pos == 1:
            out.append("สิบ" if d == 1 else "ยี่สิบ" if d == 2 else D[d] + "สิบ")
        elif pos == 0:
            out.append("เอ็ด" if d == 1 and len(s) > 1 else D[d])
        else:
            out.append(D[d] + PLACE[pos])
    return "".join(out)


def sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def fail(msg):
    sys.exit(f"Content error: {msg}")


def read(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load():
    situations = read(CONTENT / "situations.yaml")
    sit_ids = {s["id"] for s in situations}
    phrases, speak, seen = [], [], set()

    def add(item, where, default_voice):
        for key in ("id", "th", "rom", "en"):
            if not item.get(key):
                fail(f"{where}: item missing '{key}': {item}")
        if item["id"] in seen:
            fail(f"{where}: duplicate id '{item['id']}'")
        seen.add(item["id"])
        item.setdefault("voice", default_voice)
        if item["voice"] not in VOICES:
            fail(f"{where}: unknown voice for '{item['id']}'")
        speak.append(item)

    for path in sorted((CONTENT / "phrases").glob("*.yaml")):
        sit = path.stem
        if sit not in sit_ids:
            fail(f"{path.name}: no situation '{sit}' in situations.yaml")
        for p in read(path) or []:
            if p.get("kind") not in KINDS:
                fail(f"{path.name}: '{p.get('id')}' needs kind: say, hear or word")
            add(p, path.name, "f" if p["kind"] == "hear" else "m")
            p["situation"] = sit
            phrases.append(p)

    ids = {p["id"] for p in phrases}
    for p in phrases:
        for r in p.get("replies", []):
            if r not in ids:
                fail(f"'{p['id']}' replies with unknown id '{r}'")

    food = read(CONTENT / "food.yaml")
    for section in ("spot", "dishes", "northern", "safe", "meats"):
        for item in food[section]:
            if item.get("lvl", "ok") not in LEVELS:
                fail(f"food.yaml {section}: bad lvl on '{item.get('id')}'")
            add(item, f"food.yaml {section}", "m")
    add(food["basil"], "food.yaml basil", "m")

    prices = []
    for n in PRICES:
        item = {"id": f"price-{n}", "th": f"{thai_number(n)}บาท", "rom": "-", "en": f"{n} baht", "voice": "f"}
        add(item, "prices", "f")
        prices.append(n)

    return situations, phrases, food, prices, speak


def audio_key(item, voice=None):
    return sha1(f"{VOICES[voice or item['voice']]}|{item['th']}".encode("utf-8"))


def other(voice):
    return "m" if voice == "f" else "f"


def audio_ok(item, index):
    """Made with the item's voice, or with the other voice when the preferred one refused that text."""
    return (AUDIO / f"{item['id']}.mp3").exists() and index.get(item["id"]) in (audio_key(item), audio_key(item, other(item["voice"])))


def read_index():
    path = AUDIO / "index.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


async def make_audio(items):
    import edge_tts

    AUDIO.mkdir(exist_ok=True)
    index = read_index()
    todo = [i for i in items if not audio_ok(i, index)]
    sem = asyncio.Semaphore(1)  # the free service throttles bursts
    failed = []

    def save_index():
        (AUDIO / "index.json").write_text(json.dumps(dict(sorted(index.items())), indent=1, ensure_ascii=False), encoding="utf-8")

    async def one(item):
        # The female Thai voice refuses some texts (e.g. some prices), so try the other voice too.
        voices = [item["voice"], item["voice"], other(item["voice"]), item["voice"], other(item["voice"])]
        async with sem:
            for attempt, v in enumerate(voices):
                try:
                    await edge_tts.Communicate(item["th"], VOICES[v], rate="-5%").save(str(AUDIO / f"{item['id']}.mp3"))
                    index[item["id"]] = audio_key(item, v)
                    save_index()  # survive being stopped part-way
                    await asyncio.sleep(0.4)
                    return
                except Exception:
                    await asyncio.sleep(1.5 * (attempt + 1))
            failed.append(item["id"])

    try:
        await asyncio.gather(*(one(i) for i in todo))
    finally:
        live = {i["id"] for i in items}
        for stale in [k for k in index if k not in live]:
            index.pop(stale)
            (AUDIO / f"{stale}.mp3").unlink(missing_ok=True)
        save_index()
    if failed:
        sys.exit(f"Audio failed for {len(failed)} item(s): {', '.join(failed[:20])}. Run again to retry.")
    print(f"Generated {len(todo)} audio file(s)")


def check_audio(items):
    index = read_index()
    bad = [i["id"] for i in items if not audio_ok(i, index)]
    if bad:
        sys.exit(f"Audio missing or out of date for: {', '.join(bad[:20])}{' …' if len(bad) > 20 else ''}. "
                 "Run 'npm run content' on the PC and commit audio/.")


def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "local"


def clean(item):
    return {k: v for k, v in item.items() if k != "voice"}


def build_site(situations, phrases, food, prices, speak):
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "audio").mkdir(parents=True)
    content = {
        "schema": 2,
        "situations": situations,
        # "audio" kept for app builds before schema 2
        "phrases": [clean(p) | {"audio": f"audio/{p['id']}.mp3"} for p in phrases],
        "food": {k: ([clean(i) for i in v] if isinstance(v, list) else clean(v)) for k, v in food.items()},
        "prices": prices,
    }
    (SITE / "content.json").write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for item in speak:
        src = AUDIO / f"{item['id']}.mp3"
        if src.exists():
            shutil.copy2(src, SITE / "audio" / src.name)
    files = [{"path": f.relative_to(SITE).as_posix(), "sha1": sha1(f.read_bytes()), "size": f.stat().st_size}
             for f in sorted(SITE.rglob("*")) if f.is_file()]
    manifest = {"version": f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{git_sha()}", "files": files}
    (SITE / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    (SITE / "index.html").write_text("<!doctype html><meta charset=utf-8><title>Gin Khao content</title><p>Gin Khao content feed. See manifest.json.</p>", encoding="utf-8")
    print(f"Site built: {len(phrases)} phrases, {len(speak)} audio items, manifest {manifest['version']}")


def main():
    situations, phrases, food, prices, speak = load()
    if "--check" in sys.argv:
        check_audio(speak)
    else:
        asyncio.run(make_audio(speak))
    build_site(situations, phrases, food, prices, speak)


if __name__ == "__main__":
    main()
