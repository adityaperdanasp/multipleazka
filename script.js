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
// Parent's car moves at 0.25× the Kids' car speed.
// Kids: 10 correct → finish.   Parent: 40 correct → finish.
const STEP = {
  kids: 1 / 10,   // 0.100
  parent: 1 / 40  // 0.025  (0.25× of Kids' step)
};

// Seconds allowed per question when the Timer is On.
const QUESTION_TIME = 10;

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
  role: null,         // 'kids' | 'parent' — the role this device plays
  code: null,         // pairing code for the game
  correct: 0,         // correct answers by this player
  progress: 0,        // 0..1 track position for this player
  currentAnswer: 0,   // correct value for the on-screen question
  answerMode: "choice", // 'choice' (multiple choice) | 'type' (keypad)
  answerLocked: false,  // guards against double-submits between questions
  timerOn: true,        // per-question 10s countdown on/off
  gameOver: false,
  listening: false    // whether a Firebase listener is attached
};

// The digits typed so far in "type-it-in" mode.
let typedValue = "";

// Per-question timer + total race time (for scoreboard best time).
let timerId = null;
let timerRemaining = 0;
let raceStartTime = 0;

// A pairing code carried in the URL (?join=CODE) from a scanned QR code.
const pendingJoinCode = new URLSearchParams(location.search).get("join")?.toUpperCase() || null;


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
      state.role === "kids" ? "Kids 👦" : "Parent 🧑";
    resetPairUI();

    // Arrived here via a scanned QR join link — prefill the code for them.
    if (pendingJoinCode) {
      $("join-code-input").value = pendingJoinCode;
    }

    showScreen("screen-pair");
  });
});

// Back buttons
document.querySelectorAll(".back-btn").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

// Answer-style segmented control (multiple choice vs type-in). Per player.
document.querySelectorAll("#answer-seg .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.answerMode = btn.dataset.mode;           // 'choice' or 'type'
    document.querySelectorAll("#answer-seg .seg-btn")
      .forEach(b => b.classList.toggle("active", b === btn));
  });
});

// Timer on/off segmented control. Per player.
document.querySelectorAll("#timer-seg .seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.timerOn = btn.dataset.timer === "on";
    document.querySelectorAll("#timer-seg .seg-btn")
      .forEach(b => b.classList.toggle("active", b === btn));
  });
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
  renderJoinQR(code);

  attachGameListener(code);
});

// Render a scannable QR code that deep-links straight to this game's code.
function renderJoinQR(code) {
  const box = $("qr-code");
  box.innerHTML = ""; // clear any QR from a previous game
  if (typeof QRCode === "undefined") return; // library failed to load — code still works manually
  const joinUrl = `${location.origin}${location.pathname}?join=${code}`;
  new QRCode(box, {
    text: joinUrl,
    width: 150,
    height: 150,
    colorDark: "#16233a",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });
}

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
  state.answerLocked = false;
  raceStartTime = Date.now();   // for the scoreboard "best time"

  // Parent role gets neutral feedback; Kids get cheering. Hide/adjust label.
  $("your-turn-label").textContent =
    state.role === "kids" ? "Your question, Azka!" : "Your question";

  nextQuestion();
}

// Generate a new question, then render the answer UI for the chosen mode.
function nextQuestion() {
  if (state.gameOver) return;
  state.answerLocked = false;

  const max = RANGE[state.role];
  const a = rand(1, max);
  const b = rand(1, max);
  state.currentAnswer = a * b;

  $("question-text").textContent = `${a} × ${b} = ?`;

  if (state.answerMode === "type") renderKeypad();
  else renderChoices();

  startQuestionTimer();   // (no-op if Timer is Off)
}

/* --- Per-question countdown (10s; timeout counts as WRONG) ----------------- */
function startQuestionTimer() {
  clearQuestionTimer();
  const wrap = $("timer-wrap");
  if (!state.timerOn) { wrap.classList.add("hidden"); return; }

  wrap.classList.remove("hidden");
  timerRemaining = QUESTION_TIME;
  updateTimerUI();
  timerId = setInterval(() => {
    timerRemaining -= 0.1;
    if (timerRemaining <= 0) {
      clearQuestionTimer();
      // Time's up → treat as a wrong answer.
      handleAnswer(null);
    } else {
      updateTimerUI();
    }
  }, 100);
}

function updateTimerUI() {
  const pct = Math.max(0, timerRemaining / QUESTION_TIME) * 100;
  const fill = $("timer-fill");
  const txt = $("timer-text");
  const low = timerRemaining < 4;   // <4s → red/urgent
  if (fill) { fill.style.width = pct + "%"; fill.classList.toggle("low", low); }
  if (txt) { txt.textContent = Math.max(0, Math.ceil(timerRemaining)) + "s"; txt.classList.toggle("low", low); }
}

function clearQuestionTimer() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

