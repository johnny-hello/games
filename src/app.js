import memoryMatch from "../games/memory-match.js";
import ticTacToe from "../games/tic-tac-toe.js";

const games = [ticTacToe, memoryMatch];
const gameList = document.querySelector("#game-list");
const gameGrid = document.querySelector("#games");
const gameScreen = document.querySelector("#game-screen");
const gameTitle = document.querySelector("#game-title");
const gameDescription = document.querySelector("#game-description");
const gameContainer = document.querySelector("#game-container");
const backButton = document.querySelector("#back-button");
let cleanupGame;

function showGame(game) {
  gameList.hidden = true;
  gameScreen.hidden = false;
  gameTitle.textContent = game.title;
  gameDescription.textContent = game.description;
  cleanupGame = game.mount(gameContainer);
  backButton.focus();
}

function showGames() {
  if (typeof cleanupGame === "function") {
    cleanupGame();
  }
  cleanupGame = undefined;
  gameContainer.replaceChildren();
  gameScreen.hidden = true;
  gameList.hidden = false;
}

for (const game of games) {
  const button = document.createElement("button");
  const icon = document.createElement("span");
  const title = document.createElement("span");
  const description = document.createElement("span");

  button.className = "game-card";
  button.type = "button";
  icon.className = "game-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = game.icon;
  title.className = "game-card-title";
  title.textContent = game.title;
  description.className = "game-card-copy";
  description.textContent = game.description;
  button.append(icon, title, description);
  button.addEventListener("click", () => showGame(game));
  gameGrid.append(button);
}

backButton.addEventListener("click", showGames);
