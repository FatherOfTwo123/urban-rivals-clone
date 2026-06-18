#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fetch-cards.js — pulls REAL Urban Rivals card data from the iClintz database
// (https://iclintz.com) and writes data/cards-data.json. No data is hard-coded:
// re-run this script any time to refresh names, art, stats, abilities & clans.
//
//   node tools/fetch-cards.js
//
// Source: iClintz clan roster pages (clan.php?ID=...). For each card we capture
// id, name, clan, real art URL, rarity, stars, max-level power & damage, ability
// text and clan bonus text.
// ---------------------------------------------------------------------------
const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = "https://iclintz.com/characters/clan.php?ID=";
const OUT = path.join(__dirname, "..", "data", "cards-data.json");
const UA = "Mozilla/5.0 (urban-rivals-clone data fetcher)";

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return resolve(get(new URL(r.headers.location, url).href));
      }
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => resolve(d));
    }).on("error", reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

const RARITY = { c: "common", u: "uncommon", r: "rare", l: "legendary", m: "mythic", t: "titan" };

// One tolerant regex over a single card block.
const CARD_RE = new RegExp(
  '<div class="cardName cardFrame urbanFont card_(\\w+)">' +
  '\\s*<a href="/characters/card\\.php\\?ID=(\\d+)">' +
  '\\s*<span class="cardName urbanFont">([^<]+)</span>' +
  '[\\s\\S]*?class="cardPict" src="([^"]+)"' +
  '[\\s\\S]*?<div class="cardStars">([\\s\\S]*?)</div>\\s*<div class="cardBottom">' +
  '\\s*<div class="cardPH urbanFont">\\s*(\\d+)' +
  '[\\s\\S]*?<div class="cardPDD urbanFont">\\s*(\\d+)' +
  '[\\s\\S]*?<div class="cardPower">[\\s\\S]*?<div class="vcenterContent">([\\s\\S]*?)</div>' +
  '[\\s\\S]*?<div class="cardBonus">[\\s\\S]*?<div class="vcenterContent">([\\s\\S]*?)</div>',
  "g"
);

function parseClanPage(html, clanId) {
  const name = (html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || `Clan ${clanId}`;
  const emblemKey = (html.match(/urimages\/clan\/([A-Z0-9]+)_42\.png/) || [])[1] || "";
  const key = (emblemKey || name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const emblem = emblemKey ? `https://s.acdn.ur-img.com/urimages/clan/${emblemKey}_42.png` : null;

  // restrict to roster region to avoid stray matches
  const start = html.indexOf('id="clan-roster"');
  const region = start >= 0 ? html.slice(start) : html;

  const cards = [];
  let m, bonusText = null;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(region))) {
    const stars = (m[5].match(/cardStarOn/g) || []).length;
    const ability = decode(m[8]);
    const bonus = decode(m[9]);
    if (!bonusText && bonus && !/no bonus/i.test(bonus)) bonusText = bonus;
    cards.push({
      id: String(m[2]),
      name: decode(m[3]),
      clan: key,
      rarity: RARITY[m[1]] || m[1],
      stars,
      power: parseInt(m[6], 10),
      damage: parseInt(m[7], 10),
      ability: /^no ability$/i.test(ability) || !ability ? null : ability,
      art: m[4],
    });
  }
  return { key, name, id: clanId, emblem, bonus: bonusText, cards };
}

async function main() {
  console.log("Fetching clan index…");
  const first = await get(BASE + "38");
  const clanIds = [...new Set([...first.matchAll(/clan\.php\?ID=(\d+)/g)].map((x) => x[1]))];
  console.log(`Found ${clanIds.length} clans.`);

  const clans = {};
  const cards = [];
  let done = 0;
  for (const id of clanIds) {
    const html = id === "38" ? first : await get(BASE + id);
    const parsed = parseClanPage(html, id);
    if (!parsed.cards.length) { console.warn(`  ! clan ${id} (${parsed.name}) — 0 cards parsed`); }
    clans[parsed.key] = { key: parsed.key, name: parsed.name, sourceId: id, emblem: parsed.emblem, bonus: parsed.bonus };
    parsed.cards.forEach((c) => cards.push(c));
    done++;
    console.log(`  [${done}/${clanIds.length}] ${parsed.name.padEnd(16)} ${parsed.cards.length} cards`);
    if (id !== "38") await sleep(150);
  }

  const data = {
    _meta: {
      source: "https://iclintz.com",
      generatedAt: new Date().toISOString(),
      clanCount: Object.keys(clans).length,
      cardCount: cards.length,
    },
    clanOrder: Object.keys(clans),
    clans,
    cards,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data, null, 0));
  console.log(`\nWrote ${cards.length} cards across ${Object.keys(clans).length} clans → ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
