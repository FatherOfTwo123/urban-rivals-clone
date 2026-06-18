#!/usr/bin/env node
// ---------------------------------------------------------------------------
// fetch-assets.js — downloads the static look-and-feel assets so the clone
// renders loyal Urban Rivals cards & arena offline:
//   * card frame PNGs + stat icons + the "Urban Rivals" webfont  (from iClintz)
//   * real Clint City fight backgrounds                          (from the UR Fandom wiki)
// Card character ART stays remote (per-card, fetched on demand from the UR CDN).
//
//   node tools/fetch-assets.js
// ---------------------------------------------------------------------------
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "ui", "assets");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36";

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": UA, Accept: "*/*" } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return resolve(download(new URL(r.headers.location, url).href, dest));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`${r.statusCode} ${url}`)); }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(dest);
      r.pipe(out);
      out.on("finish", () => out.close(() => resolve(fs.statSync(dest).size)));
    }).on("error", reject);
  });
}

const CARD = "https://iclintz.com/assets/img/Card/";
const cardAssets = ["Common.png","Uncommon.png","Rare.png","Legendary.png","Mythic.png","Bg-bottom.png","Bg-gauge.png","Gauge.png","Star-On.png","Star-Off.png","Power.png","Damage.png","Ability.png","Bonus.png"];

const FONT = "https://iclintz.com/assets/font/urbanrivalsfont-webfont.woff";

// Real Clint City fight backgrounds (UR Fandom wiki, hotlink-stable static CDN).
const backgrounds = {
  "clintcity.jpg":       "https://static.wikia.nocookie.net/urban-rivals/images/9/98/Bg.jpg/revision/latest?cb=20111015111538",
  "clintcity-2012.jpg":  "https://static.wikia.nocookie.net/urban-rivals/images/e/ea/Background_2012.jpg/revision/latest?cb=20120910142932",
  "clintcity-alt.jpg":   "https://static.wikia.nocookie.net/urban-rivals/images/1/1a/Background_alternate_1.jpg/revision/latest?cb=20111122194041",
  "clintcity-night.jpg": "https://static.wikia.nocookie.net/urban-rivals/images/a/a3/Bg_frozn_night.jpg/revision/latest?cb=20120504180939",
};

async function main() {
  let ok = 0, fail = 0;
  const tryGet = async (url, dest, optional) => {
    try { const n = await download(url, dest); console.log(`  ✓ ${path.relative(ROOT, dest).padEnd(26)} ${(n / 1024).toFixed(0)} KB`); ok++; }
    catch (e) { console.warn(`  ${optional ? "·" : "✗"} ${path.relative(ROOT, dest)} — ${e.message}`); fail += optional ? 0 : 1; }
  };

  console.log("Card frame assets:");
  for (const a of cardAssets) await tryGet(CARD + a, path.join(ROOT, "card", a), /Mythic/.test(a));
  console.log("Font:");
  await tryGet(FONT, path.join(ROOT, "font", "urbanrivals.woff"));
  console.log("Backgrounds:");
  for (const [name, url] of Object.entries(backgrounds)) await tryGet(url, path.join(ROOT, "bg", name), true);

  console.log(`\nDone. ${ok} downloaded, ${fail} required failures.`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
