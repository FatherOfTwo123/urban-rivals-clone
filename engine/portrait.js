// ---------------------------------------------------------------------------
// Card rendering — composes a LOYAL Urban Rivals card from the real assets:
//   * rarity frame PNG (Common/Uncommon/Rare/Legendary) as the opaque card body
//   * the character art cutout (UR CDN, transparent PNG) over the frame window
//   * Bg-bottom stats panel + star gauge + Power/Damage/Ability/Bonus icons
//   * name / power / damage in the "Urban Rivals" webfont
// Layout mirrors iClintz's pixel coordinates (base card 166x237), expressed as
// percentages so it scales; fonts use container-query units (cqi).
// ---------------------------------------------------------------------------
(function (root) {
  const A = "ui/assets/card/"; // local frame/icon assets
  const FRAME = { common: "Common.png", uncommon: "Uncommon.png", rare: "Rare.png", legendary: "Legendary.png" };
  const frameFile = (r) => A + (FRAME[r] || "Legendary.png");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  function starGauge(level, maxLevel) {
    let s = "";
    for (let i = 0; i < maxLevel; i++) s += `<img class="urc-star" src="${A}${i < level ? "Star-On.png" : "Star-Off.png"}" alt="">`;
    return s;
  }

  // card = {clan,name,power,damage,level,maxLevel,stars,rarity,art,abilityText,abilityActive,abilityLevel,ability}
  // opts (battle clash): {abilityInEffect, bonusInEffect} force greying based on what actually happened.
  function drawCard(card, opts = {}) {
    const CLANS = root.CLANS || {};
    const clan = CLANS[card.clan] || { name: card.clan, emblem: null, bonusText: "" };
    const lvl = card.level || card.stars || 1;
    const maxLevel = card.maxLevel || card.stars || lvl;
    const hasAbility = !!card.abilityText;
    const abilityText = card.abilityText || "No ability";
    const abilitySupported = !!(card.ability && card.ability.supported);
    const bonusSupported = !!(clan.bonus && clan.bonus.supported);

    // Greying — an effect shown but not in effect is dimmed (negated / locked / cosmetic).
    let abilityGrey, abilityTitle;
    if (opts.abilityInEffect !== undefined) { abilityGrey = hasAbility && !opts.abilityInEffect; abilityTitle = abilityGrey ? abilityText + " — not in effect this round" : abilityText; }
    else if (!hasAbility) { abilityGrey = false; abilityTitle = "No ability"; }
    else if (!card.abilityActive) { abilityGrey = true; abilityTitle = abilityText + ` — unlocks at level ${card.abilityLevel}`; }
    else if (!abilitySupported) { abilityGrey = true; abilityTitle = abilityText + " — cosmetic (not simulated)"; }
    else { abilityGrey = false; abilityTitle = abilityText; }

    let bonusGrey, bonusTitle;
    const bonusText = clan.bonusText || "";
    if (opts.bonusInEffect !== undefined) { bonusGrey = !!bonusText && !opts.bonusInEffect; bonusTitle = bonusGrey ? bonusText + " — not in effect this round" : bonusText; }
    else { bonusGrey = !!bonusText && !bonusSupported; bonusTitle = bonusGrey ? bonusText + " — cosmetic (not simulated)" : bonusText; }

    const emblem = clan.emblem ? `<img class="urc-emblem" src="${esc(clan.emblem)}" alt="" loading="lazy">` : "";
    // XP gauge fill — shown for owned cards (card._xpPct / card._xpMax provided by the UI)
    const xpPct = card._xpMax ? 100 : (typeof card._xpPct === "number" ? card._xpPct : null);
    const xpFill = xpPct != null ? `<div class="urc-xpfill${card._xpMax ? " max" : ""}" style="width:${xpPct}%"></div>` : "";

    return `
<div class="urc urc-${esc(card.rarity || "common")}">
  <img class="urc-frame-img" src="${frameFile(card.rarity)}" alt="" draggable="false">
  <img class="urc-art-img" src="${esc(card.art || "")}" alt="${esc(card.name)}" loading="lazy" draggable="false" onerror="this.style.opacity=0">
  <img class="urc-bottom-img" src="${A}Bg-bottom.png" alt="" draggable="false">
  ${emblem}
  <div class="urc-name urbanFont">${esc(card.name)}</div>
  <div class="urc-gauge">${xpFill}<span class="urc-stars">${starGauge(lvl, maxLevel)}</span></div>
  <div class="urc-pow urbanFont">${card.power}</div>
  <div class="urc-dmg urbanFont">${card.damage}</div>
  <div class="urc-ab${abilityGrey ? (opts.abilityInEffect !== undefined ? " locked neg" : " locked") : ""}" title="${esc(abilityTitle)}">${esc(abilityText)}</div>
  <div class="urc-bn${bonusGrey ? (opts.bonusInEffect !== undefined ? " locked neg" : " locked") : ""}" title="${esc(bonusTitle)}">${esc(bonusText)}</div>
</div>`.trim();
  }

  function drawCardBack() {
    return `<div class="urc urc-back"><div class="urc-back-mark">⚔</div><div class="urc-back-text">CLINT CITY</div></div>`;
  }

  const api = { drawCard, drawCardBack };
  if (typeof window !== "undefined") window.PortraitGen = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
