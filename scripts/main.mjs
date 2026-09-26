import {
  ART_STYLES,
  cardBack,
  MODULE_ID,
  setCardArt,
  SOCKET_NAME,
  actionLabel,
  getCard,
  specialLabel
} from "./cards.mjs";
import {
  beginRound,
  clampLimit,
  defaultState,
  discardFromHand,
  discardHand,
  drawExtra,
  fillAllHands,
  giveSpecific,
  normalizeState,
  playCard,
  undoDiscard,
  undoPlay,
  startSession,
  updateInitiativeScores,
  validateState
} from "./engine.mjs";
import { destroyUI, initializeUI, renderUI, setRemoteFoeHover } from "./ui.mjs";

const STATE_SETTING = "state";
const SETTINGS = Object.freeze({
  disabled: "disabled",
  quality: "visualQuality",
  hideOpponent: "hideOpponentHand",
  assistantSpectator: "assistantIsSpectator",
  spectator: "spectatorUserId",
  requireDrawApproval: "requireDrawApproval",
  artStyle: "cardArtStyle",
  artFolder: "cardArtFolder",
  rules: "rulesText"
});
const QUALITY_LEVELS = ["low", "medium", "high"];
let cachedState = defaultState();
let mutationQueue = Promise.resolve();

Hooks.once("init", () => {
  registerConfigurationSettings();
  game.settings.register(MODULE_ID, STATE_SETTING, {
    name: "Estado da sessão do Wyrt Dimensional",
    scope: "world",
    config: false,
    type: Object,
    default: defaultState(),
    onChange: value => {
      cachedState = normalizeState(value);
      if (game.ready && !isWyrtDisabled()) renderUI(cachedState);
    }
  });
});

Hooks.once("setup", applyCardArt);

Hooks.once("ready", () => {
  cachedState = normalizeState(game.settings.get(MODULE_ID, STATE_SETTING));
  refreshSpectatorChoices();
  if (isWyrtDisabled()) {
    destroyUI();
    return;
  }
  initializeUI({
    getState: () => cachedState,
    dispatch,
    nextRound,
    playerUsers,
    defaultParticipantIds,
    userLabel,
    encounters,
    isFullGM,
    isSpectator,
    visualQuality,
    hideOpponentHand,
    requiresDrawApproval,
    broadcastFoeHover,
    rulesText,
    saveRulesText
  });
  game.socket.on(SOCKET_NAME, onSocketMessage);
  game.socket.on("connect", requestStateSync);
  requestStateSync();
  exposeAPI();
  renderUI(cachedState);
  removeSpectatorParticipants();
});

Hooks.on("updateCombat", (combat, changes) => {
  if (isWyrtDisabled()) return;
  if (cachedState.combatId === combat.id && changes.turn !== undefined) renderUI(cachedState);
  if (!isAuthorityGM() || changes.round === undefined) return;
  enqueue(async () => {
    const state = currentState();
    if (!state.active || state.combatId !== combat.id || state.round === combat.round) return;
    beginRound(state, combat.round);
    await commitState(state);
    if (state.autoInitiative) await applyInitiative(state);
    await postRoundMessage(state);
  });
});

Hooks.on("deleteCombat", combat => {
  if (isWyrtDisabled()) return;
  if (!isAuthorityGM()) return;
  enqueue(async () => {
    const state = currentState();
    if (state.combatId !== combat.id) return;
    const clean = state.active ? endState(state) : state;
    clean.combatId = null;
    clean.foeCombatantId = null;
    await commitState(clean);
    if (state.active) notifyLocal("O encontro vinculado terminou; o Wyrt Dimensional foi encerrado.", "info");
  });
});

Hooks.on("updateUser", (user, changes) => {
  if ("name" in changes || "role" in changes) refreshSpectatorChoices();
  if (isWyrtDisabled()) return;
  if (game.ready) renderUI(cachedState);
  if (changes.active === true && isFullGM(user) && !isFullGM()) requestStateSync();
  if (changes.role !== undefined) removeSpectatorParticipants();
});

Hooks.on("createUser", () => refreshSpectatorChoices());
Hooks.on("deleteUser", () => refreshSpectatorChoices());

// Encontros e combatentes alimentam as listas do painel do mestre (encontro
// vinculado e combatente controlado como adversário); re-renderiza a cada mudança.
function refreshEncounterLists() {
  if (isWyrtDisabled()) return;
  if (game.ready) renderUI(cachedState);
}

Hooks.on("createCombat", refreshEncounterLists);
Hooks.on("createCombatant", refreshEncounterLists);
Hooks.on("updateCombatant", (combatant, changes) => {
  if ("name" in changes || "actorId" in changes || "tokenId" in changes) refreshEncounterLists();
});
Hooks.on("deleteCombatant", refreshEncounterLists);

Hooks.on("renderChatMessageHTML", (message, html) => activateChatControls(message, html));
// Compatibilidade com folhas de chat que ainda disparam o hook legado no V13.
Hooks.on("renderChatMessage", (message, html) => activateChatControls(message, html));

Hooks.once("shutdown", destroyUI);

