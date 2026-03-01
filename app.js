const STORAGE_KEY = "pokemon_heads_up_state_v1";
const MENU_MUSIC_SRC = "/dist/assets/menu.mp3";
const BASE_MOTION_TRIGGER_UP_DELTA = 12;
const BASE_MOTION_TRIGGER_DOWN_DELTA = 10;
const BASE_MOTION_NEUTRAL_DELTA = 6;
const MOTION_COOLDOWN_MS = 700;
const MOTION_SENSITIVITY_MIN = 0.5;
const MOTION_SENSITIVITY_MAX = 2.0;
const MOTION_SENSITIVITY_DEFAULT = 1.0;

const appState = {
  settings: {
    roundSeconds: 60,
    selectedGenerations: new Set([1, 2]),
    motionEnabled: true,
    motionSensitivity: MOTION_SENSITIVITY_DEFAULT,
    sfxEnabled: true,
    menuMusicEnabled: true
  },
  session: {
    leaderboard: []
  },
  round: {
    playerName: "",
    timeLeft: 60,
    score: 0,
    active: false,
    deck: [],
    pool: [],
    used: new Set(),
    currentPokemon: null
  },
  pokemonPool: [],
  pokemonTypeCache: new Map(),
  pokemonTypeRequestId: 0,
  sourceMessage: "",
  startTouchY: null,
  swipeLocked: false,
  timerId: null,
  countdownId: null,
  pendingPlayAgain: null,
  currentScreen: "setup",
  audio: {
    context: null,
    unlocked: false,
    menuTrack: null,
    menuRetryTimer: null,
    unlockHandler: null
  },
  motion: {
    supported: false,
    secureContext: false,
    permissionState: "unknown",
    listenerAttached: false,
    axisChoice: null,
    baselineTilt: null,
    neutralReady: true,
    lastTriggerAt: 0
  }
};

const dom = {
  screens: {
    setup: document.getElementById("setup-screen"),
    settings: document.getElementById("settings-screen"),
    countdown: document.getElementById("countdown-screen"),
    gameplay: document.getElementById("gameplay-screen"),
    result: document.getElementById("result-screen")
  },
  setupForm: document.getElementById("setup-form"),
  openSettingsButton: document.getElementById("open-settings"),
  closeSettingsButton: document.getElementById("close-settings"),
  playerName: document.getElementById("player-name"),
  roundSeconds: document.getElementById("round-seconds"),
  generationInputs: document.querySelectorAll("input[name='generation']"),
  motionEnabled: document.getElementById("motion-enabled"),
  motionSensitivity: document.getElementById("motion-sensitivity"),
  motionSensitivityValue: document.getElementById("motion-sensitivity-value"),
  motionTestReadout: document.getElementById("motion-test-readout"),
  sfxEnabled: document.getElementById("sfx-enabled"),
  menuMusicEnabled: document.getElementById("menu-music-enabled"),
  testSoundButton: document.getElementById("test-sound"),
  soundStatus: document.getElementById("sound-status"),
  enableMotion: document.getElementById("enable-motion"),
  motionStatus: document.getElementById("motion-status"),
  validationMessage: document.getElementById("validation-message"),
  sourceStatus: document.getElementById("pokemon-source-status"),
  pokemonErrorPanel: document.getElementById("pokemon-error"),
  retryLoad: document.getElementById("retry-load"),
  startRoundButton: document.getElementById("start-round"),
  clearSettingsButton: document.getElementById("clear-settings"),
  resetLeaderboard: document.getElementById("reset-leaderboard"),
  leaderboardList: document.getElementById("leaderboard-list"),
  leaderboardEmpty: document.getElementById("leaderboard-empty"),
  countdownValue: document.getElementById("countdown-value"),
  hudPlayer: document.getElementById("hud-player"),
  hudTime: document.getElementById("hud-time"),
  hudScore: document.getElementById("hud-score"),
  endRoundEarly: document.getElementById("end-round-early"),
  pokemonCard: document.getElementById("pokemon-card"),
  pokemonImage: document.getElementById("pokemon-image"),
  pokemonImageFallback: document.getElementById("pokemon-image-fallback"),
  pokemonName: document.getElementById("pokemon-name"),
  pokemonGeneration: document.getElementById("pokemon-generation"),
  pokemonTyping: document.getElementById("pokemon-typing"),
  hintUp: document.getElementById("hint-up"),
  hintDown: document.getElementById("hint-down"),
  resultPlayer: document.getElementById("result-player"),
  resultScore: document.getElementById("result-score"),
  nextPlayer: document.getElementById("next-player"),
  playAgain: document.getElementById("play-again"),
  orientationOverlay: document.getElementById("orientation-overlay")
};

function initApp() {
  loadPersistedState();
  applySettingsToInputs();
  updateMotionSensitivityLabel();
  updateMotionTestReadout();
  detectMotionSupport();
  attachEventHandlers();
  updateMotionStatusText();
  updateMotionTestReadout();
  updateGameplayHints();
  updateOrientationGuard();
  renderLeaderboard();
  restoreSavedView();
  void initializePokemonPool();
}

async function initializePokemonPool() {
  dom.sourceStatus.textContent = "Loading Pokemon list...";
  const pool = await loadPokemonPool();

  if (!pool.length) {
    dom.sourceStatus.textContent = "Pokemon list unavailable.";
    dom.pokemonErrorPanel.classList.remove("hidden");
    dom.startRoundButton.disabled = true;
    return;
  }

  appState.pokemonPool = pool;
  dom.sourceStatus.textContent = buildSourceStatusMessage();
  dom.pokemonErrorPanel.classList.add("hidden");
  dom.startRoundButton.disabled = false;
}

async function loadPokemonPool() {
  const apiPokemon = await fetchPokemonFromApi();
  if (apiPokemon.length) {
    appState.sourceMessage = `Online list loaded (${apiPokemon.length} Pokemon).`;
    return apiPokemon;
  }

  const fallback = buildFallbackPokemon(window.POKEMON_FALLBACK || []);
  if (fallback.length) {
    appState.sourceMessage = `Using offline list (${fallback.length} Pokemon).`;
    return fallback;
  }

  appState.sourceMessage = "Failed to load Pokemon list.";
  return [];
}

