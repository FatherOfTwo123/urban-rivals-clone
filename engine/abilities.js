// ---------------------------------------------------------------------------
// abilities.js — parses every Urban Rivals ability / bonus into a structured,
// simulatable effect model. Honest about the few it can't model.
//
// effect = { raw, label, condition, ops:[...], supported, mechanical }
//   condition: always | support | growth | degrowth | equalizer
//            | courage | reprisal | confidence | revenge | day | night
//            | symmetry | asymmetry | unison | perfect | stop
//            | defeat | killshot | voordefeat | backlash | inactive
//   ops (atomic):
//     {t:'self'|'opp', stat:'power'|'damage'|'attack'|'life'|'pillz', value, min?, sub?, per?}
//     {kind:'poison'|'heal'|'dope', value, min|max}
//     {kind:'stopAbility'|'stopBonus'}
//     {kind:'copy', what:'power'|'damage'|'powerdamage'|'ability'|'bonus'}
//     {kind:'cancelMod', what:'power'|'damage'|'attack'|'life'|'pillz'|'powerdamage'|'all'}
//     {kind:'protect', what:'power'|'damage'|'attack'|'powerdamage'|'ability'|'bonus'}
//     {kind:'impose'|'exchange', what:'power'|'damage'|'powerdamage'}
//     {kind:'recover', num, of}     (pillz recovered out of those spent)
//   per: 'lifeLeft'|'pillzLeft'|'damage'|'lifeLost'|'cards' (runtime multiplier)
//   supported=false → real text shown but greyed (never silently mis-applied).
// ---------------------------------------------------------------------------
(function (root) {
  const STAT = { power: "power", pow: "power", pwr: "power", damage: "damage", dam: "damage", dmg: "damage", attack: "attack", att: "attack", atk: "attack", life: "life", pillz: "pillz" };
  const S = "power|pow|pwr|damage|dam|dmg|attack|att|atk|life|pillz";

  const SUPPORTED_PREFIX = {
    courage: "courage", reprisal: "reprisal", repris: "reprisal", confidence: "confidence",
    revenge: "revenge", support: "support", brawl: "support", brwl: "support", team: "support", unison: "unison",
    growth: "growth", degrowth: "degrowth", equalizer: "equalizer",
    defeat: "defeat", killshot: "killshot", "victory or defeat": "voordefeat",
    day: "day", night: "night", symmetry: "symmetry", asymmetry: "asymmetry",
    backlash: "backlash", stop: "stop", perfect: "perfect", xantiax: "backlash",
  };
  // genuinely contextual / not meaningful in a single duel — shown but greyed
  const COSMETIC_PREFIX = new Set(["versus", "perfection", "tie-break", "hazard", "limitless", "illusion", "overdose", "counter-attack", "beyond", "bypass", "remove ability conditions", "sinister symmetry"]);
  const COSMETIC_WORDS = ["reanimate", "rebirth", "tune out", "infiltrated", "cancel leader", "hazard", "limitless", "illusion", "overdose", "counter-attack", "perfection", "tie-break", "bypass", "beyond"];

  const num = (x) => parseInt(x, 10) || 0;
  const re = (p, f) => new RegExp(p, f || "gi");

  function detectPer(work) {
    if (/per\s+life\s+left/i.test(work)) return "lifeLeft";
    if (/per\s+pillz\s+left/i.test(work)) return "pillzLeft";
    if (/per\s+life\s+lost/i.test(work)) return "lifeLost";
    if (/per\s+damage/i.test(work)) return "damage";
    return null;
  }

  function parseOps(s) {
    const ops = [];
    let work = " " + s.replace(/\s+/g, " ").trim() + " ";
    const per = detectPer(work);
    const take = (rx, fn) => { let m; while ((m = rx.exec(work))) fn(m); work = work.replace(rx, " "); };
    const tag = (op) => { if (per && (op.stat === "attack" || op.t)) op.per = per; return op; };

    // --- keyword effects ---
    if (/stop\s*:?\s*opp\.?\s*ability/i.test(work) || /cancel\s+opp\.?\s*abilit/i.test(work)) ops.push({ kind: "stopAbility" });
    if (/stop\s*:?\s*opp\.?\s*bonus/i.test(work) || /cancel\s+opp\.?\s*bonus/i.test(work)) ops.push({ kind: "stopBonus" });
    work = work.replace(/(stop|cancel)\s*:?\s*opp\.?\s*(abilit\w*|bonus)/gi, " ");

    // Cancel Opp X Modifier(s) — tolerant of "Canc.", missing "Opp", "pow & dam" abbreviations
    take(re("canc\\w*\\.?\\s*:?\\s*(?:opp\\.?\\s*)?(pow\\w*\\s*(?:and|&)\\s*dam\\w*|pow\\w*\\s*\\/\\s*dam\\w*|pillz\\s*&\\s*life|power|pow|damage|dam|attack|att|life|pillz)\\.?\\s*mod"), (m) => {
      let w = m[1].toLowerCase().replace(/\s|\./g, "");
      if (/pow.*dam/.test(w)) w = "powerdamage"; else if (/pillz.*life|life.*pillz/.test(w)) w = "all";
      else w = STAT[w] || w;
      ops.push({ kind: "cancelMod", what: w });
    });
    // Protection: X
    take(re("protec\\w*\\.?\\s*:?\\s*(power\\s*(?:and|&)\\s*damage|cards?\\s*power\\s*(?:and|&)\\s*damage|power|pow|damage|dam|attack|att|ability|bonus)"), (m) => {
      let w = m[1].toLowerCase().replace(/cards?\s*/, "").replace(/\s|\./g, "");
      if (/power.*damage|pow.*dam/.test(w)) w = "powerdamage"; else w = STAT[w] || w;
      ops.push({ kind: "protect", what: w });
    });
    // Copy
    take(re("copy\\s*:?\\s*(?:opp\\.?\\s*)?(power\\s*(?:and|&)\\s*damage|power|pow|damage|dam|ability|bonus)(?:\\s*opp\\.?)?"), (m) => {
      let w = m[1].toLowerCase().replace(/\s|\./g, "");
      if (/power.*damage|pow.*dam/.test(w)) w = "powerdamage"; else w = STAT[w] || w;
      ops.push({ kind: "copy", what: w });
    });
    // Impose / Exchange
    take(re("(power\\s*(?:and|&)\\s*damage|power|pow|damage|dam)\\s+impose"), (m) => { let w = m[1].toLowerCase().replace(/\s|\./g, ""); w = /power.*dam|pow.*dam/.test(w) ? "powerdamage" : STAT[w] || w; ops.push({ kind: "impose", what: w }); });
    take(re("impose\\s+(power\\s*(?:and|&)\\s*damage|power|pow|damage|dam)"), (m) => { let w = m[1].toLowerCase().replace(/\s|\./g, ""); w = /power.*dam|pow.*dam/.test(w) ? "powerdamage" : STAT[w] || w; ops.push({ kind: "impose", what: w }); });
    take(re("(power\\s*(?:and|&)\\s*damage|power|pow|damage|dam)\\s+exchange"), (m) => { let w = m[1].toLowerCase().replace(/\s|\./g, ""); w = /power.*dam|pow.*dam/.test(w) ? "powerdamage" : STAT[w] || w; ops.push({ kind: "exchange", what: w }); });

    // Recover N Pillz Out Of M
    take(re("recov\\w*\\.?\\s+(\\d+)\\s+(?:players?\\s+)?pillz\\s+out\\s+of\\s+(\\d+)"), (m) => ops.push({ kind: "recover", num: num(m[1]), of: num(m[2]) }));

    // Poison-like (opp life over time) and pillz-drain
    take(re("(?:poison|toxin|corrupt|corrosion)\\.?\\s+(\\d+)\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => ops.push({ kind: "poison", value: num(m[1]), min: num(m[2]) }));
    take(re("(?:mindwipe|consume)\\.?\\s+(\\d+)\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => ops.push({ t: "opp", stat: "pillz", value: num(m[1]), min: num(m[2]) }));
    // Heal/Repair (life), Dope (pillz)
    take(re("(?:heal|regen|repair)\\.?\\s+(\\d+)\\s*,?\\s*max\\.?\\s*(\\d+)"), (m) => ops.push({ kind: "heal", value: num(m[1]), max: num(m[2]) }));
    take(re("dope\\.?\\s+(\\d+)\\s*,?\\s*max\\.?\\s*(\\d+)"), (m) => ops.push({ kind: "dope", value: num(m[1]), max: num(m[2]) }));
    // Combust N, Min M  (self pillz loss)
    take(re("combust\\.?\\s+(\\d+)\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => ops.push({ t: "self", stat: "pillz", value: num(m[1]), min: num(m[2]), sub: true }));

    // Opponent stat reductions (optionally "Cards" scaled), with min
    take(re("[-−]\\s*(\\d+)\\s+(?:cards?\\s+)?opp\\.?\\s+(" + S + ")\\.?(?:\\s*(?:and|&)\\s*(" + S + ")\\.?)?\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => {
      const cards = /cards?/i.test(m[0]); const mn = num(m[4]);
      const o1 = tag({ t: "opp", stat: STAT[m[2].toLowerCase()], value: num(m[1]), min: mn }); if (cards) o1.per = "cards"; ops.push(o1);
      if (m[3]) { const o2 = tag({ t: "opp", stat: STAT[m[3].toLowerCase()], value: num(m[1]), min: mn }); if (cards) o2.per = "cards"; ops.push(o2); }
    });
    // "-N Cards Stat, Min M" applied to SELF damage/attack (e.g. "-2 Cards Damage" = own damage scaled) -> opp reduction handled above; here self reductions w/o opp are backlash/players
    // Opp reductions without min
    take(re("[-−]\\s*(\\d+)\\s+opp\\.?\\s+(" + S + ")\\b"), (m) => ops.push(tag({ t: "opp", stat: STAT[m[2].toLowerCase()], value: num(m[1]), min: 0 })));
    // "-N Cards Stat, Min M" (no "Opp") — opponent reduction scaled by card count
    take(re("[-−]\\s*(\\d+)\\s+cards?\\s+(power|pow|damage|dam|attack|att)\\.?\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => ops.push({ t: "opp", stat: STAT[m[2].toLowerCase()], value: num(m[1]), min: num(m[3]), per: "cards" }));

    // Self boosts "Stat +N" / "Stat And Stat +N"
    take(re("(" + S + ")\\.?(?:\\s*(?:and|&)\\s*(" + S + ")\\.?)?\\s*\\+\\s*(\\d+)"), (m) => {
      ops.push(tag({ t: "self", stat: STAT[m[1].toLowerCase()], value: num(m[3]) }));
      if (m[2]) ops.push(tag({ t: "self", stat: STAT[m[2].toLowerCase()], value: num(m[3]) }));
    });
    // Self boosts "+N Stat" / "+N Players Stat"
    take(re("\\+\\s*(\\d+)\\s+(?:players?\\s+)?(" + S + ")\\b"), (m) => ops.push(tag({ t: "self", stat: STAT[m[2].toLowerCase()], value: num(m[1]) })));
    // Self losses "-N (Players) Life/Pillz, Min M" (backlash / players drawback)
    take(re("[-−]\\s*(\\d+)\\s+(?:players?\\s+)?(life|pillz)\\.?\\s*,?\\s*min\\.?\\s*(\\d+)"), (m) => ops.push({ t: "self", stat: STAT[m[2].toLowerCase()], value: num(m[1]), min: num(m[3]), sub: true }));
    take(re("[-−]\\s*(\\d+)\\s+(?:players?\\s+)?(life|pillz)\\b"), (m) => ops.push({ t: "self", stat: STAT[m[2].toLowerCase()], value: num(m[1]), min: 0, sub: true }));

    return ops;
  }

  function parseEffect(text) {
    if (!text) return null;
    const raw = String(text).trim();
    if (/^no ability$/i.test(raw)) return null;
    const low = raw.toLowerCase();
    if (COSMETIC_WORDS.some((w) => low.includes(w))) return { raw, label: raw, condition: "inactive", ops: parseOps(raw), supported: false, mechanical: false };

    let s = raw, prefixes = [], m;
    while ((m = s.match(/^\s*([A-Za-z][A-Za-z .\/-]*?)\s*:\s*/))) {
      const p = m[1].trim().toLowerCase().replace(/\./g, "");
      if (SUPPORTED_PREFIX[p] || COSMETIC_PREFIX.has(p)) { prefixes.push(p); s = s.slice(m[0].length); }
      else break;
    }
    const ops = parseOps(s);
    const cosmetic = prefixes.some((p) => COSMETIC_PREFIX.has(p));
    let condition = "always";
    for (const p of prefixes) if (SUPPORTED_PREFIX[p]) { condition = SUPPORTED_PREFIX[p]; break; }

    const supported = !cosmetic && ops.length > 0;
    return { raw, label: raw, condition: cosmetic ? "inactive" : condition, ops, supported, mechanical: supported };
  }

  const api = { parseEffect };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") { window.Abilities = api; window.parseEffect = parseEffect; }
})(typeof globalThis !== "undefined" ? globalThis : this);