function registerConfigurationSettings() {
  game.settings.register(MODULE_ID, SETTINGS.disabled, {
    name: "Desabilitar Wyrt Dimensional",
    hint: "Remove o botão, as HUDs e todas as interações do Wyrt para a mesa inteira. Apenas o Mestre pode alterar esta opção e todos os clientes devem recarregar.",
    scope: "world",
    config: true,
    requiresReload: true,
    restricted: true,
    type: Boolean,
    default: false,
    onChange: disabled => { if (disabled && game.ready) destroyUI(); }
  });

  game.settings.register(MODULE_ID, SETTINGS.quality, {
    name: "Qualidade visual",
    hint: "Vale apenas para este dispositivo. Alta mostra todos os efeitos; Média simplifica o voo das cartas e remove brilhos e sombras pesadas; Baixa desliga as animações para priorizar o desempenho.",
    scope: "client",
    config: true,
    type: String,
    choices: { high: "Alta (padrão)", medium: "Média", low: "Baixa" },
    default: "high",
    onChange: renderConfiguredUI
  });

  game.settings.register(MODULE_ID, SETTINGS.hideOpponent, {
    name: "Ocultar mão do adversário dimensional",
    hint: "Vale apenas para este dispositivo e só tem efeito para jogadores: esconde a mão fechada do adversário no topo da tela. Mestre e espectadores não são afetados.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: renderConfiguredUI
  });

  game.settings.register(MODULE_ID, SETTINGS.assistantSpectator, {
    name: "Assistente de GM é espectador",
    hint: "Ativado: usuários com cargo Assistente de GM acompanham todas as mãos abertas, sem controles. Desativado: eles são tratados como jogadores e podem participar com a própria mão.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: onSpectatorsChanged
  });

  game.settings.register(MODULE_ID, SETTINGS.spectator, {
    name: "Definir usuário como espectador",
    hint: "O usuário escolhido recebe a mesma tela do Assistente de GM: vê todas as mãos, mas não joga nem altera nada. Se estiver participando de uma sessão, sai dela e a mão vai para o descarte.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: spectatorChoices(),
    default: "",
    onChange: onSpectatorsChanged
  });

  game.settings.register(MODULE_ID, SETTINGS.requireDrawApproval, {
    name: "Jogadores devem pedir permissão para comprar cartas extras",
    hint: "Ativado: pedir uma carta extra envia um pedido ao Mestre, que aprova ou recusa pelo chat. Desativado: o jogador compra na hora e o Mestre recebe um aviso.",
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: renderConfiguredUI
  });

  game.settings.register(MODULE_ID, SETTINGS.artStyle, {
    name: "Artes das cartas",
    hint: "Os dois baralhos do Foundry já vêm prontos. Escolha Pasta personalizada para usar as suas próprias artes.",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    choices: Object.fromEntries(Object.entries(ART_STYLES).map(([key, style]) => [key, style.label])),
    default: "dark-gold",
    onChange: onCardArtChanged
  });

  game.settings.register(MODULE_ID, SETTINGS.artFolder, {
    name: "Pasta das artes personalizadas",
    hint: "Usada com Pasta personalizada. Todos os arquivos em PNG, nomeados como: \"copas 2.png\" … \"copas 10.png\", \"copas A.png\", \"copas J.png\", \"copas Q.png\", \"copas K.png\" (o mesmo para paus, espadas e ouros), \"coringa preto.png\", \"coringa vermelho.png\" e \"verso.png\".",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    filePicker: "folder",
    default: "",
    onChange: onCardArtChanged
  });

  // Texto livre do mestre, editado pelo botão de regras; fica fora do menu de configurações.
  game.settings.register(MODULE_ID, SETTINGS.rules, {
    name: "Regras da mesa",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });
}

function applyCardArt() {
  setCardArt({ style: readSetting(SETTINGS.artStyle, "dark-gold"), folder: readSetting(SETTINGS.artFolder, "") });
}

function onCardArtChanged() {
  applyCardArt();
  renderConfiguredUI();
}

function rulesText() {
  return String(readSetting(SETTINGS.rules, "") ?? "");
}

async function saveRulesText(text) {
  if (!isFullGM()) return;
  await game.settings.set(MODULE_ID, SETTINGS.rules, String(text ?? ""));
  notifyLocal("Regras salvas.", "info");
}

function renderConfiguredUI() {
  if (!game.ready) return;
  if (isWyrtDisabled()) destroyUI();
  else renderUI(cachedState);
}

// No init, game.users ainda não existe; os dados brutos de game.data.users servem até o ready.
function spectatorChoices() {
  const choices = { "": "Nenhum" };
  for (const user of game.users?.contents ?? game.data?.users ?? []) {
    const id = user.id ?? user._id;
    if (!id || isFullGM(user)) continue;
    choices[id] = `${user.name}${isAssistant(user) ? " (Assistente de GM)" : ""}`;
  }
  return choices;
}

function refreshSpectatorChoices() {
  const config = game.settings?.settings?.get(`${MODULE_ID}.${SETTINGS.spectator}`);
  if (config) config.choices = spectatorChoices();
}

function onSpectatorsChanged() {
  renderConfiguredUI();
  removeSpectatorParticipants();
}

