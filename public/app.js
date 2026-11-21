// --- HARDCODED DEVELOPER CONFIGURATION FOR GRADE SECTIONS AND STRANDS ---
const grade11Sections = ["Excellence", "Resilience", "Discipline", "Accountability", "Stewardship"];
const grade12Strands = ["STEM", "ABM", "HUMSS", "TVL-ICT", "TVL-HE"];

function getElement(id) {
  return document.getElementById(id);
}

let appToastTimer = null;
let pendingFriendRemoval = null;
let pendingChatBlock = null;
function showToast(message, kind = "info") {
  let toast = getElement("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.textContent = String(message || "");
  toast.dataset.kind = kind;
  toast.classList.add("visible");
  clearTimeout(appToastTimer);
  appToastTimer = setTimeout(() => toast.classList.remove("visible"), 4200);
}
function openFriendRemovalConfirmation(friend, user, trigger) {
  const modal = getElement("friend-remove-modal");
  if (!modal) return;
  const name = friendName(friend, user.uid);
  pendingFriendRemoval = { friend, user, trigger, name };
  getElement("friend-remove-message").textContent = `Remove ${name} from your friends? You can send another request later.`;
  getElement("friend-remove-error")?.classList.add("hidden");
  modal.classList.remove("hidden");
  getElement("friend-remove-cancel")?.focus();
}
function closeFriendRemovalConfirmation() {
  getElement("friend-remove-modal")?.classList.add("hidden");
  const trigger = pendingFriendRemoval?.trigger;
  pendingFriendRemoval = null;
  if (trigger?.isConnected) trigger.focus();
}
getElement("friend-remove-cancel")?.addEventListener("click", closeFriendRemovalConfirmation);
getElement("friend-remove-modal")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) closeFriendRemovalConfirmation();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !getElement("friend-remove-modal")?.classList.contains("hidden")) {
    event.preventDefault();
    closeFriendRemovalConfirmation();
  }
});
getElement("friend-remove-confirm")?.addEventListener("click", async event => {
  if (!pendingFriendRemoval) return;
  const { friend, name } = pendingFriendRemoval;
  const button = event.currentTarget;
  const error = getElement("friend-remove-error");
  button.disabled = true;
  button.textContent = "Removing…";
  error?.classList.add("hidden");
  try {
    await window.sapcFirebase.removeFriend(friend.id);
    pendingFriendRemoval = null;
    getElement("friend-remove-modal")?.classList.add("hidden");
    await loadFriends();
    showToast(`${name} was removed from your friends.`, "success");
  } catch (removeError) {
    if (error) {
      error.textContent = `Could not remove friend: ${removeError.message}`;
      error.classList.remove("hidden");
    }
  } finally {
    button.disabled = false;
    button.textContent = "Remove friend";
  }
});

function apiUrl(path) {
  const base = String(window.SAPC_API_BASE_URL || "").replace(/\/+$/, "");
  return `${base}${path}`;
}

let cards = [];
let i = 0;
let typingTimeout = null;
let choiceFlipTimeout = null;
let selectedImages = [];
const notesInput = getElement("notes");
const notesCount = getElement("notes-count");
if (notesInput && notesCount) {
  const updateNotesCount = () => {
    const count = notesInput.value.length;
    notesCount.textContent = `${count.toLocaleString()} character${count === 1 ? "" : "s"}`;
  };
  notesInput.addEventListener("input", updateNotesCount);
  updateNotesCount();
}

async function detectSubjectFromNotes() {
  const text = notesInput?.value.trim() || "";
  const status = getElement("subject-detection-status");
  if (text.length < 60) {
    if (status) status.textContent = "Add at least 60 characters of notes before detecting the subject.";
    return;
  }
  const curriculum = getElement("shs-curriculum")?.value || "strengthened";
  const catalog = shsCourseCatalog?.[curriculum];
  if (!catalog) {
    if (status) status.textContent = "Subject options are still loading. Try again in a moment.";
    return;
  }
  const candidates = Object.entries(catalog).flatMap(([pathway, subjects]) => subjects.map(subject => ({ pathway, subject })));
  const token = await window.sapcFirebase?.getIdToken();
  if (!token) {
    if (status) status.textContent = "Sign in to detect a subject automatically.";
    return;
  }
  if (status) status.textContent = "Checking your notes against the available subjects…";
  try {
    const response = await fetch(apiUrl("/api/detect-subject"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ notes: text, gradeLevel: selectedGrade, curriculum, candidates })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Subject detection failed.");
    if (!data.subject || !catalog[data.pathway]?.includes(data.subject)) {
      if (status) status.textContent = data.reason || "No reliable subject match was found. Your selection was left unchanged.";
      return;
    }
    const pathwaySelect = getElement("shs-pathway");
    pathwaySelect.value = data.pathway;
    pathwaySelect.dispatchEvent(new Event("change", { bubbles: true }));
    const subjectSelect = getElement("shs-subject");
    subjectSelect.value = data.subject;
    subjectSelect.dispatchEvent(new Event("change", { bubbles: true }));
    if (status) status.textContent = `Matched ${data.subject} · ${data.pathway} (${data.confidence} confidence).`;
  } catch (error) {
    if (status) status.textContent = error.message || "Could not detect a subject. You can choose one from the menus.";
  }
}
getElement("detect-subject-btn")?.addEventListener("click", detectSubjectFromNotes);

getElement("youtube-import-toggle")?.addEventListener("click", event => {
  const panel = getElement("youtube-import-panel");
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !opening);
  event.currentTarget.setAttribute("aria-expanded", String(opening));
  if (opening) getElement("youtube-transcript")?.focus();
});
getElement("youtube-import-btn")?.addEventListener("click", () => {
  const transcript = getElement("youtube-transcript");
  const status = getElement("youtube-import-status");
  const content = transcript?.value.trim();
  if (!content) {
    if (status) status.textContent = "Paste the video transcript first.";
    transcript?.focus();
    return;
  }
  const videoUrl = getElement("youtube-url")?.value.trim();
  const source = videoUrl ? `\n\n[YouTube transcript: ${videoUrl}]\n` : "\n\n[YouTube transcript]\n";
  notesInput.value = `${notesInput.value.trim()}${source}${content}`.trim();
  notesInput.dispatchEvent(new Event("input", { bubbles: true }));
  transcript.value = "";
  if (status) status.textContent = "Transcript added to your study material.";
  detectSubjectFromNotes();
});

let selectedGrade = "Grade 11";
let selectedStrand = grade11Sections[0];
let selectedSubjectMode = "general";
let editingIndex = null;

// --- SCORE COUNTER & ANSWER TRACKING STATE ---
let answeredState = {}; 
let studyStartedAt = Date.now();
let activeDeckId = null;
let activeStorageUserId = "guest";

function getUserStorageKey(name) {
  return `sapc_${name}_${activeStorageUserId}`;
}

function safeLocalStorageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (error) {
    console.warn("Browser storage is unavailable:", error.message);
    return fallback;
  }
}

function isQuotaExceededError(error) {
  return error?.name === "QuotaExceededError" || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error?.code === 22 || error?.code === 1014;
}

function tryWriteLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function evictOldestCachedDeck() {
  const candidates = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("sapc_flashcards_")) continue;
      let value;
      try { value = JSON.parse(localStorage.getItem(key) || "null"); } catch { value = null; }
      if (Array.isArray(value)) {
        candidates.push({ key, legacy: true, updatedAt: 0 });
      } else if (Array.isArray(value?.decks)) {
        value.decks.forEach((deck, deckIndex) => candidates.push({
          key,
          deckIndex,
          updatedAt: Number(new Date(deck?.updatedAt || 0)) || 0
        }));
      }
    }
  } catch (error) {
    console.warn("Could not inspect cached decks for storage cleanup:", error.message);
    return false;
  }
  candidates.sort((a, b) => a.updatedAt - b.updatedAt);
  const candidate = candidates[0];
  if (!candidate) return false;
  if (candidate.legacy) {
    localStorage.removeItem(candidate.key);
    return true;
  }

  let value;
  try { value = JSON.parse(localStorage.getItem(candidate.key) || "null"); } catch { value = null; }
  if (!Array.isArray(value?.decks)) {
    localStorage.removeItem(candidate.key);
    return true;
  }
  const decks = value.decks.filter((_, index) => index !== candidate.deckIndex);
  if (!decks.length) {
    localStorage.removeItem(candidate.key);
    return true;
  }
  const result = tryWriteLocalStorage(candidate.key, JSON.stringify({ ...value, decks }));
  if (!result.ok) localStorage.removeItem(candidate.key);
  return true;
}

function setLocalStorageItem(key, value) {
  let result = tryWriteLocalStorage(key, value);
  if (result.ok) return true;
  if (!isQuotaExceededError(result.error)) {
    console.warn("Could not save browser data:", result.error?.message || result.error);
    return false;
  }
  while (evictOldestCachedDeck()) {
    result = tryWriteLocalStorage(key, value);
    if (result.ok) return true;
    if (!isQuotaExceededError(result.error)) break;
  }
  console.warn("Browser storage is full; the latest local copy could not be saved.");
  return false;
}

function updateSpacedRepetition(card, isCorrect) {
  const previous = card.srs || { interval: 0, ease: 2.5, repetitions: 0 };
  if (isCorrect) {
    previous.repetitions += 1;
    previous.interval = previous.interval === 0 ? 1 : Math.max(1, Math.round(previous.interval * previous.ease));
    previous.ease = Math.min(3, previous.ease + 0.1);
  } else {
    previous.repetitions = 0;
    previous.interval = 0;
    previous.ease = Math.max(1.3, previous.ease - 0.2);
  }
  previous.dueAt = Date.now() + previous.interval * 24 * 60 * 60 * 1000;
  card.srs = previous;
}

function saveLocalProgress() {
  let progress = {};
  try { progress = JSON.parse(safeLocalStorageGet(getUserStorageKey("progress"), "{}")); } catch {}
  progress.sessions = Array.isArray(progress.sessions) ? progress.sessions : [];
  progress.reviews = progress.reviews || {};
  cards.forEach((card, index) => {
    if (card.srs) progress.reviews[card.question] = card.srs;
  });
  setLocalStorageItem(getUserStorageKey("progress"), JSON.stringify(progress));
}

function resetQuizScore() {
  answeredState = {};
  updateScoreUI();
}

function getCorrectCount() {
  return Object.values(answeredState).filter(st => st.isCorrect).length;
}

function updateScoreUI() {
  const liveScorePill = getElement("live-score-pill");
  if (liveScorePill) {
    liveScorePill.textContent = `Score: ${getCorrectCount()} / ${cards.length}`;
  }
}

// --- CONFETTI & WRONG FEEDBACK EFFECTS ---
function triggerConfetti() {
  if (typeof confetti === "function") {
    confetti({
      particleCount: 75,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#7a1c1c', '#d4af37', '#ffffff', '#e5b842']
    });
  }
}

function triggerWrongXEffect(parentContainer) {
  if (!parentContainer) parentContainer = getElement("card");
  
  const existingX = parentContainer.querySelector(".wrong-x-overlay");
  if (existingX) existingX.remove();

  const xBadge = document.createElement("div");
  xBadge.className = "wrong-x-overlay";
  xBadge.textContent = "\u274C";
  parentContainer.appendChild(xBadge);

  setTimeout(() => {
    xBadge.remove();
  }, 750);
}

// --- SUMMARY END-OF-DECK SCREEN ---
function showDeckSummary() {
  if (typeof stopQuizTimer === "function") stopQuizTimer();
  stopSpeech(true);
  getElement("card").classList.add("hidden");
  getElement("typed-answer-entry").classList.add("hidden");
  getElement("hint-text").classList.add("hidden");
  getElement("study-controls").classList.add("hidden");

  const quizSummary = getElement("quiz-summary");
  const summaryPercentage = getElement("summary-percentage");
  const summaryScoreText = getElement("summary-score-text");
  const summaryMessage = getElement("summary-message");

  const totalCards = cards.length;
  const correctCount = getCorrectCount();
  const percentage = totalCards > 0 ? Math.round((correctCount / totalCards) * 100) : 0;

  summaryPercentage.textContent = `${percentage}%`;
  summaryScoreText.textContent = `${correctCount} of ${totalCards} Correct`;

  if (percentage >= 90) {
    summaryMessage.textContent = "\u{1F31F} Outstanding! You have thoroughly mastered this study material!";
    triggerConfetti();
  } else if (percentage >= 75) {
    summaryMessage.textContent = "\u{1F44F} Great job! You have a solid grasp of most concepts.";
  } else if (percentage >= 50) {
    summaryMessage.textContent = "\u{1F44D} Good effort! Review the missed cards again to build full recall.";
  } else {
    summaryMessage.textContent = "\u{1F4AA} Keep practicing! Go over the lesson notes and try the deck again.";
  }

  quizSummary.classList.remove("hidden");
  const session = {
    date: new Date().toISOString(),
    correct: correctCount,
    total: totalCards,
    durationSeconds: Math.round((Date.now() - studyStartedAt) / 1000)
  };
  let progress = {};
  try { progress = JSON.parse(safeLocalStorageGet(getUserStorageKey("progress"), "{}")); } catch {}
  progress.sessions = [...(progress.sessions || []).slice(-99), session];
  setLocalStorageItem(getUserStorageKey("progress"), JSON.stringify(progress));
  saveLocalProgress();
  const user = window.sapcFirebase?.getCurrentUser();
  if (user) {
    getElement("nav-friends-btn")?.classList.remove("hidden");
    window.sapcFirebase.recordStudySession(user, session).catch(error => {
      console.error("Could not save study session:", error);
    });
  }
  renderProgressDashboard();
}

const restartDeckBtn = getElement("restart-deck-btn");
if (restartDeckBtn) {
  restartDeckBtn.addEventListener("click", () => {
    getElement("quiz-summary").classList.add("hidden");
    getElement("card").classList.remove("hidden");
    getElement("hint-text").classList.remove("hidden");
    getElement("study-controls").classList.remove("hidden");
    resetQuizScore();
    i = 0;
    startQuizTimer();
    show(true);
  });
}

// --- Browser Speech API TTS & Auto-Narration System ---
let selectedVoiceURI = safeLocalStorageGet("sapc_selected_voice", "") || "";
let currentSpeakingBtn = null;
let currentUtterance = null;
let isPaused = false;
let isAutoNarrating = false;
let autoNarrateTimeout = null;

function populateVoiceList() {
  if (!('speechSynthesis' in window)) return;
  const voiceSelect = getElement("voice-select");
  if (!voiceSelect) return;

  const voices = window.speechSynthesis.getVoices();
  voiceSelect.replaceChildren();

  const defaultOpt = document.createElement("option");
  defaultOpt.value = "";
  defaultOpt.textContent = "Auto / System Default";
  voiceSelect.append(defaultOpt);

  voices.forEach(voice => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    if (voice.voiceURI === selectedVoiceURI) {
      option.selected = true;
    }
    voiceSelect.append(option);
  });
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = populateVoiceList;
  populateVoiceList();
}

function resetSpeakingState() {
  if (currentSpeakingBtn) {
    currentSpeakingBtn.classList.remove("active");
    currentSpeakingBtn.textContent = "\u{1F50A}";
    currentSpeakingBtn.setAttribute("title", "Listen to narration");
    currentSpeakingBtn = null;
  }
  isPaused = false;
  currentUtterance = null;
}

function stopSpeech(clearAuto = true) {
  if (autoNarrateTimeout) {
    clearTimeout(autoNarrateTimeout);
    autoNarrateTimeout = null;
  }
  if (clearAuto) {
    isAutoNarrating = false;
  }
  if ('speechSynthesis' in window) {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.cancel();
  }
  resetSpeakingState();
}

function handleAutoNarrateNext() {
  if (!isAutoNarrating || cards.length === 0) return;

  const isFlipped = getElement("card").classList.contains("flipped");

  if (!isFlipped) {
    autoNarrateTimeout = setTimeout(() => {
      if (!isAutoNarrating) return;
      getElement("card").classList.add("flipped");

      autoNarrateTimeout = setTimeout(() => {
        if (!isAutoNarrating) return;
        let fullAnswer = cards[i].answer;
        if (cards[i].explanation) {
          fullAnswer += ". Explanation: " + cards[i].explanation;
        }
        const backPlayBtn = getElement("back").querySelector(".play-pause-btn");
        speakText(fullAnswer, backPlayBtn);
      }, 600);
    }, 1200);
  } else {
    getElement("nav-friends-btn")?.classList.add("hidden");
    autoNarrateTimeout = setTimeout(() => {
      if (!isAutoNarrating) return;
      if (i >= cards.length - 1) {
        showDeckSummary();
        return;
      }
      i++;
      show(false);

      autoNarrateTimeout = setTimeout(() => {
        if (!isAutoNarrating) return;
        const frontPlayBtn = getElement("front").querySelector(".play-pause-btn");
        if (frontPlayBtn) {
          speakText(cleanQuestionDisplay(cards[i].question), frontPlayBtn);
        }
      }, 600);
    }, 1500);
  }
}

function speakText(text, btnElement) {
  stopSpeech(false);
  if (!text) return;

  setTimeout(() => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    if (selectedVoiceURI) {
      const matchedVoice = voices.find(v => v.voiceURI === selectedVoiceURI);
      if (matchedVoice) utterance.voice = matchedVoice;
    } else {
      utterance.lang = 'en-US';
    }

    currentSpeakingBtn = btnElement;
    currentUtterance = utterance;
    isPaused = false;

    if (btnElement) {
      btnElement.classList.add("active");
      btnElement.textContent = "\u23F8\uFE0F";
      btnElement.setAttribute("title", "Stop narration");
    }

    utterance.onend = () => {
      if (currentUtterance === utterance) {
        resetSpeakingState();
      }
    };

    utterance.onerror = () => {
      if (currentUtterance === utterance) {
        resetSpeakingState();
      }
    };

    window.speechSynthesis.speak(utterance);
  }, 50);
}

function toggleSpeech(text, btnElement) {
  if (!('speechSynthesis' in window)) {
    showToast("Text-to-speech is not supported in this browser.", "error");
    return;
  }

  if (window.speechSynthesis.speaking || isPaused) {
    stopSpeech(true);
    return;
  }

  speakText(text, btnElement);
}

function createAudioControlsGroup(getTextToSpeak) {
  const container = document.createElement("div");
  container.className = "card-audio-controls";

  const rewindBtn = document.createElement("button");
  rewindBtn.type = "button";
  rewindBtn.className = "narrate-btn rewind-btn";
  rewindBtn.title = "Rewind to beginning";
  rewindBtn.setAttribute("aria-label", "Rewind narration to beginning");
  rewindBtn.textContent = "\u23EA";
  rewindBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    stopSpeech(false);
    const playBtn = container.querySelector(".play-pause-btn");
    setTimeout(() => {
      speakText(getTextToSpeak(), playBtn);
    }, 60);
  });

  const playPauseBtn = document.createElement("button");
  playPauseBtn.type = "button";
  playPauseBtn.className = "narrate-btn play-pause-btn";
  playPauseBtn.title = "Listen to narration";
  playPauseBtn.setAttribute("aria-label", "Listen to narration");
  playPauseBtn.textContent = "\u{1F50A}";
  playPauseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSpeech(getTextToSpeak(), playPauseBtn);
  });

  container.append(rewindBtn, playPauseBtn);
  return container;
}

const voiceSelectElem = getElement("voice-select");
if (voiceSelectElem) {
  voiceSelectElem.addEventListener("change", (e) => {
    selectedVoiceURI = e.target.value;
    setLocalStorageItem("sapc_selected_voice", selectedVoiceURI);
  });
}

// --- Persistence Helpers ---
function saveCardsToStorage() {
  const storageKey = getUserStorageKey("flashcards");
  let stored = null;
  try { stored = JSON.parse(safeLocalStorageGet(storageKey, "null")); } catch {}
  const existingDecks = Array.isArray(stored)
    ? [{ id: "local-current", title: "Saved Reviewer Deck", updatedAt: 0, cards: stored }]
    : Array.isArray(stored?.decks) ? stored.decks : [];
  const deckId = String(activeDeckId || "local-current");
  const currentDeck = {
    id: deckId,
    title: "Saved Reviewer Deck",
    subjectMode: selectedSubjectMode,
    gradeLevel: selectedGrade,
    academicStrand: selectedStrand,
    updatedAt: new Date().toISOString(),
    cards
  };
  const deckList = [currentDeck, ...existingDecks.filter(deck => String(deck?.id) !== deckId)].slice(0, 15);
  const lightweightDecks = JSON.stringify({ version: 2, activeDeckId: deckId, decks: deckList }, (key, value) => {
    if (["notes", "rawnotes", "sourcenotes", "sourcetext", "images", "image", "imagedata", "base64", "filebuffer", "filedata", "attachmentdata"].includes(key.toLowerCase())
      || /base64|image|filebuffer|attachmentdata/i.test(key)) return undefined;
    if (typeof value === "string" && (/^data:[^;,]+;base64,/i.test(value)
      || (value.length > 1024 && /^[A-Za-z0-9+/_=-]+$/.test(value)))) return undefined;
    return value;
  });
  if (!setLocalStorageItem(storageKey, lightweightDecks)) {
    showToast("This deck is open, but browser storage is full so its local copy could not be saved.", "error");
  }
}

function loadCardsFromStorage() {
  const saved = safeLocalStorageGet(getUserStorageKey("flashcards"));
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      const activeDeck = Array.isArray(parsed?.decks)
        ? parsed.decks.find(deck => String(deck?.id) === String(parsed.activeDeckId)) || parsed.decks[0]
        : null;
      const restoredCards = Array.isArray(parsed) ? parsed : activeDeck?.cards;
      if (Array.isArray(restoredCards) && restoredCards.length > 0) {
        cards = restoredCards;
        i = 0;
        resetQuizScore();
        getElement("study").classList.remove("hidden");
        show();
      }
    } catch (e) {
      console.error("Failed to load saved cards", e);
    }
  }
}

// --- Landing Page Handler ---
const landingView = getElement("landing-view");
const appView = getElement("app-view");
const friendsView = getElement("friends-view");
const studyPanel = getElement("study");
const fullscreenToggle = getElement("fullscreen-toggle");

function showAppWorkspace() {
  document.body.classList.remove("messenger-active");
  getElement("chat-modal")?.classList.remove("messenger-page-mode");
  getElement("chat-modal")?.classList.add("hidden");
  if (landingView) landingView.classList.add("hidden");
  if (appView) appView.classList.remove("hidden");
  if (friendsView) friendsView.classList.add("hidden");
  getElement("practice-test-view")?.classList.add("hidden");
}
function showFriendsWorkspace() {
  if (!window.sapcFirebase?.getCurrentUser()) {
    showAppWorkspace();
    showToast("Sign in to open Friends.", "error");
    return;
  }
  if (landingView) landingView.classList.add("hidden");
  if (appView) appView.classList.add("hidden");
  if (friendsView) friendsView.classList.add("hidden");
  getElement("practice-test-view")?.classList.add("hidden");
  document.body.classList.add("messenger-active");
  getElement("chat-modal")?.classList.add("messenger-page-mode");
  getElement("chat-modal")?.classList.remove("hidden");
  const backButton = getElement("close-chat-btn");
  if (backButton) {
    backButton.textContent = "Back to reviewer";
    backButton.setAttribute("aria-label", "Back to reviewer");
  }
  loadFriends();
  window.dispatchEvent(new CustomEvent("sapc:open-messenger"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLandingPage() {
  document.body.classList.remove("messenger-active");
  getElement("chat-modal")?.classList.remove("messenger-page-mode");
  getElement("chat-modal")?.classList.add("hidden");
  if (appView) appView.classList.add("hidden");
  if (friendsView) friendsView.classList.add("hidden");
  getElement("practice-test-view")?.classList.add("hidden");
  if (landingView) landingView.classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

if (getElement("hero-start-btn")) getElement("hero-start-btn").addEventListener("click", showAppWorkspace);
if (getElement("nav-launch-btn")) getElement("nav-launch-btn").addEventListener("click", showAppWorkspace);
getElement("nav-friends-btn")?.addEventListener("click", showFriendsWorkspace);
getElement("friends-back-btn")?.addEventListener("click", showAppWorkspace);
if (getElement("nav-brand-btn")) getElement("nav-brand-btn").addEventListener("click", showLandingPage);

const practiceTestView = getElement("practice-test-view");
let practiceQuestions = [];
let practiceAnswers = {};
let practiceIndex = 0;
let practiceTimer = null;
let practiceSecondsLeft = 0;
let customExamDraft = [];
let practiceExamTitle = "";
function showPracticeTest() {
  landingView?.classList.add("hidden");
  appView?.classList.add("hidden");
  friendsView?.classList.add("hidden");
  practiceTestView?.classList.remove("hidden");
  getElement("practice-test-setup")?.classList.remove("hidden");
  getElement("custom-exam-builder")?.classList.add("hidden");
  getElement("practice-test-exam")?.classList.add("hidden");
  getElement("practice-test-results")?.classList.add("hidden");
  getElement("practice-test-deck-meta").textContent = cards.length
    ? `${selectedSubjectMode[0].toUpperCase()}${selectedSubjectMode.slice(1)} · ${cards.length} available questions`
    : "No reviewer loaded";
  const canCreateMathEasyExam = selectedSubjectMode === "math";
  const noDeckNotice = getElement("practice-test-no-deck");
  noDeckNotice?.classList.toggle("hidden", cards.length > 0);
  if (noDeckNotice && !cards.length && canCreateMathEasyExam) noDeckNotice.textContent = "Easy Math exams can be generated here without a reviewer deck. You can also create a custom exam.";
  getElement("start-practice-test-btn").disabled = cards.length === 0 && !canCreateMathEasyExam;
  getElement("practice-test-status")?.classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
getElement("nav-practice-test-btn")?.addEventListener("click", showPracticeTest);
getElement("practice-test-back-btn")?.addEventListener("click", () => {
  if (practiceTimer) clearInterval(practiceTimer);
  practiceTimer = null;
  showAppWorkspace();
});
function renderPracticeQuestion() {
  const card = practiceQuestions[practiceIndex];
  const host = getElement("practice-test-question");
  if (!card || !host) return;
  host.replaceChildren();
  const prompt = document.createElement("h3");
  prompt.className = "assessment-question-prompt";
  prompt.textContent = card.practiceQuestion || card.question || `Question ${practiceIndex + 1}`;
  host.append(prompt);

  const responseHint = document.createElement("p");
  responseHint.className = "assessment-response-hint";
  responseHint.textContent = card.type === "enumeration" ? "Enter each part in its numbered field." : card.practiceType === "written" ? "Type your answer below." : "Select one answer.";
  host.append(responseHint);

  if (card.type === "enumeration") {
    const expectedItems = getEnumerationItems(card.practiceAnswer || card.answer || "");
    const itemCount = Math.max(1, expectedItems.length || inferEnumerationCount(card.practiceQuestion));
    const answers = Array.isArray(practiceAnswers[practiceIndex]) ? [...practiceAnswers[practiceIndex]] : [];
    const inputs = document.createElement("div");
    inputs.className = "assessment-enumeration-inputs";
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
      const label = document.createElement("label");
      label.className = "assessment-enumeration-field";
      const caption = document.createElement("span");
      caption.textContent = `Item ${itemIndex + 1}`;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "assessment-written-answer";
      input.placeholder = `Enter item ${itemIndex + 1}`;
      input.value = answers[itemIndex] || "";
      input.setAttribute("aria-label", `Answer item ${itemIndex + 1} for question ${practiceIndex + 1}`);
      input.addEventListener("input", () => {
        const currentAnswers = Array.isArray(practiceAnswers[practiceIndex]) ? [...practiceAnswers[practiceIndex]] : [];
        currentAnswers[itemIndex] = input.value;
        practiceAnswers[practiceIndex] = currentAnswers;
      });
      label.append(caption, input);
      inputs.append(label);
    }
    host.append(inputs);
  } else if (card.practiceType === "written") {
    const isEnumeration = card.type === "enumeration";
    const input = document.createElement(isEnumeration ? "textarea" : "input");
    input.className = "assessment-written-answer";
    if (isEnumeration) input.rows = 4;
    else input.type = "text";
    input.placeholder = isEnumeration ? "Enter each item on a new line" : "Enter your answer";
    input.setAttribute("aria-label", `Answer for question ${practiceIndex + 1}`);
    input.value = practiceAnswers[practiceIndex] || "";
    input.addEventListener("input", () => { practiceAnswers[practiceIndex] = input.value; });
    host.append(input);
  } else {
    const choices = document.createElement("div");
    choices.className = "practice-test-question";
    card.practiceOptions.forEach((choice, choiceIndex) => {
      const label = document.createElement("label");
      label.className = "practice-test-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "practice-answer";
      input.value = choice;
      input.checked = practiceAnswers[practiceIndex] === choice;
      input.addEventListener("change", () => { practiceAnswers[practiceIndex] = choice; });
      const text = document.createElement("span");
      text.textContent = `${String.fromCharCode(65 + choiceIndex)}. ${choice}`;
      label.append(input, text);
      choices.append(label);
    });
    host.append(choices);
  }
  getElement("practice-test-counter").textContent = `Question ${practiceIndex + 1} of ${practiceQuestions.length}`;
  getElement("practice-test-progress").style.width = `${((practiceIndex + 1) / practiceQuestions.length) * 100}%`;
  getElement("practice-test-prev").disabled = practiceIndex === 0;
  getElement("practice-test-next").classList.toggle("hidden", practiceIndex === practiceQuestions.length - 1);
  getElement("practice-test-submit").classList.toggle("hidden", practiceIndex !== practiceQuestions.length - 1);
}

function inferEnumerationCount(question) {
  const countWords = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const match = String(question || "").match(/\b(?:list|name|give|identify|state)\s+(?:the\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!match) return 3;
  return Math.min(10, Number(match[1]) || countWords[match[1].toLowerCase()] || 3);
}

function practiceResponseText(response) {
  return Array.isArray(response) ? response.map(value => String(value || "").trim()).filter(Boolean).join("; ") : String(response || "").trim();
}

function parsePracticeChoices(question) {
  const text = String(question || "").replace(/\r/g, "\n").trim();
  const markers = [...text.matchAll(/(?:^|\s)([A-D])[.)]\s+/g)];
  if (markers.length < 2) return null;
  const first = markers[0];
  const questionEnd = first.index + first[0].length - first[0].trimStart().length;
  const prompt = text.slice(0, questionEnd).trim();
  const options = markers.map((marker, index) => {
    const optionStart = marker.index + marker[0].length;
    const optionEnd = markers[index + 1]?.index ?? text.length;
    return { letter: marker[1].toUpperCase(), text: text.slice(optionStart, optionEnd).trim() };
  }).filter(option => option.text);
  return options.length >= 2 ? { prompt: prompt || text, options } : null;
}

function makePracticeQuestion(card) {
  const answer = String(card.answer || "").trim();
  const parsedChoices = parsePracticeChoices(card.question);
  if (card.type === "true-false") {
    const choices = /^(tama|mali)$/i.test(answer) ? ["Tama", "Mali"] : ["True", "False"];
    const correct = choices.find(choice => choice.toLowerCase() === answer.toLowerCase()) || choices[0];
    return { ...card, answer, practiceQuestion: String(card.question || ""), practiceType: "choice", practiceOptions: choices, practiceAnswer: correct };
  }
  if (parsedChoices && (card.type === "multiple-choice" || parsedChoices.options.length >= 2)) {
    const answerLetter = answer.match(/^\s*([A-D])[.)]\s*/i)?.[1]?.toUpperCase();
    const answerText = answer.replace(/^\s*[A-D][.)]\s*/i, "").trim();
    const correct = parsedChoices.options.find(option => option.letter === answerLetter)
      || parsedChoices.options.find(option => normalizeString(option.text) === normalizeString(answerText));
    if (correct) return {
      ...card,
      answer,
      practiceQuestion: parsedChoices.prompt,
      practiceType: "choice",
      practiceOptions: parsedChoices.options.map(option => option.text),
      practiceAnswer: correct.text
    };
  }
  return { ...card, answer, practiceQuestion: parsedChoices?.prompt || String(card.question || ""), practiceType: "written", practiceOptions: [], practiceAnswer: answer };
}

function practiceAnswerMatches(card, response) {
  if (!practiceResponseText(response)) return false;
  if (card.practiceType === "choice") return response === card.practiceAnswer;
  if (card.type === "enumeration") {
    const expected = getEnumerationItems(card.practiceAnswer).sort();
    const actual = getEnumerationItems(Array.isArray(response) ? response.join("\n") : response).sort();
    return expected.length > 0 && expected.length === actual.length && expected.every((item, index) => item === actual[index]);
  }
  return normalizeString(response) === normalizeString(card.practiceAnswer);
}

function appendPracticeReviewLine(parent, label, value) {
  const row = document.createElement("p");
  row.className = "practice-test-review-answer";
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  const text = document.createElement("span");
  text.textContent = value || "Not answered";
    text.style.whiteSpace = "pre-line";
  row.append(strong, text);
  parent.append(row);
}

function finishPracticeTest() {
  if (practiceTimer) clearInterval(practiceTimer);
  practiceTimer = null;
  getElement("practice-test-confirm")?.classList.add("hidden");
  getElement("practice-test-exam")?.classList.add("hidden");
  const results = getElement("practice-test-results");
  results.replaceChildren();
  const correctCount = practiceQuestions.filter((card, index) => practiceAnswerMatches(card, practiceAnswers[index])).length;
  const answeredCount = practiceQuestions.filter((_, index) => practiceResponseText(practiceAnswers[index])).length;
  const percentage = Math.round(correctCount / practiceQuestions.length * 100);
  const heading = document.createElement("div");
  heading.className = "assessment-results-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "modal-eyebrow";
  eyebrow.textContent = "EXAMINATION RESULTS";
  const title = document.createElement("h2");
  title.textContent = "Attempt complete";
  const subtitle = document.createElement("p");
  subtitle.textContent = `${practiceExamTitle || selectedCourseSubject || selectedSubjectMode} · ${practiceQuestions.length} questions`;
  heading.append(eyebrow, title, subtitle);
  const scorePanel = document.createElement("div");
  scorePanel.className = "assessment-results-summary";
  const score = document.createElement("div");
  score.className = "assessment-score";
  score.textContent = `${percentage}%`;
  const scoreCaption = document.createElement("p");
  scoreCaption.textContent = `${correctCount} of ${practiceQuestions.length} correct`;
  const scoreMessage = document.createElement("p");
  scoreMessage.className = "assessment-score-message";
  scoreMessage.textContent = percentage === 100 ? "Excellent work. You answered every question correctly." : percentage >= 80 ? "Strong result. Review the missed questions below." : percentage >= 60 ? "Good progress. Use the review below to strengthen the topics you missed." : "Review the answers below, then try the examination again.";
  scorePanel.append(score, scoreCaption, scoreMessage);
  const stats = document.createElement("div");
  stats.className = "assessment-result-stats";
  [["Correct", correctCount], ["Incorrect", answeredCount - correctCount], ["Unanswered", practiceQuestions.length - answeredCount]].forEach(([label, value]) => {
    const stat = document.createElement("div");
    stat.className = "assessment-result-stat";
    const amount = document.createElement("strong");
    amount.textContent = String(value);
    const caption = document.createElement("span");
    caption.textContent = label;
    stat.append(amount, caption);
    stats.append(stat);
  });
  const reviewHeading = document.createElement("h3");
  reviewHeading.className = "assessment-review-heading";
  reviewHeading.textContent = "Answer review";
  const review = document.createElement("ol");
  review.className = "practice-test-review";
  practiceQuestions.forEach((card, index) => {
    const item = document.createElement("li");
    const response = practiceResponseText(practiceAnswers[index]);
    const isCorrect = practiceAnswerMatches(card, response);
    item.classList.add("practice-test-review-item", isCorrect ? "correct" : response ? "incorrect" : "unanswered");
    const top = document.createElement("div");
    top.className = "practice-test-review-top";
    const number = document.createElement("strong");
    number.textContent = `Question ${index + 1}`;
    const badge = document.createElement("span");
    badge.className = `practice-test-result-badge ${isCorrect ? "correct" : response ? "incorrect" : "unanswered"}`;
    badge.textContent = isCorrect ? "Correct" : response ? "Incorrect" : "Unanswered";
    top.append(number, badge);
    const question = document.createElement("p");
    question.className = "practice-test-review-question";
    question.textContent = card.practiceQuestion || card.question;
    item.append(top, question);
    appendPracticeReviewLine(item, "Your response", response || "Not answered");
    appendPracticeReviewLine(item, "Correct answer", card.practiceAnswer);
    if (card.explanation) appendPracticeReviewLine(item, "Explanation", card.explanation);
    review.append(item);
  });
  const actions = document.createElement("div");
  actions.className = "assessment-results-actions";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "secondary-btn";
  retry.textContent = "Take another examination";
  retry.addEventListener("click", () => {
    results.classList.add("hidden");
    getElement("practice-test-setup").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const back = document.createElement("button");
  back.type = "button";
  back.className = "primary-btn";
  back.textContent = "Return to reviewer";
  back.addEventListener("click", showAppWorkspace);
  actions.append(retry, back);
  results.append(heading, scorePanel, stats, reviewHeading, review, actions);
  results.classList.remove("hidden");
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}
function beginPracticeExam(questions, title) {
  practiceQuestions = questions;
  if (!practiceQuestions.length) return;
  practiceExamTitle = title;
  practiceAnswers = {};
  practiceIndex = 0;
  const difficulty = getElement("practice-test-difficulty")?.value || "medium";
  getElement("practice-test-status")?.classList.add("hidden");
  getElement("practice-test-subject").textContent = `${title} · ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`;
  getElement("practice-test-setup").classList.add("hidden");
  getElement("custom-exam-builder").classList.add("hidden");
  getElement("practice-test-results").classList.add("hidden");
  getElement("practice-test-exam").classList.remove("hidden");
  renderPracticeQuestion();
  const minutes = Number(getElement("practice-test-duration").value) || 0;
  practiceSecondsLeft = minutes * 60;
  const clock = getElement("practice-test-clock");
  if (practiceTimer) clearInterval(practiceTimer);
  const updateClock = () => {
    clock.textContent = minutes ? `${Math.floor(practiceSecondsLeft / 60)}:${String(practiceSecondsLeft % 60).padStart(2, "0")}` : "Untimed";
  };
  updateClock();
  if (minutes) practiceTimer = setInterval(() => {
    practiceSecondsLeft -= 1;
    updateClock();
    if (practiceSecondsLeft <= 0) finishPracticeTest();
  }, 1000);
}

function makeEasyMultiplicationTrueFalseQuestions(count, startIndex = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const first = 2 + (index * 3) % 11;
    const second = 2 + (index * 7 + 1) % 11;
    const product = first * second;
    const isTrue = index % 2 === 0;
    const shownProduct = isTrue ? product : product + 1 + (index % 4);
    const answer = isTrue ? "True" : "False";
    return {
      type: "true-false",
      question: `True or false: ${first} × ${second} = ${shownProduct}.`,
      answer,
      explanation: `${first} × ${second} = ${product}.`,
      practiceQuestion: `True or false: ${first} × ${second} = ${shownProduct}.`,
      practiceType: "choice",
      practiceOptions: ["True", "False"],
      practiceAnswer: answer
    };
  });
}

function makeEasyMultiplicationMultipleChoiceQuestions(count, startIndex = 0) {
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const first = 2 + (index * 5 + 1) % 11;
    const second = 2 + (index * 7 + 3) % 11;
    const product = first * second;
    const options = [...new Set([product, product + 1, Math.max(1, product - 1), product + 10])].sort(() => Math.random() - .5);
    const answer = String(product);
    return {
      type: "multiple-choice",
      question: `What is ${first} × ${second}?`,
      answer,
      explanation: `${first} × ${second} = ${product}.`,
      practiceQuestion: `What is ${first} × ${second}?`,
      practiceType: "choice",
      practiceOptions: options.map(String),
      practiceAnswer: answer
    };
  });
}