// --- Multiple choice: 4 tappable options (correct + 3 distractors) ----------
function renderChoices() {
  const answer = state.currentAnswer;
  const options = new Set([answer]);
  while (options.size < 4) {
    const delta = rand(1, Math.max(3, Math.round(answer * 0.3)));
    const candidate = Math.random() < 0.5 ? answer + delta : answer - delta;
    if (candidate > 0 && candidate !== answer) options.add(candidate);
  }

  const grid = document.createElement("div");
  grid.className = "choices-grid";
  shuffle([...options]).forEach(val => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = val;
    btn.addEventListener("click", () => handleAnswer(val));
    grid.appendChild(btn);
  });

  const wrap = $("answer-options");
  wrap.innerHTML = "";
  wrap.appendChild(grid);
}

// --- Type it in: calculator display + keypad --------------------------------
function renderKeypad() {
  typedValue = "";
  const wrap = $("answer-options");
  wrap.innerHTML =
    '<div class="keypad-display" id="keypad-display"></div>' +
    '<div class="keypad" id="keypad"></div>';

  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "back", "0", "enter"];
  const pad = $("keypad");
  keys.forEach(k => {
    const btn = document.createElement("button");
    if (k === "back") { btn.className = "key back"; btn.textContent = "⌫"; btn.setAttribute("aria-label", "Delete"); }
    else if (k === "enter") { btn.className = "key ent"; btn.textContent = "✓"; btn.setAttribute("aria-label", "Submit"); }
    else { btn.className = "key"; btn.textContent = k; }
    btn.addEventListener("click", () => typeKey(k));
    pad.appendChild(btn);
  });
  updateKeypadDisplay();
}

// Handle a keypad tap OR a physical keyboard key in type-in mode.
function typeKey(k) {
  if (state.gameOver || state.answerLocked) return;
  if (k === "back") { typedValue = typedValue.slice(0, -1); updateKeypadDisplay(); return; }
  if (k === "enter") { if (typedValue !== "") handleAnswer(Number(typedValue)); return; }
  if (typedValue.length < 4) { typedValue += k; updateKeypadDisplay(); }
}

// Redraw the number typed so far (with a blinking cursor).
function updateKeypadDisplay() {
  const d = $("keypad-display");
  if (!d) return;
  const shown = typedValue === "" ? '<span class="kd-placeholder">?</span>' : typedValue;
  d.innerHTML = shown + '<span class="kd-cursor"></span>';
}

// Physical keyboard support (laptops) — only during a race in type-in mode.
document.addEventListener("keydown", e => {
  if (state.answerMode !== "type") return;
  if (!$("screen-race").classList.contains("active")) return;
  if (e.key >= "0" && e.key <= "9") typeKey(e.key);
  else if (e.key === "Backspace") { e.preventDefault(); typeKey("back"); }
  else if (e.key === "Enter") typeKey("enter");
});

// --- Shared answer handling for BOTH modes ----------------------------------
function handleAnswer(value) {
  if (state.gameOver || state.answerLocked) return;
  state.answerLocked = true;
  clearQuestionTimer();   // stop the countdown for this question

  // value === null means the timer ran out → always wrong.
  const isCorrect = value !== null && Number(value) === state.currentAnswer;

  // Lock every input to prevent double-submits between questions.
  document.querySelectorAll(".answer-btn, .key").forEach(b => (b.disabled = true));

  if (isCorrect) {
    state.correct += 1;
    state.progress = Math.min(state.progress + STEP[state.role], 1);
    pushProgress();
    giveFeedback(true);

    if (state.progress >= 1) { claimWin(); return; }
    setTimeout(nextQuestion, 850);   // answerLocked is reset inside nextQuestion
  } else {
    giveFeedback(false);
    if (state.answerMode === "type") {
      // Type-in: keep the SAME question so the player can try again.
      setTimeout(() => {
        state.answerLocked = false;
        typedValue = "";
        document.querySelectorAll(".key").forEach(b => (b.disabled = false));
        updateKeypadDisplay();
        startQuestionTimer();   // fresh 10s for the retry
      }, 1000);
    } else {
      setTimeout(nextQuestion, 1000); // multiple choice: fresh question
    }
  }
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
  clearQuestionTimer();

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
  updateScoreboardUI(winnerRole);   // record + render the family scoreboard
}

/* =================================================================
   10b. FAMILY SCOREBOARD — persisted at Firebase /scoreboard
   ================================================================= */