function removeSpectatorParticipants() {
  if (!game.ready || isWyrtDisabled() || !isAuthorityGM()) return;
  if (!cachedState.participants.some(userId => isSpectator(game.users.get(userId)))) return;
  enqueue(async () => {
    const state = currentState();
    const removed = state.participants.filter(userId => isSpectator(game.users.get(userId)));
    if (!removed.length) return;
    for (const userId of removed) {
      discardHand(state, userId);
      delete state.hands[userId];
      delete state.usage[userId];
      delete state.initiativeScores[userId];
    }
    state.participants = state.participants.filter(userId => !removed.includes(userId));
    updateInitiativeScores(state);
    await commitState(state);
    if (state.active && state.autoInitiative) await applyInitiative(state);
    const names = removed.map(userLabel).join(", ");
    notifyLocal(`${names} ${removed.length > 1 ? "agora são espectadores e saíram" : "agora é espectador e saiu"} do Wyrt.`, "info");
  });
}

function exposeAPI() {
  const module = game.modules.get(MODULE_ID);
  if (!module) return;
  module.api = {
    get state() { return clone(cachedState); },
    open: () => {
      document.querySelector(".wyrt-gm-launcher")?.click();
    },
    dispatch,
    card: getCard,
    canUseAction(userId, action) {
      if (!cachedState.active) return false;
      const validAction = ["movement", "standard", "aggression", "full"].includes(action);
      return validAction && (userId === "foe" || cachedState.participants.includes(userId));
    }
  };
}

function dispatch(action, payload = {}) {
  if (isWyrtDisabled()) return;
  if (isFullGM() && isAuthorityGM()) {
    enqueue(() => processRequest({ action, payload, userId: game.user.id }));
    return;
  }
  game.socket.emit(SOCKET_NAME, {
    type: "request",
    action,
    payload,
    userId: game.user.id
  });
}

function onSocketMessage(message) {
  if (isWyrtDisabled()) return;
  if (!message || typeof message !== "object") return;
  if (message.type === "sync-request") {
    if (!isAuthorityGM()) return;
    const requester = game.users.get(message.userId);
    if (!requester?.active) return;
    const state = currentState();
    game.socket.emit(SOCKET_NAME, {
      type: "sync-state",
      target: requester.id,
      senderId: game.user.id,
      revision: state.revision,
      state
    });
    return;
  }
  if (message.type === "sync-state") {
    const sender = game.users.get(message.senderId);
    if (message.target !== game.user.id || !isFullGM(sender) || !message.state) return;
    cachedState = normalizeState(message.state);
    renderUI(cachedState);
    return;
  }
  if (message.type === "foe-hover") {
    const sender = game.users.get(message.senderId);
    if (isFullGM(sender)) setRemoteFoeHover(message.cardId, message.active === true);
    return;
  }
  if (message.type === "refresh") {
    const sender = game.users.get(message.senderId);
    if (!isFullGM(sender)) return;
    if (message.state && Number(message.revision) >= Number(cachedState.revision)) {
      cachedState = normalizeState(message.state);
    } else if (Number(message.revision) > Number(cachedState.revision)) {
      cachedState = normalizeState(game.settings.get(MODULE_ID, STATE_SETTING));
    }
    renderUI(cachedState);
    return;
  }
  if (message.type === "notify" && message.target === game.user.id) {
    notifyLocal(message.message, message.level);
    return;
  }
  if (message.type === "request" && isAuthorityGM()) enqueue(() => processRequest(message));
}

function requestStateSync() {
  if (isAuthorityGM() || !game.socket) return;
  game.socket.emit(SOCKET_NAME, { type: "sync-request", userId: game.user.id });
}

function broadcastFoeHover(cardId, active) {
  if (!isFullGM()) return;
  game.socket.emit(SOCKET_NAME, { type: "foe-hover", cardId, active: active === true, senderId: game.user.id });
}

function enqueue(task) {
  mutationQueue = mutationQueue.then(task).catch(error => {
    console.error(`${MODULE_ID} | Falha ao processar operação`, error);
    notifyLocal(error?.message || "Não foi possível processar a operação do Wyrt.", "error");
  });
  return mutationQueue;
}

