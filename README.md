# games

A small collection of browser games for kids, built to make it straightforward to add more games—including with help from AI agents. The project uses plain HTML, CSS, and JavaScript modules; there is no build step or dependency installation.

## Run locally

From the repository root, start a static web server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Add a game

1. Create a JavaScript module in `games/`, for example `games/my-game.js`.
2. Export a default object with a unique `id`, a `title`, a short `description`, and a `mount(container)` function.
3. In `mount`, render the game inside the provided container and return an optional cleanup function. Use that function to clear timers or remove listeners when the player leaves the game.
4. Import the module in `src/app.js` and add it to the `games` array.
5. Keep game-specific behavior in its own module. Shared navigation and page styling belong to the hub.

Example:

```js
export default {
  id: "my-game",
  title: "My Game",
  description: "A short description.",
  mount(container) {
    container.innerHTML = "<p>Game goes here!</p>";
  },
};
```

Games should use semantic, keyboard-accessible HTML controls and keep all game state local to their module.