async function updateScoreboardUI(winnerRole) {
  const box = $("scoreboard");
  box.innerHTML = '<div class="sb-empty">Loading scoreboard…</div>';

  const iWon = winnerRole === state.role;
  const elapsed = raceStartTime ? Math.round((Date.now() - raceStartTime) / 1000) : 0;

  let sb = null;
  try {
    if (iWon) {
      sb = await recordWin(winnerRole, elapsed);   // only the winner writes
    } else {
      await new Promise(r => setTimeout(r, 700));   // let the winner write first
      const snap = await db.ref("scoreboard").get();
      sb = snap.val();
    }
  } catch (e) {
    box.innerHTML = '<div class="sb-title">🏆 Scoreboard</div>' +
      '<div class="sb-empty">Add a Firebase rule for /scoreboard to enable this.</div>';
    return;
  }
  renderScoreboard(sb);
}

// Read-modify-write the scoreboard (only the winner calls this).
async function recordWin(winnerRole, timeSec) {
  const ref = db.ref("scoreboard");
  const snap = await ref.get();
  const sb = snap.val() || {};

  sb.wins = sb.wins || { kids: 0, parent: 0 };
  sb.wins[winnerRole] = (sb.wins[winnerRole] || 0) + 1;

  sb.bestTime = sb.bestTime || {};
  if (timeSec > 0 && (!sb.bestTime[winnerRole] || timeSec < sb.bestTime[winnerRole])) {
    sb.bestTime[winnerRole] = timeSec;
  }

  sb.streak = (sb.streak && sb.streak.role === winnerRole)
    ? { role: winnerRole, count: (sb.streak.count || 0) + 1 }
    : { role: winnerRole, count: 1 };

  sb.totalRaces = (sb.totalRaces || 0) + 1;

  const recent = Array.isArray(sb.recent) ? sb.recent
               : (sb.recent ? Object.values(sb.recent) : []);
  recent.push({ winner: winnerRole, time: timeSec, at: Date.now() });
  sb.recent = recent.slice(-5);   // keep the last 5

  await ref.set(sb);
  return sb;
}

function fmtTime(sec) {
  if (!sec || sec < 0) return "—";
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}
function roleName(role) { return role === "kids" ? "Azka" : "Parent"; }
function roleEmoji(role) { return role === "kids" ? "👦" : "🧑"; }

function renderScoreboard(sb) {
  const box = $("scoreboard");
  if (!sb || !sb.wins) {
    box.innerHTML = '<div class="sb-title">🏆 Scoreboard</div>' +
      '<div class="sb-empty">First race recorded — play again to build the board!</div>';
    return;
  }
  const w = sb.wins || {};
  const bt = sb.bestTime || {};
  const streak = sb.streak || {};
  const recent = (Array.isArray(sb.recent) ? sb.recent : Object.values(sb.recent || {}))
    .slice().reverse();

  let html = '<div class="sb-title">🏆 Scoreboard</div>';
  html += '<div class="sb-vs">' +
    `<div class="p"><div class="em">👦</div><div class="big">${w.kids || 0}</div><div class="nm">Azka</div></div>` +
    '<div class="dash">—</div>' +
    `<div class="p"><div class="em">🧑</div><div class="big">${w.parent || 0}</div><div class="nm">Parent</div></div>` +
    '</div>';
  html += `<div class="sb-row"><span class="lab">⚡ Best time</span><span class="val">👦 ${fmtTime(bt.kids)} · 🧑 ${fmtTime(bt.parent)}</span></div>`;
  if (streak.role) {
    html += `<div class="sb-row"><span class="lab">🔥 Streak</span><span class="val">${roleEmoji(streak.role)} ${roleName(streak.role)} × ${streak.count}</span></div>`;
  }
  html += `<div class="sb-row"><span class="lab">🏁 Total races</span><span class="val">${sb.totalRaces || 0}</span></div>`;
  if (recent.length) {
    html += '<div class="sb-recent"><div class="rt">Recent races</div>';
    recent.forEach(r => {
      const color = r.winner === "kids" ? "#d2691e" : "#1266d8";
      html += `<div class="sb-rr"><span class="win" style="color:${color}">${roleEmoji(r.winner)} ${roleName(r.winner)} won</span><span>${fmtTime(r.time)}</span></div>`;
    });
    html += '</div>';
  }
  box.innerHTML = html;
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
  clearQuestionTimer();
  startRace();
});


/* =================================================================
   11. COLOR THEME TOGGLE — Pastel ⇄ Colorful
   ================================================================= */
const themeToggle = $("theme-toggle");

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  // Icon-only button; theme name lives in the tooltip for clarity.
  themeToggle.textContent = "🎨";
  themeToggle.title = theme === "colorful" ? "Colorful theme (tap for Pastel)"
                                            : "Pastel theme (tap for Colorful)";
  try { localStorage.setItem("mpz-theme", theme); } catch (e) {}
}

// Restore the saved choice (default: pastel).
applyTheme((() => { try { return localStorage.getItem("mpz-theme"); } catch (e) { return null; } })() || "pastel");

themeToggle.addEventListener("click", () => {
  const next = document.body.getAttribute("data-theme") === "colorful" ? "pastel" : "colorful";
  applyTheme(next);
});