async function processRequest(request) {
  if (isWyrtDisabled()) return;
  const sender = game.users.get(request.userId);
  if (!sender) return;
  const fullGM = isFullGM(sender);
  if (!fullGM && isSpectator(sender)) return notifyUser(sender.id, "Espectadores apenas acompanham o Wyrt.", "warn");
  const playerActions = new Set(["playCard", "discardCard", "discardHand", "requestExtraDraw", "undoPlay", "undoDiscard"]);
  if (!fullGM && !playerActions.has(request.action)) return notifyUser(sender.id, "Apenas o mestre pode fazer isso.", "warn");

  let state = currentState();
  const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
  const requestedTarget = payload.target === "foe" ? "foe" : String(payload.target ?? "");
  const target = fullGM ? requestedTarget : sender.id;

  if (!["startSession", "setGMBlind", "setFoeName", "setAutoInitiative", "setFoeCombatant", "setCombat", "toggleParticipant", "setLimit"].includes(request.action) && !state.active) {
    return notifyUser(sender.id, "O Wyrt Dimensional ainda não foi iniciado pelo mestre.", "warn");
  }

  switch (request.action) {
    case "startSession": {
      if (!fullGM) break;
      const combat = game.combats.get(payload.combatId) ?? game.combats.get(state.combatId) ?? game.combat;
      if (!combat) return notifyUser(sender.id, "Crie um encontro antes de iniciar o Wyrt Dimensional.", "warn");
      const allowed = new Set(playerUsers().map(user => user.id));
      const participantIds = [...new Set((payload.participantIds ?? []).filter(userId => allowed.has(userId)))];
      if (!participantIds.length) return notifyUser(sender.id, "Selecione pelo menos um jogador participante.", "warn");
      const old = state;
      state = startSession({
        participantIds,
        combatId: combat.id,
        round: combat.round || 1,
        foeCombatantId: combat.combatants.get(payload.foeCombatantId)?.id ?? null,
        limits: old.limits,
        foeLimit: old.foeLimit
      });
      state.gmBlind = old.gmBlind;
      state.foeName = old.foeName;
      state.autoInitiative = old.autoInitiative;
      await commitState(state);
      if (state.autoInitiative) await applyInitiative(state);
      await postStartMessage(state);
      notifyUser(sender.id, "Wyrt Dimensional iniciado e mãos distribuídas.", "info");
      break;
    }
    case "endSession": {
      if (!fullGM) break;
      state = endState(state);
      await commitState(state);
      await ChatMessage.create({ content: chatNotice("A distorção se fecha", "A sessão do Wyrt Dimensional foi encerrada."), speaker: { alias: "Wyrt Dimensional" } });
      break;
    }
    case "fillHands": {
      if (!fullGM) break;
      fillAllHands(state);
      updateInitiativeScores(state);
      await commitState(state);
      break;
    }
    case "drawExtra": {
      if (!fullGM || !validTarget(state, target)) break;
      const cards = drawExtra(state, target, Math.min(12, Math.max(1, Number(payload.count) || 1)));
      if (!cards.length) return notifyUser(sender.id, "Não há cartas disponíveis para comprar.", "warn");
      await commitState(state);
      notifyUser(target, `${cards.length} carta${cards.length > 1 ? "s" : ""} extra${cards.length > 1 ? "s" : ""} recebida${cards.length > 1 ? "s" : ""}.`, "info");
      break;
    }
    case "giveSpecific": {
      if (!fullGM || !validTarget(state, target)) break;
      if (!giveSpecific(state, target, payload.cardId)) return notifyUser(sender.id, "Essa carta já está em uma mão ou não está disponível.", "warn");
      await commitState(state);
      notifyUser(target, "O mestre entregou uma carta extra.", "info");
      break;
    }
    case "discardCard": {
      if (!validTarget(state, target)) break;
      const hand = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
      const handIndex = hand.indexOf(payload.cardId);
      const card = getCard(payload.cardId);
      if (!discardFromHand(state, target, payload.cardId)) return notifyUser(sender.id, "Essa carta não está mais na mão.", "warn");
      const discardId = randomId();
      state.discards[discardId] = {
        id: discardId,
        target,
        round: state.round,
        wholeHand: false,
        cards: [{ cardId: payload.cardId, index: handIndex }],
        createdAt: Date.now(),
        undone: false
      };
      trimRecord(state.discards, 120);
      setTransition(state, "discard", target, [payload.cardId]);
      await commitState(state);
      await postDiscardMessage(target, card ? [card] : [], discardId, false, sender.id);
      break;
    }
    case "discardHand": {
      if (!validTarget(state, target)) break;
      const hand = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
      const cards = hand.map((cardId, index) => ({ cardId, index }));
      if (!cards.length) return notifyUser(sender.id, "Essa mão já está vazia.", "warn");
      discardHand(state, target);
      const discardId = randomId();
      state.discards[discardId] = {
        id: discardId,
        target,
        round: state.round,
        wholeHand: true,
        cards,
        createdAt: Date.now(),
        undone: false
      };
      trimRecord(state.discards, 120);
      setTransition(state, "discard", target, cards.map(entry => entry.cardId));
      await commitState(state);
      await postDiscardMessage(target, cards.map(entry => getCard(entry.cardId)).filter(Boolean), discardId, true, sender.id);
      break;
    }
    case "playCard": {
      if (!validTarget(state, target)) return notifyUser(sender.id, "Você não participa desta sessão do Wyrt.", "warn");
      const hand = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
      const handIndex = hand.indexOf(payload.cardId);
      const result = playCard(state, target, payload.cardId, payload.choice ?? {});
      if (!result.ok) return notifyUser(sender.id, result.error, "warn");
      const playId = randomId();
      state.plays[playId] = {
        id: playId,
        target,
        cardId: payload.cardId,
        round: state.round,
        handIndex,
        action: result.action,
        consumesLimit: result.consumesLimit,
        sequence: state.revision + Object.keys(state.plays).length + 1,
        createdAt: Date.now(),
        undone: false
      };
      trimRecord(state.plays, 120);
      setTransition(state, "play", target, [payload.cardId]);
      await commitState(state);
      await postCardPlay(target, result, playId, sender.id);
      break;
    }
    case "undoPlay": {
      const play = state.plays?.[payload.playId];
      if (!play) return notifyUser(sender.id, "Essa jogada não está mais disponível para reversão.", "warn");
      if (!fullGM && play.target !== sender.id) return notifyUser(sender.id, "Você só pode reverter as próprias cartas.", "warn");
      const undone = undoPlay(state, payload.playId);
      if (!undone.ok) return notifyUser(sender.id, undone.error, "warn");
      await commitState(state);
      await updateChatFlagByReference("playId", payload.playId, "undone", true);
      notifyUser(play.target, `${getCard(play.cardId)?.label ?? "A carta"} voltou para a mão.`, "info");
      break;
    }
    case "undoDiscard": {
      const transaction = state.discards?.[payload.discardId];
      if (!transaction) return notifyUser(sender.id, "Esse descarte não está mais disponível para reversão.", "warn");
      if (!fullGM && transaction.target !== sender.id) return notifyUser(sender.id, "Você só pode reverter os próprios descartes.", "warn");
      const undone = undoDiscard(state, payload.discardId);
      if (!undone.ok) return notifyUser(sender.id, undone.error, "warn");
      await commitState(state);
      await updateChatFlagByReference("discardId", payload.discardId, "undone", true);
      const count = transaction.cards.length;
      notifyUser(transaction.target, `${count} carta${count > 1 ? "s voltaram" : " voltou"} para a mão.`, "info");
      break;
    }
    case "requestExtraDraw": {
      if (!state.participants.includes(sender.id)) return notifyUser(sender.id, "Você não participa desta sessão do Wyrt.", "warn");
      if (!requiresDrawApproval()) {
        const cards = drawExtra(state, sender.id, 1);
        if (!cards.length) return notifyUser(sender.id, "Não há cartas disponíveis para comprar.", "warn");
        await commitState(state);
        await postExtraDrawNotice(sender.id, state.round);
        for (const gm of game.users.filter(user => user.active && isFullGM(user))) notifyUser(gm.id, `${userLabel(sender.id)} comprou +1 carta extra.`, "info");
        break;
      }
      const existing = Object.values(state.drawRequests).find(entry => entry.userId === sender.id && entry.status === "pending");
      if (existing) return notifyUser(sender.id, "Você já tem uma solicitação de compra aguardando o mestre.", "warn");
      const requestId = randomId();
      state.drawRequests[requestId] = { id: requestId, userId: sender.id, round: state.round, status: "pending", createdAt: Date.now() };
      trimRecord(state.drawRequests, 80);
      await commitState(state);
      await postDrawRequest(state.drawRequests[requestId]);
      for (const gm of game.users.filter(user => user.active && isFullGM(user))) notifyUser(gm.id, `${userLabel(sender.id)} pediu permissão para comprar +1 carta.`, "info");
      notifyUser(sender.id, "Pedido enviado ao mestre.", "info");
      break;
    }
    case "resolveDrawRequest": {
      if (!fullGM) break;
      const drawRequest = state.drawRequests?.[payload.requestId];
      if (!drawRequest || drawRequest.status !== "pending") return notifyUser(sender.id, "Essa solicitação já foi resolvida.", "warn");
      const approved = payload.approved === true;
      if (approved) {
        const cards = drawExtra(state, drawRequest.userId, 1);
        if (!cards.length) return notifyUser(sender.id, "Não há cartas disponíveis para aprovar a compra.", "warn");
      }
      drawRequest.status = approved ? "approved" : "denied";
      drawRequest.resolvedBy = sender.id;
      await commitState(state);
      await updateChatFlagByReference("drawRequestId", payload.requestId, "requestStatus", drawRequest.status);
      notifyUser(drawRequest.userId, approved ? "O mestre aprovou sua compra extra." : "O mestre recusou sua compra extra.", approved ? "info" : "warn");
      break;
    }
    case "setLimit": {
      if (!fullGM || !(validTarget(state, target) || (!state.active && playerUsers().some(user => user.id === target)))) break;
      const limit = clampLimit(payload.limit, target === "foe" ? 5 : 3);
      if (target === "foe") state.foeLimit = limit;
      else state.limits[target] = limit;
      await commitState(state);
      break;
    }
    case "toggleParticipant": {
      if (!fullGM || target === "foe" || !playerUsers().some(user => user.id === target)) break;
      if (!state.active && state.participants.length === 0) state.participants = defaultParticipantIds();
      const enabled = payload.enabled === true;
      const hasParticipant = state.participants.includes(target);
      if (enabled && !hasParticipant) {
        state.participants.push(target);
        state.hands[target] ??= [];
        state.limits[target] = clampLimit(state.limits[target], 3);
        state.usage[target] = { round: state.round, movement: false, standard: false };
        if (state.active) drawToConfiguredLimit(state, target);
      } else if (!enabled && hasParticipant) {
        if (state.active) discardHand(state, target);
        state.participants = state.participants.filter(userId => userId !== target);
        delete state.usage[target];
        delete state.initiativeScores[target];
      }
      updateInitiativeScores(state);
      await commitState(state);
      if (state.active && state.autoInitiative) await applyInitiative(state);
      break;
    }
    case "setFoeCombatant": {
      if (!fullGM) break;
      const combat = game.combats.get(state.combatId) ?? game.combat;
      state.foeCombatantId = combat?.combatants.get(payload.combatantId)?.id ?? null;
      await commitState(state);
      if (state.active && state.autoInitiative) await applyInitiative(state);
      break;
    }
    case "setAutoInitiative": {
      if (!fullGM) break;
      state.autoInitiative = payload.enabled === true;
      await commitState(state);
      if (state.active && state.autoInitiative) await applyInitiative(state);
      break;
    }
    case "setFoeName": {
      if (!fullGM) break;
      state.foeName = String(payload.name ?? "").trim().slice(0, 60);
      await commitState(state);
      break;
    }
    case "setGMBlind": {
      if (!fullGM) break;
      state.gmBlind = payload.enabled === true;
      await commitState(state);
      break;
    }
    case "setCombat": {
      if (!fullGM) break;
      const combat = game.combats.get(payload.combatId);
      if (!combat) return notifyUser(sender.id, "O encontro selecionado não existe mais.", "warn");
      state.combatId = combat.id;
      state.round = combat.round || 1;
      if (!combat.combatants.get(state.foeCombatantId)) state.foeCombatantId = null;
      updateInitiativeScores(state);
      await commitState(state);
      if (state.active && state.autoInitiative) await applyInitiative(state);
      break;
    }
    default:
      break;
  }
}

