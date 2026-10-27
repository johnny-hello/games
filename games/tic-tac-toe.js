export default {
  id: "tic-tac-toe",
  title: "Tic-Tac-Toe",
  description: "Can you get three in a row?",
  icon: "⭕",

  mount(container) {
    container.innerHTML = `
      <div class="tic-game">
        <p class="game-status" aria-live="polite">X goes first!</p>
        <div class="tic-board" role="group" aria-label="Tic-Tac-Toe board">
          ${Array.from({ length: 9 }, (_, index) =>
            `<button class="tic-cell" type="button" aria-label="Empty square ${index + 1}" data-index="${index}"></button>`
          ).join("")}
        </div>
        <button class="game-action" type="button">Play again</button>
      </div>
    `;

    const board = Array(9).fill("");
    const cells = [...container.querySelectorAll(".tic-cell")];
    const status = container.querySelector(".game-status");
    const resetButton = container.querySelector(".game-action");
    let currentPlayer = "X";
    let finished = false;

    const winningLines = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8],
      [0, 3, 6], [1, 4, 7], [2, 5, 8],
      [0, 4, 8], [2, 4, 6],
    ];

    function play(event) {
      const cell = event.currentTarget;
      const index = Number(cell.dataset.index);
      if (finished || board[index]) return;

      board[index] = currentPlayer;
      cell.textContent = currentPlayer;
      cell.setAttribute("aria-label", `Square ${index + 1}: ${currentPlayer}`);

      if (winningLines.some((line) => line.every((square) => board[square] === currentPlayer))) {
        status.textContent = `${currentPlayer} wins! Great game!`;
        finished = true;
        cells.forEach((boardCell) => {
          boardCell.disabled = true;
        });
        return;
      }

      if (board.every(Boolean)) {
        status.textContent = "It's a tie! Play again?";
        finished = true;
        cells.forEach((boardCell) => {
          boardCell.disabled = true;
        });
        return;
      }

      currentPlayer = currentPlayer === "X" ? "O" : "X";
      status.textContent = `${currentPlayer}'s turn`;
    }

    function reset() {
      board.fill("");
      currentPlayer = "X";
      finished = false;
      status.textContent = "X goes first!";
      for (const [index, cell] of cells.entries()) {
        cell.textContent = "";
        cell.disabled = false;
        cell.setAttribute("aria-label", `Empty square ${index + 1}`);
      }
    }

    for (const cell of cells) cell.addEventListener("click", play);
    resetButton.addEventListener("click", reset);

    return () => {
      for (const cell of cells) cell.removeEventListener("click", play);
      resetButton.removeEventListener("click", reset);
    };
  },
};
