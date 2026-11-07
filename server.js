const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const DATA_DIR = path.join(__dirname, "data");

function loadAllCategories() {
  const categories = {};
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

    files.forEach((file) => {
      try {
        const fullPath = path.join(DATA_DIR, file);
        const content = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        const key = content.id || path.basename(file, ".json");
        categories[key] = {
          id: key,
          fileName: file,
          categoryTitle: content.categoryTitle || key,
          items: content.items || [],
        };
      } catch (e) {
        console.error(`Errore caricamento ${file}:`, e);
      }
    });
  } catch (err) {
    console.error("Errore lettura directory data:", err);
  }
  return categories;
}

let availableCategories = loadAllCategories();
let currentCategoryKey = Object.keys(availableCategories)[0] || null;
let connectedPlayers = {}; // socketId -> { socketId, name, teamId, score, stats }

let gameState = {
  status: "LOBBY",
  mode: "RUSH",
  currentCategoryKey: currentCategoryKey,
  categoryTitle: currentCategoryKey
    ? availableCategories[currentCategoryKey].categoryTitle
    : "Nessuna Categoria",
  teams: [
    {
      id: "t1",
      name: "Squadra Rossa",
      color: "#ef4444",
      icon: "🔥",
      score: 0,
      members: [],
    },
    {
      id: "t2",
      name: "Squadra Blu",
      color: "#3b82f6",
      icon: "⚡",
      score: 0,
      members: [],
    },
  ],
  revealed: {},
  showInitials: false,
  activeTeamIndex: 0,
  turnTimer: { duration: 30, remaining: 30 },
  timer: { duration: 300, remaining: 300, isRunning: false },
  // Opzioni Chicche (Toggles)
  options: {
    emojiReactions: true,
    specialSlots: true,
    fastFlip: true,
    haptics: true,
    finalAwards: true,
    frenzy60: true,
  },
  goldenSlots: [],
  bombSlots: [],
  gameStartTime: null,
};

let mainTimerInterval = null;

function getInitialsMap() {
  if (
    !gameState.showInitials ||
    !currentCategoryKey ||
    !availableCategories[currentCategoryKey]
  )
    return {};
  const map = {};
  availableCategories[currentCategoryKey].items.forEach((it) => {
    if (!gameState.revealed[it.rank]) {
      const clean = it.name.trim();
      map[it.rank] = clean.charAt(0).toUpperCase();
    }
  });
  return map;
}

function startTimer() {
  if (mainTimerInterval || gameState.timer.remaining <= 0) return;
  gameState.timer.isRunning = true;
  io.emit("timerTick", {
    global: gameState.timer,
    turn: gameState.turnTimer,
    activeTeamId: getActiveTeam().id,
    isFrenzy: isFrenzyActive(),
  });

  mainTimerInterval = setInterval(() => {
    let tickGlobal = false;
    let tickTurn = false;

    if (gameState.timer.remaining > 0) {
      gameState.timer.remaining--;
      tickGlobal = true;
    } else {
      pauseTimer();
      io.emit("timerExpired", {
        awards: gameState.options.finalAwards ? calculateAwards() : null,
      });
      return;
    }

    if (gameState.mode === "TURNS") {
      if (gameState.turnTimer.remaining > 0) {
        gameState.turnTimer.remaining--;
      } else {
        passToNextTurn("Tempo scaduto!");
      }
      tickTurn = true;
    }

    if (tickGlobal || tickTurn) {
      io.emit("timerTick", {
        global: gameState.timer,
        turn: gameState.turnTimer,
        activeTeamId: getActiveTeam().id,
        isFrenzy: isFrenzyActive(),
      });
    }
  }, 1000);
}

function pauseTimer() {
  if (mainTimerInterval) {
    clearInterval(mainTimerInterval);
    mainTimerInterval = null;
  }
  gameState.timer.isRunning = false;
  io.emit("timerTick", {
    global: gameState.timer,
    turn: gameState.turnTimer,
    activeTeamId: getActiveTeam().id,
    isFrenzy: isFrenzyActive(),
  });
}

