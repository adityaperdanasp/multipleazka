/* =================================================================
   Multipleazka — script.js
   All game logic, Firebase sync, and text-to-speech.

   Sections:
     1. Firebase config & init
     2. Constants & game state
     3. Screen navigation helpers
     4. Role selection
     5. Pairing: create / join a game
     6. Firebase realtime listeners
     7. Race: start, questions, answers
     8. Progress & winner detection
     9. Feedback (TTS + popups) — Kids only cheering
    10. Game over & play again
   ================================================================= */


/* =================================================================
   1. FIREBASE CONFIG & INIT
   -----------------------------------------------------------------
   ⚠️ REPLACE the placeholder values below with YOUR Firebase project's
   web config. Steps:
     1. Go to https://console.firebase.google.com  → create a project
     2. Build → Realtime Database → Create Database → Start in TEST mode
     3. Project settings ⚙️ → "Your apps" → Web (</>) → register app
     4. Copy the firebaseConfig object here.
     5. Make sure databaseURL is present (Realtime DB, not Firestore).
   ================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyDaWWg1-R9cRVU44coT5qMhzstAK4o8WTw",
  authDomain: "multipleazka.firebaseapp.com",
  databaseURL: "https://multipleazka-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "multipleazka",
  storageBucket: "multipleazka.firebasestorage.app",
  messagingSenderId: "597375324235",
  appId: "1:597375324235:web:384f8d3b43e582b281fdce"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();


/* =================================================================
   2. CONSTANTS & GAME STATE
   ================================================================= */

// Child's name — all Kids cheering is personalized with this.
const CHILD_NAME = "Azka";

// How far each correct answer moves the car (fraction of the track, 0..1).
// Kids: 10 correct → finish.   Parent: 50 correct → finish (1/5 of Kids' step).
const STEP = {
  kids: 1 / 10,   // 0.10
  parent: 1 / 50  // 0.02
};

// Number ranges for question factors.
const RANGE = {
  kids: 10,   // 1..10
  parent: 12  // 1..12
};

// Kids cheering — spoken aloud + green popup.
const CHEERS_CORRECT = [
  "Awesome, Azka! You got it!",
  "Brilliant work, Azka!",
  "You're a math star, Azka!",
  "Perfect! Azka is on fire!",
  "Great job, Azka! Keep going!",
  "Yes! Azka nailed it!",
  "Amazing, Azka! You're so smart!",
  "Correct! Azka is unstoppable!",
  "Fantastic, Azka! Well done!",
  "You rock, Azka!"
];

// Kids encouragement — spoken aloud + blue/neutral popup (never red).
const CHEERS_WRONG = [
  "Almost there, Azka! Try again!",
  "Good try, Azka! You'll get the next one!",
  "Keep going, Azka! You're learning!",
  "Don't give up, Azka! You've got this!",
  "Close one, Azka! Let's keep practicing!",
  "Nice effort, Azka! Next one's yours!",
  "You're getting better, Azka!",
  "Stay strong, Azka! Try again!",
  "That's okay, Azka! Champions keep trying!"
];

// Runtime state for THIS device.
const state = {
  role: null,       // 'kids' | 'parent' — the role this device plays
  code: null,       // pairing code for the game
  correct: 0,       // correct answers by this player
  progress: 0,      // 0..1 track position for this player
  currentAnswer: 0, // correct value for the on-screen question
  gameOver: false,
  listening: false  // whether a Firebase listener is attached
};


/* =================================================================
   3. SCREEN NAVIGATION HELPERS
   ================================================================= */
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// Small helper to grab elements.
const $ = id => document.getElementById(id);


/* =================================================================
   4. ROLE SELECTION
   ================================================================= */
document.querySelectorAll(".role-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.role = btn.dataset.role;                 // 'kids' or 'parent'
    $("pair-role-label").textContent =
      state.role === "kids" ? "Kids 🧒" : "Parent 🧑";
    resetPairUI();
    showScreen("screen-pair");
  });
});

// Back buttons
document.querySelectorAll(".back-btn").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});


