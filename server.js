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
  roundTimer: null,
  isRoundActive: false,
  roundNumber: 0, // Track round number
};

// Track game timers
const gameTimers = [];

// Constants for round timing
const ROUND_DURATION = 180000; // 3 minutes in milliseconds
const ROUND_COUNTDOWN_INTERVAL = 1000; // 1 second for countdown updates

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
    isReady: Boolean(player.username), // Player is ready if they have a username
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
async function simulateGame(readyPlayers) {
  const narratives = [];

  // Generate introduction
  const intro = await generateNarrative(
    `${readyPlayers.length} warriors enter the arena for Round ${gameState.roundNumber}!`
  );
  narratives.push(intro);

  // Random events between players
  const numEvents = Math.min(5, Math.max(3, readyPlayers.length));
  for (let i = 0; i < numEvents; i++) {
    const player1 =
      readyPlayers[Math.floor(Math.random() * readyPlayers.length)];
    const player2 =
      readyPlayers[Math.floor(Math.random() * readyPlayers.length)];
    if (player1 !== player2) {
      const event = await generateNarrative(
        `${player1.username} encounters ${player2.username} in battle!`
      );
      narratives.push(event);
    }
  }

  // Select winner from ready players
  const winner = readyPlayers[Math.floor(Math.random() * readyPlayers.length)];
  gameState.winner = winner;

  // Generate victory narrative
  const victory = await generateNarrative(
    `${winner.username} emerges victorious from Round ${gameState.roundNumber}!`
  );
  narratives.push(victory);

  return narratives;
}

// Function to start a new round automatically
async function startAutomaticRound() {
  if (gameState.isRoundActive) return; // Prevent multiple rounds from starting

  gameState.isRoundActive = true;
  let countdown = 180; // 3 minutes in seconds

  // Emit initial countdown
  io.emit("roundCountdown", countdown);

  // Start countdown timer
  const countdownInterval = setInterval(() => {
    countdown--;
    io.emit("roundCountdown", countdown);

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      io.emit("roundCommencing");

      // After 2 seconds, start the actual round
      setTimeout(async () => {
        io.emit("drawStarted");
        await handleRoundStart();
      }, 2000);
    }
  }, ROUND_COUNTDOWN_INTERVAL);

  // Store the interval for cleanup
  gameState.roundTimer = countdownInterval;
}

// Function to handle the round start logic
async function handleRoundStart() {
  const players = Array.from(gameState.players.values());
  const readyPlayers = players.filter((p) => p.username); // Players are ready if they have a username

  if (readyPlayers.length < 2) {
    io.emit("chatUpdate", {
      message:
        "❌ Not enough players ready for this round. Waiting for next round...",
    });
    resetRoundState();
    startAutomaticRound(); // Start new countdown for next attempt
    return;
  }

  try {
    gameState.currentState = "IN_PROGRESS";
    gameState.roundNumber++;
    emitAdminLog(
      "GAME",
      `Round ${gameState.roundNumber} started automatically with ${readyPlayers.length} players`
    );
    broadcastPlayers();

    // Only include ready players in the game
    const narratives = await simulateGame(readyPlayers);

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
      endRound();
    }, narratives.length * 2000);
    gameTimers.push(endGameTimer);
  } catch (error) {
    console.error("Error running game:", error);
    emitAdminLog("ERROR", "Failed to run game: " + error.message);
    resetRoundState();
  }
}

// Function to handle round ending
function endRound() {
  gameState.currentState = "GAME_OVER";
  emitAdminLog(
    "GAME",
    `Round ${gameState.roundNumber} over - Winner: ${gameState.winner.username}`
  );

  // Reset all players' ready status
  gameState.players.forEach((player) => {
    if (player.username) {
      player.isReady = false;
    }
  });

  // Broadcast the round end
  io.emit("roundEnded", {
    message: "Round ended! Click Join Battle to join the next round!",
  });

  broadcastPlayers();

  // Start next round countdown after a short delay
  setTimeout(() => {
    startAutomaticRound();
  }, 5000);
}

