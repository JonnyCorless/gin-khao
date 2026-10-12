# Gin Khao (กินข้าว) — build plan

A calm, playful Android app for getting through daily life in Chiang Mai in Thai.
You speak standard Central Thai, so it works in Bangkok too, and you learn to
*understand* the Northern Thai around you.

Status: **plan v2, awaiting sign-off**. Nothing is built until it's approved.

---

## 1. Who it's for

- Lives in Chiang Mai, renting a house. Gets around by **own scooter**, on foot and by bicycle.
- Works a UK job 2pm–10pm Thai time with no Thai at work, so mornings are free.
- Talks Thai mostly with **strangers who become regulars**: shopkeepers, stall owners, mechanics, neighbours, the landlord.
- Already knows: ordering petrol (95, full tank), most of 1–10, 100.
- Biggest worries: asking for things in shops, and knowing what food is (avoiding offal).
- Food preferences: less sweet, less spicy, less fish sauce.
- Phone: **Oppo A6 Pro 5G** (ColorOS, Android 15, Google services).

---

## 2. Decisions

| Topic | Decision |
|---|---|
| Delivery | Hybrid: install the APK once; content and audio download from GitHub on open |
| App updates | Same as LifeRPG: web code updates itself on open (asks to restart, falls back to the built-in copy if a build fails twice); native changes arrive as a new APK offered in **Settings › App updates** and installed in-app. No Obtainium |
| Content releases | Straight to live on push |
| Repo | Public |
| Budget | Free only |
| Voice | **edge-tts** (Microsoft Thai neural voices), generated once and stored in the repo. Azure free tier is the fallback |
| Offline | Fully offline after each sync |
| Look | Clean and calm, Lanna palette, soft line-art illustrations |
| Characters | A recurring local cast you become a "regular" with |
| Polite word | ครับ in script, written and accepted as **kháp** |
| Tones | Accent marks that point the pitch: mai (flat), mài (low), mâi (falling), mái (high), mǎi (rising) |
| Spelling | Simple, the way you'd write it ("tem thǎng", "gài", "kài"), with no g/k/kh distinction. Sound-alike pairs get their own listening drills |
| Script | Recognise key words from day one, plus an optional alphabet course that unlocks gradually |
| Northern Thai | Understand common Kham Mueang words, and say a handful yourself |
| Session | 15–20 min. **8 new phrases a day** |
| Ways in | **Today** (guided), **Browse** (free choice), **Story** (chapters) |
| Mistakes | **Hearts** in lessons and scenes. They never lock Browse, Show, Food guard or the menu checker |
| Speaking | Understood-score, record & compare, shadowing, and a pitch line |
| Start | 3-minute placement check on first launch |
| Reminder | 11:00, only if today's session isn't done. Changeable, and sessions can be paused and resumed |
| Backup | Export/import progress file |
| Accuracy | No Thai reviewer: careful cross-checking and a "Report this phrase" button (pre-filled GitHub issue) |
| Content changes | You ask in a Claude session; Claude writes, pushes, and the app picks it up |
| Signing key | GitHub secret, with the backup kept in your password manager |
| PC tools | Node.js LTS, GitHub CLI and Python installed via winget, each one approved by you |

---

## 3. What the app does

### Home
- **Today**: warm-up review (5 min) → 8 new phrases (5) → a scene with one of your regulars (5) → today's real-life mission.
- **Browse**: every situation, searchable, always available.
- **Story: My first month in Chiang Mai**: chapters that unlock in order (first 7-Eleven run, the khao soi stall, a flat tyre, the landlord visit, a bad stomach, Songkran…).

### Learning features
- **Phrase cards**: script, toned romanisation, English, normal/slow audio, and **Show** (full-screen Thai to hand to someone).
- **Role-play scenes**: the character speaks, you pick or say your reply, and the scene branches. Hearts at stake. Regulars "remember you" as your level grows.
- **Speaking**, four modes:
  - *Understood-score*: Thai speech recognition checks whether you were understood (lenient, accepts kháp/khráp variants).
  - *Record & compare*: your take and the native take, back to back.
  - *Shadowing*: speak along with the audio, no grading.
  - *Pitch line*: your voice's pitch drawn over the native line (Phase 3).
