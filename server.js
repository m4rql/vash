/**
 * RumbleRoyale - Multiplayer Battle Royale Text Game
 *
 * Game Overview:
 * - Players connect and set usernames
 * - Admin starts the round when at least 2 players are ready
 * - System automatically selects a winner and narrates the battle
 * - Game ends with winner announcement
 *
 * Game Flow:
 * 1. Players connect and set usernames
 * 2. Admin starts the round when at least 2 players are ready
 * 3. System automatically selects a winner and narrates the battle
 * 4. Game ends with winner announcement
 *
 * Player Object Structure:
 * {
 *   id: string,        // Socket ID of the player
 *   username: string,  // Chosen display name
 *   health: number,    // Starting at 100, decreases with attacks
 *   alive: boolean,    // True if player is still in the game
 *   isReady: boolean,  // True when player has set username and is ready
 *   position: number   // Turn order position (1-11)
 * }
 *
 * Game States:
 * - WAITING_FOR_PLAYERS: Lobby phase, accepting connections
 * - READY_TO_START: 11 players connected and ready
 * - IN_PROGRESS: Active combat phase
 * - GAME_OVER: Winner declared, awaiting new round
 */

require("dotenv").config();

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { OpenAI } = require("openai");

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// Game state
const gameState = {
  players: new Map(), // Map of socket.id to player objects
  currentState: "WAITING_FOR_PLAYERS",
  winner: null,
};

// Track game timers
const gameTimers = [];

// Player statistics tracking
const playerStats = {
  hourlyUniquePlayers: new Array(24).fill().map(() => new Set()),
  lastCleanup: Date.now(),
};

// Helper function to update player statistics
function updatePlayerStats(playerId) {
  const currentHour = new Date().getHours();
  playerStats.hourlyUniquePlayers[currentHour].add(playerId);

  // Clean up old data if it's been more than an hour
  const now = Date.now();
  if (now - playerStats.lastCleanup > 3600000) {
    // 1 hour in milliseconds
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // Clear data older than 24 hours
    for (let i = 0; i < 24; i++) {
      if (i !== currentHour) {
        const hourToCheck = (currentHour - i + 24) % 24;
        if (hourToCheck > currentHour) {
          playerStats.hourlyUniquePlayers[hourToCheck].clear();
        }
      }
    }

    playerStats.lastCleanup = now;
  }

  // Broadcast updated stats to admin
  broadcastPlayerStats();
}

// Helper function to broadcast player statistics
function broadcastPlayerStats() {
  const stats = playerStats.hourlyUniquePlayers.map((set) => set.size);
  io.emit("playerStatsUpdate", { hourlyStats: stats });
}

// Helper function to get serializable players array
function getPlayersList() {
  return Array.from(gameState.players.values()).map((player) => ({
    id: player.id,
    username: player.username,
    isReady: player.isReady,
  }));
}

// Broadcast updated players list to all clients
function broadcastPlayers() {
  io.emit("updatePlayers", {
    players: getPlayersList(),
    currentState: gameState.currentState,
    winner: gameState.winner,
  });
}

// Generate narrative for game events
async function generateNarrative(event) {
  try {
    const prompt = `Generate a dramatic sentence for this battle royale event: ${event}`;
    const response = await openai.completions.create({
      model: "text-davinci-003",
      prompt,
      max_tokens: 100,
      temperature: 0.7,
      n: 1,
    });
    return response.choices[0].text.trim();
  } catch (error) {
    console.error("Error generating narrative:", error);
    return event; // Fallback to basic message
  }
}

// Select random winner and generate game narrative
async function simulateGame() {
  const players = Array.from(gameState.players.values());
  const narratives = [];

  // Generate introduction
  const intro = await generateNarrative(
    `${players.length} warriors enter the arena for an epic battle!`
  );
  narratives.push(intro);

  // Random events between players
  const numEvents = Math.min(5, Math.max(3, players.length));
  for (let i = 0; i < numEvents; i++) {
    const player1 = players[Math.floor(Math.random() * players.length)];
    const player2 = players[Math.floor(Math.random() * players.length)];
    if (player1 !== player2) {
      const event = await generateNarrative(
        `${player1.username} encounters ${player2.username} in battle!`
      );
      narratives.push(event);
    }
  }

  // Select winner
  const winner = players[Math.floor(Math.random() * players.length)];
  gameState.winner = winner;

  // Generate victory narrative
  const victory = await generateNarrative(
    `${winner.username} emerges victorious from the battle!`
  );
  narratives.push(victory);

  return narratives;
}

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Admin route to serve admin panel
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Admin middleware to emit logs
function emitAdminLog(type, message) {
  io.emit("adminLog", { type, message });
  console.log(`[${type}] ${message}`);
}

// Admin route to force end round
app.post("/admin/force-end", (req, res) => {
  try {
    // Clear all ongoing timers
    gameTimers.forEach((timer) => clearTimeout(timer));
    gameTimers.length = 0;

    // Clear winner and set state to GAME_OVER
    gameState.winner = null;
    gameState.currentState = "GAME_OVER";
    io.emit("chatUpdate", { message: "🛑 Round forcefully ended by admin" });
    emitAdminLog("ADMIN", "Round forcefully ended");
    broadcastPlayers();
    res.json({ success: true, message: "Round ended successfully" });
  } catch (error) {
    console.error("Error ending round:", error);
    res.status(500).json({ success: false, message: "Error ending round" });
  }
});