function drawToConfiguredLimit(state, target) {
  const hand = target === "foe" ? state.foeHand : (state.hands[target] ??= []);
  const limit = target === "foe" ? state.foeLimit : state.limits[target];
  const need = Math.max(0, clampLimit(limit, target === "foe" ? 5 : 3) - hand.length);
  if (need) drawExtra(state, target, need);
}

function validTarget(state, target) {
  return target === "foe" || state.participants.includes(target);
}

function endState(previous) {
  const state = defaultState();
  state.revision = previous.revision;
  state.gmBlind = previous.gmBlind;
  state.foeName = previous.foeName;
  state.autoInitiative = previous.autoInitiative;
  state.limits = { ...previous.limits };
  state.foeLimit = previous.foeLimit;
  state.participants = [...previous.participants];
  state.combatId = previous.combatId;
  state.foeCombatantId = previous.foeCombatantId;
  return state;
}

async function commitState(state) {
  const validation = validateState(state);
  if (!validation.valid) throw new Error(`Estado inválido do baralho (duplicadas: ${validation.duplicates.join(", ") || "nenhuma"}).`);
  state.schema = 1;
  state.revision = Math.max(Number(state.revision) || 0, Number(cachedState.revision) || 0) + 1;
  cachedState = normalizeState(state);
  await game.settings.set(MODULE_ID, STATE_SETTING, cachedState);
  game.socket.emit(SOCKET_NAME, { type: "refresh", senderId: game.user.id, revision: cachedState.revision, state: cachedState });
  renderUI(cachedState);
}

