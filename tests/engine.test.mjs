import test from "node:test";
import assert from "node:assert/strict";

import { CARD_IDS, CARDS, highestNumericCard } from "../scripts/cards.mjs";
import {
  beginRound,
  discardFromHand,
  discardHand,
  drawExtra,
  freshDeck,
  giveSpecific,
  playCard,
  startSession,
  undoDiscard,
  undoPlay,
  validateState
} from "../scripts/engine.mjs";

const fixedRandom = () => 0.314159;

test("o baralho contém 54 cartas únicas", () => {
  assert.equal(CARDS.length, 54);
  assert.equal(new Set(CARD_IDS).size, 54);
  assert.equal(freshDeck(fixedRandom).length, 54);
});

test("a sessão compra 3 cartas por jogador e 5 para o adversário", () => {
  const state = startSession({ participantIds: ["u1", "u2"], combatId: "c1", round: 1, rng: fixedRandom });
  assert.equal(state.hands.u1.length, 3);
  assert.equal(state.hands.u2.length, 3);
  assert.equal(state.foeHand.length, 5);
  assert.equal(state.deck.length, 43);
  assert.deepEqual(state.lastDraw.counts, { u1: 3, u2: 3, foe: 5 });
  assert.equal(validateState(state).valid, true);
});

test("limites personalizados são usados desde a primeira compra", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, limits: { u1: 6 }, foeLimit: 7, rng: fixedRandom });
  assert.equal(state.hands.u1.length, 6);
  assert.equal(state.foeHand.length, 7);
  assert.equal(validateState(state).valid, true);
});

test("uma nova rodada conserva cartas e só completa a mão", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  const kept = state.hands.u1.slice(0, 2);
  discardFromHand(state, "u1", state.hands.u1[2]);
  beginRound(state, 2, fixedRandom);
  assert.equal(state.hands.u1.length, 3);
  assert.deepEqual(state.hands.u1.slice(0, 2), kept);
  assert.deepEqual(state.usage.u1, { round: 2, movement: false, standard: false });
});

test("ações registram o uso, mas não bloqueiam cartas adicionais", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["paus-2", "paus-3", "espadas-4", "ouros-5"];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id) && !state.foeHand.includes(id));
  state.discard = [];
  assert.equal(playCard(state, "u1", "paus-2", { mode: "action" }).ok, true);
  assert.equal(playCard(state, "u1", "paus-3", { mode: "action" }).ok, true);
  assert.equal(playCard(state, "u1", "espadas-4", { mode: "action" }).ok, true);
  assert.equal(playCard(state, "u1", "ouros-5", { mode: "action" }).ok, true);
  assert.deepEqual(state.usage.u1, { round: 1, movement: true, standard: true });
});

test("Ás não ocupa o limite e o adversário não tem limite de ações", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["copas-a", "copas-2"];
  state.foeHand = ["ouros-2", "ouros-3"];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id) && !state.foeHand.includes(id));
  assert.equal(playCard(state, "u1", "copas-a", { mode: "action" }).ok, true);
  assert.equal(state.usage.u1.standard, false);
  assert.equal(playCard(state, "u1", "copas-2", { mode: "action" }).ok, true);
  assert.equal(playCard(state, "foe", "ouros-2", { mode: "action" }).ok, true);
  assert.equal(playCard(state, "foe", "ouros-3", { mode: "action" }).ok, true);
});

test("figuras podem ativar benefício sem gastar o limite de ação", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["copas-j", "ouros-q", "espadas-k"];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id) && !state.foeHand.includes(id));
  for (const id of ["copas-j", "ouros-q", "espadas-k"]) assert.equal(playCard(state, "u1", id, { mode: "special" }).ok, true);
  assert.equal(state.usage.u1.movement, false);
  assert.equal(state.usage.u1.standard, false);
});

test("Curinga emula Ás ou uma figura", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["joker-black", "joker-red"];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id) && !state.foeHand.includes(id));
  assert.equal(playCard(state, "u1", "joker-black", { mode: "joker-ace", action: "full" }).ok, true);
  assert.equal(state.usage.u1.standard, false);
  assert.equal(playCard(state, "u1", "joker-red", { mode: "joker-special", special: "king" }).ok, true);
});

test("reverter devolve a carta e recalcula somente as ações ainda válidas", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["paus-2", "espadas-3"];
  state.foeHand = [];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id));
  state.discard = [];

  const movement = playCard(state, "u1", "paus-2", { mode: "action" });
  state.plays.p1 = { id: "p1", target: "u1", cardId: "paus-2", round: 1, handIndex: 0, action: movement.action, consumesLimit: true, sequence: 1, undone: false };
  const aggression = playCard(state, "u1", "espadas-3", { mode: "action" });
  state.plays.p2 = { id: "p2", target: "u1", cardId: "espadas-3", round: 1, handIndex: 0, action: aggression.action, consumesLimit: true, sequence: 2, undone: false };

  assert.deepEqual(state.usage.u1, { round: 1, movement: true, standard: true });
  assert.equal(undoPlay(state, "p1").ok, true);
  assert.deepEqual(state.usage.u1, { round: 1, movement: false, standard: true });
  assert.deepEqual(state.hands.u1, ["paus-2"]);
  assert.equal(state.discard.includes("paus-2"), false);
  assert.equal(validateState(state).valid, true);
});

test("reverter descarte devolve uma carta ou a mão inteira na ordem original", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  state.hands.u1 = ["paus-2", "copas-3", "espadas-4"];
  state.foeHand = [];
  state.deck = CARD_IDS.filter(id => !state.hands.u1.includes(id));
  state.discard = [];
  const cards = state.hands.u1.map((cardId, index) => ({ cardId, index }));

  assert.equal(discardHand(state, "u1"), 3);
  state.discards.d1 = { id: "d1", target: "u1", round: 1, cards, undone: false };
  assert.equal(undoDiscard(state, "d1").ok, true);
  assert.deepEqual(state.hands.u1, ["paus-2", "copas-3", "espadas-4"]);
  assert.deepEqual(state.lastDraw.cards.u1, ["paus-2", "copas-3", "espadas-4"]);
  assert.equal(state.discards.d1.undone, true);
  assert.equal(validateState(state).valid, true);
});

test("iniciativa usa apenas números e permite ao Curinga emular 10", () => {
  assert.equal(highestNumericCard(["copas-a", "espadas-q", "paus-8"]), 8);
  assert.equal(highestNumericCard(["copas-k", "espadas-j"]), 0);
  assert.equal(highestNumericCard(["paus-3", "joker-red"]), 10);
});

test("carta específica sai do monte ou do descarte sem duplicar", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  const fromDeck = state.deck[0];
  assert.equal(giveSpecific(state, "u1", fromDeck), true);
  assert.equal(state.deck.includes(fromDeck), false);
  assert.equal(giveSpecific(state, "u1", fromDeck), false);
  assert.equal(validateState(state).valid, true);
});

test("o descarte é reembaralhado quando o monte termina", () => {
  const state = startSession({ participantIds: ["u1"], combatId: "c1", round: 1, rng: fixedRandom });
  const card = state.deck.pop();
  state.discard = [...state.deck];
  state.deck = [card];
  const before = state.foeHand.length;
  drawExtra(state, "foe", 2, fixedRandom);
  assert.equal(state.foeHand.length, before + 2);
  assert.ok(state.deck.length > 0);
  assert.equal(state.discard.length, 0);
  assert.equal(validateState(state).valid, true);
});
