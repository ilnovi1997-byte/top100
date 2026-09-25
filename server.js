const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// Database predefinito categorie (100 elementi)
const CATEGORIES = {
  movies: {
    title: "Top 100 Film con Maggior Incasso Mondiale",
    items: [
      { rank: 1, name: "Avatar", aliases: ["avatar"] },
      {
        rank: 2,
        name: "Avengers: Endgame",
        aliases: ["endgame", "avengers 4"],
      },
      {
        rank: 3,
        name: "Avatar: La via dell'acqua",
        aliases: ["avatar 2", "the way of water"],
      },
      { rank: 4, name: "Titanic", aliases: ["titanic"] },
      {
        rank: 5,
        name: "Star Wars: Il risveglio della Forza",
        aliases: ["star wars 7", "force awakens"],
      },
      {
        rank: 6,
        name: "Avengers: Infinity War",
        aliases: ["infinity war", "avengers 3"],
      },
      {
        rank: 7,
        name: "Spider-Man: No Way Home",
        aliases: ["no way home", "spiderman"],
      },
      { rank: 8, name: "Jurassic World", aliases: ["jurassic park 4"] },
      { rank: 9, name: "Il re leone", aliases: ["the lion king", "lion king"] },
      { rank: 10, name: "The Avengers", aliases: ["avengers", "vendicatori"] },
      { rank: 11, name: "Fast & Furious 7", aliases: ["fast 7", "furious 7"] },
      {
        rank: 12,
        name: "Top Gun: Maverick",
        aliases: ["maverick", "top gun 2"],
      },
      { rank: 13, name: "Frozen II", aliases: ["frozen 2"] },
      { rank: 14, name: "Barbie", aliases: ["barbie"] },
      {
        rank: 15,
        name: "Avengers: Age of Ultron",
        aliases: ["age of ultron", "avengers 2"],
      },
      {
        rank: 16,
        name: "Super Mario Bros.",
        aliases: ["mario", "super mario"],
      },
      { rank: 17, name: "Black Panther", aliases: ["pantera nera"] },
      {
        rank: 18,
        name: "Harry Potter e i Doni della Morte - Parte 2",
        aliases: ["harry potter 8", "doni della morte"],
      },
      {
        rank: 19,
        name: "Star Wars: Gli ultimi Jedi",
        aliases: ["last jedi", "star wars 8"],
      },
      {
        rank: 20,
        name: "Jurassic World: Il regno distrutto",
        aliases: ["fallen kingdom", "jurassic park 5"],
      },
      { rank: 21, name: "Frozen", aliases: ["il regno di ghiaccio"] },
      {
        rank: 22,
        name: "La bella e la bestia",
        aliases: ["beauty and the beast"],
      },
      { rank: 23, name: "Incredibili 2", aliases: ["incredibles 2"] },
      {
        rank: 24,
        name: "Fast & Furious 8",
        aliases: ["fast 8", "the fate of the furious"],
      },
      { rank: 25, name: "Iron Man 3", aliases: ["ironman 3"] },
      { rank: 26, name: "Minions", aliases: ["i minions"] },
      { rank: 27, name: "Captain America: Civil War", aliases: ["civil war"] },
      { rank: 28, name: "Aquaman", aliases: ["aquaman"] },
      {
        rank: 29,
        name: "Il signore degli anelli: Il ritorno del re",
        aliases: ["ritorno del re", "lord of the rings 3"],
      },
      {
        rank: 30,
        name: "Spider-Man: Far From Home",
        aliases: ["far from home"],
      },
      { rank: 31, name: "Captain Marvel", aliases: ["capitan marvel"] },
      { rank: 32, name: "Transformers 3", aliases: ["dark of the moon"] },
      {
        rank: 33,
        name: "Skyfall",
        aliases: ["007 skyfall", "james bond skyfall"],
      },
      {
        rank: 34,
        name: "Transformers 4: L'era dell'estinzione",
        aliases: ["age of extinction"],
      },
      {
        rank: 35,
        name: "Il cavaliere oscuro - Il ritorno",
        aliases: ["dark knight rises", "batman 3"],
      },
      { rank: 36, name: "Joker", aliases: ["joker"] },
      {
        rank: 37,
        name: "Star Wars: L'ascesa di Skywalker",
        aliases: ["rise of skywalker", "star wars 9"],
      },
      { rank: 38, name: "Toy Story 4", aliases: ["toy story 4"] },
      { rank: 39, name: "Toy Story 3", aliases: ["toy story 3"] },
      {
        rank: 40,
        name: "Pirati dei Caraibi: La maledizione del forziere fantasma",
        aliases: ["dead mans chest", "pirati dei caraibi 2"],
      },
      {
        rank: 41,
        name: "Rogue One: A Star Wars Story",
        aliases: ["rogue one"],
      },
      { rank: 42, name: "Aladdin", aliases: ["aladin", "aladdino"] },
      {
        rank: 43,
        name: "Pirati dei Caraibi: Oltre i confini del mare",
        aliases: ["on stranger tides", "pirati dei caraibi 4"],
      },
      {
        rank: 44,
        name: "Alla ricerca di Dory",
        aliases: ["finding dory", "dory"],
      },
      { rank: 45, name: "Zootropolis", aliases: ["zootopia"] },
      {
        rank: 46,
        name: "Alice in Wonderland",
        aliases: ["alice nel paese delle meraviglie"],
      },
      {
        rank: 47,
        name: "Harry Potter e la pietra filosofale",
        aliases: ["harry potter 1"],
      },
      {
        rank: 48,
        name: "Lo Hobbit: Un viaggio inaspettato",
        aliases: ["the hobbit 1", "hobbit 1"],
      },
      {
        rank: 49,
        name: "Il cavaliere oscuro",
        aliases: ["the dark knight", "batman 2"],
      },
      { rank: 50, name: "Jurassic Park", aliases: ["jurassic park 1"] },
      { rank: 51, name: "Bohemian Rhapsody", aliases: ["queen film"] },
      {
        rank: 52,
        name: "Lo Hobbit: La desolazione di Smaug",
        aliases: ["hobbit 2"],
      },
      {
        rank: 53,
        name: "Lo Hobbit: La battaglia delle cinque armate",
        aliases: ["hobbit 3"],
      },
      { rank: 54, name: "Il re leone (1994)", aliases: ["re leone cartone"] },
      {
        rank: 55,
        name: "Harry Potter e i Doni della Morte - Parte 1",
        aliases: ["harry potter 7"],
      },
      { rank: 56, name: "Cattivissimo me 3", aliases: ["despicable me 3"] },
      {
        rank: 57,
        name: "Jumanji: Benvenuti nella giungla",
        aliases: ["jumanji 2"],
      },
      {
        rank: 58,
        name: "Pirati dei Caraibi: Ai confini del mondo",
        aliases: ["at worlds end", "pirati dei caraibi 3"],
      },
      {
        rank: 59,
        name: "Harry Potter e l'Ordine della Fenice",
        aliases: ["harry potter 5"],
      },
      {
        rank: 60,
        name: "Alla ricerca di Nemo",
        aliases: ["finding nemo", "nemo"],
      },
      {
        rank: 61,
        name: "Harry Potter e il principe mezzosangue",
        aliases: ["harry potter 6"],
      },
      { rank: 62, name: "Shrek 2", aliases: ["shrek 2"] },
      { rank: 63, name: "Bohemian Rhapsody", aliases: ["bohemian rhapsody"] },
      {
        rank: 64,
        name: "Il signore degli anelli: Le due torri",
        aliases: ["two towers", "lord of the rings 2"],
      },
      { rank: 65, name: "Spider-Man 3", aliases: ["spiderman 3"] },
      {
        rank: 66,
        name: "Harry Potter e il calice di fuoco",
        aliases: ["harry potter 4"],
      },
      {
        rank: 67,
        name: "Minions 2 - Come Gru diventa cattivissimo",
        aliases: ["minions 2"],
      },
      { rank: 68, name: "Spectre", aliases: ["007 spectre"] },
      { rank: 69, name: "Spider-Man: Homecoming", aliases: ["homecoming"] },
      {
        rank: 70,
        name: "L'era glaciale 3 - L'alba dei dinosauri",
        aliases: ["ice age 3"],
      },
      {
        rank: 71,
        name: "Harry Potter e la camera dei segreti",
        aliases: ["harry potter 2"],
      },
      {
        rank: 72,
        name: "L'era glaciale 4 - Continenti alla deriva",
        aliases: ["ice age 4"],
      },
      {
        rank: 73,
        name: "Il signore degli anelli: La compagnia dell'anello",
        aliases: ["fellowship of the ring", "lord of the rings 1"],
      },
      { rank: 74, name: "Cattivissimo me 2", aliases: ["despicable me 2"] },
      {
        rank: 75,
        name: "Batman v Superman: Dawn of Justice",
        aliases: ["batman v superman"],
      },
      {
        rank: 76,
        name: "Star Wars: Episodio III - La vendetta dei Sith",
        aliases: ["revenge of the sith", "star wars 3"],
      },
      {
        rank: 77,
        name: "Hunger Games: La ragazza di fuoco",
        aliases: ["catching fire", "hunger games 2"],
      },
      {
        rank: 78,
        name: "Guardiani della Galassia Vol. 2",
        aliases: ["guardians of the galaxy 2"],
      },
      { rank: 79, name: "Inside Out", aliases: ["inside out"] },
      { rank: 80, name: "Venom", aliases: ["venom"] },
      { rank: 81, name: "Thor: Ragnarok", aliases: ["ragnarok", "thor 3"] },
      {
        rank: 82,
        name: "Transformers: La vendetta del caduto",
        aliases: ["revenge of the fallen", "transformers 2"],
      },
      { rank: 83, name: "Inception", aliases: ["inception"] },
      { rank: 84, name: "Spider-Man", aliases: ["spiderman 1 (2002)"] },
      { rank: 85, name: "Wonder Woman", aliases: ["wonder woman"] },
      { rank: 86, name: "Fast & Furious 6", aliases: ["fast 6"] },
      { rank: 87, name: "Independence Day", aliases: ["independence day"] },
      { rank: 88, name: "Coco", aliases: ["coco"] },
      {
        rank: 89,
        name: "Pirati dei Caraibi: La vendetta di Salazar",
        aliases: ["dead men tell no tales", "pirati dei caraibi 5"],
      },
      { rank: 90, name: "Shrek terzo", aliases: ["shrek 3"] },
      {
        rank: 91,
        name: "Harry Potter e il prigioniero di Azkaban",
        aliases: ["harry potter 3"],
      },
      {
        rank: 92,
        name: "Pirati dei Caraibi: La maledizione della prima luna",
        aliases: ["pirati dei caraibi 1", "curse of the black pearl"],
      },
      { rank: 93, name: "Up", aliases: ["up"] },
      { rank: 94, name: "Deadpool 2", aliases: ["deadpool 2"] },
      { rank: 95, name: "E.T. l'extra-terrestre", aliases: ["et", "e.t."] },
      { rank: 96, name: "Fast & Furious 5", aliases: ["fast five", "fast 5"] },
      {
        rank: 97,
        name: "Madagascar 3 - Ricercati in Europa",
        aliases: ["madagascar 3"],
      },
      {
        rank: 98,
        name: "Il libro della giungla (2016)",
        aliases: ["jungle book"],
      },
      { rank: 99, name: "Interstellar", aliases: ["interstellar"] },
      { rank: 100, name: "Deadpool", aliases: ["deadpool 1"] },
    ],
  },
};

