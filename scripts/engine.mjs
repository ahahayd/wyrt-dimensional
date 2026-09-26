import { CARD_IDS, getCard, highestNumericCard } from "./cards.mjs";

export const STATE_VERSION = 1;

export function defaultState() {
  return {
    schema: STATE_VERSION,
    revision: 0,
    active: false,
    combatId: null,
    round: 0,
    deck: [],
    discard: [],
    hands: {},
    foeHand: [],
    limits: {},
    foeLimit: 5,
    foeName: "",
    participants: [],
    foeCombatantId: null,
    autoInitiative: true,
    gmBlind: false,
    usage: {},
    initiativeScores: {},
    plays: {},
    discards: {},
    drawRequests: {},
    lastTransition: { serial: 0, type: null, target: null, cardIds: [] },
    lastDraw: { serial: 0, counts: {}, cards: {} }
  };
}

export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const state = { ...base, ...raw };
  state.deck = validCardList(raw.deck);
  state.discard = validCardList(raw.discard);
  state.hands = objectOfCardLists(raw.hands);
  state.foeHand = validCardList(raw.foeHand);
  state.limits = raw.limits && typeof raw.limits === "object" ? { ...raw.limits } : {};
  state.participants = Array.isArray(raw.participants) ? [...new Set(raw.participants.filter(String))] : [];
  state.usage = raw.usage && typeof raw.usage === "object" ? structuredCloneSafe(raw.usage) : {};
  state.initiativeScores = raw.initiativeScores && typeof raw.initiativeScores === "object" ? { ...raw.initiativeScores } : {};
  state.plays = raw.plays && typeof raw.plays === "object" && !Array.isArray(raw.plays) ? structuredCloneSafe(raw.plays) : {};
  state.discards = raw.discards && typeof raw.discards === "object" && !Array.isArray(raw.discards) ? structuredCloneSafe(raw.discards) : {};
  state.drawRequests = raw.drawRequests && typeof raw.drawRequests === "object" && !Array.isArray(raw.drawRequests) ? structuredCloneSafe(raw.drawRequests) : {};
  state.lastTransition = raw.lastTransition && typeof raw.lastTransition === "object"
    ? {
        serial: Number(raw.lastTransition.serial) || 0,
        type: ["play", "discard"].includes(raw.lastTransition.type) ? raw.lastTransition.type : null,
        target: raw.lastTransition.target ?? null,
        cardIds: validCardList(raw.lastTransition.cardIds)
      }
    : base.lastTransition;
  state.lastDraw = raw.lastDraw && typeof raw.lastDraw === "object"
    ? {
        serial: Number(raw.lastDraw.serial) || 0,
        counts: { ...(raw.lastDraw.counts ?? {}) },
        cards: objectOfCardLists(raw.lastDraw.cards)
      }
    : base.lastDraw;
  state.revision = Number(raw.revision) || 0;
  state.round = Number(raw.round) || 0;
  state.foeLimit = clampLimit(raw.foeLimit, 5);
  state.autoInitiative = raw.autoInitiative !== false;
  state.gmBlind = raw.gmBlind === true;
  state.foeName = typeof raw.foeName === "string" ? raw.foeName.trim().slice(0, 60) : "";
  return state;
}

function structuredCloneSafe(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function validCardList(value) {
  return Array.isArray(value) ? value.filter(cardId => CARD_IDS.includes(cardId)) : [];
}

function objectOfCardLists(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, list]) => [key, validCardList(list)]));
}

export function clampLimit(value, fallback = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(12, Math.max(1, Math.trunc(number))) : fallback;
}

