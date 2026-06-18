// ---------------------------------------------------------------------------
// Game engine — full Urban-Rivals-style resolution over the rich effect model
// (abilities.js). Multi-pass pipeline handling stops, protection, cancel-modifier,
// copy, impose/exchange, all stat/scaling conditions, and outcome effects
// (life/pillz/poison/heal/dope/recover/backlash). Emits per-side inEffect flags.
// ---------------------------------------------------------------------------
(function (root) {
  const clans = () => root.CLANS || {};
  const other = (s) => (s === "player" ? "ai" : "player");
  const priorityOf = (st) => (st.round % 2 === 1 ? "player" : "ai");
  const applyReductions = (b, reds) => { let v = b; for (const r of reds) v = Math.max(r.min, v - r.value); return v; };
  const instance = (stat, side, idx) => ({ ...stat, uid: `${side}-${idx}-${stat.id}` });
  const clanCounts = (hand) => { const c = {}; for (const x of hand) if (x) c[x.clan] = (c[x.clan] || 0) + 1; return c; };

  function newGame(playerHand, aiHand, opts = {}) {
    const maxLife = opts.life || 12, startPillz = opts.pillz || 12;
    const pHand = playerHand.map((c, i) => instance(c, "player", i));
    const aHand = aiHand.map((c, i) => instance(c, "ai", i));
    return {
      round: 1, maxRounds: opts.rounds || 4, maxLife, startPillz,
      timeOfDay: Math.random() < 0.5 ? "day" : "night",
      life: { player: maxLife, ai: maxLife }, pillz: { player: startPillz, ai: startPillz },
      hand: { player: pHand, ai: aHand }, clanCount: { player: clanCounts(pHand), ai: clanCounts(aHand) },
      wins: { player: 0, ai: 0 }, poison: { player: null, ai: null }, played: { player: [], ai: [] },
      lastRound: null, result: null, log: [],
    };
  }
  const bonusActive = (st, s, card) => (st.clanCount[s][card.clan] || 0) >= 2;
  const previewAttack = (power, pillz) => power * (1 + pillz);
  const OUTCOME_COND = new Set(["defeat", "killshot", "voordefeat", "backlash"]);

  function combatActive(eff, s, st) {
    switch (eff.condition) {
      case "always": case "support": case "growth": case "degrowth": case "equalizer": case "stop": return true;
      case "courage": return priorityOf(st) === s;
      case "reprisal": return priorityOf(st) !== s;
      case "confidence": return !!st.lastRound && st.lastRound.winner === s;
      case "revenge": return !!st.lastRound && st.lastRound.winner === other(s);
      case "day": return st.timeOfDay === "day";
      case "night": return st.timeOfDay === "night";
      case "symmetry": return st.round % 2 === 1;
      case "asymmetry": return st.round % 2 === 0;
      case "unison": return Object.keys(st.clanCount[s]).length === 1;
      case "perfect": return st.wins[s] === st.round - 1;
      default: return false;
    }
  }
  function scaleOf(eff, s, st, oppCard) {
    switch (eff.condition) {
      case "support": return Math.max(1, st.clanCount[s][eff._clan] || 1);
      case "growth": return st.round;
      case "degrowth": return st.maxRounds - st.round + 1;
      case "equalizer": return oppCard.stars || 1;
      default: return 1;
    }
  }
  function perMul(op, s, st, dealt) {
    switch (op.per) {
      case "cards": return st.hand[s].filter(Boolean).length || 1;
      case "lifeLeft": return st.life[s];
      case "pillzLeft": return st.pillz[s];
      case "lifeLost": return Math.max(0, st.maxLife - st.life[s]);
      case "damage": return dealt || 0;
      default: return 1;
    }
  }
  function gather(st, s, card) {
    const out = [];
    if (card.abilityActive && card.ability && card.ability.supported) out.push({ ...card.ability, _clan: card.clan, _src: "ability" });
    if (bonusActive(st, s, card)) { const b = clans()[card.clan] && clans()[card.clan].bonus; if (b && b.supported) out.push({ ...b, _clan: card.clan, _src: "bonus" }); }
    return out;
  }

  function resolveRound(st, choice) {
    const sides = ["player", "ai"];
    const card = { player: choice.player.card, ai: choice.ai.card };
    const pillz = { player: choice.player.pillz | 0, ai: choice.ai.pillz | 0 };
    const fury = { player: !!choice.player.fury, ai: !!choice.ai.fury };
    for (const s of sides) { const sp = pillz[s] + (fury[s] ? 3 : 0); if (pillz[s] < 0) throw new Error("pillz>=0"); if (sp > st.pillz[s]) throw new Error(s + " overspend"); }

    const C = clans();
    const rawAbility = { player: card.player.abilityActive && card.player.ability && card.player.ability.supported ? card.player.ability : null, ai: card.ai.abilityActive && card.ai.ability && card.ai.ability.supported ? card.ai.ability : null };
    const rawBonus = {};
    for (const s of sides) { const b = bonusActive(st, s, card[s]) && C[card[s].clan] && C[card[s].clan].bonus; rawBonus[s] = b && b.supported ? b : null; }
    const E = { player: gather(st, "player", card.player), ai: gather(st, "ai", card.ai) };
    const applied = { player: { ability: false, bonus: false }, ai: { ability: false, bonus: false } };
    const mark = (s, e) => { applied[s][e._src] = true; };

    // PASS A — meta (stops / protection / cancel) from combat-active effects
    const protect = { player: {}, ai: {} }, cancel = { player: {}, ai: {} }, wantStop = { player: {}, ai: {} };
    for (const s of sides) for (const e of E[s]) { if (!combatActive(e, s, st)) continue; for (const op of e.ops) {
      if (op.kind === "stopAbility") wantStop[s].ability = true;
      else if (op.kind === "stopBonus") wantStop[s].bonus = true;
      else if (op.kind === "protect") protect[s][op.what] = true;
      else if (op.kind === "cancelMod") cancel[s][op.what] = true;
    } }
    const stopped = { player: { ability: false, bonus: false }, ai: { ability: false, bonus: false } };
    for (const s of sides) { const o = other(s);
      if (wantStop[s].ability && !protect[o].ability) stopped[o].ability = true;
      if (wantStop[s].bonus && !protect[o].bonus) stopped[o].bonus = true;
    }
    const srcOk = (s, e) => combatActive(e, s, st) && !stopped[s][e._src];
    // mark meta effects that activated
    for (const s of sides) for (const e of E[s]) { if (!srcOk(s, e)) continue; for (const op of e.ops) if (["stopAbility", "stopBonus", "protect", "cancelMod"].includes(op.kind)) mark(s, e); }

    // PASS B — copy (base overrides + copied effects)
    const base = { player: { power: card.player.power, damage: card.player.damage }, ai: { power: card.ai.power, damage: card.ai.damage } };
    for (const s of sides) { const o = other(s);
      for (const e of E[s].slice()) { if (!srcOk(s, e)) continue; for (const op of e.ops) {
        if (op.kind !== "copy") continue;
        if (op.what === "power" || op.what === "powerdamage") base[s].power = base[o].power;
        if (op.what === "damage" || op.what === "powerdamage") base[s].damage = base[o].damage;
        if (op.what === "ability" && rawAbility[o]) E[s].push({ ...rawAbility[o], _clan: e._clan, _src: e._src, ops: rawAbility[o].ops.filter((x) => x.kind !== "copy") });
        if (op.what === "bonus" && rawBonus[o]) E[s].push({ ...rawBonus[o], _clan: e._clan, _src: e._src, ops: rawBonus[o].ops.filter((x) => x.kind !== "copy") });
        mark(s, e);
      } }
    }
    // exchange / impose on base stats
    for (const s of sides) { const o = other(s);
      for (const e of E[s].slice()) { if (!srcOk(s, e)) continue; for (const op of e.ops) {
        if (op.kind === "exchange") { if (op.what === "power" || op.what === "powerdamage") { const t = base[s].power; base[s].power = base[o].power; base[o].power = t; } if (op.what === "damage" || op.what === "powerdamage") { const t = base[s].damage; base[s].damage = base[o].damage; base[o].damage = t; } mark(s, e); }
        else if (op.kind === "impose") { if (op.what === "power" || op.what === "powerdamage") base[o].power = base[s].power; if (op.what === "damage" || op.what === "powerdamage") base[o].damage = base[s].damage; mark(s, e); }
      } }
    }

    // PASS C — accumulate stat modifiers; queue outcome ops
    const add = { player: { power: 0, damage: 0, attack: 0 }, ai: { power: 0, damage: 0, attack: 0 } };
    const reduce = { player: { power: [], damage: [], attack: [] }, ai: { power: [], damage: [], attack: [] } };
    const outcomeQ = [];
    const protectedStat = (o, stat) => protect[o][stat] || ((stat === "power" || stat === "damage") && protect[o].powerdamage);
    for (const s of sides) { const o = other(s);
      for (const e of E[s].slice()) {
        if (stopped[s][e._src]) continue;
        const outcomeCond = OUTCOME_COND.has(e.condition);
        if (!outcomeCond && !combatActive(e, s, st)) continue; // combat-condition not met this round
        const sc = scaleOf(e, s, st, card[o]);
        for (const op of e.ops) {
          if (op.kind && ["stopAbility", "stopBonus", "protect", "cancelMod", "copy", "impose", "exchange"].includes(op.kind)) continue;
          if (op.kind === "poison" || op.kind === "heal" || op.kind === "dope" || op.kind === "recover") { outcomeQ.push({ s, e, op }); continue; }
          if (op.stat === "power" || op.stat === "damage" || op.stat === "attack") {
            if (outcomeCond) continue; // outcome-only effects don't apply combat-stat mods
            const v = op.value * sc * perMul(op, s, st, 0);
            if (op.t === "self") { add[s][op.stat] += v; mark(s, e); }
            else if (!protectedStat(o, op.stat)) { reduce[o][op.stat].push({ value: v, min: op.min || 0 }); mark(s, e); }
            else mark(s, e); // attempted but blocked by protection
          } else { outcomeQ.push({ s, e, op }); } // life/pillz
        }
      }
    }
    // cancel modifiers — X cancels opponent's mods
    const cancelOut = { player: new Set(), ai: new Set() };
    for (const s of sides) { const o = other(s);
      for (const what in cancel[s]) {
        const list = what === "powerdamage" ? ["power", "damage"] : what === "all" ? ["life", "pillz"] : [what];
        for (const stat of list) {
          if (stat === "power" || stat === "damage" || stat === "attack") { add[o][stat] = 0; reduce[o][stat] = []; }
          else cancelOut[o].add(stat);
        }
      }
    }

    // effective stats
    const power = {}, attack = {}, damage = {};
    for (const s of sides) power[s] = Math.max(1, applyReductions(base[s].power + add[s].power, reduce[s].power));
    for (const s of sides) attack[s] = Math.max(0, Math.round(applyReductions(power[s] * (1 + pillz[s]) + add[s].attack, reduce[s].attack)));
    for (const s of sides) { let d = applyReductions(base[s].damage + add[s].damage, reduce[s].damage); if (fury[s]) d += 2; damage[s] = Math.max(0, d); }

    const priority = priorityOf(st);
    let winner = attack.player > attack.ai ? "player" : attack.ai > attack.player ? "ai" : priority;
    const loser = other(winner);
    const dominant = attack[winner] >= 2 * Math.max(1, attack[loser]);
    const dealt = damage[winner];
    st.life[loser] = Math.max(0, st.life[loser] - dealt);

    // PASS D — outcome ops
    const detail = { healed: 0, lifeGain: 0, pillzGain: 0, oppLifeLoss: 0, oppPillzLoss: 0, recovered: 0, selfLoss: 0 };
    function fire(s, op, backlash) {
      const o = other(s);
      if (op.kind === "poison") { const tgt = backlash ? s : o; st.poison[tgt] = { value: op.value, min: op.min }; return true; }
      if (op.kind === "heal") { if (st.life[s] < op.max) { const b = st.life[s]; st.life[s] = Math.min(op.max, b + op.value); detail.healed += st.life[s] - b; return true; } return false; }
      if (op.kind === "dope") { if (st.pillz[s] < op.max) { const b = st.pillz[s]; st.pillz[s] = Math.min(op.max, b + op.value); detail.pillzGain += st.pillz[s] - b; return true; } return false; }
      if (op.kind === "recover") { const spent = pillz[s] + (fury[s] ? 3 : 0); const rec = Math.floor(spent * op.num / op.of); if (rec > 0) { st.pillz[s] += rec; detail.recovered += rec; return true; } return false; }
      if (cancelOut[s].has(op.stat)) return false; // this side's life/pillz mods are cancelled
      const v = op.value * perMul(op, s, st, dealt);
      if (op.t === "self") {
        if (op.sub) { if (op.stat === "life") { const b = st.life[s]; st.life[s] = Math.max(op.min || 0, b - v); detail.selfLoss += b - st.life[s]; } else { const b = st.pillz[s]; st.pillz[s] = Math.max(op.min || 0, b - v); detail.selfLoss += b - st.pillz[s]; } }
        else if (op.stat === "life") { const b = st.life[s]; st.life[s] = Math.min(st.maxLife, b + v); detail.lifeGain += st.life[s] - b; }
        else { st.pillz[s] += v; detail.pillzGain += v; }
      } else {
        if (op.stat === "life") { const b = st.life[o]; st.life[o] = Math.max(op.min || 0, b - v); detail.oppLifeLoss += b - st.life[o]; }
        else { const b = st.pillz[o]; st.pillz[o] = Math.max(op.min || 0, b - v); detail.oppPillzLoss += b - st.pillz[o]; }
      }
      return true;
    }
    for (const { s, e, op } of outcomeQ) {
      const c = e.condition;
      const willFire = c === "defeat" ? s === loser : c === "killshot" ? (s === winner && dominant) : c === "voordefeat" ? true : c === "backlash" ? s === winner : s === winner;
      if (!willFire) continue;
      const sc = scaleOf(e, s, st, card[other(s)]);
      if (fire(s, { ...op, value: op.value * sc }, c === "backlash")) mark(s, e);
    }

    // poison tick
    const poisonTick = { player: 0, ai: 0 };
    for (const s of sides) { const p = st.poison[s]; if (p && st.life[s] > p.min) { const b = st.life[s]; st.life[s] = Math.max(p.min, b - p.value); poisonTick[s] = b - st.life[s]; } }

    for (const s of sides) st.pillz[s] = Math.max(0, st.pillz[s] - pillz[s] - (fury[s] ? 3 : 0));
    for (const s of sides) { const i = st.hand[s].findIndex((c) => c && c.uid === card[s].uid); if (i >= 0) st.hand[s][i] = null; st.played[s].push(card[s]); }
    st.wins[winner] += 1;

    const result = {
      round: st.round, priority, timeOfDay: st.timeOfDay, winner, loser, dominant,
      attack: { ...attack }, power: { ...power }, damage: { ...damage }, pillz: { ...pillz }, fury: { ...fury }, dealt,
      poisonTick, ...detail,
      hasAbility: { player: !!card.player.abilityText, ai: !!card.ai.abilityText },
      abilityInEffect: { player: applied.player.ability, ai: applied.ai.ability },
      bonusInEffect: { player: applied.player.bonus, ai: applied.ai.bonus },
      abilityStopped: { player: stopped.player.ability, ai: stopped.ai.ability },
      bonusStopped: { player: stopped.player.bonus, ai: stopped.ai.bonus },
      card: { player: { ...card.player }, ai: { ...card.ai } },
      lifeAfter: { ...st.life }, pillzAfter: { ...st.pillz },
    };
    st.lastRound = result;
    st.round += 1;
    return result;
  }

  function isGameOver(st) {
    if (st.life.player <= 0 && st.life.ai <= 0) return st.life.player === st.life.ai ? "draw" : st.life.player > st.life.ai ? "player" : "ai";
    if (st.life.player <= 0) return "ai";
    if (st.life.ai <= 0) return "player";
    const noCards = st.hand.player.filter(Boolean).length === 0 && st.hand.ai.filter(Boolean).length === 0;
    if (noCards || st.round > st.maxRounds) { if (st.life.player > st.life.ai) return "player"; if (st.life.ai > st.life.player) return "ai"; return "draw"; }
    return null;
  }

  function aiPick(st) {
    const hand = st.hand.ai.filter(Boolean);
    if (!hand.length) return null;
    const avail = st.pillz.ai, roundsLeft = st.maxRounds - st.round + 1;
    const ranked = hand.slice().sort((a, b) => b.power * b.damage - a.power * a.damage);
    const cardSel = ranked[Math.floor(Math.random() * Math.min(2, ranked.length))];
    const fair = Math.floor(avail / Math.max(1, roundsLeft));
    const r = Math.random();
    let pillz = r < 0.15 ? Math.max(0, fair - 2) : r < 0.75 ? fair + Math.floor(Math.random() * 3) : Math.min(avail, fair + 2 + Math.floor(Math.random() * 3));
    pillz = Math.max(0, Math.min(avail, pillz));
    let fury = false;
    if (avail - pillz >= 3 && (cardSel.damage + 2 >= st.life.player || Math.random() < 0.12)) fury = pillz + 3 <= avail;
    if (pillz + (fury ? 3 : 0) > avail) pillz = avail - (fury ? 3 : 0);
    return { card: cardSel, pillz: Math.max(0, pillz), fury };
  }

  const api = { newGame, resolveRound, isGameOver, aiPick, bonusActive, previewAttack };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") { window.URBC = api; Object.assign(window, api); }
})(typeof globalThis !== "undefined" ? globalThis : this);
