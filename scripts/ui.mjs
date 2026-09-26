import { CARDS, cardBack, MODULE_ID, SUITS, getCard, specialLabel } from "./cards.mjs";

let controller = null;
let panelOpen = false;
let hudCollapsed = false;
let lastAnimatedDraw = null;
let lastSeenTransition = null;
let remoteFoeHover = null;
const peekedHands = new Set();
const activeDrawAnimations = new Map();
const recentLocalTransitions = new Map();

export function initializeUI(api) {
  controller = api;
  ensureRoots();
}

export function destroyUI() {
  document.querySelector("#wyrt-dimensional-ui")?.remove();
  document.querySelector("#wyrt-dimensional-modal-layer")?.remove();
  document.querySelectorAll(".wyrt-card-flyer, .wyrt-card-exit-flyer").forEach(element => element.remove());
  activeDrawAnimations.clear();
  recentLocalTransitions.clear();
  controller = null;
}

export function renderUI(state) {
  if (!controller || !game.user) return;
  const root = ensureRoots();
  applyQualityClass(root);
  applyQualityClass(document.querySelector("#wyrt-dimensional-modal-layer"));
  const hud = root.querySelector(".wyrt-hud-slot");
  const opponent = root.querySelector(".wyrt-opponent-slot");
  const staff = root.querySelector(".wyrt-gm-slot");
  captureStateTransition(state, root);
  hud.innerHTML = renderHandHUD(state);
  opponent.innerHTML = renderFoeOpponentHUD(state);
  staff.innerHTML = controller.isFullGM() ? renderGMUI(state) : (controller.isSpectator() ? renderSpectatorUI(state) : "");
  bindRootEvents(root);
  animateLatestDraw(state, hud);
}

export function setRemoteFoeHover(cardId, active) {
  remoteFoeHover = active === true ? String(cardId ?? "") : (remoteFoeHover === String(cardId ?? "") ? null : remoteFoeHover);
  document.querySelectorAll(`.wyrt-opponent-card[data-card-id="${CSS.escape(String(cardId ?? ""))}"]`).forEach(card => {
    card.classList.toggle("is-remote-hover", active === true);
  });
}

function ensureRoots() {
  let root = document.querySelector("#wyrt-dimensional-ui");
  if (!root) {
    root = document.createElement("div");
    root.id = "wyrt-dimensional-ui";
    root.innerHTML = '<div class="wyrt-opponent-slot"></div><div class="wyrt-hud-slot"></div><div class="wyrt-gm-slot"></div>';
    document.body.append(root);
  }
  if (!root.querySelector(".wyrt-opponent-slot")) root.insertAdjacentHTML("afterbegin", '<div class="wyrt-opponent-slot"></div>');
  if (!root.querySelector(".wyrt-hud-slot")) root.insertAdjacentHTML("beforeend", '<div class="wyrt-hud-slot"></div>');
  if (!root.querySelector(".wyrt-gm-slot")) root.insertAdjacentHTML("beforeend", '<div class="wyrt-gm-slot"></div>');
  let modalLayer = document.querySelector("#wyrt-dimensional-modal-layer");
  if (!modalLayer) {
    modalLayer = document.createElement("div");
    modalLayer.id = "wyrt-dimensional-modal-layer";
    document.body.append(modalLayer);
  }
  return root;
}

function renderHandHUD(state) {
  if (!state.active) return "";
  const spectator = controller.isSpectator();
  const target = controller.isFullGM() ? "foe" : (spectator ? spectatorTurnTarget(state) : game.user.id);
  const participating = target === "foe" || Boolean(target && state.participants.includes(target));
  const hand = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
  const usage = state.usage[target] ?? { movement: false, standard: false };
  const label = target === "foe"
    ? `Mão de ${escapeHTML(foeName(state))}`
    : (participating
        ? (spectator ? `Mão de ${controller.userLabel(target)}` : (game.user.character?.name || game.user.name))
        : (spectator ? `Turno de ${currentCombatantLabel(state)}` : "Baralho da cena"));
  const limit = target === "foe" ? state.foeLimit : (state.limits[target] ?? 3);
  const readonly = spectator || !participating;
  const cards = hand.map((cardId, index) => handCard(cardId, target, index, hand.length, readonly)).join("");
  const meters = target === "foe"
    ? '<span class="wyrt-unlimited"><i class="fa-solid fa-infinity"></i> ações sem limite</span>'
    : participating ? `<span class="wyrt-action-pip ${usage.movement ? "spent" : ""}" title="Ação de movimento">M</span>
       <span class="wyrt-action-pip ${usage.standard ? "spent" : ""}" title="Ação padrão">P</span>`
    : '<span class="wyrt-unlimited">espectador</span>';

  return `
    <section class="wyrt-hand-hud ${hudCollapsed ? "is-collapsed" : ""} ${participating ? "" : "is-deck-only"} ${spectator ? "is-assistant-hand" : ""}" aria-label="Wyrt Dimensional — ${escapeHTML(label)}" ${dragAttributes("hand")}>
      <header class="wyrt-hand-header" data-wyrt-drag-handle>
        <button type="button" class="wyrt-deck-pile" data-wyrt-action="deck-menu" data-target="${target}" title="Abrir opções do baralho">
          <img src="${cardBack()}" alt="Verso do baralho"><b>${state.deck.length}</b>
        </button>
        <div class="wyrt-hand-title">
          <span class="wyrt-eyebrow">Wyrt Dimensional · rodada ${state.round || "—"}</span>
          <strong>${escapeHTML(label)}</strong>
          <small>${participating ? `${hand.length}/${limit} cartas · iniciativa ${state.initiativeScores[target] ?? 0} · ` : ""}${state.discard.length} no descarte</small>
        </div>
        <div class="wyrt-action-meter">${meters}</div>
        <button type="button" class="wyrt-icon-button" data-wyrt-action="rules" title="Regras do Wyrt"><i class="fa-solid fa-book-open"></i></button>
        <button type="button" class="wyrt-icon-button" data-wyrt-action="toggle-hud" title="${hudCollapsed ? "Expandir mão" : "Recolher mão"}">
          <i class="fa-solid fa-chevron-${hudCollapsed ? "up" : "down"}"></i>
        </button>
      </header>
      <div class="wyrt-hand-cards">
        ${participating ? (cards || '<div class="wyrt-empty-hand">Sua mão está vazia.</div>') : ""}
      </div>
      <footer class="wyrt-hand-help">${spectator ? "Mão do turno atual · passe o mouse para destacar" : (readonly ? "Visualização da mão" : 'Clique para usar · <span>×</span> para descartar sem usar')}</footer>
    </section>`;
}

