"""Build the content site: YAML -> content.json, generate missing audio, write manifest.json.

Usage: python tools/build_content.py [--no-audio]

Audio lives in audio/ (committed) so it is generated once per phrase text.
audio/index.json remembers which text+voice each file was made from, so editing
a phrase's Thai regenerates just that file.
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


def sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def load_phrases():
    phrases, seen = [], set()
    for path in sorted(CONTENT.glob("*.yaml")):
        for p in yaml.safe_load(path.read_text(encoding="utf-8")) or []:
            for key in ("id", "th", "rom", "en"):
                if not p.get(key):
                    sys.exit(f"{path.name}: phrase missing '{key}': {p}")
            if p["id"] in seen:
                sys.exit(f"{path.name}: duplicate id '{p['id']}'")
            if p.get("voice", "m") not in VOICES:
                sys.exit(f"{path.name}: unknown voice for '{p['id']}'")
            seen.add(p["id"])
            phrases.append(p)
    return phrases


async def make_audio(phrases):
    import edge_tts

    AUDIO.mkdir(exist_ok=True)
    index_path = AUDIO / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    made = 0
    for p in phrases:
        voice = VOICES[p.get("voice", "m")]
        key = sha1(f"{voice}|{p['th']}".encode("utf-8"))
        out = AUDIO / f"{p['id']}.mp3"
        if index.get(p["id"]) == key and out.exists():
            continue
        await edge_tts.Communicate(p["th"], voice, rate="-5%").save(str(out))
        index[p["id"]] = key
        made += 1
        print(f"  audio: {p['id']}")
    live = {p["id"] for p in phrases}
    for stale in [k for k in index if k not in live]:
        index.pop(stale)
        (AUDIO / f"{stale}.mp3").unlink(missing_ok=True)
    index_path.write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Generated {made} audio file(s)")


def git_sha():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "local"


def build_site(phrases):
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "audio").mkdir(parents=True)
    content = {"phrases": [{k: p[k] for k in ("id", "th", "rom", "en")} | {"audio": f"audio/{p['id']}.mp3"} for p in phrases]}
    (SITE / "content.json").write_text(json.dumps(content, ensure_ascii=False, indent=1), encoding="utf-8")
    for p in phrases:
        src = AUDIO / f"{p['id']}.mp3"
        if src.exists():
            shutil.copy2(src, SITE / "audio" / src.name)
    files = []
    for f in sorted(SITE.rglob("*")):
        if f.is_file():
            files.append({"path": f.relative_to(SITE).as_posix(), "sha1": sha1(f.read_bytes()), "size": f.stat().st_size})
    manifest = {"version": f"{time.strftime('%Y%m%d-%H%M%S', time.gmtime())}-{git_sha()}", "files": files}
    (SITE / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    (SITE / "index.html").write_text("<!doctype html><meta charset=utf-8><title>Gin Khao content</title><p>Gin Khao content feed. See manifest.json.</p>", encoding="utf-8")
    print(f"Site built: {len(phrases)} phrases, manifest {manifest['version']}")


def main():
    phrases = load_phrases()
    if "--no-audio" not in sys.argv:
        asyncio.run(make_audio(phrases))
    build_site(phrases)


if __name__ == "__main__":
    main()