- **Missions**: real-world challenges with badges. Tick them off with an optional note on how it went.
- **Smart review**: spaced repetition (FSRS) for phrases, listening, script and sound-alike pairs. Streak counter.
- **Ears**: price trainer, "what staff say" drills, Chiang Mai ear pack, sound-alike pairs (gài/kài, mài/mâi/mǎi…).
- **Script track**: sign words first (toilet, push/pull, prices, menu words), then the optional alphabet course.

### Real-life tools (never locked by hearts)
- **Food guard**: offal, blood and raw words to spot by shape. The กระเพาะ/กะเพรา trap. Northern dishes. Menu checker (paste text from Google Lens).
- **Food preference phrases**: less sweet (หวานน้อย), less spicy (เผ็ดน้อย / ไม่เผ็ด), less fish sauce (น้ำปลาน้อยๆ), all pinned to a Show card.
- **Quick Show cards**: pinned cards on a long-press shortcut from the app icon. Examples: "I speak a little Thai", your food preferences, your address for deliveries and Grab.
- **My phrases**: save phrases locals teach you. Audio is added on the next push.
- **Home-screen widget**: phrase of the day, tap to hear (Phase 3, needs a little native Android code).

### The regulars
| Character | Where | Role |
|---|---|---|
| Nong Bank (น้องแบงค์) | 7-Eleven till | The five till questions, every time |
| Pa Noi (ป้าน้อย) | Khao soi stall | Warm, fast-talking, slips into Northern words |
| Pi Tum (พี่ตั้ม) | Scooter repair shop | Tyres, oil, chain, "how long?", "how much?" |
| Phi Fon (พี่ฝน) | Pharmacy | Symptoms, doses, "after meals" |
| Mae Kham (แม่คำ) | Fresh market | Kilos, bargaining, Kham Mueang |
| Khun Ying (คุณหญิง) | Your landlord | Rent, repairs, water, aircon |
| Lung Mon (ลุงมนต์) | Next-door neighbour | Greetings, "eaten yet?", rubbish day, small talk |
| Officer Chai | Police checkpoint | Licence, helmet, "where are you going?" (calm, short scene) |

### Situations (Shops & 7-Eleven polished first)
1. **Shops & 7-Eleven**: till questions, "do you have…?", asking where things are, bags, heating up, paying.
2. Food & stalls: ordering, preferences, offal-avoidance, khao soi, noodle-shop questions.
3. Scooter life: petrol, tyre/oil/repair shop, parking, checkpoints, helmet, washing.
4. Home: landlord, repairs, drinking-water delivery, gas bottle, rubbish, parcels and deliveries to the house.
5. Health: pharmacy, clinic reception, dentist, symptoms.
6. On foot & bicycle: directions, nearby shops, "is it far?"
7. Neighbours & social: greetings, regular vendors, being offered food, saying no politely.

