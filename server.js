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

// Carica tutti i file .json presenti nella cartella data/
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
        console.error(`Errore nel caricamento del file ${file}:`, e);
      }
    });
  } catch (err) {
    console.error("Errore lettura directory data:", err);
  }
  return categories;
}

let availableCategories = loadAllCategories();
let currentCategoryKey = Object.keys(availableCategories)[0] || null;

let connectedPlayers = {}; // socketId -> { name, teamId, socketId }

let gameState = {
  status: "LOBBY",
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
  timer: {
    duration: 300,
    remaining: 300,
    isRunning: false,
  },
};

let timerInterval = null;

function startTimer() {
  if (timerInterval || gameState.timer.remaining <= 0) return;
  gameState.timer.isRunning = true;
  io.emit("timerTick", gameState.timer);

  timerInterval = setInterval(() => {
    if (gameState.timer.remaining > 0) {
      gameState.timer.remaining--;
      io.emit("timerTick", gameState.timer);
    } else {
      pauseTimer();
      io.emit("timerExpired");
    }
  }, 1000);
}

function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.timer.isRunning = false;
  io.emit("timerTick", gameState.timer);
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
  });

  socket.on("joinGame", (name) => {
    const cleanName = (name || "").trim() || `Ospite_${socket.id.slice(0, 4)}`;
    connectedPlayers[socket.id] = {
      socketId: socket.id,
      name: cleanName,
      teamId: null,
    };
    io.emit("playersListUpdated", Object.values(connectedPlayers));
    socket.emit("joinedSuccess", connectedPlayers[socket.id]);
  });

  // NUOVO: Salvataggio e creazione categoria direttamente dall'interfaccia
  socket.on("createCategory", (newCategoryData) => {
    try {
      const { title, items } = newCategoryData;
      if (!title || !items || items.length === 0) {
        socket.emit("categoryCreatedResult", {
          success: false,
          message: "Dati categoria non validi!",
        });
        return;
      }

      // Genera ID sicuro per il file (es: "I Migliori Film" -> "i-migliori-film")
      const fileId =
        title
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "") || `cat-${Date.now()}`;

      const payload = {
        id: fileId,
        categoryTitle: title,
        items: items.map((it, idx) => ({
          rank: it.rank || idx + 1,
          name: it.name.trim(),
          aliases: it.aliases || [],
        })),
      };

      const targetPath = path.join(DATA_DIR, `${fileId}.json`);
      fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8");

      // Ricarica la memoria del server
      availableCategories = loadAllCategories();
      const updatedList = getCategoriesList();

      socket.emit("categoryCreatedResult", {
        success: true,
        createdId: fileId,
      });
      io.emit("categoriesUpdated", updatedList);
    } catch (err) {
      console.error("Errore salvataggio categoria:", err);
      socket.emit("categoryCreatedResult", {
        success: false,
        message: "Errore interno nel salvataggio su file!",
      });
    }
  });

  socket.on("startGameWithConfig", (config) => {
    const { categoryKey, teams, duration } = config;

    availableCategories = loadAllCategories();
    if (availableCategories[categoryKey]) {
      currentCategoryKey = categoryKey;
      gameState.currentCategoryKey = categoryKey;
      gameState.categoryTitle = availableCategories[categoryKey].categoryTitle;
    }

    const initialTeams = teams.map((t) => ({ ...t, score: 0, members: [] }));
    const playersArray = Object.values(connectedPlayers);
    gameState.teams = distributePlayersRandomly(playersArray, initialTeams);

    gameState.revealed = {};
    gameState.status = "PLAYING";
    pauseTimer();

    const sec = parseInt(duration, 10) || 300;
    gameState.timer.duration = sec;
    gameState.timer.remaining = sec;

    playersArray.forEach((p) => {
      const assignedTeam = gameState.teams.find((t) => t.id === p.teamId);
      io.to(p.socketId).emit("assignedTeam", {
        team: assignedTeam,
        gameState,
      });
    });

    io.emit("gameState", {
      ...gameState,
      categoriesList: getCategoriesList(),
      playersList: Object.values(connectedPlayers),
    });

    startTimer();
  });

  socket.on("timerControl", (action) => {
    if (action.type === "START") startTimer();
    else if (action.type === "PAUSE") pauseTimer();
    else if (action.type === "RESET") {
      pauseTimer();
      gameState.timer.remaining = gameState.timer.duration;
      io.emit("timerTick", gameState.timer);
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
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza!",
      });
      return;
    }

    if (gameState.revealed[matched.rank]) {
      const orig = gameState.revealed[matched.rank];
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        message: `⚠️ #${matched.rank} già presa da ${orig.teamName} (${orig.playerName})! 0 pt.`,
      });
      return;
    }

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