async function fetchPokemonFromApi() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://pokeapi.co/api/v2/pokemon?limit=2000", {
      signal: controller.signal
    });
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const entries = Array.isArray(data.results) ? data.results : [];
    return normalizePokemonEntries(entries);
  } catch (_error) {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizePokemonEntries(entries) {
  const seen = new Set();
  const normalized = [];

  entries.forEach((entry) => {
    if (!entry || typeof entry.name !== "string") {
      return;
    }
    const dexId = extractDexId(entry.url);
    const name = formatPokemonName(entry.name.trim());
    if (!name || seen.has(name)) {
      return;
    }

    seen.add(name);
    normalized.push({
      name,
      dexId,
      apiUrl: typeof entry.url === "string" ? entry.url : null,
      generationNumber: generationNumberFromDexId(dexId),
      generation: generationFromDexId(dexId),
      image: dexId ? artworkFromDexId(dexId) : null
    });
  });

  return normalized;
}

function buildFallbackPokemon(names) {
  const seen = new Set();
  return names
    .filter((name) => typeof name === "string" && name.trim())
    .map((name, index) => {
      const formatted = formatPokemonName(name.trim());
      if (!formatted || seen.has(formatted)) {
        return null;
      }
      seen.add(formatted);
      const dexId = index + 1;
      return {
        name: formatted,
        dexId,
        apiUrl: `https://pokeapi.co/api/v2/pokemon/${dexId}/`,
        generationNumber: generationNumberFromDexId(dexId),
        generation: generationFromDexId(dexId),
        image: artworkFromDexId(dexId)
      };
    })
    .filter(Boolean);
}

function formatPokemonName(name) {
  return name
    .replace(/-/g, " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractDexId(url) {
  if (typeof url !== "string") {
    return null;
  }
  const match = url.match(/\/pokemon\/(\d+)\/?$/);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function generationFromDexId(dexId) {
  const generationNumber = generationNumberFromDexId(dexId);
  return generationLabel(generationNumber);
}

function generationNumberFromDexId(dexId) {
  if (!Number.isInteger(dexId) || dexId <= 0) {
    return 0;
  }
  if (dexId <= 151) {
    return 1;
  }
  if (dexId <= 251) {
    return 2;
  }
  if (dexId <= 386) {
    return 3;
  }
  if (dexId <= 493) {
    return 4;
  }
  if (dexId <= 649) {
    return 5;
  }
  if (dexId <= 721) {
    return 6;
  }
  if (dexId <= 809) {
    return 7;
  }
  if (dexId <= 905) {
    return 8;
  }
  return 9;
}

function generationLabel(generationNumber) {
  const roman = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
    9: "IX"
  };
  return roman[generationNumber] ? `Generation ${roman[generationNumber]}` : "Generation Unknown";
}

function artworkFromDexId(dexId) {
  if (!Number.isInteger(dexId) || dexId <= 0) {
    return null;
  }
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexId}.png`;
}

function attachEventHandlers() {
  dom.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await primeAudio();
    const playerName = dom.playerName.value.trim();
    const roundSeconds = clampRoundSeconds(dom.roundSeconds.value);
    syncGenerationSelectionFromInputs();
    const filteredPool = getFilteredPokemonPool();

    dom.playerName.value = playerName;
    dom.roundSeconds.value = String(roundSeconds);
    appState.settings.roundSeconds = roundSeconds;
    persistGameState();

    if (!playerName) {
      dom.validationMessage.textContent = "Player name is required.";
      return;
    }
    if (!appState.pokemonPool.length) {
      dom.validationMessage.textContent = "Pokemon list not ready yet.";
      return;
    }
    if (!appState.settings.selectedGenerations.size) {
      dom.validationMessage.textContent = "Select at least one generation.";
      return;
    }
    if (!filteredPool.length) {
      dom.validationMessage.textContent = "No Pokemon available for selected generations.";
      return;
    }
    if (appState.settings.motionEnabled) {
      await ensureMotionAccess();
      updateGameplayHints();
    }

    dom.validationMessage.textContent = "";
    await startRound(playerName, roundSeconds, filteredPool);
  });

  dom.openSettingsButton.addEventListener("click", () => {
    renderScreen("settings");
    persistGameState();
  });

  dom.closeSettingsButton.addEventListener("click", () => {
    renderScreen("setup");
    persistGameState();
  });

  dom.roundSeconds.addEventListener("blur", () => {
    const clamped = clampRoundSeconds(dom.roundSeconds.value);
    dom.roundSeconds.value = String(clamped);
    appState.settings.roundSeconds = clamped;
    persistGameState();
  });

  dom.generationInputs.forEach((input) => {
    input.addEventListener("change", () => {
      syncGenerationSelectionFromInputs();
    });
  });

  dom.motionEnabled.addEventListener("change", () => {
    appState.settings.motionEnabled = dom.motionEnabled.checked;
    updateGameplayHints();
    updateMotionTestReadout();
    if (!appState.settings.motionEnabled) {
      appState.motion.neutralReady = true;
      appState.motion.baselineTilt = null;
      appState.motion.lastTriggerAt = 0;
    }
    updateMotionStatusText();
    persistGameState();
  });

  dom.motionSensitivity.addEventListener("input", () => {
    appState.settings.motionSensitivity = clampMotionSensitivity(dom.motionSensitivity.value);
    updateMotionSensitivityLabel();
    updateMotionTestReadout();
    persistGameState();
  });

  dom.motionSensitivity.addEventListener("change", () => {
    appState.settings.motionSensitivity = clampMotionSensitivity(dom.motionSensitivity.value);
    updateMotionSensitivityLabel();
    persistGameState();
  });

  dom.sfxEnabled.addEventListener("change", () => {
    appState.settings.sfxEnabled = dom.sfxEnabled.checked;
    persistGameState();
  });

  dom.menuMusicEnabled.addEventListener("change", async () => {
    await primeAudio();
    appState.settings.menuMusicEnabled = dom.menuMusicEnabled.checked;
    updateMenuMusicState();
    persistGameState();
  });

  dom.testSoundButton.addEventListener("click", async () => {
    dom.soundStatus.textContent = "Sound status: testing...";
    const unlocked = await primeAudio();
    if (!unlocked) {
      dom.soundStatus.textContent = "Sound status: blocked. Try turning off silent mode and tap again.";
      return;
    }

    const played = playTestSoundSequence(true);
    dom.soundStatus.textContent = played
      ? "Sound status: played ding + err."
      : "Sound status: audio context not running.";
  });

  dom.enableMotion.addEventListener("click", async () => {
    await primeAudio();
    await ensureMotionAccess();
    updateGameplayHints();
  });

  dom.clearSettingsButton.addEventListener("click", () => {
    const confirmed = window.confirm(
      "Clear settings and reset to defaults? This keeps your session leaderboard."
    );
    if (!confirmed) {
      return;
    }
    resetSettingsToDefaults();
  });

  dom.retryLoad.addEventListener("click", async () => {
    await initializePokemonPool();
  });

  dom.resetLeaderboard.addEventListener("click", () => {
    resetLeaderboard();
  });

  dom.nextPlayer.addEventListener("click", () => {
    appState.pendingPlayAgain = null;
    renderScreen("setup");
    dom.playerName.value = "";
    dom.playerName.focus();
    persistGameState();
  });

  dom.playAgain.addEventListener("click", async () => {
    await primeAudio();
    const replayName = appState.pendingPlayAgain;
    const filteredPool = getFilteredPokemonPool();
    if (!replayName) {
      renderScreen("setup");
      return;
    }
    if (!appState.settings.selectedGenerations.size) {
      dom.validationMessage.textContent = "Select at least one generation.";
      renderScreen("setup");
      return;
    }
    if (!filteredPool.length) {
      dom.validationMessage.textContent = "No Pokemon available for selected generations.";
      renderScreen("setup");
      return;
    }

    dom.validationMessage.textContent = "";
    await startRound(replayName, appState.settings.roundSeconds, filteredPool);
  });

  dom.endRoundEarly.addEventListener("click", () => {
    requestEarlyRoundEnd();
  });

  dom.playerName.addEventListener("input", () => {
    persistGameState();
  });

  dom.pokemonCard.addEventListener("touchstart", (event) => {
    if (!appState.round.active || event.touches.length === 0) {
      return;
    }
    appState.startTouchY = event.touches[0].clientY;
  });

  dom.pokemonCard.addEventListener("touchend", (event) => {
    if (!appState.round.active || appState.startTouchY === null || event.changedTouches.length === 0) {
      return;
    }

    const endY = event.changedTouches[0].clientY;
    const deltaY = endY - appState.startTouchY;
    appState.startTouchY = null;

    if (Math.abs(deltaY) < 40) {
      return;
    }

    handleSwipe(deltaY > 0 ? "down" : "up");
  });

  document.addEventListener("keydown", (event) => {
    if (!appState.round.active) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      handleSwipe("down");
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      handleSwipe("up");
    }
  });

  dom.pokemonImage.addEventListener("error", () => {
    dom.pokemonImage.classList.add("hidden");
    dom.pokemonImageFallback.classList.remove("hidden");
  });

  installAudioUnlockListeners();

  window.addEventListener("resize", updateOrientationGuard);
  window.addEventListener("orientationchange", updateOrientationGuard);
}

function clampRoundSeconds(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) {
    return 60;
  }
  return Math.min(300, Math.max(15, parsed));
}

function clampMotionSensitivity(rawValue) {
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) {
    return MOTION_SENSITIVITY_DEFAULT;
  }
  return Math.min(MOTION_SENSITIVITY_MAX, Math.max(MOTION_SENSITIVITY_MIN, parsed));
}

function getMotionThresholds() {
  const sensitivity = clampMotionSensitivity(appState.settings.motionSensitivity);
  return {
    up: BASE_MOTION_TRIGGER_UP_DELTA / sensitivity,
    down: BASE_MOTION_TRIGGER_DOWN_DELTA / sensitivity,
    neutral: BASE_MOTION_NEUTRAL_DELTA / sensitivity
  };
}

function updateMotionSensitivityLabel() {
  const sensitivity = clampMotionSensitivity(appState.settings.motionSensitivity);
  appState.settings.motionSensitivity = sensitivity;
  dom.motionSensitivity.value = sensitivity.toFixed(1);
  dom.motionSensitivityValue.textContent = `Sensitivity: ${sensitivity.toFixed(1)}x`;
}

function updateMotionTestReadout(reading = null) {
  if (!dom.motionTestReadout) {
    return;
  }

  const thresholds = reading?.thresholds || getMotionThresholds();
  if (!appState.settings.motionEnabled) {
    dom.motionTestReadout.textContent = "Motion test: disabled.";
    return;
  }
  if (appState.motion.permissionState !== "granted") {
    dom.motionTestReadout.textContent = "Motion test: enable motion access first.";
    return;
  }
  if (!reading || typeof reading.tilt !== "number" || typeof reading.delta !== "number") {
    dom.motionTestReadout.textContent =
      `Motion test: waiting for tilt... (up <= -${thresholds.up.toFixed(1)}°, ` +
      `down >= ${thresholds.down.toFixed(1)}°)`;
    return;
  }

  const action = reading.action || "neutral";
  dom.motionTestReadout.textContent =
    `Motion test: tilt ${reading.tilt.toFixed(1)}°, delta ${reading.delta.toFixed(1)}° (${action}). ` +
    `up<=-${thresholds.up.toFixed(1)}° down>=${thresholds.down.toFixed(1)}°`;
}

function getAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!appState.audio.context) {
    appState.audio.context = new AudioContextClass();
  }
  return appState.audio.context;
}

async function primeAudio() {
  const audioContext = getAudioContext();
  if (!audioContext) {
    return false;
  }
  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (_error) {
      // Keep game playable even if audio cannot be resumed.
    }
  }
  if (audioContext.state === "suspended") {
    // iOS can require a second attempt in some gesture chains.
    try {
      await audioContext.resume();
    } catch (_error) {
      // no-op
    }
  }
  if (audioContext.state === "running") {
    playUnlockPulse(audioContext);
  }
  appState.audio.unlocked = audioContext.state === "running";
  if (appState.audio.unlocked) {
    removeAudioUnlockListeners();
  }
  return appState.audio.unlocked;
}

function playUnlockPulse(audioContext) {
  const startAt = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(220, startAt);
  gainNode.gain.setValueAtTime(0.00001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(0.00002, startAt + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.00001, startAt + 0.02);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.025);
}

function installAudioUnlockListeners() {
  if (appState.audio.unlockHandler) {
    return;
  }

  appState.audio.unlockHandler = async () => {
    await primeAudio();
    updateMenuMusicState();
  };

  window.addEventListener("touchstart", appState.audio.unlockHandler, { passive: true });
  window.addEventListener("pointerdown", appState.audio.unlockHandler);
  window.addEventListener("click", appState.audio.unlockHandler);
  window.addEventListener("keydown", appState.audio.unlockHandler);
}

function removeAudioUnlockListeners() {
  if (!appState.audio.unlockHandler) {
    return;
  }

  window.removeEventListener("touchstart", appState.audio.unlockHandler);
  window.removeEventListener("pointerdown", appState.audio.unlockHandler);
  window.removeEventListener("click", appState.audio.unlockHandler);
  window.removeEventListener("keydown", appState.audio.unlockHandler);
  appState.audio.unlockHandler = null;
}

function playCorrectSound(force = false) {
  if (!force && !appState.settings.sfxEnabled) {
    return false;
  }
  return playToneSequence([
    { freq: 880, type: "triangle", gain: 0.4, offset: 0, duration: 0.18 },
    { freq: 1175, type: "sine", gain: 0.34, offset: 0.1, duration: 0.2 }
  ]);
}

function playSkipSound(force = false) {
  if (!force && !appState.settings.sfxEnabled) {
    return false;
  }
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return false;
  }

  const startAt = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(300, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(160, startAt + 0.18);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(0.45, startAt + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.28);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.3);
  return true;
}

function playToneSequence(sequence) {
  const audioContext = getAudioContext();
  if (!audioContext || audioContext.state !== "running") {
    return false;
  }

  const startAt = audioContext.currentTime;
  sequence.forEach((tone) => {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const toneStart = startAt + tone.offset;
    const toneEnd = toneStart + tone.duration;

    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.freq, toneStart);
    gainNode.gain.setValueAtTime(0.0001, toneStart);
    gainNode.gain.exponentialRampToValueAtTime(tone.gain, toneStart + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneEnd + 0.02);
  });
  return true;
}

function getMenuTrack() {
  if (appState.audio.menuTrack) {
    return appState.audio.menuTrack;
  }

  const track = new Audio(MENU_MUSIC_SRC);
  track.loop = true;
  track.autoplay = true;
  track.preload = "auto";
  track.volume = 0.4;
  track.playsInline = true;
  track.setAttribute("playsinline", "true");
  track.setAttribute("webkit-playsinline", "true");
  appState.audio.menuTrack = track;
  return track;
}

function startMenuMusicRetryLoop() {
  if (appState.audio.menuRetryTimer) {
    return;
  }
  appState.audio.menuRetryTimer = window.setInterval(() => {
    if (!appState.settings.menuMusicEnabled || !isMenuScreen(appState.currentScreen)) {
      stopMenuMusicRetryLoop();
      return;
    }
    const track = getMenuTrack();
    if (!track.paused) {
      stopMenuMusicRetryLoop();
      return;
    }
    const playPromise = track.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Keep retrying; browser may eventually allow playback.
      });
    }
  }, 1200);
}

function stopMenuMusicRetryLoop() {
  if (!appState.audio.menuRetryTimer) {
    return;
  }
  clearInterval(appState.audio.menuRetryTimer);
  appState.audio.menuRetryTimer = null;
}

function startMenuMusic() {
  if (!appState.settings.menuMusicEnabled || !isMenuScreen(appState.currentScreen)) {
    stopMenuMusicRetryLoop();
    return;
  }

  const track = getMenuTrack();
  if (!track.paused) {
    stopMenuMusicRetryLoop();
    return;
  }

  const playPromise = track.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Playback can be blocked until user gesture on Safari/iOS.
      startMenuMusicRetryLoop();
    });
  }
}

function stopMenuMusic() {
  stopMenuMusicRetryLoop();
  const track = appState.audio.menuTrack;
  if (!track) {
    return;
  }
  track.pause();
  track.currentTime = 0;
}

function updateMenuMusicState() {
  if (appState.settings.menuMusicEnabled && isMenuScreen(appState.currentScreen)) {
    startMenuMusic();
    return;
  }
  stopMenuMusic();
}

function isMenuScreen(screen) {
  return screen === "setup" || screen === "settings";
}

function playTestSoundSequence(force = false) {
  const playedFirst = playCorrectSound(force);
  window.setTimeout(() => {
    playSkipSound(force);
  }, 450);
  return playedFirst;
}

function detectMotionSupport() {
  appState.motion.secureContext = Boolean(window.isSecureContext);
  if (!appState.motion.secureContext) {
    appState.motion.permissionState = "insecure";
    return;
  }

  appState.motion.supported = typeof window.DeviceOrientationEvent !== "undefined";
  if (!appState.motion.supported) {
    appState.motion.permissionState = "unsupported";
  } else if (
    typeof window.DeviceOrientationEvent.requestPermission === "function" &&
    appState.motion.permissionState === "unknown"
  ) {
    appState.motion.permissionState = "not-requested";
    // Attach early so we can detect previously granted permissions after refresh.
    attachMotionListener();
  } else if (appState.motion.permissionState === "unknown") {
    appState.motion.permissionState = "granted";
    attachMotionListener();
  }
}

async function ensureMotionAccess() {
  if (!appState.motion.secureContext) {
    appState.motion.permissionState = "insecure";
    updateMotionStatusText();
    updateMotionTestReadout();
    return false;
  }

  if (!appState.motion.supported) {
    appState.motion.permissionState = "unsupported";
    updateMotionStatusText();
    updateMotionTestReadout();
    return false;
  }

  if (!appState.settings.motionEnabled) {
    updateMotionStatusText();
    updateMotionTestReadout();
    return false;
  }

  if (typeof window.DeviceOrientationEvent.requestPermission === "function") {
    try {
      const result = await window.DeviceOrientationEvent.requestPermission();
      if (result === "granted") {
        appState.motion.permissionState = "granted";
        attachMotionListener();
      } else {
        appState.motion.permissionState = "denied";
      }
    } catch (_error) {
      appState.motion.permissionState = "denied";
    }
  } else {
    appState.motion.permissionState = "granted";
    attachMotionListener();
  }

  updateMotionStatusText();
  updateMotionTestReadout();
  persistGameState();
  return appState.motion.permissionState === "granted";
}

function attachMotionListener() {
  if (appState.motion.listenerAttached) {
    return;
  }
  window.addEventListener("deviceorientation", onDeviceOrientation, { passive: true });
  appState.motion.listenerAttached = true;
}

function onDeviceOrientation(event) {
  if (!appState.settings.motionEnabled) {
    updateMotionTestReadout();
    return;
  }
  if (!dom.orientationOverlay.classList.contains("hidden")) {
    dom.motionTestReadout.textContent = "Motion test: rotate back to portrait to test tilt.";
    return;
  }
  if (appState.motion.permissionState !== "granted") {
    const hasTilt = typeof event.beta === "number";
    if (!hasTilt) {
      updateMotionTestReadout();
      return;
    }
    appState.motion.permissionState = "granted";
    updateMotionStatusText();
    updateGameplayHints();
  }
  const tilt = getNormalizedTilt(event);
  if (typeof tilt !== "number") {
    updateMotionTestReadout();
    return;
  }

  if (typeof appState.motion.baselineTilt !== "number") {
    appState.motion.baselineTilt = tilt;
  }

  const thresholds = getMotionThresholds();
  const delta = tilt - appState.motion.baselineTilt;
  if (Math.abs(delta) <= thresholds.neutral) {
    appState.motion.baselineTilt = appState.motion.baselineTilt * 0.7 + tilt * 0.3;
    appState.motion.neutralReady = true;
    updateMotionTestReadout({ tilt, delta, thresholds, action: "neutral" });
    return;
  }

  if (!appState.motion.neutralReady) {
    const holdAction = delta > 0 ? "hold-down" : "hold-up";
    updateMotionTestReadout({ tilt, delta, thresholds, action: holdAction });
    return;
  }

  const now = Date.now();
  if (now - appState.motion.lastTriggerAt < MOTION_COOLDOWN_MS) {
    updateMotionTestReadout({ tilt, delta, thresholds, action: "cooldown" });
    return;
  }

  if (delta >= thresholds.down) {
    appState.motion.lastTriggerAt = now;
    appState.motion.neutralReady = false;
    if (appState.round.active) {
      handleSwipe("down");
    }
    updateMotionTestReadout({ tilt, delta, thresholds, action: "correct" });
    return;
  }

  if (delta <= -thresholds.up) {
    appState.motion.lastTriggerAt = now;
    appState.motion.neutralReady = false;
    if (appState.round.active) {
      handleSwipe("up");
    }
    updateMotionTestReadout({ tilt, delta, thresholds, action: "pass" });
    return;
  }

  const leaningAction = delta > 0 ? "lean-down" : "lean-up";
  updateMotionTestReadout({ tilt, delta, thresholds, action: leaningAction });
}

function getNormalizedTilt(event) {
  const betaValue = typeof event.beta === "number" ? event.beta : null;
  if (betaValue === null) {
    return null;
  }

  appState.motion.axisChoice = "beta";
  return betaValue;
}

function updateMotionStatusText() {
  let text = "Motion status: ";
  if (appState.motion.permissionState === "insecure") {
    text += "blocked on HTTP. Open over HTTPS to use motion.";
  } else if (appState.motion.permissionState === "unsupported") {
    text += "not supported on this device/browser.";
  } else if (!appState.settings.motionEnabled) {
    text += "disabled (swipe controls only).";
  } else if (appState.motion.permissionState === "granted") {
    const axis = appState.motion.axisChoice ? ` (${appState.motion.axisChoice} axis)` : "";
    text += `ready${axis}.`;
  } else if (appState.motion.permissionState === "denied") {
    text += "blocked. Enable sensor access in browser settings.";
  } else if (appState.motion.permissionState === "not-requested") {
    text += "tap 'Enable Motion Access' before playing.";
  } else {
    text += "pending.";
  }
  dom.motionStatus.textContent = text;
}

function updateGameplayHints() {
  const useMotion = appState.settings.motionEnabled && appState.motion.permissionState === "granted";
  if (useMotion) {
    dom.hintUp.textContent = "Tilt up: Pass";
    dom.hintDown.textContent = "Tilt down: Correct (+1)";
    return;
  }
  dom.hintUp.textContent = "Swipe up: Pass";
  dom.hintDown.textContent = "Swipe down: Correct (+1)";
}

function syncGenerationSelectionFromInputs() {
  const selected = new Set();
  dom.generationInputs.forEach((input) => {
    if (input.checked) {
      selected.add(Number.parseInt(input.value, 10));
    }
  });
  appState.settings.selectedGenerations = selected;
  if (appState.pokemonPool.length) {
    dom.sourceStatus.textContent = buildSourceStatusMessage();
  }
  persistGameState();
}

function getFilteredPokemonPool() {
  return appState.pokemonPool.filter((pokemon) =>
    appState.settings.selectedGenerations.has(pokemon.generationNumber)
  );
}

async function startRound(playerName, roundSeconds, filteredPool) {
  clearRoundTimers();
  await requestPortraitLock();

  appState.round.playerName = playerName;
  appState.round.timeLeft = roundSeconds;
  appState.round.score = 0;
  appState.round.active = false;
  appState.round.pool = filteredPool;
  appState.round.used = new Set();
  appState.round.deck = [];
  appState.round.currentPokemon = null;
  appState.swipeLocked = false;
  appState.motion.axisChoice = null;
  appState.motion.baselineTilt = null;
  appState.motion.neutralReady = true;
  appState.motion.lastTriggerAt = 0;

  dom.hudPlayer.textContent = playerName;
  dom.hudTime.textContent = String(roundSeconds);
  dom.hudScore.textContent = "0";
  dom.endRoundEarly.disabled = true;
  renderPokemonCard({ name: "Get Ready", generation: "Generation -" });

  renderScreen("countdown");
  persistGameState();
  await startCountdown(5);
  beginGameplay();
}

function startCountdown(seconds) {
  return new Promise((resolve) => {
    clearInterval(appState.countdownId);
    let value = seconds;
    dom.countdownValue.textContent = String(value);

    appState.countdownId = setInterval(() => {
      value -= 1;
      if (value > 0) {
        dom.countdownValue.textContent = String(value);
        return;
      }

      clearInterval(appState.countdownId);
      appState.countdownId = null;
      dom.countdownValue.textContent = "GO";
      setTimeout(resolve, 450);
    }, 1000);
  });
}

function beginGameplay() {
  appState.round.active = true;
  appState.motion.baselineTilt = null;
  appState.motion.neutralReady = true;
  appState.motion.lastTriggerAt = 0;
  renderScreen("gameplay");
  dom.endRoundEarly.disabled = false;
  nextPokemon();
  dom.pokemonCard.focus();
  startGameplayTimer();
}

function startGameplayTimer() {
  clearInterval(appState.timerId);
  appState.timerId = setInterval(() => {
    appState.round.timeLeft -= 1;
    if (appState.round.timeLeft <= 0) {
      appState.round.timeLeft = 0;
      dom.hudTime.textContent = "0";
      persistGameState();
      endRound();
      return;
    }

    dom.hudTime.textContent = String(appState.round.timeLeft);
    persistGameState();
  }, 1000);
}

function handleSwipe(direction) {
  if (!appState.round.active || appState.swipeLocked) {
    return;
  }

  appState.swipeLocked = true;
  if (direction === "down") {
    appState.round.score += 1;
    dom.hudScore.textContent = String(appState.round.score);
    playCorrectSound();
  } else {
    playSkipSound();
  }

  nextPokemon();
  persistGameState();
  setTimeout(() => {
    appState.swipeLocked = false;
  }, 100);
}

function nextPokemon() {
  const roundPool = appState.round.pool;
  if (!appState.round.deck.length) {
    if (appState.round.used.size >= roundPool.length) {
      appState.round.used.clear();
    }

    const available = roundPool.filter((pokemon) => !appState.round.used.has(pokemon.name));
    appState.round.deck = shuffle([...available]);
  }

  const next = appState.round.deck.pop();
  if (!next) {
    renderPokemonCard({ name: "No Pokemon Available", generation: "Generation -" });
    return;
  }

  appState.round.currentPokemon = next;
  appState.round.used.add(next.name);
  renderPokemonCard(next);
  void updatePokemonTyping(next);
}

function endRound() {
  if (!appState.round.active) {
    return;
  }

  appState.round.active = false;
  dom.endRoundEarly.disabled = true;
  clearRoundTimers();
  updateLeaderboard({
    playerName: appState.round.playerName,
    score: appState.round.score,
    playedAt: Date.now()
  });

  appState.pendingPlayAgain = appState.round.playerName;
  dom.resultPlayer.textContent = appState.round.playerName;
  dom.resultScore.textContent = String(appState.round.score);
  renderScreen("result");
  persistGameState();
}

function requestEarlyRoundEnd() {
  if (!appState.round.active) {
    return;
  }
  const confirmed = window.confirm(
    `End round early?\nCurrent score: ${appState.round.score} point${appState.round.score === 1 ? "" : "s"}.`
  );
  if (!confirmed) {
    return;
  }
  endRound();
}

function updateLeaderboard(entry) {
  appState.session.leaderboard.push(entry);
  renderLeaderboard();
  persistGameState();
}

function resetLeaderboard() {
  appState.session.leaderboard = [];
  renderLeaderboard();
  persistGameState();
}

function deleteLeaderboardEntry(entryToDelete) {
  if (!entryToDelete) {
    return;
  }

  const confirmed = window.confirm(
    `Delete ${entryToDelete.playerName} (${entryToDelete.score} pts) from leaderboard?`
  );
  if (!confirmed) {
    return;
  }

  let index = appState.session.leaderboard.indexOf(entryToDelete);
  if (index === -1) {
    index = appState.session.leaderboard.findIndex(
      (entry) =>
        entry.playerName === entryToDelete.playerName &&
        entry.score === entryToDelete.score &&
        entry.playedAt === entryToDelete.playedAt
    );
  }

  if (index === -1) {
    return;
  }

  appState.session.leaderboard.splice(index, 1);
  renderLeaderboard();
  persistGameState();
}

function renderLeaderboard() {
  const sorted = [...appState.session.leaderboard].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.playedAt - b.playedAt;
  });

  dom.leaderboardList.innerHTML = "";

  if (!sorted.length) {
    dom.leaderboardEmpty.classList.remove("hidden");
    return;
  }

  dom.leaderboardEmpty.classList.add("hidden");
  sorted.forEach((entry, index) => {
    const li = document.createElement("li");
    li.className = "leaderboard-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = `${index + 1}. ${entry.playerName}`;

    const rightSide = document.createElement("div");
    rightSide.className = "leaderboard-actions";

    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = `${entry.score} pts`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "leaderboard-delete";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
      deleteLeaderboardEntry(entry);
    });

    rightSide.append(scoreSpan, deleteButton);
    li.append(nameSpan, rightSide);
    dom.leaderboardList.append(li);
  });
}

function renderScreen(screen) {
  appState.currentScreen = screen;
  Object.entries(dom.screens).forEach(([name, element]) => {
    element.classList.toggle("hidden", name !== screen);
  });

  const inGameplay = screen === "gameplay";
  document.body.classList.toggle("gameplay-active", inGameplay);
  updateMenuMusicState();
}

function buildSourceStatusMessage() {
  const filteredCount = getFilteredPokemonPool().length;
  return `${appState.sourceMessage} ${filteredCount} available with selected generations.`;
}

function renderPokemonCard(pokemon) {
  dom.pokemonName.textContent = pokemon.name || "Unknown Pokemon";
  dom.pokemonGeneration.textContent = pokemon.generation || "Generation Unknown";
  dom.pokemonTyping.textContent = pokemon.typing ? `Type: ${pokemon.typing}` : "Type: -";

  if (!pokemon || (!Number.isInteger(pokemon.dexId) && typeof pokemon.apiUrl !== "string")) {
    appState.pokemonTypeRequestId += 1;
  }

  const imageUrl = pokemon.image || null;
  if (imageUrl) {
    dom.pokemonImage.src = imageUrl;
    dom.pokemonImage.alt = `${pokemon.name} artwork`;
    dom.pokemonImage.classList.remove("hidden");
    dom.pokemonImageFallback.classList.add("hidden");
    return;
  }

  dom.pokemonImage.removeAttribute("src");
  dom.pokemonImage.alt = "";
  dom.pokemonImage.classList.add("hidden");
  dom.pokemonImageFallback.classList.remove("hidden");
}

async function updatePokemonTyping(pokemon) {
  if (!pokemon || typeof pokemon.name !== "string") {
    appState.pokemonTypeRequestId += 1;
    dom.pokemonTyping.textContent = "Type: -";
    return;
  }

  const requestId = appState.pokemonTypeRequestId + 1;
  appState.pokemonTypeRequestId = requestId;

  const cacheKey = getPokemonTypeCacheKey(pokemon);
  if (!cacheKey) {
    dom.pokemonTyping.textContent = "Type: Unknown";
    return;
  }

  const cachedTyping = appState.pokemonTypeCache.get(cacheKey);
  if (cachedTyping) {
    dom.pokemonTyping.textContent = `Type: ${cachedTyping}`;
    return;
  }

  dom.pokemonTyping.textContent = "Type: Loading...";

  const typing = await fetchPokemonTyping(pokemon);
  appState.pokemonTypeCache.set(cacheKey, typing);

  if (requestId !== appState.pokemonTypeRequestId) {
    return;
  }
  dom.pokemonTyping.textContent = `Type: ${typing}`;
}

function getPokemonTypeCacheKey(pokemon) {
  if (Number.isInteger(pokemon.dexId) && pokemon.dexId > 0) {
    return `dex:${pokemon.dexId}`;
  }
  if (typeof pokemon.name === "string" && pokemon.name.trim()) {
    return `name:${pokemon.name.trim().toLowerCase()}`;
  }
  return null;
}

async function fetchPokemonTyping(pokemon) {
  const url =
    (typeof pokemon.apiUrl === "string" && pokemon.apiUrl) ||
    (Number.isInteger(pokemon.dexId) && pokemon.dexId > 0
      ? `https://pokeapi.co/api/v2/pokemon/${pokemon.dexId}/`
      : null);

  if (!url) {
    return "Unknown";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return "Unknown";
    }
    const data = await response.json();
    const types = Array.isArray(data.types) ? data.types : [];
    const typeNames = types
      .sort((a, b) => (a?.slot || 99) - (b?.slot || 99))
      .map((entry) =>
        entry && entry.type && typeof entry.type.name === "string"
          ? formatPokemonName(entry.type.name)
          : ""
      )
      .filter(Boolean);

    return typeNames.length ? typeNames.join(" / ") : "Unknown";
  } catch (_error) {
    return "Unknown";
  } finally {
    clearTimeout(timeoutId);
  }
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function clearRoundTimers() {
  clearInterval(appState.timerId);
  clearInterval(appState.countdownId);
  appState.timerId = null;
  appState.countdownId = null;
}

