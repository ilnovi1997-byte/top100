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

const PRESET_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#a855f7",
];
const PRESET_ICONS = [
  "🦁",
  "⚡",
  "🦅",
  "🔥",
  "🚀",
  "👑",
  "🦈",
  "💎",
  "🎯",
  "🐺",
];

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

let connectedPlayers = {}; // playerId -> { playerId, socketId, name, teamId, color, icon, score, isOnline, stats }
let socketToPlayerId = {}; // socket.id -> playerId

let gameState = {
  status: "LOBBY",
  format: "TEAMS", // 'TEAMS' oppure 'SOLO'
  mode: "RUSH", // 'RUSH' oppure 'TURNS'
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
  typoTolerance: 0.2, // Default 20% di tolleranza errori di digitazione
  activeEntityIndex: 0,
  turnTimer: { duration: 30, remaining: 30 },
  timer: { duration: 300, remaining: 300, isRunning: false },
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
    activeEntity: getActiveTurnEntity(),
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
        activeEntity: getActiveTurnEntity(),
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
    activeEntity: getActiveTurnEntity(),
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

function getActiveTurnEntity() {
  if (gameState.format === "SOLO") {
    const players = Object.values(connectedPlayers);
    if (players.length === 0) return { id: null, name: "Nessuno" };
    const p = players[gameState.activeEntityIndex % players.length];
    return {
      id: p.playerId,
      name: p.name,
      color: p.color,
      icon: p.icon,
      isPlayer: true,
    };
  } else {
    if (!gameState.teams || gameState.teams.length === 0)
      return { id: null, name: "Nessuna Squadra" };
    const t =
      gameState.teams[gameState.activeEntityIndex % gameState.teams.length];
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      icon: t.icon,
      isPlayer: false,
    };
  }
}