### Chiang Mai specifics
- Northern words to recognise: บ่ *bò* (not), เจ้า *jâo* (polite word Northern women use, also "yes"), ลำ *lam* (delicious), กิ๋น *gǐn* (eat), อู้ *ûu* (speak), แม่นแล้ว *mâen láew* (that's right).
- To say yourself: ลำขนาด *lam khà-nàat* (really delicious) and a few more.
- Northern food to watch: น้ำเงี้ยว (often blood cubes), ลู่ (raw blood), ลาบดิบ/ลาบเมือง (raw, blood, offal), แกงอ่อม (often offal), จิ๊นส้ม (fermented raw pork).
- Usually fine: ข้าวซอย, ไส้อั่ว (a sausage, despite the ไส้), แกงฮังเล, น้ำพริกหนุ่ม, แคบหมู.

---

## 4. How it's built

```
gin-khao/ (public GitHub repo)
├── app/          Web app: TypeScript + Vite + Preact
├── android/      Capacitor Android shell (+ small native bits: widget, shortcuts)
├── content/      YAML: phrases, scenes, missions, food, words, story chapters
├── audio/        Generated .mp3 per phrase ID
├── tools/        Audio generator (Python, edge-tts), manifest builder, content checker
└── .github/workflows/
    (publish.yml: one pipeline. Push → content, audio and web code go live. v* tag → also a signed APK, offered in Settings › App updates)
```

- **Capacitor** wraps the web app in a real APK, with plugins for mic, speech recognition, notifications, files, sharing and app shortcuts.
- **Content sync**: the app fetches `manifest.json` from GitHub Pages and downloads only changed files. A snapshot is bundled in the APK, so the first launch works offline.
- **Audio**: edge-tts runs in GitHub Actions. If Microsoft blocks cloud servers, it runs on your PC instead with one command. Each regular has a consistent voice.
- **Speech recognition**: Android SpeechRecognizer `th-TH` through the Google app on the Oppo. Phase 0 tests it on your phone.
- **Pitch line**: on-device pitch detection from the mic (no server).
- **Progress**: on-device SQLite, export/import file through the share sheet.
- **Content checker**: validates every YAML file on push (missing tones, broken IDs, duplicate phrases) so a typo can't break the app.

### Design direction
Clean and calm, rooted in Lanna: textile indigo, misty Doi Suthep green-grey, teak, and a touch of temple gold as the accent. Soft line-art characters and scenes, drawn as vectors in code. Gentle, purposeful motion: a card turns, a regular smiles, a quiet celebration on a finished mission. A looped Thai face for reading, a sign-style face for "spot it", and a calm Latin face. Light and dark themes.

---

## 5. Phases

**Phase 0: pipeline proof (1 session)**
Install Node, GitHub CLI and Python. Create the repo **outside OneDrive** (see 6). Make the signing key and store its backup. Set up the Publish pipeline and LifeRPG-style in-app updates. Test edge-tts in Actions. Result: a "hello" APK on your Oppo showing a phrase pushed from git, plus a check that Thai speech recognition works on the phone.

**Phase 1: useful every day**
Design system and shell · placement check · Browse, phrase cards, audio, Show · Quick Show cards and shortcuts · **Shops & 7-Eleven fully polished**, then food and stalls · Food guard, menu checker, preference phrases · price trainer · smart review and streak · Today (review + new) · reminders · backup · Report this phrase. Content: about 250 phrases.

**Phase 2: the fun layer**
The regulars and line-art · role-play scenes (about 12) with hearts · understood-score, record & compare, shadowing · missions and badges (about 30) · scenes in Today · My phrases · scooter, home and health situations.

**Phase 3: deeper**
Story path · Chiang Mai ear and Northern phrases · script recognition and alphabet course · pitch line · home-screen widget · sharing from Google Lens into the menu checker · sound-alike drill expansion.

**Status (2026-10-12)**: Phases 0 to 3 built. Web and content ship by pushing to main. The widget, Lens sharing and the mic in the web view (record & compare, pitch line, recording My phrases) need APK 0.3.0, and the app says so on older APKs.
- Story: `content/story.yaml`, 14 chapters over the existing scenes plus three Northern ones (mon-2, noi-4, mon-3).
- Chiang Mai ear: `content/phrases/lanna.yaml` (situation `lanna`).
- Reading: `content/script.yaml` (sign words, digits, four letter lessons, vowels). Reading joins the daily session after 16 phrases.
- Sound-alikes: `content/sounds.yaml` (Browse › Ears).
- Speaking lab: record & compare with pitch lines, and shadowing. The pitch is worked out on the phone (YIN).
- My phrases: on the Show tab, saved in progress.json, with recordings in `mine/`.

---

## 6. Notes and limits
- **Repo location**: build in `C:\dev\gin-khao`, not in OneDrive. OneDrive syncing the thousands of build files causes locks and slowdowns. This plan file moves into the repo.
- No native-speaker review: Report this phrase plus your real-world corrections are the safety net.
- The neural voices are Central Thai, so Northern words sound Bangkok-accented and are marked approximate.
- Understood-score judges whether you were understood, not each tone exactly. Record & compare and the pitch line cover tones.
- Thai text inside camera images can't be read on-device for free, so menu text comes in via Google Lens copy or share.
- Hearts are a deliberate exception to "calm". If they ever feel like pressure, there's a settings switch to turn them off.
