#!/usr/bin/env -S npx tsx
/**
 * Automated gameplay/UI regression test. Drives the actual built client in a real browser against
 * a real server (mock chain), the way `npm test` cannot: it catches wiring bugs between the sim,
 * the server's wire protocol and the DOM/canvas that unit tests don't exercise — e.g. a wallet
 * prompt getting silently clobbered, the character picker being unreachable, a layout that
 * horizontally scrolls on a phone, or the client throwing in a real browser.
 *
 * Needs a Chromium build. One-time setup if you don't already have one:
 *   npm i -D playwright && npx playwright install chromium
 *
 * Run via tsx (it imports the sim package directly), not plain node: `npm run test:game`,
 * or `npx tsx scripts/gameplay-test.mjs [--headed] [--keep-server]`.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHARACTERS } from "../packages/sim/src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "gameplay-test-output");
const HEADED = process.argv.includes("--headed");
const KEEP_SERVER = process.argv.includes("--keep-server");
const PORT = 8799;
const URL = `http://127.0.0.1:${PORT}/`;

const checks = [];
function record(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const assert = (name, cond, detail = "") => record(name, !!cond, detail);

async function waitForHealth(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url + "health");
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function collectErrors(page, into) {
  page.on("pageerror", (e) => into.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") into.push(`console: ${m.text()}`); });
}

async function newBot(browser, { viewport = { width: 1280, height: 720 }, deviceScaleFactor = 1 } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await ctx.newPage();
  const errors = [];
  collectErrors(page, errors);
  return { ctx, page, errors };
}

async function connectDevWallet(page) {
  await page.click("#btn-dev");
  await page.waitForSelector("#stake-row:not([hidden])", { timeout: 8000 });
}

/**
 * Drive a practice match to completion (or a frame budget). Practice mode is purely client-side
 * (createState() with the sim's default 3 stocks — the server's START_STOCKS env has no effect on
 * it), so the fast, deterministic way to reach a result is to walk straight off the left edge
 * repeatedly: each stock lost takes roughly a second to walk off + fall, plus the ~2.5s forced
 * respawn freeze, so 3 stocks reliably finishes in well under the budget below.
 */
