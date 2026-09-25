const socket = io();

let GAME_DATA_LOCAL = typeof GAME_DATA !== "undefined" ? GAME_DATA : [];
let currentGameState = {
  currentRound: 0,
  currentSubmission: 0,
  revealed: {
    ans1: false,
    ans2: false,
    ans3: false,
    meme: false,
    author: false,
  },
  buzzerQueue: [],
};
let myPlayerName = "";
let playersList = [];

// Inizializzazione
socket.on("init_game", (data) => {
  if (data && data.gameData && data.gameData.length > 0) {
    GAME_DATA_LOCAL = data.gameData;
  }
  if (data && data.state) {
    currentGameState = data.state;
    renderBuzzerQueue(data.state.buzzerQueue || []);
  }
  updateViews();
});

function goToView(viewId) {
  document
    .querySelectorAll(".view-section")
    .forEach((el) => el.classList.add("hidden"));
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.remove("hidden");
    updateViews();
  }
}

// Giocatore
function joinGame() {
  const input = document.getElementById("player-name-input");
  const name = input.value.trim();
  if (!name) return;

  myPlayerName = name;
  socket.emit("join_game", myPlayerName);
}

socket.on("joined_successfully", () => {
  document.getElementById("player-login-box").classList.add("hidden");
  document.getElementById("player-game-box").classList.remove("hidden");
  document.getElementById("player-name-display").textContent = myPlayerName;
});

function hitBuzzer() {
  socket.emit("press_buzzer");
}

// Navigazione Schede
function nextCard() {
  if (!GAME_DATA_LOCAL || GAME_DATA_LOCAL.length === 0) return;
  const round = GAME_DATA_LOCAL[currentGameState.currentRound];
  const validSubs = round.submissions.filter(
    (s) => s.player && s.player !== "a a",
  );

  if (currentGameState.currentSubmission < validSubs.length - 1) {
    currentGameState.currentSubmission++;
  } else if (currentGameState.currentRound < GAME_DATA_LOCAL.length - 1) {
    currentGameState.currentRound++;
    currentGameState.currentSubmission = 0;
  }
  socket.emit("change_card", {
    roundIdx: currentGameState.currentRound,
    subIdx: currentGameState.currentSubmission,
  });
}

function prevCard() {
  if (!GAME_DATA_LOCAL || GAME_DATA_LOCAL.length === 0) return;
  if (currentGameState.currentSubmission > 0) {
    currentGameState.currentSubmission--;
  } else if (currentGameState.currentRound > 0) {
    currentGameState.currentRound--;
    const validSubs = GAME_DATA_LOCAL[
      currentGameState.currentRound
    ].submissions.filter((s) => s.player && s.player !== "a a");
    currentGameState.currentSubmission = validSubs.length - 1;
  }
  socket.emit("change_card", {
    roundIdx: currentGameState.currentRound,
    subIdx: currentGameState.currentSubmission,
  });
}

// Reveal Controls
function triggerToggleReveal(targetKey) {
  socket.emit("toggle_reveal", targetKey);
}

function triggerRevealAllTop3() {
  socket.emit("reveal_all_top3");
}

function triggerBuzzerReset() {
  socket.emit("reset_buzzer");
}

function triggerPassBuzzerTurn() {
  socket.emit("pass_buzzer_turn");
}

function scoreCurrentBuzzWinner(points) {
  if (currentGameState.buzzerQueue && currentGameState.buzzerQueue.length > 0) {
    const winnerName = currentGameState.buzzerQueue[0].name;
    socket.emit("update_score", { playerName: winnerName, delta: points });
  }
}

// Eventi Socket
socket.on("card_updated", (state) => {
  currentGameState = state;
  renderBuzzerQueue([]);
  updateViews();
});

socket.on("reveal_updated", (revealedState) => {
  currentGameState.revealed = revealedState;
  applyRevealUI();
});

socket.on("buzzer_queue_updated", ({ queue }) => {
  currentGameState.buzzerQueue = queue;
  renderBuzzerQueue(queue);

  const btn = document.getElementById("buzzer-btn");
  const status = document.getElementById("player-status-msg");

  const myIndex = queue.findIndex((item) => item.name === myPlayerName);
  if (myIndex !== -1) {
    if (myIndex === 0) {
      if (btn) btn.classList.add("disabled");
      if (status) {
        status.textContent = "👑 TOCCA A TE! RISPONDI!";
        status.style.color = "#00ff66";
      }
    } else {
      if (btn) btn.classList.add("disabled");
      if (status) {
        status.textContent = `Sei in coda al ${myIndex + 1}° posto...`;
        status.style.color = "#ffe600";
      }
    }
  }
});

socket.on("buzzer_reset", () => {
  currentGameState.buzzerQueue = [];
  renderBuzzerQueue([]);

  const btn = document.getElementById("buzzer-btn");
  const status = document.getElementById("player-status-msg");
  if (btn) btn.classList.remove("disabled");
  if (status) {
    status.textContent = "Buzzer Pronto! Premi per prenotarti!";
    status.style.color = "#00f0ff";
  }
});

socket.on("update_players", (players) => {
  playersList = players;
  renderScoreboards();

  const me = players.find((p) => p.name === myPlayerName);
  if (me) {
    const scoreEl = document.getElementById("player-score-display");
    if (scoreEl) scoreEl.textContent = `${me.score} PT`;
  }
});

function modifyScore(playerName, delta) {
  socket.emit("update_score", { playerName, delta });
}

