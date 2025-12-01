// ------------------------------------------------------------
// FINAL — firebase-wrapper.js
// FIXED LOADING SCREEN + FIXED CLOUD SYNC + FIXED EVENTS
// ------------------------------------------------------------

console.log("firebase-wrapper.js loaded");

window.__firestoreDataLoaded = false;

// Wait for firebase-init.js
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();

    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);

    setTimeout(() => {
      clearInterval(t);
      resolve();
    }, 10000);
  });
}

// Local fallback storage
function ensureStorageFallback() {
  if (!window.storage) {
    window.storage = {
      get: (k, def = null) => {
        try { return JSON.parse(localStorage.getItem(k)) || def; }
        catch { return def; }
      },
      set: (k, v) => {
        try { localStorage.setItem(k, JSON.stringify(v)); }
        catch(e) { console.warn(e); }
      }
    };
  }
}

// Normalize a todo object
function normalizeTodoObject(item) {
  const baseId = Date.now().toString() + Math.random().toString(36).slice(2,7);

  return {
    id: item?.id ? String(item.id) : baseId,
    text: item?.text || item?.title || item?.name || "",
    completed: !!item?.completed,
    createdAt: item?.createdAt || item?.created_at || new Date().toISOString(),
    completedAt: item?.completedAt || item?.completed_at || (item?.completed ? new Date().toISOString() : null)
  };
}

// Normalize remote → local format
function normalizeRemoteData(raw) {
  const pick = (k, def) => (raw && raw.hasOwnProperty(k) ? raw[k] : def);
  const out = {};

  // TODOS
  const rawTodos = pick("todos", []);
  out.todos = Array.isArray(rawTodos)
    ? rawTodos.map(t => (typeof t === "object" ? normalizeTodoObject(t) : normalizeTodoObject({ text: String(t) })))
    : [];

  // ROUTINE
  out.routine = Array.isArray(pick("routine", []))
    ? pick("routine", []).map(r => ({
        id: r?.id ? String(r.id) : Date.now().toString(),
        time: r?.time || r?.t || "",
        activity: r?.activity || r?.name || ""
      }))
    : [];

  // TIME SESSIONS
  out.timeSessions = Array.isArray(pick("timeSessions", []))
    ? pick("timeSessions", []).map(s => ({
        date: s?.date || new Date().toISOString(),
        duration: Number(s?.duration) || 0,
        type: s?.type || "study",
        task: s?.task || s?.subject || null
      }))
    : [];

  // TIMER
  const rawTimer = pick("timerState", null);
  out.timerState = rawTimer && typeof rawTimer === "object"
    ? {
        seconds: Number(rawTimer.seconds) || 0,
        isRunning: !!rawTimer.isRunning,
        isBreak: !!rawTimer.isBreak,
        currentTask: rawTimer.currentTask || "",
        startTime: rawTimer.startTime || null
      }
    : { seconds: 0, isRunning: false, isBreak: false, currentTask: "", startTime: null };

  // MISC
  out.currentStatsPeriod = pick("currentStatsPeriod", "today");
  out.theme = pick("theme", "light");
  out.username = pick("username", "User");
  out.email = pick("email", null);
  out.uid = pick("uid", null);
  out.isLoggedIn = !!pick("isLoggedIn", false);

  return out;
}

// Write normalized data → localStorage
function applyNormalizedToLocalStorage(norm) {
  const keys = [
    "todos", "routine", "timeSessions", "timerState",
    "currentStatsPeriod", "theme", "username",
    "email", "uid", "isLoggedIn"
  ];

  keys.forEach(k => {
    if (norm.hasOwnProperty(k)) {
      try {
        localStorage.setItem(k, JSON.stringify(norm[k]));
      } catch (e) {
        console.warn("write error:", k, e);
      }
    }
  });
}

// Collect local → send to cloud if needed
function gatherLocalForMigration() {
  const keys = [
    "todos","routine","timeSessions","timerState",
    "currentStatsPeriod","theme","username","email","uid","isLoggedIn"
  ];

  const out = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = JSON.parse(v);
    } catch {}
  });
  return out;
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------

(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  ensureStorageFallback();

  // Wrap storage to sync → cloud
  function wrapStorageWithDocRef(docRef) {
    ensureStorageFallback();
    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function (key, value) {
      try {
        if (originalSet) originalSet.call(storage, key, value);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch {}

      if (key === "todos" && Array.isArray(value)) {
        value = value.map(t => normalizeTodoObject(t));
      }

      if (docRef) {
        const updateObj = {};
        updateObj[key] = value;
        docRef.set(updateObj, { merge: true }).catch(err => console.error("Sync error:", err));
      }
    };

    storage.get = function (key, def = null) {
      try {
        return originalGet
          ? originalGet.call(storage, key, def)
          : JSON.parse(localStorage.getItem(key)) || def;
      } catch {
        return def;
      }
    };

    console.log("firebase-wrapper: storage wrapped");
  }

  // AUTH WATCH
  auth.onAuthStateChanged(async (user) => {
    // ---------------------------------------------
    // USER LOGGED OUT
    // ---------------------------------------------
    if (!user) {
      console.log("firebase-wrapper: signed out");

      window.__firestoreDataLoaded = true;
      document.dispatchEvent(new Event("cloud-sync-ready"));

      return;
    }

    // ---------------------------------------------
    // USER LOGGED IN
    // ---------------------------------------------
    const uid = user.uid;
    const docRef = db.collection("users").doc(uid);

    try {
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : {};

      const hasRemoteData =
        snap.exists &&
        Object.keys(remote).some(k => {
          const v = remote[k];
          if (v == null) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        });

      if (hasRemoteData) {
        const normalized = normalizeRemoteData(remote);
        applyNormalizedToLocalStorage(normalized);
      } else {
        const localPayload = gatherLocalForMigration();
        const normalizedLocal = normalizeRemoteData(localPayload);

        const writeObj = {};
        Object.keys(normalizedLocal).forEach(k => {
          const v = normalizedLocal[k];
          if (Array.isArray(v) && v.length === 0) return;
          if (v == null) return;
          writeObj[k] = v;
        });

        if (Object.keys(writeObj).length > 0) {
          await docRef.set(writeObj, { merge: true });
        } else {
          await docRef.set(
            { createdAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      }

      // ---------------------------------------------
      // FIX #1 & FIX #2 & FIX #3 (ALL THREE PLACES)
      // ---------------------------------------------
      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(docRef);
      document.dispatchEvent(new Event("cloud-sync-ready"));
      console.log("🔥 Cloud sync complete");

    } catch (err) {
      console.error("firebase-wrapper: error", err);

      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(null);
      document.dispatchEvent(new Event("cloud-sync-ready"));
    }
  });

  console.log("firebase-wrapper: initialized");
})();