function handCard(cardId, target, index, total, readonly = false) {
  const card = getCard(cardId);
  if (!card) return "";
  const offset = index - ((total - 1) / 2);
  if (readonly) return `
    <div class="wyrt-card-wrap" style="--card-offset:${offset}" data-card-id="${card.id}">
      <div class="wyrt-card is-readonly" title="${escapeHTML(card.label)}"><img src="${card.image}" alt="${escapeHTML(card.label)}" draggable="false" decoding="async"></div>
    </div>`;
  return `
    <div class="wyrt-card-wrap" style="--card-offset:${offset}" data-card-id="${card.id}">
      <button type="button" class="wyrt-card" data-wyrt-action="use-card" data-target="${target}" data-card-id="${card.id}" aria-label="Usar ${escapeHTML(card.label)}">
        <img src="${card.image}" alt="${escapeHTML(card.label)}" draggable="false" decoding="async">
        <span class="wyrt-card-caption">${escapeHTML(card.actionLabel)}</span>
      </button>
      <button type="button" class="wyrt-card-discard" data-wyrt-action="discard-card" data-target="${target}" data-card-id="${card.id}" title="Descartar ${escapeHTML(card.label)}" aria-label="Descartar ${escapeHTML(card.label)}">×</button>
    </div>`;
}

function renderFoeOpponentHUD(state) {
  if (!state.active || controller.isFullGM()) return "";
  const spectator = controller.isSpectator();
  if (spectator && spectatorTurnTarget(state) === "foe") return "";
  if (!spectator && controller.hideOpponentHand()) return "";
  const cards = state.foeHand.map((cardId, index) => {
    const card = getCard(cardId);
    const offset = index - ((state.foeHand.length - 1) / 2);
    const image = spectator ? card?.image : cardBack();
    const label = spectator ? (card?.label ?? `Carta de ${foeName(state)}`) : `Carta de ${foeName(state)}`;
    return `<div class="wyrt-opponent-card ${remoteFoeHover === cardId ? "is-remote-hover" : ""}" data-card-id="${cardId}" style="--card-offset:${offset}" title="${escapeHTML(label)}"><img src="${image}" alt="${escapeHTML(label)}" draggable="false"></div>`;
  }).join("");
  return `<section class="wyrt-opponent-hud ${spectator ? "is-revealed" : ""}" aria-label="Mão ${spectator ? "aberta" : "oculta"} de ${escapeHTML(foeName(state))}" ${dragAttributes("opponent")}>
    <header data-wyrt-drag-handle><span class="wyrt-eyebrow">Adversário</span><strong>${escapeHTML(foeName(state))} · ${state.foeHand.length} cartas</strong></header>
    <div class="wyrt-opponent-cards">${cards}</div>
  </section>`;
}

function spectatorTurnTarget(state) {
  if (!controller.isSpectator()) return null;
  const combat = game.combats?.get(state.combatId);
  const combatant = combat?.combatant ?? combat?.turns?.[combat?.turn];
  if (!combatant) return null;
  if (combatant.id === state.foeCombatantId) return "foe";

  const actor = combatant.actor;
  const actorId = actor?.id ?? combatant.actorId;
  const directCharacter = state.participants.find(userId => game.users.get(userId)?.character?.id === actorId);
  if (directCharacter) return directCharacter;

  const combatantPlayers = combatant.players ? Array.from(combatant.players) : [];
  const listedOwner = state.participants.find(userId => combatantPlayers.some(user => user.id === userId));
  if (listedOwner) return listedOwner;

  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return state.participants.find(userId => Number(actor?.ownership?.[userId] ?? 0) >= ownerLevel) ?? null;
}

function currentCombatantLabel(state) {
  const combat = game.combats?.get(state.combatId);
  return combat?.combatant?.name ?? combat?.turns?.[combat?.turn]?.name ?? "ninguém";
}

function renderGMUI(state) {
  const launcher = renderLauncher(state, false);
  if (!panelOpen) return launcher;
  return `${launcher}${renderGMPanel(state)}`;
}

function renderSpectatorUI(state) {
  const launcher = renderLauncher(state, true);
  if (!panelOpen) return launcher;
  return `${launcher}${renderSpectatorPanel(state)}`;
}

function renderLauncher(state, spectator) {
  const showNextRound = state.active && !spectator && !panelOpen;
  return `<div class="wyrt-gm-launcher-group ${showNextRound ? "has-quick-action" : ""}" ${dragAttributes("launcher")}>
    <button type="button" class="wyrt-gm-launcher ${state.active ? "is-active" : ""}" data-wyrt-action="toggle-panel" data-wyrt-drag-handle title="${spectator ? "Visão de transmissão" : "Painel do Wyrt Dimensional"}">
      <img src="${cardBack()}" alt=""><span>${spectator ? "Wyrt · transmissão" : "Wyrt"}</span>${state.active ? '<i class="wyrt-live-dot"></i>' : ""}
    </button>
    ${showNextRound ? '<button type="button" class="wyrt-launcher-next" data-wyrt-action="next-round" title="Avançar o encontro vinculado"><i class="fa-solid fa-forward-step"></i><span>Próxima rodada</span></button>' : ""}
  </div>`;
}