function currentState() {
  return normalizeState(clone(game.settings.get(MODULE_ID, STATE_SETTING)));
}

function clone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isAuthorityGM() {
  const activeGMs = game.users.filter(user => user.active && isFullGM(user)).sort((a, b) => a.id.localeCompare(b.id));
  return activeGMs[0]?.id === game.user.id;
}

function isFullGM(user = game.user) {
  return Number(user?.role) === Number(CONST.USER_ROLES.GAMEMASTER);
}

function isAssistant(user = game.user) {
  return Number(user?.role) === Number(CONST.USER_ROLES.ASSISTANT);
}

function isSpectator(user = game.user) {
  if (!user || isFullGM(user)) return false;
  if (isAssistant(user) && readSetting(SETTINGS.assistantSpectator, true) !== false) return true;
  const id = user.id ?? user._id;
  return Boolean(id) && readSetting(SETTINGS.spectator, "") === id;
}

function readSetting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

function isWyrtDisabled() {
  return readSetting(SETTINGS.disabled, false) === true;
}

function visualQuality() {
  const level = readSetting(SETTINGS.quality, "high");
  return QUALITY_LEVELS.includes(level) ? level : "high";
}

function hideOpponentHand() {
  return readSetting(SETTINGS.hideOpponent, false) === true;
}

function requiresDrawApproval() {
  return readSetting(SETTINGS.requireDrawApproval, true) !== false;
}

function playerUsers() {
  return game.users
    .filter(user => !isFullGM(user) && !isSpectator(user))
    .sort((a, b) => Number(b.active) - Number(a.active) || userLabel(a.id).localeCompare(userLabel(b.id), "pt-BR"));
}

function defaultParticipantIds() {
  const users = playerUsers();
  const likely = users.filter(user => user.active || user.character);
  return (likely.length ? likely : users).map(user => user.id);
}

function userLabel(userId) {
  const user = game.users.get(userId);
  return user?.character?.name || user?.name || "Jogador";
}

async function nextRound() {
  if (!isFullGM()) return;
  const state = currentState();
  const combat = game.combats.get(state.combatId) ?? game.combat;
  if (!state.active || !combat) return notifyLocal("Não há combate ativo vinculado ao Wyrt.", "warn");
  await combat.nextRound();
}

