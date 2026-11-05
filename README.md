# games

Games for kids. Open `index.html` in a browser, or turn on GitHub Pages.

## 🦖 Math Dino Run (`dino-math/`)
A Chrome-dino-style runner. Finish a level, then solve 3 math problems (5 choices each) to unlock the next level.
- 50 levels, the dino gets a little faster every level.
- 3 coupons 🎟️ per game: each wrong answer uses one. Lose all 3 → restart from level 1.
- Hitting a cactus only restarts the current level.

| Levels | Math |
|---|---|
| 1–5 | Single digit + (sum ≤ 10) |
| 6–10 | Single digit + and − |
| 11–15 | + and − within 20 |
| 16–20 | Two-digit + (no carrying) — birds appear |
| 21–25 | Two-digit − (no borrowing) |
| 26–30 | Two-digit + / − with carrying/borrowing |
| 31–35 | ×2, ×5, ×10 |
| 36–40 | Times tables to 10 |
| 41–45 | Division |
| 46–50 | Mixed challenge |

## 🤖 Robot Path Coder (`robot-code/`)
A first coding game. Build a program from arrow blocks to move the robot and collect every gem 💎.
- 15 levels. Rocks 🪨 block the robot, and water 🌊 means a splash.
- Levels 1–8: arrow steps only (planning and sequencing).
- Levels 9–15: 🔁 loops with a block limit, ending with loops inside loops.
- Tap a block to remove it. Tap a loop's 🔁 ×N to change the count, and use 🔚 to close a loop.
- Stars: ⭐⭐⭐ for solving on the first try. Progress is saved in the browser.

## 🚀 Number Rocket (`number-rocket/`)
Tap the number line where the rocket should land. A closer landing earns more stars (up to 3).
9 stages: 0–10, adding, 0–20, adding and subtracting, 0–100, halves and quarters, fractions, negative numbers, subtracting below zero. Get 20 of 30 stars to unlock the next stage.

## 🍕 Pizza Shop (`pizza-shop/`)
Customers order a fraction of a pizza, sometimes with a topping on part of it. Cut the pizza into equal slices, box the right amount, add toppings, then give the right change at the register.
Equivalent fractions count (2/4 is a correct way to make 1/2). Orders get harder: halves and quarters, then thirds, sixths and eighths with toppings, then prices with cents.

## 🧱 Block Builder Balance (`block-balance/`)
30 levels of balancing a seesaw scale: building to match a sum, the mystery box (□ + 4 = 9), expressions on both sides, take-away (□ − 3 = 5), and many boxes (3 × □ = 12).

## 🐸 Frog Hop Patterns (`frog-hop/`)
Pick the next number in the pattern before the lily pad sinks. Counting by 2s, 5s, 10s, 3s, 4s, backwards, 6s–9s, tricky starting numbers, then mixed. 3 lives, and the timer gets shorter as you go.

## 🏰 Shape Defender (`shape-defender/`)
Shape monsters walk toward the castle. Early waves: tap the glowing monster's name. Later waves: tap the monster that matches a clue ("has 4 equal sides", "has a right angle", "has NO corners"). 8 waves and 5 hearts.

## 📖 Story Dice Adventure (`story-dice/`)
Roll 3–6 picture dice and write (or say 🎤) one part of the story for each picture. The game turns it into a storybook to read page by page, print, or save as a file. Books are kept in "My books".

## 🎵 Beat Garden (`beat-garden/`)
A step sequencer: 5 flower notes and 2 drums over 8 steps. Plant flowers and press Play. 10 challenges: copying rhythms (with outlines, then by ear), climbing a scale, making a repeating pattern, and a final song.

## 🧪 Creature Lab (`creature-lab/`)
Pick a body covering, how the creature moves, how it breathes, its color and a special feature. Then test it in the ocean, desert, arctic or rainforest. The game explains each need that's met or missed. Fill your zoo with one creature that thrives in each habitat.

## 🏭 Warehouse Twin (`warehouse/`)
A 3D warehouse in a clean isometric style: racks, pallets, dock doors, trucks and forklifts on autopilot. Click a forklift and drive it with WASD, lift with R/F and pick or drop pallets with Space. Forklifts never overlap: every move is checked, and the autopilot slows, stops, takes turns and keeps one forklift per aisle. Live mode can show real forklifts from VSLAM positions. Needs a small web server: `node warehouse/tools/dev-server.mjs`. See [warehouse/README.md](warehouse/README.md).