function renderGMPanel(state) {
  const playerUsers = controller.playerUsers();
  const allEncounters = controller.encounters();
  const combat = game.combats?.get(state.combatId) ?? game.combat ?? allEncounters[0];
  const combatants = combat?.combatants ? [...combat.combatants] : [];
  const selectedParticipants = new Set(state.participants.length ? state.participants : controller.defaultParticipantIds());
  const foeCombatantId = state.foeCombatantId ?? "";
  const encounterOptions = allEncounters.length
    ? allEncounters.map(encounter => `<option value="${encounter.id}" ${encounter.id === combat?.id ? "selected" : ""}>${escapeHTML(encounterLabel(encounter))}</option>`).join("")
    : '<option value="">Nenhum encontro criado</option>';
  const foeOptions = ['<option value="">Não vincular a um combatente</option>', ...combatants.map(combatant =>
    `<option value="${combatant.id}" ${combatant.id === foeCombatantId ? "selected" : ""}>${escapeHTML(combatant.name)}</option>`
  )].join("");

  const playerRows = playerUsers.map(user => {
    const participating = selectedParticipants.has(user.id);
    const hand = state.hands[user.id] ?? [];
    const limit = state.limits[user.id] ?? 3;
    const hidden = state.gmBlind && !peekedHands.has(user.id);
    const usage = state.usage[user.id] ?? {};
    const score = state.initiativeScores[user.id] ?? 0;
    return `
      <article class="wyrt-player-row ${participating ? "" : "is-disabled"}" data-target="${user.id}">
        <div class="wyrt-player-line">
          <label class="wyrt-player-toggle" title="Participa do Wyrt">
            <input type="checkbox" data-wyrt-change="participant" data-target="${user.id}" ${participating ? "checked" : ""}>
            <span class="wyrt-avatar">${user.character?.img ? `<img src="${escapeHTML(user.character.img)}" alt="">` : '<i class="fa-solid fa-user"></i>'}</span>
            <span><strong>${escapeHTML(user.character?.name || user.name)}</strong><small>${escapeHTML(user.name)} · iniciativa ${score}</small></span>
          </label>
          <div class="wyrt-row-actions">
            ${state.gmBlind ? `<button type="button" data-wyrt-action="peek" data-target="${user.id}" title="${hidden ? "Espiar mão" : "Ocultar novamente"}"><i class="fa-solid fa-eye${hidden ? "" : "-slash"}"></i></button>` : ""}
            <label title="Limite de compra"><span>limite</span><input type="number" min="1" max="12" value="${limit}" data-wyrt-change="limit" data-target="${user.id}"></label>
          </div>
        </div>
        <div class="wyrt-gm-hand ${hidden ? "is-hidden" : ""}">
          ${renderGMHandCards(hand, user.id, hidden)}
          ${!hand.length ? '<small class="wyrt-no-cards">sem cartas</small>' : ""}
        </div>
        <div class="wyrt-cheat-row">
          <span class="wyrt-usage-mini"><i class="fa-solid fa-person-running"></i> ${usage.movement ? "gasta" : "livre"} · <i class="fa-solid fa-bolt"></i> ${usage.standard ? "gasta" : "livre"}</span>
          <button type="button" data-wyrt-action="draw-extra" data-target="${user.id}"><i class="fa-solid fa-plus"></i> aleatória</button>
          <button type="button" data-wyrt-action="give-specific" data-target="${user.id}"><i class="fa-solid fa-wand-magic-sparkles"></i> escolher</button>
          <button type="button" data-wyrt-action="discard-hand" data-target="${user.id}" title="Descartar mão"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </article>`;
  }).join("");

  return `
    <aside class="wyrt-gm-panel" aria-label="Painel do mestre — Wyrt Dimensional" ${dragAttributes("panel")}>
      <header class="wyrt-panel-header" data-wyrt-drag-handle>
        <div><span class="wyrt-eyebrow">Controle da cena</span><h2>Wyrt Dimensional</h2></div>
        <button type="button" class="wyrt-icon-button" data-wyrt-action="rules" title="Regras"><i class="fa-solid fa-book-open"></i></button>
        <button type="button" class="wyrt-icon-button" data-wyrt-action="toggle-panel" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <div class="wyrt-panel-scroll">
        <section class="wyrt-session-card ${state.active ? "is-active" : ""}">
          <div class="wyrt-session-status">
            <span><i class="fa-solid fa-circle"></i> ${state.active ? `Em andamento · rodada ${state.round}` : "Cena inativa"}</span>
            <span>${state.deck.length} monte · ${state.discard.length} descarte</span>
          </div>
          <label class="wyrt-field"><span>Encontro vinculado</span><select data-wyrt-change="combat">${encounterOptions}</select></label>
          <label class="wyrt-field"><span>Combatente controlado pelo adversário</span><select data-wyrt-change="foe-combatant">${foeOptions}</select></label>
          <label class="wyrt-field"><span>Nome do adversário</span><input type="text" maxlength="60" placeholder="Adversário" value="${escapeHTML(state.foeName ?? "")}" data-wyrt-change="foe-name"></label>
          <div class="wyrt-setting-grid">
            <label><input type="checkbox" data-wyrt-change="auto-initiative" ${state.autoInitiative ? "checked" : ""}> Ordenar iniciativa pelas cartas</label>
            <label><input type="checkbox" data-wyrt-change="gm-blind" ${state.gmBlind ? "checked" : ""}> Modo às cegas do mestre</label>
          </div>
          <div class="wyrt-session-buttons">
            ${state.active ? `
              <button type="button" class="wyrt-primary" data-wyrt-action="next-round"><i class="fa-solid fa-forward-step"></i> Próxima rodada</button>
              <button type="button" data-wyrt-action="fill-hands"><i class="fa-solid fa-layer-group"></i> Completar mãos</button>
              <button type="button" class="wyrt-danger" data-wyrt-action="end-session"><i class="fa-solid fa-stop"></i> Encerrar</button>` : `
              <button type="button" class="wyrt-primary" data-wyrt-action="start-session"><i class="fa-solid fa-play"></i> Iniciar Wyrt</button>`}
          </div>
        </section>

        ${state.active ? renderFoeManager(state) : ""}

        <section class="wyrt-players-section">
          <div class="wyrt-section-heading"><h3>Jogadores</h3><small>${state.gmBlind ? "Cartas viradas; use o olho para auxiliar." : "Clique em uma carta para inspecionar."}</small></div>
          ${playerRows || '<p class="wyrt-empty-panel">Nenhum usuário jogador encontrado.</p>'}
        </section>
      </div>
    </aside>`;
}

function renderSpectatorPanel(state) {
  const users = controller.playerUsers().filter(user => state.participants.includes(user.id));
  const rows = users.map(user => {
    const hand = state.hands[user.id] ?? [];
    return `<article class="wyrt-player-row wyrt-broadcast-row" data-target="${user.id}">
      <div class="wyrt-player-line"><span class="wyrt-avatar">${user.character?.img ? `<img src="${escapeHTML(user.character.img)}" alt="">` : '<i class="fa-solid fa-user"></i>'}</span><span class="wyrt-broadcast-name"><strong>${escapeHTML(user.character?.name || user.name)}</strong><small>iniciativa ${state.initiativeScores[user.id] ?? 0} · ${hand.length} cartas</small></span></div>
      <div class="wyrt-gm-hand">${renderGMHandCards(hand, user.id, false, true)}${!hand.length ? '<small class="wyrt-no-cards">sem cartas</small>' : ""}</div>
    </article>`;
  }).join("");
  const combat = game.combats?.get(state.combatId);
  return `<aside class="wyrt-gm-panel wyrt-assistant-panel" aria-label="Visão de transmissão do Wyrt" ${dragAttributes("panel")}>
    <header class="wyrt-panel-header" data-wyrt-drag-handle>
      <div><span class="wyrt-eyebrow">Espectador · visualização</span><h2>Cartas da mesa</h2></div>
      <button type="button" class="wyrt-icon-button" data-wyrt-action="rules" title="Regras"><i class="fa-solid fa-book-open"></i></button>
      <button type="button" class="wyrt-icon-button" data-wyrt-action="toggle-panel" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
    </header>
    <div class="wyrt-panel-scroll">
      <div class="wyrt-stream-status"><i class="fa-solid fa-video"></i> ${state.active ? `${escapeHTML(encounterLabel(combat))} · rodada ${state.round}` : "Wyrt inativo"}</div>
      ${rows || '<p class="wyrt-empty-panel">Nenhuma mão de jogador disponível.</p>'}
    </div>
  </aside>`;
}

function renderFoeManager(state) {
  return `
    <section class="wyrt-foe-manager" data-target="foe">
      <div class="wyrt-section-heading"><h3>Mão de ${escapeHTML(foeName(state))}</h3><small>Iniciativa ${state.initiativeScores.foe ?? 0} · ações ilimitadas</small></div>      <div class="wyrt-gm-hand">${renderGMHandCards(state.foeHand, "foe", false)}</div>
      <div class="wyrt-cheat-row">
        <label class="wyrt-limit-foe"><span>limite</span><input type="number" min="1" max="12" value="${state.foeLimit}" data-wyrt-change="limit" data-target="foe"></label>
        <button type="button" data-wyrt-action="draw-extra" data-target="foe"><i class="fa-solid fa-plus"></i> aleatória</button>
        <button type="button" data-wyrt-action="give-specific" data-target="foe"><i class="fa-solid fa-wand-magic-sparkles"></i> escolher</button>
        <button type="button" data-wyrt-action="discard-hand" data-target="foe"><i class="fa-solid fa-trash-can"></i></button>
      </div>
    </section>`;
}