getElement("start-practice-test-btn")?.addEventListener("click", () => {
  const status = getElement("practice-test-status");
  status?.classList.add("hidden");
  const requested = getElement("practice-test-count").value;
  const difficulty = getElement("practice-test-difficulty").value || "medium";
  const requestedCount = requested === "all" ? Math.max(cards.length, 10) : Number(requested) || 10;
  let candidates = [];
  if (difficulty === "easy" && selectedSubjectMode === "math") {
    const count = Math.min(121, requestedCount);
    const trueFalseCount = Math.ceil(count / 2);
    const multipleChoiceCount = Math.floor(count / 2);
    candidates = [
      ...makeEasyMultiplicationTrueFalseQuestions(trueFalseCount),
      ...makeEasyMultiplicationMultipleChoiceQuestions(multipleChoiceCount)
    ].sort(() => Math.random() - .5);
  } else {
    const requiredTypes = difficulty === "easy" ? ["true-false", "multiple-choice"] : [difficulty === "medium" ? "identification" : "enumeration"];
    candidates = cards
      .filter(card => requiredTypes.includes(inferCardType(card)))
      .map(card => makePracticeQuestion({ ...card, type: inferCardType(card) }))
      .filter(card => card.practiceAnswer);
    candidates.sort(() => Math.random() - .5);
  }
  if (!candidates.length) {
    if (status) {
      status.textContent = difficulty === "easy"
        ? "This reviewer has no true-or-false or multiple-choice questions. Choose a Math subject for multiplication questions, or create a custom exam."
        : `This reviewer has no ${difficulty === "medium" ? "identification" : "enumeration"} questions for ${difficulty} mode. Add matching cards or create a custom exam.`;
      status.classList.remove("hidden");
    }
    return;
  }
  const count = requested === "all" ? candidates.length : Math.min(candidates.length, requestedCount);
  const subjectName = selectedCourseSubject || `${selectedSubjectMode[0].toUpperCase()}${selectedSubjectMode.slice(1)}`;
  beginPracticeExam(candidates.slice(0, count), `${subjectName} examination`);
});

function updateCustomExamQuestionType() {
  const type = getElement("custom-exam-question-type").value;
  getElement("custom-exam-written-fields").classList.toggle("hidden", type === "multiple-choice" || type === "true-false");
  getElement("custom-exam-choice-fields").classList.toggle("hidden", type !== "multiple-choice");
  getElement("custom-exam-true-false-fields").classList.toggle("hidden", type !== "true-false");
}

function renderCustomExamDraft() {
  const list = getElement("custom-exam-question-list");
  list.replaceChildren();
  customExamDraft.forEach((question, index) => {
    const item = document.createElement("li");
    item.className = "custom-exam-question-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `Question ${index + 1} · ${question.type.replace("-", " ")}`;
    const prompt = document.createElement("p");
    prompt.textContent = question.question;
    content.append(title, prompt);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove question ${index + 1}`);
    remove.addEventListener("click", () => {
      customExamDraft.splice(index, 1);
      renderCustomExamDraft();
    });
    item.append(content, remove);
    list.append(item);
  });
  const count = customExamDraft.length;
  getElement("custom-exam-question-count").textContent = `${count} ${count === 1 ? "question" : "questions"}`;
  getElement("start-custom-exam-btn").disabled = count === 0;
}

getElement("create-custom-exam-btn")?.addEventListener("click", () => {
  getElement("practice-test-setup").classList.add("hidden");
  getElement("custom-exam-builder").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
});
getElement("custom-exam-cancel-btn")?.addEventListener("click", () => {
  getElement("custom-exam-builder").classList.add("hidden");
  getElement("practice-test-setup").classList.remove("hidden");
});
getElement("custom-exam-question-type")?.addEventListener("change", updateCustomExamQuestionType);
getElement("add-custom-exam-question-btn")?.addEventListener("click", () => {
  const question = getElement("custom-exam-question").value.trim();
  const type = getElement("custom-exam-question-type").value;
  const difficulty = getElement("custom-exam-question-difficulty").value;
  const status = getElement("custom-exam-builder-status");
  if (!question) {
    status.textContent = "Write the question before adding it.";
    getElement("custom-exam-question").focus();
    return;
  }
  let customQuestion;
  if (type === "multiple-choice") {
    const options = ["a", "b", "c", "d"].map(letter => getElement(`custom-exam-option-${letter}`).value.trim());
    if (options.some(option => !option) || new Set(options.map(normalizeString)).size !== 4) {
      status.textContent = "Enter four different answer choices.";
      return;
    }
    const answer = options[Number(getElement("custom-exam-correct-option").value)];
    customQuestion = { type, question, answer, practiceQuestion: question, practiceType: "choice", practiceOptions: options, practiceAnswer: answer, difficulty };
  } else if (type === "true-false") {
    const options = ["True", "False"];
    const answer = getElement("custom-exam-true-false-answer").value;
    customQuestion = { type, question, answer, practiceQuestion: question, practiceType: "choice", practiceOptions: options, practiceAnswer: answer, difficulty };
  } else {
    const answer = getElement("custom-exam-answer").value.trim();
    if (!answer) {
      status.textContent = "Enter the correct answer before adding this question.";
      getElement("custom-exam-answer").focus();
      return;
    }
    if (type === "enumeration" && !getEnumerationItems(answer).length) {
      status.textContent = "Enter at least one correct item for the enumeration question.";
      return;
    }
    customQuestion = { type, question, answer, practiceQuestion: question, practiceType: "written", practiceOptions: [], practiceAnswer: answer, difficulty };
  }
  customExamDraft.push(customQuestion);
  getElement("custom-exam-question").value = "";
  getElement("custom-exam-answer").value = "";
  ["a", "b", "c", "d"].forEach(letter => { getElement(`custom-exam-option-${letter}`).value = ""; });
  status.textContent = "Question added to your exam.";
  renderCustomExamDraft();
  getElement("custom-exam-question").focus();
});
getElement("start-custom-exam-btn")?.addEventListener("click", () => {
  if (!customExamDraft.length) return;
  const difficulty = getElement("practice-test-difficulty").value || "medium";
  const questions = customExamDraft.filter(question => question.difficulty === difficulty);
  if (!questions.length) {
    getElement("custom-exam-builder-status").textContent = `Add at least one ${difficulty} question, or change the exam difficulty.`;
    return;
  }
  const title = getElement("custom-exam-title").value.trim() || "Custom examination";
  beginPracticeExam(questions, title);
});
getElement("practice-test-prev")?.addEventListener("click", () => { if (practiceIndex > 0) { practiceIndex--; renderPracticeQuestion(); } });
getElement("practice-test-next")?.addEventListener("click", () => { if (practiceIndex < practiceQuestions.length - 1) { practiceIndex++; renderPracticeQuestion(); } });
getElement("practice-test-submit")?.addEventListener("click", () => {
  const unanswered = practiceQuestions.length - Object.values(practiceAnswers).filter(practiceResponseText).length;
  getElement("practice-test-confirm-message").textContent = unanswered
    ? `There ${unanswered === 1 ? "is" : "are"} ${unanswered} unanswered ${unanswered === 1 ? "question" : "questions"}. Submit the examination anyway?`
    : "Submit your completed examination now? You cannot change your answers afterward.";
  getElement("practice-test-confirm")?.classList.remove("hidden");
});
getElement("practice-test-confirm-no")?.addEventListener("click", () => getElement("practice-test-confirm")?.classList.add("hidden"));
getElement("practice-test-confirm-yes")?.addEventListener("click", finishPracticeTest);

function syncFullscreenToggle() {
  const isFullscreen = document.fullscreenElement === studyPanel || studyPanel.classList.contains("study-fullscreen");
  fullscreenToggle.textContent = isFullscreen ? "Exit fullscreen" : "Fullscreen";
  fullscreenToggle.setAttribute("aria-pressed", String(isFullscreen));
}

if (fullscreenToggle) {
  fullscreenToggle.addEventListener("click", async () => {
    if (document.fullscreenElement === studyPanel) {
      await document.exitFullscreen();
    } else if (studyPanel.classList.contains("study-fullscreen")) {
      studyPanel.classList.remove("study-fullscreen");
    } else if (document.fullscreenEnabled && studyPanel.requestFullscreen) {
      try {
        await studyPanel.requestFullscreen();
      } catch {
        studyPanel.classList.add("study-fullscreen");
      }
    } else {
      studyPanel.classList.add("study-fullscreen");
    }
    syncFullscreenToggle();
  });
}

document.addEventListener("fullscreenchange", syncFullscreenToggle);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && studyPanel.classList.contains("study-fullscreen")) {
    studyPanel.classList.remove("study-fullscreen");
    syncFullscreenToggle();
  }
});

// --- Theme Toggle ---
const APP_THEME_STORAGE_KEY = "sapc-theme";
const themeToggle = getElement("theme-toggle");
const profileThemeChoice = getElement("profile-theme-choice");
function setAppTheme(theme, { persist = true } = {}) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-theme", isDark);
  document.body.classList.toggle("light-theme", !isDark);
  document.body.dataset.theme = isDark ? "dark" : "light";
  const themeLabel = getElement("theme-label");
  if (themeLabel) themeLabel.textContent = isDark ? "Light" : "Dark";
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", `Switch to ${isDark ? "light" : "dark"} theme`);
    themeToggle.title = `Switch to ${isDark ? "light" : "dark"} theme`;
  }
  if (profileThemeChoice && profileThemeChoice.value !== (isDark ? "dark" : "light")) {
    profileThemeChoice.value = isDark ? "dark" : "light";
    profileThemeChoice.refreshThemedSelect?.();
  }
  if (persist) {
    try { localStorage.setItem(APP_THEME_STORAGE_KEY, isDark ? "dark" : "light"); }
    catch { /* Theme still applies for this page even when storage is unavailable. */ }
  }
}
let savedAppTheme = "light";
try { savedAppTheme = localStorage.getItem(APP_THEME_STORAGE_KEY) === "dark" ? "dark" : "light"; }
catch { savedAppTheme = document.body.classList.contains("dark-theme") ? "dark" : "light"; }
setAppTheme(savedAppTheme, { persist: false });
themeToggle?.addEventListener("click", () => {
  setAppTheme(document.body.classList.contains("dark-theme") ? "light" : "dark");
});
profileThemeChoice?.addEventListener("change", () => {
  if (profileThemeChoice.value === "light" || profileThemeChoice.value === "dark") {
    setAppTheme(profileThemeChoice.value);
  }
});

// --- Firebase Authentication & User Session Management ---
let isRegisterMode = false;
const authScreen = getElement("auth-screen");
const authForm = getElement("auth-form");
const authTitle = getElement("auth-title");
const authSubmitBtn = getElement("auth-submit-btn");
const authSwitchBtn = getElement("auth-switch-btn");
const authError = getElement("auth-error");
const authPassword = getElement("auth-password");
const togglePasswordBtn = getElement("toggle-password-btn");
const authPasswordHint = getElement("auth-password-hint");
const authPolicyConsent = getElement("auth-policy-consent");
const termsConsentCheckbox = getElement("terms-consent");
const privacyConsentCheckbox = getElement("privacy-consent");
const CURRENT_TERMS_VERSION = "2026-11-19";
const CURRENT_PRIVACY_VERSION = "2026-11-19";
const POLICY_PENDING_STORAGE_KEY = "sapc.pendingPolicyConsent";
function currentPolicyConsent() {
  return { termsAccepted: true, privacyAccepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION };
}
function policyConsentPayload() {
  if (!termsConsentCheckbox?.checked || !privacyConsentCheckbox?.checked) {
    throw new Error("Please agree to the Terms of Service and Privacy Policy to create an account.");
  }
  return currentPolicyConsent();
}
function setPolicyConsentVisible(visible) {
  authPolicyConsent?.classList.toggle("hidden", !visible);
  if (termsConsentCheckbox) termsConsentCheckbox.required = visible;
  if (privacyConsentCheckbox) privacyConsentCheckbox.required = visible;
}
function policyConsentIsCurrent(consent) {
  return consent?.terms_version === CURRENT_TERMS_VERSION && consent?.privacy_version === CURRENT_PRIVACY_VERSION;
}
async function requireCurrentPolicyConsent() {
  const saved = await window.sapcFirebase.getLegalConsent();
  if (!policyConsentIsCurrent(saved)) { requirePolicyGate(); return false; }
  releasePolicyGate();
  return true;
}
function releasePolicyGate() {
  document.body.classList.remove("consent-required");
  getElement("policy-update-modal")?.classList.add("hidden");
}
function requirePolicyGate() {
  document.body.classList.add("consent-required");
  getElement("policy-update-modal")?.classList.remove("hidden");
  getElement("policy-update-terms")?.focus();
}
getElement("policy-update-accept")?.addEventListener("click", async event => {
  const status = getElement("policy-update-status");
  if (!getElement("policy-update-terms")?.checked || !getElement("policy-update-privacy")?.checked) {
    if (status) status.textContent = "Please accept both documents to continue.";
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  if (status) status.textContent = "Saving your choice…";
  try {
    await window.sapcFirebase.recordLegalConsent(currentPolicyConsent());
    releasePolicyGate();
    window.location.reload();
  } catch (error) { if (status) status.textContent = error.message || "Could not save your choice."; }
  finally { button.disabled = false; }
});
getElement("policy-update-signout")?.addEventListener("click", async () => {
  await window.sapcFirebase?.signOut?.();
  releasePolicyGate();
  checkAuthSession();
});

if (togglePasswordBtn && authPassword) {
  togglePasswordBtn.addEventListener("click", () => {
    const isPassword = authPassword.type === "password";
    authPassword.type = isPassword ? "text" : "password";
    const label = isPassword ? "Hide" : "Show";
    togglePasswordBtn.textContent = label;
    togglePasswordBtn.setAttribute("title", `${label} password`);
    togglePasswordBtn.setAttribute("aria-label", `${label} password`);
  });
}

function validatePasswordComplexity(password) {
  const characterTypes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/];
  const matchedTypes = characterTypes.filter(pattern => pattern.test(password)).length;
  return matchedTypes >= 2;
}

function updateProfileUI(username, picture) {
  const userProfile = getElement("user-profile");
  const userNameDisplay = getElement("user-name-display");
  const userAvatar = getElement("user-avatar");
  const userAvatarImg = getElement("user-avatar-img");

  if (!userProfile) return;

  if (username) {
    if (userNameDisplay) userNameDisplay.textContent = username;

    if (picture && userAvatarImg) {
      userAvatarImg.src = picture;
      userAvatarImg.classList.remove("hidden");
      if (userAvatar) userAvatar.classList.add("hidden");
    } else if (userAvatar) {
      if (userAvatarImg) userAvatarImg.classList.add("hidden");
      userAvatar.textContent = username.charAt(0).toUpperCase();
      userAvatar.classList.remove("hidden");
    }

    userProfile.classList.remove("hidden");
  } else {
    userProfile.classList.add("hidden");
  }
}

function checkAuthSession() {
  const user = window.sapcFirebase?.getCurrentUser();
  if (user) {
    if (authScreen) authScreen.classList.add("hidden");
    document.body.classList.remove("auth-active");
    updateProfileUI(user.displayName || user.email || "Paduan", user.photoURL);
  } else {
    if (authScreen) authScreen.classList.remove("hidden");
    document.body.classList.add("auth-active");
    updateProfileUI(null, null);
  }
}

checkAuthSession();

const logoutBtn = getElement("logout-btn");
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await window.sapcFirebase?.signOut();
    checkAuthSession();
    showLandingPage();
  });
}

if (authSwitchBtn) {
  authSwitchBtn.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    const loginField = getElement("auth-username");
    if (loginField) {
      loginField.placeholder = "Username";
      loginField.autocomplete = "username";
    }
    authTitle.textContent = isRegisterMode ? "Create Account" : "Welcome Paduan";
    setPolicyConsentVisible(isRegisterMode);
    getElement("auth-intro").textContent = isRegisterMode
      ? "Choose a username and password. You can link Google from Settings for optional one-click sign-in and account recovery."
      : "Sign in with your username and password. Existing accounts can also use email.";
    authSubmitBtn.textContent = isRegisterMode ? "Sign Up" : "Log In";
    authSwitchBtn.textContent = isRegisterMode ? "Switch to Login" : "Register";
    authError.classList.add("hidden");

    authPassword.setAttribute("autocomplete", isRegisterMode ? "new-password" : "current-password");
    if (authPasswordHint) {
      authPasswordHint.classList.toggle("hidden", !isRegisterMode);
    }
  });
}

const emailField = getElement("auth-username");
const passwordReset = getElement("password-reset-btn");
if (authForm) {
  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    authError.classList.add("hidden");
    if (!window.sapcFirebase?.configured) {
      authError.textContent = "Firebase is not configured. Add your project values to public/firebase-config.js.";
      authError.classList.remove("hidden");
      return;
    }

    const identifier = getElement("auth-username").value.trim();
    const password = authPassword.value;
    let createdUsername = "";

    if (isRegisterMode && !validatePasswordComplexity(password)) {
      authError.textContent = "Password must include at least 2 of these: uppercase letters, lowercase letters, numbers, or symbols.";
      authError.classList.remove("hidden");
      return;
    }

    let pendingRegistrationUser = null;

    try {
      if (isRegisterMode) {
        const consent = policyConsentPayload();
        const username = identifier.toLowerCase();
        if (!/^(?=.{3,24}$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/.test(username)) {
          throw new Error("Choose a username 3–24 characters long. Use lowercase letters, numbers, dots, underscores, or hyphens, and start and end with a letter or number.");
        }
        if (!(await window.sapcFirebase.isUsernameAvailable(username))) throw new Error("That username is already taken.");
        const accountEmail = `${username}@accounts.sapc.invalid`;
        sessionStorage.setItem(POLICY_PENDING_STORAGE_KEY, JSON.stringify(consent));
        const registration = await window.sapcFirebase.register(accountEmail, password);
        pendingRegistrationUser = registration.user;
        await window.sapcFirebase.saveProfile(window.sapcFirebase.getCurrentUser(), {
          username,
          displayName: username
        });
        await window.sapcFirebase.recordLegalConsent(consent);
        sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
        releasePolicyGate();
        pendingRegistrationUser = null;
        createdUsername = username;
        isRegisterMode = false;
        authTitle.textContent = "Welcome Paduan";
        getElement("auth-intro").textContent = "Sign in with your username and password. Existing accounts can also use email.";
        getElement("auth-username").placeholder = "Username";
        getElement("auth-username").autocomplete = "username";
        authSubmitBtn.textContent = "Log In";
        authSwitchBtn.textContent = "Register";
        setPolicyConsentVisible(false);
        termsConsentCheckbox.checked = false;
        privacyConsentCheckbox.checked = false;
        authPassword.setAttribute("autocomplete", "current-password");
        if (authPasswordHint) authPasswordHint.classList.add("hidden");
      }
      if (!isRegisterMode) {
        const email = await window.sapcFirebase.resolveLoginEmail(identifier);
        await window.sapcFirebase.signIn(email, password);
        checkAuthSession();
        if (!(await requireCurrentPolicyConsent())) return;
        showAppWorkspace();
        if (createdUsername) {
          getElement("app-notice-message").textContent = `Account created. You’re signed in as @${createdUsername}. Link Google later in Settings if you want.`;
          getElement("app-notice").classList.remove("hidden");
        }
      }
    } catch (err) {
      sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
      if (pendingRegistrationUser) {
        try { await pendingRegistrationUser.delete(); } catch (cleanupError) { console.error("Could not roll back incomplete signup:", cleanupError); }
      }
      authError.textContent = err.code === "auth/invalid-credential"
        ? "Invalid email or password."
        : (err.message || "Authentication failed.");
      authError.classList.remove("hidden");
    }
  });
}
getElement("app-notice-dismiss")?.addEventListener("click", () => getElement("app-notice")?.classList.add("hidden"));

const passwordResetBtn = getElement("password-reset-btn");
if (passwordResetBtn) {
  passwordResetBtn.addEventListener("click", async () => {
    if (!window.sapcFirebase?.configured) {
      authError.textContent = "Firebase is not configured yet.";
      authError.classList.remove("hidden");
      return;
    }
    const identifier = getElement("auth-username").value.trim();
    if (!identifier) {
      authError.textContent = "Enter your email address or username first.";
      authError.classList.remove("hidden");
      return;
    }
    try {
      const email = await window.sapcFirebase.resolveLoginEmail(identifier);
      if (email.endsWith("@accounts.sapc.invalid")) {
        throw new Error("This account has no recovery email. If you linked Google in Settings, use Continue with Google to sign in.");
      }
      await window.sapcFirebase.sendPasswordReset(email);
      authError.textContent = "Password reset email sent.";
      authError.classList.remove("hidden");
    } catch (err) {
      authError.textContent = err.message;
      authError.classList.remove("hidden");
    }
  });
}

async function handleGoogleSignIn() {
  setPolicyConsentVisible(true);
  let consent;
  try { consent = policyConsentPayload(); }
  catch (error) {
    authError.textContent = error.message;
    authError.classList.remove("hidden");
    termsConsentCheckbox?.focus();
    return;
  }
  const button = getElement("google-signin-btn");
  if (button?.disabled) return;
  const originalText = button?.textContent || "Continue with Google";
  if (button) {
    button.disabled = true;
    button.textContent = "Connecting to Google…";
  }
  try {
    if (!window.sapcFirebase?.configured) throw new Error("Firebase is not configured yet.");
    sessionStorage.setItem(POLICY_PENDING_STORAGE_KEY, JSON.stringify(consent));
    await window.sapcFirebase.signInWithGoogle();
    await window.sapcFirebase.recordLegalConsent(consent);
    sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
    releasePolicyGate();
    checkAuthSession();
    showAppWorkspace();
  } catch (err) {
    if (window.sapcFirebase?.getCurrentUser?.() && !["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
      sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
      requirePolicyGate();
      const policyStatus = getElement("policy-update-status");
      if (policyStatus) policyStatus.textContent = `Your acceptance could not be recorded. Try again before continuing. (${err.message || "Request failed"})`;
      return;
    }
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
      try {
        await window.sapcFirebase.signInWithGoogleRedirect();
        return;
      } catch (redirectError) {
        err = redirectError;
      }
    }
    sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
    const message = err.code === "auth/unauthorized-domain"
      ? "This website address is not authorized for Google sign-in in Firebase. Add this domain under Firebase Authentication → Settings → Authorized domains."
      : err.message || "Google sign-in could not be completed.";
    showToast("Google Login Error: " + message, "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

window.handleGoogleSignIn = handleGoogleSignIn;
getElement("google-signin-btn")?.addEventListener("click", handleGoogleSignIn);

let presenceIntervalId = null;
let presenceUser = null;
function refreshPresence() {
  if (!presenceUser || document.visibilityState !== "visible") return;
  window.sapcFirebase.updatePresence(presenceUser).catch(error => {
    console.error("Could not update online presence:", error);
  });
}
document.addEventListener("visibilitychange", refreshPresence);

if (window.sapcFirebase?.configured) {
  window.sapcFirebase.completeGoogleRedirect().then(async result => {
    const savedConsent = sessionStorage.getItem(POLICY_PENDING_STORAGE_KEY);
    if (result?.user && savedConsent) {
      try {
        await window.sapcFirebase.recordLegalConsent(JSON.parse(savedConsent));
        sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
        releasePolicyGate();
        checkAuthSession();
        showAppWorkspace();
      } catch (error) {
        sessionStorage.removeItem(POLICY_PENDING_STORAGE_KEY);
        requirePolicyGate();
        const status = getElement("policy-update-status");
        if (status) status.textContent = `Your acceptance could not be recorded. Try again before continuing. (${error.message})`;
      }
    }
  }).catch(error => {
    const message = error.code === "auth/unauthorized-domain"
      ? "This website address is not authorized for Google sign-in in Firebase. Add this domain under Firebase Authentication → Settings → Authorized domains."
      : error.message || "Google sign-in could not be completed.";
    showToast("Google Login Error: " + message, "error");
  });
  window.sapcFirebase.auth.onAuthStateChanged(async user => {
    if (user) {
      activeStorageUserId = user.uid;
      checkAuthSession();
      if (!sessionStorage.getItem(POLICY_PENDING_STORAGE_KEY)) {
        try {
          if (!(await requireCurrentPolicyConsent())) return;
        } catch (error) {
          requirePolicyGate();
          const status = getElement("policy-update-status");
          if (status) status.textContent = `We could not verify your policy acceptance. Please try again later. (${error.message})`;
          return;
        }
      }
      releasePolicyGate();
      cards = [];
      i = 0;
      resetQuizScore();
      loadCardsFromStorage();
      const profile = await window.sapcFirebase.ensureProfile(user);
      presenceUser = user;
      if (presenceIntervalId) window.clearInterval(presenceIntervalId);
      refreshPresence();
      presenceIntervalId = window.setInterval(refreshPresence, 60000);
      checkAuthSession();
      updateProfileUI(profile.displayName || user.email || "Paduan", profile.photoURL || user.photoURL);
      renderProgressDashboard();
      loadFriends();
    } else {
      presenceUser = null;
      if (presenceIntervalId) window.clearInterval(presenceIntervalId);
      presenceIntervalId = null;
      activeStorageUserId = "guest";
      cards = [];
      i = 0;
      resetQuizScore();
      checkAuthSession();
    }
  });
}

// --- Subject API Mode Switcher ---
document.querySelectorAll("#subject-mode-container .subject-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#subject-mode-container .subject-btn").forEach(b => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    selectedSubjectMode = btn.getAttribute("data-subject");
    stopSpeech(true);
    updateSelectionSummary();
    if (cards.length > 0) show(true);
  });
});

// --- Dynamic Strand / Section Renderer ---
const currentPathwayToAcademicStrand = {
  "Academic - STEM": "STEM",
  "Academic - ABM": "ABM",
  "Academic - HUMSS": "HUMSS",
  "TVL - ICT": "TVL-ICT",
  "TVL - Home Economics": "TVL-HE"
};
const academicStrandToCurrentPathway = Object.fromEntries(
  Object.entries(currentPathwayToAcademicStrand).map(([pathway, strand]) => [strand, pathway])
);

function syncAcademicStrandButtons(strand) {
  const container = getElement("strand-container");
  if (!container?.querySelector(`[data-value="${strand}"]`)) return;
  selectedStrand = strand;
  container.querySelectorAll(".selector-badge").forEach(button => {
    const active = button.dataset.value === strand;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncCoursePathwayToAcademicStrand(pathway) {
  if (selectedGrade !== "Grade 12" || getElement("shs-curriculum")?.value !== "current") return;
  const strand = currentPathwayToAcademicStrand[pathway];
  if (strand) syncAcademicStrandButtons(strand);
}

function syncAcademicStrandToCoursePathway(strand) {
  if (selectedGrade !== "Grade 12" || getElement("shs-curriculum")?.value !== "current") return;
  const pathway = academicStrandToCurrentPathway[strand];
  const pathwaySelect = getElement("shs-pathway");
  if (!pathway || !pathwaySelect || pathwaySelect.value === pathway) return;
  pathwaySelect.value = pathway;
  pathwaySelect.refreshThemedSelect?.();
  pathwaySelect.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderStrandSectionOptions() {
  const container = getElement("strand-container");
  const header = getElement("strand-section-header");
  const sub = getElement("strand-section-sub");

  if (!container) return;
  container.replaceChildren();

  const isGrade11 = selectedGrade === "Grade 11";
  const items = isGrade11 ? grade11Sections : grade12Strands;

  header.textContent = isGrade11 ? "Grade 11 Section" : "Academic Strand";
  sub.textContent = isGrade11 ? "Select class section focus:" : "Target testing focus for reviewer:";

  if (!items.includes(selectedStrand)) {
    selectedStrand = items[0];
  }

  items.forEach(itemText => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `selector-badge ${itemText === selectedStrand ? "active" : ""}`;
    btn.setAttribute("aria-pressed", itemText === selectedStrand ? "true" : "false");
    btn.setAttribute("data-value", itemText);

    const textSpan = document.createElement("span");
    textSpan.textContent = itemText;
    btn.append(textSpan);

    btn.addEventListener("click", () => {
      container.querySelectorAll(".selector-badge").forEach(b => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      selectedStrand = itemText;
      syncAcademicStrandToCoursePathway(itemText);
      updateSelectionSummary();
    });

    container.append(btn);
  });

  if (selectedGrade === "Grade 12" && getElement("shs-curriculum")?.value === "current") {
    syncAcademicStrandToCoursePathway(selectedStrand);
  }
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const subjectDisplayNames = {
    general: "General",
    math: "Mathematics",
    filipino: "Filipino",
    science: "Science",
    ict: "ICT",
    he: "Home Economics",
    pe: "Physical Education and Health"
  };
  const modeIndicator = getElement("subject-ai-mode");
  if (modeIndicator) modeIndicator.textContent = `AI mode: ${subjectDisplayNames[selectedSubjectMode] || "General"}`;
  const summary = getElement("selection-summary");
  if (summary) {
    const courseSubject = getElement("shs-subject")?.selectedOptions[0]?.textContent;
    const coursePathway = getElement("shs-pathway")?.value;
    summary.textContent = courseSubject
      ? `Generating for ${selectedGrade} · ${coursePathway} · ${courseSubject}`
      : `Choose a track and subject for ${selectedGrade} (${subjectDisplayNames[selectedSubjectMode]}).`;
  }
}

const shsCourseCatalog = {
  current: {
    "Core subjects": ["Oral Communication", "Reading and Writing", "21st Century Literature from the Philippines and the World", "Contemporary Philippine Arts from the Regions", "Media and Information Literacy", "Empowerment Technologies", "General Mathematics", "Statistics and Probability", "Earth and Life Science", "Physical Science", "Personal Development", "Understanding Culture, Society, and Politics", "Introduction to Philosophy of the Human Person", "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", "Filipino sa Piling Larang (FPL)", "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino (KomFil)", "Practical Research 1", "Practical Research 2", "Physical Education and Health"],
    "Academic - STEM": ["Pre-Calculus", "Basic Calculus", "General Biology 1", "General Biology 2", "General Chemistry 1", "General Chemistry 2", "General Physics 1", "General Physics 2", "Practical Research 1", "Practical Research 2"],
    "Academic - ABM": ["Applied Economics", "Business Mathematics", "Organization and Management", "Principles of Marketing", "Business Finance", "Fundamentals of Accountancy, Business, and Management 1", "Fundamentals of Accountancy, Business, and Management 2", "Entrepreneurship", "Practical Research 1", "Practical Research 2"],
    "Academic - HUMSS": ["Creative Writing", "Creative Nonfiction", "Introduction to World Religions and Belief Systems", "Philippine Politics and Governance", "Community Engagement, Solidarity, and Citizenship", "Disciplines and Ideas in the Social Sciences", "Disciplines and Ideas in the Applied Social Sciences", "Trends, Networks, and Critical Thinking in the 21st Century", "Practical Research 1", "Practical Research 2"],
    "TVL - ICT": ["Computer Systems Servicing"],
    "TVL - Home Economics": ["Cookery", "Bread and Pastry Production", "Food and Beverage Services", "Housekeeping", "Caregiving", "Local Tour Guiding", "Practical Research 1", "Practical Research 2"],
  },
  strengthened: {
    "Core subjects": ["Effective Communication", "Mabisang Komunikasyon", "General Mathematics", "General Science", "Life and Career Skills", "Pag-aaral ng Kasaysayan at Lipunang Pilipino"],
    "Academic - Arts, Social Sciences, and Humanities": ["Arts 1", "Arts 2", "Citizenship and Civic Engagement", "Contemporary Literature 1", "Contemporary Literature 2", "Creative Composition 1", "Creative Composition 2", "Filipino 1 - Wika at Komunikasyon sa Akademikong Filipino", "Filipino 2 - Filipino para sa Larang Teknikal-Propesyonal", "Filipino Identity Through the Arts", "Introduction to Philosophy", "Leadership and Management in the Arts", "Malikhaing Pagsulat", "Philippine Governance", "Social Sciences: Theory and Practice"],
    "Academic - Business and Entrepreneurship": ["Business 1 - Basic Accounting", "Business 2 - Business Finance and Income Taxation", "Business 3 - Business Economics", "Contemporary Marketing", "Entrepreneurship", "Introduction to Organization and Management"],
    "Academic - Science, Technology, Engineering, and Mathematics": ["Biology 1", "Biology 2", "Chemistry 1", "Chemistry 2", "Earth and Space Science 1", "Earth and Space Science 2", "Finite Mathematics 1", "Finite Mathematics 2", "Physics 1", "Physics 2", "Advanced Mathematics", "Basic Calculus", "Pre-Calculus", "Fundamentals of Data Analytics"],
    "Academic - Sports, Health, and Wellness": ["Sports, Health, and Wellness", "Fitness and Recreation", "Practical Research"],
    "TechPro - ICT Support and Computer Programming Technologies": ["Broadband Installation", "Computer Programming (.NET Technology)", "Computer Programming (Java)", "Computer Programming (Oracle Database)", "Computer Systems Servicing", "Contact Center Services"],
    "TechPro - Hospitality and Tourism": ["Bakery Operations", "Events Management Services", "Food and Beverage Operation", "Hotel Operation (Front Office Services)", "Hotel Operation (Housekeeping Services)", "Kitchen Operations", "Tourism Services"]
  }
};
let courseSelections = {};
try { courseSelections = JSON.parse(safeLocalStorageGet("sapc_course_selections", "{}")); } catch {}
function saveCourseSelections() {
  setLocalStorageItem("sapc_course_selections", JSON.stringify(courseSelections));
}
function populateCourseSelect(select, values, placeholder, selected) {
  if (!select) return;
  select.replaceChildren();
  const prompt = document.createElement("option");
  prompt.value = "";
  prompt.textContent = placeholder;
  select.append(prompt);
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  select.value = values.includes(selected) ? selected : "";
}
function activeCourseKey(curriculum, pathway) {
  return `${curriculum}|${pathway}`;
}
function renderShsCourseOptions() {
  const curriculumSelect = getElement("shs-curriculum");
  const pathwaySelect = getElement("shs-pathway");
  const subjectSelect = getElement("shs-subject");
  if (!curriculumSelect || !pathwaySelect || !subjectSelect) return;
  const curriculum = curriculumSelect.value === "strengthened" ? "strengthened" : "current";
  const catalog = shsCourseCatalog[curriculum];
  const pathways = Object.keys(catalog);
  let pathway = courseSelections[`${curriculum}|pathway`] || pathwaySelect.value;
  if (!pathways.includes(pathway)) pathway = "";
  populateCourseSelect(pathwaySelect, pathways, "Choose a track or cluster…", pathway);
  const key = activeCourseKey(curriculum, pathway);
  const subjects = catalog[pathway] || [];
  const subject = courseSelections[key] || (subjectSelect.dataset.courseKey === key ? subjectSelect.value : "");
  populateCourseSelect(subjectSelect, subjects, pathway ? "Choose a subject…" : "Select a track or cluster first…", subject);
  subjectSelect.disabled = !pathway;
  subjectSelect.dataset.courseKey = key;
  selectedCoursePathway = pathway;
  selectedCourseSubject = subjectSelect.value;
  syncCoursePathwayToAcademicStrand(pathway);
  if (pathway) courseSelections[`${curriculum}|pathway`] = pathway;
  saveCourseSelections();
  updateSelectionSummary();
}
let selectedCoursePathway = "";
let selectedCourseSubject = "";
getElement("shs-pathway")?.addEventListener("change", event => {
  const curriculum = getElement("shs-curriculum")?.value || "current";
  courseSelections[`${curriculum}|pathway`] = event.target.value;
  renderShsCourseOptions();
});
getElement("shs-subject")?.addEventListener("change", event => {
  const curriculum = getElement("shs-curriculum")?.value || "current";
  const key = activeCourseKey(curriculum, getElement("shs-pathway")?.value || "");
  selectedCourseSubject = event.target.value;
  if (selectedCourseSubject) courseSelections[key] = selectedCourseSubject;
  else delete courseSelections[key];
  const normalized = `${getElement("shs-pathway")?.value || ""} ${selectedCourseSubject}`.toLowerCase();
  selectedSubjectMode = /physical education|\bpe\b|health education|fitness|sports/.test(normalized) ? "pe"
    : /filipino|komunikasyon|pagsulat|pagbasa/.test(normalized) ? "filipino"
    : /home economics|hospitality|tourism|cookery|bread and pastry|food and beverage|housekeeping|caregiving|local tour guiding|hotel operation|kitchen operations|bakery operations|events management/.test(normalized) ? "he"
    : /ict|computer|programming|web development|broadband|contact center|digital technology|computer systems servicing/.test(normalized) ? "ict"
    : /biology|chemistry|physics|earth and (life|space) science|general science|physical science|natural science/.test(normalized) ? "science"
    : /math|calculus|statistics|accounting|arithmetic|algebra|geometry|data analytics/.test(normalized) ? "math" : "general";
  saveCourseSelections();
  updateSelectionSummary();
});
function syncCurriculumToGrade(grade) {
  const curriculumSelect = getElement("shs-curriculum");
  if (curriculumSelect) {
    curriculumSelect.value = grade === "Grade 11" ? "strengthened" : "current";
    curriculumSelect.refreshThemedSelect?.();
  }
  renderShsCourseOptions();
}
getElement("shs-curriculum")?.addEventListener("change", event => {
  selectedGrade = event.target.value === "strengthened" ? "Grade 11" : "Grade 12";
  document.querySelectorAll("#grade-container .selector-badge").forEach(button => {
    const active = button.dataset.value === selectedGrade;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderStrandSectionOptions();
  renderShsCourseOptions();
});

document.querySelectorAll("#grade-container .selector-badge").forEach(badge => {
  badge.addEventListener("click", () => {
    document.querySelectorAll("#grade-container .selector-badge").forEach(b => {
      b.classList.remove("active");
      b.setAttribute("aria-pressed", "false");
    });
    badge.classList.add("active");
    badge.setAttribute("aria-pressed", "true");
    selectedGrade = badge.getAttribute("data-value");
    syncCurriculumToGrade(selectedGrade);
    renderStrandSectionOptions();
  });
});

syncCurriculumToGrade(selectedGrade);
renderStrandSectionOptions();

// --- Document Processing & File Previews ---
const imageInput = getElement("image");
const uploadDropZone = getElement("upload-drop-zone");
const imagePreviewUrls = new Map();

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic|heif|avif|svg)$/i.test(file.name);
}

function renderImagePreviews() {
  const previewContainer = getElement("image-previews");
  imagePreviewUrls.forEach((url, file) => {
    if (!selectedImages.includes(file)) {
      URL.revokeObjectURL(url);
      imagePreviewUrls.delete(file);
    }
  });
  previewContainer.replaceChildren();
  previewContainer.classList.toggle("hidden", selectedImages.length === 0);

  selectedImages.forEach((file, index) => {
    const preview = document.createElement("div");
    preview.className = "image-preview";

    if (isImageFile(file)) {
      const image = document.createElement("img");
      if (!imagePreviewUrls.has(file)) {
        imagePreviewUrls.set(file, URL.createObjectURL(file));
      }
      image.src = imagePreviewUrls.get(file);
      image.alt = file.name || `Selected image ${index + 1}`;
      preview.append(image);
    } else {
      const docBadge = document.createElement("div");
      docBadge.style.cssText = "display:grid;place-items:center;aspect-ratio:4/3;background:var(--cream);border-radius:4px;font-weight:800;color:var(--primary);font-size:1.1rem;";
      const ext = (file.name.split(".").pop() || "DOC").toUpperCase();
      docBadge.textContent = `\u{1F4C4} ${ext}`;
      preview.append(docBadge);
    }

    const name = document.createElement("span");
    name.className = "image-preview-name";
    name.textContent = file.name || `File ${index + 1}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-image-btn";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      selectedImages = selectedImages.filter((_, fileIndex) => fileIndex !== index);
      setSelectedImages(selectedImages);
    });

    preview.append(name, removeButton);
    previewContainer.append(preview);
  });
}