let gameState = {
  currentCategoryKey: "movies",
  teams: [
    { id: "t1", name: "Squadra Rossa", color: "#ef4444", icon: "🔥", score: 0 },
    { id: "t2", name: "Squadra Blu", color: "#3b82f6", icon: "⚡", score: 0 },
  ],
  revealed: {}, // rank -> { teamId, playerName, itemName, points }
};

function normalizeText(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

io.on("connection", (socket) => {
  // Sincronizza lo stato attuale per il nuovo dispositivo collegato
  socket.emit("gameState", {
    ...gameState,
    categoryTitle: CATEGORIES[gameState.currentCategoryKey].title,
    totalItems: CATEGORIES[gameState.currentCategoryKey].items.length,
  });

  // Riceve setup squadre dall'Host
  socket.on("setupTeams", (teamsData) => {
    gameState.teams = teamsData.map((t) => ({ ...t, score: 0 }));
    gameState.revealed = {};
    io.emit("gameState", {
      ...gameState,
      categoryTitle: CATEGORIES[gameState.currentCategoryKey].title,
      totalItems: CATEGORIES[gameState.currentCategoryKey].items.length,
    });
  });

  // Riceve un tentativo inviato da un giocatore da smartphone
  socket.on("submitGuess", (payload) => {
    const { teamId, playerName, guess } = payload;
    const cleanGuess = normalizeText(guess || "");

    if (!cleanGuess) return;

    const currentItems = CATEGORIES[gameState.currentCategoryKey].items;

    // Cerca se corrisponde a una delle 100 posizioni
    const matchedItem = currentItems.find((item) => {
      const mainMatch = normalizeText(item.name) === cleanGuess;
      const aliasMatch =
        item.aliases &&
        item.aliases.some((alias) => normalizeText(alias) === cleanGuess);
      return mainMatch || aliasMatch;
    });

    if (!matchedItem) {
      socket.emit("guessResult", {
        status: "WRONG",
        message: "Nessuna corrispondenza nella Top 100!",
      });
      return;
    }

    // Regola First-Come First-Served: è già stata indovinata?
    if (gameState.revealed[matchedItem.rank]) {
      const originalWinner = gameState.revealed[matchedItem.rank];
      const originalTeam = gameState.teams.find(
        (t) => t.id === originalWinner.teamId,
      );
      socket.emit("guessResult", {
        status: "ALREADY_CLAIMED",
        rank: matchedItem.rank,
        itemName: matchedItem.name,
        claimedByTeam: originalTeam ? originalTeam.name : "Altra squadra",
        claimedByPlayer: originalWinner.playerName,
        message: `⚠️ Già indovinata da ${originalTeam ? originalTeam.name : ""} (${originalWinner.playerName})! 0 punti assegnati.`,
      });
      return;
    }

    // Posizione valida: assegna i punti = rank
    const pointsAwarded = matchedItem.rank;
    const teamObj = gameState.teams.find((t) => t.id === teamId);
    if (teamObj) {
      teamObj.score += pointsAwarded;
    }

    gameState.revealed[matchedItem.rank] = {
      teamId,
      teamColor: teamObj ? teamObj.color : "#6366f1",
      teamName: teamObj ? teamObj.name : "",
      playerName: playerName || "Anonimo",
      itemName: matchedItem.name,
      points: pointsAwarded,
    };

    // Feedback positivo a chi ha indovinato
    socket.emit("guessResult", {
      status: "CORRECT",
      rank: matchedItem.rank,
      itemName: matchedItem.name,
      points: pointsAwarded,
      message: `🎉 Preso! Posizione #${matchedItem.rank} (+${pointsAwarded} pt)`,
    });

    // Notifica l'aggiornamento a tutti gli schermi (TV e smartphone)
    io.emit("boardUpdated", {
      rank: matchedItem.rank,
      data: gameState.revealed[matchedItem.rank],
      teams: gameState.teams,
    });
  });

  // Reset partita dall'Host
  socket.on("resetGame", () => {
    gameState.revealed = {};
    gameState.teams.forEach((t) => (t.score = 0));
    io.emit("gameState", {
      ...gameState,
      categoryTitle: CATEGORIES[gameState.currentCategoryKey].title,
      totalItems: CATEGORIES[gameState.currentCategoryKey].items.length,
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