// Admin route to reset game
app.post("/admin/reset-game", (req, res) => {
  try {
    // Clear all ongoing timers
    gameTimers.forEach((timer) => clearTimeout(timer));
    gameTimers.length = 0;

    gameState.players.clear();
    gameState.currentState = "WAITING_FOR_PLAYERS";
    gameState.winner = null;
    io.emit("chatUpdate", { message: "🔄 Game has been reset by admin" });
    emitAdminLog("ADMIN", "Game state reset");
    broadcastPlayers();
    res.json({ success: true, message: "Game reset successfully" });
  } catch (error) {
    console.error("Error resetting game:", error);
    res.status(500).json({ success: false, message: "Error resetting game" });
  }
});

// Admin route to kick all players
app.post("/admin/kick-all", (req, res) => {
  try {
    const sockets = io.sockets.sockets;
    sockets.forEach((socket) => {
      socket.disconnect(true);
    });
    gameState.players.clear();
    emitAdminLog("ADMIN", "All players kicked");
    broadcastPlayers();
    res.json({ success: true, message: "All players kicked successfully" });
  } catch (error) {
    console.error("Error kicking players:", error);
    res.status(500).json({ success: false, message: "Error kicking players" });
  }
});

// Modify existing socket connection handling to update player stats
io.on("connection", (socket) => {
  // Check if connection is from admin panel
  const isAdmin = socket.handshake.headers.referer?.includes("/admin");

  if (isAdmin) {
    emitAdminLog("ADMIN", `Admin panel connected: ${socket.id}`);

    // Send initial admin update
    io.emit("adminUpdate", {
      playerCount: gameState.players.size,
      gameState: gameState.currentState,
    });

    // Send initial player stats
    broadcastPlayerStats();

    // Handle admin disconnection
    socket.on("disconnect", () => {
      emitAdminLog("ADMIN", "Admin panel disconnected");
    });

    return; // Don't process further for admin connections
  }

  // Regular player connection
  emitAdminLog("CONNECTION", `Player connected: ${socket.id}`);
  updatePlayerStats(socket.id);

  // Initialize player
  gameState.players.set(socket.id, {
    id: socket.id,
    username: null,
    isReady: false,
  });

  // Emit admin update
  io.emit("adminUpdate", {
    playerCount: gameState.players.size,
    gameState: gameState.currentState,
  });

  // Handle username setting
  socket.on("setUsername", (username) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.username = username;
      player.isReady = true;
      emitAdminLog("PLAYER", `${username} joined the game`);
      broadcastPlayers();

      // Update admin panel
      io.emit("adminUpdate", {
        playerCount: gameState.players.size,
        gameState: gameState.currentState,
      });
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      emitAdminLog(
        "CONNECTION",
        `Player disconnected: ${player.username || socket.id}`
      );
      gameState.players.delete(socket.id);
      broadcastPlayers();

      // Update admin panel
      io.emit("adminUpdate", {
        playerCount: gameState.players.size,
        gameState: gameState.currentState,
      });
    }
  });
});

// Modify the start round route to track timers
app.post("/admin/start-round", async (req, res) => {
  const players = Array.from(gameState.players.values());
  const readyPlayers = players.filter((p) => p.isReady);

  // Check if enough players
  if (readyPlayers.length < 2) {
    emitAdminLog("ERROR", "Not enough players to start round");
    return res.status(400).json({
      success: false,
      message: "At least 2 ready players required to start",
    });
  }

  try {
    gameState.currentState = "IN_PROGRESS";
    emitAdminLog("GAME", "Round started");
    broadcastPlayers();

    // Simulate game and generate narrative
    const narratives = await simulateGame();

    // Broadcast each narrative with a delay
    for (let i = 0; i < narratives.length; i++) {
      const timer = setTimeout(() => {
        io.emit("chatUpdate", { message: narratives[i] });
        emitAdminLog("NARRATIVE", narratives[i]);
      }, i * 2000);
      gameTimers.push(timer);
    }

    // End game after narratives
    const endGameTimer = setTimeout(() => {
      gameState.currentState = "GAME_OVER";
      emitAdminLog("GAME", `Game over - Winner: ${gameState.winner.username}`);
      broadcastPlayers();
    }, narratives.length * 2000);
    gameTimers.push(endGameTimer);

    res.json({ success: true });
  } catch (error) {
    console.error("Error running game:", error);
    emitAdminLog("ERROR", "Failed to run game: " + error.message);
    res.status(500).json({
      success: false,
      message: "Error running game",
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log("Socket.io is ready for connections");
});

/**
 * Test Scenario:
 * 1. Open three browser windows with localhost:3000
 * 2. In each window, set usernames:
 *    - Window 1: Player1 (admin view with ?admin=true)
 *    - Window 2: Player2
 *    - Window 3: Player3
 * 3. Admin starts the round
 * 4. Player1 attacks Player2 with sword
 * 5. Player3 attacks Player2 with fork
 * 6. Player1 attacks Player3 with bow
 * 7. Winner should be announced when only one player remains
 *
 * Expected Console Output:
 * [Connection] New player connected: <socket.id>
 * [Username] Player1 joined the game
 * [Connection] New player connected: <socket.id>
 * [Username] Player2 joined the game
 * [Connection] New player connected: <socket.id>
 * [Username] Player3 joined the game
 * [GameState] Round started by admin
 * [Combat] Player1 attacked Player2 with sword
 * [Combat] Player3 attacked Player2 with fork
 * [GameState] Player2 eliminated
 * [Combat] Player1 attacked Player3 with bow
 * [GameState] Player3 eliminated
 * [GameState] Player1 wins the round!
 */