function resetSettingsToDefaults() {
  appState.settings.roundSeconds = 60;
  appState.settings.selectedGenerations = new Set([1, 2]);
  appState.settings.motionEnabled = true;
  appState.settings.motionSensitivity = MOTION_SENSITIVITY_DEFAULT;
  appState.settings.sfxEnabled = true;
  appState.settings.menuMusicEnabled = true;
  appState.motion.axisChoice = null;
  appState.motion.baselineTilt = null;
  appState.motion.neutralReady = true;
  appState.motion.lastTriggerAt = 0;

  dom.playerName.value = "";
  dom.validationMessage.textContent = "";
  applySettingsToInputs();
  updateMotionSensitivityLabel();
  updateMotionTestReadout();
  syncGenerationSelectionFromInputs();
  updateMotionStatusText();
  updateGameplayHints();
  updateMenuMusicState();
  persistGameState();
}

function isDefinitelyLandscape() {
  const viewportLandscape = window.innerWidth > window.innerHeight;
  if (typeof window.matchMedia !== "function") {
    return viewportLandscape;
  }
  const mediaLandscape = window.matchMedia("(orientation: landscape)").matches;
  // Use viewport + media only; screen.orientation can be stale on iOS Safari.
  return viewportLandscape && mediaLandscape;
}