function setSelectedImages(files) {
  selectedImages = Array.from(files);
  const fileStatus = getElement("file-name");

  if (selectedImages.length === 1) {
    fileStatus.textContent = selectedImages[0].name || "1 file selected";
  } else if (selectedImages.length > 1) {
    fileStatus.textContent = `${selectedImages.length} files selected`;
  } else {
    fileStatus.textContent = "No files selected";
  }

  renderImagePreviews();
}

if (imageInput) {
  imageInput.addEventListener("change", () => {
    setSelectedImages(imageInput.files);
    imageInput.value = "";
  });
}

if (getElement("notes")) {
  getElement("notes").addEventListener("paste", (event) => {
    const pastedFiles = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === "file")
      .map(item => item.getAsFile())
      .filter(Boolean);

    if (pastedFiles.length === 0) return;

    event.preventDefault();
    setSelectedImages([...selectedImages, ...pastedFiles]);
  });
}

if (uploadDropZone) {
  uploadDropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      imageInput.click();
    }
  });

  uploadDropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadDropZone.classList.add("drag-over");
  });

  uploadDropZone.addEventListener("dragleave", (event) => {
    if (!uploadDropZone.contains(event.relatedTarget)) {
      uploadDropZone.classList.remove("drag-over");
    }
  });

  uploadDropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadDropZone.classList.remove("drag-over");
    setSelectedImages([...selectedImages, ...Array.from(event.dataTransfer.files)]);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
}

async function extractTextFromDocument(file, onProgress = () => {}) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const maxPdfPages = 100;
  const maxExtractedCharacters = 10000;

  if (ext === "txt" || file.type === "text/plain") {
    return (await file.text()).trim().slice(0, maxExtractedCharacters);
  }

  if (ext === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    if (!window.mammoth) throw new Error("DOCX library not loaded.");
    const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return String(result.value || "").trim().slice(0, maxExtractedCharacters);
  }

  if (ext === "pdf" || file.type === "application/pdf") {
    if (!window.pdfjsLib) throw new Error("PDF library not loaded.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    if (pdf.numPages > maxPdfPages) {
      throw new Error(`${file.name} has ${pdf.numPages} pages. Please upload a PDF with ${maxPdfPages} pages or fewer.`);
    }
    let extracted = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(" ");
      extracted += `\n--- Page ${pageNum} ---\n${pageText}`;
      if (extracted.length > maxExtractedCharacters) {
        extracted = extracted.slice(0, maxExtractedCharacters);
        break;
      }
    }
    const text = extracted.trim();
    const selectableText = text.replace(/--- Page \d+ ---/g, "").replace(/[^a-z0-9]/gi, "");
    if (selectableText.length >= 80) {
    return text.slice(0, maxExtractedCharacters);
    }
    if (!window.Tesseract) throw new Error("OCR library not loaded. Refresh the page and try again.");
    const maxOcrPages = Math.min(pdf.numPages, 50);
    const worker = await window.Tesseract.createWorker("eng");
    let ocrText = "";
    try {
      for (let pageNum = 1; pageNum <= maxOcrPages; pageNum++) {
        onProgress(`Reading scanned page ${pageNum} of ${maxOcrPages}...`);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.25 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const result = await worker.recognize(canvas);
        ocrText += `\n--- Page ${pageNum} ---\n${result.data.text}`;
        if (ocrText.length >= maxExtractedCharacters) break;
      }
    } finally {
      await worker.terminate();
    }
    const trimmedOcrText = ocrText.trim().slice(0, maxExtractedCharacters);
    const readableOcrText = trimmedOcrText.replace(/--- Page \d+ ---/g, "").replace(/[^a-z0-9]/gi, "");
    if (readableOcrText.length < 20) {
      throw new Error(`${file.name} contains no readable text, even after OCR.`);
    }
    return trimmedOcrText;
  }

  if (ext === "pptx" || file.name.endsWith(".pptx")) {
    if (!window.JSZip) throw new Error("JSZip library not loaded for PPTX.");
    const arrayBuffer = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    const slideFiles = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/i)[1], 10);
        const numB = parseInt(b.match(/slide(\d+)\.xml/i)[1], 10);
        return numA - numB;
      });

    let extracted = "";
    const parser = new DOMParser();

    for (const slidePath of slideFiles) {
      const xmlText = await zip.files[slidePath].async("string");
      const xmlDoc = parser.parseFromString(xmlText, "application/xml");
      const textNodes = Array.from(xmlDoc.getElementsByTagName("a:t"));
      const slideText = textNodes.map(node => node.textContent).join(" ");
      if (slideText.trim()) {
        extracted += `\n--- Slide ---\n${slideText.trim()}`;
      }
    }
    return extracted.trim();
  }

  return "";
}

function typeWriter(element, text, speed = 15) {
  element.textContent = "";
  let index = 0;
  if (typingTimeout) clearTimeout(typingTimeout);

  function type() {
    if (index < text.length) {
      element.textContent += text.charAt(index);
      index++;
      typingTimeout = setTimeout(type, speed);
    }
  }
  type();
}

function cleanQuestionDisplay(text) {
  if (!text) return "";
  return text
    .replace(/(\b\d+[.)]\s*)+$/g, '')
    .replace(/\(\s*(prompt|hint|note|instruction)\s*:.*?\)/gi, '')
    .replace(/^(\s*(true\s*(or|\/)?\s*false|tama\s*(o|\/)?\s*mali|t\s*\/\s*f)\s*[:.-]?\s*)+/gi, '')
    .replace(/[\s(--]*\b(true\s*(or|\/)?\s*false|tama\s*(o|\/)?\s*mali|t\s*\/\s*f)\b[\s)]*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeString(str) {
  if (!str) return "";
  return str.toString()
    .toLowerCase()
    .replace(/^(answer|correct answer|term|definition|key|a)\s*[:.-]\s*/gi, "")
    .replace(/^\s*\d+[\s.)-]+\s*/, "")
    .replace(/[.,;:!?()"'`]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/([a-z])\s+(\d)/gi, "$1$2")
    .replace(/(\d)\s+([a-z])/gi, "$1$2")
    .trim();
}

function checkIdentificationMatch(userTyped, expectedAnswer) {
  const u = normalizeString(userTyped);
  const e = normalizeString(expectedAnswer);
  const compactUser = u.replace(/\s/g, "");
  const compactExpected = e.replace(/\s/g, "");

  if (!u || !e) return false;
  if (u === e || compactUser === compactExpected) return true;
  if (e.includes(u) && u.length >= 2) return true;
  if (u.includes(e) && e.length >= 2) return true;

  return false;
}

function getEnumerationItems(value) {
  return value.split(/\r?\n|[,;]+|(?=\s*\d+[.)]\s+)/)
    .map(item => item.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean)
    .map(normalizeString);
}

// Visual Answer Feedback with Delay
function attachChoiceFeedback(choiceButtons) {
  choiceButtons.forEach(option => {
    option.addEventListener("click", event => {
      event.stopPropagation();
      if (choiceButtons.some(choice => choice.disabled)) return;

      choiceButtons.forEach(choice => { choice.disabled = true; });
      const isCorrect = option.dataset.correct === "true";

      if (!answeredState[i]) {
        answeredState[i] = { isCorrect };
        updateSpacedRepetition(cards[i], isCorrect);
        saveLocalProgress();
        updateScoreUI();
      }

      const cardElem = getElement("card");

      if (isCorrect) {
        option.classList.add("correct");
        cardElem.style.border = "2px solid #2f7544";
        triggerConfetti();

        choiceFlipTimeout = setTimeout(() => {
          stopSpeech(true);
          cardElem.classList.add("flipped");
          cardElem.style.border = "";
          choiceFlipTimeout = null;
        }, 1200);
        return;
      }

      option.classList.add("incorrect");
      cardElem.style.border = "2px solid #a33434";
      triggerWrongXEffect(cardElem);

      const correctChoice = choiceButtons.find(choice => choice.dataset.correct === "true");
      if (correctChoice) correctChoice.classList.add("correct");
      getElement("back").classList.add("revealed-correct");
      
      choiceFlipTimeout = setTimeout(() => {
        stopSpeech(true);
        cardElem.classList.add("flipped");
        cardElem.style.border = "";
        choiceFlipTimeout = null;
      }, 1500);
    });
  });
}

// --- FLASHCARD GENERATOR WITH PROGRESS BAR ---
if (getElement("generate")) {
  getElement("generate").addEventListener("click", async () => {
    const notes = getElement("notes").value;
    const count = Math.min(30, Math.max(1, Number.parseInt(getElement("count")?.value || "10", 10) || 10));
    const difficulty = getElement("difficulty").value;

    const loadingContainer = getElement("generation-loading-container");
    const progressBar = getElement("generation-progress-bar");
    const loadingText = getElement("loading-text");
    const statusElem = getElement("status");

    if (!selectedCoursePathway || !selectedCourseSubject) {
      statusElem.textContent = "Choose a track or cluster and a subject before generating flashcards.";
      getElement("shs-pathway")?.focus();
      return;
    }

    statusElem.textContent = "";
    loadingContainer.classList.remove("hidden");
    progressBar.style.width = "10%";
    loadingText.textContent = notes.trim() || selectedImages.length
      ? `Analyzing ${selectedSubjectMode.toUpperCase()} material & generating cards...`
      : `Building a ${selectedCourseSubject} reviewer...`;
    getElement("generate").disabled = true;

    let progress = 10;
    let aiRequestStartedAt = 0;
    let queuedJobId = "";
    let queuePosition = 0;
    const progressInterval = setInterval(() => {
      if (progress < 88) {
        progress += Math.floor(Math.random() * 6) + 2;
        progressBar.style.width = progress + "%";
      }
      if (queuedJobId) {
        loadingText.textContent = queuePosition > 1
          ? `Your request is #${queuePosition} in line. It will run when earlier requests finish; keep this page open.`
          : queuePosition === 1
            ? "Your request is next in line and will start shortly. Keep this page open."
            : "Your request is being prepared. Keep this page open.";
      } else if (aiRequestStartedAt && Date.now() - aiRequestStartedAt > 2500) {
        loadingText.textContent = "The AI service is working through requests in order. Your request will run when it reaches the front of the line; please keep this page open.";
      }
    }, 280);

    try {
      const imageFiles = selectedImages.filter(isImageFile);
      const docFiles = selectedImages.filter(f => !isImageFile(f));

      let extractedDocsText = "";
      for (const docFile of docFiles) {
        loadingText.textContent = `Reading ${docFile.name}...`;
        let docText;
        try {
          docText = await extractTextFromDocument(docFile, message => {
            loadingText.textContent = message;
          });
        } catch (error) {
          throw new Error(`Could not read ${docFile.name}: ${error.message}`);
        }
        if (docText) {
      extractedDocsText += `\n\n[Content from ${docFile.name}]:\n${String(docText).trim()}`;
        }
      }

      const combinedNotes = (notes + "\n" + extractedDocsText).trim();
      const maxModelInputCharacters = 10000;
      const modelNotes = combinedNotes.length > maxModelInputCharacters
        ? `${combinedNotes.slice(0, maxModelInputCharacters)}\n\n[Remaining material omitted to fit the AI request limit.]`
        : combinedNotes;
      if (modelNotes.length < combinedNotes.length) {
        statusElem.textContent = "The material was shortened to fit the AI request limit.";
      }

      const images = await Promise.all(imageFiles.map(async file => ({
        data: await fileToBase64(file),
        mimeType: file.type || "image/jpeg",
        name: file.name
      })));

      const headers = { "Content-Type": "application/json" };
      const token = await window.sapcFirebase?.getIdToken();
      if (!token) throw new Error("Please sign in before generating flashcards.");
      headers["Authorization"] = `Bearer ${token}`;

      aiRequestStartedAt = Date.now();
      loadingText.textContent = "Sending your request to the AI service...";
      const useSavedQueue = images.length === 0;
      const res = await fetch(apiUrl(useSavedQueue ? "/api/flashcard-jobs" : "/api/flashcards"), {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          notes: modelNotes, 
          count,
          images,
          gradeLevel: selectedGrade,
          academicStrand: selectedCoursePathway || selectedStrand,
          difficulty,
          subjectMode: selectedSubjectMode,
          curriculum: getElement("shs-curriculum")?.value || "current",
          coursePathway: selectedCoursePathway,
          courseSubject: selectedCourseSubject || "General subject"
        }),
      });

      const responseText = await res.text();
      let data = {};
      if (responseText.trim()) {
        try {
          data = JSON.parse(responseText);
        } catch {
          throw new Error(`The flashcard server returned an invalid response (HTTP ${res.status}).`);
        }
      }
      if (!res.ok) {
        const error = new Error(data.error || `Flashcard generation failed (HTTP ${res.status}).`);
        const rawError = data.error || responseText || `HTTP ${res.status}`;
        const isRateLimit = res.status === 429 || data.code === "AI_RATE_LIMIT";
        error.code = isRateLimit ? "AI_RATE_LIMIT" : (data.code || "");
        const retryMatch = String(rawError).match(/try again in\s+([\d.]+)\s*(ms|s|seconds?)?/i);
        const retryValue = retryMatch ? Number(retryMatch[1]) : 0;
        error.retryAfterSeconds = Number(data.retryAfterSeconds)
          || (retryValue > 0 ? Math.ceil(retryValue * (retryMatch[2]?.toLowerCase() === "ms" ? 0.001 : 1)) : 0);
        error.technicalDetails = data.technicalDetails || (isRateLimit ? String(rawError) : "");
        throw error;
      }
      if (useSavedQueue) {
        queuedJobId = data.jobId;
        if (!queuedJobId) throw new Error("The server did not return a generation request ID.");
        let finished = false;
        while (!finished) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const refreshedToken = await window.sapcFirebase?.getIdToken();
          if (!refreshedToken) throw new Error("Please sign in again to check your generation request.");
          const statusResponse = await fetch(apiUrl(`/api/flashcard-jobs/${encodeURIComponent(queuedJobId)}`), {
            headers: { Authorization: `Bearer ${refreshedToken}` }
          });
          const statusText = await statusResponse.text();
          let job = {};
          if (statusText.trim()) {
            try { job = JSON.parse(statusText); }
            catch { throw new Error(`Could not read the generation status (HTTP ${statusResponse.status}).`); }
          }
          if (!statusResponse.ok) {
            if (statusResponse.status >= 500) {
              loadingText.textContent = "Reconnecting to the AI line. Your request is still saved...";
              continue;
            }
            throw new Error(job.error || "Could not check your place in the AI line.");
          }
          if (job.status === "queued") {
            queuePosition = Number(job.position) || 0;
            continue;
          }
          if (job.status === "running") {
            queuePosition = 0;
            loadingText.textContent = "Your request is being generated now. Keep this page open.";
            continue;
          }
          if (job.status === "failed") {
            const error = new Error(job.error || "The AI couldn’t complete this request. Your notes are safe.");
            error.code = job.code || "AI_GENERATION_FAILED";
            error.retryAfterSeconds = Number(job.retryAfterSeconds) || 0;
            throw error;
          }
          if (job.status === "completed" && Array.isArray(job.cards)) {
            data = { cards: job.cards };
            finished = true;
            break;
          }
          throw new Error("The generation request returned an unknown status.");
        }
      }
      if (!Array.isArray(data.cards)) {
        throw new Error("The flashcard server returned no cards.");
      }

      clearInterval(progressInterval);
      progressBar.style.width = "100%";
      loadingText.textContent = "Flashcards generated successfully!";

      cards = data.cards;
      i = 0;
      resetQuizScore();
      saveCardsToStorage();
      getElement("study").classList.remove("hidden");

      setTimeout(() => {
        loadingContainer.classList.add("hidden");
        progressBar.style.width = "0%";
        statusElem.textContent = cards.length < count
          ? `Done! ${cards.length} unique cards ready.`
          : `Done! ${cards.length} cards ready.`;
      }, 700);

      show(true);
    } catch (err) {
      clearInterval(progressInterval);
      loadingContainer.classList.add("hidden");
      progressBar.style.width = "0%";
      statusElem.replaceChildren();
      if (err.code === "AI_RATE_LIMIT") {
        const retryTime = err.retryAfterSeconds > 0
          ? ` Please wait about ${err.retryAfterSeconds} seconds before trying again.`
          : " Please wait a little before trying again.";
        const message = document.createElement("p");
        message.className = "generation-error-message";
        message.textContent = `The AI is busy helping lots of people right now. Your notes are safe; just select Generate flashcards again in a little while.${retryTime}`;
        statusElem.append(message);

        if (err.technicalDetails) {
          const details = document.createElement("details");
          details.className = "generation-error-details";
          const summary = document.createElement("summary");
          summary.textContent = "Technical details (for developers)";
          const pre = document.createElement("pre");
          pre.textContent = err.technicalDetails;
          details.append(summary, pre);
          statusElem.append(details);
        }
      } else if (err.code === "AI_QUEUE_FULL" || err.code === "AI_QUEUE_TIMEOUT") {
        const message = document.createElement("p");
        message.className = "generation-error-message";
        message.textContent = err.code === "AI_QUEUE_FULL"
          ? "There are many requests waiting for the AI right now, so your request wasn’t added to the line. Please wait a bit and try again."
          : "Your request waited in line for too long and was canceled. Your notes are safe; please try again."
        statusElem.append(message);
      } else {
        statusElem.textContent = "Error: " + err.message;
      }
    } finally {
      getElement("generate").disabled = false;
    }
  });
}