function isFrenzyActive() {
  return (
    gameState.options.frenzy60 &&
    gameState.timer.remaining <= 60 &&
    gameState.timer.remaining > 0 &&
    gameState.timer.isRunning
  );
}

function getActiveTeam() {
  if (!gameState.teams || gameState.teams.length === 0) return { id: null };
  return gameState.teams[gameState.activeTeamIndex % gameState.teams.length];
}

function passToNextTurn(reasonMessage = null) {
  gameState.activeTeamIndex =
    (gameState.activeTeamIndex + 1) % gameState.teams.length;
  gameState.turnTimer.remaining = gameState.turnTimer.duration;

  io.emit("turnChanged", {
    activeTeam: getActiveTeam(),
    reason: reasonMessage,
    turnTimer: gameState.turnTimer,
  });
}

function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function getCategoriesList() {
  return Object.values(availableCategories).map((c) => ({
    id: c.id,
    title: c.categoryTitle,
    itemCount: c.items.length,
  }));
}

function distributePlayersRandomly(playerList, teams) {
  teams.forEach((t) => (t.members = []));
  const shuffled = [...playerList].sort(() => Math.random() - 0.5);
  shuffled.forEach((p, index) => {
    const targetTeam = teams[index % teams.length];
    targetTeam.members.push({ socketId: p.socketId, name: p.name });
    p.teamId = targetTeam.id;
  });
  return teams;
}

// Calcolo delle Pagelle & Titoli Ironici
function calculateAwards() {
  const players = Object.values(connectedPlayers);
  if (players.length === 0) return [];

  const awards = [];

  // 1. Il Cecchino: rank più alto numericamente (posizione più difficile)
  let bestSniper = { name: "Nessuno", rank: 0 };
  Object.keys(gameState.revealed).forEach((r) => {
    const rankNum = parseInt(r, 10);
    if (rankNum > bestSniper.rank) {
      bestSniper = {
        name: gameState.revealed[r].playerName,
        rank: rankNum,
        title: gameState.revealed[r].itemName,
      };
    }
  });
  if (bestSniper.rank > 0) {
    awards.push({
      title: "🎯 Il Cecchino",
      desc: `Ha scovato la posizione più remota: #${bestSniper.rank} (${bestSniper.title})`,
      winner: bestSniper.name,
    });
  }

  // 2. L'Avvoltoio: più risposte nei primi 20 secondi
  const vulture = [...players].sort(
    (a, b) => (b.stats?.earlyGuesses || 0) - (a.stats?.earlyGuesses || 0),
  )[0];
  if (vulture && (vulture.stats?.earlyGuesses || 0) > 0) {
    awards.push({
      title: "🦅 L'Avvoltoio",
      desc: `Più veloce di tutti nei primi 20 secondi (${vulture.stats.earlyGuesses} prese)`,
      winner: vulture.name,
    });
  }

  // 3. Raffica a Vuoto: più errori totali
  const spammer = [...players].sort(
    (a, b) => (b.stats?.wrongGuesses || 0) - (a.stats?.wrongGuesses || 0),
  )[0];
  if (spammer && (spammer.stats?.wrongGuesses || 0) > 0) {
    awards.push({
      title: "🤡 Raffica a Vuoto",
      desc: `Record assoluto di tentativi a vuoto (${spammer.stats.wrongGuesses} errori)`,
      winner: spammer.name,
    });
  }

  // 4. L'Eterno Secondo: chi ha provato più volte risposte appena rubate
  const eternalSecond = [...players].sort(
    (a, b) => (b.stats?.stolenTries || 0) - (a.stats?.stolenTries || 0),
  )[0];
  if (eternalSecond && (eternalSecond.stats?.stolenTries || 0) > 0) {
    awards.push({
      title: "🐢 L'Eterno Secondo",
      desc: `Beffato più volte sul filo del rasoio (${eternalSecond.stats.stolenTries} risposte già prese)`,
      winner: eternalSecond.name,
    });
  }

  return awards;
}

