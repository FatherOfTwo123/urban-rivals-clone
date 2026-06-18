// ---------------------------------------------------------------------------
// Urban Rivals clone — UI controller (real iClintz data, 36 clans, ~2800 cards).
// Views: menu, deck (builder), collection (explore + level), battle, gameover.
// ---------------------------------------------------------------------------
(function () {
  "use strict";

  const DECK_SIZE = 8;
  const HAND_SIZE = 4;
  const MAX_COPIES = 2;
  const POOL_CAP = 72; // max cards rendered at once (perf for big clans / "All")
  const DECK_KEY = "urbc_deck_v3";
  const PROG_KEY = "urbc_progress_v3";
  const ARENAS = ["clintcity.jpg", "clintcity-2012.jpg", "clintcity-alt.jpg", "clintcity-night.jpg"];

  const view = document.getElementById("view");

  const state = {
    view: "menu", deck: [], progress: {},
    clanFilter: null, search: "", focusSearch: false,
    game: null, sel: { uid: null, pillz: 0, fury: false },
    result: null, matchXp: {}, readyToLevel: [],
  };

  // ---- Persistence --------------------------------------------------------
  function loadProgress() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(PROG_KEY) || "{}") || {}; } catch (e) {}
    const prog = {};
    for (const c of CARDS) {
      const min = minLevel(c), s = saved[c.id];
      const level = Math.max(min, Math.min(c.stars, s && Number.isInteger(s.level) ? s.level : min));
      prog[c.id] = { level, xp: s && s.xp >= 0 ? s.xp : 0 };
    }
    return prog;
  }
  function saveProgress() { localStorage.setItem(PROG_KEY, JSON.stringify(state.progress)); }

  function loadDeck() {
    try {
      const d = JSON.parse(localStorage.getItem(DECK_KEY) || "null");
      if (Array.isArray(d) && d.length === DECK_SIZE && d.every((id) => CARD_BY_ID[id])) return d;
    } catch (e) {}
    return defaultDeck();
  }
  function defaultDeck() {
    const clansWith = CLAN_ORDER.filter((k) => CARDS.filter((c) => c.clan === k).length >= 4);
    const pick = shuffle(clansWith.slice()).slice(0, 2);
    const d = [];
    pick.forEach((k) => CARDS.filter((c) => c.clan === k).slice(0, 4).forEach((c) => d.push(c.id)));
    return d.slice(0, DECK_SIZE);
  }
  function saveDeck() { localStorage.setItem(DECK_KEY, JSON.stringify(state.deck)); }

  // ---- Leveling -----------------------------------------------------------
  const getLevel = (id) => state.progress[id].level;
  // Attach XP progress to a stat block so the card art can draw its XP gauge.
  function attachXp(stat, id) {
    const c = CARD_BY_ID[id], p = state.progress[id];
    if (p.level >= c.stars) stat._xpMax = true;
    else stat._xpPct = Math.min(100, Math.round((p.xp / xpForLevel(c, p.level)) * 100));
    return stat;
  }
  const liveStats = (id) => attachXp(cardStatsAtLevel(CARD_BY_ID[id], getLevel(id)), id);
  // Player account level — grows as you level cards in your collection.
  function playerLevel() {
    let prog = 0;
    for (const id in state.progress) prog += state.progress[id].level - minLevel(CARD_BY_ID[id]);
    return 1 + prog;
  }
  function canLevel(id) { const c = CARD_BY_ID[id], p = state.progress[id]; return p.level < c.stars && p.xp >= xpForLevel(c, p.level); }
  function doLevelUp(id) {
    const c = CARD_BY_ID[id], p = state.progress[id];
    if (!canLevel(id)) return false;
    p.xp -= xpForLevel(c, p.level); p.level += 1; saveProgress(); return true;
  }
  function grantMatchXp() {
    for (const [id, amt] of Object.entries(state.matchXp)) state.progress[id].xp += amt;
    saveProgress();
    return Object.keys(state.matchXp).filter(canLevel).map((id) => CARD_BY_ID[id].name);
  }

  // ---- helpers ------------------------------------------------------------
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  function cardNode(stat, opts = {}) {
    const wrap = el("div", "ur-card" + (opts.size ? " " + opts.size : "") + (opts.selected ? " selected" : "") + (opts.used ? " used" : "") + (opts.played ? " played" : "") + (opts.winner ? " winner" : "") + (opts.loser ? " loser" : "") + (opts.dimmed ? " dimmed" : ""));
    wrap.innerHTML = PortraitGen.drawCard(stat, opts.effect || {});
    if (opts.badge) wrap.appendChild(el("div", "card-badge", opts.badge));
    if (opts.onClick && !opts.used) wrap.addEventListener("click", opts.onClick);
    return wrap;
  }

  function filteredCards() {
    let list = CARDS;
    if (state.clanFilter) list = list.filter((c) => c.clan === state.clanFilter);
    if (state.search) { const q = state.search.toLowerCase(); list = list.filter((c) => c.name.toLowerCase().includes(q)); }
    return list;
  }

  function render() {
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const active = b.dataset.view === state.view || (["battle", "gameover"].includes(state.view) && b.dataset.view === "menu");
      b.classList.toggle("active", active);
    });
    clear(view);
    ({ menu: renderMenu, deck: renderDeck, collection: renderCollection, battle: renderBattle, gameover: renderGameover }[state.view] || renderMenu)();
    if (state.focusSearch) { const s = document.getElementById("card-search"); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } state.focusSearch = false; }
  }

  // ---- Menu ---------------------------------------------------------------
  function renderMenu() {
    const wrap = el("div", "menu");
    wrap.appendChild(el("h2", null, "⚔️ Clint City Rivals"));
    wrap.appendChild(el("p", "tagline", `${CLAN_ORDER.length} clans · ${CARDS.length} real cards from iClintz`));
    wrap.appendChild(el("div", "rules",
      `<b>How to play:</b> Build a deck of ${DECK_SIZE}. Each duel deals you a hand of ${HAND_SIZE}, played over 4 rounds.
       Each round pick a card and spend <b>Pillz</b> — <b>Attack = Power × (1 + Pillz)</b>. Highest attack wins the round and
       deals its <b>Damage</b>. Hold ≥2 of a clan for its <b>Bonus</b>. <b>Fury</b> (3 pillz) adds +2 damage. First to 0 life loses.`));
    const actions = el("div", "menu-actions");
    const play = el("button", "big-btn", "▶ Play vs AI"); play.onclick = startGame;
    const deck = el("button", "big-btn secondary", "🗂 Deck Builder"); deck.onclick = () => go("deck");
    const coll = el("button", "big-btn secondary", "📚 Collection"); coll.onclick = () => go("collection");
    actions.append(play, deck, coll);
    wrap.appendChild(actions);
    view.appendChild(wrap);
  }

  // ---- Filter bar (clans + search) ----------------------------------------
  function filterBar() {
    const bar = el("div", "filter-bar");
    const searchWrap = el("div", "search-wrap");
    const search = el("input", "card-search"); search.id = "card-search";
    search.type = "search"; search.placeholder = "🔎 Search card name…"; search.value = state.search;
    search.oninput = (e) => { state.search = e.target.value; state.focusSearch = true; render(); };
    searchWrap.appendChild(search);
    bar.appendChild(searchWrap);

    const chips = el("div", "clan-filter");
    const all = el("div", "clan-chip" + (!state.clanFilter ? " active" : ""), "All");
    all.onclick = () => { state.clanFilter = null; render(); };
    chips.appendChild(all);
    CLAN_ORDER.forEach((k) => {
      const v = CLANS[k];
      const chip = el("div", "clan-chip" + (state.clanFilter === k ? " active" : ""));
      if (v.emblem) chip.appendChild(el("img", "chip-emblem")).src = v.emblem;
      chip.appendChild(el("span", null, v.name));
      chip.style.borderColor = v.color;
      if (state.clanFilter === k) chip.style.background = v.color;
      chip.onclick = () => { state.clanFilter = state.clanFilter === k ? null : k; render(); };
      chips.appendChild(chip);
    });
    bar.appendChild(chips);
    return bar;
  }

  // ---- Deck builder -------------------------------------------------------
  function renderDeck() {
    const wrap = el("div", "deck-builder");

    const col = el("div", "panel collection-panel");
    const list = filteredCards();
    col.appendChild(el("h3", null, `Card Pool <span class="muted">— showing ${Math.min(list.length, POOL_CAP)} of ${list.length}</span>`));
    col.appendChild(filterBar());
    const grid = el("div", "cards-grid");
    list.slice(0, POOL_CAP).forEach((c) => {
      const copies = state.deck.filter((id) => id === c.id).length;
      const node = cardNode(liveStats(c.id), {
        size: "sm", dimmed: copies > 0, badge: copies ? `×${copies}` : null,
        onClick: () => {
          if (state.deck.length >= DECK_SIZE) return toast("Deck is full");
          if (copies >= MAX_COPIES) return toast(`Max ${MAX_COPIES} copies`);
          state.deck.push(c.id); saveDeck(); render();
        },
      });
      grid.appendChild(node);
    });
    if (list.length > POOL_CAP) grid.appendChild(el("div", "more-note", `+${list.length - POOL_CAP} more — filter by clan or search`));
    col.appendChild(grid);
    wrap.appendChild(col);

    const side = el("div", "panel deck-side");
    side.appendChild(el("h3", null, `Your Deck (${state.deck.length}/${DECK_SIZE})`));
    const stars = state.deck.reduce((s, id) => s + CARD_BY_ID[id].stars, 0);
    const clanSet = new Set(state.deck.map((id) => CARD_BY_ID[id].clan));
    side.appendChild(el("div", "deck-summary", `★ ${stars} · ${clanSet.size} clan${clanSet.size === 1 ? "" : "s"}`));
    const slots = el("div", "deck-slots");
    for (let i = 0; i < DECK_SIZE; i++) {
      const id = state.deck[i];
      if (id) {
        const slot = el("div", "deck-slot full");
        slot.appendChild(cardNode(liveStats(id), { size: "sm" }));
        const rm = el("button", "remove", "×"); rm.onclick = () => { state.deck.splice(i, 1); saveDeck(); render(); };
        slot.appendChild(rm); slots.appendChild(slot);
      } else slots.appendChild(el("div", "deck-slot empty", "empty"));
    }
    side.appendChild(slots);
    const row = el("div", "btn-row");
    const clearBtn = el("button", "big-btn secondary sm", "Clear"); clearBtn.onclick = () => { state.deck = []; saveDeck(); render(); };
    const fillBtn = el("button", "big-btn secondary sm", "Random"); fillBtn.onclick = () => { state.deck = defaultDeck(); saveDeck(); render(); };
    row.append(clearBtn, fillBtn); side.appendChild(row);
    const playBtn = el("button", "big-btn", "▶ Play with this deck"); playBtn.style.marginTop = "8px";
    playBtn.onclick = startGame; if (state.deck.length !== DECK_SIZE) playBtn.disabled = true;
    side.appendChild(playBtn);
    wrap.appendChild(side);
    view.appendChild(wrap);
  }

  // ---- Collection ---------------------------------------------------------
  function renderCollection() {
    const wrap = el("div", "collection-view");
    const head = el("div", "panel coll-head");
    const list = filteredCards();
    head.appendChild(el("h3", null, `📚 Collection <span class="muted">— ${Math.min(list.length, POOL_CAP)} of ${list.length}</span>`));
    head.appendChild(el("p", "muted", "Play cards in duels to earn XP, then level them up to raise their Damage."));
    head.appendChild(filterBar());
    wrap.appendChild(head);
    const grid = el("div", "coll-grid");
    list.slice(0, POOL_CAP).forEach((c) => grid.appendChild(collectionCard(c)));
    if (list.length > POOL_CAP) grid.appendChild(el("div", "more-note", `+${list.length - POOL_CAP} more — filter by clan or search`));
    wrap.appendChild(grid);
    view.appendChild(wrap);
  }

  function collectionCard(c) {
    const p = state.progress[c.id];
    const item = el("div", "coll-item panel");
    item.appendChild(cardNode(attachXp(cardStatsAtLevel(c, p.level), c.id), { size: "md" }));
    const info = el("div", "coll-info");
    const atMax = p.level >= c.stars;
    info.appendChild(el("div", "coll-level", `Level ${p.level}/${c.stars} <span class="rarity ${c.rarity}">${c.rarity}</span>`));
    if (!atMax) {
      const need = xpForLevel(c, p.level);
      const bar = el("div", "xp-bar"); bar.appendChild(el("div", "xp-fill")).style.width = Math.min(100, Math.round((p.xp / need) * 100)) + "%";
      info.appendChild(bar);
      info.appendChild(el("div", "xp-text", `${p.xp} / ${need} XP`));
      const btn = el("button", "level-btn", "⬆ Level Up"); btn.disabled = !canLevel(c.id);
      btn.onclick = () => { if (doLevelUp(c.id)) { toast(`${c.name} → Level ${state.progress[c.id].level}!`); render(); } };
      info.appendChild(btn);
    } else info.appendChild(el("div", "max-tag", "★ MAX LEVEL"));
    const cur = cardStatsAtLevel(c, p.level), max = cardStatsAtLevel(c, c.stars);
    info.appendChild(el("div", "coll-stats", `<span class="pow">${cur.power} Pwr</span> · <span class="dmg">${cur.damage} Dmg</span>` + (atMax ? "" : `<br><small class="muted">max: ${max.power}/${max.damage}</small>`)));
    info.appendChild(el("div", "coll-ability", c.abilityText ? `<b>${cur.abilityActive ? "✓" : "🔒"}</b> ${c.abilityText}` : `<span class="muted">No ability</span>`));
    item.appendChild(info);
    return item;
  }

  // ---- Battle -------------------------------------------------------------
  function startGame() {
    if (state.deck.length !== DECK_SIZE) { toast(`Build a deck of ${DECK_SIZE} first`); return go("deck"); }
    state.game = URBC.newGame(drawPlayerHand(), buildAiHand(), { life: 12, pillz: 12, rounds: 4 });
    state.arena = ARENAS[Math.floor(Math.random() * ARENAS.length)];
    state.aiLevel = Math.max(1, playerLevel() + randInt(-2, 3));
    state.slots = { player: state.game.hand.player.slice(), ai: state.game.hand.ai.slice() };
    state.clashInfo = {};
    state.sel = { uid: null, pillz: 0, fury: false }; state.result = null; state.matchXp = {};
    state.view = "battle";
    state.game.log.push("⚔️ Duel begins — 12 life, 12 pillz, 4 rounds.");
    render();
  }
  function drawPlayerHand() { return shuffle(state.deck.slice()).slice(0, HAND_SIZE).map((id) => liveStats(id)); }
  function buildAiHand() {
    const clansWith = CLAN_ORDER.filter((k) => CARDS.filter((c) => c.clan === k).length >= 2);
    const pick = shuffle(clansWith.slice()).slice(0, 2);
    let cards = [];
    pick.forEach((k) => { const cc = shuffle(CARDS.filter((c) => c.clan === k)); cards.push(cc[0], cc[1]); });
    return cards.slice(0, HAND_SIZE).map((c) => cardStatsAtLevel(c, randInt(minLevel(c), c.stars)));
  }
  const selectedCard = () => (state.sel.uid ? state.game.hand.player.find((c) => c && c.uid === state.sel.uid) || null : null);
  const availPillz = () => state.game.pillz.player;
  const maxAttackPillz = () => Math.max(0, availPillz() - (state.sel.fury ? 3 : 0));

  function renderBattle() {
    const g = state.game;
    const wrap = el("div", "battle");
    if (state.arena) {
      wrap.style.backgroundImage = `linear-gradient(rgba(8,8,12,.22), rgba(6,6,9,.5)), url('ui/assets/bg/${state.arena}')`;
      wrap.style.backgroundSize = "cover";
      wrap.style.backgroundPosition = "center";
    }
    wrap.appendChild(boardSide("ai"));
    wrap.appendChild(centerStrip());
    wrap.appendChild(boardSide("player"));
    wrap.appendChild(moveBar());
    const log = el("div", "log-panel");
    g.log.slice(-6).reverse().forEach((l) => log.appendChild(el("div", "entry", l)));
    wrap.appendChild(log);
    view.appendChild(wrap);
  }

  const VITAL_ICON = { life: "❤", pillz: "💊" };
  function vitalChip(kind, value) {
    const chip = el("div", "vital " + kind);
    chip.appendChild(el("span", "vi", VITAL_ICON[kind]));
    chip.appendChild(el("span", "vv", String(value)));
    return chip;
  }
  function fighterHud(side) {
    const g = state.game, isAi = side === "ai";
    const info = el("div", "fighter");
    info.appendChild(el("div", "avatar " + side, isAi ? "🤖" : "🧑"));
    const meta = el("div", "fighter-meta");
    const lvl = isAi ? (state.aiLevel || 1) : playerLevel();
    const name = el("div", "fighter-name");
    name.append(document.createTextNode(isAi ? "AI Challenger" : "You"), el("span", "plevel", `Lv ${lvl}`));
    meta.appendChild(name);
    const vitals = el("div", "vitals");
    vitals.appendChild(vitalChip("life", g.life[side]));
    vitals.appendChild(vitalChip("pillz", g.pillz[side]));
    meta.appendChild(vitals);
    info.appendChild(meta);
    return info;
  }

  // The two 4-card rows ARE the battlefield (Urban-Rivals style); cards clash in place.
  function boardSide(side) {
    const g = state.game, isAi = side === "ai";
    const board = el("div", "board " + (isAi ? "opp" : "you"));
    const row = el("div", "hand-row");
    (state.slots[side] || g.hand[side]).forEach((card) => row.appendChild(slotCard(side, card)));
    if (isAi) board.append(fighterHud(side), row); else board.append(row, fighterHud(side));
    return board;
  }

  function slotCard(side, card) {
    const g = state.game, isAi = side === "ai";
    if (!card) return el("div", "ur-card slot-empty");
    const played = !g.hand[side].some((c) => c && c.uid === card.uid);
    if (played) {
      const ci = state.clashInfo[card.uid] || {};
      const node = cardNode(card, { played: true, winner: ci.won === true, loser: ci.won === false, effect: { abilityInEffect: ci.ability, bonusInEffect: ci.bonus } });
      const tag = el("div", "clash-tag");
      tag.innerHTML = `<span class="atk">⚔ ${ci.attack != null ? ci.attack : "?"}</span> <span class="muted">${ci.pillz || 0}💊${ci.fury ? " 🔥" : ""}</span>`;
      node.appendChild(tag);
      return node;
    }
    if (isAi) return cardNode(card, {});
    return cardNode(card, { selected: state.sel.uid === card.uid, onClick: () => { state.sel = { uid: card.uid, pillz: 0, fury: false }; render(); } });
  }

  function centerStrip() {
    const g = state.game, r = state.result, strip = el("div", "center-strip");
    if (r) {
      const won = r.winner === "player";
      strip.appendChild(el("div", "cs-verdict " + (won ? "win" : "lose"), won ? "ROUND WON" : "ROUND LOST"));
      strip.appendChild(el("div", "cs-atk", `${r.attack.ai} <span class="vs">⚔</span> ${r.attack.player}`));
      strip.appendChild(el("div", "cs-detail", roundDetail(r)));
    } else {
      strip.appendChild(el("div", "cs-round", `Round ${g.round}/${g.maxRounds} · ${g.timeOfDay === "day" ? "☀ Day" : "🌙 Night"}`));
      strip.appendChild(el("div", "cs-vs", "VS"));
      strip.appendChild(el("div", "cs-note", `${g.round % 2 === 1 ? "You" : "AI"} win ties`));
    }
    return strip;
  }

  function roundDetail(r) {
    const bits = [];
    if (r.dealt > 0) bits.push(`${r.winner === "player" ? "You" : "AI"} dealt <b>${r.dealt}</b> dmg`);
    ["player", "ai"].forEach((s) => {
      const who = s === "player" ? "Your" : "AI";
      if (r.abilityStopped[s]) bits.push(`${who} ability STOPPED`);
      else if (r.abilityInEffect[s]) bits.push(`${who} ability`);
      if (r.bonusStopped[s]) bits.push(`${who} bonus STOPPED`);
      else if (r.bonusInEffect[s]) bits.push(`${who} bonus`);
    });
    if (r.poisonTick.player) bits.push(`You −${r.poisonTick.player} poison`);
    if (r.poisonTick.ai) bits.push(`AI −${r.poisonTick.ai} poison`);
    if (r.healed) bits.push(`+${r.healed} life`);
    if (r.lifeGain) bits.push(`+${r.lifeGain} life`);
    if (r.pillzGain) bits.push(`+${r.pillzGain} pillz`);
    if (r.oppLifeLoss) bits.push(`−${r.oppLifeLoss} opp life`);
    if (r.oppPillzLoss) bits.push(`−${r.oppPillzLoss} opp pillz`);
    return bits.join(" · ") || "—";
  }

  function moveBar() {
    const g = state.game, bar = el("div", "move-bar panel"), sel = selectedCard();
    if (!sel) { bar.appendChild(el("div", "move-hint", state.result ? "Select your next card above ☝" : "Select a card from your hand to begin ☝")); return bar; }
    const left = el("div", "move-card"); left.appendChild(cardNode(sel, { size: "sm" })); bar.appendChild(left);
    const ctrl = el("div", "move-ctrl");
    ctrl.appendChild(el("div", "atk-preview", `Attack <b>${URBC.previewAttack(sel.power, state.sel.pillz)}</b> <small>= ${sel.power} × (1 + ${state.sel.pillz})</small>`));
    const wheel = el("div", "pillz-wheel");
    const minus = el("button", "wheel-btn", "−"); minus.onclick = () => { state.sel.pillz = Math.max(0, state.sel.pillz - 1); render(); };
    const orbs = el("div", "pillz-orbs");
    for (let i = 0; i < availPillz(); i++) orbs.appendChild(el("span", i < state.sel.pillz ? "orb used" : (state.sel.fury && i >= maxAttackPillz() ? "orb fury" : "orb")));
    const plus = el("button", "wheel-btn", "+"); plus.onclick = () => { state.sel.pillz = Math.min(maxAttackPillz(), state.sel.pillz + 1); render(); };
    wheel.append(minus, orbs, plus); ctrl.appendChild(wheel);
    ctrl.appendChild(el("div", "pillz-count", `${state.sel.pillz} pillz used · ${availPillz() - state.sel.pillz - (state.sel.fury ? 3 : 0)} left`));
    const fury = el("button", "fury-toggle" + (state.sel.fury ? " on" : ""), `🔥 Fury ${state.sel.fury ? "ON" : "OFF"} (3💊, +2 dmg)`);
    fury.disabled = availPillz() < 3 && !state.sel.fury;
    fury.onclick = () => { state.sel.fury = !state.sel.fury; if (state.sel.pillz > maxAttackPillz()) state.sel.pillz = maxAttackPillz(); render(); };
    ctrl.appendChild(fury);
    const fight = el("button", "fight-btn", "⚔ FIGHT!"); fight.onclick = doRound; ctrl.appendChild(fight);
    bar.appendChild(ctrl);
    return bar;
  }

  function doRound() {
    const g = state.game, card = selectedCard();
    if (!card) return toast("Pick a card");
    const aiMove = URBC.aiPick(g);
    if (!aiMove) return endGame(URBC.isGameOver(g) || "player");
    const r = URBC.resolveRound(g, { player: { card, pillz: state.sel.pillz, fury: state.sel.fury }, ai: aiMove });
    state.result = r;
    state.clashInfo[r.card.player.uid] = { pillz: r.pillz.player, fury: r.fury.player, attack: r.attack.player, won: r.winner === "player", ability: r.abilityInEffect.player, bonus: r.bonusInEffect.player };
    state.clashInfo[r.card.ai.uid] = { pillz: r.pillz.ai, fury: r.fury.ai, attack: r.attack.ai, won: r.winner === "ai", ability: r.abilityInEffect.ai, bonus: r.bonusInEffect.ai };
    const pid = r.card.player.id;
    state.matchXp[pid] = (state.matchXp[pid] || 0) + 8 + (r.winner === "player" ? 14 : 0);
    g.log.push(`R${r.round}: ${r.winner === "player" ? "You WIN" : "AI wins"} — ${r.card.player.name} (${r.attack.player}) vs ${r.card.ai.name} (${r.attack.ai})${r.dealt ? `, ${r.dealt} dmg` : ""}`);
    state.sel = { uid: null, pillz: 0, fury: false };
    const over = URBC.isGameOver(g);
    if (over) return endGame(over);
    render();
  }

  function endGame(winner) {
    const g = state.game; g.result = winner;
    if (winner === "player") for (const id of Object.keys(state.matchXp)) state.matchXp[id] += 30;
    state.readyToLevel = grantMatchXp();
    g.log.push(winner === "player" ? "🏆 VICTORY!" : winner === "ai" ? "💀 DEFEAT" : "🤝 DRAW");
    state.view = "gameover"; render();
  }

  function renderGameover() {
    const g = state.game, w = g.result;
    const wrap = el("div", "gameover " + (w === "player" ? "win" : w === "ai" ? "lose" : "draw"));
    wrap.appendChild(el("h2", null, w === "player" ? "🏆 VICTORY" : w === "ai" ? "💀 DEFEAT" : "🤝 DRAW"));
    wrap.appendChild(el("p", "final-score", `Final life — You ❤ ${g.life.player} · AI ❤ ${g.life.ai}`));
    const xpEntries = Object.entries(state.matchXp);
    if (xpEntries.length) {
      const box = el("div", "xp-summary panel"); box.appendChild(el("h3", null, "XP gained"));
      xpEntries.forEach(([id, amt]) => box.appendChild(el("div", "xp-line", `${CARD_BY_ID[id].name}: <b>+${amt} XP</b>`)));
      if (state.readyToLevel.length) box.appendChild(el("div", "xp-ready", "✨ Ready to level: " + state.readyToLevel.join(", ")));
      wrap.appendChild(box);
    }
    const actions = el("div", "menu-actions");
    const again = el("button", "big-btn", "↻ Rematch"); again.onclick = startGame;
    const coll = el("button", "big-btn secondary", "📚 Collection"); coll.onclick = () => go("collection");
    const menu = el("button", "big-btn secondary", "← Menu"); menu.onclick = () => go("menu");
    actions.append(again, coll, menu); wrap.appendChild(actions);
    view.appendChild(wrap);
  }

  // ---- misc ---------------------------------------------------------------
  function go(v) { state.view = v; if (v === "menu") { state.search = ""; } render(); }
  function toast(msg) { const t = el("div", "toast", msg); document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

  // ---- init ---------------------------------------------------------------
  view.innerHTML = '<div class="loading">⚔️ Loading Clint City roster…</div>';
  (async function init() {
    try { await window.URBC_DATA_READY; }
    catch (e) {
      view.innerHTML = `<div class="panel load-error"><h3>Couldn't load card data</h3><p>${e.message}</p><p class="muted">Serve the folder over HTTP and ensure <code>data/cards-data.json</code> exists (run <code>node tools/fetch-cards.js</code>).</p></div>`;
      return;
    }
    state.progress = loadProgress();
    state.deck = loadDeck();
    document.querySelectorAll(".nav-btn").forEach((b) => { b.onclick = () => go(b.dataset.view); });
    render();
  })();
})();