async function playOutPractice(page, maxMs = 25000) {
  const deadline = Date.now() + maxMs;
  await page.keyboard.down("KeyA");
  let over = false;
  try {
    while (Date.now() < deadline) {
      over = await page.evaluate(() => window.__smash?.state?.over).catch(() => false);
      if (over) break;
      await page.waitForTimeout(250);
    }
  } finally {
    await page.keyboard.up("KeyA").catch(() => {});
  }
  return over;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), "smash-gameplay-test-"));

  console.log("Building client...");
  await new Promise((resolve, reject) => {
    const p = spawn("npm", ["run", "build", "-w", "@solanasmash/client"], { cwd: ROOT, stdio: "inherit" });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("client build failed"))));
  });

  console.log(`Starting mock server on :${PORT}...`);
  // `npx tsx ...` forks through an extra shell/npx layer, so `server.kill()` on just that PID
  // doesn't reach the real tsx/node process underneath it — it's left running forever, and this
  // script then hangs too (it keeps the server's stdout pipe open). detached:true puts the whole
  // tree in its own process group, so killing with the *negative* pid kills every descendant.
  const server = spawn("npx", ["tsx", "apps/server/src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env, PORT: String(PORT), DATA_DIR: dataDir, CLIENT_DIR: join(ROOT, "apps/client/dist"), CHAIN_MODE: "mock",
      START_STOCKS: "1", // one stock: a scripted bot/player reaches a result in seconds, not a full 3-stock match
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let serverLog = "";
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));

  async function killServer() {
    if (server.pid == null || server.killed) return;
    const exited = new Promise((resolve) => server.once("exit", resolve));
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* group already gone */ }
    const timedOut = await Promise.race([exited.then(() => false), new Promise((r) => setTimeout(() => r(true), 3000))]);
    if (timedOut) { try { process.kill(-server.pid, "SIGKILL"); } catch { /* already gone */ } }
  }

  const up = await waitForHealth(URL);
  assert("server starts and reports healthy", up, up ? "" : serverLog.slice(-500));
  if (!up) { await killServer(); process.exitCode = 1; return; }

  // Some sandboxes pre-install a Chromium build outside Playwright's own cache (e.g. for a project
  // that pins a Playwright version). Fall back to it if `playwright install` hasn't been run here.
  const fallbackChromium = "/opt/pw-browsers/chromium";
  const launchOpts = { headless: !HEADED };
  try {
    await chromium.launch(launchOpts).then((b) => b.close());
  } catch {
    if (existsSync(fallbackChromium)) {
      launchOpts.executablePath = fallbackChromium;
      launchOpts.args = ["--no-sandbox"];
    } else {
      throw new Error("No Chromium found. Run: npx playwright install chromium");
    }
  }
  const browser = await chromium.launch(launchOpts);
  try {
    // --- 1. Cold lobby: character picker must be usable with no wallet (solo testing) ---
    {
      const { page, errors } = await newBot(browser);
      await page.goto(URL, { waitUntil: "load" });
      await page.waitForSelector("#lobby");
      const pickUsable = await page.locator("#pick").isVisible();
      assert("character picker is usable before connecting a wallet", pickUsable);
      await page.screenshot({ path: join(OUT, "01-lobby.png") });
      assert("no console/page errors on cold load", errors.length === 0, errors.join(" | "));
    }

    // --- 2. Practice mode for every character in the roster, no wallet needed ---
    for (let c = 0; c < CHARACTERS.length; c++) {
      const { page, errors } = await newBot(browser);
      await page.goto(URL, { waitUntil: "load" });
      await page.waitForSelector("#lobby");
      await page.click(`.char[data-char="${c}"]`);
      const picked = await page.evaluate((i) => document.querySelector(`.char[data-char="${i}"]`).classList.contains("sel"), c);
      assert(`char ${c}: clicking its card selects it`, picked);
      await page.click("#btn-practice");
      await page.waitForTimeout(400);
      const started = await page.evaluate((i) => window.__smash?.state?.fighters?.[0]?.char === i, c);
      assert(`char ${c}: practice starts with the selected fighter`, started);
      const finished = await playOutPractice(page, 25000);
      assert(`char ${c}: a practice match reaches a result within budget`, finished);
      if (finished) {
        await page.waitForSelector("#result:not([hidden])", { timeout: 2000 }).catch(() => {});
        const title = await page.textContent("#result-title").catch(() => "");
        assert(`char ${c}: result screen shows a verdict`, /win|lose|draw/i.test(title), title);
      }
      await page.screenshot({ path: join(OUT, `02-practice-char${c}.png`) });
      assert(`char ${c}: no console/page errors during practice`, errors.length === 0, errors.join(" | "));
      await page.close();
    }

    // --- 3. Full two-player mock match: stake math shown to both players must match exactly ---
    {
      const a = await newBot(browser);
      const b = await newBot(browser);
      for (const { page } of [a, b]) { await page.goto(URL, { waitUntil: "load" }); await page.waitForSelector("#lobby"); }
      await a.page.click('.char[data-char="0"]');
      await b.page.click('.char[data-char="1"]');
      await connectDevWallet(a.page);
      await connectDevWallet(b.page);
      await a.page.click("#btn-queue");
      await b.page.click("#btn-queue");

      const waitMatched = (page) => page.waitForFunction(() => window.__smash?.mode === "online", null, { timeout: 15000 }).catch(() => null);
      const [ra, rb] = await Promise.all([waitMatched(a.page), waitMatched(b.page)]);
      assert("both players reach an online match from the queue", ra !== null && rb !== null);

      if (ra !== null) {
        await a.page.screenshot({ path: join(OUT, "03-online-match.png") });
        // both walk left so someone falls off and the match resolves deterministically and fast
        await a.page.keyboard.down("KeyA");
        await b.page.keyboard.down("KeyA");
        const sawResult = await a.page.waitForSelector("#result:not([hidden])", { timeout: 30000 }).then(() => true).catch(() => false);
        assert("online match reaches a settled result", sawResult);
        if (sawResult) {
          await b.page.waitForSelector("#result:not([hidden])", { timeout: 5000 }).catch(() => {});
          const detailA = await a.page.textContent("#result-detail");
          const detailB = await b.page.textContent("#result-detail");
          // This server was started with no FEE_BPS override, i.e. the actual shipped default: no
          // house fee, winner keeps the entire pot. Matchmaking randomises which seat/browser wins,
          // so check whichever of the two detail texts states the result.
          assert("winner's screen says no house fee (the shipped default)", /no house fee/.test(detailA) || /no house fee/.test(detailB), `A: ${detailA} | B: ${detailB}`);
          assert("winner's payout is the full 0.02 SOL pot, not pot-minus-fee", /0\.02 SOL/.test(detailA) || /0\.02 SOL/.test(detailB), `A: ${detailA} | B: ${detailB}`);
          assert("both players saw a result (one win, one lose/draw)", /win|lose|contest/i.test(detailA + detailB));
          await a.page.screenshot({ path: join(OUT, "04-online-result-a.png") });
          await b.page.screenshot({ path: join(OUT, "04-online-result-b.png") });
        }
      }
      assert("no console/page errors across the online match", a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(" | "));
      await a.page.close(); await b.page.close();
    }

    // --- 4. Phone-width layout: no horizontal scroll, picker still reachable ---
    {
      const { page, errors } = await newBot(browser, { viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
      await page.goto(URL, { waitUntil: "load" });
      await page.waitForSelector("#lobby");
      const scrolls = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      assert("no horizontal scroll at 375px width", !scrolls);
      await page.screenshot({ path: join(OUT, "05-mobile-lobby.png") });
      assert("no console/page errors at phone width", errors.length === 0, errors.join(" | "));
      await page.close();
    }
  } finally {
    await browser.close();
    if (!KEEP_SERVER) await killServer();
    rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots in ${OUT}`);
  if (failed.length) {
    console.log("Failed:");
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ": " + f.detail : ""}`);
    process.exitCode = 1;
  }
}

run()
  .catch((e) => { console.error("gameplay-test crashed:", e); process.exitCode = 1; })
  // Belt and suspenders: if anything (an open socket, a stray handle) is still keeping the event
  // loop alive after cleanup, don't hang forever — exit now that every check has been reported.
  .finally(() => process.exit(process.exitCode ?? 0));