/* =================================================================
   5. PAIRING — CREATE / JOIN
   ================================================================= */

// Generate a 6-char pairing code (unambiguous chars only).
function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I,O,1,0 to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function resetPairUI() {
  $("pair-choose").classList.remove("hidden");
  $("pair-waiting").classList.add("hidden");
  $("pair-error").textContent = "";
  $("join-code-input").value = "";
}

// --- CREATE a game ---
$("btn-create").addEventListener("click", async () => {
  const code = makeCode();
  state.code = code;

  // Write the initial game with this player as the creator.
  await db.ref("games/" + code).set({
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    status: "waiting",
    winner: null,
    players: {
      [state.role]: playerSeed()
    }
  });

  // Show the waiting UI with the code.
  $("code-display").textContent = code;
  $("pair-choose").classList.add("hidden");
  $("pair-waiting").classList.remove("hidden");

  attachGameListener(code);
});

// --- JOIN a game ---
$("btn-join").addEventListener("click", async () => {
  const code = $("join-code-input").value.trim().toUpperCase();
  $("pair-error").textContent = "";

  if (code.length !== 6) {
    $("pair-error").textContent = "Code must be 6 characters.";
    return;
  }

  const snap = await db.ref("games/" + code).get();
  if (!snap.exists()) {
    $("pair-error").textContent = "No game found with that code.";
    return;
  }

  const game = snap.val();

  // Don't let two players take the same role.
  if (game.players && game.players[state.role]) {
    $("pair-error").textContent =
      "The " + state.role + " seat is already taken. Go back and pick the other role.";
    return;
  }

  state.code = code;
  await db.ref(`games/${code}/players/${state.role}`).set(playerSeed());
  attachGameListener(code);
});

// Copy-code button
$("btn-copy-code").addEventListener("click", () => {
  const code = $("code-display").textContent;
  navigator.clipboard?.writeText(code);
  $("btn-copy-code").textContent = "Copied ✓";
  setTimeout(() => ($("btn-copy-code").textContent = "Copy code"), 1500);
});

// Fresh player node.
function playerSeed() {
  return { role: state.role, correct: 0, progress: 0, finished: false };
}


/* =================================================================
   6. FIREBASE REALTIME LISTENERS
   -----------------------------------------------------------------
   One listener on the whole game node keeps both cars + status synced.
   ================================================================= */
function attachGameListener(code) {
  if (state.listening) return;
  state.listening = true;

  db.ref("games/" + code).on("value", snap => {
    const game = snap.val();
    if (!game) return;

    const players = game.players || {};

    // Update BOTH cars from the shared state (real-time sync).
    updateCar("kids", players.kids);
    updateCar("parent", players.parent);

    // When both players are present and we're still on a pairing screen,
    // start the race.
    const bothHere = players.kids && players.parent;
    if (bothHere && game.status === "waiting") {
      // First device to notice flips status to "playing".
      db.ref(`games/${code}/status`).set("playing");
    }
    if (bothHere && !document.getElementById("screen-race").classList.contains("active")
        && !state.gameOver) {
      startRace();
    }

    // Winner handling.
    if (game.winner && !state.gameOver) {
      endGame(game.winner);
    }
  });
}

// Remember each car's last progress so we can detect forward movement (for smoke).
const lastProgress = { kids: 0, parent: 0 };

// Move a car on its track based on that player's progress (0..1).
function updateCar(role, player) {
  if (!player) return;
  const car = $("car-" + role);
  const track = car.parentElement;
  const p = Math.min(player.progress || 0, 1);

  // Car travels from just past the START label to just before the finish flag.
  const startX = 28;
  const endX = Math.max(startX, track.clientWidth - car.offsetWidth - 40);
  const leftPx = startX + (endX - startX) * p;
  car.style.left = leftPx + "px";
  $(role + "-correct").textContent = player.correct || 0;

  // Smoke puff for the KIDS car whenever it moves forward. 💨
  if (role === "kids" && p > lastProgress.kids) {
    spawnSmoke(track, leftPx);
  }
  lastProgress[role] = p;
}