function renderGMHandCards(hand, target, hidden, readonly = false) {
  return hand.map(cardId => {
    const card = getCard(cardId);
    if (!card) return "";
    const image = hidden ? cardBack() : card.image;
    const title = hidden ? "Carta oculta" : card.label;
    if (readonly) return `<div class="wyrt-mini-card is-readonly" data-target="${target}" data-card-id="${card.id}" title="${escapeHTML(title)}"><img src="${image}" alt="${escapeHTML(title)}" draggable="false" loading="lazy"></div>`;
    return `<button type="button" class="wyrt-mini-card" data-wyrt-action="inspect-card" data-target="${target}" data-card-id="${card.id}" title="${escapeHTML(title)}"><img src="${image}" alt="${escapeHTML(title)}" draggable="false" loading="lazy"></button>`;
  }).join("");
}

function encounterLabel(combat) {
  if (!combat) return "Encontro não encontrado";
  const scene = combat.scene?.name;
  const name = combat.name || `Encontro ${combat.id.slice(0, 5)}`;
  return scene ? `${scene} — ${name}` : name;
}

function bindRootEvents(root) {
  if (root.dataset.bound === "true") return;
  root.dataset.bound = "true";
  root.addEventListener("click", onRootClick);
  root.addEventListener("change", onRootChange);
  root.addEventListener("pointerdown", onDragStart);
  root.addEventListener("pointerover", onRootPointerOver);
  root.addEventListener("pointerout", onRootPointerOut);
}

async function onRootClick(event) {
  const button = event.target.closest("[data-wyrt-action]");
  if (!button) return;
  const action = button.dataset.wyrtAction;
  const target = button.dataset.target;
  const cardId = button.dataset.cardId;

  const dragWidget = button.closest("[data-wyrt-drag-key]");
  if (Number(button.dataset.ignoreClickUntil ?? dragWidget?.dataset.ignoreClickUntil) > Date.now()) return;

  if (action === "toggle-panel") {
    panelOpen = !panelOpen;
    renderUI(controller.getState());
  } else if (action === "toggle-hud") {
    hudCollapsed = !hudCollapsed;
    renderUI(controller.getState());
  } else if (action === "rules") {
    showRules();
  } else if (action === "deck-menu") {
    showDeckMenu(target);
  } else if (action === "use-card") {
    showUseCard(cardId, target);
  } else if (action === "discard-card") {
    const card = getCard(cardId);
    const confirmed = await confirmModal("Descartar carta?", `Você não usará <strong>${escapeHTML(card?.label ?? "esta carta")}</strong>. Ela irá para o descarte.`);
    if (confirmed) {
      await animateCardsExit([cardId], "discard", target);
      controller.dispatch("discardCard", { target, cardId });
    }
  } else if (action === "start-session") {
    const panel = button.closest(".wyrt-gm-panel");
    const participantIds = [...panel.querySelectorAll('[data-wyrt-change="participant"]:checked')].map(input => input.dataset.target);
    const combatId = panel.querySelector('[data-wyrt-change="combat"]')?.value || null;
    const foeCombatantId = panel.querySelector('[data-wyrt-change="foe-combatant"]')?.value || null;
    controller.dispatch("startSession", { participantIds, combatId, foeCombatantId });
  } else if (action === "end-session") {
    if (await confirmModal("Encerrar o Wyrt?", "As mãos e o baralho atual serão recolhidos.")) controller.dispatch("endSession", {});
  } else if (action === "next-round") {
    controller.nextRound();
  } else if (action === "fill-hands") {
    controller.dispatch("fillHands", {});
  } else if (action === "draw-extra") {
    controller.dispatch("drawExtra", { target, count: 1 });
  } else if (action === "give-specific") {
    showCardPicker(target);
  } else if (action === "discard-hand") {
    if (await confirmModal("Descartar a mão?", "Todas as cartas desta mão irão para o descarte.")) {
      const state = controller.getState();
      const cardIds = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
      await animateCardsExit(cardIds, "discard", target);
      controller.dispatch("discardHand", { target });
    }
  } else if (action === "peek") {
    if (peekedHands.has(target)) peekedHands.delete(target);
    else peekedHands.add(target);
    renderUI(controller.getState());
  } else if (action === "inspect-card") {
    const state = controller.getState();
    if (controller.isFullGM() && state.gmBlind && target !== "foe" && !peekedHands.has(target)) {
      peekedHands.add(target);
      renderUI(state);
    } else {
      showCardInspector(cardId, target);
    }
  }
}

function onRootChange(event) {
  const input = event.target.closest("[data-wyrt-change]");
  if (!input) return;
  const change = input.dataset.wyrtChange;
  if (change === "limit") controller.dispatch("setLimit", { target: input.dataset.target, limit: Number(input.value) });
  else if (change === "participant") controller.dispatch("toggleParticipant", { target: input.dataset.target, enabled: input.checked });
  else if (change === "combat") controller.dispatch("setCombat", { combatId: input.value || null });
  else if (change === "foe-name") controller.dispatch("setFoeName", { name: input.value });
  else if (change === "foe-combatant") controller.dispatch("setFoeCombatant", { combatantId: input.value || null });
  else if (change === "auto-initiative") controller.dispatch("setAutoInitiative", { enabled: input.checked });
  else if (change === "gm-blind") {
    peekedHands.clear();
    controller.dispatch("setGMBlind", { enabled: input.checked });
  }
}

function onRootPointerOver(event) {
  if (!controller.isFullGM()) return;
  const card = event.target.closest(".wyrt-hand-hud .wyrt-card-wrap");
  if (!card || card.contains(event.relatedTarget)) return;
  controller.broadcastFoeHover(card.dataset.cardId, true);
}

function onRootPointerOut(event) {
  if (!controller.isFullGM()) return;
  const card = event.target.closest(".wyrt-hand-hud .wyrt-card-wrap");
  if (!card || card.contains(event.relatedTarget)) return;
  controller.broadcastFoeHover(card.dataset.cardId, false);
}