function encounters() {
  return [...game.combats].sort((a, b) => {
    const sceneA = a.scene?.name ?? "";
    const sceneB = b.scene?.name ?? "";
    return sceneA.localeCompare(sceneB, "pt-BR") || encounterLabel(a).localeCompare(encounterLabel(b), "pt-BR");
  });
}

function encounterLabel(combat) {
  const scene = combat.scene?.name;
  const name = combat.name || `Encontro ${combat.id.slice(0, 5)}`;
  return scene ? `${scene} — ${name}` : name;
}

async function applyInitiative(state) {
  const combat = game.combats.get(state.combatId);
  if (!combat) return;
  const updates = [];
  for (const combatant of combat.combatants) {
    let target = null;
    if (combatant.id === state.foeCombatantId) target = "foe";
    else {
      const actor = combatant.actor;
      const assigned = state.participants.find(userId => game.users.get(userId)?.character?.id === actor?.id);
      const owner = assigned ?? state.participants.find(userId => Number(actor?.ownership?.[userId]) >= 3);
      if (owner) target = owner;
    }
    if (!target) continue;
    const initiative = Number(state.initiativeScores[target]) || 0;
    if (combatant.initiative !== initiative) updates.push({ _id: combatant.id, initiative });
  }
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
}

async function postStartMessage(state) {
  const names = state.participants.map(userLabel).join(", ");
  await ChatMessage.create({
    speaker: { alias: "Wyrt Dimensional" },
    content: chatNotice("O Wyrt desperta", `<strong>Rodada ${state.round}</strong>. As cartas foram distribuídas para ${escapeHTML(names)} e ${escapeHTML(foeName(state))}. A ordem de iniciativa foi definida pela maior carta numérica de cada mão.`)
  });
}

async function postRoundMessage(state) {
  const scores = [
    ...state.participants.map(userId => ({ name: userLabel(userId), score: state.initiativeScores[userId] ?? 0 })),
    { name: foeName(state), score: state.initiativeScores.foe ?? 0 }
  ].sort((a, b) => b.score - a.score);
  await ChatMessage.create({
    speaker: { alias: "Wyrt Dimensional" },
    content: chatNotice(`Rodada ${state.round}`, `Mãos completadas. Ordem pelas cartas: ${scores.map(entry => `<strong>${escapeHTML(entry.name)}</strong> ${entry.score}`).join(" · ")}.`)
  });
}

async function postCardPlay(target, result, playId, authorId) {
  const actorName = target === "foe" ? foeName() : userLabel(target);
  let headline;
  let detail;
  if (result.action) {
    headline = result.special === "ace" ? `Ação extra: ${actionLabel(result.action)}` : actionLabel(result.action);
    detail = result.consumesLimit ? "A carta foi usada para realizar esta ação." : "Esta jogada usa o benefício especial da carta.";
  } else {
    headline = specialLabel(result.special);
    detail = "Benefício especial da carta ativado.";
  }
  const emulation = result.card.special === "joker" ? '<span class="wyrt-chat-joker">Curinga emulando outra carta</span>' : "";
  await ChatMessage.create({
    author: chatAuthor(authorId),
    speaker: { alias: actorName },
    flags: { [MODULE_ID]: { playId, target, undone: false } },
    content: `<div class="wyrt-chat-card"><img src="${result.card.image}" alt="${escapeHTML(result.card.label)}"><div><span>Wyrt Dimensional · rodada ${cachedState.round}</span><h3>${escapeHTML(actorName)} — ${escapeHTML(headline)}</h3>${emulation}<p>${escapeHTML(detail)}</p><button type="button" class="wyrt-chat-undo" data-wyrt-undo><i class="fa-solid fa-arrow-rotate-left"></i> Reverter ação</button></div></div>`
  });
}

async function postDiscardMessage(target, cards, discardId, wholeHand, authorId) {
  const actorName = target === "foe" ? foeName() : userLabel(target);
  const gallery = cards.map(card => `<img src="${card.image}" alt="${escapeHTML(card.label)}" title="${escapeHTML(card.label)}">`).join("");
  const headline = wholeHand
    ? `${actorName} descartou a mão (${cards.length} cartas)`
    : `${actorName} descartou ${cards[0]?.label ?? "uma carta"}`;
  await ChatMessage.create({
    author: chatAuthor(authorId),
    speaker: { alias: actorName },
    flags: { [MODULE_ID]: { discardId, target, undone: false } },
    content: `<div class="wyrt-chat-discard"><div class="wyrt-chat-discard-gallery">${gallery}</div><div class="wyrt-chat-discard-copy"><span>Wyrt Dimensional · rodada ${cachedState.round}</span><h3>${escapeHTML(headline)}</h3><p>${wholeHand ? "Todas as cartas da mão foram enviadas ao descarte." : "A carta foi enviada ao descarte sem ser usada."}</p><button type="button" class="wyrt-chat-undo" data-wyrt-undo><i class="fa-solid fa-arrow-rotate-left"></i> Reverter descarte</button></div></div>`
  });
}

