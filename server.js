const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

// Funzione di caricamento dati dal file esterno JSON
const DATA_FILE_PATH = path.join(__dirname, "data", "top100.json");

function loadTop100Data() {
  try {
    const raw = fs.readFileSync(DATA_FILE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Errore nel caricamento di top100.json:", err);
    return { categoryTitle: "Top 100", items: [] };
  }
}

let currentData = loadTop100Data();

// Stato di gioco
let gameState = {
  teams: [
    { id: "t1", name: "Squadra Rossa", color: "#ef4444", icon: "🔥", score: 0 },
    { id: "t2", name: "Squadra Blu", color: "#3b82f6", icon: "⚡", score: 0 },
  ],
  revealed: {}, // rank -> { teamId, playerName, itemName, points }
  timer: {
    duration: 300, // secondi iniziali (default 5 min)
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

io.on("connection", (socket) => {
  // Invia lo stato globale con la categoria del file esterno
  socket.emit("gameState", {
    ...gameState,
    categoryTitle: currentData.categoryTitle,
    totalItems: currentData.items.length,
  });

  // Setup squadre
  socket.on("setupTeams", (teamsData) => {
    gameState.teams = teamsData.map((t) => ({ ...t, score: 0 }));
    gameState.revealed = {};
    pauseTimer();
    gameState.timer.remaining = gameState.timer.duration;
    io.emit("gameState", {
      ...gameState,
      categoryTitle: currentData.categoryTitle,
      totalItems: currentData.items.length,
    });
  });

  // Controlli Timer dall'Host
  socket.on("timerControl", (action) => {
    if (action.type === "START") {
      startTimer();
    } else if (action.type === "PAUSE") {
      pauseTimer();
    } else if (action.type === "RESET") {
      pauseTimer();
      gameState.timer.remaining = gameState.timer.duration;
      io.emit("timerTick", gameState.timer);
    } else if (action.type === "SET_DURATION") {
      const seconds = parseInt(action.seconds, 10);
      if (!isNaN(seconds) && seconds > 0) {
        gameState.timer.duration = seconds;
        gameState.timer.remaining = seconds;
        pauseTimer();
        io.emit("timerTick", gameState.timer);
      }
    }
  });

  // Ricezione tentativo da Smartphone
  socket.on("submitGuess", (payload) => {
    // Se il timer è scaduto o in pausa, blocca i tentativi
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
        message: "⏸️ Il timer è in pausa! Aspetta il via.",
      });
      return;
    }

    const { teamId, playerName, guess } = payload;
    const cleanGuess = normalizeText(guess || "");
    if (!cleanGuess) return;

    // Match con il file JSON esterno
    const matched = currentData.items.find((item) => {
      const matchName = normalizeText(item.name) === cleanGuess;
      const matchAlias =
        item.aliases &&
        item.aliases.some((a) => normalizeText(a) === cleanGuess);
      return matchName || matchAlias;
    });

    if (!matched) {
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza nella Top 100!",
      });
      return;
    }

    // First-come First-served
    if (gameState.revealed[matched.rank]) {
      const orig = gameState.revealed[matched.rank];
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        message: `⚠️ #${matched.rank} già presa da ${orig.teamName} (${orig.playerName})! 0 pt.`,
      });
      return;
    }

    // Assegnazione punti = rank
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

  // Ricarica del file JSON senza riavviare Render (opzionale per l'host)
  socket.on("reloadDataset", () => {
    currentData = loadTop100Data();
    gameState.revealed = {};
    io.emit("gameState", {
      ...gameState,
      categoryTitle: currentData.categoryTitle,
      totalItems: currentData.items.length,
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
