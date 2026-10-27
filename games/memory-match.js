export default {
  id: "memory-match",
  title: "Memory Match",
  description: "Find the matching pairs of friendly faces.",
  icon: "🧠",

  mount(container) {
    const symbols = ["🐸", "🦊", "🐼", "🐙", "🐝", "🐢"];
    const cards = shuffle([...symbols, ...symbols]);

    container.innerHTML = `
      <div class="memory-game">
        <p class="game-status" aria-live="polite">Find all 6 pairs!</p>
        <div class="memory-board" role="group" aria-label="Memory cards">
          ${cards.map((card, index) =>
            `<button class="memory-card" type="button" aria-label="Hidden card ${index + 1}" data-index="${index}">?</button>`
          ).join("")}
        </div>
        <button class="game-action" type="button">Shuffle and play again</button>
      </div>
    `;

    const buttons = [...container.querySelectorAll(".memory-card")];
    const status = container.querySelector(".game-status");
    const resetButton = container.querySelector(".game-action");
    let firstCard;
    let lockBoard = false;
    let pairsFound = 0;
    let mismatchTimer;

    function flip(event) {
      const button = event.currentTarget;
      const card = cards[Number(button.dataset.index)];
      if (lockBoard || button === firstCard || button.disabled) return;

      button.textContent = card;
      button.setAttribute("aria-label", `Card ${Number(button.dataset.index) + 1}: ${card}`);

      if (!firstCard) {
        firstCard = button;
        return;
      }

      const firstCardData = cards[Number(firstCard.dataset.index)];
      if (firstCardData === card) {
        firstCard.disabled = true;
        button.disabled = true;
        firstCard = undefined;
        pairsFound += 1;
        status.textContent = pairsFound === symbols.length
          ? "You found every pair! Amazing!"
          : `A match! ${symbols.length - pairsFound} ${symbols.length - pairsFound === 1 ? "pair" : "pairs"} left.`;
        return;
      }

      status.textContent = "Not a match. Try again!";
      lockBoard = true;
      mismatchTimer = setTimeout(() => {
        for (const cardButton of [firstCard, button]) {
          cardButton.textContent = "?";
          cardButton.setAttribute("aria-label", `Hidden card ${Number(cardButton.dataset.index) + 1}`);
        }
        firstCard = undefined;
        lockBoard = false;
      }, 850);
    }

    function reset() {
      clearTimeout(mismatchTimer);
      mismatchTimer = undefined;
      for (const button of buttons) {
        button.disabled = false;
        button.textContent = "?";
        button.setAttribute("aria-label", `Hidden card ${Number(button.dataset.index) + 1}`);
      }
      firstCard = undefined;
      lockBoard = false;
      pairsFound = 0;
      status.textContent = "Find all 6 pairs!";
      shuffle(cards);
    }

    for (const button of buttons) button.addEventListener("click", flip);
    resetButton.addEventListener("click", reset);

    return () => {
      clearTimeout(mismatchTimer);
      for (const button of buttons) button.removeEventListener("click", flip);
      resetButton.removeEventListener("click", reset);
    };
  },
};

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}