// Drop a quick smoke puff behind a car at the given left position.
function spawnSmoke(track, leftPx) {
  const puff = document.createElement("div");
  puff.className = "smoke";
  puff.textContent = "💨";
  puff.style.left = Math.max(0, leftPx - 6) + "px";
  track.appendChild(puff);
  setTimeout(() => puff.remove(), 900);
}


/* =================================================================
   7. RACE — START, QUESTIONS, ANSWERS
   ================================================================= */
function startRace() {
  showScreen("screen-race");

  // Parent role gets neutral feedback; Kids get cheering. Hide/adjust label.
  $("your-turn-label").textContent =
    state.role === "kids" ? "Your question, Azka!" : "Your question";

  nextQuestion();
}

// Generate and render a new multiple-choice question for this player's role.
function nextQuestion() {
  if (state.gameOver) return;

  const max = RANGE[state.role];
  const a = rand(1, max);
  const b = rand(1, max);
  const answer = a * b;
  state.currentAnswer = answer;

  $("question-text").textContent = `${a} × ${b} = ?`;

  // Build 4 options: the correct answer + 3 unique distractors.
  const options = new Set([answer]);
  while (options.size < 4) {
    // Distractors near the real answer so choices feel plausible.
    const delta = rand(1, Math.max(3, Math.round(answer * 0.3)));
    const candidate = Math.random() < 0.5 ? answer + delta : answer - delta;
    if (candidate > 0 && candidate !== answer) options.add(candidate);
  }

  const shuffled = shuffle([...options]);
  const wrap = $("answer-options");
  wrap.innerHTML = "";
  shuffled.forEach(val => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = val;
    btn.addEventListener("click", () => handleAnswer(val, btn));
    wrap.appendChild(btn);
  });
}

// Handle a tapped answer.
function handleAnswer(value, btn) {
  if (state.gameOver) return;

  const isCorrect = value === state.currentAnswer;

  // Briefly lock buttons to prevent double taps.
  document.querySelectorAll(".answer-btn").forEach(b => (b.disabled = true));

  if (isCorrect) {
    state.correct += 1;
    state.progress = Math.min(state.progress + STEP[state.role], 1);
    pushProgress();
    giveFeedback(true);

    // Check for a win.
    if (state.progress >= 1) {
      claimWin();
      return;
    }
  } else {
    giveFeedback(false);
  }

  // Load next question shortly after feedback shows.
  setTimeout(nextQuestion, isCorrect ? 850 : 1000);
}

// Random int in [min, max].
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Fisher–Yates shuffle.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


/* =================================================================
   8. PROGRESS & WINNER
   ================================================================= */

// Push this player's progress to Firebase (syncs the other device).
function pushProgress() {
  if (!state.code) return;
  db.ref(`games/${state.code}/players/${state.role}`).update({
    correct: state.correct,
    progress: state.progress,
    finished: state.progress >= 1
  });
}

// Claim the win using a transaction so only the FIRST finisher wins.
function claimWin() {
  db.ref(`games/${state.code}/winner`).transaction(current => {
    if (current === null || current === undefined) return state.role;
    return; // already won by someone else — abort
  });
  db.ref(`games/${state.code}/status`).set("finished");
}


/* =================================================================
   9. FEEDBACK — TTS + POPUPS
   -----------------------------------------------------------------
   Kids: random spoken cheer + colored popup (green / blue-neutral).
   Parent: plain "Correct" / "Try again", NO speech, NO cheering.
   ================================================================= */
function giveFeedback(isCorrect) {
  const popup = $("feedback-popup");

  if (state.role === "kids") {
    const list = isCorrect ? CHEERS_CORRECT : CHEERS_WRONG;
    const msg = list[Math.floor(Math.random() * list.length)];
    speak(msg);
    showPopup(popup, msg, isCorrect ? "good" : "neutral");
  } else {
    // Parent — neutral, silent.
    showPopup(popup, isCorrect ? "Correct" : "Try again", isCorrect ? "good" : "neutral");
  }
}

