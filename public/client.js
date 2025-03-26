// Initialize socket connection
const socket = io();

// DOM Elements
const chatBox = document.getElementById("chatBox");
const playerList = document.getElementById("playerList");
const usernameInput = document.getElementById("usernameInput");
const setUsernameBtn = document.getElementById("setUsernameBtn");

let myUsername = "";
let players = [];

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

socket.on("chatUpdate", (data) => {
  console.log("Chat update:", data);
  appendToChatBox(data.message);
});

socket.on("updatePlayers", (data) => {
  console.log("Players update:", data);
  players = data.players;
  updatePlayerList();

  // Handle game state changes
  if (data.currentState === "IN_PROGRESS") {
    appendToChatBox("🎮 The battle has begun!");
  } else if (data.currentState === "GAME_OVER") {
    if (data.winner) {
      appendToChatBox(`🏆 ${data.winner.username} is the champion!`);
    }
    // Don't show winner message if game was force ended
  } else if (data.currentState === "WAITING_FOR_PLAYERS") {
    // Reset UI elements when game is reset
    if (myUsername) {
      setUsernameBtn.disabled = false;
      usernameInput.disabled = false;
      usernameInput.value = myUsername;
      myUsername = "";
      appendToChatBox(
        "Game has been reset. Please set your username again to join."
      );
    }
  }
});

// Username setup
setUsernameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  if (username.length >= 3) {
    console.log("Setting username:", username);
    socket.emit("setUsername", username);
    myUsername = username;
    setUsernameBtn.disabled = true;
    usernameInput.disabled = true;
    appendToChatBox(`Welcome, ${username}! Wait for the battle to begin...`);
  } else {
    console.log("Invalid username length");
    appendToChatBox("Username must be at least 3 characters long");
  }
});

// Helper functions
function appendToChatBox(message) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";
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
    playerDiv.textContent = player.username || "Unnamed Player";
    playerListContent.appendChild(playerDiv);
  });

  playerList.innerHTML = "";
  playerList.appendChild(playerListContent);
}