function updateOrientationGuard() {
  if (!dom.orientationOverlay) {
    return;
  }
  dom.orientationOverlay.classList.toggle("hidden", !isDefinitelyLandscape());
}

async function requestPortraitLock() {
  if (!screen.orientation || typeof screen.orientation.lock !== "function") {
    return;
  }
  try {
    await screen.orientation.lock("portrait");
  } catch (_error) {
    // Some browsers require fullscreen or user settings; overlay fallback handles unsupported lock.
  }
}

function applySettingsToInputs() {
  dom.roundSeconds.value = String(clampRoundSeconds(appState.settings.roundSeconds));
  const selected = appState.settings.selectedGenerations;
  dom.generationInputs.forEach((input) => {
    input.checked = selected.has(Number.parseInt(input.value, 10));
  });
  dom.motionEnabled.checked = appState.settings.motionEnabled;
  dom.motionSensitivity.value = String(clampMotionSensitivity(appState.settings.motionSensitivity));
  dom.sfxEnabled.checked = appState.settings.sfxEnabled;
  dom.menuMusicEnabled.checked = appState.settings.menuMusicEnabled;
}

function restoreSavedView() {
  if (appState.round.active && appState.round.timeLeft > 0 && appState.round.currentPokemon) {
    dom.hudPlayer.textContent = appState.round.playerName || "-";
    dom.hudTime.textContent = String(appState.round.timeLeft);
    dom.hudScore.textContent = String(appState.round.score);
    dom.endRoundEarly.disabled = false;
    renderPokemonCard(appState.round.currentPokemon);
    void updatePokemonTyping(appState.round.currentPokemon);
    renderScreen("gameplay");
    startGameplayTimer();
    return;
  }

  if (appState.currentScreen === "result" && appState.pendingPlayAgain) {
    dom.endRoundEarly.disabled = true;
    dom.resultPlayer.textContent = appState.round.playerName || appState.pendingPlayAgain;
    dom.resultScore.textContent = String(appState.round.score || 0);
    renderScreen("result");
    return;
  }

  dom.endRoundEarly.disabled = true;
  if (appState.currentScreen === "settings") {
    renderScreen("settings");
    return;
  }
  renderScreen("setup");
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const saved = JSON.parse(raw);

    if (saved && typeof saved === "object") {
      if (saved.settings && typeof saved.settings === "object") {
        const roundSeconds = clampRoundSeconds(saved.settings.roundSeconds);
        const selected = Array.isArray(saved.settings.selectedGenerations)
          ? saved.settings.selectedGenerations
              .map((value) => Number.parseInt(value, 10))
              .filter((value) => Number.isInteger(value) && value >= 1 && value <= 9)
          : [1, 2];
        appState.settings.roundSeconds = roundSeconds;
        appState.settings.selectedGenerations = new Set(selected.length ? selected : [1, 2]);
        if (typeof saved.settings.motionEnabled === "boolean") {
          appState.settings.motionEnabled = saved.settings.motionEnabled;
        }
        appState.settings.motionSensitivity = clampMotionSensitivity(saved.settings.motionSensitivity);
        if (typeof saved.settings.sfxEnabled === "boolean") {
          appState.settings.sfxEnabled = saved.settings.sfxEnabled;
        }
        if (typeof saved.settings.menuMusicEnabled === "boolean") {
          appState.settings.menuMusicEnabled = saved.settings.menuMusicEnabled;
        }
      }

      if (saved.session && Array.isArray(saved.session.leaderboard)) {
        appState.session.leaderboard = saved.session.leaderboard
          .filter(
            (entry) =>
              entry &&
              typeof entry.playerName === "string" &&
              Number.isFinite(entry.score) &&
              Number.isFinite(entry.playedAt)
          )
          .map((entry) => ({
            playerName: entry.playerName,
            score: entry.score,
            playedAt: entry.playedAt
          }));
      }

      if (typeof saved.playerNameDraft === "string") {
        dom.playerName.value = saved.playerNameDraft;
      }

      if (typeof saved.pendingPlayAgain === "string" || saved.pendingPlayAgain === null) {
        appState.pendingPlayAgain = saved.pendingPlayAgain;
      }

      if (typeof saved.currentScreen === "string") {
        appState.currentScreen = saved.currentScreen;
      }

      if (saved.round && typeof saved.round === "object") {
        const parsedRound = deserializeRound(saved.round);
        if (parsedRound) {
          appState.round = parsedRound;
        }
      }
    }
  } catch (_error) {
    // Ignore malformed local state and continue with defaults.
  }
}