function showUseCard(cardId, target) {
  const card = getCard(cardId);
  if (!card) return;
  const buttons = [];
  if (card.special === "joker") {
    for (const suit of Object.values(SUITS)) {
      buttons.push({
        label: `<span class="wyrt-choice-suit ${suit.color}">${suit.icon}</span><span><strong>Ás de ${suit.label}</strong><small>${suit.actionLabel}, fora do limite</small></span>`,
        choice: { mode: "joker-ace", action: suit.action }
      });
    }
    buttons.push(
      { label: `<i class="fa-solid fa-rotate"></i><span><strong>Emular Valete</strong><small>${specialLabel("jack")}</small></span>`, choice: { mode: "joker-special", special: "jack" } },
      { label: `<i class="fa-solid fa-wand-sparkles"></i><span><strong>Emular Rainha</strong><small>${specialLabel("queen")}</small></span>`, choice: { mode: "joker-special", special: "queen" } },
      { label: `<i class="fa-solid fa-crown"></i><span><strong>Emular Rei</strong><small>${specialLabel("king")}</small></span>`, choice: { mode: "joker-special", special: "king" } }
    );
  } else {
    const extra = card.special === "ace" ? ", sem contar no limite do turno" : "";
    buttons.push({
      label: `<span class="wyrt-choice-suit ${SUITS[card.suit].color}">${SUITS[card.suit].icon}</span><span><strong>${escapeHTML(card.actionLabel)}</strong><small>Gastar a carta para fazer esta ação${extra}.</small></span>`,
      choice: { mode: "action" }
    });
    if (["jack", "queen", "king"].includes(card.special)) {
      const icons = { jack: "fa-rotate", queen: "fa-wand-sparkles", king: "fa-crown" };
      buttons.push({
        label: `<i class="fa-solid ${icons[card.special]}"></i><span><strong>${escapeHTML(specialLabel(card.special))}</strong><small>Usar o benefício especial da carta.</small></span>`,
        choice: { mode: "special" }
      });
    }
  }

  openModal(`
    <div class="wyrt-use-layout">
      <img class="wyrt-use-preview" src="${card.image}" alt="${escapeHTML(card.label)}">
      <div class="wyrt-use-options"><span class="wyrt-eyebrow">Usar carta</span><h2>${escapeHTML(card.label)}</h2>${buttons.map((button, index) =>
        `<button type="button" class="wyrt-choice" data-modal-choice="${index}">${button.label}</button>`
      ).join("")}</div>
    </div>`, {
      labelledBy: card.label,
      onClick: async index => {
        await animateCardsExit([cardId], "play", target);
        controller.dispatch("playCard", { target, cardId, choice: buttons[index].choice });
      }
    });
}

function showCardInspector(cardId, target) {
  const card = getCard(cardId);
  if (!card) return;
  const targetLabel = target === "foe" ? foeName() : controller.userLabel(target);
  openModal(`
    <div class="wyrt-inspector">
      <img src="${card.image}" alt="${escapeHTML(card.label)}">
      <div><span class="wyrt-eyebrow">${escapeHTML(targetLabel)}</span><h2>${escapeHTML(card.label)}</h2>
      <p>${escapeHTML(card.actionLabel)}.</p>
      ${card.special ? `<p><strong>Especial:</strong> ${escapeHTML(specialLabel(card.special))}</p>` : ""}
      <button type="button" class="wyrt-danger" data-modal-command="discard"><i class="fa-solid fa-trash-can"></i> Descartar da mão</button></div>
    </div>`, {
      labelledBy: card.label,
      commands: {
        discard: async () => {
          await animateCardsExit([cardId], "discard", target);
          controller.dispatch("discardCard", { target, cardId });
        }
      }
    });
}

function showDeckMenu(target) {
  const state = controller.getState();
  const fullGM = controller.isFullGM();
  const spectator = controller.isSpectator();
  const participating = target === "foe" || state.participants.includes(game.user.id);
  let actions = "";
  const commands = {};

  if (fullGM && target === "foe") {
    actions = `<button type="button" class="wyrt-primary" data-modal-command="draw"><i class="fa-solid fa-plus"></i><span><strong>Comprar +1 para ${escapeHTML(foeName(state))}</strong><small>Compra imediata autorizada pelo mestre.</small></span></button>
      <button type="button" data-modal-command="discard"><i class="fa-solid fa-trash-can"></i><span><strong>Descartar a mão de ${escapeHTML(foeName(state))}</strong><small>Recolhe todas as cartas atuais.</small></span></button>`;
    commands.draw = () => controller.dispatch("drawExtra", { target: "foe", count: 1 });
    commands.discard = () => scheduleHandDiscard("foe");
  } else if (!spectator && participating) {
    const approval = controller.requiresDrawApproval();
    const requestLabel = approval ? "Solicitar +1 carta" : "Comprar +1 carta";
    const requestHint = approval ? "O mestre receberá um pedido para aprovar ou recusar." : "Compra imediata; o mestre recebe um aviso no chat.";
    actions = `<button type="button" class="wyrt-primary" data-modal-command="request"><i class="fa-solid fa-${approval ? "hand" : "plus"}"></i><span><strong>${requestLabel}</strong><small>${requestHint}</small></span></button>
      <button type="button" data-modal-command="discard"><i class="fa-solid fa-trash-can"></i><span><strong>Descartar minha mão</strong><small>Faça isto antes do fim da rodada para trocar as cartas na próxima.</small></span></button>`;
    commands.request = () => controller.dispatch("requestExtraDraw", {});
    commands.discard = () => scheduleHandDiscard(game.user.id);
  } else {
    actions = '<p class="wyrt-deck-readonly"><i class="fa-solid fa-eye"></i> Este usuário está apenas acompanhando a sessão.</p>';
  }

  openModal(`<div class="wyrt-deck-menu"><div class="wyrt-deck-large"><img src="${cardBack()}" alt="Verso do baralho"><b>${state.deck.length}</b></div><div><span class="wyrt-eyebrow">Baralho compartilhado</span><h2>Monte do Wyrt</h2><p>${state.deck.length} cartas no monte e ${state.discard.length} no descarte.</p><div class="wyrt-deck-actions">${actions}</div></div></div>`, {
    labelledBy: "Monte do Wyrt",
    commands
  });
}

function scheduleHandDiscard(target) {
  setTimeout(async () => {
    const confirmed = await confirmModal("Descartar a mão atual?", "Todas as cartas atuais irão para o descarte. Você só voltará a comprar quando a mão for completada pelo mestre ou no início da próxima rodada.");
    if (confirmed) {
      const state = controller.getState();
      const cardIds = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
      await animateCardsExit(cardIds, "discard", target);
      controller.dispatch("discardHand", { target });
    }
  }, 0);
}

function showCardPicker(target) {
  const state = controller.getState();
  const available = new Set([...state.deck, ...state.discard]);
  const cards = CARDS.filter(card => available.has(card.id));
  openModal(`
    <div class="wyrt-picker">
      <span class="wyrt-eyebrow">Trapaça narrativa · ${escapeHTML(target === "foe" ? foeName() : controller.userLabel(target))}</span>
      <h2>Entregar uma carta específica</h2>
      <p>Escolha entre as ${cards.length} cartas que ainda estão no monte ou no descarte.</p>
      <div class="wyrt-picker-grid">${cards.map((card, index) => `
        <button type="button" data-modal-choice="${index}" title="${escapeHTML(card.label)}"><img src="${card.image}" alt="${escapeHTML(card.label)}" loading="lazy"><span>${escapeHTML(card.label)}</span></button>`).join("")}</div>
    </div>`, {
      labelledBy: "Entregar carta específica",
      wide: true,
      onClick: index => controller.dispatch("giveSpecific", { target, cardId: cards[index].id })
    });
}

