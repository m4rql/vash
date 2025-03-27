// Initialize socket connection
const socket = io();

// DOM Elements
const chatBox = document.getElementById("chatBox");
const playerList = document.getElementById("playerList");
const usernameInput = document.getElementById("usernameInput");

// Create Set Nickname button
const setNicknameBtn = document.createElement("button");
setNicknameBtn.id = "setNicknameBtn";
setNicknameBtn.textContent = "Set Nickname";
setNicknameBtn.className = "gradient-button";
document.querySelector(".controls").appendChild(setNicknameBtn);

// Create Join Battle button
const joinBattleBtn = document.createElement("button");
joinBattleBtn.id = "joinBattleBtn";
joinBattleBtn.textContent = "Join Battle";
joinBattleBtn.style.display = "none";
joinBattleBtn.className = "gradient-button";
document.querySelector(".controls").appendChild(joinBattleBtn);

// Create Exit Battle button
const exitBattleBtn = document.createElement("button");
exitBattleBtn.id = "exitBattleBtn";
exitBattleBtn.textContent = "Exit Battle";
exitBattleBtn.style.display = "none";
exitBattleBtn.className = "gradient-button";
document.querySelector(".controls").appendChild(exitBattleBtn);

let myUsername = "";
let isInBattle = false;
let players = [];
let currentGameState = "WAITING_FOR_PLAYERS";
let timerMessageId = null;

// Socket event handlers
socket.on("connect", () => {
  appendToChatBox("🔌 Connected to server");
});

socket.on("disconnect", () => {
  appendToChatBox("❌ Disconnected from server. Please refresh the page.");
});

socket.on("roundCountdown", (countdown) => {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const formattedTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;
  updateOrCreateTimerMessage(`⏳ Round starting in ${formattedTime}`);
});

socket.on("roundCommencing", () => {
  removeTimer();
  appendToChatBox("🎮 The round is commencing!");
});

socket.on("drawStarted", () => {
  appendToChatBox("⚔️ The draw has started!");
});

socket.on("chatUpdate", (data) => {
  appendToChatBox(data.message);
});

socket.on("roundEnded", (data) => {
  removeTimer();
  appendToChatBox(data.message);

  if (data.winner) {
    showWinnerAnnouncement(data.winner.username);
  }

  if (myUsername) {
    isInBattle = false;
    exitBattleBtn.style.display = "none";
    joinBattleBtn.style.display = "inline-block";
    appendToChatBox('Click "Join Battle" to join the next round!');
  }
});

socket.on("updatePlayers", (data) => {
  players = data.players;
  currentGameState = data.currentState;
  updatePlayerList();

  if (data.currentState === "IN_PROGRESS") {
    if (myUsername && !isInBattle) {
      joinBattleBtn.style.display = "inline-block";
      exitBattleBtn.style.display = "none";
    }
  } else if (data.currentState === "WAITING_FOR_PLAYERS") {
    if (myUsername) {
      usernameInput.value = myUsername;
      if (!isInBattle) {
        joinBattleBtn.style.display = "inline-block";
        exitBattleBtn.style.display = "none";
      }
    }
  }
});

// Nickname setup handler
setNicknameBtn.addEventListener("click", () => {
  const username = usernameInput.value.trim();

  if (username.length < 3) {
    appendToChatBox("❌ Username must be at least 3 characters long");
    return;
  }

  if (players.some((p) => p.username === username && p.id !== socket.id)) {
    appendToChatBox("❌ Username already taken");
    return;
  }

  socket.emit("setUsername", username);
  myUsername = username;
  setNicknameBtn.style.display = "none";
  usernameInput.disabled = true;
  joinBattleBtn.style.display = "inline-block";
  appendToChatBox(
    `✨ Welcome, ${username}! Click "Join Battle" when you're ready to fight!`
  );
});

// Join Battle handler
joinBattleBtn.addEventListener("click", () => {
  if (!myUsername) {
    appendToChatBox("❌ Please set your nickname first!");
    return;
  }

  socket.emit("joinBattle", myUsername);
  isInBattle = true;
  joinBattleBtn.style.display = "none";
  exitBattleBtn.style.display = "inline-block";
  appendToChatBox(`⚔️ ${myUsername} has joined the battle!`);
});

// Exit Battle handler
exitBattleBtn.addEventListener("click", () => {
  socket.emit("exitBattle", myUsername);
  isInBattle = false;
  exitBattleBtn.style.display = "none";
  joinBattleBtn.style.display = "inline-block";
  appendToChatBox(`🚪 ${myUsername} has left the battle!`);
});

// Helper functions
function appendToChatBox(message) {
  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message";
  messageDiv.textContent = message;
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function updateOrCreateTimerMessage(message) {
  if (timerMessageId) {
    const existingMessage = document.getElementById(timerMessageId);
    if (existingMessage) {
      existingMessage.textContent = message;
      return;
    }
  }

  const messageDiv = document.createElement("div");
  messageDiv.className = "chat-message timer-message";
  messageDiv.id = `timer-${Date.now()}`;
  messageDiv.textContent = message;
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
  timerMessageId = messageDiv.id;
}

function removeTimer() {
  if (timerMessageId) {
    const timerMessage = document.getElementById(timerMessageId);
    if (timerMessage) {
      timerMessage.remove();
    }
    timerMessageId = null;
  }
}

function updatePlayerList() {
  const playerListContent = document.createElement("div");
  playerListContent.innerHTML = "<h3>Warriors</h3>";

  players.forEach((player) => {
    const playerDiv = document.createElement("div");
    playerDiv.className = "player-item";

    if (player.username === myUsername) {
      playerDiv.classList.add("current-player");
    }

    const readyStatus = player.isReady ? "⚔️" : "";
    const healthBar = player.username ? createHealthBar(100) : "";
    const displayName = player.username || "Unnamed Warrior";

    playerDiv.innerHTML = `
      ${readyStatus} ${displayName}
      ${healthBar}
    `;

    playerListContent.appendChild(playerDiv);
  });

  playerList.innerHTML = "";
  playerList.appendChild(playerListContent);
}

function createHealthBar(health) {
  return `
    <div class="health-bar">
      <div class="health-bar-fill" style="width: ${health}%"></div>
    </div>
  `;
}

function showWinnerAnnouncement(winnerName) {
  // Create winner announcement element
  const announcement = document.createElement("div");
  announcement.className = "winner-announcement";

  announcement.innerHTML = `
    <div class="winner-trophy">🏆</div>
    <div class="winner-name">${winnerName}</div>
    <div class="winner-title">CHAMPION OF THE ARENA</div>
  `;

  // Add confetti
  createConfetti(announcement);

  // Add to game container
  document.querySelector(".game-container").appendChild(announcement);

  // Remove after animation
  setTimeout(() => {
    announcement.remove();
  }, 5000);
}

function createConfetti(container) {
  const colors = [
    "var(--solana-purple)",
    "var(--solana-green)",
    "var(--solana-light)",
  ];

  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.style.left = Math.random() * 100 + "%";
    confetti.style.backgroundColor =
      colors[Math.floor(Math.random() * colors.length)];
    confetti.style.animationDelay = Math.random() * 3 + "s";
    container.appendChild(confetti);
  }
}
