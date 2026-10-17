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
        console.error(`Errore caricamento \${file}:`, e);
      }
    });
  } catch (err) {
    console.error("Errore lettura directory data:", err);
  }
  return categories;
}

let availableCategories = loadAllCategories();
let currentCategoryKey = Object.keys(availableCategories)[0] || null;
let connectedPlayers = {};

let gameState = {
  status: "LOBBY",
  mode: "RUSH", // 'RUSH' (gara simultanea) o 'TURNS' (a turni)
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
  activeTeamIndex: 0, // indice squadra di turno
  turnTimer: {
    duration: 30, // secondi per ogni singolo turno
    remaining: 30,
  },
  timer: {
    duration: 300,
    remaining: 300,
    isRunning: false,
  },
};

let mainTimerInterval = null;

function startTimer() {
  if (mainTimerInterval || gameState.timer.remaining <= 0) return;
  gameState.timer.isRunning = true;
  io.emit("timerTick", {
    global: gameState.timer,
    turn: gameState.turnTimer,
    activeTeamId: getActiveTeam().id,
  });

  mainTimerInterval = setInterval(() => {
    let tickGlobal = false;
    let tickTurn = false;

    // Timer Globale
    if (gameState.timer.remaining > 0) {
      gameState.timer.remaining--;
      tickGlobal = true;
    } else {
      pauseTimer();
      io.emit("timerExpired");
      return;
    }

    // Timer di Turno (se in modalità a turni)
    if (gameState.mode === "TURNS") {
      if (gameState.turnTimer.remaining > 0) {
        gameState.turnTimer.remaining--;
      } else {
        // Tempo turno scaduto: passa alla squadra successiva
        passToNextTurn("Tempo scaduto!");
      }
      tickTurn = true;
    }

    if (tickGlobal || tickTurn) {
      io.emit("timerTick", {
        global: gameState.timer,
        turn: gameState.turnTimer,
        activeTeamId: getActiveTeam().id,
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
  });
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
    targetTeam.members.push(p.name);
    p.teamId = targetTeam.id;
  });
  return teams;
}

io.on("connection", (socket) => {
  socket.emit("initSync", {
    gameState,
    categoriesList: getCategoriesList(),
    playersList: Object.values(connectedPlayers),
    myPlayerInfo: connectedPlayers[socket.id] || null,
    activeTeam: getActiveTeam(),
  });

  socket.on("joinGame", (name) => {
    const cleanName = (name || "").trim() || `Ospite_\${socket.id.slice(0, 4)}`;
    connectedPlayers[socket.id] = {
      socketId: socket.id,
      name: cleanName,
      teamId: null,
    };
    io.emit("playersListUpdated", Object.values(connectedPlayers));
    socket.emit("joinedSuccess", connectedPlayers[socket.id]);
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
        `cat-\${Date.now()}`;

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

      const targetPath = path.join(DATA_DIR, `\${fileId}.json`);
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

  socket.on("startGameWithConfig", (config) => {
    const { categoryKey, teams, duration, mode, turnDuration } = config;
    availableCategories = loadAllCategories();

    if (availableCategories[categoryKey]) {
      currentCategoryKey = categoryKey;
      gameState.currentCategoryKey = categoryKey;
      gameState.categoryTitle = availableCategories[categoryKey].categoryTitle;
    }

    gameState.mode = mode || "RUSH";
    const initialTeams = teams.map((t) => ({ ...t, score: 0, members: [] }));
    const playersArray = Object.values(connectedPlayers);
    gameState.teams = distributePlayersRandomly(playersArray, initialTeams);

    gameState.revealed = {};
    gameState.status = "PLAYING";
    gameState.activeTeamIndex = 0;

    const turnSec = parseInt(turnDuration, 10) || 30;
    gameState.turnTimer.duration = turnSec;
    gameState.turnTimer.remaining = turnSec;

    pauseTimer();
    const sec = parseInt(duration, 10) || 300;
    gameState.timer.duration = sec;
    gameState.timer.remaining = sec;

    playersArray.forEach((p) => {
      const assignedTeam = gameState.teams.find((t) => t.id === p.teamId);
      io.to(p.socketId).emit("assignedTeam", {
        team: assignedTeam,
        gameState,
        activeTeam: getActiveTeam(),
      });
    });

    io.emit("gameState", {
      ...gameState,
      categoriesList: getCategoriesList(),
      playersList: Object.values(connectedPlayers),
      activeTeam: getActiveTeam(),
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
      });
    } else if (action.type === "SKIP_TURN") {
      if (gameState.mode === "TURNS") passToNextTurn("Turno saltato dall'Host");
    }
  });

  // Ricezione tentativo da Smartphone
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

    // REGOLA DEI TURNI: se è a turni e non tocca alla squadra del giocatore, blocca l'invio
    if (gameState.mode === "TURNS" && teamId !== activeTeam.id) {
      socket.emit("guessResult", {
        status: "LOCKED",
        message: `⛔ Non è il tuo turno! Tocca a: \${activeTeam.name}`,
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

    // Risposta Errata
    if (!matched) {
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza!",
      });
      // Se in modalità a turni, lo sbaglio fa passare il turno
      if (gameState.mode === "TURNS") {
        passToNextTurn(`\${activeTeam.name} ha sbagliato risposta!`);
      }
      return;
    }

    // Risposta già presa
    if (gameState.revealed[matched.rank]) {
      const orig = gameState.revealed[matched.rank];
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        message: `⚠️ #\${matched.rank} già presa da \${orig.teamName}! 0 pt.`,
      });
      if (gameState.mode === "TURNS") {
        passToNextTurn(`Posizione già presa! Turno passato.`);
      }
      return;
    }

    // Risposta Corretta
    const points = matched.rank;
    const teamObj = gameState.teams.find((t) => t.id === teamId);
    if (teamObj) teamObj.score += points;

    gameState.revealed[matched.rank] = {
      teamId,
      teamColor: teamObj ? teamObj.color : "#6366f1",
      teamName: teamObj ? teamObj.name : "Squadra",
      playerName: playerName || "Anonimo",
      itemName: matched.name,
      points,
    };

    socket.emit("guessResult", {
      status: "CORRECT",
      rank: matched.rank,
      points,
      message: `🎉 Preso! Posizione #${matched.rank} (+${points} pt)`,
    });

    io.emit("boardUpdated", {
      rank: matched.rank,
      data: gameState.revealed[matched.rank],
      teams: gameState.teams,
    });

    // In modalità a turni, dopo aver indovinato il turno passa alla squadra successiva
    if (gameState.mode === "TURNS") {
      passToNextTurn(`\${activeTeam.name} ha indovinato #\${matched.rank}!`);
    }
  });

  socket.on("disconnect", () => {
    delete connectedPlayers[socket.id];
    io.emit("playersListUpdated", Object.values(connectedPlayers));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta \${PORT}`);
});
