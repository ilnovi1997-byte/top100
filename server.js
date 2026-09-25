const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const GAME_DATA = require("./gameData.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Stato globale con controllo granulare dei reveal
let gameState = {
  currentRound: 0,
  currentSubmission: 0,
  revealed: {
    ans1: false,
    ans2: false,
    ans3: false,
    meme: false,
    author: false,
  },
  isBuzzerActive: true,
  buzzerQueue: [],
  players: {},
};

io.on("connection", (socket) => {
  socket.emit("init_game", {
    gameData: GAME_DATA,
    state: gameState,
  });

  socket.on("join_game", (playerName) => {
    gameState.players[socket.id] = { name: playerName, score: 0 };
    io.emit("update_players", Object.values(gameState.players));
    socket.emit("joined_successfully", { name: playerName });
  });

  // Cambio scheda: resetta tutti i reveal a false
  socket.on("change_card", ({ roundIdx, subIdx }) => {
    gameState.currentRound = roundIdx;
    gameState.currentSubmission = subIdx;
    gameState.revealed = {
      ans1: false,
      ans2: false,
      ans3: false,
      meme: false,
      author: false,
    };
    gameState.isBuzzerActive = true;
    gameState.buzzerQueue = [];

    io.emit("card_updated", gameState);
  });

  // Toggle reveal per singolo elemento (ans1, ans2, ans3, meme, author)
  socket.on("toggle_reveal", (targetKey) => {
    if (gameState.revealed.hasOwnProperty(targetKey)) {
      gameState.revealed[targetKey] = !gameState.revealed[targetKey];
      io.emit("reveal_updated", gameState.revealed);
    }
  });

  // Rivela tutte le risposte Top 3 insieme
  socket.on("reveal_all_top3", () => {
    gameState.revealed.ans1 = true;
    gameState.revealed.ans2 = true;
    gameState.revealed.ans3 = true;
    io.emit("reveal_updated", gameState.revealed);
  });

  // Buzzer
  socket.on("press_buzzer", () => {
    if (!gameState.isBuzzerActive || !gameState.players[socket.id]) return;

    const alreadyInQueue = gameState.buzzerQueue.some(
      (item) => item.socketId === socket.id,
    );
    if (!alreadyInQueue) {
      gameState.buzzerQueue.push({
        name: gameState.players[socket.id].name,
        socketId: socket.id,
        time: Date.now(),
      });

      io.emit("buzzer_queue_updated", {
        queue: gameState.buzzerQueue,
        firstPlayer: gameState.buzzerQueue[0].name,
      });
    }
  });

  socket.on("pass_buzzer_turn", () => {
    if (gameState.buzzerQueue.length > 0) {
      gameState.buzzerQueue.shift();
      io.emit("buzzer_queue_updated", {
        queue: gameState.buzzerQueue,
        firstPlayer:
          gameState.buzzerQueue.length > 0
            ? gameState.buzzerQueue[0].name
            : null,
      });
    }
  });

  socket.on("reset_buzzer", () => {
    gameState.isBuzzerActive = true;
    gameState.buzzerQueue = [];
    io.emit("buzzer_reset");
  });

  socket.on("update_score", ({ playerName, delta }) => {
    for (let id in gameState.players) {
      if (gameState.players[id].name === playerName) {
        gameState.players[id].score = Math.max(
          0,
          gameState.players[id].score + delta,
        );
      }
    }
    io.emit("update_players", Object.values(gameState.players));
  });

  socket.on("disconnect", () => {
    delete gameState.players[socket.id];
    gameState.buzzerQueue = gameState.buzzerQueue.filter(
      (item) => item.socketId !== socket.id,
    );
    io.emit("update_players", Object.values(gameState.players));
    io.emit("buzzer_queue_updated", {
      queue: gameState.buzzerQueue,
      firstPlayer:
        gameState.buzzerQueue.length > 0 ? gameState.buzzerQueue[0].name : null,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server attivo su http://localhost:${PORT}`);
});
