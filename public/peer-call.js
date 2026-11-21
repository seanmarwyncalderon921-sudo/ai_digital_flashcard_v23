(function installPeerCall() {
  "use strict";

  const FALLBACK_ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
  ];
  const $ = id => document.getElementById(id);
  let ringtoneContext = null;
  let ringtoneInterval = null;
  let ringtonePrimed = false;
  const ringtoneNames = new Set(["classic", "gentle", "digital", "bright", "custom", "off"]);
  const ringtonePatterns = {
    classic: [{ notes: [440, 554], duration: 0.34 }, { notes: [494, 622], duration: 0.38, pause: 0.12 }],
    gentle: [{ notes: [523, 659], duration: 0.22 }, { notes: [659, 784], duration: 0.32, pause: 0.16 }],
    digital: [{ notes: [660], duration: 0.12 }, { notes: [880], duration: 0.12, pause: 0.08 }, { notes: [660], duration: 0.12, pause: 0.08 }, { notes: [990], duration: 0.2, pause: 0.14 }],
    bright: [{ notes: [784, 988], duration: 0.2 }, { notes: [659, 784], duration: 0.24, pause: 0.1 }, { notes: [880, 1109], duration: 0.28, pause: 0.12 }]
  };
  const defaultRingtone = "classic";
  const ringtoneDbName = "sapc-call-ringtones";
  const ringtoneStoreName = "clips";
  const customRingtoneAudio = new Audio();
  customRingtoneAudio.preload = "auto";
  customRingtoneAudio.loop = true;
  let customRingtoneBlobUrl = "";
  let customRingtoneBlob = null;
  let customRingtoneOwnerKey = "";

  function openRingtoneDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("This browser does not support local ringtone storage.")); return; }
      const request = indexedDB.open(ringtoneDbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ringtoneStoreName)) request.result.createObjectStore(ringtoneStoreName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open ringtone storage."));
    });
  }

  async function readCustomRingtone() {
    const db = await openRingtoneDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(ringtoneStoreName, "readonly").objectStore(ringtoneStoreName).get(getRingtoneStorageKey());
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read the custom ringtone."));
      });
    } finally { db.close(); }
  }

  async function storeCustomRingtone(file) {
    const extension = file?.name?.split(".").pop()?.toLowerCase() || "";
    const allowedExtensions = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "webm"]);
    if (!file || (!(file.type || "").startsWith("audio/") && !allowedExtensions.has(extension))) {
      throw new Error("Choose an audio file such as MP3, M4A, WAV, OGG, or WebM.");
    }
    if (file.size > 5 * 1024 * 1024) throw new Error("Ringtone files must be 5 MB or smaller.");
    const db = await openRingtoneDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(ringtoneStoreName, "readwrite");
        transaction.objectStore(ringtoneStoreName).put(file, getRingtoneStorageKey());
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not save the custom ringtone."));
        transaction.onabort = () => reject(transaction.error || new Error("Could not save the custom ringtone."));
      });
    } finally { db.close(); }
    setIncomingRingtone("custom");
    await loadCustomRingtoneAudio(file);
    return file.name;
  }

  async function loadCustomRingtoneAudio(blob = null) {
    const clip = blob || await readCustomRingtone();
    if (!clip) return false;
    if (clip === customRingtoneBlob && customRingtoneAudio.src) return true;
    if (customRingtoneBlobUrl) URL.revokeObjectURL(customRingtoneBlobUrl);
    customRingtoneBlob = clip;
    customRingtoneOwnerKey = getRingtoneStorageKey();
    customRingtoneBlobUrl = URL.createObjectURL(clip);
    customRingtoneAudio.src = customRingtoneBlobUrl;
    customRingtoneAudio.load();
    return true;
  }

  async function getCustomRingtoneInfo() {
    const clip = await readCustomRingtone();
    if (clip) await loadCustomRingtoneAudio(clip);
    return clip ? { name: clip.name || "Custom ringtone", size: clip.size || 0 } : null;
  }

  function previewCustomRingtoneFile(file) {
    stopIncomingRingtone();
    if (customRingtoneBlobUrl) URL.revokeObjectURL(customRingtoneBlobUrl);
    customRingtoneBlob = file;
    customRingtoneOwnerKey = getRingtoneStorageKey();
    customRingtoneBlobUrl = URL.createObjectURL(file);
    customRingtoneAudio.src = customRingtoneBlobUrl;
    customRingtoneAudio.currentTime = 0;
    customRingtoneAudio.play().catch(error => console.warn("Could not preview the selected ringtone:", error));
    setTimeout(() => {
      if (!ringtoneInterval) { customRingtoneAudio.pause(); customRingtoneAudio.currentTime = 0; }
    }, 5000);
  }

  async function removeCustomRingtone() {
    const db = await openRingtoneDb();
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(ringtoneStoreName, "readwrite");
        transaction.objectStore(ringtoneStoreName).delete(getRingtoneStorageKey());
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not remove the custom ringtone."));
      });
    } finally { db.close(); }
    customRingtoneAudio.pause();
    customRingtoneAudio.removeAttribute("src");
    customRingtoneAudio.load();
    if (customRingtoneBlobUrl) URL.revokeObjectURL(customRingtoneBlobUrl);
    customRingtoneBlobUrl = "";
    customRingtoneBlob = null;
    customRingtoneOwnerKey = "";
    if (getIncomingRingtone() === "custom") setIncomingRingtone(defaultRingtone);
  }

  function getRingtoneStorageKey() {
    let uid = "guest";
    try { uid = window.sapcFirebase?.getCurrentUser?.()?.uid || uid; } catch {}
    return `sapc.call.ringtone.${uid}`;
  }

  function getIncomingRingtone() {
    try {
      const saved = localStorage.getItem(getRingtoneStorageKey());
      return ringtoneNames.has(saved) ? saved : defaultRingtone;
    } catch { return defaultRingtone; }
  }

  function setIncomingRingtone(name) {
    const next = ringtoneNames.has(name) ? name : defaultRingtone;
    try { localStorage.setItem(getRingtoneStorageKey(), next); } catch {}
    return next;
  }

  function prepareRingtoneAudio() {
    if (ringtonePrimed) return;
    ringtonePrimed = true;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        ringtoneContext ||= new AudioContextClass();
        ringtoneContext.resume().catch(() => {});
      } catch {}
    }
    if (getIncomingRingtone() === "custom" && customRingtoneAudio.src && customRingtoneOwnerKey === getRingtoneStorageKey()) {
      customRingtoneAudio.muted = true;
      customRingtoneAudio.play().then(() => {
        customRingtoneAudio.pause();
        customRingtoneAudio.currentTime = 0;
        customRingtoneAudio.muted = false;
      }).catch(() => { customRingtoneAudio.muted = false; });
    }
    document.removeEventListener("pointerdown", prepareRingtoneAudio);
    document.removeEventListener("keydown", prepareRingtoneAudio);
  }

  document.addEventListener("pointerdown", prepareRingtoneAudio, { passive: true });
  document.addEventListener("keydown", prepareRingtoneAudio);

  function playRingtoneBurst() {
    const ringtone = getIncomingRingtone();
    if (ringtone === "custom") {
      if (customRingtoneAudio.src && customRingtoneOwnerKey === getRingtoneStorageKey()) {
        if (customRingtoneAudio.paused) customRingtoneAudio.play().catch(() => {});
      } else loadCustomRingtoneAudio().then(loaded => {
        if (loaded && ringtoneInterval) customRingtoneAudio.play().catch(() => {});
      }).catch(error => console.warn("Could not load custom ringtone:", error));
      return;
    }
    if (ringtone === "off" || !ringtoneContext || ringtoneContext.state !== "running") return;
    const start = ringtoneContext.currentTime;
    let offset = 0;
    for (const note of ringtonePatterns[ringtone] || ringtonePatterns[defaultRingtone]) {
      for (const frequency of note.notes) {
        const oscillator = ringtoneContext.createOscillator();
        const gain = ringtoneContext.createGain();
        const noteStart = start + offset;
        const duration = note.duration;
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.105, noteStart + 0.025);
        gain.gain.setValueAtTime(0.105, noteStart + Math.max(0.04, duration - 0.045));
        gain.gain.linearRampToValueAtTime(0, noteStart + duration);
        oscillator.connect(gain);
        gain.connect(ringtoneContext.destination);
        oscillator.start(noteStart);
        oscillator.stop(noteStart + duration + 0.01);
        oscillator.addEventListener("ended", () => { oscillator.disconnect(); gain.disconnect(); }, { once: true });
      }
      offset += note.duration + (note.pause || 0);
    }
  }

  function startIncomingRingtone() {
    if (ringtoneInterval) return;
    if (getIncomingRingtone() === "off") return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!ringtoneContext && AudioContextClass) {
      try { ringtoneContext = new AudioContextClass(); } catch {}
    }
    ringtoneContext?.resume().catch(() => {});
    playRingtoneBurst();
    ringtoneInterval = setInterval(() => {
      if (getIncomingRingtone() === "off") { stopIncomingRingtone(); return; }
      playRingtoneBurst();
      if (navigator.vibrate) navigator.vibrate([220, 140, 220]);
    }, 1900);
    if (navigator.vibrate) navigator.vibrate([220, 140, 220]);
  }

  function previewIncomingRingtone(name = getIncomingRingtone()) {
    setIncomingRingtone(name);
    stopIncomingRingtone();
    if (name === "off") return;
    if (name === "custom") {
      if (customRingtoneAudio.src && customRingtoneOwnerKey === getRingtoneStorageKey()) {
        customRingtoneAudio.currentTime = 0;
        customRingtoneAudio.play().catch(error => console.warn("Could not preview custom ringtone:", error));
        setTimeout(() => {
          if (!ringtoneInterval) { customRingtoneAudio.pause(); customRingtoneAudio.currentTime = 0; }
        }, 5000);
        return;
      }
      loadCustomRingtoneAudio().then(loaded => {
        if (!loaded) throw new Error("Upload a ringtone before selecting it.");
        customRingtoneAudio.currentTime = 0;
        customRingtoneAudio.play().catch(() => {});
        setTimeout(() => {
          if (!ringtoneInterval) { customRingtoneAudio.pause(); customRingtoneAudio.currentTime = 0; }
        }, 5000);
      }).catch(error => console.warn("Could not preview custom ringtone:", error));
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!ringtoneContext && AudioContextClass) {
      try { ringtoneContext = new AudioContextClass(); } catch {}
    }
    ringtoneContext?.resume().then(() => {
      playRingtoneBurst();
      setTimeout(() => {
        if (!ringtoneInterval && ringtoneContext?.state === "running") ringtoneContext.suspend().catch(() => {});
      }, 1600);
    }).catch(() => {});
  }

  function stopIncomingRingtone() {
    if (ringtoneInterval) clearInterval(ringtoneInterval);
    ringtoneInterval = null;
    customRingtoneAudio.pause();
    try { customRingtoneAudio.currentTime = 0; } catch {}
    if (navigator.vibrate) navigator.vibrate(0);
    if (ringtoneContext?.state === "running") ringtoneContext.suspend().catch(() => {});
  }

  function newCallId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function createPeerCall({ conversationId, peerName, signaling, getIceServers }) {
    if (!conversationId || !signaling || typeof signaling.send !== "function") {
      throw new TypeError("A conversation and signaling connection are required.");
    }

    let disposed = false;
    let callId = "";
    let role = "";
    let localStream = null;
    let peerConnection = null;
    let transport = signaling;
    let incomingTimer = null;
    let dismissTimer = null;
    let deviceStatusTimer = null;
    let connectionTimer = null;
    let pendingCandidates = [];
    let isMuted = false;
    let cameraOff = false;
    let starting = false;
    let accepting = false;
    let audioOnly = false;
    let callConnectedAt = 0;
    let callClockTimer = null;
    let remoteSpeakerContext = null;
    let remoteSpeakerAnalyser = null;
    let remoteSpeakerSource = null;
    let remoteSpeakerFrame = 0;
    let remoteSpeakerLastActiveAt = 0;
    let localAudioContext = null;
    let localAudioAnalyser = null;
    let localAudioSource = null;
    let localAudioFrame = 0;
    let statsTimer = null;
    let keyReleaseTimer = null;
    let callListeners = null;
    let screenStream = null;
    let screenTrack = null;
    let pendingDeviceSwitch = null;
    let deviceToastTimer = null;
    let isMinimized = false;
    let isRecordingKeybind = false;
    let pttHeld = false;
    let voiceMode = "open";
    let pttKey = "Space";
    let noiseSuppression = true;
    let appliedOutputDeviceId = "";
    const knownInputDevices = new Set();
    const rawStoredDevices = readJsonPreference("sapc_call_devices", {});
    const storedDevices = rawStoredDevices && typeof rawStoredDevices === "object" && !Array.isArray(rawStoredDevices) ? rawStoredDevices : {};
    const rawStoredPtt = readJsonPreference("sapc_ptt_settings", {});
    const storedPtt = rawStoredPtt && typeof rawStoredPtt === "object" && !Array.isArray(rawStoredPtt) ? rawStoredPtt : {};
    const pttPreferences = { voiceMode: "open", key: "Space", ...storedPtt };
    voiceMode = pttPreferences.voiceMode === "ptt" ? "ptt" : "open";
    pttKey = typeof pttPreferences.key === "string" && pttPreferences.key ? pttPreferences.key : "Space";
    noiseSuppression = storedDevices.noiseSuppression !== false;
    const listenerController = new AbortController();
    const modal = $("peer-call-modal");
    const localVideo = $("peer-call-local");
    const remoteVideo = $("peer-call-remote");
    const remoteAudio = $("peer-call-remote-audio");
    const status = $("peer-call-status");
    const incomingActions = $("peer-call-incoming-actions");
    const activeActions = $("peer-call-active-actions");
    const deviceToast = $("peer-call-device-toast");

    function readJsonPreference(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key) || "null") || fallback; }
      catch { return fallback; }
    }

    function saveDevicePreferences() {
      try { localStorage.setItem("sapc_call_devices", JSON.stringify({
        audioInputId: storedDevices.audioInputId || "",
        audioOutputId: storedDevices.audioOutputId || "",
        videoInputId: storedDevices.videoInputId || "",
        noiseSuppression
      })); } catch {}
    }

    function savePttPreferences() {
      pttPreferences.voiceMode = voiceMode;
      pttPreferences.key = pttKey;
      try { localStorage.setItem("sapc_ptt_settings", JSON.stringify(pttPreferences)); } catch {}
    }

    function updateCallIdentity() {
      const name = String(peerName || "Your friend").trim() || "Your friend";
      const initials = name.split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "P";
      const title = $("peer-call-title");
      const type = $("peer-call-type");
      const avatar = $("peer-call-avatar");
      const voiceAvatar = $("peer-call-voice-avatar");
      const voiceName = $("peer-call-voice-name");
      if (title) title.textContent = name;
      if (type) type.textContent = audioOnly ? "VOICE CALL" : "VIDEO CALL";
      if (avatar) avatar.textContent = initials;
      if (voiceAvatar) voiceAvatar.textContent = initials;
      if (voiceName) voiceName.textContent = name;
    }

    function renderCallDuration() {
      const duration = $("peer-call-duration");
      if (!duration) return;
      if (!callConnectedAt) { duration.textContent = "--:--"; return; }
      const elapsed = Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000));
      duration.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
    }

    function startCallClock() {
      if (!callConnectedAt) callConnectedAt = Date.now();
      clearInterval(callClockTimer);
      renderCallDuration();
      callClockTimer = setInterval(renderCallDuration, 1000);
    }

    function primeRemoteSpeakerContext() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      try {
        if (!remoteSpeakerContext || remoteSpeakerContext.state === "closed") remoteSpeakerContext = new AudioContextClass();
        remoteSpeakerContext.resume().catch(() => {});
      } catch (error) { console.warn("Speaker detection is unavailable:", error?.message || error); }
    }

    function updateControlStates() {
      const mute = $("peer-call-mute");
      const camera = $("peer-call-camera");
      if (mute) {
        mute.classList.toggle("is-muted", isMuted);
        mute.setAttribute("aria-pressed", String(isMuted));
        mute.setAttribute("aria-label", isMuted ? "Unmute microphone" : "Mute microphone");
        const label = $("peer-call-mute-label");
        if (label) label.textContent = isMuted ? "Unmute" : "Mute";
      }
      if (camera) {
        camera.classList.toggle("is-camera-off", cameraOff);
        camera.setAttribute("aria-pressed", String(cameraOff));
        camera.setAttribute("aria-label", cameraOff ? "Turn camera on" : "Turn camera off");
        const label = $("peer-call-camera-label");
        if (label) label.textContent = cameraOff ? "Camera on" : "Camera";
      }
      modal?.classList.toggle("camera-off", cameraOff);
      if (voiceMode === "ptt") updatePttEnabled(pttHeld);
      renderPttState();
    }

    function toggleMute() {
      isMuted = !isMuted;
      if (voiceMode === "ptt") updatePttEnabled(pttHeld && !isMuted);
      else localStream?.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
      updateControlStates();
      const miniMute = $("peer-call-mini-mute");
      if (miniMute) miniMute.textContent = isMuted ? "Unmute" : "Mic";
    }

    function toggleCamera() {
      cameraOff = !cameraOff;
      localStream?.getVideoTracks().forEach(track => { track.enabled = !cameraOff; });
      updateControlStates();
      const miniCamera = $("peer-call-mini-camera");
      if (miniCamera) miniCamera.textContent = cameraOff ? "Camera on" : "Cam";
    }

    function setStatus(message) {
      if (status) status.textContent = message;
      const voiceCaption = $("peer-call-voice-caption");
      if (voiceCaption) voiceCaption.textContent = message;
      modal?.classList.toggle("is-connected", message === "Connected");
    }

    function renderPttState() {
      const pill = $("peer-call-ptt-status");
      const keyButton = $("peer-call-keybind");
      const modeSelect = $("peer-call-voice-mode");
      const pttActive = voiceMode === "ptt";
      if (pill) {
        pill.classList.toggle("hidden", !pttActive);
        pill.textContent = isMuted ? "Microphone muted" : pttHeld ? "Talking" : `Hold ${formatKey(pttKey)} to talk`;
      }
      if (keyButton) keyButton.textContent = isRecordingKeybind ? "Press a key…" : formatKey(pttKey);
      if (modeSelect) modeSelect.value = voiceMode;
      modal?.classList.toggle("local-speaking", pttActive && pttHeld && !isMuted);
    }

    function formatKey(key) {
      if (key === "Space") return "Space";
      if (key.startsWith("Key")) return key.slice(3);
      if (key.startsWith("Digit")) return key.slice(5);
      return key.length === 1 ? key.toUpperCase() : key;
    }

    function isEditableTarget(target) {
      return target instanceof Element && (Boolean(target.closest("input, textarea, select, [role='textbox']"))
        || (target instanceof HTMLElement && target.isContentEditable));
    }

    function updatePttEnabled(enabled) {
      if (!localStream) return;
      localStream.getAudioTracks().forEach(track => { track.enabled = enabled && !isMuted; });
      modal?.classList.toggle("local-speaking", Boolean(enabled && !isMuted));
      localVideo?.classList.toggle("is-speaking", Boolean(enabled && !isMuted));
      $("peer-call-local-voice-avatar")?.classList.toggle("is-speaking", Boolean(enabled && !isMuted));
    }

    function handlePttKeyDown(event) {
      if (isRecordingKeybind) {
        if (["Escape", "Tab"].includes(event.key)) { isRecordingKeybind = false; renderPttState(); return; }
        event.preventDefault();
        pttKey = event.code || event.key;
        isRecordingKeybind = false;
        savePttPreferences();
        renderPttState();
        return;
      }
      if (voiceMode !== "ptt" || event.repeat || isEditableTarget(event.target)) return;
      if (event.code === pttKey || event.key === pttKey || (pttKey === "Space" && event.code === "Space")) {
        if (event.code === "Space") event.preventDefault();
        clearTimeout(keyReleaseTimer);
        pttHeld = true;
        updatePttEnabled(true);
        renderPttState();
      }
    }

    function handlePttKeyUp(event) {
      if (voiceMode !== "ptt" || !(event.code === pttKey || event.key === pttKey || (pttKey === "Space" && event.code === "Space"))) return;
      clearTimeout(keyReleaseTimer);
      keyReleaseTimer = setTimeout(() => {
        pttHeld = false;
        updatePttEnabled(false);
        renderPttState();
      }, 150);
    }

    function closeSettingsPopover() {
      $("peer-call-settings-popover")?.classList.add("hidden");
      $("peer-call-settings-button")?.setAttribute("aria-expanded", "false");
    }

    function openSettingsAt(controlId) {
      const popover = $("peer-call-settings-popover");
      popover?.classList.remove("hidden");
      $("peer-call-settings-button")?.setAttribute("aria-expanded", "true");
      void refreshDevices();
      requestAnimationFrame(() => $(controlId)?.focus());
    }

    async function applyOutputDevice(deviceId, { allowPermissionPrompt = false } = {}) {
      const audioElement = remoteAudio || remoteVideo;
      if (!audioElement || typeof audioElement.setSinkId !== "function") {
        const select = $("peer-call-audio-output");
        if (select) { select.disabled = true; select.replaceChildren(new Option("Browser default", "")); }
        return false;
      }
      let effectiveId = deviceId || "";
      try {
        try {
          await audioElement.setSinkId(effectiveId);
        } catch (error) {
          if (!allowPermissionPrompt || error?.name !== "NotAllowedError" || !navigator.mediaDevices?.selectAudioOutput) throw error;
          const granted = await navigator.mediaDevices.selectAudioOutput(effectiveId ? { deviceId: effectiveId } : undefined);
          effectiveId = granted?.deviceId || effectiveId;
          await audioElement.setSinkId(effectiveId);
        }
        if (remoteVideo && remoteVideo !== audioElement && typeof remoteVideo.setSinkId === "function") {
          await remoteVideo.setSinkId(effectiveId).catch(error => console.warn("Could not route remote video audio:", error?.message || error));
        }
        appliedOutputDeviceId = effectiveId;
        storedDevices.audioOutputId = effectiveId;
        saveDevicePreferences();
        const select = $("peer-call-audio-output");
        if (select && [...select.options].some(option => option.value === effectiveId)) select.value = effectiveId;
        return true;
      } catch (error) {
        const select = $("peer-call-audio-output");
        if (select) select.value = appliedOutputDeviceId;
        storedDevices.audioOutputId = appliedOutputDeviceId;
        saveDevicePreferences();
        throw new Error(`Could not switch speaker output: ${error?.message || "the browser rejected this device"}`);
      }
    }

    async function refreshDevices({ notifyNew = false } = {}) {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      let devices;
      try { devices = await navigator.mediaDevices.enumerateDevices(); }
      catch (error) { console.warn("Could not list call devices:", error?.message || error); return; }
      const groups = {
        audioinput: $("peer-call-audio-input"),
        audiooutput: $("peer-call-audio-output"),
        videoinput: $("peer-call-video-input")
      };
      const preferred = {
        audioinput: storedDevices.audioInputId || "",
        audiooutput: storedDevices.audioOutputId || "",
        videoinput: storedDevices.videoInputId || ""
      };
      for (const [kind, select] of Object.entries(groups)) {
        if (!select) continue;
        const available = devices.filter(device => device.kind === kind);
        const options = available.map((device, index) => new Option(device.label || `${kind === "audioinput" ? "Microphone" : kind === "audiooutput" ? "Speaker" : "Camera"} ${index + 1}`, device.deviceId));
        if (kind === "audiooutput" && typeof (remoteAudio || remoteVideo)?.setSinkId !== "function") {
          select.replaceChildren(new Option("Browser default", ""));
          select.disabled = true;
          continue;
        }
        select.disabled = false;
        if (!options.length) options.push(new Option("Browser default", ""));
        select.replaceChildren(...options);
        const value = options.some(option => option.value === preferred[kind]) ? preferred[kind] : (options[0]?.value || "");
        select.value = value;
        if (kind === "audioinput") storedDevices.audioInputId = value;
        if (kind === "audiooutput") storedDevices.audioOutputId = value;
        if (kind === "videoinput") storedDevices.videoInputId = value;
      }
      saveDevicePreferences();
      const current = new Set(devices.filter(device => ["audioinput", "videoinput"].includes(device.kind) && device.deviceId && !["default", "communications"].includes(device.deviceId)).map(device => device.deviceId));
      if (notifyNew) {
        const added = devices.find(device => ["audioinput", "videoinput"].includes(device.kind)
          && device.deviceId && !["default", "communications"].includes(device.deviceId)
          && !knownInputDevices.has(device.deviceId));
        if (added) showDeviceToast(added);
      }
      knownInputDevices.clear();
      current.forEach(id => knownInputDevices.add(id));
      if (!notifyNew && storedDevices.audioOutputId) await applyOutputDevice(storedDevices.audioOutputId);
    }

    function showDeviceToast(device) {
      pendingDeviceSwitch = device;
      const label = device.label || (device.kind === "audioinput" ? "New microphone" : "New camera");
      const text = $("peer-call-device-toast-text");
      if (text) text.textContent = `New ${device.kind === "audioinput" ? "microphone" : "camera"} detected: ${label}`;
      deviceToast?.classList.remove("hidden");
      deviceToast?.classList.add("is-visible");
      clearTimeout(deviceToastTimer);
      deviceToastTimer = setTimeout(dismissDeviceToast, 8000);
    }

    function dismissDeviceToast() {
      clearTimeout(deviceToastTimer);
      deviceToastTimer = null;
      deviceToast?.classList.remove("is-visible");
      setTimeout(() => deviceToast?.classList.add("hidden"), 220);
      pendingDeviceSwitch = null;
    }

    function showCallDeviceError(error) {
      console.warn("Call media control failed:", error?.message || error);
      setStatus(error?.message || "Could not change the call device.");
      clearTimeout(deviceStatusTimer);
      deviceStatusTimer = setTimeout(() => {
        if (callId && peerConnection?.connectionState === "connected") setStatus("Connected");
      }, 3500);
    }

    function setLocalPreview(stream) {
      if (!localVideo) return;
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.srcObject = stream;
      localVideo.play().catch(() => {});
    }

    async function switchInputDevice(device) {
      if (!device || !navigator.mediaDevices?.getUserMedia) return;
      const isAudio = device.kind === "audioinput";
      if (!isAudio && audioOnly) {
        storedDevices.videoInputId = device.deviceId;
        saveDevicePreferences();
        setStatus("Camera saved for your next video call.");
        return;
      }
      const constraints = isAudio
        ? { audio: { deviceId: { exact: device.deviceId }, noiseSuppression, echoCancellation: true, autoGainControl: true }, video: false }
        : { audio: false, video: { deviceId: { exact: device.deviceId }, width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 24, max: 30 } } };
      let replacementStream;
      try { replacementStream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) { throw new Error(error?.name === "NotFoundError" ? "That device is no longer available." : error?.message || "Could not switch device."); }
      const replacement = isAudio ? replacementStream.getAudioTracks()[0] : replacementStream.getVideoTracks()[0];
      if (!replacement) { replacementStream.getTracks().forEach(track => track.stop()); throw new Error("The selected device did not provide a usable track."); }
      const old = isAudio ? localStream?.getAudioTracks()[0] : localStream?.getVideoTracks()[0];
      try {
        const sender = peerConnection?.getSenders().find(item => item.track?.kind === replacement.kind);
        if (sender && !(replacement.kind === "video" && screenTrack)) await sender.replaceTrack(replacement);
      } catch (error) { replacementStream.getTracks().forEach(track => track.stop()); throw error; }
      if (isAudio) {
        replacement.enabled = voiceMode === "ptt" ? pttHeld && !isMuted : !isMuted;
        if (old) localStream.removeTrack(old);
        localStream?.addTrack(replacement);
        storedDevices.audioInputId = device.deviceId;
        startLocalAudioAnalysis();
      } else {
        replacement.enabled = !cameraOff;
        if (old) localStream.removeTrack(old);
        localStream?.addTrack(replacement);
        storedDevices.videoInputId = device.deviceId;
        if (!screenTrack) setLocalPreview(localStream);
      }
      old?.stop();
      replacementStream.getTracks().filter(track => track !== replacement).forEach(track => track.stop());
      saveDevicePreferences();
      await refreshDevices();
    }

    async function startScreenShare() {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error("Screen sharing is not supported by this browser.");
      if (!peerConnection) throw new Error("Screen sharing is available after the call connects.");
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) { screenStream.getTracks().forEach(track => track.stop()); screenStream = null; throw new Error("The screen share did not provide a video track."); }
      const sender = peerConnection.getSenders().find(item => item.track?.kind === "video");
      if (!sender) { screenStream.getTracks().forEach(track => track.stop()); screenStream = null; screenTrack = null; throw new Error("This call has no video sender to replace."); }
      try { await sender.replaceTrack(screenTrack); }
      catch (error) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
        screenTrack = null;
        throw error;
      }
      setLocalPreview(new MediaStream([screenTrack]));
      localVideo?.classList.add("is-screen-share");
      $("peer-call-screen")?.classList.add("is-active");
      $("peer-call-screen")?.setAttribute("aria-pressed", "true");
      screenTrack.addEventListener("ended", stopScreenShare, { once: true });
      screenStream.getAudioTracks().forEach(track => track.stop());
    }

    async function stopScreenShare() {
      if (!screenTrack && !screenStream) return;
      const oldTrack = screenTrack;
      const oldStream = screenStream;
      screenTrack = null;
      screenStream = null;
      const cameraTrack = localStream?.getVideoTracks()[0] || null;
      try {
        const sender = peerConnection?.getSenders().find(item => item.track?.kind === "video");
        if (sender) await sender.replaceTrack(cameraTrack);
      } catch (error) { console.warn("Could not restore webcam after screen share:", error?.message || error); }
      oldTrack?.stop();
      oldStream?.getTracks().forEach(track => track.stop());
      if (cameraTrack) setLocalPreview(localStream);
      else if (localVideo) localVideo.srcObject = null;
      localVideo?.classList.remove("is-screen-share");
      $("peer-call-screen")?.classList.remove("is-active");
      $("peer-call-screen")?.setAttribute("aria-pressed", "false");
    }

    function startCallDeviceListeners() {
      callListeners?.abort();
      callListeners = new AbortController();
      navigator.mediaDevices?.addEventListener?.("devicechange", () => { void refreshDevices({ notifyNew: true }); }, { signal: callListeners.signal });
      window.addEventListener("keydown", handlePttKeyDown, { signal: callListeners.signal });
      window.addEventListener("keyup", handlePttKeyUp, { signal: callListeners.signal });
      window.addEventListener("blur", () => {
        clearTimeout(keyReleaseTimer);
        keyReleaseTimer = null;
        pttHeld = false;
        if (voiceMode === "ptt") updatePttEnabled(false);
        renderPttState();
      }, { signal: callListeners.signal });
      void refreshDevices();
    }

    function stopRemoteSpeakerDetection() {
      if (remoteSpeakerFrame) cancelAnimationFrame(remoteSpeakerFrame);
      remoteSpeakerFrame = 0;
      remoteSpeakerLastActiveAt = 0;
      try { remoteSpeakerSource?.disconnect(); } catch {}
      remoteSpeakerSource = null;
      remoteSpeakerAnalyser = null;
      remoteVideo?.classList.remove("is-speaking");
      if (remoteSpeakerContext && remoteSpeakerContext.state !== "closed") remoteSpeakerContext.close().catch(() => {});
      remoteSpeakerContext = null;
      modal?.classList.remove("remote-speaking");
    }

    function stopLocalAudioAnalysis() {
      if (localAudioFrame) cancelAnimationFrame(localAudioFrame);
      localAudioFrame = 0;
      try { localAudioSource?.disconnect(); } catch {}
      localAudioSource = null;
      localAudioAnalyser = null;
      if (localAudioContext && localAudioContext.state !== "closed") localAudioContext.close().catch(() => {});
      localAudioContext = null;
      localVideo?.classList.remove("is-speaking");
      $("peer-call-local-voice-avatar")?.classList.remove("is-speaking");
      modal?.classList.remove("local-speaking");
      const meter = $("peer-call-mic-meter");
      meter?.style.setProperty("--mic-level", "0%");
      meter?.setAttribute("aria-valuenow", "0");
    }

    function startLocalAudioAnalysis() {
      stopLocalAudioAnalysis();
      const track = localStream?.getAudioTracks().find(item => item.readyState === "live");
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!track || !AudioContextClass || !window.MediaStream) return;
      try {
        localAudioContext = new AudioContextClass();
        localAudioAnalyser = localAudioContext.createAnalyser();
        localAudioAnalyser.fftSize = 512;
        localAudioAnalyser.smoothingTimeConstant = 0.72;
        localAudioSource = localAudioContext.createMediaStreamSource(new MediaStream([track]));
        localAudioSource.connect(localAudioAnalyser);
        localAudioContext.resume().catch(() => {});
        const samples = new Float32Array(localAudioAnalyser.fftSize);
        const meter = $("peer-call-mic-meter");
        const detect = () => {
          if (!localAudioAnalyser) return;
          localAudioAnalyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          const rms = Math.sqrt(energy / samples.length);
          const level = Math.min(100, Math.round(rms * 260));
          meter?.style.setProperty("--mic-level", `${level}%`);
          meter?.setAttribute("aria-valuenow", String(level));
          const speaking = voiceMode === "open" && !isMuted && track.enabled && rms >= 0.035;
          localVideo?.classList.toggle("is-speaking", speaking);
          $("peer-call-local-voice-avatar")?.classList.toggle("is-speaking", voiceMode === "ptt" ? pttHeld && !isMuted : speaking);
          modal?.classList.toggle("local-speaking", voiceMode === "ptt" ? pttHeld && !isMuted : speaking);
          localAudioFrame = requestAnimationFrame(detect);
        };
        localAudioFrame = requestAnimationFrame(detect);
      } catch (error) { console.warn("Microphone level detection is unavailable:", error?.message || error); }
    }

    function startRemoteSpeakerDetection(stream) {
      if (remoteSpeakerFrame) cancelAnimationFrame(remoteSpeakerFrame);
      remoteSpeakerFrame = 0;
      try { remoteSpeakerSource?.disconnect(); } catch {}
      remoteSpeakerSource = null;
      remoteSpeakerAnalyser = null;
      remoteSpeakerLastActiveAt = 0;
      modal?.classList.remove("remote-speaking");
      remoteVideo?.classList.remove("is-speaking");
      const audioTracks = stream?.getAudioTracks?.().filter(track => track.readyState === "live") || [];
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioTracks.length || !AudioContextClass || !window.MediaStream) return;
      try {
        primeRemoteSpeakerContext();
        if (!remoteSpeakerContext || remoteSpeakerContext.state === "closed") return;
        remoteSpeakerAnalyser = remoteSpeakerContext.createAnalyser();
        remoteSpeakerAnalyser.fftSize = 512;
        remoteSpeakerAnalyser.smoothingTimeConstant = 0.65;
        remoteSpeakerSource = remoteSpeakerContext.createMediaStreamSource(new MediaStream(audioTracks));
        remoteSpeakerSource.connect(remoteSpeakerAnalyser);
        remoteSpeakerContext.resume().catch(() => {});
        const samples = new Float32Array(remoteSpeakerAnalyser.fftSize);
        const detect = () => {
          if (!remoteSpeakerAnalyser || !callId) return;
          remoteSpeakerAnalyser.getFloatTimeDomainData(samples);
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          const rms = Math.sqrt(energy / samples.length);
          const now = performance.now();
          if (rms >= 0.012) remoteSpeakerLastActiveAt = now;
          const speaking = now - remoteSpeakerLastActiveAt < 420;
          modal?.classList.toggle("remote-speaking", speaking);
          remoteVideo?.classList.toggle("is-speaking", speaking);
          remoteSpeakerFrame = requestAnimationFrame(detect);
        };
        remoteSpeakerFrame = requestAnimationFrame(detect);
      } catch (error) {
        console.warn("Remote speaker animation is unavailable:", error?.message || error);
        stopRemoteSpeakerDetection();
      }
    }

    function show({ incoming = false } = {}) {
      modal?.classList.remove("hidden");
      modal?.classList.toggle("audio-only", audioOnly);
      modal?.classList.toggle("is-incoming", incoming);
      incomingActions?.classList.toggle("hidden", !incoming);
      activeActions?.classList.toggle("hidden", incoming || !localStream);
      $("peer-call-local-voice-avatar")?.classList.toggle("hidden", !localStream);
      updateCallIdentity();
      updateControlStates();
      renderCallDuration();
    }

    function stopLocalMedia() {
      stopRemoteSpeakerDetection();
      stopLocalAudioAnalysis();
      callListeners?.abort();
      callListeners = null;
      clearTimeout(keyReleaseTimer);
      keyReleaseTimer = null;
      clearInterval(statsTimer);
      statsTimer = null;
      clearTimeout(deviceToastTimer);
      deviceToastTimer = null;
      clearTimeout(deviceStatusTimer);
      deviceStatusTimer = null;
      dismissDeviceToast();
      screenStream?.getTracks().forEach(track => track.stop());
      screenStream = null;
      screenTrack = null;
      $("peer-call-screen")?.classList.remove("is-active");
      $("peer-call-screen")?.setAttribute("aria-pressed", "false");
      if (localStream) localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      if (localVideo) localVideo.srcObject = null;
      localVideo?.classList.remove("is-screen-share", "is-speaking");
      $("peer-call-local-voice-avatar")?.classList.add("hidden");
      if (remoteVideo) remoteVideo.srcObject = null;
      if (remoteAudio) remoteAudio.srcObject = null;
      $("peer-call-enable-audio")?.classList.add("hidden");
      pttHeld = false;
      isRecordingKeybind = false;
      renderPttState();
    }

    function closePeerConnection() {
      if (!peerConnection) return;
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }

    function reset({ hide = true } = {}) {
      stopIncomingRingtone();
      clearTimeout(incomingTimer);
      clearTimeout(dismissTimer);
      clearTimeout(connectionTimer);
      incomingTimer = null;
      dismissTimer = null;
      connectionTimer = null;
      closePeerConnection();
      stopLocalMedia();
      pendingCandidates = [];
      callId = "";
      role = "";
      isMuted = false;
      cameraOff = false;
      audioOnly = false;
      callConnectedAt = 0;
      clearInterval(callClockTimer);
      callClockTimer = null;
      modal?.classList.remove("audio-only", "camera-off");
      modal?.classList.remove("is-incoming", "is-connected");
      modal?.classList.remove("is-minimized", "local-speaking", "remote-speaking");
      modal?.setAttribute("aria-modal", "true");
      isMinimized = false;
      resetMiniWindowPosition();
      $("peer-call-mini-controls")?.classList.add("hidden");
      closeSettingsPopover();
      updateConnectionQuality(null);
      updateControlStates();
      updateCallIdentity();
      renderCallDuration();
      if (incomingActions) incomingActions.classList.add("hidden");
      if (activeActions) activeActions.classList.add("hidden");
      if (hide) modal?.classList.add("hidden");
    }

    async function acquireMedia() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Video calls require a secure HTTPS connection and a supported browser.");
      }
      // `ideal` keeps the front camera preference from becoming a hard requirement
      // on mobile browsers that expose a different camera constraint set.
      const audio = {
        noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
        ...(storedDevices.audioInputId ? { deviceId: { exact: storedDevices.audioInputId } } : {})
      };
      const video = audioOnly ? false : {
        ...(storedDevices.videoInputId ? { deviceId: { exact: storedDevices.videoInputId } } : { facingMode: { ideal: "user" } }),
        width: { ideal: 640, max: 640 },
        height: { ideal: 480, max: 480 },
        frameRate: { ideal: 24, max: 30 }
      };
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio, video });
      } catch (error) {
        // Stored device IDs can become stale after unplugging or browser permission resets.
        if (error?.name !== "NotFoundError" && error?.name !== "OverconstrainedError") throw error;
        storedDevices.audioInputId = "";
        storedDevices.videoInputId = "";
        saveDevicePreferences();
        localStream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression, echoCancellation: true, autoGainControl: true }, video: audioOnly ? false : {
          facingMode: { ideal: "user" }, width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 24, max: 30 }
        } });
      }
      if (voiceMode === "ptt") localStream.getAudioTracks().forEach(track => { track.enabled = false; });
      else localStream.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
      if (cameraOff) localStream.getVideoTracks().forEach(track => { track.enabled = false; });
      setLocalPreview(localStream);
      startCallDeviceListeners();
      await refreshDevices();
      startLocalAudioAnalysis();
    }

    async function resolvedIceServers() {
      try {
        const servers = await getIceServers?.();
        if (Array.isArray(servers) && servers.some(server => server?.urls)) return [...servers, ...FALLBACK_ICE_SERVERS];
      } catch (error) {
        console.warn("Using fallback STUN servers:", error?.message || error);
      }
      return FALLBACK_ICE_SERVERS;
    }

    async function makePeerConnection() {
      if (peerConnection) return peerConnection;
      if (!window.RTCPeerConnection) throw new Error("This browser does not support WebRTC video calls.");
      peerConnection = new RTCPeerConnection({ iceServers: await resolvedIceServers() });
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
      startStatsPolling();
      peerConnection.onicecandidate = event => {
        if (event.candidate && transport && callId) {
          transport.send("ice", callId, event.candidate.toJSON());
        }
      };
      peerConnection.ontrack = event => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        if (event.track.kind === "video" && remoteVideo) {
          remoteVideo.muted = true;
          remoteVideo.playsInline = true;
          remoteVideo.srcObject = stream;
          remoteVideo.play().catch(() => {});
        }
        if (event.track.kind === "audio" && remoteAudio) {
          remoteAudio.playsInline = true;
          remoteAudio.srcObject = stream;
          if (storedDevices.audioOutputId) void applyOutputDevice(storedDevices.audioOutputId).catch(showCallDeviceError);
          startRemoteSpeakerDetection(stream);
          remoteAudio.play().then(() => $("peer-call-enable-audio")?.classList.add("hidden")).catch(() => {
            $("peer-call-enable-audio")?.classList.remove("hidden");
            setStatus("Tap Enable audio to hear the call.");
          });
        }
      };
      peerConnection.onconnectionstatechange = () => {
        if (disposed || !peerConnection) return;
        if (peerConnection.connectionState === "connected") { clearTimeout(connectionTimer); connectionTimer = null; startCallClock(); setStatus("Connected"); }
        if (peerConnection.connectionState === "disconnected") {
          setStatus("Connection interrupted. Trying to reconnect…");
          clearTimeout(connectionTimer);
          connectionTimer = setTimeout(() => {
            if (peerConnection?.connectionState === "disconnected") finish("Connection lost", false);
          }, 15000);
        }
        if (peerConnection.connectionState === "failed") {
          setStatus("Could not connect. This network may require a TURN relay.");
          dismissTimer = setTimeout(() => reset(), 2500);
        }
      };
      return peerConnection;
    }

    function updateConnectionQuality(latencySeconds) {
      const quality = $("peer-call-quality");
      const latency = $("peer-call-latency");
      if (!quality) return;
      const milliseconds = Number.isFinite(latencySeconds) ? Math.max(0, Math.round(latencySeconds * 1000)) : null;
      const level = milliseconds === null ? 0 : milliseconds < 120 ? 3 : milliseconds <= 300 ? 2 : 1;
      const tone = milliseconds === null ? "unknown" : milliseconds < 120 ? "good" : milliseconds <= 300 ? "medium" : "poor";
      quality.dataset.quality = tone;
      quality.title = milliseconds === null ? "Connection quality unavailable" : `Round-trip time: ${milliseconds} ms`;
      quality.setAttribute("aria-label", quality.title);
      if (latency) latency.textContent = milliseconds === null ? "— ms" : `${milliseconds} ms`;
      [...quality.querySelectorAll("i")].forEach((bar, index) => bar.classList.toggle("is-lit", index < level));
    }

    function startStatsPolling() {
      clearInterval(statsTimer);
      statsTimer = setInterval(async () => {
        const pc = peerConnection;
        if (!pc || pc.connectionState === "closed") return;
        try {
          const stats = await pc.getStats();
          let rtt = null;
          stats.forEach(report => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated && Number.isFinite(report.currentRoundTripTime)) rtt = report.currentRoundTripTime;
          });
          if (rtt === null) stats.forEach(report => {
            if (report.type === "candidate-pair" && report.state === "succeeded" && Number.isFinite(report.currentRoundTripTime)) rtt = report.currentRoundTripTime;
          });
          updateConnectionQuality(rtt);
        } catch (error) { console.debug("Call network stats unavailable:", error?.message || error); }
      }, 3000);
    }

    function setMinimized(minimized) {
      if (minimized && modal?.classList.contains("is-incoming")) return;
      isMinimized = Boolean(minimized);
      modal?.classList.toggle("is-minimized", isMinimized);
      modal?.setAttribute("aria-modal", String(!isMinimized));
      $("peer-call-mini-controls")?.classList.toggle("hidden", !isMinimized);
      if (!isMinimized) resetMiniWindowPosition();
    }

    function makeMiniWindowDraggable() {
      const card = modal?.querySelector(".peer-call-card");
      const handle = modal?.querySelector(".peer-call-topbar");
      if (!card || !handle) return;
      let drag = null;
      handle.addEventListener("pointerdown", event => {
        if (!isMinimized || event.target.closest("button")) return;
        const rect = card.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
        handle.setPointerCapture?.(event.pointerId);
      }, { signal: listenerController.signal });
      handle.addEventListener("pointermove", event => {
        if (!drag || drag.id !== event.pointerId) return;
        const left = Math.max(8, Math.min(window.innerWidth - card.offsetWidth - 8, event.clientX - drag.x));
        const top = Math.max(8, Math.min(window.innerHeight - card.offsetHeight - 8, event.clientY - drag.y));
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.right = "auto";
        card.style.bottom = "auto";
      }, { signal: listenerController.signal });
      const stopDrag = () => { drag = null; };
      handle.addEventListener("pointerup", stopDrag, { signal: listenerController.signal });
      handle.addEventListener("pointercancel", stopDrag, { signal: listenerController.signal });
    }

    function resetMiniWindowPosition() {
      const card = modal?.querySelector(".peer-call-card");
      if (!card) return;
      card.style.removeProperty("left");
      card.style.removeProperty("top");
      card.style.removeProperty("right");
      card.style.removeProperty("bottom");
    }

    async function flushCandidates() {
      if (!peerConnection?.remoteDescription) return;
      const candidates = pendingCandidates;
      pendingCandidates = [];
      for (const candidate of candidates) await peerConnection.addIceCandidate(candidate);
    }

    async function handleSignal(event) {
      if (disposed) return;
      if (event.type === "blocked") {
        reset();
        setStatus("This chat is unavailable because one participant blocked the other.");
        return;
      }
      if (event.type === "disconnect") {
        if (callId) { reset(); setStatus("Call ended because the connection was lost."); }
        return;
      }
      if (event.userId === window.sapcFirebase?.getCurrentUser()?.uid) return;
      if (event.type === "invite") {
        if (callId) {
          transport.send("decline", event.callId);
          return;
        }
        callId = event.callId;
        role = "callee";
        audioOnly = Boolean(event.data?.audioOnly);
        startIncomingRingtone();
        show({ incoming: true });
        setStatus(`${peerName || "Your friend"} is calling…`);
        incomingTimer = setTimeout(() => finish("missed", false), 45_000);
        return;
      }
      if (!callId || event.callId !== callId) return;
      if (event.type === "decline") { setStatus("Call declined"); dismissTimer = setTimeout(() => reset(), 1200); return; }
      if (event.type === "hangup") { setStatus("Call ended"); dismissTimer = setTimeout(() => reset(), 900); return; }
      if (event.type === "accept" && role === "caller") {
        try {
          const pc = await makePeerConnection();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          transport.send("offer", callId, pc.localDescription.toJSON());
          setStatus("Calling…");
        } catch (error) { fail(error); }
        return;
      }
      try {
        if (event.type === "offer" && role === "callee") {
          const pc = await makePeerConnection();
          await pc.setRemoteDescription(event.data);
          await flushCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          transport.send("answer", callId, pc.localDescription.toJSON());
          setStatus("Connecting…");
        } else if (event.type === "answer" && role === "caller") {
          await peerConnection.setRemoteDescription(event.data);
          await flushCandidates();
          setStatus("Connecting…");
        } else if (event.type === "ice") {
          const candidate = new RTCIceCandidate(event.data);
          if (!peerConnection?.remoteDescription) pendingCandidates.push(candidate);
          else await peerConnection.addIceCandidate(candidate);
        }
      } catch (error) { fail(error); }
    }

    function fail(error) {
      console.error("Video call error:", error);
      if (callId && transport) transport.send(role === "callee" ? "decline" : "hangup", callId);
      show();
      setStatus(error?.name === "NotAllowedError"
        ? "Camera or microphone permission was denied. Check your browser permissions."
        : error?.message || "The call could not be started.");
      incomingTimer = setTimeout(() => reset(), 3500);
    }

    function finish(message = "Call ended", notify = true) {
      const currentCallId = callId;
      if (notify && currentCallId && transport) transport.send("hangup", currentCallId);
      reset();
      if (message && status) status.textContent = message;
    }

    async function start(asAudioOnly = false) {
      if (disposed || callId || starting) return;
      if (!window.isSecureContext) return fail(new Error("Video calls require HTTPS."));
      if (!window.RTCPeerConnection) return fail(new Error("This browser does not support WebRTC video calls."));
      starting = true;
      primeRemoteSpeakerContext();
      stopIncomingRingtone();
      audioOnly = Boolean(asAudioOnly);
      try {
        await acquireMedia();
        if (disposed) return reset();
        role = "caller";
        callId = newCallId();
        if (voiceMode === "ptt") startLocalAudioAnalysis();
        show();
        setStatus("Ringing… Keep this chat open while calling.");
        transport.send("invite", callId, { audioOnly });
        incomingTimer = setTimeout(() => finish("No answer", true), 45_000);
      } catch (error) { if (!disposed) fail(error); }
      finally { starting = false; }
    }

    async function accept() {
      if (disposed || !callId || role !== "callee" || accepting) return;
      accepting = true;
      primeRemoteSpeakerContext();
      stopIncomingRingtone();
      clearTimeout(incomingTimer);
      incomingTimer = null;
      try {
        if (!window.isSecureContext) throw new Error("Video calls require HTTPS.");
        await acquireMedia();
        if (disposed || !callId) return reset();
        if (voiceMode === "ptt") startLocalAudioAnalysis();
        show();
        setStatus("Joining call…");
        transport.send("accept", callId);
      } catch (error) { if (!disposed) fail(error); }
      finally { accepting = false; }
    }

    function decline() {
      stopIncomingRingtone();
      if (callId) transport.send("decline", callId);
      reset();
    }

    const listenerOptions = { signal: listenerController.signal };
    $("peer-call-accept")?.addEventListener("click", accept, listenerOptions);
    $("peer-call-decline")?.addEventListener("click", decline, listenerOptions);
    $("peer-call-end")?.addEventListener("click", () => finish(), listenerOptions);
    $("peer-call-mute")?.addEventListener("click", event => {
      toggleMute();
    }, listenerOptions);
    $("peer-call-enable-audio")?.addEventListener("click", () => {
      remoteAudio?.play().then(() => $("peer-call-enable-audio")?.classList.add("hidden")).catch(() => setStatus("Audio playback is still blocked by this browser."));
    }, listenerOptions);
    $("peer-call-camera")?.addEventListener("click", event => {
      toggleCamera();
    }, listenerOptions);
    $("peer-call-mic-menu")?.addEventListener("click", () => openSettingsAt("peer-call-audio-input"), listenerOptions);
    $("peer-call-camera-menu")?.addEventListener("click", () => openSettingsAt("peer-call-video-input"), listenerOptions);
    $("peer-call-mini-mute")?.addEventListener("click", toggleMute, listenerOptions);
    $("peer-call-mini-camera")?.addEventListener("click", toggleCamera, listenerOptions);
    $("peer-call-expand")?.addEventListener("click", () => setMinimized(false), listenerOptions);
    $("peer-call-minimize")?.addEventListener("click", () => setMinimized(true), listenerOptions);
    $("peer-call-settings-button")?.addEventListener("click", () => {
      const popover = $("peer-call-settings-popover");
      const opening = popover?.classList.contains("hidden");
      popover?.classList.toggle("hidden", !opening);
      $("peer-call-settings-button")?.setAttribute("aria-expanded", String(Boolean(opening)));
      if (opening) void refreshDevices();
      if (opening) {
        localAudioContext?.resume().catch(() => {});
        remoteSpeakerContext?.resume().catch(() => {});
      }
    }, listenerOptions);
    document.addEventListener("pointerdown", event => {
      if (!event.target.closest("#peer-call-settings-popover, #peer-call-settings-button")) closeSettingsPopover();
    }, listenerOptions);
    $("peer-call-audio-input")?.addEventListener("change", async event => {
      const deviceId = event.currentTarget.value;
      try {
        const device = (await navigator.mediaDevices.enumerateDevices()).find(item => item.kind === "audioinput" && item.deviceId === deviceId);
        if (device) await switchInputDevice(device);
      }
      catch (error) { showCallDeviceError(error); }
    }, listenerOptions);
    $("peer-call-video-input")?.addEventListener("change", async event => {
      const deviceId = event.currentTarget.value;
      try {
        const device = (await navigator.mediaDevices.enumerateDevices()).find(item => item.kind === "videoinput" && item.deviceId === deviceId);
        if (device) await switchInputDevice(device);
      }
      catch (error) { showCallDeviceError(error); }
    }, listenerOptions);
    $("peer-call-audio-output")?.addEventListener("change", event => {
      void applyOutputDevice(event.currentTarget.value, { allowPermissionPrompt: true }).catch(showCallDeviceError);
    }, listenerOptions);
    $("peer-call-noise")?.addEventListener("change", async event => {
      noiseSuppression = Boolean(event.currentTarget.checked);
      saveDevicePreferences();
      const track = localStream?.getAudioTracks()[0];
      if (track?.applyConstraints) {
        try { await track.applyConstraints({ noiseSuppression, echoCancellation: true, autoGainControl: true }); }
        catch (error) { showCallDeviceError(new Error(`This browser could not change noise suppression: ${error.message || "unsupported constraint"}`)); }
      }
    }, listenerOptions);
    const noiseToggle = $("peer-call-noise");
    if (noiseToggle) noiseToggle.checked = noiseSuppression;
    $("peer-call-voice-mode")?.addEventListener("change", event => {
      voiceMode = event.currentTarget.value === "ptt" ? "ptt" : "open";
      pttHeld = false;
      savePttPreferences();
      if (voiceMode === "ptt") updatePttEnabled(false);
      else localStream?.getAudioTracks().forEach(track => { track.enabled = !isMuted; });
      renderPttState();
    }, listenerOptions);
    $("peer-call-keybind")?.addEventListener("click", () => {
      isRecordingKeybind = true;
      renderPttState();
      window.focus();
    }, listenerOptions);
    $("peer-call-screen")?.addEventListener("click", async () => {
      try {
        if (screenTrack) await stopScreenShare();
        else await startScreenShare();
      } catch (error) { showCallDeviceError(error); }
    }, listenerOptions);
    $("peer-call-device-switch")?.addEventListener("click", async () => {
      const device = pendingDeviceSwitch;
      dismissDeviceToast();
      try { await switchInputDevice(device); }
      catch (error) { showCallDeviceError(error); }
    }, listenerOptions);
    $("peer-call-device-dismiss")?.addEventListener("click", dismissDeviceToast, listenerOptions);
    makeMiniWindowDraggable();
    updateControlStates();
    window.addEventListener("pagehide", () => finish("Call ended"), listenerOptions);
    window.addEventListener("orientationchange", () => {
      requestAnimationFrame(() => {
        if (!modal?.classList.contains("hidden")) {
          modal.style.setProperty("--call-viewport-height", `${window.visualViewport?.height || window.innerHeight}px`);
        }
      });
    }, listenerOptions);
    return {
      start,
      handleSignal,
      isBusy: () => Boolean(callId),
      dispose() {
        if (disposed) return;
        disposed = true;
        listenerController.abort();
        if (callId && transport) transport.send("hangup", callId);
        signaling.unsubscribe?.();
        reset();
      }
    };
  }

  window.SapcPeerCall = {
    createPeerCall,
    startIncomingRingtone,
    stopIncomingRingtone,
    getIncomingRingtone,
    setIncomingRingtone,
    previewIncomingRingtone,
    storeCustomRingtone,
    getCustomRingtoneInfo,
    removeCustomRingtone,
    previewCustomRingtoneFile
  };
})();