// As regras são escritas pelo mestre (por exemplo, transcritas do próprio
// suplemento); o módulo não traz nenhum texto oficial.
async function showRules() {
  const fullGM = controller.isFullGM();
  const text = controller.rulesText();
  const body = text
    ? await enrichRules(text)
    : `<p class="wyrt-rules-empty">${fullGM
        ? "Você ainda não escreveu as regras desta mesa. Clique em <strong>Editar regras</strong> para escrevê-las ou colá-las do seu livro."
        : "O mestre ainda não preparou as regras desta mesa."}</p>`;
  openModal(`
    <div class="wyrt-rules">
      <span class="wyrt-eyebrow">Regras da mesa</span><h2>Regras do Wyrt Dimensional</h2>
      <div class="wyrt-rules-body">${body}</div>
      ${fullGM ? '<div class="wyrt-rules-actions"><button type="button" class="wyrt-primary" data-modal-command="edit"><i class="fa-solid fa-pen"></i> Editar regras</button></div>' : ""}
    </div>`, {
      labelledBy: "Regras do Wyrt Dimensional",
      wide: true,
      commands: { edit: () => setTimeout(showRulesEditor, 0) }
    });
}

async function enrichRules(text) {
  const editor = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  try {
    return await editor.enrichHTML(text, { secrets: false });
  } catch {
    return text;
  }
}

// Caixa de texto simples: aceita HTML (para colar um texto já formatado) ou
// texto puro, que vira parágrafos ao salvar.
function showRulesEditor() {
  if (!controller.isFullGM()) return;
  openModal(`
    <div class="wyrt-rules-editor">
      <span class="wyrt-eyebrow">Somente o mestre</span><h2>Editar regras</h2>
      <p>Os jogadores verão este texto ao clicar no livro de regras. Aceita texto puro ou HTML.</p>
      <textarea class="wyrt-rules-input" spellcheck="false" placeholder="Escreva as regras ou cole o HTML aqui…"></textarea>
      <div class="wyrt-rules-body wyrt-rules-preview" hidden></div>
      <div class="wyrt-rules-actions">
        <button type="button" data-wyrt-preview><i class="fa-solid fa-eye"></i> Pré-visualizar</button>
        <button type="button" data-modal-command="cancel">Cancelar</button>
        <button type="button" class="wyrt-primary" data-modal-command="save"><i class="fa-solid fa-floppy-disk"></i> Salvar</button>
      </div>
    </div>`, {
      labelledBy: "Editar regras",
      wide: true,
      closeOnBackdrop: false,
      commands: { save: () => controller.saveRulesText(rulesHTML(input.value)) }
    });
  const layer = document.querySelector("#wyrt-dimensional-modal-layer");
  const input = layer.querySelector(".wyrt-rules-input");
  const preview = layer.querySelector(".wyrt-rules-preview");
  const toggle = layer.querySelector("[data-wyrt-preview]");
  input.value = controller.rulesText();
  input.focus();
  toggle.addEventListener("click", async () => {
    const showing = !preview.hidden;
    if (!showing) preview.innerHTML = await enrichRules(rulesHTML(input.value));
    preview.hidden = showing;
    input.hidden = !showing;
    toggle.innerHTML = showing ? '<i class="fa-solid fa-eye"></i> Pré-visualizar' : '<i class="fa-solid fa-pen"></i> Voltar a editar';
  });
}

function rulesHTML(text) {
  const value = String(text ?? "").trim();
  if (!value || /<[a-z][\s\S]*>/i.test(value)) return value;
  return value.split(/\n\s*\n/).map(paragraph => `<p>${escapeHTML(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

function confirmModal(title, message) {
  return new Promise(resolve => {
    openModal(`<div class="wyrt-confirm"><h2>${escapeHTML(title)}</h2><p>${message}</p><div><button type="button" data-modal-command="cancel">Cancelar</button><button type="button" class="wyrt-primary" data-modal-command="confirm">Confirmar</button></div></div>`, {
      labelledBy: title,
      closeResult: false,
      commands: { cancel: () => resolve(false), confirm: () => resolve(true) },
      onClose: result => { if (result === undefined) resolve(false); }
    });
  });
}

function openModal(content, options = {}) {
  const layer = ensureRoots().ownerDocument.querySelector("#wyrt-dimensional-modal-layer");
  layer.innerHTML = `<div class="wyrt-modal-backdrop"><div class="wyrt-modal ${options.wide ? "is-wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHTML(options.labelledBy ?? "Wyrt Dimensional")}">
    <button type="button" class="wyrt-modal-close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>${content}</div></div>`;
  layer.classList.add("is-open");
  const close = result => {
    layer.classList.remove("is-open");
    layer.innerHTML = "";
    options.onClose?.(result);
  };
  layer.querySelector(".wyrt-modal-close").addEventListener("click", () => close());
  layer.querySelector(".wyrt-modal-backdrop").addEventListener("click", event => {
    if (options.closeOnBackdrop !== false && event.target === event.currentTarget) close();
  });
  layer.querySelectorAll("[data-modal-choice]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.modalChoice);
    options.onClick?.(index);
    close(index);
  }));
  layer.querySelectorAll("[data-modal-command]").forEach(button => button.addEventListener("click", () => {
    const command = button.dataset.modalCommand;
    options.commands?.[command]?.();
    close(command);
  }));
  layer.querySelector("button, input, select")?.focus();
}

function captureStateTransition(state, root) {
  const transition = state.lastTransition ?? {};
  const serial = Number(transition.serial) || 0;
  if (lastSeenTransition === null) {
    lastSeenTransition = serial;
    return;
  }
  if (!serial || serial === lastSeenTransition) return;
  lastSeenTransition = serial;
  if (!state.active || !animationsEnabled()) return;

  const signature = transitionSignature(transition.type, transition.target, transition.cardIds);
  for (const [key, expires] of recentLocalTransitions) {
    if (expires < Date.now()) recentLocalTransitions.delete(key);
  }
  if (recentLocalTransitions.has(signature)) {
    recentLocalTransitions.delete(signature);
    return;
  }

  const sources = (transition.cardIds ?? []).map(cardId => findVisibleCardSource(root, cardId)).filter(Boolean);
  if (sources.length) void animateExitElements(sources, transition.type);
}

async function animateCardsExit(cardIds, type, target) {
  const ids = [...new Set((cardIds ?? []).filter(Boolean))];
  if (!ids.length || !animationsEnabled()) return;
  recentLocalTransitions.set(transitionSignature(type, target, ids), Date.now() + 3500);
  const root = document.querySelector("#wyrt-dimensional-ui");
  const sources = ids.map(cardId => findVisibleCardSource(root, cardId)).filter(Boolean);
  if (!sources.length) return;
  await animateExitElements(sources, type);
}

function transitionSignature(type, target, cardIds) {
  return `${type ?? ""}:${target ?? ""}:${(cardIds ?? []).join("|")}`;
}

function findVisibleCardSource(root, cardId) {
  if (!root) return null;
  const id = CSS.escape(String(cardId));
  const candidates = [
    ...root.querySelectorAll(`.wyrt-hand-hud .wyrt-card-wrap[data-card-id="${id}"]`),
    ...root.querySelectorAll(`.wyrt-opponent-card[data-card-id="${id}"]`),
    ...root.querySelectorAll(`.wyrt-mini-card[data-card-id="${id}"]`)
  ];
  return candidates.find(element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }) ?? null;
}