// Function to reset round state
function resetRoundState() {
  gameState.isRoundActive = false;
  if (gameState.roundTimer) {
    clearInterval(gameState.roundTimer);
    gameState.roundTimer = null;
  }
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

// Admin route to start round immediately
app.post("/admin/start-round", async (req, res) => {
  try {
    // Only allow starting if a round is active (in countdown phase)
    if (!gameState.isRoundActive) {
      return res.status(400).json({
        success: false,
        message: "No active round to start",
      });
    }

    // Clear the countdown timer
    if (gameState.roundTimer) {
      clearInterval(gameState.roundTimer);
      gameState.roundTimer = null;
    }

    // Emit round commencing message
    io.emit("roundCommencing");
    emitAdminLog("ADMIN", "Round started by admin");

    // Start the round after 2 seconds
    setTimeout(async () => {
      io.emit("drawStarted");
      await handleRoundStart();
    }, 2000);

    res.json({ success: true, message: "Round started successfully" });
  } catch (error) {
    console.error("Error starting round:", error);
    res.status(500).json({ success: false, message: "Error starting round" });
  }
});

// Admin route to reset game
app.post("/admin/reset-game", (req, res) => {
  try {
    // Clear all ongoing timers
    gameTimers.forEach((timer) => clearTimeout(timer));
    gameTimers.length = 0;

    // Reset round state
    resetRoundState();

    gameState.players.clear();
    gameState.currentState = "WAITING_FOR_PLAYERS";
    gameState.winner = null;
    io.emit("chatUpdate", { message: "🔄 Game has been reset by admin" });
    emitAdminLog("ADMIN", "Game state reset");
    broadcastPlayers();

    // Start new automatic round
    startAutomaticRound();

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

// Socket connection handling
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);
  emitAdminLog("CONNECTION", `New client connected: ${socket.id}`);

  // Add new player to game state
  gameState.players.set(socket.id, {
    id: socket.id,
    username: "",
    isReady: false,
  });

  // Update player stats
  updatePlayerStats(socket.id);
  broadcastPlayers();

  // Handle username setting
  socket.on("setUsername", (username) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.username = username;
      player.isReady = true;
      emitAdminLog("PLAYER", `${username} (${socket.id}) joined the game`);
      broadcastPlayers();

      // Start round if enough players and not already started
      const readyPlayers = Array.from(gameState.players.values()).filter(
        (p) => p.username
      );
      if (readyPlayers.length >= 2 && !gameState.isRoundActive) {
        startAutomaticRound();
      }
    }
  });

  // Handle player exit
  socket.on("exitBattle", (username) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      emitAdminLog("PLAYER", `${username} (${socket.id}) left the game`);
      player.username = "";
      player.isReady = false;
      broadcastPlayers();
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    emitAdminLog("CONNECTION", `Client disconnected: ${socket.id}`);
    gameState.players.delete(socket.id);
    broadcastPlayers();

    // End round if not enough players
    const readyPlayers = Array.from(gameState.players.values()).filter(
      (p) => p.username
    );
    if (readyPlayers.length < 2 && gameState.isRoundActive) {
      endRound("Not enough players remaining");
    }
  });
});

// Function to end the round
function endRound(reason = "") {
  if (!gameState.isRoundActive) return;

  // Clear any existing timers
  if (gameState.roundTimer) {
    clearInterval(gameState.roundTimer);
    gameState.roundTimer = null;
  }

  gameTimers.forEach((timer) => clearTimeout(timer));
  gameTimers.length = 0;

  // Reset game state
  gameState.isRoundActive = false;
  gameState.currentState = "WAITING_FOR_PLAYERS";

  // Broadcast round end
  io.emit("roundEnded", {
    message: reason ? `Round ended: ${reason}` : "Round ended",
    winner: gameState.winner,
  });

  // Reset winner
  gameState.winner = null;
  broadcastPlayers();

  // Start new round after delay
  setTimeout(() => {
    if (
      Array.from(gameState.players.values()).filter((p) => p.username).length >=
      2
    ) {
      startAutomaticRound();
    }
  }, 5000);
}

// Function to emit admin logs
function emitAdminLog(type, message) {
  io.emit("adminLog", { type, message, timestamp: new Date().toISOString() });
}

// Start the server
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