export function shuffle(list, rng = Math.random) {
  const shuffled = [...list];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

export function freshDeck(rng = Math.random) {
  return shuffle(CARD_IDS, rng);
}

export function startSession({ participantIds, combatId, round, foeCombatantId, limits = {}, foeLimit = 5, rng = Math.random }) {
  const state = defaultState();
  state.active = true;
  state.combatId = combatId ?? null;
  state.round = Math.max(0, Number(round) || 0);
  state.foeCombatantId = foeCombatantId || null;
  state.participants = [...new Set((participantIds ?? []).filter(String))];
  state.deck = freshDeck(rng);
  state.hands = Object.fromEntries(state.participants.map(userId => [userId, []]));
  state.limits = Object.fromEntries(state.participants.map(userId => [userId, clampLimit(limits[userId], 3)]));
  state.foeLimit = clampLimit(foeLimit, 5);
  resetUsage(state);
  fillAllHands(state, rng);
  updateInitiativeScores(state);
  return state;
}

export function beginRound(state, round, rng = Math.random) {
  state.round = Math.max(0, Number(round) || 0);
  resetUsage(state);
  fillAllHands(state, rng);
  updateInitiativeScores(state);
  return state;
}

export function resetUsage(state) {
  state.usage = Object.fromEntries([
    ...state.participants.map(userId => [userId, { round: state.round, movement: false, standard: false }]),
    ["foe", { round: state.round, movement: false, standard: false }]
  ]);
}

export function fillAllHands(state, rng = Math.random) {
  const counts = {};
  const cards = {};
  for (const userId of state.participants) {
    const drawn = drawTo(state, userId, clampLimit(state.limits[userId], 3), rng);
    if (drawn.length) {
      counts[userId] = drawn.length;
      cards[userId] = drawn;
    }
  }
  const foeDrawn = drawTo(state, "foe", clampLimit(state.foeLimit, 5), rng);
  if (foeDrawn.length) {
    counts.foe = foeDrawn.length;
    cards.foe = foeDrawn;
  }
  setLastDraw(state, counts, cards);
  return counts;
}

export function drawTo(state, target, limit, rng = Math.random) {
  const hand = getMutableHand(state, target);
  const drawn = [];
  while (hand.length < limit) {
    const cardId = drawOne(state, rng);
    if (!cardId) break;
    hand.push(cardId);
    drawn.push(cardId);
  }
  return drawn;
}

export function drawExtra(state, target, count = 1, rng = Math.random) {
  const hand = getMutableHand(state, target);
  const drawn = [];
  for (let index = 0; index < Math.max(0, Math.trunc(Number(count) || 0)); index += 1) {
    const cardId = drawOne(state, rng);
    if (!cardId) break;
    hand.push(cardId);
    drawn.push(cardId);
  }
  if (drawn.length) setLastDraw(state, { [target]: drawn.length }, { [target]: drawn });
  return drawn;
}

export function giveSpecific(state, target, cardId) {
  if (!getCard(cardId)) return false;
  let index = state.deck.indexOf(cardId);
  if (index >= 0) state.deck.splice(index, 1);
  else {
    index = state.discard.indexOf(cardId);
    if (index < 0) return false;
    state.discard.splice(index, 1);
  }
  getMutableHand(state, target).push(cardId);
  setLastDraw(state, { [target]: 1 }, { [target]: [cardId] });
  return true;
}

export function discardFromHand(state, target, cardId) {
  const hand = getMutableHand(state, target);
  const index = hand.indexOf(cardId);
  if (index < 0) return false;
  hand.splice(index, 1);
  state.discard.push(cardId);
  return true;
}

export function discardHand(state, target) {
  const hand = getMutableHand(state, target);
  if (!hand.length) return 0;
  const count = hand.length;
  state.discard.push(...hand.splice(0));
  return count;
}

export function playCard(state, target, cardId, choice = {}) {
  const card = getCard(cardId);
  if (!card) return { ok: false, error: "Carta inválida." };
  if (!getMutableHand(state, target).includes(cardId)) return { ok: false, error: "Essa carta não está mais na mão." };

  const isRa = target === "foe";
  const usage = state.usage[target] ?? { round: state.round, movement: false, standard: false };
  let action = card.action;
  let special = card.special;
  let consumesLimit = true;

  if (card.special === "joker") {
    if (choice.mode === "joker-special" && ["jack", "queen", "king"].includes(choice.special)) {
      special = choice.special;
      action = null;
      consumesLimit = false;
    } else if (choice.mode === "joker-ace" && ["movement", "standard", "aggression", "full"].includes(choice.action)) {
      special = "ace";
      action = choice.action;
      consumesLimit = false;
    } else {
      return { ok: false, error: "Escolha qual carta o Curinga irá emular." };
    }
  } else if (["jack", "queen", "king"].includes(card.special) && choice.mode === "special") {
    action = null;
    consumesLimit = false;
  } else if (card.special === "ace") {
    consumesLimit = false;
  }

  if (action && consumesLimit && !isRa) {
    spendAction(action, usage);
    state.usage[target] = usage;
  }

  discardFromHand(state, target, cardId);
  return { ok: true, card, action, special, consumesLimit, choice };
}

export function undoPlay(state, playId) {
  const play = state.plays?.[playId];
  if (!play || play.undone) return { ok: false, error: "Essa jogada já foi revertida ou não existe mais." };
  if (Number(play.round) !== Number(state.round)) return { ok: false, error: "Só é possível reverter uma carta na mesma rodada em que ela foi usada." };
  const discardIndex = state.discard.indexOf(play.cardId);
  if (discardIndex < 0) return { ok: false, error: "A carta já deixou o descarte e não pode mais ser revertida." };
  state.discard.splice(discardIndex, 1);
  const hand = getMutableHand(state, play.target);
  const handIndex = Math.min(Math.max(0, Number(play.handIndex) || 0), hand.length);
  hand.splice(handIndex, 0, play.cardId);
  play.undone = true;
  recomputeUsage(state, play.target);
  setLastDraw(state, { [play.target]: 1 }, { [play.target]: [play.cardId] });
  return { ok: true, play };
}

export function undoDiscard(state, discardId) {
  const transaction = state.discards?.[discardId];
  if (!transaction || transaction.undone) return { ok: false, error: "Esse descarte já foi revertido ou não existe mais." };
  if (Number(transaction.round) !== Number(state.round)) return { ok: false, error: "Só é possível reverter um descarte na mesma rodada." };
  const cards = Array.isArray(transaction.cards) ? transaction.cards : [];
  if (!cards.length) return { ok: false, error: "O descarte não contém cartas para devolver." };
  if (cards.some(entry => !state.discard.includes(entry.cardId))) return { ok: false, error: "Uma das cartas já deixou o descarte e a mão não pode ser restaurada." };

  for (const entry of cards) state.discard.splice(state.discard.indexOf(entry.cardId), 1);
  const hand = getMutableHand(state, transaction.target);
  for (const entry of [...cards].sort((a, b) => Number(a.index) - Number(b.index))) {
    const index = Math.min(Math.max(0, Number(entry.index) || 0), hand.length);
    hand.splice(index, 0, entry.cardId);
  }
  transaction.undone = true;
  setLastDraw(state, { [transaction.target]: cards.length }, { [transaction.target]: cards.map(entry => entry.cardId) });
  return { ok: true, transaction };
}

export function recomputeUsage(state, target) {
  const usage = { round: state.round, movement: false, standard: false };
  if (target === "foe") {
    state.usage.foe = usage;
    return usage;
  }
  const plays = Object.values(state.plays ?? {})
    .filter(play => play.target === target && Number(play.round) === Number(state.round) && !play.undone && play.consumesLimit && play.action)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence));
  for (const play of plays) spendAction(play.action, usage);
  state.usage[target] = usage;
  return usage;
}