// ==================== RENDERING UI ====================
function updateViews() {
  if (!GAME_DATA_LOCAL || GAME_DATA_LOCAL.length === 0) return;

  const round = GAME_DATA_LOCAL[currentGameState.currentRound];
  if (!round) return;

  const validSubs = round.submissions.filter(
    (s) => s.player && s.player !== "a a",
  );
  const sub = validSubs[currentGameState.currentSubmission] || validSubs[0];
  if (!sub) return;

  // Schermo Host
  document.getElementById("host-round-badge").textContent =
    `Round ${round.round} / ${GAME_DATA_LOCAL.length}`;
  document.getElementById("host-card-counter").textContent =
    `Scheda ${currentGameState.currentSubmission + 1} di ${validSubs.length}`;
  document.getElementById("host-story").textContent = round.story;
  document.getElementById("host-ans-1").textContent = sub.top3[0] || "---";
  document.getElementById("host-ans-2").textContent = sub.top3[1] || "---";
  document.getElementById("host-ans-3").textContent = sub.top3[2] || "---";
  document.getElementById("host-ans-meme").textContent = sub.meme || "---";
  document.getElementById("host-author-name").textContent = sub.player;

  // Regia
  document.getElementById("regia-round-title").textContent =
    `Round ${round.round}: ${round.story.substring(0, 45)}...`;
  document.getElementById("regia-card-counter").textContent =
    `Scheda ${currentGameState.currentSubmission + 1} / ${validSubs.length}`;
  document.getElementById("regia-author-name").textContent = sub.player;
  document.getElementById("regia-ans-1").textContent = sub.top3[0] || "---";
  document.getElementById("regia-ans-2").textContent = sub.top3[1] || "---";
  document.getElementById("regia-ans-3").textContent = sub.top3[2] || "---";
  document.getElementById("regia-ans-meme").textContent = sub.meme || "---";

  applyRevealUI();
}

function applyRevealUI() {
  const rev = currentGameState.revealed || {};

  // Host: Gestione classi blur-hidden
  const setBox = (id, isShown) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isShown) el.classList.remove("blur-hidden");
    else el.classList.add("blur-hidden");
  };

  setBox("box-ans-1", rev.ans1);
  setBox("box-ans-2", rev.ans2);
  setBox("box-ans-3", rev.ans3);
  setBox("box-ans-meme", rev.meme);
  setBox("box-ans-author", rev.author);

  // Regia: Aggiornamento etichette pulsanti
  const setRegiaBtn = (id, isShown, label) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = isShown ? `Nascondi ${label}` : `Mostra ${label}`;
    if (isShown) {
      el.classList.add("btn-active-revealed");
    } else {
      el.classList.remove("btn-active-revealed");
    }
  };

  setRegiaBtn("regia-btn-ans1", rev.ans1, "Top 1");
  setRegiaBtn("regia-btn-ans2", rev.ans2, "Top 2");
  setRegiaBtn("regia-btn-ans3", rev.ans3, "Top 3");
  setRegiaBtn("regia-btn-meme", rev.meme, "Meme");
  setRegiaBtn("regia-btn-author", rev.author, "Autore");
}

function renderBuzzerQueue(queue) {
  const hostCard = document.getElementById("host-buzzer-queue-card");
  const hostList = document.getElementById("host-buzzer-list");
  const regiaCard = document.getElementById("regia-buzzer-queue-card");
  const regiaList = document.getElementById("regia-buzzer-list");

  if (!queue || queue.length === 0) {
    if (hostCard) hostCard.classList.add("hidden");
    if (regiaCard) regiaCard.classList.add("hidden");
    if (hostList) hostList.innerHTML = "";
    if (regiaList) regiaList.innerHTML = "";
    return;
  }

  if (hostCard) hostCard.classList.remove("hidden");
  if (regiaCard) regiaCard.classList.remove("hidden");

  const generateHtml = (isRegia = false) => {
    return queue
      .map((item, idx) => {
        const isFirst = idx === 0;
        return `
        <div class="buzzer-queue-item ${isFirst ? "active-turn" : ""}">
          <span class="queue-pos">${idx + 1}°</span>
          <span class="queue-name">${item.name}</span>
          ${isFirst ? '<span class="turn-badge">STA RISPONDENDO</span>' : ""}
          ${
            isRegia && isFirst
              ? `
            <div class="queue-quick-score">
              <button class="btn btn-sm btn-primary" onclick="scoreCurrentBuzzWinner(1)">+1 Pt</button>
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  };

  if (hostList) hostList.innerHTML = generateHtml(false);
  if (regiaList) regiaList.innerHTML = generateHtml(true);
}

function renderScoreboards() {
  const hostBoard = document.getElementById("host-scoreboard");
  const regiaBoard = document.getElementById("regia-scoreboard");
  if (!hostBoard || !regiaBoard) return;

  hostBoard.innerHTML = "";
  regiaBoard.innerHTML = "";

  playersList.forEach((p) => {
    const cardHtml = `
      <span class="score-name" title="${p.name}">${p.name}</span>
      <div class="score-controls">
        <button class="score-btn" onclick="modifyScore('${p.name}', -1)">-</button>
        <span class="score-val">${p.score}</span>
        <button class="score-btn" onclick="modifyScore('${p.name}', 1)">+</button>
      </div>
    `;

    const c1 = document.createElement("div");
    c1.className = "score-card";
    c1.innerHTML = cardHtml;
    hostBoard.appendChild(c1);

    const c2 = document.createElement("div");
    c2.className = "score-card";
    c2.innerHTML = cardHtml;
    regiaBoard.appendChild(c2);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  updateViews();
});
