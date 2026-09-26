export const MODULE_ID = "wyrt-dimensional";
export const SOCKET_NAME = `module.${MODULE_ID}`;

// Artes das cartas. Por padrão usa os baralhos que já vêm com o Foundry
// (public/cards); o mestre pode apontar uma pasta própria com os arquivos
// nomeados como "copas 2.png", "espadas K.png", "coringa preto.png", "verso.png".
export const ART_STYLES = Object.freeze({
  "dark-gold": { label: "Foundry — escuro e dourado", folder: "cards/dark-gold", back: "cards/backs/dark-gold.webp", jokers: { black: "joker", red: "joker" } },
  "light-soft": { label: "Foundry — claro", folder: "cards/light-soft", back: "cards/backs/light-soft.webp", jokers: { black: "black-joker", red: "red-joker" } },
  custom: { label: "Pasta personalizada" }
});
const ENGLISH_SUITS = Object.freeze({ paus: "clubs", copas: "hearts", espadas: "spades", ouros: "diamonds" });
const ENGLISH_RANKS = Object.freeze({ A: "ace", J: "jack", Q: "queen", K: "king" });
let cardArt = { style: "dark-gold", folder: "" };

export function setCardArt({ style, folder } = {}) {
  const cleanFolder = String(folder ?? "").trim().replace(/\/+$/, "");
  cardArt = {
    style: style === "custom" && cleanFolder ? "custom" : (ART_STYLES[style]?.folder ? style : "dark-gold"),
    folder: cleanFolder
  };
}

export function cardBack() {
  if (cardArt.style === "custom") return customFile("verso");
  return route(ART_STYLES[cardArt.style].back);
}

function cardImage(card) {
  if (cardArt.style === "custom") {
    return customFile(card.special === "joker" ? `coringa ${card.id === "joker-red" ? "vermelho" : "preto"}` : `${card.suit} ${card.rank}`);
  }
  const style = ART_STYLES[cardArt.style];
  if (card.special === "joker") return route(`${style.folder}/${style.jokers[card.id === "joker-red" ? "red" : "black"]}.webp`);
  const rank = ENGLISH_RANKS[card.rank] ?? card.rank.padStart(2, "0");
  return route(`${style.folder}/${ENGLISH_SUITS[card.suit]}-${rank}.webp`);
}

function customFile(name) {
  const file = encodeURIComponent(`${name}.png`);
  if (/^(https?:)?\/\//i.test(cardArt.folder)) return `${cardArt.folder}/${file}`;
  const folder = cardArt.folder.split("/").map(segment => encodeURIComponent(decodeURIComponentSafe(segment))).join("/");
  return route(`${folder}/${file}`);
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function route(path) {
  return globalThis.foundry?.utils?.getRoute?.(path) ?? path;
}

export const SUITS = Object.freeze({
  paus: {
    id: "paus",
    label: "Paus",
    action: "movement",
    actionLabel: "Ação de movimento",
    icon: "♣",
    color: "black"
  },
  copas: {
    id: "copas",
    label: "Copas",
    action: "standard",
    actionLabel: "Ação padrão (exceto atacar)",
    icon: "♥",
    color: "red"
  },
  espadas: {
    id: "espadas",
    label: "Espadas",
    action: "aggression",
    actionLabel: "Ação Agredir",
    icon: "♠",
    color: "black"
  },
  ouros: {
    id: "ouros",
    label: "Ouros",
    action: "full",
    actionLabel: "Ação completa",
    icon: "♦",
    color: "red"
  }
});

export const RANKS = Object.freeze(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

const rankNames = Object.freeze({ A: "Ás", J: "Valete", Q: "Rainha", K: "Rei" });
const cards = [];

for (const suit of Object.values(SUITS)) {
  for (const rank of RANKS) {
    cards.push(Object.freeze({
      id: `${suit.id}-${rank.toLowerCase()}`,
      suit: suit.id,
      rank,
      label: `${rankNames[rank] ?? rank} de ${suit.label}`,
      action: suit.action,
      actionLabel: suit.actionLabel,
      get image() { return cardImage(this); },
      special: rank === "A" ? "ace" : rank === "J" ? "jack" : rank === "Q" ? "queen" : rank === "K" ? "king" : null
    }));
  }
}

cards.push(Object.freeze({
  id: "joker-black",
  suit: null,
  rank: "JOKER",
  label: "Curinga Preto",
  action: null,
  actionLabel: "Emule qualquer outra carta",
  get image() { return cardImage(this); },
  special: "joker"
}));

cards.push(Object.freeze({
  id: "joker-red",
  suit: null,
  rank: "JOKER",
  label: "Curinga Vermelho",
  action: null,
  actionLabel: "Emule qualquer outra carta",
  get image() { return cardImage(this); },
  special: "joker"
}));

export const CARDS = Object.freeze(cards);
export const CARD_IDS = Object.freeze(CARDS.map(card => card.id));
export const CARD_BY_ID = new Map(CARDS.map(card => [card.id, card]));

export function getCard(cardId) {
  return CARD_BY_ID.get(cardId) ?? null;
}

export function highestNumericCard(cardIds = []) {
  let highest = 0;
  for (const cardId of cardIds) {
    const card = getCard(cardId);
    if (!card) continue;
    // O Curinga pode emular o 10, a maior carta numérica do baralho.
    if (card.special === "joker") highest = Math.max(highest, 10);
    else if (/^\d+$/.test(card.rank)) highest = Math.max(highest, Number(card.rank));
  }
  return highest;
}

export function actionLabel(action) {
  return Object.values(SUITS).find(suit => suit.action === action)?.actionLabel ?? "Ação";
}

export function actionShortLabel(action) {
  return ({
    movement: "Movimento",
    standard: "Padrão",
    aggression: "Agredir",
    full: "Completa"
  })[action] ?? "Ação";
}

export function specialLabel(special) {
  return ({
    ace: "Ação extra",
    jack: "Rerrolagem",
    queen: "Habilidade sem custo básico de PM",
    king: "+5 em um teste",
    joker: "Emular qualquer carta"
  })[special] ?? "";
}