io.on("connection", (socket) => {
  socket.emit("initSync", {
    gameState,
    categoriesList: getCategoriesList(),
    playersList: Object.values(connectedPlayers),
    myPlayerInfo: connectedPlayers[socket.id] || null,
    activeTeam: getActiveTeam(),
    initialsMap: getInitialsMap(),
  });

  socket.on("joinGame", (name) => {
    const cleanName = (name || "").trim() || `Ospite_${socket.id.slice(0, 4)}`;
    connectedPlayers[socket.id] = {
      socketId: socket.id,
      name: cleanName,
      teamId: null,
      score: 0,
      stats: { wrongGuesses: 0, stolenTries: 0, earlyGuesses: 0 },
    };
    io.emit("playersListUpdated", Object.values(connectedPlayers));
    socket.emit("joinedSuccess", connectedPlayers[socket.id]);
  });

  socket.on("assignPlayerToTeam", ({ socketId, teamId }) => {
    if (connectedPlayers[socketId]) {
      connectedPlayers[socketId].teamId = teamId || null;
      const targetTeam = gameState.teams.find((t) => t.id === teamId);
      io.to(socketId).emit("teamAssignmentChanged", targetTeam || null);
      io.emit("playersListUpdated", Object.values(connectedPlayers));
    }
  });

  // Chicca 1: Reazioni Emoji Volanti inviate da smartphone
  socket.on("sendReaction", (emoji) => {
    if (gameState.options.emojiReactions) {
      io.emit("reactionTriggered", { emoji, id: Date.now() + Math.random() });
    }
  });

  socket.on("getCategoryForEdit", (catId) => {
    socket.emit("categoryDataForEdit", availableCategories[catId] || null);
  });

  socket.on("saveCategory", (payload) => {
    try {
      const { id, title, items } = payload;
      if (!title || !items || items.length === 0) {
        socket.emit("categorySaveResult", {
          success: false,
          message: "Dati incompleti!",
        });
        return;
      }

      const fileId =
        id ||
        title
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") ||
        `cat-${Date.now()}`;

      const catObj = {
        id: fileId,
        categoryTitle: title,
        items: items.map((it, idx) => ({
          rank: parseInt(it.rank, 10) || idx + 1,
          name: it.name.trim(),
          aliases: Array.isArray(it.aliases)
            ? it.aliases.map((a) => a.trim()).filter(Boolean)
            : [],
        })),
      };

      const targetPath = path.join(DATA_DIR, `${fileId}.json`);
      fs.writeFileSync(targetPath, JSON.stringify(catObj, null, 2), "utf-8");

      availableCategories = loadAllCategories();
      const updatedList = getCategoriesList();

      if (gameState.currentCategoryKey === fileId) {
        gameState.categoryTitle = catObj.categoryTitle;
      }

      socket.emit("categorySaveResult", {
        success: true,
        savedId: fileId,
        categoryObj: catObj,
      });
      io.emit("categoriesUpdated", updatedList);
    } catch (err) {
      console.error("Errore salvataggio:", err);
      socket.emit("categorySaveResult", {
        success: false,
        message: "Errore durante la scrittura su file.",
      });
    }
  });

  socket.on("toggleInitials", () => {
    gameState.showInitials = !gameState.showInitials;
    io.emit("initialsToggled", {
      showInitials: gameState.showInitials,
      initialsMap: getInitialsMap(),
    });
  });

  // Chicca 3: Fast Flip - Richiesta di rivelazione di tutti gli elementi mancanti
  socket.on("requestFastFlip", () => {
    if (
      !gameState.options.fastFlip ||
      !currentCategoryKey ||
      !availableCategories[currentCategoryKey]
    )
      return;
    const remaining = [];
    availableCategories[currentCategoryKey].items.forEach((it) => {
      if (!gameState.revealed[it.rank]) {
        remaining.push({ rank: it.rank, itemName: it.name });
      }
    });
    io.emit("fastFlipTriggered", remaining);
  });

  socket.on("startGameWithConfig", (config) => {
    const {
      categoryKey,
      teams,
      duration,
      mode,
      turnDuration,
      shuffleTeams,
      options,
    } = config;
    availableCategories = loadAllCategories();

    if (availableCategories[categoryKey]) {
      currentCategoryKey = categoryKey;
      gameState.currentCategoryKey = categoryKey;
      gameState.categoryTitle = availableCategories[categoryKey].categoryTitle;
    }

    gameState.mode = mode || "RUSH";
    gameState.options = { ...gameState.options, ...(options || {}) };

    let finalTeams = teams.map((t) => ({ ...t, score: 0, members: [] }));
    const playersArray = Object.values(connectedPlayers);

    playersArray.forEach((p) => {
      p.score = 0;
      p.stats = { wrongGuesses: 0, stolenTries: 0, earlyGuesses: 0 };
    });

    if (shuffleTeams) {
      finalTeams = distributePlayersRandomly(playersArray, finalTeams);
    } else {
      playersArray.forEach((p) => {
        let team = finalTeams.find((t) => t.id === p.teamId);
        if (!team) {
          finalTeams.sort((a, b) => a.members.length - b.members.length);
          team = finalTeams[0];
          p.teamId = team.id;
        }
        team.members.push({ socketId: p.socketId, name: p.name });
      });
    }

    gameState.teams = finalTeams;
    gameState.revealed = {};
    gameState.showInitials = false;
    gameState.status = "PLAYING";
    gameState.activeTeamIndex = 0;
    gameState.gameStartTime = Date.now();

    // Chicca 2: Selezione casuale degli Slot Speciali (Dorati & Bomba)
    if (gameState.options.specialSlots) {
      const ranksPool = Array.from({ length: 100 }, (_, i) => i + 1).sort(
        () => Math.random() - 0.5,
      );
      gameState.goldenSlots = [ranksPool[0], ranksPool[1]]; // 2 slot dorati
      gameState.bombSlots = [ranksPool[2]]; // 1 slot bomba
    } else {
      gameState.goldenSlots = [];
      gameState.bombSlots = [];
    }

    const turnSec =
      parseInt(turnDuration, 10) > 0 ? parseInt(turnDuration, 10) : 30;
    gameState.turnTimer.duration = turnSec;
    gameState.turnTimer.remaining = turnSec;

    pauseTimer();
    const totalSec = parseInt(duration, 10) > 0 ? parseInt(duration, 10) : 300;
    gameState.timer.duration = totalSec;
    gameState.timer.remaining = totalSec;

    playersArray.forEach((p) => {
      const assignedTeam = gameState.teams.find((t) => t.id === p.teamId);
      io.to(p.socketId).emit("assignedTeam", {
        team: assignedTeam,
        gameState,
        activeTeam: getActiveTeam(),
        playerScore: p.score,
      });
    });

    io.emit("gameState", {
      ...gameState,
      categoriesList: getCategoriesList(),
      playersList: Object.values(connectedPlayers),
      activeTeam: getActiveTeam(),
      initialsMap: getInitialsMap(),
    });

    startTimer();
  });

  socket.on("timerControl", (action) => {
    if (action.type === "START") startTimer();
    else if (action.type === "PAUSE") pauseTimer();
    else if (action.type === "RESET") {
      pauseTimer();
      gameState.timer.remaining = gameState.timer.duration;
      gameState.turnTimer.remaining = gameState.turnTimer.duration;
      io.emit("timerTick", {
        global: gameState.timer,
        turn: gameState.turnTimer,
        activeTeamId: getActiveTeam().id,
        isFrenzy: isFrenzyActive(),
      });
    } else if (action.type === "SKIP_TURN") {
      if (gameState.mode === "TURNS") passToNextTurn("Turno saltato dall'Host");
    }
  });

  socket.on("submitGuess", (payload) => {
    if (gameState.timer.remaining <= 0) {
      socket.emit("guessResult", {
        status: "LOCKED",
        message: "⏳ Tempo scaduto! Invii bloccati.",
      });
      return;
    }
    if (!gameState.timer.isRunning) {
      socket.emit("guessResult", {
        status: "LOCKED",
        message: "⏸️ Il timer è in pausa!",
      });
      return;
    }

    const player = connectedPlayers[socket.id];
    const teamId = player ? player.teamId : payload.teamId;
    const playerName = player ? player.name : payload.playerName;
    const activeTeam = getActiveTeam();

    if (gameState.mode === "TURNS" && teamId !== activeTeam.id) {
      socket.emit("guessResult", {
        status: "LOCKED",
        message: `⛔ Non è il tuo turno! Tocca a: ${activeTeam.name}`,
      });
      return;
    }

    const cleanGuess = normalizeText(payload.guess || "");
    if (
      !cleanGuess ||
      !currentCategoryKey ||
      !availableCategories[currentCategoryKey]
    )
      return;

    const currentItems = availableCategories[currentCategoryKey].items;
    const matched = currentItems.find((item) => {
      const matchName = normalizeText(item.name) === cleanGuess;
      const matchAlias =
        item.aliases &&
        item.aliases.some((a) => normalizeText(a) === cleanGuess);
      return matchName || matchAlias;
    });

    if (!matched) {
      if (player && player.stats) player.stats.wrongGuesses++;
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza!",
      });
      if (gameState.mode === "TURNS")
        passToNextTurn(`${activeTeam.name} ha sbagliato!`);
      return;
    }

    if (gameState.revealed[matched.rank]) {
      if (player && player.stats) player.stats.stolenTries++;
      const orig = gameState.revealed[matched.rank];
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        message: `⚠️ #${matched.rank} già presa da ${orig.teamName}! 0 pt.`,
      });
      if (gameState.mode === "TURNS") passToNextTurn(`Posizione già presa!`);
      return;
    }

    // Calcolo Punteggio con Chicche: Slot Speciali & Frenzy Last 60s
    let points = matched.rank;
    let slotType = "NORMAL";

    if (gameState.options.specialSlots) {
      if (gameState.goldenSlots.includes(matched.rank)) {
        points *= 2; // Raddoppio slot dorato
        slotType = "GOLDEN";
      } else if (gameState.bombSlots.includes(matched.rank)) {
        points = -30; // Penalità bomba
        slotType = "BOMB";
      }
    }

    // Moltiplicatore Frenzy x2 se attivo negli ultimi 60s (solo se non era già una bomba)
    if (isFrenzyActive() && slotType !== "BOMB") {
      points *= 2;
    }

    // Statistica per "L'Avvoltoio": risposta nei primi 20 secondi dall'inizio
    if (
      gameState.gameStartTime &&
      Date.now() - gameState.gameStartTime <= 20000
    ) {
      if (player && player.stats) player.stats.earlyGuesses++;
    }

    const teamObj = gameState.teams.find((t) => t.id === teamId);
    if (teamObj) {
      teamObj.score = Math.max(0, teamObj.score + points);
    }

    if (player) {
      player.score = Math.max(0, (player.score || 0) + points);
    }

    gameState.revealed[matched.rank] = {
      teamId,
      teamColor: teamObj ? teamObj.color : "#6366f1",
      teamName: teamObj ? teamObj.name : "Squadra",
      playerName: playerName || "Anonimo",
      playerSocketId: socket.id,
      itemName: matched.name,
      points,
      slotType,
    };

    let resultMessage = `🎉 Preso! Posizione #${matched.rank} (+${points} pt)`;
    if (slotType === "GOLDEN")
      resultMessage = `✨ SLOT DORATO! Posizione #${matched.rank} RADDOPPIATA (+${points} pt)!`;
    if (slotType === "BOMB")
      resultMessage = `💣 BOOM! Posizione #${matched.rank} era una BOMBA (${points} pt)!`;

    socket.emit("guessResult", {
      status: "CORRECT",
      rank: matched.rank,
      points,
      slotType,
      playerScore: player ? player.score : points,
      message: resultMessage,
    });

    io.emit("boardUpdated", {
      rank: matched.rank,
      data: gameState.revealed[matched.rank],
      teams: gameState.teams,
      playersList: Object.values(connectedPlayers),
    });

    if (gameState.mode === "TURNS") {
      passToNextTurn(`${activeTeam.name} ha svelato #${matched.rank}!`);
    }
  });

  socket.on("disconnect", () => {
    delete connectedPlayers[socket.id];
    io.emit("playersListUpdated", Object.values(connectedPlayers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
