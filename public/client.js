// Initialize socket connection
const socket = io();

// DOM Elements
const chatBox = document.getElementById("chatBox");
const playerList = document.getElementById("playerList");
const usernameInput = document.getElementById("usernameInput");
const setUsernameBtn = document.getElementById("setUsernameBtn");

// Create Exit Battle button
const exitBattleBtn = document.createElement("button");
exitBattleBtn.id = "exitBattleBtn";
exitBattleBtn.textContent = "Exit Battle";
exitBattleBtn.style.backgroundColor = "#ff4444";
exitBattleBtn.style.color = "white";
exitBattleBtn.style.display = "none";
document.querySelector(".controls").appendChild(exitBattleBtn);

// Update button text to reflect its dual purpose
setUsernameBtn.textContent = "Join Battle";

let myUsername = "";
let players = [];
let isReady = false;
let currentGameState = "WAITING_FOR_PLAYERS";

// Socket event handlers
socket.on("connect", () => {
  console.log("Connected to server");
  appendToChatBox("Connected to server");
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
  appendToChatBox("Disconnected from server");
  alert("Disconnected from server. Please refresh the page.");
});

socket.on("roundCountdown", (countdown) => {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  appendToChatBox(`⏳ Round starting in ${formattedTime}`);
});

socket.on("roundCommencing", () => {
  appendToChatBox("🎮 The round is commencing!");
});

socket.on("drawStarted", () => {
  appendToChatBox("⚔️ The draw has started!");
});

socket.on("chatUpdate", (data) => {
  console.log("Chat update:", data);
  appendToChatBox(data.message);
});

socket.on("roundEnded", (data) => {
  appendToChatBox(data.message);

  // Reset UI to allow joining next round
  if (myUsername) {
    setUsernameBtn.disabled = false;
    usernameInput.disabled = false;
    usernameInput.value = myUsername;
    exitBattleBtn.style.display = "none";
    appendToChatBox("Click 'Join Battle' to join the next round!");
  }
  updatePlayerList();
});

socket.on("updatePlayers", (data) => {
  console.log("Players update:", data);
  players = data.players;
  updatePlayerList();

  // Store previous state to detect changes
  const previousState = currentGameState;
  currentGameState = data.currentState;

  // Handle game state changes
  if (data.currentState === "IN_PROGRESS") {
    if (myUsername) {
      setUsernameBtn.disabled = true;
      usernameInput.disabled = true;
    }
    appendToChatBox("🎮 The battle has begun!");
  } else if (data.currentState === "GAME_OVER") {
    if (data.winner) {
      appendToChatBox(`🏆 ${data.winner.username} is the champion!`);
    }
    if (myUsername) {
      setUsernameBtn.disabled = false;
      usernameInput.disabled = false;
      exitBattleBtn.style.display = "none";
    }
  } else if (
    data.currentState === "WAITING_FOR_PLAYERS" &&
    previousState !== "WAITING_FOR_PLAYERS"
  ) {
    // Only show reset message if the game state actually changed to WAITING_FOR_PLAYERS
    if (myUsername) {
      setUsernameBtn.disabled = false;
      usernameInput.disabled = false;
      usernameInput.value = myUsername;
      exitBattleBtn.style.display = "none";
      myUsername = "";
      isReady = false;
      appendToChatBox("Game has been reset. Click 'Join Battle' to rejoin!");
    }
  }
});

// Username setup and battle join handler
setUsernameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (username.length >= 3) {
    console.log("Joining battle as:", username);
    socket.emit("setUsername", username);
    myUsername = username;
    setUsernameBtn.disabled = true;
    usernameInput.disabled = true;
    exitBattleBtn.style.display = "block"; // Show exit button when joining
    appendToChatBox(`Welcome, ${username}! You have joined the battle!`);
  } else {
    console.log("Invalid username length");
    appendToChatBox("Username must be at least 3 characters long");
  }
});

// Exit battle handler
exitBattleBtn.addEventListener("click", () => {
  if (myUsername) {
    socket.emit("exitBattle", myUsername);
    setUsernameBtn.disabled = false;
    usernameInput.disabled = false;
    exitBattleBtn.style.display = "none";
    appendToChatBox("You have exited the battle.");
    myUsername = "";
    isReady = false;
  }
});

// Helper functions
function appendToChatBox(message) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";

  // If it's a countdown message, update the last countdown message instead of adding a new one
  if (message.startsWith("⏳")) {
    const lastMessage = chatBox.lastElementChild;
    if (lastMessage && lastMessage.textContent.startsWith("⏳")) {
      lastMessage.textContent = message;
      return;
    }
  }

  messageDiv.textContent = message;
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function updatePlayerList() {
  const playerListContent = document.createElement("div");
  playerListContent.innerHTML = "<h3>Warriors</h3>";

  players.forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-item";
    if (player.username === myUsername) {
      playerDiv.className += " current-player";
    }

    // Show ready status only if player has a username
    const readyStatus = player.username ? "⚔️" : "";
    const displayName = player.username || "Unnamed Player";
    playerDiv.textContent = readyStatus
      ? `${readyStatus} ${displayName}`
      : displayName;

    playerListContent.appendChild(playerDiv);
  });

  playerList.innerHTML = "";
  playerList.appendChild(playerListContent);
}