function animateExitElements(sources, type) {
  const deckRect = document.querySelector("#wyrt-dimensional-ui .wyrt-hand-hud .wyrt-deck-pile img")?.getBoundingClientRect();
  const lite = quality() === "medium";
  const animations = sources.map((source, index) => {
    const image = source.matches("img") ? source : source.querySelector("img");
    const rect = image?.getBoundingClientRect();
    if (!image || !rect || rect.width < 2 || rect.height < 2) return Promise.resolve();

    const flyer = document.createElement("img");
    flyer.className = `wyrt-card-exit-flyer is-${type}${lite ? " is-lite" : ""}`;
    flyer.src = image.currentSrc || image.src;
    flyer.alt = "";
    flyer.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    document.body.append(flyer);
    source.classList.add("is-card-exiting");

    const delay = index * (lite ? 40 : (type === "discard" ? 72 : 45));
    const destination = type === "discard" && deckRect
      ? { left: deckRect.left + (deckRect.width - rect.width) / 2, top: deckRect.top + (deckRect.height - rect.height) / 2 }
      : { left: (window.innerWidth - rect.width) / 2, top: Math.max(90, window.innerHeight * 0.3) };
    const dx = destination.left - rect.left;
    const dy = destination.top - rect.top;
    const keyframes = lite ? [
      { transform: "translate3d(0,0,0) scale(1)", opacity: 1 },
      { transform: `translate3d(${dx}px,${dy}px,0) scale(${type === "discard" ? 0.3 : 1.06})`, opacity: 0 }
    ] : type === "discard" ? [
      { transform: "perspective(900px) translate3d(0,0,0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(1)", opacity: 1 },
      { transform: `perspective(900px) translate3d(${dx * 0.28}px,${dy * 0.12 - 44}px,70px) rotateX(-16deg) rotateY(28deg) rotateZ(${index % 2 ? 10 : -10}deg) scale(.92)`, opacity: 1, offset: 0.38 },
      { transform: `perspective(900px) translate3d(${dx * 0.78}px,${dy * 0.7 - 22}px,24px) rotateX(10deg) rotateY(68deg) rotateZ(${index % 2 ? -16 : 16}deg) scale(.58)`, opacity: 0.82, offset: 0.76 },
      { transform: `perspective(900px) translate3d(${dx}px,${dy}px,0) rotateX(0deg) rotateY(88deg) rotateZ(0deg) scale(.2)`, opacity: 0 }
    ] : [
      { transform: "perspective(1000px) translate3d(0,0,0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(1)", opacity: 1 },
      { transform: `perspective(1000px) translate3d(${dx * 0.25}px,${dy * 0.18 - 55}px,95px) rotateX(-18deg) rotateY(-18deg) rotateZ(-5deg) scale(1.12)`, opacity: 1, offset: 0.38 },
      { transform: `perspective(1000px) translate3d(${dx * 0.72}px,${dy * 0.68 - 36}px,60px) rotateX(8deg) rotateY(22deg) rotateZ(4deg) scale(1.2)`, opacity: 1, offset: 0.76 },
      { transform: `perspective(1000px) translate3d(${dx}px,${dy}px,0) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(1.08)`, opacity: 0 }
    ];
    const animation = flyer.animate(keyframes, {
      duration: lite ? 420 : (type === "discard" ? 680 : 860),
      delay,
      easing: "cubic-bezier(.18,.72,.2,1)",
      fill: "forwards"
    });
    return animation.finished.catch(() => undefined).then(() => {
      flyer.remove();
      setTimeout(() => source.classList.remove("is-card-exiting"), 1800);
    });
  });
  return Promise.all(animations);
}

function animateLatestDraw(state, hud) {
  const target = controller.isFullGM() ? "foe" : (controller.isSpectator() ? spectatorTurnTarget(state) : game.user.id);
  applyPendingDrawVisibility(hud, target);
  const serial = Number(state.lastDraw?.serial) || 0;
  if (lastAnimatedDraw === null) {
    lastAnimatedDraw = serial;
    return;
  }
  if (!serial || serial === lastAnimatedDraw || !state.active) return;
  lastAnimatedDraw = serial;
  if (!animationsEnabled()) return;
  const hand = target === "foe" ? state.foeHand : (state.hands[target] ?? []);
  const count = Number(state.lastDraw?.counts?.[target]) || 0;
  const recorded = state.lastDraw?.cards?.[target] ?? [];
  const cardIds = recorded.length ? recorded.filter(cardId => hand.includes(cardId)) : hand.slice(-count);
  if (!cardIds.length) return;

  activeDrawAnimations.set(serial, { target, cardIds: new Set(cardIds) });
  applyPendingDrawVisibility(hud, target);
  void preloadCardImages(cardIds).then(() => requestAnimationFrame(() => flyCards(hud, cardIds, serial)));
}

function preloadCardImages(cardIds) {
  const loads = cardIds.map(cardId => new Promise(resolve => {
    const src = getCard(cardId)?.image;
    if (!src) return resolve();
    const image = new Image();
    image.onload = resolve;
    image.onerror = resolve;
    image.src = src;
    if (image.complete) resolve();
  }));
  return Promise.race([
    Promise.all(loads),
    new Promise(resolve => setTimeout(resolve, 2500))
  ]);
}

function applyPendingDrawVisibility(hud, target) {
  for (const record of activeDrawAnimations.values()) {
    if (record.target !== target) continue;
    for (const cardId of record.cardIds) {
      hud.querySelector(`.wyrt-card-wrap[data-card-id="${CSS.escape(String(cardId))}"]`)?.classList.add("is-draw-pending");
    }
  }
}

function finishDrawCard(serial, cardId) {
  const record = activeDrawAnimations.get(serial);
  record?.cardIds.delete(cardId);
  if (record && !record.cardIds.size) activeDrawAnimations.delete(serial);
  const wrapper = document.querySelector(`#wyrt-dimensional-ui .wyrt-hud-slot .wyrt-card-wrap[data-card-id="${CSS.escape(String(cardId))}"]`);
  if (!wrapper) return;
  wrapper.classList.remove("is-draw-pending");
  wrapper.classList.add("is-draw-arrived");
  setTimeout(() => wrapper.classList.remove("is-draw-arrived"), 380);
}