function spendAction(action, usage) {
  if (action === "movement") usage.movement = true;
  if (["standard", "aggression"].includes(action)) usage.standard = true;
  if (action === "full") {
    usage.movement = true;
    usage.standard = true;
  }
}

function drawOne(state, rng) {
  if (!state.deck.length && state.discard.length) {
    state.deck = shuffle(state.discard, rng);
    state.discard = [];
  }
  return state.deck.pop() ?? null;
}

function getMutableHand(state, target) {
  if (target === "foe") return state.foeHand;
  state.hands[target] ??= [];
  return state.hands[target];
}

function setLastDraw(state, counts, cards = {}) {
  state.lastDraw = {
    serial: (Number(state.lastDraw?.serial) || 0) + 1,
    counts: { ...counts },
    cards: objectOfCardLists(cards)
  };
}

export function updateInitiativeScores(state) {
  state.initiativeScores = Object.fromEntries([
    ...state.participants.map(userId => [userId, highestNumericCard(state.hands[userId] ?? [])]),
    ["foe", highestNumericCard(state.foeHand)]
  ]);
  return state.initiativeScores;
}

export function validateState(state) {
  const locations = [...state.deck, ...state.discard, ...state.foeHand, ...Object.values(state.hands).flat()];
  const unknown = locations.filter(cardId => !CARD_IDS.includes(cardId));
  const duplicates = locations.filter((cardId, index) => locations.indexOf(cardId) !== index);
  return {
    valid: unknown.length === 0 && duplicates.length === 0 && locations.length <= CARD_IDS.length,
    unknown: [...new Set(unknown)],
    duplicates: [...new Set(duplicates)],
    located: locations.length
  };
}