function show(stopAuto = true) {
  stopSpeech(stopAuto);
  if (typingTimeout) {
    clearTimeout(typingTimeout);
    typingTimeout = null;
  }
  if (choiceFlipTimeout) {
    clearTimeout(choiceFlipTimeout);
    choiceFlipTimeout = null;
  }

  getElement("quiz-summary").classList.add("hidden");
  getElement("card").classList.remove("hidden");
  getElement("hint-text").classList.remove("hidden");
  getElement("study-controls").classList.remove("hidden");

  const cardElement = getElement("card");
  cardElement.classList.add("reset-flip");
  cardElement.classList.remove("flipped");
  // Commit the unflipped transform before replacing either face. Otherwise
  // the CSS flip transition can briefly reveal the new card's answer.
  void cardElement.offsetWidth;
  getElement("card").style.border = "";
  getElement("back").classList.remove("revealed-correct");
  const answerEntry = getElement("typed-answer-entry");
  answerEntry.replaceChildren();
  answerEntry.classList.add("hidden");

  const front = getElement("front");
  const cleanedQuestion = cleanQuestionDisplay(cards[i].question);
  const questionLines = cleanedQuestion.split(/\r?\n/);
  const optionPattern = /^\s*[A-D][.)]\s+/;
  const firstOptionIndex = questionLines.findIndex(line => optionPattern.test(line));

  const isTrueFalse = cards[i].type === "true-false" || /^(true|false|tama|mali)$/i.test(cards[i].answer.trim());
  const isMultipleChoice = cards[i].type === "multiple-choice" || firstOptionIndex !== -1;
  const isLongQuestion = cleanedQuestion.length > 260 || questionLines.length > 7;
  const isEnumeration = cards[i].type === "enumeration";

  front.replaceChildren();
  front.classList.toggle("multiple-choice", isMultipleChoice);
  front.classList.toggle("true-false", isTrueFalse);
  front.classList.toggle("long-content", isLongQuestion);

  front.append(createAudioControlsGroup(() => cleanedQuestion));

  if (isTrueFalse) {
    const question = document.createElement("div");
    question.className = "question-text";
    front.append(question);
    typeWriter(question, cleanedQuestion);

    const options = document.createElement("div");
    options.className = "choice-options true-false-options";

    const rawAnswerMatch = cards[i].answer.trim().match(/^(true|false|tama|mali)/i);
    const correctAnswer = rawAnswerMatch ? rawAnswerMatch[1].toLowerCase() : normalizeString(cards[i].answer);
    const isFilipinoAnswer = rawAnswerMatch && /^(tama|mali)$/i.test(rawAnswerMatch[1]);
    const labels = isFilipinoAnswer ? ["Tama", "Mali"] : ["True", "False"];

    const choiceButtons = labels.map(choiceText => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "choice-option";
      option.textContent = choiceText;
      
      const choiceNormalized = choiceText.toLowerCase();
      const isMatch = (choiceNormalized === 'true' && correctAnswer === 'true') ||
                      (choiceNormalized === 'false' && correctAnswer === 'false') ||
                      (choiceNormalized === 'tama' && correctAnswer === 'tama') ||
                      (choiceNormalized === 'mali' && correctAnswer === 'mali');

      option.dataset.correct = String(isMatch);
      options.append(option);
      return option;
    });
    attachChoiceFeedback(choiceButtons);
    front.append(options);

  } else if (!isMultipleChoice) {
    const question = document.createElement("div");
    question.className = "question-text";
    front.append(question);
    typeWriter(question, cleanedQuestion);

    const expectedAnswer = isEnumeration
      ? getEnumerationItems(cards[i].answer).sort()
      : [cards[i].answer];

    const form = document.createElement("form");
    form.className = "typed-answer-form";

    const label = document.createElement("label");
    label.htmlFor = "typed-answer-1";
    label.textContent = isEnumeration
      ? `Enter all ${expectedAnswer.length} items, one per box, in any order`
      : "Your answer";

    const answerFields = [];
    let answerControl = isEnumeration ? document.createElement("div") : document.createElement("input");
    if (isEnumeration) answerControl.className = "enumeration-answer-fields";
    
    expectedAnswer.forEach((_, index) => {
      const field = document.createElement("input");
      field.type = "text";
      field.id = `typed-answer-${index + 1}`;
      field.name = `typed-answer-${index + 1}`;
      field.autocomplete = "off";
      field.placeholder = isEnumeration ? "Enter one item" : "Type your answer";
      field.setAttribute("aria-label", isEnumeration ? `Enumeration item ${index + 1}` : "Your answer");
      answerFields.push(field);
      if (isEnumeration) answerControl.append(field);
      else answerControl = field;
    });

    const checkButton = document.createElement("button");
    checkButton.type = "submit";
    checkButton.className = "primary-btn";
    checkButton.textContent = "Check answer";

    const feedback = document.createElement("p");
    feedback.className = "typed-answer-feedback";
    feedback.setAttribute("aria-live", "polite");

    form.addEventListener("submit", event => {
      event.preventDefault();

      let isCorrect = false;
      if (isEnumeration) {
        const submittedAnswer = answerFields
          .map(field => normalizeString(field.value))
          .filter(Boolean)
          .map(answer => answer.replace(/\s/g, ""))
          .sort();
        const normalizedExpectedAnswer = expectedAnswer
          .map(answer => answer.replace(/\s/g, ""))
          .sort();
        isCorrect = submittedAnswer.length === normalizedExpectedAnswer.length &&
          JSON.stringify(submittedAnswer) === JSON.stringify(normalizedExpectedAnswer);
      } else {
        const userTyped = answerFields[0]?.value || "";
        isCorrect = checkIdentificationMatch(userTyped, cards[i].answer);
      }

      if (!answeredState[i]) {
        answeredState[i] = { isCorrect };
        updateSpacedRepetition(cards[i], isCorrect);
        saveLocalProgress();
        updateScoreUI();
      }

      const cardElem = getElement("card");

      if (isCorrect) {
        form.classList.add("is-correct");
        form.classList.remove("is-incorrect");
        cardElem.style.border = "2px solid #2f7544";
        feedback.textContent = "Correct!";
        triggerConfetti();
        answerFields.forEach(field => { field.disabled = true; });
        checkButton.disabled = true;
      } else {
        form.classList.add("is-incorrect");
        form.classList.remove("is-correct");
        cardElem.style.border = "2px solid #a33434";
        feedback.textContent = "Not quite. Try again.";
        triggerWrongXEffect(cardElem);
      }
    });

    form.append(label, answerControl, checkButton, feedback);
    answerEntry.append(form);
    answerEntry.classList.remove("hidden");
  } else {
    const question = document.createElement("div");
    question.className = "question-text";
    front.append(question);

    let mainQuestionText = cleanedQuestion;
    let rawOptions = questionLines.slice(firstOptionIndex);

    if (firstOptionIndex === -1) {
      const matchInline = cleanedQuestion.match(/(.*?)\s+([A-D][.)]\s+.+)/);
      if (matchInline) {
        mainQuestionText = matchInline[1].trim();
        rawOptions = cleanedQuestion.slice(mainQuestionText.length).split(/(?=[A-D][.)]\s+)/).map(s => s.trim()).filter(Boolean);
      }
    } else {
      mainQuestionText = questionLines.slice(0, firstOptionIndex).join("\n").trim();
    }

    typeWriter(question, mainQuestionText);

    const options = document.createElement("div");
    options.className = "choice-options";
    const answer = cards[i].answer.trim();
    const answerLetter = answer.match(/^([A-D])(?:[.)]\s*|$)/i)?.[1]?.toUpperCase();
    const answerText = answer.replace(/^[A-D][.)]\s*/i, "").trim().toLowerCase();
    const choiceButtons = [];

    rawOptions.filter(line => optionPattern.test(line)).forEach(line => {
      const choiceMatch = line.trim().match(/^([A-D])[.)]\s*(.+)$/i);
      const option = document.createElement("button");
      option.type = "button";
      option.className = "choice-option";
      option.textContent = line.trim();
      const isCorrect = answerLetter
        ? choiceMatch?.[1].toUpperCase() === answerLetter
        : choiceMatch?.[2].trim().toLowerCase() === answerText;
      option.dataset.correct = String(Boolean(isCorrect));
      if (choiceMatch) option.dataset.choice = choiceMatch[1].toUpperCase();
      choiceButtons.push(option);
      options.append(option);
    });
    attachChoiceFeedback(choiceButtons);
    front.append(options);
  }

  const back = getElement("back");
  back.replaceChildren();

  back.append(createAudioControlsGroup(() => {
    let fullAnswer = cards[i].answer;
    if (cards[i].explanation) {
      fullAnswer += ". Explanation: " + cards[i].explanation;
    }
    return fullAnswer;
  }));

  const answerLength = cards[i].answer.length + (cards[i].explanation?.length || 0) + (cards[i].sourceExcerpt?.length || 0);
  const answerLineCount = cards[i].answer.split(/\r?\n/).length;
  back.classList.toggle("long-content", answerLength > 260 || answerLineCount > 7);
  
  const answerText = document.createElement("div");
  answerText.className = "answer-result";
  answerText.textContent = cards[i].answer;
  back.append(answerText);

  if (cards[i].explanation) {
    const explanation = document.createElement("p");
    explanation.className = "answer-explanation";
    explanation.textContent = cards[i].explanation;
    back.append(explanation);
  }

  if (cards[i].sourceExcerpt || cards[i].sourceStatus === "unavailable" || cards[i].sourceStatus === "image-source") {
    const source = document.createElement("section");
    const isImageSource = cards[i].sourceStatus === "image-source";
    source.className = `answer-source${cards[i].sourceExcerpt || isImageSource ? " verified" : " unavailable"}`;
    const label = document.createElement("strong");
    label.className = "answer-source-label";
    label.textContent = cards[i].sourceExcerpt ? "Quoted from your study material" : isImageSource ? "Source image" : "Source check";
    source.append(label);
    const quote = document.createElement("blockquote");
    quote.textContent = cards[i].sourceExcerpt
      || (isImageSource
        ? `Generated from: ${(cards[i].sourceFiles || []).join(", ") || "uploaded image"}. No text excerpt is available for image-only sources.`
        : "No exact supporting excerpt could be verified in your notes. Check this answer against your reviewer.");
    source.append(quote);
    back.append(source);
  }

  getElement("counter").textContent = `Card ${i + 1} of ${cards.length}`;
  getElement("bar").style.width = ((i + 1) / cards.length) * 100 + "%";
  updateScoreUI();
  requestAnimationFrame(() => cardElement.classList.remove("reset-flip"));
}

if (getElement("card")) {
  getElement("card").addEventListener("click", () => {
    stopSpeech(true);
    getElement("card").classList.toggle("flipped");
  });
}

if (getElement("next")) {
  getElement("next").addEventListener("click", () => {
    if (i >= cards.length - 1) {
      showDeckSummary();
    } else {
      i++;
      show(true);
    }
  });
}

if (getElement("prev")) {
  getElement("prev").addEventListener("click", () => { 
    i = (i - 1 + cards.length) % cards.length; 
    show(true); 
  });
}

if (getElement("shuffle")) {
  getElement("shuffle").addEventListener("click", () => {
    cards.sort(() => Math.random() - 0.5);
    i = 0;
    resetQuizScore();
    saveCardsToStorage();
    show(true);
  });
}

// --- Cross-Platform Export and Import JSON Flashcards ---
const mainExportBtn = getElement("main-export-btn");
const importFileInput = getElement("import-file-input");

async function handleExportCards() {
  if (cards.length === 0) {
    showToast("No flashcards available to export.", "error");
    return;
  }

  const fileName = `SAPC_Flashcards_${selectedSubjectMode}_${Date.now()}.json`;
  const jsonBlob = new Blob([JSON.stringify({ cards }, null, 2)], { type: "application/json" });
  const file = new File([jsonBlob], fileName, { type: "application/json" });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: 'SAPC Flashcards Export',
        text: 'Here is your exported flashcard deck file.',
        files: [file]
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  const blobUrl = URL.createObjectURL(jsonBlob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", blobUrl);
  downloadAnchor.setAttribute("download", fileName);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(blobUrl);
}

if (mainExportBtn) {
  mainExportBtn.addEventListener("click", handleExportCards);
}

if (importFileInput) {
  importFileInput.addEventListener("change", (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        const newCards = Array.isArray(importedData) ? importedData : importedData.cards;

        const isValidDeck = Array.isArray(newCards) && newCards.length > 0 && newCards.every(card =>
          card && typeof card === "object" &&
          typeof card.question === "string" && card.question.trim() &&
          typeof card.answer === "string" && card.answer.trim()
        );

        if (isValidDeck) {
          cards = newCards;
          i = 0;
          resetQuizScore();
          saveCardsToStorage();
          const studyElement = getElement("study");
          if (studyElement) studyElement.classList.remove("hidden");
          const statusElement = getElement("status");
          if (statusElement) statusElement.textContent = `Successfully imported ${cards.length} cards from JSON!`;
          show(true);
        } else {
          showToast("Invalid flashcard JSON format.", "error");
        }
      } catch (err) {
        showToast("Failed to parse JSON file: " + err.message, "error");
      }
    };

    reader.readAsText(file);
    importFileInput.value = "";
  });
}

// --- Modal Management ---
const cardModal = getElement("card-modal");
const modalTitle = getElement("modal-title");
const modalQuestion = getElement("modal-question");
const modalAnswer = getElement("modal-answer");
const modalCardType = getElement("modal-card-type");

function inferCardType(card) {
  if (["identification", "multiple-choice", "enumeration", "true-false"].includes(card.type)) {
    return card.type;
  }
  return "identification";
}

function updateModalCardTypeFields() {
  document.querySelectorAll(".custom-card-fields").forEach(fields => {
    fields.classList.toggle("hidden", fields.dataset.cardType !== modalCardType.value);
  });
}

if (modalCardType) {
  modalCardType.addEventListener("change", updateModalCardTypeFields);
}

function openModal(isEdit = false) {
  if (!cardModal) return;
  cardModal.classList.remove("hidden");
  
  if (isEdit && cards.length > 0) {
    const card = cards[i];
    const cardType = inferCardType(card);
    const questionLines = card.question.split(/\r?\n/);
    const firstOptionIndex = questionLines.findIndex(line => /^\s*[A-D][.)]\s+/.test(line));

    modalTitle.textContent = "Edit Flashcard";
    modalCardType.value = cardType;
    modalCardType.refreshThemedSelect?.();
    
    modalQuestion.value = cardType === "true-false"
      ? cleanQuestionDisplay(card.question)
      : cardType === "multiple-choice" && firstOptionIndex !== -1
        ? questionLines.slice(0, firstOptionIndex).join("\n").trim()
        : cleanQuestionDisplay(card.question);

    modalAnswer.value = cardType === "identification" ? card.answer : "";
    if (getElement("modal-id-explanation")) {
      getElement("modal-id-explanation").value = cardType === "identification" ? (card.explanation || "") : "";
    }
    getElement("modal-enumeration-answer").value = cardType === "enumeration"
      ? card.answer.split(/\r?\n/).map(line => line.replace(/^\s*\d+[.)]\s*/, "")).join("\n")
      : "";
    getElement("modal-explanation").value = cardType === "true-false" ? (card.explanation || "") : "";
    getElement("modal-mc-explanation").value = cardType === "multiple-choice" ? (card.explanation || "") : "";
    
    const correctOption = card.answer.match(/^\s*([A-D])[.)]\s*/i)?.[1]?.toUpperCase() || "A";
    getElement("modal-correct-option").value = correctOption;
    getElement("modal-correct-option").refreshThemedSelect?.();

    ["a", "b", "c", "d"].forEach((letter) => {
      const optionLine = cardType === "multiple-choice"
        ? questionLines.slice(firstOptionIndex).find(line => new RegExp(`^\\s*${letter}[.)]\\s+`, "i").test(line))
        : null;
      getElement(`modal-option-${letter}`).value = optionLine ? optionLine.replace(/^\s*[A-D][.)]\s+/i, "") : "";
    });

    getElement("modal-true-false-answer").value = /^(false|mali)$/i.test(card.answer.trim()) ? "False" : "True";
    getElement("modal-true-false-answer").refreshThemedSelect?.();
    updateModalCardTypeFields();
    editingIndex = i;
  } else {
    modalTitle.textContent = "Create Custom Flashcard";
    modalCardType.value = "identification";
    modalCardType.refreshThemedSelect?.();
    modalQuestion.value = "";
    modalAnswer.value = "";
    if (getElement("modal-id-explanation")) getElement("modal-id-explanation").value = "";
    getElement("modal-enumeration-answer").value = "";
    getElement("modal-explanation").value = "";
    getElement("modal-mc-explanation").value = "";
    ["a", "b", "c", "d"].forEach(letter => { getElement(`modal-option-${letter}`).value = ""; });
    getElement("modal-correct-option").value = "A";
    getElement("modal-correct-option").refreshThemedSelect?.();
    getElement("modal-true-false-answer").value = "True";
    getElement("modal-true-false-answer").refreshThemedSelect?.();
    updateModalCardTypeFields();
    editingIndex = null;
  }
}

function closeModal() {
  if (cardModal) cardModal.classList.add("hidden");
}

if (getElement("manual-add-btn")) getElement("manual-add-btn").addEventListener("click", () => openModal(false));
if (getElement("edit-card-btn")) getElement("edit-card-btn").addEventListener("click", () => {
  const cardActionsMenu = getElement("card-actions");
  if (cardActionsMenu) cardActionsMenu.open = false;
  openModal(true);
});
if (getElement("close-modal-btn")) getElement("close-modal-btn").addEventListener("click", closeModal);
if (getElement("cancel-modal-btn")) getElement("cancel-modal-btn").addEventListener("click", closeModal);

if (getElement("save-card-btn")) {
  getElement("save-card-btn").addEventListener("click", () => {
    const question = modalQuestion.value.trim();
    const cardType = modalCardType.value;
    if (!question) return showToast("Please enter a question.", "error");

    let card;
    if (cardType === "multiple-choice") {
      const letters = ["A", "B", "C", "D"];
      const choices = letters.map(letter => getElement(`modal-option-${letter.toLowerCase()}`).value.trim());
      if (choices.some(choice => !choice)) return showToast("Please fill in all four choices.", "error");
      const correctOption = getElement("modal-correct-option").value;
      const mcExplanation = getElement("modal-mc-explanation").value.trim();
      card = {
        question: `${question}\n${choices.map((choice, index) => `${letters[index]}. ${choice}`).join("\n")}`,
        answer: `${correctOption}. ${choices[letters.indexOf(correctOption)]}`,
        explanation: mcExplanation,
        type: cardType
      };
    } else if (cardType === "enumeration") {
      const items = getElement("modal-enumeration-answer").value.split(/\r?\n/)
        .map(item => item.replace(/^\s*\d+[.)]\s*/, "").trim())
        .filter(Boolean);
      if (items.length < 2) return showToast("Please enter at least two expected items, one per line.", "error");
      card = { question, answer: items.map((item, index) => `${index + 1}. ${item}`).join("\n"), type: cardType };
    } else if (cardType === "true-false") {
      card = {
        question: question,
        answer: getElement("modal-true-false-answer").value,
        explanation: getElement("modal-explanation").value.trim(),
        type: cardType
      };
    } else {
      const answer = modalAnswer.value.trim();
      const idExplanation = getElement("modal-id-explanation")?.value.trim() || "";
      if (!answer) return showToast("Please enter the answer.", "error");
      card = { question, answer, explanation: idExplanation, type: "identification" };
    }

    if (editingIndex !== null) {
      cards[editingIndex] = card;
    } else {
      cards.push(card);
      i = cards.length - 1;
      getElement("study").classList.remove("hidden");
    }
    saveCardsToStorage();
    show(true);
    closeModal();
  });
}

if (getElement("delete-card-btn")) {
  getElement("delete-card-btn").addEventListener("click", () => {
    const cardActionsMenu = getElement("card-actions");
    if (cardActionsMenu) cardActionsMenu.open = false;

    if (cards.length === 0) return;
    cards.splice(i, 1);
    saveCardsToStorage();
    if (cards.length === 0) {
      getElement("study").classList.add("hidden");
    } else {
      i = Math.max(0, i - 1);
      show(true);
    }
    showToast("Flashcard deleted.", "success");
  });
}

const clearAllCardsBtn = getElement("clear-all-cards-btn");

if (clearAllCardsBtn) {
  clearAllCardsBtn.addEventListener("click", () => {
    const cardActionsMenu = getElement("card-actions");
    if (cardActionsMenu) cardActionsMenu.open = false;

    if (cards.length === 0) {
      showToast("No flashcards available to clear.", "error");
      return;
    }

    cards = [];
    i = 0;
    resetQuizScore();
    localStorage.removeItem(getUserStorageKey("flashcards"));
      
      const studyElement = getElement("study");
      if (studyElement) studyElement.classList.add("hidden");
      
    const statusElement = getElement("status");
    if (statusElement) statusElement.textContent = "All flashcards have been cleared.";
    showToast("All flashcards have been cleared.", "success");
  });
}

function renderProgressDashboard() {
  let progress = {};
  try { progress = JSON.parse(safeLocalStorageGet(getUserStorageKey("progress"), "{}")); } catch {}
  const sessions = Array.isArray(progress.sessions) ? progress.sessions : [];
  const total = sessions.reduce((sum, session) => sum + Number(session.total || 0), 0);
  const correct = sessions.reduce((sum, session) => sum + Number(session.correct || 0), 0);
  const due = cards.filter(card => card.srs && Number(card.srs.dueAt) <= Date.now()).length;
  const dates = new Set(sessions.map(session => String(session.date).slice(0, 10)));
  let streak = 0;
  const day = new Date();
  while (dates.has(day.toISOString().slice(0, 10))) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  const stats = {
    "stat-streak": streak,
    "stat-accuracy": `${total ? Math.round((correct / total) * 100) : 0}%`,
    "stat-sessions": sessions.length,
    "stat-due": due
  };
  Object.entries(stats).forEach(([id, value]) => {
    const element = getElement(id);
    if (element) element.textContent = value;
  });
}

const weakCardsBtn = getElement("weak-cards-btn");
if (weakCardsBtn) weakCardsBtn.addEventListener("click", () => {
  const weakCards = cards.filter(card => {
    const repetitions = Number(card.srs?.repetitions);
    const ease = Number(card.srs?.ease);
    return (Number.isFinite(repetitions) && repetitions === 0)
      || (Number.isFinite(ease) && ease < 2.2);
  });
  const statusElement = getElement("weak-cards-status");
  if (!weakCards.length) {
    if (statusElement) {
      statusElement.textContent = cards.length
        ? "No weak cards yet. Answer a few cards incorrectly to build a focused review."
        : "Generate or import flashcards before starting a focused review.";
    }
    return;
  }
  if (statusElement) statusElement.textContent = "";
  cards = weakCards;
  i = 0;
  resetQuizScore();
  getElement("study").classList.remove("hidden");
  show(true);
});

async function openSharedDeckLink(linkValue) {
  const status = getElement("shared-deck-status");
  try {
    const url = new URL(linkValue.trim(), window.location.origin);
    const shareId = url.searchParams.get("share");
    if (!shareId) throw new Error("That link does not contain a shared deck.");
    if (!window.sapcFirebase?.getSharedDeck) throw new Error("Shared decks are unavailable.");

    const shared = await window.sapcFirebase.getSharedDeck(shareId);
    if (!shared || !Array.isArray(shared.cards) || !shared.cards.length) {
      throw new Error("This shared deck is empty or no longer available.");
    }

    cards = shared.cards;
    selectedSubjectMode = shared.subjectMode || "general";
    activeDeckId = null;
    i = 0;
    resetQuizScore();
    getElement("study").classList.remove("hidden");
    show(true);
    getElement("status").textContent = `Viewing shared deck: ${shared.title || "Shared deck"}`;
    if (status) {
      status.textContent = "Shared deck opened.";
      status.classList.remove("hidden", "error");
      status.classList.add("success");
    }
  } catch (error) {
    if (status) {
      status.textContent = error.message;
      status.classList.remove("hidden", "success");
      status.classList.add("error");
    }
  }
}

getElement("open-shared-deck-btn")?.addEventListener("click", () => {
  const link = getElement("shared-deck-link")?.value || "";
  if (!link.trim()) {
    const status = getElement("shared-deck-status");
    if (status) {
      status.textContent = "Paste a shared deck link first.";
      status.classList.remove("hidden", "success");
      status.classList.add("error");
    }
    return;
  }
  openSharedDeckLink(link);
});

const shareDeckBtn = getElement("share-deck-btn");
if (shareDeckBtn) shareDeckBtn.addEventListener("click", async () => {
  if (!window.sapcFirebase?.configured) {
    showToast("Firebase did not load, so sharing is unavailable. Refresh the page or redeploy the current app files.", "error");
    return;
  }
  const user = window.sapcFirebase?.getCurrentUser();
  if (!user) {
    showToast("Sign in before sharing a deck.", "error");
    return;
  }
  if (!cards.length) {
    showToast("Generate or import flashcards before sharing.", "error");
    return;
  }
  try {
    const shareId = await window.sapcFirebase.createShare(user, {
      title: `${selectedSubjectMode.toUpperCase()} Reviewer`,
      subjectMode: selectedSubjectMode,
      cards
    });
    const link = `${window.location.origin}${window.location.pathname}?share=${shareId}`;
    await navigator.clipboard.writeText(link);
    getElement("status").textContent = "Read-only deck link copied to clipboard.";
  } catch (error) {
    showToast("Could not create share link: " + error.message, "error");
  }
});