function passToNextTurn(reasonMessage = null) {
  const total =
    gameState.format === "SOLO"
      ? Object.keys(connectedPlayers).length
      : gameState.teams.length;
  if (total > 0) {
    gameState.activeEntityIndex = (gameState.activeEntityIndex + 1) % total;
  }
  gameState.turnTimer.remaining = gameState.turnTimer.duration;

  io.emit("turnChanged", {
    activeEntity: getActiveTurnEntity(),
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

// Distanza di Levenshtein per tolleranza errori di digitazione
function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

// Controlla se la risposta rientra nella percentuale di errore impostata dall'Host
function isFuzzyMatch(guessNorm, targetRaw, toleranceRatio) {
  const targetNorm = normalizeText(targetRaw);
  if (!targetNorm || !guessNorm) return false;
  if (guessNorm === targetNorm) return true;

  // Se la tolleranza è 0% o la parola è troppo corta (<= 3 lettere), serve il match esatto
  if (!toleranceRatio || toleranceRatio <= 0 || targetNorm.length <= 3)
    return false;

  const maxErrors = Math.min(3, Math.floor(targetNorm.length * toleranceRatio));
  if (maxErrors <= 0) return false;

  if (Math.abs(guessNorm.length - targetNorm.length) > maxErrors) return false;

  return getLevenshteinDistance(guessNorm, targetNorm) <= maxErrors;
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
    targetTeam.members.push({ playerId: p.playerId, name: p.name });
    p.teamId = targetTeam.id;
  });
  return teams;
}

function calculateAwards() {
  const players = Object.values(connectedPlayers);
  if (players.length === 0) return [];
  const awards = [];

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
      desc: `Posizione più remota: #${bestSniper.rank} (${bestSniper.title})`,
      winner: bestSniper.name,
    });
  }

  const vulture = [...players].sort(
    (a, b) => (b.stats?.earlyGuesses || 0) - (a.stats?.earlyGuesses || 0),
  )[0];
  if (vulture && (vulture.stats?.earlyGuesses || 0) > 0) {
    awards.push({
      title: "🦅 L'Avvoltoio",
      desc: `Più veloce nei primi 20s (${vulture.stats.earlyGuesses} prese)`,
      winner: vulture.name,
    });
  }

  const spammer = [...players].sort(
    (a, b) => (b.stats?.wrongGuesses || 0) - (a.stats?.wrongGuesses || 0),
  )[0];
  if (spammer && (spammer.stats?.wrongGuesses || 0) > 0) {
    awards.push({
      title: "🤡 Raffica a Vuoto",
      desc: `Record tentativi errati (${spammer.stats.wrongGuesses} errori)`,
      winner: spammer.name,
    });
  }

  const eternalSecond = [...players].sort(
    (a, b) => (b.stats?.stolenTries || 0) - (a.stats?.stolenTries || 0),
  )[0];
  if (eternalSecond && (eternalSecond.stats?.stolenTries || 0) > 0) {
    awards.push({
      title: "🐢 L'Eterno Secondo",
      desc: `Beffato più volte (${eternalSecond.stats.stolenTries} già prese)`,
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
    activeEntity: getActiveTurnEntity(),
    initialsMap: getInitialsMap(),
  });

  socket.on("reconnectPlayer", (data) => {
    const { playerId } = data;
    if (playerId && connectedPlayers[playerId]) {
      const player = connectedPlayers[playerId];
      player.socketId = socket.id;
      player.isOnline = true;
      socketToPlayerId[socket.id] = playerId;

      const assignedTeam =
        gameState.format === "TEAMS"
          ? gameState.teams.find((t) => t.id === player.teamId)
          : null;

      socket.emit("sessionRestored", {
        player,
        team: assignedTeam || null,
        gameState,
        activeEntity: getActiveTurnEntity(),
      });

      io.emit("playersListUpdated", Object.values(connectedPlayers));
    } else {
      socket.emit("sessionNotFound");
    }
  });

  socket.on("joinGame", (payload) => {
    const { playerId, name } = payload;
    const effectivePlayerId =
      playerId ||
      `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const cleanName =
      (name || "").trim() || `Ospite_${effectivePlayerId.slice(-4)}`;

    const playerIndex = Object.keys(connectedPlayers).length;
    const assignedColor = PRESET_COLORS[playerIndex % PRESET_COLORS.length];
    const assignedIcon = PRESET_ICONS[playerIndex % PRESET_ICONS.length];

    connectedPlayers[effectivePlayerId] = {
      playerId: effectivePlayerId,
      socketId: socket.id,
      name: cleanName,
      teamId: null,
      color: assignedColor,
      icon: assignedIcon,
      score: 0,
      isOnline: true,
      stats: { wrongGuesses: 0, stolenTries: 0, earlyGuesses: 0 },
    };
    socketToPlayerId[socket.id] = effectivePlayerId;

    io.emit("playersListUpdated", Object.values(connectedPlayers));
    socket.emit("joinedSuccess", connectedPlayers[effectivePlayerId]);
  });

  socket.on("assignPlayerToTeam", ({ playerId, teamId }) => {
    if (connectedPlayers[playerId]) {
      connectedPlayers[playerId].teamId = teamId || null;
      const targetTeam = gameState.teams.find((t) => t.id === teamId);

      const pSocketId = connectedPlayers[playerId].socketId;
      if (pSocketId) {
        io.to(pSocketId).emit("teamAssignmentChanged", targetTeam || null);
      }
      io.emit("playersListUpdated", Object.values(connectedPlayers));
    }
  });

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
          .replace(/^-|-\$/g, "") ||
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
      format,
      teams,
      duration,
      mode,
      turnDuration,
      shuffleTeams,
      options,
      typoTolerance,
    } = config;
    availableCategories = loadAllCategories();

    if (availableCategories[categoryKey]) {
      currentCategoryKey = categoryKey;
      gameState.currentCategoryKey = categoryKey;
      gameState.categoryTitle = availableCategories[categoryKey].categoryTitle;
    }

    gameState.format = format || "TEAMS";
    gameState.mode = mode || "RUSH";
    gameState.typoTolerance =
      typeof typoTolerance === "number" ? typoTolerance : 0.2;
    gameState.options = { ...gameState.options, ...(options || {}) };

    const playersArray = Object.values(connectedPlayers);
    playersArray.forEach((p, idx) => {
      p.score = 0;
      p.color = PRESET_COLORS[idx % PRESET_COLORS.length];
      p.icon = PRESET_ICONS[idx % PRESET_ICONS.length];
      p.stats = { wrongGuesses: 0, stolenTries: 0, earlyGuesses: 0 };
    });

    if (gameState.format === "TEAMS") {
      let finalTeams = teams.map((t) => ({ ...t, score: 0, members: [] }));
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
          team.members.push({ playerId: p.playerId, name: p.name });
        });
      }
      gameState.teams = finalTeams;
    } else {
      playersArray.forEach((p) => (p.teamId = null));
      gameState.teams = [];
    }

    gameState.revealed = {};
    gameState.showInitials = false;
    gameState.status = "PLAYING";
    gameState.activeEntityIndex = 0;
    gameState.gameStartTime = Date.now();

    if (gameState.options.specialSlots) {
      const ranksPool = Array.from({ length: 100 }, (_, i) => i + 1).sort(
        () => Math.random() - 0.5,
      );
      gameState.goldenSlots = [ranksPool[0], ranksPool[1]];
      gameState.bombSlots = [ranksPool[2]];
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
      const assignedTeam =
        gameState.format === "TEAMS"
          ? gameState.teams.find((t) => t.id === p.teamId)
          : null;
      if (p.socketId) {
        io.to(p.socketId).emit("assignedTeam", {
          team: assignedTeam,
          gameState,
          activeEntity: getActiveTurnEntity(),
          playerScore: p.score,
        });
      }
    });

    io.emit("gameState", {
      ...gameState,
      categoriesList: getCategoriesList(),
      playersList: Object.values(connectedPlayers),
      activeEntity: getActiveTurnEntity(),
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
        activeEntity: getActiveTurnEntity(),
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

    const playerId = socketToPlayerId[socket.id] || payload.playerId;
    const player = connectedPlayers[playerId];
    const playerName = player ? player.name : payload.playerName || "Anonimo";
    const activeEntity = getActiveTurnEntity();

    if (gameState.mode === "TURNS") {
      if (gameState.format === "SOLO" && playerId !== activeEntity.id) {
        socket.emit("guessResult", {
          status: "LOCKED",
          message: `⛔ Non è il tuo turno! Tocca a: ${activeEntity.name}`,
        });
        return;
      } else if (
        gameState.format === "TEAMS" &&
        player?.teamId !== activeEntity.id
      ) {
        socket.emit("guessResult", {
          status: "LOCKED",
          message: `⛔ Non è il turno della tua squadra! Tocca a: ${activeEntity.name}`,
        });
        return;
      }
    }

    const cleanGuess = normalizeText(payload.guess || "");
    if (
      !cleanGuess ||
      !currentCategoryKey ||
      !availableCategories[currentCategoryKey]
    )
      return;

    const currentItems = availableCategories[currentCategoryKey].items;

    // 1. Ricerca prima il Match Esatto (priorità assoluta)
    let matched = currentItems.find((item) => {
      const matchName = normalizeText(item.name) === cleanGuess;
      const matchAlias =
        item.aliases &&
        item.aliases.some((a) => normalizeText(a) === cleanGuess);
      return matchName || matchAlias;
    });

    // 2. Se non c'è match esatto, applica la tolleranza errori di digitazione (Fuzzy Match)
    if (!matched && gameState.typoTolerance > 0) {
      matched = currentItems.find((item) => {
        const fuzzyName = isFuzzyMatch(
          cleanGuess,
          item.name,
          gameState.typoTolerance,
        );
        const fuzzyAlias =
          item.aliases &&
          item.aliases.some((a) =>
            isFuzzyMatch(cleanGuess, a, gameState.typoTolerance),
          );
        return fuzzyName || fuzzyAlias;
      });
    }

    if (!matched) {
      if (player && player.stats) player.stats.wrongGuesses++;
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza!",
      });
      if (gameState.mode === "TURNS")
        passToNextTurn(`${activeEntity.name} ha sbagliato!`);
      return;
    }

    if (gameState.revealed[matched.rank]) {
      if (player && player.stats) player.stats.stolenTries++;
      const orig = gameState.revealed[matched.rank];
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        message: `⚠️ #${matched.rank} già presa da ${orig.playerName}! 0 pt.`,
      });
      if (gameState.mode === "TURNS") passToNextTurn(`Posizione già presa!`);
      return;
    }

    let points = matched.rank;
    let slotType = "NORMAL";

    if (gameState.options.specialSlots) {
      if (gameState.goldenSlots.includes(matched.rank)) {
        points *= 2;
        slotType = "GOLDEN";
      } else if (gameState.bombSlots.includes(matched.rank)) {
        points = -30;
        slotType = "BOMB";
      }
    }

    if (isFrenzyActive() && slotType !== "BOMB") {
      points *= 2;
    }

    if (
      gameState.gameStartTime &&
      Date.now() - gameState.gameStartTime <= 20000
    ) {
      if (player && player.stats) player.stats.earlyGuesses++;
    }

    let teamColor = player?.color || "#6366f1";
    let teamName = "";

    if (gameState.format === "TEAMS" && player?.teamId) {
      const teamObj = gameState.teams.find((t) => t.id === player.teamId);
      if (teamObj) {
        teamObj.score = Math.max(0, teamObj.score + points);
        teamColor = teamObj.color;
        teamName = teamObj.name;
      }
    }

    if (player) {
      player.score = Math.max(0, (player.score || 0) + points);
    }

    gameState.revealed[matched.rank] = {
      teamId: player?.teamId || null,
      teamColor: teamColor,
      teamName: teamName,
      playerName: playerName,
      playerId: playerId,
      itemName: matched.name,
      points,
      slotType,
    };

    let resultMessage = `🎉 Preso! #${matched.rank} ${matched.name} (+${points} pt)`;
    if (slotType === "GOLDEN")
      resultMessage = `✨ SLOT DORATO! #${matched.rank} ${matched.name} RADDOPPIATA (+${points} pt)!`;
    if (slotType === "BOMB")
      resultMessage = `💣 BOOM! #${matched.rank} ${matched.name} era una BOMBA (${points} pt)!`;

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
      passToNextTurn(`${activeEntity.name} ha svelato #${matched.rank}!`);
    }
  });

  socket.on("disconnect", () => {
    const pId = socketToPlayerId[socket.id];
    if (pId && connectedPlayers[pId]) {
      connectedPlayers[pId].isOnline = false;
      delete socketToPlayerId[socket.id];
      io.emit("playersListUpdated", Object.values(connectedPlayers));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