function showPopup(popup, text, type) {
  popup.textContent = text;
  popup.className = "feedback-popup " + type;   // shows it (removes .hidden)
  // Re-trigger the entrance animation.
  popup.style.animation = "none";
  void popup.offsetWidth;
  popup.style.animation = "";
  clearTimeout(showPopup._t);
  showPopup._t = setTimeout(() => popup.classList.add("hidden"), 1600);
}

// --- Warm, friendly FEMALE voice selection ---------------------------------
// Voices load asynchronously in most browsers, so we cache the best match and
// refresh it when the list becomes available.
let preferredVoice = null;

function loadPreferredVoice() {
  if (!("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return;

  // Warm female English voices, in order of preference across platforms.
  const wishlist = [
    "Samantha", "Google UK English Female", "Microsoft Aria",
    "Microsoft Jenny", "Karen", "Victoria", "Moira", "Tessa",
    "Fiona", "Microsoft Zira", "Google US English"
  ];
  for (const name of wishlist) {
    const v = voices.find(v => v.name === name || v.name.includes(name));
    if (v) { preferredVoice = v; return; }
  }
  // Fallbacks: anything that looks female + English, else any English voice.
  preferredVoice =
    voices.find(v => /female|woman/i.test(v.name) && /^en/i.test(v.lang)) ||
    voices.find(v => /^en/i.test(v.lang)) ||
    voices[0] || null;
}

if ("speechSynthesis" in window) {
  loadPreferredVoice();
  window.speechSynthesis.onvoiceschanged = loadPreferredVoice;
}

// Browser Text-to-Speech (English). Kids only.
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // stop any queued speech
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = 0.95;  // a touch slower = warmer, friendlier
  u.pitch = 1.35; // higher pitch, cheerful and kind
  if (preferredVoice) u.voice = preferredVoice;
  window.speechSynthesis.speak(u);
}


/* =================================================================
   10. GAME OVER & PLAY AGAIN
   ================================================================= */
function endGame(winnerRole) {
  state.gameOver = true;

  const iWon = winnerRole === state.role;
  $("over-emoji").textContent = iWon ? "🏆" : "🎉";

  const winnerName = winnerRole === "kids" ? "Kids" : "Parent";
  $("winner-text").textContent = `${winnerName} win${winnerRole === "kids" ? "" : "s"}!`;

  // Kids get a personalized spoken celebration if they won.
  if (state.role === "kids" && iWon) {
    const msg = `You did it, ${CHILD_NAME}! You won the race! Amazing!`;
    $("over-sub").textContent = msg;
    speak(msg);
  } else if (state.role === "kids" && !iWon) {
    const msg = `Great racing, ${CHILD_NAME}! So close — let's play again!`;
    $("over-sub").textContent = msg;
    speak(msg);
  } else {
    $("over-sub").textContent = iWon ? "You reached the finish line first!" : "Better luck next race!";
  }

  showScreen("screen-over");
}

// Play again — reset this game's state in Firebase and locally.
$("btn-play-again").addEventListener("click", async () => {
  if (state.code) {
    // Reset both player nodes + status/winner, keep the same pairing.
    await db.ref("games/" + state.code).update({
      status: "playing",
      winner: null,
      "players/kids/correct": 0,
      "players/kids/progress": 0,
      "players/kids/finished": false,
      "players/parent/correct": 0,
      "players/parent/progress": 0,
      "players/parent/finished": false
    });
  }
  state.correct = 0;
  state.progress = 0;
  state.gameOver = false;
  startRace();
});


/* =================================================================
   11. COLOR THEME TOGGLE — Pastel ⇄ Colorful
   ================================================================= */
const themeToggle = $("theme-toggle");

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "colorful" ? "🎨 Colorful" : "🎨 Pastel";
  try { localStorage.setItem("mpz-theme", theme); } catch (e) {}
}

// Restore the saved choice (default: pastel).
applyTheme((() => { try { return localStorage.getItem("mpz-theme"); } catch (e) { return null; } })() || "pastel");

themeToggle.addEventListener("click", () => {
  const next = document.body.getAttribute("data-theme") === "colorful" ? "pastel" : "colorful";
  applyTheme(next);
});