function flyCards(hud, cardIds, serial) {
  const source = hud.querySelector(".wyrt-deck-pile img")?.getBoundingClientRect();
  if (!source || source.width < 2 || source.height < 2) {
    cardIds.forEach(cardId => finishDrawCard(serial, cardId));
    return;
  }
  const lite = quality() === "medium";
  cardIds.forEach((cardId, index) => {
    const destination = hud.querySelector(`.wyrt-card-wrap[data-card-id="${CSS.escape(String(cardId))}"]`);
    const image = destination?.querySelector("img");
    const target = image?.getBoundingClientRect();
    if (!target || target.width < 2 || target.height < 2) {
      finishDrawCard(serial, cardId);
      return;
    }
    const flyer = document.createElement("img");
    flyer.className = `wyrt-card-flyer${lite ? " is-lite" : ""}`;
    flyer.src = cardBack();
    flyer.style.cssText = `left:${source.left}px;top:${source.top}px;width:${source.width}px;height:${source.height}px;`;
    document.body.append(flyer);
    const dx = target.left - source.left;
    const dy = target.top - source.top;
    const scaleX = target.width / source.width;
    const scaleY = target.height / source.height;
    const delay = index * (lite ? 90 : 145);
    // A troca do verso pela frente acontece quando a carta está de perfil (rotateY 90°).
    const flipTimer = setTimeout(() => { flyer.src = image.currentSrc || image.src; }, delay + (lite ? 310 : 535));
    const liteMidpoint = `translate3d(${dx * 0.5}px,${dy * 0.5 - 40}px,0) scale(${(1 + scaleX) / 2},${(1 + scaleY) / 2})`;
    const keyframes = lite ? [
      { transform: "translate3d(0,0,0) scale(1) rotateY(0deg)", opacity: 0.9, offset: 0 },
      { transform: `${liteMidpoint} rotateY(90deg)`, opacity: 1, offset: 0.5 },
      { transform: `${liteMidpoint} rotateY(-90deg)`, opacity: 1, offset: 0.501 },
      { transform: `translate3d(${dx}px,${dy}px,0) scale(${scaleX},${scaleY}) rotateY(0deg)`, opacity: 1, offset: 1 }
    ] : [
      { transform: "perspective(900px) translate3d(0,0,0) scale(1) rotateX(7deg) rotateY(0deg) rotateZ(-9deg)", opacity: 0.88, offset: 0 },
      { transform: `perspective(900px) translate3d(${dx * 0.28}px,${dy * 0.18 - 48}px,55px) scale(${(1 + scaleX) / 2},${(1 + scaleY) / 2}) rotateX(-13deg) rotateY(48deg) rotateZ(-3deg)`, opacity: 1, offset: 0.32 },
      { transform: `perspective(900px) translate3d(${dx * 0.62}px,${dy * 0.52 - 82}px,80px) scale(${(1 + scaleX) / 2},${(1 + scaleY) / 2}) rotateX(-8deg) rotateY(88deg) rotateZ(6deg)`, opacity: 1, offset: 0.54 },
      { transform: `perspective(900px) translate3d(${dx * 0.62}px,${dy * 0.52 - 82}px,80px) scale(${(1 + scaleX) / 2},${(1 + scaleY) / 2}) rotateX(-8deg) rotateY(-88deg) rotateZ(6deg)`, opacity: 1, offset: 0.55 },
      { transform: `perspective(900px) translate3d(${dx * 0.82}px,${dy * 0.78 - 32}px,32px) scale(${scaleX},${scaleY}) rotateX(3deg) rotateY(-32deg) rotateZ(2deg)`, opacity: 1, offset: 0.8 },
      { transform: `perspective(900px) translate3d(${dx}px,${dy}px,0) scale(${scaleX},${scaleY}) rotateX(0deg) rotateY(0deg) rotateZ(0deg)`, opacity: 1, offset: 1 }
    ];
    const animation = flyer.animate(keyframes, { duration: lite ? 620 : 980, delay, easing: "cubic-bezier(.18,.72,.2,1)", fill: "forwards" });
    animation.finished.catch(() => undefined).then(() => {
      clearTimeout(flipTimer);
      flyer.remove();
      finishDrawCard(serial, cardId);
    });
  });
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const QUALITY_LEVELS = ["low", "medium", "high"];

function quality() {
  const level = controller?.visualQuality?.();
  return QUALITY_LEVELS.includes(level) ? level : "high";
}

// Na qualidade baixa as cartas aparecem direto na mão, sem voo nem virada.
function animationsEnabled() {
  return !prefersReducedMotion() && quality() !== "low";
}

function applyQualityClass(element) {
  if (!element) return;
  const level = quality();
  for (const option of QUALITY_LEVELS) element.classList.toggle(`wyrt-quality-${option}`, option === level);
}

function dragAttributes(key) {
  const position = loadPosition(key);
  const style = position
    ? ` style="left:${position.x}px;top:${position.y}px;right:auto;bottom:auto;transform:none"`
    : "";
  return `data-wyrt-drag-key="${key}"${style}`;
}

function onDragStart(event) {
  if (event.button !== 0) return;
  const handle = event.target.closest("[data-wyrt-drag-handle]");
  const widget = handle?.closest("[data-wyrt-drag-key]");
  if (!widget) return;
  const interactive = event.target.closest("button, input, select, a");
  if (interactive && !interactive.classList.contains("wyrt-gm-launcher")) return;

  const rect = widget.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;

  const onMove = moveEvent => {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    moveEvent.preventDefault();
    const maxX = Math.max(4, window.innerWidth - Math.min(rect.width, window.innerWidth - 8) - 4);
    const maxY = Math.max(4, window.innerHeight - Math.min(rect.height, window.innerHeight - 8) - 4);
    const x = Math.round(Math.min(maxX, Math.max(4, rect.left + dx)));
    const y = Math.round(Math.min(maxY, Math.max(4, rect.top + dy)));
    widget.style.left = `${x}px`;
    widget.style.top = `${y}px`;
    widget.style.right = "auto";
    widget.style.bottom = "auto";
    widget.style.transform = "none";
    widget.classList.add("is-dragging");
  };

  const onEnd = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEnd);
    window.removeEventListener("pointercancel", onEnd);
    widget.classList.remove("is-dragging");
    if (!moved) return;
    savePosition(widget.dataset.wyrtDragKey, {
      x: Math.round(parseFloat(widget.style.left) || widget.getBoundingClientRect().left),
      y: Math.round(parseFloat(widget.style.top) || widget.getBoundingClientRect().top)
    });
    widget.dataset.ignoreClickUntil = String(Date.now() + 250);
  };

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onEnd, { once: true });
  window.addEventListener("pointercancel", onEnd, { once: true });
}

function positionStorageKey(key) {
  return `${MODULE_ID}.position.${game.world?.id ?? "world"}.${game.user?.id ?? "user"}.${key}`;
}

function loadPosition(key) {
  try {
    const position = JSON.parse(localStorage.getItem(positionStorageKey(key)) || "null");
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return null;
    return {
      x: Math.max(4, Math.min(window.innerWidth - 40, Math.round(position.x))),
      y: Math.max(4, Math.min(window.innerHeight - 40, Math.round(position.y)))
    };
  } catch {
    return null;
  }
}

function savePosition(key, position) {
  try {
    localStorage.setItem(positionStorageKey(key), JSON.stringify(position));
  } catch {
    // Navegadores com armazenamento local bloqueado mantêm a posição só até a próxima renderização.
  }
}

function escapeHTML(value) {
  const text = String(value ?? "");
  if (globalThis.foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(text);
  return text.replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function foeName(state = controller.getState()) {
  return String(state.foeName ?? "").trim() || "Adversário";
}