async function postDrawRequest(drawRequest) {
  const gmIds = game.users.filter(isFullGM).map(user => user.id);
  await ChatMessage.create({
    author: chatAuthor(drawRequest.userId),
    speaker: { alias: userLabel(drawRequest.userId) },
    whisper: [...new Set([...gmIds, drawRequest.userId])],
    flags: { [MODULE_ID]: { drawRequestId: drawRequest.id, requesterId: drawRequest.userId, requestStatus: "pending" } },
    content: `<div class="wyrt-chat-request"><img src="${cardBack()}" alt=""><div><span>Solicitação ao mestre</span><h3>${escapeHTML(userLabel(drawRequest.userId))} quer comprar +1 carta</h3><p>Pedido feito na rodada ${drawRequest.round}.</p><div class="wyrt-request-actions"><button type="button" data-wyrt-request="approve"><i class="fa-solid fa-check"></i> Aprovar</button><button type="button" data-wyrt-request="deny"><i class="fa-solid fa-xmark"></i> Recusar</button></div><small class="wyrt-request-status">Aguardando o mestre…</small></div></div>`
  });
}

async function postExtraDrawNotice(userId, round) {
  const gmIds = game.users.filter(isFullGM).map(user => user.id);
  await ChatMessage.create({
    author: chatAuthor(userId),
    speaker: { alias: userLabel(userId) },
    whisper: [...new Set([...gmIds, userId])],
    content: `<div class="wyrt-chat-request"><img src="${cardBack()}" alt=""><div><span>Compra extra</span><h3>${escapeHTML(userLabel(userId))} comprou +1 carta</h3><p>Compra feita na rodada ${round}, sem precisar da aprovação do mestre.</p></div></div>`
  });
}

function activateChatControls(message, html) {
  const root = html instanceof HTMLElement ? html : (html?.[0] ?? html);
  if (!root?.querySelector) return;
  if (isWyrtDisabled()) {
    root.querySelectorAll("[data-wyrt-undo], .wyrt-request-actions").forEach(element => { element.hidden = true; });
    return;
  }
  const data = message.flags?.[MODULE_ID] ?? {};
  const undoButton = root.querySelector("[data-wyrt-undo]");
  if (undoButton) {
    const allowed = isFullGM() || data.target === game.user.id;
    undoButton.hidden = !allowed;
    if (data.undone) {
      undoButton.disabled = true;
      undoButton.innerHTML = data.discardId
        ? '<i class="fa-solid fa-check"></i> Descarte revertido'
        : '<i class="fa-solid fa-check"></i> Ação revertida';
    } else if (allowed && undoButton.dataset.bound !== "true") {
      undoButton.dataset.bound = "true";
      undoButton.addEventListener("click", () => {
        if (data.discardId) dispatch("undoDiscard", { discardId: data.discardId });
        else dispatch("undoPlay", { playId: data.playId });
      });
    }
  }

  const requestActions = root.querySelector(".wyrt-request-actions");
  const requestStatus = root.querySelector(".wyrt-request-status");
  if (!requestActions) return;
  const status = data.requestStatus ?? "pending";
  requestActions.hidden = !isFullGM() || status !== "pending";
  if (requestStatus) requestStatus.textContent = ({ pending: "Aguardando o mestre…", approved: "Compra aprovada.", denied: "Compra recusada." })[status] ?? status;
  if (!isFullGM() || status !== "pending") return;
  requestActions.querySelectorAll("[data-wyrt-request]").forEach(button => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => dispatch("resolveDrawRequest", {
      requestId: data.drawRequestId,
      approved: button.dataset.wyrtRequest === "approve",
      messageId: message.id
    }));
  });
}

async function updateChatFlagByReference(referenceKey, referenceValue, key, value) {
  const message = game.messages.find(entry => entry.flags?.[MODULE_ID]?.[referenceKey] === referenceValue);
  if (message) await message.setFlag(MODULE_ID, key, value);
}

function randomId() {
  return foundry.utils.randomID?.() ?? crypto.randomUUID();
}

function chatAuthor(userId) {
  return game.users.get(userId)?.id ?? game.user.id;
}

function setTransition(state, type, target, cardIds) {
  state.lastTransition = {
    serial: (Number(state.lastTransition?.serial) || 0) + 1,
    type,
    target,
    cardIds: [...cardIds]
  };
}

function trimRecord(record, maximum) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return;
  entries.sort(([, a], [, b]) => Number(a.createdAt ?? a.sequence ?? 0) - Number(b.createdAt ?? b.sequence ?? 0));
  for (const [key] of entries.slice(0, entries.length - maximum)) delete record[key];
}

function chatNotice(title, body) {
  return `<div class="wyrt-chat-notice"><img src="${cardBack()}" alt=""><div><span>Wyrt Dimensional</span><h3>${escapeHTML(title)}</h3><p>${body}</p></div></div>`;
}

function notifyUser(target, message, level = "info") {
  if (target === "foe" || target === game.user.id) return notifyLocal(message, level);
  game.socket.emit(SOCKET_NAME, { type: "notify", target, message, level });
}

function notifyLocal(message, level = "info") {
  const method = ["info", "warn", "error"].includes(level) ? level : "info";
  ui.notifications?.[method]?.(message);
}

function escapeHTML(value) {
  const text = String(value ?? "");
  return foundry.utils.escapeHTML ? foundry.utils.escapeHTML(text) : text;
}

function foeName(state = cachedState) {
  return String(state.foeName ?? "").trim() || "Adversário";
}