function friendName(friend, userId) {
  return friend.fromId === userId ? friend.toName : friend.fromName;
}
function friendId(friend, userId) {
  return friend.fromId === userId ? friend.toId : friend.fromId;
}
function isProfileOnline(profile) {
  const value = profile?.lastSeenAt;
  const timestamp = typeof value?.toMillis === "function" ? value.toMillis() : new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 300000;
}
function appendPresence(identity, profile) {
  const presence = document.createElement("small");
  presence.className = `friend-presence${isProfileOnline(profile) ? " online" : ""}`;
  presence.textContent = isProfileOnline(profile) ? "Online" : "Offline";
  identity.append(presence);
}
function showFriendProfile(profile) {
  const modal = getElement("friend-profile-modal");
  if (!modal) return;
  const name = profile.displayName || "Paduan";
  getElement("friend-profile-title").textContent = name;
  getElement("friend-profile-name").textContent = name;
  getElement("friend-profile-username").textContent = `@${profile.username || "unknown"}`;
  getElement("friend-profile-grade").textContent = profile.gradeLevel || "Student";
  getElement("friend-profile-strand").textContent = profile.strand || "—";
  getElement("friend-profile-bio").textContent = profile.bio || "No bio yet.";
  const avatar = getElement("friend-profile-avatar");
  const photo = getElement("friend-profile-photo");
  avatar.textContent = name.charAt(0).toUpperCase();
  avatar.classList.toggle("hidden", Boolean(profile.photoURL));
  photo.classList.toggle("hidden", !profile.photoURL);
  if (profile.photoURL) {
    photo.src = profile.photoURL;
    photo.alt = `${name}'s profile photo`;
  }
  const presence = getElement("friend-profile-presence");
  presence.className = `friend-presence${isProfileOnline(profile) ? " online" : ""}`;
  presence.textContent = isProfileOnline(profile) ? "Online" : "Offline";
  modal.classList.remove("hidden");
}

  let activeChatProfile = null;
  let activeChatConversationId = "";
  let pendingSafetyReport = null;
  let activeChatPreferences = { nicknames: {}, theme: "default" };
  let chatSubscription = null;
  let chatOpenSequence = 0;
  let chatPendingFiles = [];
  let chatAttachmentPreviewUrls = [];
  let chatAvailableFriends = [];
  let chatInboxEntries = [];
  let chatPresenceUpdatedAt = 0;
  let chatInboxTimer = null;
  let chatTypingUnsubscribe = null;

  function setChatSafetyControlsVisible(profile) {
    const visible = Boolean(profile && profile.type !== "group");
    getElement("chat-report-user-btn")?.classList.toggle("hidden", !visible);
    getElement("chat-block-user-btn")?.classList.toggle("hidden", !visible);
  }

  function returnToChatInbox() {
    if (chatTypingSent && activeChatConversationId) window.sapcFirebase.sendChatTyping?.(activeChatConversationId, false);
    chatTypingSent = false;
    clearTimeout(chatTypingTimer);
    storeChatDraftAndClearComposer();
    chatOpenSequence += 1;
    if (chatSubscription) chatSubscription();
    chatSubscription = null;
    if (chatTypingUnsubscribe) chatTypingUnsubscribe();
    chatTypingUnsubscribe = null;
    stopVoiceRecording(false);
    stopPeerCall();
    activeChatProfile = null;
    activeChatConversationId = "";
    setChatSafetyControlsVisible(null);
    getElement("chat-details-drawer")?.classList.remove("open");
    getElement("chat-details-drawer")?.setAttribute("aria-hidden", "true");
    getElement("chat-details-toggle")?.setAttribute("aria-expanded", "false");
    getElement("chat-modal")?.classList.remove("chat-thread-open", "is-group-composer", "hidden");
    getElement("chat-modal")?.classList.add("chat-thread-empty");
    getElement("chat-empty-state")?.classList.remove("hidden");
    getElement("chat-messages")?.replaceChildren();
    getElement("chat-add-friend-panel")?.classList.add("hidden");
    getElement("chat-add-friend-toggle")?.setAttribute("aria-expanded", "false");
    startChatInboxRefresh();
    refreshChatInbox();
  }

  window.addEventListener("sapc:open-messenger", () => {
    returnToChatInbox();
    getElement("chat-modal")?.classList.add("messenger-page-mode");
    getElement("chat-modal")?.classList.remove("hidden");
    document.body.classList.add("messenger-active");
    const backButton = getElement("close-chat-btn");
    if (backButton) {
      backButton.textContent = "Back to reviewer";
      backButton.setAttribute("aria-label", "Back to reviewer");
    }
  });

  window.addEventListener("sapc:chat-blocked", event => {
    if (event.detail?.conversationId !== activeChatConversationId) return;
    const blockedByCurrentUser = String(event.detail?.blockedBy || "") === String(window.sapcFirebase?.getCurrentUser()?.uid || "");
    returnToChatInbox();
    if (!blockedByCurrentUser) showToast("This conversation is no longer available.", "info");
  });

  function openSafetyReport(report) {
    if (!report?.reportedUserId) return;
    pendingSafetyReport = report;
    getElement("safety-report-category").value = "harassment";
    getElement("safety-report-details").value = "";
    getElement("safety-report-status").textContent = "Reports are stored for project operator review. Do not use this form for emergencies.";
    getElement("safety-report-modal")?.classList.remove("hidden");
    getElement("safety-report-category")?.focus();
  }

  async function renderBlockedUsers() {
    const list = getElement("blocked-users-list");
    if (!list) return;
    list.replaceChildren();
    try {
      const blocked = await window.sapcFirebase.listBlockedUsers();
      if (!blocked.length) { const empty = document.createElement("small"); empty.textContent = "You have not blocked anyone."; list.append(empty); return; }
      blocked.forEach(user => {
        const row = document.createElement("div"); row.className = "blocked-user-row";
        const name = document.createElement("span"); name.textContent = user.displayName || user.username || "User";
        const unblock = document.createElement("button"); unblock.type = "button"; unblock.className = "ghost"; unblock.textContent = "Unblock";
        unblock.addEventListener("click", async () => {
          unblock.disabled = true;
          try { await window.sapcFirebase.unblockUser(user.userId); chatAvailableFriends = []; await renderBlockedUsers(); refreshChatInbox(); showToast("User unblocked.", "success"); }
          catch (error) { unblock.disabled = false; showToast(error.message || "Could not unblock user.", "error"); }
        });
        row.append(name, unblock); list.append(row);
      });
    } catch (error) {
      const message = document.createElement("small"); message.textContent = error.message || "Could not load blocked users."; list.append(message);
    }
  }
  let chatTypingTimer = null;
  let chatTypingSent = false;
  let peerCallSession = null;
  let voiceRecording = null;
  let lastChatTap = { id: "", at: 0 };
  let pendingHighlightMessageId = "";
  let pendingChatReply = null;
  const chatDrafts = new Map();
  const chatAttachmentObjectUrls = new Map();
  const chatThemeNames = new Set(["default", "ocean", "sunset", "mint", "lavender"]);
  function stopPeerCall() {
    peerCallSession?.dispose();
    peerCallSession = null;
    const callButton = getElement("chat-video-call-btn");
    if (callButton) callButton.disabled = true;
    const voiceCallButton = getElement("chat-voice-call-btn");
    if (voiceCallButton) voiceCallButton.disabled = true;
  }
  getElement("chat-video-call-btn")?.addEventListener("click", () => {
    if (!peerCallSession) return;
    peerCallSession.start(false).catch(error => showToast(error.message || "Could not start the call.", "error"));
  });
  getElement("chat-voice-call-btn")?.addEventListener("click", () => {
    if (!peerCallSession) return;
    peerCallSession.start(true).catch(error => showToast(error.message || "Could not start the voice call.", "error"));
  });
  function wavFromPcmChunks(chunks, sampleCount) {
    const dataBytes = sampleCount * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeText = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    writeText(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); writeText(8, "WAVE");
    writeText(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, "data"); view.setUint32(40, dataBytes, true);
    let offset = 44;
    chunks.forEach(chunk => { new Uint8Array(buffer, offset, chunk.byteLength).set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)); offset += chunk.byteLength; });
    return new Blob([buffer], { type: "audio/wav" });
  }
  async function startPcmVoiceCapture(stream, preparedContext = null) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = preparedContext || (AudioContextClass ? new AudioContextClass() : null);
    if (!context?.createScriptProcessor) {
      await context?.close().catch(() => {});
      return null;
    }
    try {
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      const chunks = [];
      let sampleCount = 0;
      processor.onaudioprocess = event => {
        const inputBuffer = event.inputBuffer;
        const inputLength = inputBuffer.length;
        if (!inputLength) return;
        const channelData = Array.from({ length: inputBuffer.numberOfChannels }, (_, index) => inputBuffer.getChannelData(index));
        const outputLength = Math.floor(inputLength * 16000 / context.sampleRate);
        const output = new Int16Array(outputLength);
        const step = context.sampleRate / 16000;
        for (let index = 0; index < outputLength; index += 1) {
          const position = index * step;
          const left = Math.min(Math.floor(position), inputLength - 1);
          const right = Math.min(left + 1, inputLength - 1);
          const fraction = position - left;
          let sample = 0;
          channelData.forEach(channel => { sample += channel[left] + (channel[right] - channel[left]) * fraction; });
          sample /= channelData.length || 1;
          sample = Math.max(-1, Math.min(1, sample));
          output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        chunks.push(output);
        sampleCount += output.length;
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      return {
        chunks,
        get sampleCount() { return sampleCount; },
        async stop() {
          if (this.stopped) return;
          this.stopped = true;
          processor.onaudioprocess = null;
          [source, processor, silentGain].forEach(node => { try { node.disconnect(); } catch {} });
          await context.close().catch(() => {});
        }
      };
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }
  function stopVoiceRecording(save = true) {
    const session = voiceRecording;
    if (!session) return;
    session.save = save;
    voiceRecording = null;
    clearInterval(session.clock);
    clearTimeout(session.limit);
    const button = getElement("chat-voice-record-btn");
    if (button) { button.textContent = "🎙"; button.classList.remove("is-recording"); button.setAttribute("aria-label", "Record a voice message"); button.title = "Record a voice message"; }
    getElement("chat-recording-indicator")?.classList.add("hidden");
    if (session.recorder.state !== "inactive") session.recorder.stop();
  }
  getElement("chat-voice-record-btn")?.addEventListener("click", async event => {
    if (voiceRecording) { stopVoiceRecording(true); return; }
    if (!activeChatProfile || !activeChatConversationId) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      showToast("Voice messages are not supported by this browser.", "error");
      return;
    }
    if (!window.isSecureContext) {
      showToast("Voice messages need a secure connection. Open this chat over HTTPS.", "error");
      return;
    }
    const button = event.currentTarget;
    const recordingConversationId = activeChatConversationId;
    button.disabled = true;
    let preparedAudioContext = null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      if (AudioContextClass?.prototype?.createScriptProcessor) {
        preparedAudioContext = new AudioContextClass();
        preparedAudioContext.resume().catch(() => {});
      }
    } catch {}
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (recordingConversationId !== activeChatConversationId) {
        stream.getTracks().forEach(track => track.stop());
        await preparedAudioContext?.close().catch(() => {});
        return;
      }
      const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm", "audio/ogg"];
      const mimeType = preferredTypes.find(type => MediaRecorder.isTypeSupported?.(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      let pcmCapture = null;
      try { pcmCapture = await startPcmVoiceCapture(stream, preparedAudioContext); preparedAudioContext = null; }
      catch (captureError) { preparedAudioContext = null; console.warn("PCM voice capture unavailable; using browser recorder output:", captureError); }
      const session = { recorder, stream, chunks: [], pcmCapture, conversationId: recordingConversationId, save: true, startedAt: Date.now(), clock: null, limit: null };
      recorder.addEventListener("dataavailable", recordingEvent => { if (recordingEvent.data?.size) session.chunks.push(recordingEvent.data); });
      recorder.addEventListener("error", recordingEvent => {
        session.save = false;
        if (voiceRecording === session) voiceRecording = null;
        clearInterval(session.clock);
        clearTimeout(session.limit);
        session.pcmCapture?.stop().catch(() => {});
        stream.getTracks().forEach(track => track.stop());
        button.textContent = "🎙";
        button.classList.remove("is-recording");
        button.setAttribute("aria-label", "Record a voice message");
        button.title = "Record a voice message";
        getElement("chat-recording-indicator")?.classList.add("hidden");
        const status = getElement("chat-status");
        if (status) { status.textContent = "Recording failed. Please try again."; status.className = "friend-status error"; status.classList.remove("hidden"); }
        showToast(recordingEvent.error?.message || "Recording stopped unexpectedly. Please try again.", "error");
      }, { once: true });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach(track => track.stop());
        await session.pcmCapture?.stop();
        if (!session.save || session.conversationId !== activeChatConversationId) return;
        const type = recorder.mimeType || session.chunks.find(chunk => chunk.type)?.type || mimeType || "audio/webm";
        const recordedBlob = new Blob(session.chunks, { type });
        const hasPcm = Boolean(session.pcmCapture?.sampleCount);
        if (hasPcm ? session.pcmCapture.sampleCount < 1600 : recordedBlob.size < 512) {
          showToast("That recording was too short. Record a little longer and try again.", "error");
          return;
        }
        const status = getElement("chat-status");
        if (status) { status.textContent = "Preparing voice message…"; status.className = "friend-status"; status.classList.remove("hidden"); }
        const playableBlob = hasPcm
          ? wavFromPcmChunks(session.pcmCapture.chunks, session.pcmCapture.sampleCount)
          : recordedBlob;
        const mimeType = hasPcm ? "audio/wav" : (recordedBlob.type || type.split(";")[0] || "audio/webm");
        const extension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
        const clip = new File([playableBlob], `voice-message-${Date.now()}.${extension}`, { type: mimeType });
        addChatFiles([clip]);
        if (!chatPendingFiles.includes(clip)) return;
        if (status) {
          status.textContent = "Voice message ready. Preview it, then press Send.";
          status.className = "friend-status success";
          status.classList.remove("hidden");
        }
      }, { once: true });
      // Prefer periodic chunks; fall back to a final chunk on browsers that
      // reject the timeslice argument.
      try { recorder.start(1000); }
      catch { recorder.start(); }
      voiceRecording = session;
      const status = getElement("chat-status");
      if (status) {
        status.textContent = "Recording… Tap the microphone button again to stop.";
        status.className = "friend-status";
        status.classList.remove("hidden");
      }
      button.textContent = "■";
      button.classList.add("is-recording");
      button.setAttribute("aria-label", "Stop recording voice message");
      button.title = "Stop recording voice message";
      const recordingIndicator = getElement("chat-recording-indicator");
      recordingIndicator?.classList.remove("hidden");
      const updateClock = () => {
        const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
        if (recordingIndicator) recordingIndicator.textContent = `Recording ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} — tap the stop button when finished.`;
      };
      session.clock = setInterval(updateClock, 500);
      session.limit = setTimeout(() => stopVoiceRecording(true), 180_000);
    } catch (error) {
      if (voiceRecording?.conversationId === recordingConversationId) voiceRecording = null;
      await preparedAudioContext?.close().catch(() => {});
      stream?.getTracks().forEach(track => track.stop());
      const status = getElement("chat-status");
      if (status) { status.textContent = error.name === "NotAllowedError" ? "Allow microphone access to record a voice message." : error.message || "Could not start recording."; status.className = "friend-status error"; status.classList.remove("hidden"); }
      showToast(error.name === "NotAllowedError" ? "Allow microphone access to record a voice message." : error.message || "Could not start recording.", "error");
    } finally { button.disabled = false; }
  });
  const chatEmojiCategories = {
    smileys: ["😀|grinning smile happy", "😃|smile happy", "😄|laugh smile", "😁|grin happy", "😆|laughing", "😅|sweat laugh", "😂|tears joy laugh", "🤣|rolling laugh", "🙂|smile", "🙃|upside down", "😉|wink", "😊|blush smile", "😇|halo angel", "😍|love eyes", "🥰|hearts love", "😘|kiss", "😋|yum", "😎|cool sunglasses", "🤩|star struck", "🥳|party", "😭|cry sad", "😢|sad cry", "😮|surprised wow", "😡|angry mad", "🤔|thinking", "🤗|hug", "🥺|pleading", "😴|sleep", "🤯|mind blown", "🤭|giggle"],
    gestures: ["👍|thumbs up like", "👎|thumbs down dislike", "👏|clap", "🙏|pray thanks", "🙌|celebrate", "👋|wave hello", "💪|strong", "🤝|handshake", "🫶|heart hands", "✌️|peace", "👌|okay", "🤟|love you", "🤘|rock", "👊|fist bump", "✊|fist", "🤷|shrug", "🤦|facepalm", "💅|nail polish", "🫡|salute", "🖐️|hand stop"],
    hearts: ["❤️|red heart love", "🧡|orange heart", "💛|yellow heart", "💚|green heart", "💙|blue heart", "💜|purple heart", "🖤|black heart", "🤍|white heart", "🤎|brown heart", "🩷|pink heart", "🩵|light blue heart", "🩶|gray heart", "💕|two hearts", "💞|revolving hearts", "💖|sparkling heart", "💘|heart arrow", "💝|heart gift", "💔|broken heart", "🔥|fire", "✨|sparkles"],
    objects: ["🎉|party celebration", "🎊|confetti", "🎂|birthday cake", "🎓|graduation", "📚|books study", "📖|book", "📝|memo notes", "✏️|pencil", "✅|check", "💯|hundred perfect", "☕|coffee", "📎|paperclip", "💡|idea", "🎁|gift", "🏆|trophy", "⚡|lightning", "🚀|rocket", "💬|speech bubble"],
    nature: ["🌈|rainbow", "☀️|sun", "🌙|moon", "⭐|star", "🌸|flower", "🌻|sunflower", "🌱|seedling", "🍀|clover luck", "🌊|wave", "🐱|cat", "🐶|dog", "🐸|frog", "🦋|butterfly", "🐼|panda", "🦄|unicorn", "🌍|earth"]
  };
  const chatSkinToneCapable = new Set("👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 ✍️ 💅 🤳 💪 🦵 🦶 👂 👃 🫶 🫡 🤷 🤦".split(" "));
  const chatSkinTones = ["", "🏻", "🏼", "🏽", "🏾", "🏿"];
  function chatPreferenceStorageKey(conversationId = activeChatConversationId) {
    const userId = window.sapcFirebase?.getCurrentUser()?.uid || "guest";
    return `sapc.chat.preferences.${userId}.${conversationId}`;
  }
  function loadChatPreferences(conversationId) {
    try {
      const value = JSON.parse(localStorage.getItem(chatPreferenceStorageKey(conversationId)) || "{}");
      const nicknames = value?.nicknames && typeof value.nicknames === "object" ? value.nicknames : {};
      return {
        nicknames,
        theme: chatThemeNames.has(value?.theme) || value?.theme === "custom" ? value.theme : "default",
        customBackground: typeof value?.customBackground === "string" && value.customBackground.startsWith("data:image/") ? value.customBackground : "",
        quickReaction: chatEmojiCategories ? (Object.values(chatEmojiCategories).flat().some(item => item.split("|")[0] === value?.quickReaction) ? value.quickReaction : "👍") : "👍",
        skinTone: chatSkinTones.includes(value?.skinTone) ? value.skinTone : "",
        recentEmojis: Array.isArray(value?.recentEmojis) ? value.recentEmojis.filter(item => typeof item === "string").slice(0, 16) : []
      };
    } catch { return { nicknames: {}, theme: "default", customBackground: "", quickReaction: "👍", skinTone: "", recentEmojis: [] }; }
  }
  function saveChatPreferences() {
    try { localStorage.setItem(chatPreferenceStorageKey(), JSON.stringify(activeChatPreferences)); return true; }
    catch { showToast("Couldn’t save chat preferences on this device. Try a smaller picture.", "error"); return false; }
  }
  function chatDisplayName(member, conversationId = activeChatConversationId) {
    if (!member) return "Paduan";
    const prefs = conversationId === activeChatConversationId ? activeChatPreferences : loadChatPreferences(conversationId);
    return String(prefs.nicknames?.[member.id || member.uid] || member.displayName || member.username || "Paduan");
  }
  function renderChatCustomizationControls() {
    const profile = activeChatProfile;
    const currentUserId = window.sapcFirebase?.getCurrentUser()?.uid;
    const nicknameList = getElement("chat-nickname-list");
    const themePicker = getElement("chat-theme-picker");
    const quickReactionPicker = getElement("chat-custom-reaction");
    const photoThemeControl = document.querySelector(".chat-photo-theme-control");
    const photoThemePreview = getElement("chat-theme-photo-preview");
    const removePhotoThemeButton = getElement("chat-theme-photo-remove");
    if (nicknameList && profile) {
      nicknameList.replaceChildren();
      const members = profile.type === "group" ? (profile.members || []) : [profile];
      members.filter(member => (member.id || member.uid) !== currentUserId).forEach(member => {
        const id = String(member.id || member.uid || "");
        if (!id) return;
        const row = document.createElement("div"); row.className = "chat-nickname-row";
        const label = document.createElement("label"); label.textContent = member.displayName || "Friend"; label.htmlFor = `chat-nickname-${id}`;
        const input = document.createElement("input"); input.id = `chat-nickname-${id}`; input.maxLength = 32; input.placeholder = member.displayName || "Nickname"; input.value = activeChatPreferences.nicknames[id] || "";
        const save = document.createElement("button"); save.type = "button"; save.textContent = "Save";
        save.addEventListener("click", () => {
          const nickname = input.value.trim().slice(0, 32);
          if (nickname) activeChatPreferences.nicknames[id] = nickname;
          else delete activeChatPreferences.nicknames[id];
          saveChatPreferences();
          if (profile.type !== "group") getElement("chat-title").textContent = chatDisplayName(profile);
          renderChatInbox();
          chatSubscription?.refresh?.();
          save.textContent = "Saved"; setTimeout(() => { if (save.isConnected) save.textContent = "Save"; }, 1200);
        });
        row.append(label, input, save); nicknameList.append(row);
      });
      if (!nicknameList.children.length) { const note = document.createElement("small"); note.textContent = "No other participants to rename."; nicknameList.append(note); }
    }
    themePicker?.querySelectorAll("[data-chat-theme-choice]").forEach(button => {
      const theme = button.dataset.chatThemeChoice;
      button.setAttribute("aria-pressed", String(theme === activeChatPreferences.theme));
    });
    const quickButton = getElement("chat-quick-react");
    if (quickButton) { quickButton.textContent = activeChatPreferences.quickReaction || "👍"; quickButton.setAttribute("aria-label", `Send ${activeChatPreferences.quickReaction || "thumbs up"}`); }
    if (quickReactionPicker) {
      quickReactionPicker.replaceChildren();
      ["👍", "❤️", "😂", "😮", "😢", "😡", "👏", "🙏", "🔥", "🥰", "🎉", "💯"].forEach(emoji => {
        const button = document.createElement("button"); button.type = "button"; button.textContent = emoji; button.setAttribute("aria-label", `Set quick reaction to ${emoji}`);
        button.setAttribute("aria-pressed", String(emoji === activeChatPreferences.quickReaction));
        button.addEventListener("click", () => { activeChatPreferences.quickReaction = emoji; saveChatPreferences(); renderChatCustomizationControls(); });
        quickReactionPicker.append(button);
      });
    }
    const modal = getElement("chat-modal");
    if (modal) {
      if (activeChatPreferences.theme === "default") modal.removeAttribute("data-chat-theme");
      else modal.dataset.chatTheme = activeChatPreferences.theme;
      if (activeChatPreferences.theme === "custom" && activeChatPreferences.customBackground) {
        modal.style.setProperty("--chat-custom-image", `url("${activeChatPreferences.customBackground}")`);
      } else modal.style.removeProperty("--chat-custom-image");
    }
    photoThemeControl?.classList.toggle("is-active", activeChatPreferences.theme === "custom" && Boolean(activeChatPreferences.customBackground));
    if (photoThemePreview) {
      photoThemePreview.classList.toggle("hidden", !activeChatPreferences.customBackground);
      if (activeChatPreferences.customBackground) photoThemePreview.src = activeChatPreferences.customBackground;
      else photoThemePreview.removeAttribute("src");
    }
    removePhotoThemeButton?.classList.toggle("hidden", !activeChatPreferences.customBackground);
  }
  async function resolveChatAttachmentMedia(item, user) {
    const url = String(item?.url || "");
    if (!url) throw new Error("This attachment is unavailable.");
    if (!url.includes("/api/chat/attachments/") && !url.includes("/api/data/chat/attachments/")) return url;
    if (chatAttachmentObjectUrls.has(url)) return chatAttachmentObjectUrls.get(url);
    const objectUrl = await window.sapcFirebase.fetchChatAttachment(user, item);
    chatAttachmentObjectUrls.set(url, objectUrl);
    while (chatAttachmentObjectUrls.size > 120) {
      const [oldUrl, oldObjectUrl] = chatAttachmentObjectUrls.entries().next().value;
      chatAttachmentObjectUrls.delete(oldUrl);
      URL.revokeObjectURL(oldObjectUrl);
    }
    return objectUrl;
  }
  async function downloadChatAttachment(item, user) {
    const mediaUrl = await resolveChatAttachmentMedia(item, user);
    const link = document.createElement("a");
    link.href = mediaUrl;
    link.download = String(item.name || "chat-attachment").replace(/[^a-z0-9._-]+/gi, "-").slice(0, 100) || "chat-attachment";
    document.body.append(link);
    link.click();
    link.remove();
  }
  async function downloadChatPhotos(items) {
    const user = window.sapcFirebase?.getCurrentUser();
    for (const item of items) {
      try {
        await downloadChatAttachment(item, user);
        await new Promise(resolve => setTimeout(resolve, 180));
      } catch (error) {
        showToast(`Could not save ${item.name || "photo"}: ${error.message}`, "error");
      }
    }
  }
  function clearChatAttachmentPreview() {
    const preview = getElement("chat-attachment-preview");
    chatAttachmentPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    chatAttachmentPreviewUrls = [];
    if (preview) {
      preview.replaceChildren();
      preview.classList.add("hidden");
    }
  }
  function storeChatDraftAndClearComposer() {
    if (activeChatConversationId && (getElement("chat-input")?.value || chatPendingFiles.length || pendingChatReply)) {
      chatDrafts.set(activeChatConversationId, {
        text: getElement("chat-input")?.value || "",
        files: [...chatPendingFiles],
        replyTo: pendingChatReply
      });
    }
    chatPendingFiles = [];
    clearChatAttachmentPreview();
    if (getElement("chat-input")) getElement("chat-input").value = "";
    getElement("chat-quick-react")?.classList.remove("hidden");
    setChatReply(null);
    getElement("chat-status")?.classList.add("hidden");
  }
  function setChatReply(message) {
    pendingChatReply = message ? {
      messageId: String(message.id || ""),
      senderId: String(message.senderId || ""),
      text: String(message.text || "").trim().slice(0, 240)
    } : null;
    const preview = getElement("chat-reply-preview");
    if (!preview) return;
    preview.classList.toggle("hidden", !pendingChatReply);
    if (!pendingChatReply) return;
    const sender = activeChatProfile?.type === "group"
      ? (activeChatProfile.members?.find(member => member.id === pendingChatReply.senderId)?.displayName || "Group member")
      : (pendingChatReply.senderId === window.sapcFirebase?.getCurrentUser()?.uid ? "You" : activeChatProfile?.displayName || "Message");
    getElement("chat-reply-label").textContent = `Replying to ${sender}`;
    getElement("chat-reply-text").textContent = pendingChatReply.text;
  }
  function restoreChatDraft(conversationId) {
    const draft = chatDrafts.get(conversationId);
    if (getElement("chat-input")) getElement("chat-input").value = draft?.text || "";
    getElement("chat-quick-reactions")?.classList.toggle("hidden", Boolean(draft?.text));
    chatPendingFiles = draft?.files || [];
    setChatReply(draft?.replyTo || null);
    chatDrafts.delete(conversationId);
    renderChatAttachmentPreview();
  }
  getElement("chat-reply-cancel")?.addEventListener("click", () => setChatReply(null));
  function renderChatAttachmentPreview() {
    const preview = getElement("chat-attachment-preview");
    if (!preview) return;
    clearChatAttachmentPreview();
    if (!chatPendingFiles.length) {
      preview.classList.add("hidden");
      return;
    }
    chatPendingFiles.forEach((file, index) => {
      const item = document.createElement("div");
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      item.className = `chat-attachment-item${isImage || isVideo ? "" : " is-file"}${isVideo ? " is-video" : ""}${isAudio ? " is-audio" : ""}`;
      const url = URL.createObjectURL(file);
      chatAttachmentPreviewUrls.push(url);
      if (isImage) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = file.name || "Photo attachment preview";
        image.className = "chat-attachment-thumbnail";
        image.title = file.name;
        item.append(image);
      }
      if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.className = "chat-attachment-thumbnail chat-video-thumbnail";
        video.setAttribute("aria-label", `${file.name} video preview`);
        item.append(video);
      }
      if (isAudio) {
        const audio = document.createElement("audio");
        audio.src = url;
        audio.controls = true;
        audio.preload = "metadata";
        audio.className = "chat-voice-preview-player";
        audio.setAttribute("aria-label", "Preview voice message");
        audio.addEventListener("error", () => {
          if (audio.isConnected) showToast("This recording could not be previewed. Please record it again.", "error");
        }, { once: true });
        item.append(audio);
        audio.load();
      }
      if (!isImage && !isVideo && !isAudio) {
        const name = document.createElement("span");
        name.textContent = isAudio ? "Voice message ready to send" : file.name;
        item.append(name);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-attachment-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        chatPendingFiles.splice(index, 1);
        renderChatAttachmentPreview();
      });
      item.append(remove);
      preview.append(item);
    });
    preview.classList.remove("hidden");
  }
  function addChatFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (files.some(file => file.type === "image/gif" || /\.gif$/i.test(file.name || ""))) {
      const status = getElement("chat-status");
      if (status) { status.textContent = "GIF files aren’t available in chat. Choose a photo or video instead."; status.className = "friend-status error"; status.classList.remove("hidden"); }
      return;
    }
    const next = [...chatPendingFiles, ...files];
    if (next.length > 10) {
      const status = getElement("chat-status");
      if (status) {
        status.textContent = "Choose up to 10 attachments per message.";
        status.className = "friend-status error";
        status.classList.remove("hidden");
      }
      return;
    }
    const tooLarge = files.find(file => file.size > (file.type.startsWith("video/") ? 25 : 10) * 1024 * 1024);
    if (tooLarge) {
      const status = getElement("chat-status");
      if (status) {
        const limit = tooLarge.type.startsWith("video/") ? "25 MB" : "10 MB";
        status.textContent = `${tooLarge.name} is larger than the ${limit} attachment limit.`;
        status.className = "friend-status error";
        status.classList.remove("hidden");
      }
      return;
    }
    chatPendingFiles = next;
    renderChatAttachmentPreview();
  }
  const chatPhotoChoice = getElement("chat-photo-choice");
  getElement("chat-photo-picker-btn")?.addEventListener("click", event => {
    const opening = chatPhotoChoice?.classList.contains("hidden");
    chatPhotoChoice?.classList.toggle("hidden", !opening);
    event.currentTarget.setAttribute("aria-expanded", String(Boolean(opening)));
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".chat-photo-picker-wrap")) {
      chatPhotoChoice?.classList.add("hidden");
      getElement("chat-photo-picker-btn")?.setAttribute("aria-expanded", "false");
    }
    if (!event.target.closest(".chat-message-menu, .chat-message-menu-trigger")) {
      document.querySelectorAll("#chat-messages .chat-message-menu:not(.hidden)").forEach(menu => menu.classList.add("hidden"));
      document.querySelectorAll("#chat-messages .chat-message-menu-trigger[aria-expanded='true']").forEach(trigger => trigger.setAttribute("aria-expanded", "false"));
      getElement("chat-messages")?.removeAttribute("data-open-menu-message-id");
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (getElement("chat-image-viewer") && !getElement("chat-image-viewer").classList.contains("hidden")) return;
    if (chatPhotoChoice && !chatPhotoChoice.classList.contains("hidden")) {
      chatPhotoChoice.classList.add("hidden");
      getElement("chat-photo-picker-btn")?.setAttribute("aria-expanded", "false");
      return;
    }
    if (getElement("chat-modal") && !getElement("chat-modal").classList.contains("hidden")) {
      event.preventDefault();
      getElement("close-chat-btn")?.click();
    }
  });
  function openChatFileInput(id) {
    chatPhotoChoice?.classList.add("hidden");
    getElement("chat-photo-picker-btn")?.setAttribute("aria-expanded", "false");
    const input = getElement(id);
    if (!input) {
      showToast("The photo picker is unavailable. Refresh the page and try again.", "error");
      return;
    }
    input.value = "";
    input.click();
  }
  getElement("chat-take-photo-btn")?.addEventListener("click", () => openChatFileInput("chat-photo-camera-input"));
  getElement("chat-choose-gallery-btn")?.addEventListener("click", () => openChatFileInput("chat-photo-gallery-input"));
  getElement("chat-choose-video-btn")?.addEventListener("click", () => openChatFileInput("chat-video-gallery-input"));
  getElement("chat-choose-file-btn")?.addEventListener("click", () => openChatFileInput("chat-document-input"));
  ["chat-photo-gallery-input", "chat-photo-camera-input", "chat-video-gallery-input", "chat-document-input"].forEach(id => {
    getElement(id)?.addEventListener("change", event => {
      addChatFiles(event.target.files);
      event.target.value = "";
    });
  });
  const chatDropZone = getElement("chat-modal")?.querySelector(".chat-modal-content");
  let chatDragDepth = 0;
  chatDropZone?.addEventListener("dragenter", event => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    chatDragDepth += 1;
    chatDropZone.classList.add("is-dragging-attachment");
  });
  chatDropZone?.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  chatDropZone?.addEventListener("dragleave", event => {
    if (!event.dataTransfer?.types?.includes("Files")) return;
    chatDragDepth = Math.max(0, chatDragDepth - 1);
    if (!chatDragDepth) chatDropZone.classList.remove("is-dragging-attachment");
  });
  chatDropZone?.addEventListener("drop", event => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    chatDragDepth = 0;
    chatDropZone.classList.remove("is-dragging-attachment");
    addChatFiles(event.dataTransfer.files);
  });
  function renderChatMessages(messages, user) {
    const container = getElement("chat-messages");
    if (!user || !container) return;
    const openMenuMessageId = container.dataset.openMenuMessageId || "";
    let restoredOpenMenu = false;
    const latestSeenOwnIndex = messages.reduce((latest, item, index) => {
      const seenByOther = Object.keys(item.seenBy || {}).some(id => id !== item.senderId);
      return item.senderId === user.uid && seenByOther ? index : latest;
    }, -1);
    const shouldStickToBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    container.replaceChildren();
    messages.forEach((message, messageIndex) => {
      const previousMessage = messages[messageIndex - 1];
      const nextMessage = messages[messageIndex + 1];
      const samePrevious = previousMessage && previousMessage.senderId === message.senderId && Math.abs(Date.parse(message.timestamp) - Date.parse(previousMessage.timestamp)) <= 120000;
      const sameNext = nextMessage && nextMessage.senderId === message.senderId && Math.abs(Date.parse(nextMessage.timestamp) - Date.parse(message.timestamp)) <= 120000;
      const groupEnd = !sameNext;
      const row = document.createElement("div");
      row.className = `chat-message-row${message.senderId === user.uid ? " own" : ""}`;
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble${message.senderId === user.uid ? " own" : ""}`;
      bubble.dataset.messageId = String(message.id);
      bubble.classList.toggle("group-middle", Boolean(samePrevious && sameNext));
      bubble.classList.toggle("group-end", groupEnd);
      if (message.replyTo?.text && !message.isUnsent) {
        const reply = document.createElement("div");
        reply.className = "chat-reply-quote";
        const replySender = activeChatProfile?.type === "group"
          ? chatDisplayName(activeChatProfile.members?.find(member => member.id === message.replyTo.senderId))
          : (message.replyTo.senderId === user.uid ? "You" : chatDisplayName(activeChatProfile));
        const replyLabel = document.createElement("strong");
        replyLabel.textContent = `Reply to ${replySender}`;
        const replyText = document.createElement("span");
        replyText.textContent = message.replyTo.text;
        reply.append(replyLabel, replyText);
        reply.setAttribute("role", "button");
        reply.tabIndex = 0;
        const jumpToOriginal = () => {
          const original = Array.from(container.querySelectorAll("[data-message-id]")).find(node => node.dataset.messageId === String(message.replyTo.messageId));
          original?.scrollIntoView({ behavior: "smooth", block: "center" });
          original?.classList.add("chat-message-highlight");
          setTimeout(() => original?.classList.remove("chat-message-highlight"), 1200);
        };
        reply.addEventListener("click", jumpToOriginal);
        reply.addEventListener("keydown", event => { if (event.key === "Enter") jumpToOriginal(); });
        bubble.append(reply);
      }
      if (activeChatProfile?.type === "group" && message.senderId !== user.uid && groupEnd && !message.isUnsent) {
        const sender = activeChatProfile.members?.find(member => member.id === message.senderId);
        const senderName = document.createElement("strong");
        senderName.className = "chat-sender-name";
        senderName.textContent = chatDisplayName(sender);
        bubble.append(senderName);
      }
      if (message.text) {
        const text = document.createElement("div");
        const urlPattern = /https?:\/\/[^\s]+/g;
        let cursor = 0;
        String(message.text).replace(urlPattern, (url, offset) => {
          text.append(document.createTextNode(String(message.text).slice(cursor, offset)));
          const link = document.createElement("a");
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = url;
          text.append(link);
          cursor = offset + url.length;
          return url;
        });
        text.append(document.createTextNode(String(message.text).slice(cursor)));
        bubble.append(text);
      }
      const attachments = Array.isArray(message.attachments) && message.attachments.length
        ? message.attachments
        : (message.attachment ? [message.attachment] : []);
      if (message.isUnsent) {
        bubble.replaceChildren();
        const unsent = document.createElement("span");
        unsent.className = "chat-unsent-message";
        unsent.textContent = "This message was unsent.";
        bubble.append(unsent);
      }
      const visibleAttachments = message.isUnsent ? [] : attachments;
      if (message.senderId !== user.uid && message.text && !visibleAttachments.length && !message.isUnsent) {
        let swipeStart = null;
        bubble.addEventListener("touchstart", event => {
          const touch = event.changedTouches[0];
          swipeStart = { x: touch.clientX, y: touch.clientY };
        }, { passive: true });
        bubble.addEventListener("touchend", event => {
          if (!swipeStart) return;
          const touch = event.changedTouches[0];
          const dx = touch.clientX - swipeStart.x;
          const dy = touch.clientY - swipeStart.y;
          swipeStart = null;
          if (dx > 58 && Math.abs(dx) > Math.abs(dy) * 1.35) {
            setChatReply(message);
            getElement("chat-input")?.focus();
          }
        }, { passive: true });
      }
      const photoAttachments = visibleAttachments.filter(item => String(item.mimeType || "").startsWith("image/"));
      const imageBatch = photoAttachments.length > 1;
      const imageGrid = imageBatch ? document.createElement("div") : bubble;
      if (photoAttachments.length) bubble.classList.add("has-image-attachment");
      if (imageBatch) {
        imageGrid.className = `chat-image-grid count-${Math.min(photoAttachments.length, 4)}`;
        photoAttachments.slice(0, 4).forEach((_, index) => imageGrid.classList.add(`image-${index + 1}`));
      }
      visibleAttachments.forEach(item => {
        const isImage = String(item.mimeType || "").startsWith("image/");
        const isVideo = String(item.mimeType || "").startsWith("video/");
        const isAudio = String(item.mimeType || "").startsWith("audio/");
        if (isImage) {
          const attachment = document.createElement("img");
          attachment.className = "chat-attachment chat-inline-image";
          attachment.alt = item.name || "Photo shared in chat";
          attachment.tabIndex = 0;
          attachment.setAttribute("role", "button");
          attachment.chatAttachmentItem = item;
          attachment.chatGalleryItems = photoAttachments;
          attachment.setAttribute("aria-label", `View photo ${photoAttachments.indexOf(item) + 1} of ${photoAttachments.length}: ${attachment.alt}`);
          resolveChatAttachmentMedia(item, user).then(mediaUrl => {
            if (attachment.isConnected) attachment.src = mediaUrl;
          }).catch(error => {
            if (attachment.isConnected) attachment.alt = `${attachment.alt} (could not load)`;
            console.error("Could not load chat image:", error.message);
          });
          attachment.addEventListener("click", () => {
            if (attachment.src) openChatImageViewer(attachment, photoAttachments, photoAttachments.indexOf(item));
          });
          attachment.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openChatImageViewer(attachment, photoAttachments, photoAttachments.indexOf(item));
            }
          });
          if (!imageBatch) bubble.append(attachment);
          else if (photoAttachments.indexOf(item) < 4) imageGrid.append(attachment);
        } else if (isVideo) {
          const video = document.createElement("video");
          video.className = "chat-inline-video";
          video.controls = true;
          video.playsInline = true;
          video.preload = "none";
          video.hidden = true;
          video.setAttribute("aria-label", item.name || "Video shared in chat");
          video.addEventListener("click", () => openChatVideoLightbox(item));
          const loadVideo = document.createElement("button");
          loadVideo.type = "button";
          loadVideo.className = "chat-video-load-btn";
          loadVideo.textContent = `▶ Load video${item.size ? ` · ${(item.size / 1048576).toFixed(1)} MB` : ""}`;
          loadVideo.addEventListener("click", async () => {
            loadVideo.disabled = true;
            loadVideo.textContent = "Loading video…";
            try {
              video.src = await resolveChatAttachmentMedia(item, user);
              video.hidden = false;
              loadVideo.remove();
              video.load();
            } catch (error) {
              loadVideo.disabled = false;
              loadVideo.textContent = "Retry loading video";
              showToast(`Could not load video: ${error.message}`, "error");
            }
          });
          bubble.classList.add("has-video-attachment");
          bubble.append(loadVideo, video);
        } else if (isAudio) {
          const loadAudio = document.createElement("button");
          loadAudio.type = "button";
          loadAudio.className = "chat-voice-load-btn";
          loadAudio.textContent = "Load voice message";
          loadAudio.addEventListener("click", async () => {
            loadAudio.disabled = true;
            loadAudio.textContent = "Loading voice message…";
            try {
              const audio = document.createElement("audio");
              audio.className = "chat-inline-audio";
              audio.controls = true;
              audio.preload = "metadata";
              audio.setAttribute("aria-label", "Voice message");
              audio.src = await resolveChatAttachmentMedia(item, user);
              loadAudio.replaceWith(audio);
            } catch (error) {
              loadAudio.disabled = false;
              loadAudio.textContent = "Retry loading voice message";
              showToast(`Could not load voice message: ${error.message}`, "error");
            }
          });
          bubble.classList.add("has-audio-attachment");
          bubble.append(loadAudio);
        } else {
          const attachment = document.createElement("a");
          attachment.className = "chat-attachment";
          attachment.textContent = `Open ${item.name || "attachment"}`;
          if (String(item.url || "").includes("/api/chat/attachments/") || String(item.url || "").includes("/api/data/chat/attachments/")) {
            attachment.href = "#";
            attachment.addEventListener("click", async event => {
              event.preventDefault();
              try { await downloadChatAttachment(item, user); }
              catch (error) { showToast(`Could not open attachment: ${error.message}`, "error"); }
            });
          } else {
            attachment.href = item.url;
            attachment.target = "_blank";
            attachment.rel = "noopener noreferrer";
          }
          bubble.append(attachment);
        }
      });
      if (imageBatch) {
        if (photoAttachments.length > 4) {
          const more = document.createElement("span");
          more.className = "chat-image-overflow";
          more.textContent = `+${photoAttachments.length - 4}`;
          more.setAttribute("aria-hidden", "true");
          imageGrid.append(more);
        }
        bubble.append(imageGrid);
      }
      const downloadableMedia = visibleAttachments.filter(item => /^(image|video)\//.test(String(item.mimeType || "")));
      const canUnsend = message.senderId === user.uid && !message.isUnsent;
      const canReply = Boolean(message.text) && !message.isUnsent;
      if (downloadableMedia.length || canUnsend || canReply || !message.isUnsent) {
        bubble.classList.add("has-message-menu");
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "chat-message-menu-trigger";
        trigger.textContent = "⋯";
        trigger.setAttribute("aria-label", "Message options");
        trigger.setAttribute("aria-expanded", "false");
        const menu = document.createElement("div");
        menu.className = "chat-message-menu hidden";
        trigger.addEventListener("click", event => {
          event.stopPropagation();
          const opening = menu.classList.contains("hidden");
          container.querySelectorAll(".chat-message-menu:not(.hidden)").forEach(openMenu => openMenu.classList.add("hidden"));
          container.querySelectorAll(".chat-message-menu-trigger[aria-expanded='true']").forEach(openTrigger => openTrigger.setAttribute("aria-expanded", "false"));
          menu.classList.toggle("hidden", !opening);
          trigger.setAttribute("aria-expanded", String(opening));
          if (opening) container.dataset.openMenuMessageId = String(message.id || "");
          else container.removeAttribute("data-open-menu-message-id");
        });
        if (downloadableMedia.length) {
          const save = document.createElement("button");
          save.type = "button";
          save.textContent = downloadableMedia.length > 1 ? "Save photos and videos" : (downloadableMedia[0].mimeType.startsWith("video/") ? "Save video" : "Save photo");
          save.addEventListener("click", async () => {
            menu.classList.add("hidden");
            await downloadChatPhotos(downloadableMedia);
          });
          menu.append(save);
        }
        if (canReply) {
          const reply = document.createElement("button");
          reply.type = "button";
          reply.textContent = "Reply";
          reply.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            menu.classList.add("hidden");
            trigger.setAttribute("aria-expanded", "false");
            container.removeAttribute("data-open-menu-message-id");
            setChatReply(message);
            getElement("chat-input")?.focus();
          });
          menu.append(reply);
        }
        const reactionButton = document.createElement("button");
        reactionButton.type = "button"; reactionButton.textContent = "React";
        reactionButton.addEventListener("click", () => {
          const picker = document.createElement("div"); picker.className = "chat-reaction-picker";
        [activeChatPreferences.quickReaction || "👍", "❤️", "😂", "😮", "😢", "😡", "👍"].filter((emoji, index, all) => all.indexOf(emoji) === index).slice(0, 6).forEach(emoji => {
            const choice = document.createElement("button"); choice.type = "button"; choice.textContent = emoji;
            choice.setAttribute("aria-label", `React ${emoji}`);
            choice.addEventListener("click", async event => {
              event.stopPropagation(); picker.remove();
              try { await window.sapcFirebase.toggleChatReaction(activeChatConversationId, message.id, emoji); }
              catch (error) { showToast(`Could not add reaction: ${error.message}`, "error"); }
            });
            picker.append(choice);
          });
          bubble.querySelector(".chat-reaction-picker")?.remove(); bubble.append(picker);
        });
        menu.prepend(reactionButton);
        if (message.senderId !== user.uid && !message.isUnsent) {
          const report = document.createElement("button");
          report.type = "button";
          report.textContent = "Report message";
          report.addEventListener("click", () => {
            menu.classList.add("hidden");
            openSafetyReport({ reportedUserId: message.senderId, conversationId: activeChatConversationId, messageId: message.id });
          });
          menu.append(report);
        }
        if (canUnsend) {
          const unsend = document.createElement("button");
          unsend.type = "button";
          unsend.textContent = "Unsend message";
          unsend.addEventListener("click", async () => {
            menu.classList.add("hidden");
            try {
              await window.sapcFirebase.unsendChatMessage(user, activeChatConversationId, message.id);
            } catch (error) {
              const status = getElement("chat-status");
              if (status) { status.textContent = `Could not unsend: ${error.message}`; status.className = "friend-status error"; status.classList.remove("hidden"); }
            }
          });
          menu.append(unsend);
        }
        if (openMenuMessageId && openMenuMessageId === String(message.id || "")) {
          menu.classList.remove("hidden");
          trigger.setAttribute("aria-expanded", "true");
          restoredOpenMenu = true;
        }
        bubble.append(trigger, menu);
      }
      const reactions = message.reactions && typeof message.reactions === "object" ? message.reactions : {};
      const reactionEntries = Object.entries(reactions).filter(([, ids]) => Array.isArray(ids) && ids.length);
      if (reactionEntries.length) {
        const pills = document.createElement("div"); pills.className = "chat-reaction-pills";
        reactionEntries.forEach(([emoji, ids]) => {
          const pill = document.createElement("button"); pill.type = "button"; pill.className = "chat-reaction-pill";
          pill.textContent = `${emoji} ${ids.length}`; pill.setAttribute("aria-label", `${emoji} reaction from ${ids.length} people`);
          pill.classList.toggle("selected", ids.map(String).includes(user.uid));
          pill.addEventListener("click", () => window.sapcFirebase.toggleChatReaction(activeChatConversationId, message.id, emoji).catch(error => showToast(error.message, "error")));
          pills.append(pill);
        });
        bubble.append(pills);
      }
      let tapTimer = 0;
      bubble.addEventListener("dblclick", () => {
        if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
          window.sapcFirebase.toggleChatReaction(activeChatConversationId, message.id, "❤️").catch(() => {});
        }
      });
      bubble.addEventListener("pointerup", event => {
        if (event.pointerType !== "touch") return;
        const now = Date.now();
        if (lastChatTap.id === String(message.id) && now - lastChatTap.at < 330) {
          clearTimeout(tapTimer); lastChatTap = { id: "", at: 0 };
          window.sapcFirebase.toggleChatReaction(activeChatConversationId, message.id, "❤️").catch(() => {});
        } else { lastChatTap = { id: String(message.id), at: now }; tapTimer = setTimeout(() => { lastChatTap = { id: "", at: 0 }; }, 350); }
      });
      const meta = document.createElement("small");
      const timestamp = new Date(message.timestamp || Date.now());
      const seenIds = Object.keys(message.seenBy || {}).filter(id => id !== message.senderId);
      const status = message.senderId === user.uid && messageIndex === latestSeenOwnIndex ? "Seen"
        : message.senderId === user.uid && messageIndex === messages.length - 1 ? "Delivered" : "";
      meta.textContent = `${timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${status ? ` · ${status}` : ""}`;
      meta.className = "chat-meta";
      bubble.append(meta);
      if (groupEnd && message.senderId !== user.uid) {
        const sender = activeChatProfile?.type === "group" ? activeChatProfile.members?.find(member => member.id === message.senderId) : activeChatProfile;
        row.append(chatAvatarNode(sender, "chat-message-avatar"), bubble);
      } else {
        const spacer = document.createElement("span"); spacer.className = "chat-message-avatar spacer";
        if (message.senderId === user.uid) row.append(bubble, spacer);
        else row.append(spacer, bubble);
      }
      container.append(row);
      if (message.senderId === user.uid && groupEnd && seenIds.length && messageIndex === latestSeenOwnIndex) {
        const receipt = document.createElement("span"); receipt.className = "chat-seen-avatars";
        seenIds.slice(0, 4).forEach(id => {
          const member = activeChatProfile?.type === "group"
            ? activeChatProfile.members?.find(item => String(item.id || item.uid) === String(id))
            : [activeChatProfile, ...chatAvailableFriends].find(item => String(item?.id || item?.uid) === String(id));
          const name = chatDisplayName(member);
          if (member?.photoURL) {
            const image = document.createElement("img");
            image.className = "chat-seen-avatar";
            image.src = member.photoURL;
            image.alt = `${name} saw this`;
            image.title = `${name} saw this`;
            image.loading = "lazy";
            receipt.append(image);
          } else {
            const initials = document.createElement("span");
            initials.className = "chat-seen-avatar";
            initials.textContent = name.charAt(0).toUpperCase();
            initials.title = `${name} saw this`;
            receipt.append(initials);
          }
        });
        container.append(receipt);
      }
      if (pendingHighlightMessageId && String(message.id) === pendingHighlightMessageId) {
        bubble.classList.add("chat-message-highlight");
        bubble.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => bubble.classList.remove("chat-message-highlight"), 1200);
        pendingHighlightMessageId = "";
      }
    });
    if (openMenuMessageId && !restoredOpenMenu) container.removeAttribute("data-open-menu-message-id");
    if (shouldStickToBottom) container.scrollTop = container.scrollHeight;
  }
  async function loadChatMessages() {
    if (!activeChatProfile) return;
    const user = window.sapcFirebase?.getCurrentUser();
    if (!user) return;
    try {
      const messages = await window.sapcFirebase.listChatMessages(user, activeChatConversationId);
      await window.sapcFirebase.markChatMessagesSeen(user, activeChatConversationId, messages);
      renderChatMessages(messages, user);
    } catch (error) {
      const status = getElement("chat-status");
      if (status) {
        status.textContent = error.message;
        status.className = "friend-status error";
      }
    }
  }
  function chatTimeLabel(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return "now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }
  function isChatOnline(profile) {
    const value = profile?.lastSeenAt;
    const timestamp = typeof value?.toMillis === "function" ? value.toMillis() : new Date(value || 0).getTime();
    return Number.isFinite(timestamp) && Date.now() - timestamp < 180000;
  }
  function chatMessagePreview(message, userId) {
    if (!message) return "Start a conversation";
    if (message.isUnsent) return "Unsent a message";
    const attachment = message.attachments?.length || message.attachment;
    const body = message.text || (attachment ? "Sent an attachment" : "New message");
    return message.senderId === userId ? `You: ${body}` : body;
  }
  function chatAvatarNode(profile, className = "chat-list-avatar") {
    const avatar = document.createElement("span");
    avatar.className = className;
    if (profile?.photoURL) {
      const image = document.createElement("img");
      image.src = profile.photoURL;
      image.alt = "";
      avatar.append(image);
    } else avatar.textContent = String(profile?.displayName || profile?.title || "P").trim().charAt(0).toUpperCase();
    return avatar;
  }
  function renderChatInbox() {
    const list = getElement("chat-inbox-list");
    const activeNow = getElement("chat-active-now");
    if (!list || !activeNow) return;
    const query = String(getElement("chat-inbox-search")?.value || "").trim().toLowerCase();
    const user = window.sapcFirebase?.getCurrentUser();
    const userId = user?.uid || "";
    const activeFriends = chatAvailableFriends.filter(isChatOnline);
    activeNow.replaceChildren();
    activeFriends.forEach(profile => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-active-person";
      const wrap = document.createElement("span");
      wrap.className = "chat-active-avatar-wrap";
      wrap.append(chatAvatarNode(profile, "chat-active-avatar"));
      const dot = document.createElement("i"); dot.className = "chat-online-dot"; dot.setAttribute("aria-label", "Active now"); wrap.append(dot);
      const name = document.createElement("span"); name.textContent = chatDisplayName(profile, profile.conversationId || `chat:${[userId, profile.id || profile.uid].sort().join(":")}`);
      button.append(wrap, name); button.addEventListener("click", () => openChat(profile)); activeNow.append(button);
    });
    const entries = [...chatInboxEntries].filter(entry => {
      const label = entry.profile?.type === "group" ? entry.profile.title : chatDisplayName(entry.profile, entry.conversationId);
      const preview = chatMessagePreview(entry.lastMessage, userId);
      return !query || `${label || ""} ${preview}`.toLowerCase().includes(query);
    });
    const score = entry => { const value = Date.parse(entry.updatedAt || entry.lastMessage?.timestamp || ""); return Number.isFinite(value) ? value : 0; };
    entries.sort((a, b) => score(b) - score(a));
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement("div"); empty.className = "chat-inbox-empty";
      empty.textContent = query ? "No chats or friends match that search." : "Your conversations will show up here.";
      list.append(empty); return;
    }
    entries.forEach(entry => {
      const profile = entry.profile;
      const last = entry.lastMessage;
      const unread = Boolean(last && last.senderId !== userId && !last.seenBy?.[userId]);
      const button = document.createElement("button"); button.type = "button";
      button.className = `chat-inbox-item${unread ? " unread" : ""}${activeChatConversationId === entry.conversationId ? " active" : ""}`;
      const wrap = document.createElement("span"); wrap.className = "chat-list-avatar-wrap";
      wrap.append(chatAvatarNode(profile));
      if (profile.type !== "group" && isChatOnline(profile)) { const dot = document.createElement("i"); dot.className = "chat-online-dot"; wrap.append(dot); }
      const copy = document.createElement("span"); copy.className = "chat-inbox-copy";
      const title = document.createElement("strong"); title.textContent = profile.type === "group" ? profile.title || "Study group" : chatDisplayName(profile, entry.conversationId);
      const preview = document.createElement("span"); preview.textContent = chatMessagePreview(last, userId);
      copy.append(title, preview);
      const meta = document.createElement("span"); meta.className = "chat-inbox-meta";
      const time = document.createElement("time"); time.textContent = chatTimeLabel(last?.timestamp || entry.updatedAt); meta.append(time);
      if (unread) { const dot = document.createElement("i"); dot.className = "chat-unread-dot"; dot.setAttribute("aria-label", "Unread messages"); meta.append(dot); }
      button.append(wrap, copy, meta);
      button.addEventListener("click", () => openChat(profile));
      list.append(button);
    });
  }
  async function refreshChatInbox() {
    const user = window.sapcFirebase?.getCurrentUser();
    if (!user || !window.sapcFirebase?.listChatInbox) return;
    try {
      const [conversations] = await Promise.all([window.sapcFirebase.listChatInbox()]);
      if (!chatAvailableFriends.length) {
        const friends = await window.sapcFirebase.listFriends(user);
        const profiles = await Promise.all(friends.map(friend => window.sapcFirebase.getPublicProfile(friendId(friend, user.uid))));
        chatAvailableFriends = profiles.filter(Boolean);
      }
      if (Date.now() - chatPresenceUpdatedAt > 60000 && chatAvailableFriends.length) {
        const presence = await window.sapcFirebase.getChatPresence?.(chatAvailableFriends.map(profile => profile.id || profile.uid));
        if (Array.isArray(presence)) {
          const presenceById = new Map(presence.map(item => [String(item.id), item]));
          chatAvailableFriends = chatAvailableFriends.map(profile => ({ ...profile, ...(presenceById.get(String(profile.id || profile.uid)) || {}) }));
        }
        chatPresenceUpdatedAt = Date.now();
      }
      const byId = new Map(chatAvailableFriends.map(profile => [String(profile.id || profile.uid), profile]));
      const entries = [];
      for (const conversation of conversations) {
        let profile;
        if (conversation.type === "group") {
          profile = { ...conversation, type: "group", conversationId: conversation.id, members: conversation.members || [] };
        } else {
          const otherId = conversation.participants.find(id => String(id) !== user.uid);
          const saved = byId.get(String(otherId));
          const member = conversation.members?.find(item => String(item.id) === String(otherId));
          profile = saved || { ...member, id: otherId, uid: otherId };
          profile = { ...profile, conversationId: conversation.id, members: conversation.members || [] };
        }
        entries.push({ conversationId: conversation.id, profile, lastMessage: conversation.lastMessage, updatedAt: conversation.updatedAt });
      }
      chatInboxEntries = entries;
      chatAvailableFriends.forEach(profile => {
        const id = profile.id || profile.uid;
        if (!entries.some(entry => entry.conversationId === `chat:${[user.uid, id].sort().join(":")}`)) {
          entries.push({ conversationId: `chat:${[user.uid, id].sort().join(":")}`, profile, lastMessage: null, updatedAt: "" });
        }
      });
      chatInboxEntries = entries;
      renderChatInbox();
    } catch (error) { console.warn("Could not load chat inbox:", error.message); }
  }
  function startChatInboxRefresh() {
    if (chatInboxTimer) return;
    chatInboxTimer = setInterval(() => {
      if (!document.hidden && !getElement("chat-modal")?.classList.contains("hidden")) refreshChatInbox();
    }, 20000);
  }
  function stopChatInboxRefresh() {
    clearInterval(chatInboxTimer);
    chatInboxTimer = null;
  }
  getElement("chat-inbox-search")?.addEventListener("input", renderChatInbox);
  getElement("chat-add-friend-toggle")?.addEventListener("click", event => {
    const panel = getElement("chat-add-friend-panel");
    const open = panel?.classList.contains("hidden");
    panel?.classList.toggle("hidden", !open);
    event.currentTarget.setAttribute("aria-expanded", String(Boolean(open)));
    if (open) getElement("chat-friend-search")?.focus();
  });
  getElement("chat-add-friend-close")?.addEventListener("click", () => {
    getElement("chat-add-friend-panel")?.classList.add("hidden");
    getElement("chat-add-friend-toggle")?.setAttribute("aria-expanded", "false");
    getElement("chat-add-friend-toggle")?.focus();
  });
  getElement("chat-friend-search-btn")?.addEventListener("click", () => searchFriends({
    inputId: "chat-friend-search",
    statusId: "chat-friend-status",
    resultsId: "chat-friend-search-results"
  }));
  getElement("chat-friend-search")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchFriends({ inputId: "chat-friend-search", statusId: "chat-friend-status", resultsId: "chat-friend-search-results" });
    }
  });
  getElement("chat-back-btn")?.addEventListener("click", () => {
    getElement("chat-modal")?.classList.remove("chat-thread-open");
    getElement("chat-details-drawer")?.classList.remove("open");
    getElement("chat-details-drawer")?.setAttribute("aria-hidden", "true");
    getElement("chat-details-toggle")?.setAttribute("aria-expanded", "false");
  });
  getElement("chat-details-toggle")?.addEventListener("click", event => {
    const drawer = getElement("chat-details-drawer");
    const open = !drawer?.classList.contains("open");
    drawer?.classList.toggle("open", open);
    drawer?.setAttribute("aria-hidden", String(!open));
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  getElement("chat-details-close")?.addEventListener("click", () => {
    getElement("chat-details-drawer")?.classList.remove("open");
    getElement("chat-details-toggle")?.setAttribute("aria-expanded", "false");
    getElement("chat-details-drawer")?.setAttribute("aria-hidden", "true");
  });
  getElement("chat-report-user-btn")?.addEventListener("click", () => {
    const reportedUserId = activeChatProfile?.id || activeChatProfile?.uid;
    if (reportedUserId) openSafetyReport({ reportedUserId, conversationId: activeChatConversationId });
  });
  function ensureChatBlockConfirmationModal() {
    let modal = getElement("chat-block-confirm-modal");
    if (modal) {
      modal.style.zIndex = "14000";
      return modal;
    }
    modal = document.createElement("div");
    modal.id = "chat-block-confirm-modal";
    modal.className = "modal chat-block-confirm-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "chat-block-confirm-title");
    modal.setAttribute("aria-describedby", "chat-block-confirm-message");
    modal.innerHTML = `<div class="modal-content friend-remove-content chat-block-confirm-content">
      <div class="friend-remove-icon" aria-hidden="true">!</div>
      <div class="friend-remove-copy">
        <p class="modal-eyebrow">CHAT SAFETY</p>
        <h2 id="chat-block-confirm-title">Block this person?</h2>
        <p id="chat-block-confirm-message">They will no longer be able to message or call you.</p>
        <p id="chat-block-confirm-error" class="friend-remove-error hidden" role="status" aria-live="polite"></p>
      </div>
      <div class="friend-remove-actions">
        <button id="chat-block-confirm-cancel" class="secondary-btn" type="button">Cancel</button>
        <button id="chat-block-confirm-submit" class="danger-btn" type="button">Block user</button>
      </div>
    </div>`;
    modal.style.zIndex = "14000";
    document.body.append(modal);
    return modal;
  }
  ensureChatBlockConfirmationModal();
  getElement("chat-block-user-btn")?.addEventListener("click", event => {
    const target = activeChatProfile;
    const targetId = target?.id || target?.uid;
    if (!targetId || target.type === "group") return;
    pendingChatBlock = { targetId: String(targetId), name: chatDisplayName(target), trigger: event.currentTarget };
    const message = getElement("chat-block-confirm-message");
    if (message) message.textContent = `Block ${pendingChatBlock.name}? They will no longer be able to message or call you. You can unblock them later in Account settings.`;
    getElement("chat-block-confirm-error")?.classList.add("hidden");
    getElement("chat-block-confirm-modal")?.classList.remove("hidden");
    getElement("chat-block-confirm-cancel")?.focus();
  });
  const closeChatBlockConfirmation = ({ restoreFocus = true } = {}) => {
    getElement("chat-block-confirm-modal")?.classList.add("hidden");
    const trigger = pendingChatBlock?.trigger;
    pendingChatBlock = null;
    if (restoreFocus && trigger?.isConnected) trigger.focus();
  };
  getElement("chat-block-confirm-cancel")?.addEventListener("click", () => closeChatBlockConfirmation());
  getElement("chat-block-confirm-modal")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeChatBlockConfirmation();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !getElement("chat-block-confirm-modal")?.classList.contains("hidden")) {
      event.preventDefault();
      closeChatBlockConfirmation();
    }
  });
  getElement("chat-block-confirm-submit")?.addEventListener("click", async event => {
    if (!pendingChatBlock) return;
    const { targetId } = pendingChatBlock;
    const button = event.currentTarget;
    const errorStatus = getElement("chat-block-confirm-error");
    button.disabled = true;
    button.textContent = "Blocking…";
    errorStatus?.classList.add("hidden");
    try {
      await window.sapcFirebase.blockUser(targetId);
      closeChatBlockConfirmation({ restoreFocus: false });
      chatAvailableFriends = chatAvailableFriends.filter(friend => String(friend.id || friend.uid) !== String(targetId));
      try { returnToChatInbox(); }
      catch (refreshError) { console.warn("The account was blocked, but the inbox could not refresh:", refreshError); }
      showToast("User blocked. You can manage blocked users in Account settings.", "success");
    } catch (error) {
      if (errorStatus) {
        errorStatus.textContent = error.message || "Could not block user. Please try again.";
        errorStatus.classList.remove("hidden");
      }
    } finally {
      button.disabled = false;
      button.textContent = "Block user";
    }
  });
  ["safety-report-close", "safety-report-cancel"].forEach(id => getElement(id)?.addEventListener("click", () => {
    getElement("safety-report-modal")?.classList.add("hidden");
    pendingSafetyReport = null;
  }));
  getElement("safety-report-submit")?.addEventListener("click", async event => {
    if (!pendingSafetyReport) return;
    const button = event.currentTarget;
    button.disabled = true;
    const status = getElement("safety-report-status");
    try {
      const result = await window.sapcFirebase.reportSafetyIssue({
        ...pendingSafetyReport,
        category: getElement("safety-report-category").value,
        details: getElement("safety-report-details").value
      });
      if (status) status.textContent = `Report received (${result.reportId}). Project operators can review it.`;
      showToast("Report submitted.", "success");
      setTimeout(() => getElement("safety-report-modal")?.classList.add("hidden"), 800);
      pendingSafetyReport = null;
    } catch (error) { if (status) status.textContent = error.message || "Could not submit the report."; }
    finally { button.disabled = false; }
  });
  function renderChatDetails(messages = [], profile = activeChatProfile) {
    const gallery = getElement("chat-media-gallery");
    const members = getElement("chat-member-list");
    if (!gallery || !members || !profile) return;
    gallery.replaceChildren();
    const media = messages.flatMap(message => message.isUnsent ? [] : (message.attachments || [])).filter(item => /^(image|video)\//.test(item.mimeType || "")).slice(-30).reverse();
    if (!media.length) { const empty = document.createElement("small"); empty.textContent = "No shared media yet."; gallery.append(empty); }
    media.forEach(item => {
      const button = document.createElement("button"); button.type = "button"; button.setAttribute("aria-label", item.name || "Open shared media");
      if (String(item.mimeType).startsWith("video/")) {
        const video = document.createElement("video"); video.muted = true; video.preload = "metadata"; button.append(video);
        resolveChatAttachmentMedia(item, window.sapcFirebase?.getCurrentUser()).then(url => { if (video.isConnected) video.src = url; }).catch(() => {});
        button.addEventListener("click", () => openChatVideoLightbox(item));
      } else {
        const image = document.createElement("img"); image.alt = item.name || "Shared photo";
        resolveChatAttachmentMedia(item, window.sapcFirebase?.getCurrentUser()).then(url => { if (image.isConnected) image.src = url; }).catch(() => {});
        button.append(image);
        button.addEventListener("click", () => openChatImageViewerFromItem(item, media.filter(file => String(file.mimeType).startsWith("image/"))));
      }
      gallery.append(button);
    });
    members.replaceChildren();
    setChatSafetyControlsVisible(profile);
    const groupMembers = profile.type === "group" ? (profile.members || []) : [profile];
    groupMembers.forEach(member => {
      const row = document.createElement("div"); row.className = "chat-member-row";
      row.append(chatAvatarNode(member, "chat-list-avatar"));
      const name = document.createElement("span"); name.textContent = chatDisplayName(member); row.append(name);
      if (member.id === window.sapcFirebase?.getCurrentUser()?.uid) { const you = document.createElement("small"); you.textContent = "You"; row.append(you); }
      members.append(row);
    });
  }
  async function openChat(profile) {
    stopVoiceRecording(false);
    stopPeerCall();
    if (chatTypingSent && activeChatConversationId) window.sapcFirebase.sendChatTyping?.(activeChatConversationId, false);
    chatTypingSent = false; clearTimeout(chatTypingTimer);
    storeChatDraftAndClearComposer();
    if (chatSubscription) chatSubscription();
    chatSubscription = null;
    const openSequence = ++chatOpenSequence;
    activeChatProfile = profile;
    getElement("chat-add-friend-panel")?.classList.add("hidden");
    getElement("chat-add-friend-toggle")?.setAttribute("aria-expanded", "false");
    const currentUserId = window.sapcFirebase?.getCurrentUser()?.uid || "";
    const preferenceConversationId = profile.conversationId || (profile.type === "group" ? profile.id : `chat:${[currentUserId, profile.id || profile.uid].sort().join(":")}`);
    activeChatPreferences = loadChatPreferences(preferenceConversationId);
    setChatSafetyControlsVisible(profile);
    renderChatCustomizationControls();
    getElement("chat-modal")?.classList.add("chat-thread-open");
    getElement("chat-modal")?.classList.remove("chat-thread-empty");
    getElement("chat-empty-state")?.classList.add("hidden");
    getElement("chat-details-drawer")?.classList.remove("open");
    getElement("chat-details-toggle")?.setAttribute("aria-expanded", "false");
    getElement("chat-title").textContent = profile.type === "group" ? profile.title || "Group chat" : profile.displayName || "Paduan";
    const peerPhoto = getElement("chat-peer-photo");
    const peerAvatar = getElement("chat-peer-avatar");
    peerPhoto.classList.toggle("hidden", profile.type === "group" || !profile.photoURL);
    peerAvatar.classList.toggle("hidden", profile.type !== "group" && Boolean(profile.photoURL));
    peerAvatar.textContent = profile.type === "group" ? "G" : (profile.displayName || "P").charAt(0).toUpperCase();
    if (profile.photoURL) {
      peerPhoto.src = profile.photoURL;
      peerPhoto.alt = `${profile.displayName || "Paduan"} profile photo`;
    }
    const lastSeenLabel = profile.lastSeenAt ? chatTimeLabel(profile.lastSeenAt) : "earlier";
    getElement("chat-peer-status").textContent = profile.type === "group" ? `Group · ${profile.participants?.length || profile.members?.length || 0} members` : (isChatOnline(profile) ? "Active now" : `Active ${lastSeenLabel} ago`);
    getElement("chat-group-create-panel")?.classList.add("hidden");
    getElement("chat-modal")?.classList.remove("is-group-composer");
    getElement("chat-peer")?.classList.remove("hidden");
    activeChatConversationId = profile.conversationId || (profile.type === "group" ? profile.id : "");
    getElement("chat-messages")?.replaceChildren();
    getElement("chat-modal").classList.remove("hidden");
    startChatInboxRefresh();
    try {
      await window.sapcFirebase.ensureChatIdentity(window.sapcFirebase.getCurrentUser());
      if (!activeChatConversationId) activeChatConversationId = await window.sapcFirebase.ensureChatConversation(window.sapcFirebase.getCurrentUser(), profile);
      if (openSequence !== chatOpenSequence || activeChatProfile !== profile) return;
      profile.conversationId = activeChatConversationId;
      activeChatPreferences = loadChatPreferences(activeChatConversationId);
      renderChatCustomizationControls();
      getElement("chat-title").textContent = profile.type === "group" ? profile.title || "Group chat" : chatDisplayName(profile);
      await window.sapcFirebase.connectChatSocket?.();
      if (profile.type !== "group" && typeof window.SapcPeerCall?.createPeerCall === "function") {
        let signaling = null;
        try {
          let callSession = null;
          signaling = await window.sapcFirebase.subscribeToPeerCall(activeChatConversationId, event => callSession?.handleSignal(event));
          callSession = window.SapcPeerCall.createPeerCall({
            conversationId: activeChatConversationId,
            peerName: profile.displayName || "Your friend",
            signaling,
            getIceServers: () => window.sapcFirebase.getWebRtcIceServers()
          });
          peerCallSession = callSession;
          const callButton = getElement("chat-video-call-btn");
          if (callButton) callButton.disabled = false;
          const voiceCallButton = getElement("chat-voice-call-btn");
          if (voiceCallButton) voiceCallButton.disabled = false;
        } catch (callError) {
          signaling?.unsubscribe?.();
          console.warn("Video calling is unavailable for this chat:", callError);
        }
      }
      restoreChatDraft(activeChatConversationId);
      getElement("chat-input").focus();
      refreshChatInbox();
      if (chatTypingUnsubscribe) chatTypingUnsubscribe();
      chatTypingUnsubscribe = await window.sapcFirebase.subscribeToChatTyping?.(activeChatConversationId, event => {
        if (event.userId === window.sapcFirebase.getCurrentUser()?.uid) return;
        const typing = getElement("chat-typing");
        const label = getElement("chat-typing-label");
        if (label) label.textContent = profile.type === "group" ? `${chatDisplayName(profile.members?.find(member => member.id === event.userId))} is typing` : "Typing";
        typing?.classList.toggle("hidden", !event.typing);
      });
      chatSubscription = window.sapcFirebase.subscribeToChatMessages(
        activeChatConversationId,
        messages => {
          const user = window.sapcFirebase.getCurrentUser();
          if (user && activeChatProfile === profile) {
            if (!Array.isArray(messages)) {
              if (chatSubscription) chatSubscription();
              chatSubscription = null;
              if (chatTypingUnsubscribe) chatTypingUnsubscribe();
              chatTypingUnsubscribe = null;
              activeChatProfile = null;
              activeChatConversationId = "";
              setChatSafetyControlsVisible(null);
              getElement("chat-modal")?.classList.remove("chat-thread-open");
              getElement("chat-modal")?.classList.add("chat-thread-empty");
              getElement("chat-empty-state")?.classList.remove("hidden");
              getElement("chat-messages")?.replaceChildren();
              showToast("This conversation was deleted by another member.", "info");
              refreshChatInbox();
              return;
            }
            renderChatMessages(messages, user);
            renderChatDetails(messages, profile);
            refreshChatInbox();
            window.sapcFirebase.markChatMessagesSeen(user, activeChatConversationId, messages).catch(error => {
              console.error("Could not mark chat messages as seen:", error);
            });
          }
        }
      );
    } catch (error) {
      const status = getElement("chat-status");
      status.textContent = error.message;
      status.className = "friend-status error";
    }
  }
  let incomingCallOpening = false;
  window.addEventListener("sapc:incoming-call", async event => {
    const invite = event.detail;
    if (!invite?.conversationId || !invite?.callId || incomingCallOpening) return;
    if (peerCallSession?.isBusy()) {
      if (activeChatConversationId === invite.conversationId) peerCallSession.handleSignal(invite);
      return;
    }
    incomingCallOpening = true;
    window.SapcPeerCall?.startIncomingRingtone?.();
    try {
      const profile = await window.sapcFirebase.getChatProfile(invite.userId);
      if (!profile) throw new Error("The caller's profile is unavailable.");
      const caller = { ...profile, type: "direct", conversationId: invite.conversationId };
      await openChat(caller);
      if (peerCallSession && activeChatConversationId === invite.conversationId) {
        await peerCallSession.handleSignal(invite);
      }
    } catch (error) {
      window.SapcPeerCall?.stopIncomingRingtone?.();
      console.error("Could not open incoming call:", error);
      showToast(error.message || "Could not open the incoming call.", "error");
    } finally {
      incomingCallOpening = false;
      if (!peerCallSession?.isBusy()) window.SapcPeerCall?.stopIncomingRingtone?.();
    }
  });
  async function openGroupComposer() {
    stopPeerCall();
    storeChatDraftAndClearComposer();
    chatOpenSequence += 1;
    if (chatSubscription) chatSubscription();
    chatSubscription = null;
    if (chatTypingUnsubscribe) chatTypingUnsubscribe();
    chatTypingUnsubscribe = null;
    activeChatProfile = null;
    activeChatConversationId = "";
    setChatSafetyControlsVisible(null);
              stopPeerCall();
    const modal = getElement("chat-modal");
    const panel = getElement("chat-group-create-panel");
    const friendList = getElement("chat-group-friend-list");
    if (!modal || !panel || !friendList) return;
    modal.classList.remove("is-compact");
    modal.classList.add("chat-thread-open");
    modal.classList.remove("chat-thread-empty");
    modal.classList.add("is-group-composer");
    modal.classList.remove("hidden");
    startChatInboxRefresh();
    getElement("chat-title").textContent = "Create a group chat";
    getElement("chat-delete-confirm")?.classList.add("hidden");
    getElement("chat-peer")?.classList.remove("hidden");
    getElement("chat-peer-photo")?.classList.add("hidden");
    getElement("chat-peer-avatar")?.classList.add("hidden");
    getElement("chat-peer-status").textContent = "Choose friends to add to your group";
    panel.classList.remove("hidden");
    getElement("chat-group-create-status")?.classList.add("hidden");
    getElement("chat-group-name").value = "";
    friendList.replaceChildren();
    const user = window.sapcFirebase?.getCurrentUser();
    if (!user) return;
    try {
      if (!chatAvailableFriends.length) {
        const friends = await window.sapcFirebase.listFriends(user);
        const profiles = await Promise.all(friends.map(async friend => window.sapcFirebase.getPublicProfile(friendId(friend, user.uid))));
        chatAvailableFriends = profiles.filter(Boolean);
      }
      if (!chatAvailableFriends.length) {
        const empty = document.createElement("p");
        empty.textContent = "Add friends before starting a group chat.";
        friendList.append(empty);
      }
      chatAvailableFriends.forEach(profile => {
        const label = document.createElement("label");
        label.className = "chat-group-friend-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = profile.id || profile.uid;
        checkbox.addEventListener("change", updateGroupCreateButton);
        const identity = document.createElement("span");
        identity.textContent = profile.displayName || profile.username || "Paduan";
        label.append(checkbox, identity);
        friendList.append(label);
      });
      updateGroupCreateButton();
    } catch (error) {
      showGroupCreateError(error.message || "Could not load your friends.");
    }
  }
  function updateGroupCreateButton() {
    const count = getElement("chat-group-friend-list")?.querySelectorAll("input:checked").length || 0;
    const button = getElement("chat-group-start-btn");
    if (button) button.disabled = count < 2 || count > 19;
  }
  function showGroupCreateError(message) {
    const status = getElement("chat-group-create-status");
    if (status) {
      status.textContent = message;
      status.className = "friend-status error";
      status.classList.remove("hidden");
    }
  }
  getElement("chat-create-group-btn")?.addEventListener("click", openGroupComposer);
  getElement("friends-create-group-btn")?.addEventListener("click", openGroupComposer);
  getElement("chat-group-cancel-btn")?.addEventListener("click", () => {
    getElement("chat-group-create-panel")?.classList.add("hidden");
    getElement("chat-modal")?.classList.remove("is-group-composer");
    if (getElement("chat-modal")?.classList.contains("messenger-page-mode")) returnToChatInbox();
    else {
      getElement("chat-modal")?.classList.add("hidden", "chat-thread-empty");
      stopChatInboxRefresh();
    }
  });
  getElement("chat-group-start-btn")?.addEventListener("click", async event => {
    const user = window.sapcFirebase?.getCurrentUser();
    if (!user) return;
    const selectedIds = new Set(Array.from(getElement("chat-group-friend-list")?.querySelectorAll("input:checked") || []).map(input => input.value));
    const selected = chatAvailableFriends.filter(profile => selectedIds.has(String(profile.id || profile.uid)));
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await window.sapcFirebase.ensureChatIdentity(user);
      const group = await window.sapcFirebase.createGroupConversation(user, selected, getElement("chat-group-name")?.value || "");
      await loadFriends();
      await openChat(group);
    } catch (error) {
      showGroupCreateError(error.message || "Could not create the group chat.");
    } finally {
      updateGroupCreateButton();
    }
  });
  getElement("close-chat-btn")?.addEventListener("click", () => {
    const isMessengerPage = getElement("chat-modal")?.classList.contains("messenger-page-mode");
    stopPeerCall();
    if (chatTypingSent && activeChatConversationId) window.sapcFirebase.sendChatTyping?.(activeChatConversationId, false);
    chatTypingSent = false; clearTimeout(chatTypingTimer);
    storeChatDraftAndClearComposer();
    chatOpenSequence += 1;
    if (chatSubscription) chatSubscription();
    chatSubscription = null;
    if (chatTypingUnsubscribe) chatTypingUnsubscribe();
    chatTypingUnsubscribe = null;
    activeChatProfile = null;
    activeChatConversationId = "";
    setChatSafetyControlsVisible(null);
    getElement("chat-modal")?.classList.remove("chat-thread-open");
    getElement("chat-modal")?.classList.add("chat-thread-empty");
    getElement("chat-modal")?.classList.add("hidden");
    stopChatInboxRefresh();
    if (isMessengerPage) {
      getElement("chat-modal")?.classList.remove("messenger-page-mode");
      document.body.classList.remove("messenger-active");
      showAppWorkspace();
    }
  });
  getElement("chat-new-chat-btn")?.addEventListener("click", () => {
    stopPeerCall();
    if (chatTypingSent && activeChatConversationId) window.sapcFirebase.sendChatTyping?.(activeChatConversationId, false);
    chatTypingSent = false; clearTimeout(chatTypingTimer);
    storeChatDraftAndClearComposer();
    chatOpenSequence += 1;
    if (chatSubscription) chatSubscription();
    chatSubscription = null;
    if (chatTypingUnsubscribe) chatTypingUnsubscribe();
    chatTypingUnsubscribe = null;
    activeChatProfile = null;
    activeChatConversationId = "";
    getElement("chat-modal")?.classList.add("hidden");
    getElement("chat-modal")?.classList.add("chat-thread-empty");
    stopChatInboxRefresh();
    showFriendsWorkspace();
  });
  getElement("chat-delete-btn")?.addEventListener("click", () => {
    if (!activeChatProfile) return;
    const prompt = getElement("chat-delete-confirm-message");
    if (prompt) prompt.textContent = activeChatProfile.type === "group" ? "Delete this group conversation for all members?" : "Delete this conversation for both people?";
    getElement("chat-delete-confirm")?.classList.remove("hidden");
    getElement("chat-delete-confirm-btn")?.focus();
  });
  getElement("chat-delete-cancel-btn")?.addEventListener("click", () => getElement("chat-delete-confirm")?.classList.add("hidden"));
  getElement("chat-delete-confirm-btn")?.addEventListener("click", async event => {
    if (!activeChatProfile) return;
    const button = event.currentTarget;
    button.disabled = true;
    const deletingConversationId = activeChatConversationId;
    const status = getElement("chat-status");
    try {
      await window.sapcFirebase.deleteChatConversation(window.sapcFirebase.getCurrentUser(), deletingConversationId);
      chatDrafts.delete(deletingConversationId);
      chatPendingFiles = [];
      clearChatAttachmentPreview();
      if (getElement("chat-input")) getElement("chat-input").value = "";
      if (chatSubscription) chatSubscription();
      chatSubscription = null;
      activeChatProfile = null;
      activeChatConversationId = "";
      setChatSafetyControlsVisible(null);
      getElement("chat-delete-confirm")?.classList.add("hidden");
      if (getElement("chat-modal")?.classList.contains("messenger-page-mode")) returnToChatInbox();
      else {
        getElement("chat-modal")?.classList.remove("chat-thread-open");
        getElement("chat-modal")?.classList.add("hidden", "chat-thread-empty");
        stopChatInboxRefresh();
        refreshChatInbox();
      }
    } catch (error) {
      if (status) {
        status.textContent = `Could not delete conversation: ${error.message}`;
        status.className = "friend-status error";
        status.classList.remove("hidden");
      }
    } finally {
      button.disabled = false;
    }
  });
  getElement("chat-form")?.addEventListener("submit", async event => {
    event.preventDefault();
    const user = window.sapcFirebase?.getCurrentUser();
    const input = getElement("chat-input");
    const text = input.value.trim();
    const files = [...chatPendingFiles];
    if (!user || !activeChatProfile || (!text && !files.length)) return;
    const chatProfile = activeChatProfile;
    const conversationId = activeChatConversationId;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    const status = getElement("chat-status");
    const attachments = [];
    let messageSent = false;
    try {
      status.textContent = files.length ? `Uploading ${files.length} attachment${files.length === 1 ? "" : "s"}…` : "Sending…";
      status.className = "friend-status";
      status.classList.remove("hidden");
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        status.textContent = `Uploading ${index + 1} of ${files.length}: ${file.name}`;
        attachments.push(await window.sapcFirebase.uploadChatConversationAttachment(user, conversationId, file));
      }
      if (chatProfile.type === "group") await window.sapcFirebase.sendChatMessage(conversationId, { text, attachments, replyTo: pendingChatReply });
      else await window.sapcFirebase.sendChatMessage(user, chatProfile, { text, attachments, replyTo: pendingChatReply });
      messageSent = true;
      chatSubscription?.refresh?.();
      chatDrafts.delete(conversationId);
      if (activeChatConversationId === conversationId) {
        input.value = "";
    getElement("chat-quick-reactions")?.classList.remove("hidden");
        chatPendingFiles = [];
        setChatReply(null);
        clearChatAttachmentPreview();
        status.textContent = "Sent";
        status.className = "friend-status success";
      }
    } catch (error) {
      if (!messageSent) await Promise.allSettled(attachments.map(item => window.sapcFirebase.deleteChatAttachment(user, item)));
      if (activeChatConversationId === conversationId) {
        status.textContent = error.message;
        status.className = "friend-status error";
      } else showToast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });
  const chatTextarea = getElement("chat-input");
  function closeChatComposePickers() {
    getElement("chat-emoji-picker")?.classList.add("hidden");
    getElement("chat-emoji-btn")?.setAttribute("aria-expanded", "false");
  }
  function toggleChatComposePicker(id, button) {
    const panel = getElement(id);
    const opening = panel?.classList.contains("hidden");
    closeChatComposePickers();
    panel?.classList.toggle("hidden", !opening);
    button?.setAttribute("aria-expanded", String(Boolean(opening)));
    if (opening && id === "chat-emoji-picker") {
      getElement("chat-emoji-categories")?.querySelectorAll("[data-emoji-category]").forEach(tab => tab.setAttribute("aria-selected", String(tab.dataset.emojiCategory === activeEmojiCategory)));
      getElement("chat-emoji-picker")?.querySelectorAll("[data-emoji-tone]").forEach(tone => tone.setAttribute("aria-pressed", String((tone.dataset.emojiTone || "") === (activeChatPreferences.skinTone || ""))));
      renderChatEmojiChoices();
    }
  }
  let activeEmojiCategory = "smileys";
  function insertChatEmoji(emoji) {
    if (!chatTextarea) return;
    const start = chatTextarea.selectionStart ?? chatTextarea.value.length;
    const end = chatTextarea.selectionEnd ?? start;
    chatTextarea.setRangeText(emoji, start, end, "end");
    activeChatPreferences.recentEmojis = [emoji, ...(activeChatPreferences.recentEmojis || []).filter(item => item !== emoji)].slice(0, 16);
    saveChatPreferences();
    chatTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    chatTextarea.focus(); closeChatComposePickers();
  }
  function renderChatEmojiChoices() {
    const grid = getElement("chat-emoji-grid");
    if (!grid) return;
    const query = String(getElement("chat-emoji-search")?.value || "").trim().toLowerCase();
    const currentCategory = query ? "all" : activeEmojiCategory;
    const source = currentCategory === "recent"
      ? (activeChatPreferences.recentEmojis || []).map(emoji => ({ emoji, keywords: "recently used", category: "recent" }))
      : Object.entries(chatEmojiCategories).flatMap(([category, values]) => values.map(item => {
        const [emoji, keywords] = item.split("|"); return { emoji, keywords, category };
      })).filter(item => currentCategory === "all" || item.category === currentCategory);
    const filtered = source.filter(item => !query || `${item.emoji} ${item.keywords}`.toLowerCase().includes(query));
    grid.replaceChildren();
    if (!filtered.length) { const empty = document.createElement("small"); empty.className = "chat-emoji-empty"; empty.textContent = "No emoji found."; grid.append(empty); return; }
    filtered.forEach(item => {
      const emoji = chatSkinToneCapable.has(item.emoji) ? `${item.emoji}${activeChatPreferences.skinTone || ""}` : item.emoji;
      const button = document.createElement("button"); button.type = "button"; button.textContent = emoji;
      button.setAttribute("role", "option"); button.setAttribute("aria-label", `${item.keywords}: ${emoji}`); button.title = item.keywords;
      button.addEventListener("click", () => insertChatEmoji(emoji));
      grid.append(button);
    });
  }
  getElement("chat-emoji-search")?.addEventListener("input", renderChatEmojiChoices);
  getElement("chat-emoji-categories")?.addEventListener("click", event => {
    const tab = event.target.closest("[data-emoji-category]");
    if (!tab) return;
    activeEmojiCategory = tab.dataset.emojiCategory;
    getElement("chat-emoji-search").value = "";
    getElement("chat-emoji-categories").querySelectorAll("[data-emoji-category]").forEach(button => button.setAttribute("aria-selected", String(button === tab)));
    renderChatEmojiChoices();
  });
  getElement("chat-emoji-picker")?.querySelector(".chat-emoji-tones")?.addEventListener("click", event => {
    const button = event.target.closest("[data-emoji-tone]");
    if (!button) return;
    activeChatPreferences.skinTone = button.dataset.emojiTone || "";
    saveChatPreferences();
    getElement("chat-emoji-picker").querySelectorAll("[data-emoji-tone]").forEach(tone => tone.setAttribute("aria-pressed", String(tone === button)));
    renderChatEmojiChoices();
  });
  getElement("chat-emoji-btn")?.addEventListener("click", event => toggleChatComposePicker("chat-emoji-picker", event.currentTarget));
  document.addEventListener("pointerdown", event => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("#chat-emoji-picker, #chat-emoji-btn")) return;
    closeChatComposePickers();
  });
  getElement("chat-theme-picker")?.addEventListener("click", event => {
    const button = event.target.closest("[data-chat-theme-choice]");
    if (!button) return;
    const theme = button.dataset.chatThemeChoice;
    if (!chatThemeNames.has(theme)) return;
    activeChatPreferences.theme = theme;
    saveChatPreferences();
    renderChatCustomizationControls();
  });
  getElement("chat-theme-photo-btn")?.addEventListener("click", () => getElement("chat-theme-photo-input")?.click());
  getElement("chat-theme-photo-input")?.addEventListener("change", async event => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) {
      showToast("Choose a JPG, PNG, or WebP picture under 12 MB.", "error");
      event.currentTarget.value = "";
      return;
    }
    const previousPreferences = { ...activeChatPreferences };
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const scale = Math.min(1, 1200 / image.naturalWidth, 900 / image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      let compressed = canvas.toDataURL("image/webp", 0.72);
      if (compressed.length > 950000) compressed = canvas.toDataURL("image/jpeg", 0.58);
      if (compressed.length > 1200000) throw new Error("That picture is too detailed to save as a chat theme. Try a smaller image.");
      activeChatPreferences.customBackground = compressed;
      activeChatPreferences.theme = "custom";
      if (!saveChatPreferences()) activeChatPreferences = previousPreferences;
      renderChatCustomizationControls();
    } catch (error) {
      activeChatPreferences = previousPreferences;
      showToast(error.message || "Could not use that picture as a chat theme.", "error");
      renderChatCustomizationControls();
    } finally {
      URL.revokeObjectURL(objectUrl);
      event.currentTarget.value = "";
    }
  });
  getElement("chat-theme-photo-remove")?.addEventListener("click", () => {
    activeChatPreferences.customBackground = "";
    activeChatPreferences.theme = "default";
    saveChatPreferences();
    renderChatCustomizationControls();
  });
  chatTextarea?.addEventListener("input", () => {
    chatTextarea.style.height = "auto";
    chatTextarea.style.height = `${Math.min(chatTextarea.scrollHeight, 120)}px`;
    getElement("chat-quick-reactions")?.classList.toggle("hidden", Boolean(chatTextarea.value.trim()));
    const isTyping = Boolean(chatTextarea.value.trim());
    const typingConversationId = activeChatConversationId;
    if (activeChatConversationId && isTyping && !chatTypingSent) {
      chatTypingSent = true;
      window.sapcFirebase.sendChatTyping?.(activeChatConversationId, true);
    } else if (activeChatConversationId && !isTyping && chatTypingSent) {
      chatTypingSent = false;
      window.sapcFirebase.sendChatTyping?.(activeChatConversationId, false);
    }
    clearTimeout(chatTypingTimer);
    chatTypingTimer = setTimeout(() => {
      if (typingConversationId && chatTypingSent) window.sapcFirebase.sendChatTyping?.(typingConversationId, false);
      chatTypingSent = false;
    }, 1200);
  });
  chatTextarea?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); getElement("chat-form")?.requestSubmit();
    }
  });
  async function sendChatQuickReaction(emoji) {
    if (!activeChatProfile || chatTextarea?.value.trim()) return;
    try {
      if (activeChatProfile.type === "group") await window.sapcFirebase.sendChatMessage(activeChatConversationId, { text: emoji });
      else await window.sapcFirebase.sendChatMessage(window.sapcFirebase.getCurrentUser(), activeChatProfile, { text: emoji });
      chatSubscription?.refresh?.();
    } catch (error) { showToast(`Could not send reaction: ${error.message}`, "error"); }
  }
  getElement("chat-quick-react")?.addEventListener("click", () => sendChatQuickReaction(activeChatPreferences.quickReaction || "👍"));
  getElement("chat-quick-heart")?.addEventListener("click", () => sendChatQuickReaction("❤️"));
  getElement("chat-video-lightbox-close")?.addEventListener("click", () => {
    const player = getElement("chat-video-lightbox-player");
    player?.pause(); player?.removeAttribute("src"); player?.load();
    getElement("chat-video-lightbox")?.classList.add("hidden");
  });
  getElement("chat-video-lightbox")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) getElement("chat-video-lightbox-close")?.click();
  });
["close-friend-profile-btn", "close-friend-profile-footer-btn"].forEach(id => {
  getElement(id)?.addEventListener("click", () => getElement("friend-profile-modal")?.classList.add("hidden"));
});
async function shareCurrentDeckWithFriend(friend, user) {
  if (!cards.length) throw new Error("Generate or open a deck before sharing it.");
  const shareId = await window.sapcFirebase.createShare(user, {
    title: `${selectedSubjectMode.toUpperCase()} Reviewer`,
    cards,
    subjectMode: selectedSubjectMode
  });
  const link = `${window.location.origin}${window.location.pathname}?share=${shareId}`;
  if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(link);
  showToast(`Deck link copied. Send it to ${friendName(friend, user.uid)}.`, "success");
}
function renderFriendItems(items, containerId, renderItem) {
  const container = getElement(containerId);
  if (!container) return;
  container.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("small");
    empty.textContent = "None yet.";
    container.append(empty);
    return;
  }
  items.forEach(item => container.append(renderItem(item)));
}
async function loadFriends() {
  const user = window.sapcFirebase?.getCurrentUser();
  if (!user || !window.sapcFirebase?.listFriends) return;
  ["group-chat-list", "friend-requests-list", "outgoing-friend-requests-list", "friends-list"].forEach(id => {
    const container = getElement(id);
    if (!container) return;
    const loading = document.createElement("small");
    loading.textContent = "Loading…";
    container.replaceChildren(loading);
  });
  try {
    const results = await Promise.allSettled([
      window.sapcFirebase.listFriendRequests(user),
      window.sapcFirebase.listOutgoingFriendRequests(user),
      window.sapcFirebase.listFriends(user),
      window.sapcFirebase.listGroupConversations?.(user) || Promise.resolve([])
    ]);
    const [requestsResult, outgoingResult, friendsResult, groupsResult] = results;
    const requests = requestsResult.status === "fulfilled" && Array.isArray(requestsResult.value) ? requestsResult.value : [];
    const outgoingRequests = outgoingResult.status === "fulfilled" && Array.isArray(outgoingResult.value) ? outgoingResult.value : [];
    const friends = friendsResult.status === "fulfilled" && Array.isArray(friendsResult.value) ? friendsResult.value : [];
    const groups = groupsResult.status === "fulfilled" && Array.isArray(groupsResult.value) ? groupsResult.value : [];
    renderFriendItems(groups, "group-chat-list", group => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-deck-item friend-item";
      const identity = document.createElement("span");
      identity.className = "friend-item-content";
      const name = document.createElement("strong");
      name.textContent = group.title || "Study group";
      const detail = document.createElement("small");
      detail.textContent = `${group.participants?.length || 0} members`;
      identity.append(name, detail);
      const open = document.createElement("button");
      open.type = "button";
      open.className = "primary-btn";
      open.textContent = "Open";
      open.addEventListener("click", () => openChat(group));
      wrapper.append(identity, open);
      return wrapper;
    });
    renderFriendItems(requests, "friend-requests-list", request => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-deck-item friend-item";
      const identity = document.createElement("span");
      identity.className = "friend-item-content";
      const name = document.createElement("strong");
      name.textContent = request.fromName || "Paduan";
      const note = document.createElement("small");
      note.textContent = "sent you a friend request";
      identity.append(name, note);
      const actions = document.createElement("div");
      actions.className = "friend-action-row";
      ["accepted", "rejected"].forEach(status => {
        const button = document.createElement("button");
        button.className = status === "accepted" ? "primary-btn" : "ghost";
        button.type = "button";
        button.textContent = status === "accepted" ? "Accept" : "Decline";
        button.addEventListener("click", async () => {
          await window.sapcFirebase.respondToFriendRequest(request.id, status);
          loadFriends();
        });
        actions.append(button);
      });
      const chatButton = document.createElement("button");
      chatButton.className = "secondary-btn";
      chatButton.type = "button";
      chatButton.textContent = "Chat";
      chatButton.addEventListener("click", async () => {
        const profile = await window.sapcFirebase.getPublicProfile(request.fromId);
        if (profile) openChat({ ...profile, friendRequestId: request.id });
      });
      actions.append(chatButton);
      wrapper.append(identity, actions);
      return wrapper;
    });
    renderFriendItems(outgoingRequests, "outgoing-friend-requests-list", request => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-deck-item friend-item";
      const identity = document.createElement("span");
      identity.className = "friend-item-content";
      const name = document.createElement("strong");
      name.textContent = request.toName || "Paduan";
      const note = document.createElement("small");
      note.textContent = "Pending their response";
      identity.append(name, note);
      const cancelButton = document.createElement("button");
      cancelButton.className = "ghost";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel request";
      cancelButton.addEventListener("click", async () => {
        try {
          await window.sapcFirebase.removeFriend(request.id);
          await loadFriends();
        } catch (error) {
          showToast(`Could not cancel request: ${error.message}`, "error");
        }
      });
      const chatButton = document.createElement("button");
      chatButton.className = "secondary-btn";
      chatButton.type = "button";
      chatButton.textContent = "Chat";
      chatButton.addEventListener("click", async () => {
        const profile = await window.sapcFirebase.getPublicProfile(request.toId);
        if (profile) openChat({ ...profile, friendRequestId: request.id });
      });
      const actions = document.createElement("div");
      actions.className = "friend-action-row";
      actions.append(chatButton, cancelButton);
      wrapper.append(identity, actions);
      return wrapper;
    });
    const friendProfiles = await Promise.all(friends.map(async friend => {
      try {
        const profile = await window.sapcFirebase.getPublicProfile(friendId(friend, user.uid));
        return [friend.id, profile ? { ...profile, friendRequestId: friend.id } : null];
      } catch (error) {
        console.warn("Could not load a friend's profile:", error.message);
        return [friend.id, null];
      }
    }));
    const friendProfileMap = new Map(friendProfiles);
    friends.forEach(friend => {
      if (!friendProfileMap.get(friend.id)) {
        friendProfileMap.set(friend.id, {
          id: friendId(friend, user.uid), uid: friendId(friend, user.uid),
          displayName: friendName(friend, user.uid) || "Paduan", friendRequestId: friend.id
        });
      }
    });
    chatAvailableFriends = [...friendProfileMap.values()].filter(Boolean);
    refreshChatInbox();
    renderFriendItems(friends, "friends-list", friend => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-deck-item friend-item";
      const avatar = document.createElement("span");
      avatar.className = "friend-avatar";
      avatar.textContent = friendName(friend, user.uid).charAt(0).toUpperCase();
      const name = document.createElement("strong");
      name.textContent = friendName(friend, user.uid);
      const identity = document.createElement("span");
      identity.className = "friend-item-content";
      identity.append(name);
      appendPresence(identity, friendProfileMap.get(friend.id));
      const actions = document.createElement("div");
      actions.className = "friend-action-row";
      const profileButton = document.createElement("button");
      profileButton.className = "ghost";
      profileButton.type = "button";
      profileButton.textContent = "Profile";
      profileButton.addEventListener("click", async () => {
        try {
          const profile = await window.sapcFirebase.getPublicProfile(friendId(friend, user.uid));
          if (!profile) throw new Error("That profile is no longer available.");
          showFriendProfile(profile);
        } catch (error) {
          showToast(`Could not load profile: ${error.message}`, "error");
        }
      });
      const shareButton = document.createElement("button");
      shareButton.className = "secondary-btn";
      shareButton.type = "button";
      shareButton.textContent = "Share deck";
      shareButton.addEventListener("click", async () => {
        try {
          await shareCurrentDeckWithFriend(friend, user);
        } catch (error) {
          showToast(`Could not share deck: ${error.message}`, "error");
        }
      });
      const removeButton = document.createElement("button");
      removeButton.className = "ghost";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.setAttribute("aria-label", `Remove ${friendName(friend, user.uid)} from your friends`);
      removeButton.addEventListener("click", () => openFriendRemovalConfirmation(friend, user, removeButton));
      actions.append(profileButton, shareButton, removeButton);
      const chatButton = document.createElement("button");
      chatButton.className = "primary-btn";
      chatButton.type = "button";
      chatButton.textContent = "Chat";
      chatButton.addEventListener("click", () => {
        const profile = friendProfileMap.get(friend.id);
        if (profile) {
          openChat(profile);
        } else {
          getElement("friends-status").textContent = "That profile could not be loaded.";
          getElement("friends-status").className = "friend-status error";
        }
      });
      actions.prepend(chatButton);
      wrapper.append(avatar, identity, actions);
      return wrapper;
    });
    const failedSections = [
      [groupsResult, "group-chat-list", "Group chats"],
      [requestsResult, "friend-requests-list", "Incoming requests"],
      [outgoingResult, "outgoing-friend-requests-list", "Outgoing requests"],
      [friendsResult, "friends-list", "Your friends"]
    ].filter(([result]) => result.status === "rejected");
    failedSections.forEach(([result, containerId, label]) => {
      console.error(`${label} could not be loaded:`, result.reason);
      const container = getElement(containerId);
      if (container) {
        const message = document.createElement("small");
        message.className = "friend-load-error";
        const reason = String(result.reason?.message || "").trim();
        message.textContent = reason
          ? `${label} couldn’t load: ${reason}`
          : `${label} couldn’t load. Check your connection and try again.`;
        container.replaceChildren(message);
      }
    });
    const status = getElement("friend-status");
    if (status) {
      if (failedSections.length) {
        const firstFailure = failedSections[0][0].reason;
        const detail = String(firstFailure?.message || "").trim();
        status.textContent = `Could not load: ${failedSections.map(([, , label]) => label).join(", ")}.${detail ? ` Server says: ${detail}` : " Check your connection and try again."} Your saved records have not been changed.`;
        status.className = "friend-status error";
        status.classList.remove("hidden");
      } else if (friendProfiles.some(([id, profile]) => !profile)) {
        status.textContent = "Your friend records loaded, but some profile details could not be refreshed.";
        status.className = "friend-status error";
        status.classList.remove("hidden");
      } else {
        status.textContent = "";
        status.className = "friend-status hidden";
      }
    }
  } catch (error) {
    console.error("Could not load friends:", error);
    const status = getElement("friend-status");
    if (status) {
      status.textContent = "We couldn’t refresh your friends right now. Your account data hasn’t been removed; check your connection and try again.";
      status.className = "friend-status error";
      status.classList.remove("hidden");
    }
  }
}
async function searchFriends({ inputId = "friend-search", statusId = "friend-status", resultsId = "friend-search-results" } = {}) {
  const user = window.sapcFirebase?.getCurrentUser();
  const query = (getElement(inputId)?.value || "").trim();
  const status = getElement(statusId);
  const resultsContainer = getElement(resultsId);
  resultsContainer?.replaceChildren();
  if (!user) {
    if (status) {
      status.textContent = "Sign in to find classmates.";
      status.className = "friend-status error";
    }
    return;
  }
  if (query.trim().length < 2) {
    if (status) {
      status.textContent = "Enter at least 2 characters to search.";
      status.className = "friend-status error";
    }
    return;
  }
  if (status) {
    status.textContent = "Searching…";
    status.className = "friend-status";
  }
  if (resultsContainer) {
    const loading = document.createElement("small");
    loading.textContent = "Searching…";
    resultsContainer.replaceChildren(loading);
  }
  try {
    const results = await window.sapcFirebase.searchUsers(query, user);
    if (!results.length && resultsContainer) {
      const empty = document.createElement("small");
      empty.textContent = "No classmates found. Try a username or a different name.";
      resultsContainer.replaceChildren(empty);
    }
    if (status) {
      status.textContent = "";
      status.className = "friend-status hidden";
    }
    if (results.length) renderFriendItems(results, resultsId, profile => {
      const wrapper = document.createElement("div");
      wrapper.className = "saved-deck-item friend-item";
      const avatar = document.createElement("span");
      avatar.className = "friend-avatar";
      avatar.textContent = (profile.displayName || "P").charAt(0).toUpperCase();
      const identity = document.createElement("span");
      identity.className = "friend-item-content";
      const name = document.createElement("strong");
      name.textContent = profile.displayName || "Paduan";
      const note = document.createElement("small");
      note.textContent = profile.gradeLevel || "Student";
      identity.append(name, note);
      appendPresence(identity, profile);
      const actions = document.createElement("div");
      actions.className = "friend-action-row";
      const chatButton = document.createElement("button");
      chatButton.className = "primary-btn";
      chatButton.type = "button";
      chatButton.textContent = "Chat";
      chatButton.addEventListener("click", () => {
        getElement("chat-add-friend-panel")?.classList.add("hidden");
        getElement("chat-add-friend-toggle")?.setAttribute("aria-expanded", "false");
        openChat(profile);
      });
      const button = document.createElement("button");
      button.className = "ghost";
      button.type = "button";
      button.textContent = "Add friend";
      button.addEventListener("click", async () => {
        try {
          await window.sapcFirebase.sendFriendRequest(user, profile);
          button.disabled = true;
          button.textContent = "Request sent";
          if (status) {
            status.textContent = `Friend request sent to ${profile.displayName || profile.username || "this user"}.`;
            status.className = "friend-status success";
          }
        } catch (error) {
          if (status) {
            status.textContent = error.message || "Could not send friend request.";
            status.className = "friend-status error";
          }
        }
      });
      actions.append(chatButton, button);
      wrapper.append(avatar, identity, actions);
      return wrapper;
    });
  } catch (error) {
    console.error("Could not search users:", error);
    if (status) {
      status.textContent = `Couldn’t search classmates: ${error.message || "The server request failed."}`;
      status.className = "friend-status error";
    }
    if (resultsContainer) resultsContainer.replaceChildren();
  }
}
getElement("friend-search-btn")?.addEventListener("click", searchFriends);
getElement("friend-search")?.addEventListener("keydown", event => {
  if (event.key === "Enter") searchFriends();
});

const aiHintBtn = getElement("ai-hint-btn");
if (aiHintBtn) aiHintBtn.addEventListener("click", async () => {
  const token = await window.sapcFirebase?.getIdToken();
  if (!token || !cards[i]) return;
  aiHintBtn.disabled = true;
  try {
    const response = await fetch(apiUrl("/api/ai-hint"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        question: cards[i].question,
        answer: cards[i].answer,
        subjectMode: selectedSubjectMode,
        curriculum: getElement("shs-curriculum")?.value || "current",
        coursePathway: selectedCoursePathway,
        courseSubject: selectedCourseSubject || "General subject"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Hint request failed.");
    showToast(data.hint, "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    aiHintBtn.disabled = false;
  }
});

let quizTimer = null;
let quizSeconds = 0;
let quizDuration = 0;
function formatQuizTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateQuizTimerDisplay() {
  const timerDisplay = getElement("quiz-timer-display");
  if (!timerDisplay) return;
  timerDisplay.textContent = `Time ${formatQuizTime(Math.max(0, quizSeconds))}`;
  timerDisplay.style.setProperty("--timer-progress", `${quizDuration ? (quizSeconds / quizDuration) * 100 : 0}%`);
  timerDisplay.classList.toggle("warning", quizSeconds <= 30);
}

function stopQuizTimer() {
  clearInterval(quizTimer);
  quizTimer = null;
}

function startQuizTimer() {
  stopQuizTimer();
  const value = Number(getElement("quiz-time-limit")?.value || 0);
  const timerDisplay = getElement("quiz-timer-display");
  if (!value) {
    if (timerDisplay) timerDisplay.classList.add("hidden");
    return;
  }
  quizSeconds = value;
  quizDuration = value;
  if (timerDisplay) timerDisplay.classList.remove("hidden");
  updateQuizTimerDisplay();
  quizTimer = setInterval(() => {
    quizSeconds -= 1;
    updateQuizTimerDisplay();
    if (quizSeconds <= 0) {
      stopQuizTimer();
      showDeckSummary();
    }
  }, 1000);
}
const quizTimeLimit = getElement("quiz-time-limit");
if (quizTimeLimit) quizTimeLimit.addEventListener("change", startQuizTimer);

const profileModal = getElement("profile-modal");
const profilePhotoFile = getElement("profile-photo-file");
const profilePhotoPreview = getElement("profile-photo-preview");
const photoCropModal = getElement("photo-crop-modal");
const photoCropCanvas = getElement("photo-crop-canvas");
const photoZoom = getElement("photo-zoom");
const photoRotationHandle = getElement("photo-rotation-handle");
const photoGuidesToggle = getElement("photo-guides-toggle");
let cropImage = null;
let cropObjectUrl = null;
let cropZoom = 1;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropRotation = 0;
let cropDrag = null;
let rotationDrag = null;
photoGuidesToggle?.addEventListener("change", () => {
  getElement("photo-crop-editor")?.classList.toggle("guides-hidden", !photoGuidesToggle.checked);
});

function drawPhotoCrop() {
  if (!cropImage || !photoCropCanvas) return;
  const context = photoCropCanvas.getContext("2d");
  const size = photoCropCanvas.width;
  const scale = Math.max(size / cropImage.naturalWidth, size / cropImage.naturalHeight) * cropZoom;
  const width = cropImage.naturalWidth * scale;
  const height = cropImage.naturalHeight * scale;
  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(size / 2 + cropOffsetX, size / 2 + cropOffsetY);
  context.rotate((cropRotation * Math.PI) / 180);
  context.drawImage(cropImage, -width / 2, -height / 2, width, height);
  context.restore();
}

function closePhotoCrop() {
  photoCropModal?.classList.add("hidden");
  if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
  cropObjectUrl = null;
  cropImage = null;
}

function openPhotoCrop(file) {
  cropObjectUrl = URL.createObjectURL(file);
  cropImage = new Image();
  cropImage.onload = () => {
    cropZoom = 1;
    cropOffsetX = 0;
    cropOffsetY = 0;
    cropRotation = 0;
    if (photoZoom) photoZoom.value = "1";
    drawPhotoCrop();
    photoCropModal?.classList.remove("hidden");
  };
  cropImage.src = cropObjectUrl;
}

if (profilePhotoFile) {
  profilePhotoFile.addEventListener("change", () => {
    const file = profilePhotoFile.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("Please choose a PNG, JPG, or WebP image.", "error");
      profilePhotoFile.value = "";
      return;
    }
    openPhotoCrop(file);
  });
}
photoZoom?.addEventListener("input", () => {
  cropZoom = Number(photoZoom.value);
  drawPhotoCrop();
});
function pointerAngle(event) {
  const rect = photoCropCanvas.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
}

function updateRotationFromPointer(event) {
  if (!rotationDrag) return;
  let delta = pointerAngle(event) - rotationDrag.startAngle;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  cropRotation = rotationDrag.startRotation + delta;
  drawPhotoCrop();
}
photoRotationHandle?.addEventListener("pointerdown", event => {
  event.preventDefault();
  photoRotationHandle.setPointerCapture(event.pointerId);
  photoRotationHandle.classList.add("is-dragging");
  rotationDrag = {
    startAngle: pointerAngle(event),
    startRotation: cropRotation
  };
});
photoRotationHandle?.addEventListener("pointermove", event => {
  if (photoRotationHandle.hasPointerCapture(event.pointerId)) updateRotationFromPointer(event);
});
photoRotationHandle?.addEventListener("pointerup", event => {
  photoRotationHandle.releasePointerCapture(event.pointerId);
  photoRotationHandle.classList.remove("is-dragging");
  rotationDrag = null;
});
photoRotationHandle?.addEventListener("pointercancel", () => {
  photoRotationHandle.classList.remove("is-dragging");
  rotationDrag = null;
});
photoCropCanvas?.addEventListener("pointerdown", event => {
  cropDrag = { x: event.clientX, y: event.clientY, offsetX: cropOffsetX, offsetY: cropOffsetY };
  photoCropCanvas.setPointerCapture(event.pointerId);
  photoCropCanvas.classList.add("is-dragging");
});
photoCropCanvas?.addEventListener("pointermove", event => {
  if (!cropDrag) return;
  cropOffsetX = cropDrag.offsetX + event.clientX - cropDrag.x;
  cropOffsetY = cropDrag.offsetY + event.clientY - cropDrag.y;
  drawPhotoCrop();
});
photoCropCanvas?.addEventListener("pointerup", () => {
  cropDrag = null;
  photoCropCanvas.classList.remove("is-dragging");
});
photoCropCanvas?.addEventListener("pointercancel", () => {
  cropDrag = null;
  photoCropCanvas.classList.remove("is-dragging");
});
getElement("apply-photo-crop-btn")?.addEventListener("click", () => {
  if (!cropImage) return;
  const output = document.createElement("canvas");
  output.width = 256;
  output.height = 256;
  const context = output.getContext("2d");
  context.drawImage(photoCropCanvas, 0, 0, output.width, output.height);
  const dataUrl = output.toDataURL("image/jpeg", 0.84);
  getElement("profile-photo-url").value = dataUrl;
  profilePhotoPreview.src = dataUrl;
  profilePhotoPreview.classList.remove("hidden");
  closePhotoCrop();
});
getElement("close-photo-crop-btn")?.addEventListener("click", closePhotoCrop);
getElement("cancel-photo-crop-btn")?.addEventListener("click", closePhotoCrop);
function closeProfileModal() {
  profileModal?.classList.add("hidden");
}
function openProfileModal() {
  const user = window.sapcFirebase?.getCurrentUser();
  if (!user || !window.sapcFirebase?.getProfile) return;
  const googleLinked = user.providerData?.some(provider => provider.providerId === "google.com");
  const googleLinkButton = getElement("link-google-btn");
  const googleLinkStatus = getElement("google-link-status");
  if (googleLinkButton) {
    googleLinkButton.textContent = googleLinked ? "Google account linked" : "Link Google account";
    googleLinkButton.disabled = googleLinked;
  }
  if (googleLinkStatus) {
    googleLinkStatus.textContent = googleLinked
      ? "Your Google account is connected and can be used for sign-in."
      : "Link Google for optional one-click sign-in and account recovery. Username and password sign-in will still work.";
  }
  window.sapcFirebase.getProfile(user).then(profile => {
    getElement("profile-display-name").value = profile.displayName || user.displayName || "";
    getElement("profile-username").value = profile.username || "";
    getElement("profile-photo-url").value = profile.photoURL || user.photoURL || "";
    if (profile.photoURL || user.photoURL) {
      profilePhotoPreview.src = profile.photoURL || user.photoURL;
      profilePhotoPreview.classList.remove("hidden");
    } else {
      profilePhotoPreview.classList.add("hidden");
    }
    getElement("profile-grade").value = profile.gradeLevel || "Grade 11";
    getElement("profile-grade").refreshThemedSelect?.();
    getElement("profile-strand").value = profile.strand || "";
    getElement("profile-strand").refreshThemedSelect?.();
    getElement("profile-bio").value = profile.bio || "";
    const ringtoneChoice = getElement("call-ringtone-choice");
    if (ringtoneChoice) {
      ringtoneChoice.value = window.SapcPeerCall?.getIncomingRingtone?.() || "classic";
      ringtoneChoice.refreshThemedSelect?.();
    }
    window.SapcPeerCall?.getCustomRingtoneInfo?.().then(info => {
      const name = getElement("call-ringtone-file-name");
      const removeButton = getElement("call-ringtone-remove");
      if (name) name.textContent = info ? `Uploaded: ${info.name}` : "No custom ringtone uploaded.";
      if (removeButton) removeButton.disabled = !info;
      if (!info && ringtoneChoice?.value === "custom") {
        ringtoneChoice.value = window.SapcPeerCall?.setIncomingRingtone?.("classic") || "classic";
        ringtoneChoice.refreshThemedSelect?.();
      }
    }).catch(error => console.warn("Could not load ringtone information:", error));
    profileModal.classList.remove("hidden");
    renderBlockedUsers();
  }).catch(error => showToast("Could not load profile: " + error.message, "error"));
}
getElement("profile-btn")?.addEventListener("click", openProfileModal);
getElement("close-profile-btn")?.addEventListener("click", closeProfileModal);
getElement("cancel-profile-btn")?.addEventListener("click", closeProfileModal);
getElement("call-ringtone-choice")?.addEventListener("change", event => {
  window.SapcPeerCall?.setIncomingRingtone?.(event.currentTarget.value);
});
getElement("call-ringtone-preview")?.addEventListener("click", () => {
  const choice = getElement("call-ringtone-choice");
  window.SapcPeerCall?.previewIncomingRingtone?.(choice?.value || "classic");
});
getElement("call-ringtone-upload")?.addEventListener("click", () => getElement("call-ringtone-file")?.click());
getElement("call-ringtone-file")?.addEventListener("change", async event => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  const uploadButton = getElement("call-ringtone-upload");
  const fileName = getElement("call-ringtone-file-name");
  if (uploadButton) { uploadButton.disabled = true; uploadButton.textContent = "Saving…"; }
  try {
    window.SapcPeerCall.previewCustomRingtoneFile(file);
    const savedName = await window.SapcPeerCall.storeCustomRingtone(file);
    const choice = getElement("call-ringtone-choice");
    if (choice) {
      choice.value = "custom";
      choice.refreshThemedSelect?.();
    }
    if (fileName) fileName.textContent = `Uploaded: ${savedName}`;
    const removeButton = getElement("call-ringtone-remove");
    if (removeButton) removeButton.disabled = false;
  } catch (error) {
    window.SapcPeerCall?.stopIncomingRingtone?.();
    showToast(error.message || "Could not save that ringtone.", "error");
  } finally {
    if (uploadButton) { uploadButton.disabled = false; uploadButton.textContent = "Upload ringtone"; }
    event.currentTarget.value = "";
  }
});
getElement("call-ringtone-remove")?.addEventListener("click", async () => {
  try {
    await window.SapcPeerCall.removeCustomRingtone();
    const choice = getElement("call-ringtone-choice");
    if (choice) {
      choice.value = window.SapcPeerCall.getIncomingRingtone();
      choice.refreshThemedSelect?.();
    }
    const fileName = getElement("call-ringtone-file-name");
    if (fileName) fileName.textContent = "No custom ringtone uploaded.";
    getElement("call-ringtone-remove").disabled = true;
  } catch (error) {
    showToast(error.message || "Could not remove the custom ringtone.", "error");
  }
});
getElement("link-google-btn")?.addEventListener("click", async event => {
  const user = window.sapcFirebase?.getCurrentUser();
  const button = event.currentTarget;
  if (!user || !window.sapcFirebase?.linkGoogle) return;
  button.disabled = true;
  button.textContent = "Connecting...";
  try {
    await window.sapcFirebase.linkGoogle(user);
    const status = getElement("google-link-status");
    if (status) status.textContent = "Your Google account is connected to this account.";
    button.textContent = "Google account linked";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Link Google account";
    const message = error.code === "auth/credential-already-in-use"
      ? "That Google account is already connected to another account."
      : error.code === "auth/popup-blocked"
        ? "Allow pop-ups for this site, then try linking Google again."
        : error.message;
    showToast(`Could not link Google: ${message}`, "error");
  }
});
getElement("save-profile-btn")?.addEventListener("click", async () => {
  const user = window.sapcFirebase?.getCurrentUser();
  if (!user) return;
  try {
    const username = getElement("profile-username").value.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) {
      throw new Error("Username must be 3–24 characters using lowercase letters, numbers, dots, underscores, or hyphens.");
    }
    const currentProfile = await window.sapcFirebase.getProfile(user);
    if (username !== currentProfile.username && !(await window.sapcFirebase.isUsernameAvailable(username))) {
      throw new Error("That username is already taken.");
    }
    const profile = await window.sapcFirebase.saveProfile(user, {
      displayName: getElement("profile-display-name").value,
      username: getElement("profile-username").value,
      photoURL: getElement("profile-photo-url").value,
      gradeLevel: getElement("profile-grade").value,
      strand: getElement("profile-strand").value,
      bio: getElement("profile-bio").value
    });
    updateProfileUI(profile.displayName || "Paduan", profile.photoURL);
    closeProfileModal();
  } catch (error) {
    showToast("Could not save profile: " + error.message, "error");
  }
});

document.addEventListener("keydown", (e) => {
  if (cardModal && !cardModal.classList.contains("hidden")) return;
  if (e.target.closest("button, summary, input, textarea, select")) return;

  if (e.code === "Space") { 
    e.preventDefault(); 
    if (cards.length > 0) {
      stopSpeech(true);
      getElement("card").classList.toggle("flipped"); 
    }
  }
  if (e.key === "ArrowRight" && cards.length > 0) getElement("next").click();
  if (e.key === "ArrowLeft" && cards.length > 0) getElement("prev").click();
});

async function loadSharedDeck() {
  const shareId = new URLSearchParams(window.location.search).get("share");
  if (!shareId || !window.sapcFirebase?.getSharedDeck) return;
  await openSharedDeckLink(window.location.href);
}
let chatImageReturnFocus = null;
let chatViewerPhotos = [];
let chatViewerIndex = 0;
async function setChatViewerPhoto(index) {
  if (!chatViewerPhotos.length) return;
  chatViewerIndex = (index + chatViewerPhotos.length) % chatViewerPhotos.length;
  const item = chatViewerPhotos[chatViewerIndex];
  const viewerImage = getElement("chat-image-viewer-image");
  const backdrop = getElement("chat-image-viewer-backdrop");
  const counter = getElement("chat-image-viewer-counter");
  const previous = getElement("chat-image-viewer-prev");
  const next = getElement("chat-image-viewer-next");
  if (counter) counter.textContent = `${chatViewerIndex + 1} of ${chatViewerPhotos.length}`;
  if (previous) previous.disabled = chatViewerPhotos.length < 2;
  if (next) next.disabled = chatViewerPhotos.length < 2;
  if (viewerImage) {
    viewerImage.alt = item.name || `Photo ${chatViewerIndex + 1} from chat`;
    viewerImage.classList.add("is-loading");
  }
  const thumbs = getElement("chat-image-viewer-thumbnails");
  if (thumbs) {
    thumbs.replaceChildren();
    thumbs.classList.toggle("hidden", chatViewerPhotos.length < 2);
    chatViewerPhotos.forEach((photo, photoIndex) => {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = `chat-image-viewer-thumb${photoIndex === chatViewerIndex ? " active" : ""}`;
      thumb.setAttribute("aria-label", `View photo ${photoIndex + 1}`);
      thumb.setAttribute("aria-current", String(photoIndex === chatViewerIndex));
      const thumbImage = document.createElement("img");
      thumbImage.alt = "";
      thumb.append(thumbImage);
      thumb.addEventListener("click", () => setChatViewerPhoto(photoIndex));
      thumbs.append(thumb);
      if (photoIndex === chatViewerIndex) thumb.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      resolveChatAttachmentMedia(photo, window.sapcFirebase?.getCurrentUser()).then(url => {
        if (thumbImage.isConnected) thumbImage.src = url;
      }).catch(() => thumb.classList.add("unavailable"));
    });
  }
  try {
    const source = await resolveChatAttachmentMedia(item, window.sapcFirebase?.getCurrentUser());
    if (viewerImage && chatViewerPhotos[chatViewerIndex] === item) {
      viewerImage.src = source;
      viewerImage.classList.remove("is-loading");
      if (backdrop) backdrop.src = source;
    }
  } catch (error) {
    showToast(`Could not open photo: ${error.message}`, "error");
    closeChatImageViewer();
  }
}

function openChatImageViewer(image, photos = [], index = 0) {
  const viewer = getElement("chat-image-viewer");
  if (!image?.src || !viewer) return;
  chatImageReturnFocus = image;
  chatViewerPhotos = photos.length ? photos : [image.chatAttachmentItem || { url: image.currentSrc || image.src, name: image.alt || "Photo from chat" }];
  viewer.classList.remove("hidden");
  setChatViewerPhoto(index);
  getElement("chat-image-viewer-close")?.focus();
}

function openChatImageViewerFromItem(item, photos = []) {
  const image = { src: "chat-photo", chatAttachmentItem: item, focus: () => {} };
  openChatImageViewer(image, photos, photos.indexOf(item));
}

async function openChatVideoLightbox(item) {
  const viewer = getElement("chat-video-lightbox");
  const player = getElement("chat-video-lightbox-player");
  if (!viewer || !player || !item) return;
  try {
    player.src = await resolveChatAttachmentMedia(item, window.sapcFirebase?.getCurrentUser());
    viewer.classList.remove("hidden");
    await player.play().catch(() => {});
    getElement("chat-video-lightbox-close")?.focus();
  } catch (error) { showToast(`Could not open video: ${error.message}`, "error"); }
}

function closeChatImageViewer() {
  const viewer = getElement("chat-image-viewer");
  if (viewer) viewer.classList.add("hidden");
  const viewerImage = getElement("chat-image-viewer-image");
  if (viewerImage) viewerImage.removeAttribute("src");
  const backdrop = getElement("chat-image-viewer-backdrop");
  if (backdrop) backdrop.removeAttribute("src");
  getElement("chat-image-viewer-thumbnails")?.replaceChildren();
  chatViewerPhotos = [];
  chatViewerIndex = 0;
  if (chatImageReturnFocus?.isConnected) chatImageReturnFocus.focus();
  chatImageReturnFocus = null;
}

getElement("chat-image-viewer-close")?.addEventListener("click", closeChatImageViewer);
getElement("chat-image-viewer-prev")?.addEventListener("click", () => setChatViewerPhoto(chatViewerIndex - 1));
getElement("chat-image-viewer-next")?.addEventListener("click", () => setChatViewerPhoto(chatViewerIndex + 1));
getElement("chat-image-viewer")?.addEventListener("click", event => {
  if (event.target === event.currentTarget) closeChatImageViewer();
});
let chatViewerTouchStartX = 0;
getElement("chat-image-viewer-stage")?.addEventListener("touchstart", event => {
  chatViewerTouchStartX = event.changedTouches[0]?.clientX || 0;
}, { passive: true });
getElement("chat-image-viewer-stage")?.addEventListener("touchend", event => {
  const delta = (event.changedTouches[0]?.clientX || 0) - chatViewerTouchStartX;
  if (Math.abs(delta) > 45) setChatViewerPhoto(chatViewerIndex + (delta < 0 ? 1 : -1));
}, { passive: true });
getElement("chat-image-viewer-download")?.addEventListener("click", async event => {
  const item = chatViewerPhotos[chatViewerIndex];
  if (!item) return;
  const button = event.currentTarget;
  const originalLabel = button.textContent;
  try {
    await downloadChatAttachment(item, window.sapcFirebase?.getCurrentUser());
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = "Could not save";
    showToast(`Could not save photo: ${error.message}`, "error");
  }
  setTimeout(() => { if (button.isConnected) button.textContent = originalLabel; }, 1800);
});
getElement("chat-image-viewer-share")?.addEventListener("click", async event => {
  const image = getElement("chat-image-viewer-image");
  const item = chatViewerPhotos[chatViewerIndex];
  if (!image?.src || !item) return;
  const button = event.currentTarget;
  const originalLabel = button.textContent;
  try {
    const response = await fetch(image.src);
    if (!response.ok) throw new Error("Image could not be read.");
    const file = new File([await response.blob()], "chat-image", { type: response.headers.get("content-type") || "image/jpeg" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: item.name || "Photo from chat" });
    } else if (navigator.share) {
      await navigator.share({ title: item.name || "Photo from chat", url: image.src });
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(image.src);
      button.textContent = "Link copied";
    } else {
      throw new Error("Sharing is not supported in this browser.");
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      button.textContent = error.message.includes("supported") ? "Unavailable" : "Could not share";
      console.error("Could not share chat image:", error);
    }
  }
  setTimeout(() => { if (button.isConnected) button.textContent = originalLabel; }, 1800);
});

document.addEventListener("keydown", event => {
  const videoViewer = getElement("chat-video-lightbox");
  if (event.key === "Escape" && videoViewer && !videoViewer.classList.contains("hidden")) {
    getElement("chat-video-lightbox-close")?.click(); return;
  }
  const viewer = getElement("chat-image-viewer");
  if (!viewer || viewer.classList.contains("hidden")) return;
  if (event.key === "Escape") closeChatImageViewer();
  if (event.key === "ArrowLeft" && chatViewerPhotos.length > 1) {
    event.preventDefault();
    setChatViewerPhoto(chatViewerIndex - 1);
  }
  if (event.key === "ArrowRight" && chatViewerPhotos.length > 1) {
    event.preventDefault();
    setChatViewerPhoto(chatViewerIndex + 1);
  }
});

// Replace native select popups with accessible, searchable controls that use the site theme.
let themedSelectIdCounter = 0;
function enhanceThemedSelect(select) {
  if (!select || select.dataset.themedReady === "true") return;
  select.dataset.themedReady = "true";
  const wrapper = document.createElement("div");
  wrapper.className = "themed-select";
  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select);
  select.classList.add("themed-native-select");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");

  const controlId = select.id || `generated-themed-select-${++themedSelectIdCounter}`;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "themed-select-trigger";
  trigger.id = `${controlId}-themed-trigger`;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : select.closest("label");
  const labelText = label?.textContent.trim() || select.getAttribute("aria-label") || "Select an option";
  const value = document.createElement("span");
  value.className = "themed-select-value";
  trigger.append(value);
  trigger.setAttribute("aria-label", labelText);
  if (label) label.htmlFor = trigger.id;

  const menu = document.createElement("div");
  menu.className = "themed-select-menu";
  menu.id = `${controlId}-themed-menu`;
  menu.setAttribute("role", "listbox");
  trigger.setAttribute("aria-controls", menu.id);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "themed-select-search hidden";
  search.placeholder = "Search options…";
  search.setAttribute("aria-label", `Search ${trigger.getAttribute("aria-label")}`);
  const optionsList = document.createElement("div");
  optionsList.className = "themed-select-options";
  menu.append(search, optionsList);
  wrapper.append(trigger, menu);

  function closeMenu(returnFocus = false) {
    wrapper.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    search.value = "";
    if (returnFocus) trigger.focus();
  }
  function renderOptions(query = "") {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const choices = Array.from(select.options).filter(option => !option.hidden && option.textContent.toLocaleLowerCase().includes(normalizedQuery));
    optionsList.replaceChildren();
    if (!choices.length) {
      const empty = document.createElement("p");
      empty.className = "themed-select-empty";
      empty.textContent = "No matching options";
      optionsList.append(empty);
      return;
    }
    choices.forEach(option => {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "themed-select-option";
      choice.setAttribute("role", "option");
      choice.setAttribute("aria-selected", String(option.value === select.value));
      choice.disabled = option.disabled;
      choice.textContent = option.textContent;
      choice.addEventListener("click", () => {
        if (select.value !== option.value) {
          select.value = option.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        refresh();
        closeMenu(true);
      });
      optionsList.append(choice);
    });
  }
  function refresh() {
    const selected = select.selectedOptions[0];
    value.textContent = selected?.textContent.trim() || "Choose an option…";
    trigger.setAttribute("aria-label", `${labelText}: ${value.textContent}`);
    trigger.disabled = select.disabled || select.options.length === 0;
    const searchable = select.options.length > 8;
    search.classList.toggle("hidden", !searchable);
    search.placeholder = searchable ? `Search ${select.options.length} options…` : "Search options…";
    renderOptions(search.value);
  }
  function openMenu() {
    if (trigger.disabled) return;
    document.querySelectorAll(".themed-select.open").forEach(other => {
      if (other !== wrapper) {
        other.classList.remove("open");
        other.querySelector(".themed-select-trigger")?.setAttribute("aria-expanded", "false");
      }
    });
    refresh();
    wrapper.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    if (!search.classList.contains("hidden")) search.focus();
    else (optionsList.querySelector('[aria-selected="true"]:not(:disabled)') || optionsList.querySelector(".themed-select-option:not(:disabled)"))?.focus();
  }
  trigger.addEventListener("click", () => wrapper.classList.contains("open") ? closeMenu() : openMenu());
  trigger.addEventListener("keydown", event => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu();
    }
  });
  search.addEventListener("input", () => renderOptions(search.value));
  search.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionsList.querySelector(".themed-select-option:not(:disabled)")?.focus();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      optionsList.querySelector(".themed-select-option:not(:disabled)")?.click();
    }
  });
  optionsList.addEventListener("keydown", event => {
    const options = Array.from(optionsList.querySelectorAll(".themed-select-option:not(:disabled)"));
    const current = options.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      options[(current + delta + options.length) % options.length]?.focus();
    }
    if (event.key === "Home") { event.preventDefault(); options[0]?.focus(); }
    if (event.key === "End") { event.preventDefault(); options.at(-1)?.focus(); }
  });
  select.addEventListener("change", refresh);
  const optionObserver = new MutationObserver(refresh);
  optionObserver.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "selected"] });
  select.refreshThemedSelect = refresh;
  refresh();
}

function enhanceSelectsIn(root) {
  if (root instanceof HTMLSelectElement) enhanceThemedSelect(root);
  root.querySelectorAll?.("select").forEach(enhanceThemedSelect);
}
enhanceSelectsIn(document);
new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(enhanceSelectsIn)))
  .observe(document.body, { childList: true, subtree: true });
document.addEventListener("pointerdown", event => {
  if (event.target instanceof Element && event.target.closest(".themed-select")) return;
  document.querySelectorAll(".themed-select.open").forEach(wrapper => {
    wrapper.classList.remove("open");
    wrapper.querySelector(".themed-select-trigger")?.setAttribute("aria-expanded", "false");
  });
});

loadCardsFromStorage();
renderProgressDashboard();
loadSharedDeck();