function persistGameState() {
  try {
    const stateToSave = {
      settings: {
        roundSeconds: appState.settings.roundSeconds,
        selectedGenerations: [...appState.settings.selectedGenerations],
        motionEnabled: appState.settings.motionEnabled,
        motionSensitivity: appState.settings.motionSensitivity,
        sfxEnabled: appState.settings.sfxEnabled,
        menuMusicEnabled: appState.settings.menuMusicEnabled
      },
      session: {
        leaderboard: appState.session.leaderboard
      },
      round: serializeRound(appState.round),
      pendingPlayAgain: appState.pendingPlayAgain,
      currentScreen: appState.currentScreen,
      playerNameDraft: dom.playerName.value || ""
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  } catch (_error) {
    // Ignore storage write failures.
  }
}

function serializeRound(round) {
  return {
    playerName: round.playerName,
    timeLeft: round.timeLeft,
    score: round.score,
    active: round.active,
    deck: round.deck,
    pool: round.pool,
    used: [...round.used],
    currentPokemon: round.currentPokemon
  };
}

function deserializeRound(round) {
  if (!round || typeof round !== "object") {
    return null;
  }

  const pool = Array.isArray(round.pool) ? round.pool.filter(isPokemonRecord) : [];
  const deck = Array.isArray(round.deck) ? round.deck.filter(isPokemonRecord) : [];
  const currentPokemon = isPokemonRecord(round.currentPokemon) ? round.currentPokemon : null;
  const usedNames = Array.isArray(round.used)
    ? round.used.filter((name) => typeof name === "string" && name.trim())
    : [];

  return {
    playerName: typeof round.playerName === "string" ? round.playerName : "",
    timeLeft: Number.isFinite(round.timeLeft) ? Math.max(0, Math.floor(round.timeLeft)) : 60,
    score: Number.isFinite(round.score) ? Math.max(0, Math.floor(round.score)) : 0,
    active: Boolean(round.active),
    deck,
    pool,
    used: new Set(usedNames),
    currentPokemon
  };
}

function isPokemonRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.generation === "string"
  );
}

window.addEventListener("beforeunload", () => {
  persistGameState();
  stopMenuMusic();
  clearRoundTimers();
});

initApp();
