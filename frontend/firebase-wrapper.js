// ------------------------------------------------------------
// firebase-wrapper.js  (FINAL FIXED VERSION)
// Syncs Firestore <-> localStorage and signals script.js when ready
// ------------------------------------------------------------

console.log("firebase-wrapper.js loaded");

// Global flag script.js waits for
window.__firestoreDataLoaded = false;

// Wait until firebase-init.js is done
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();

    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);

    // Safety timeout
    setTimeout(() => {
      clearInterval(t);
      resolve();
    }, 10000);
  });
}

// Ensure storage fallback (in case script.js runs early)
function ensureStorageFallback() {
  if (!window.storage) {
    window.storage = {
      get: (k, def = null) => {
        try {
          const v = localStorage.getItem(k);
          return v ? JSON.parse(v) : def;
        } catch {
          return def;
        }
      },
      set: (k, v) => {
        try { localStorage.setItem(k, JSON.stringify(v)); }
        catch(e) { console.warn(e); }
      }
    };
  }
}

// Normalizes a todo item
function normalizeTodoObject(item) {
  const baseId = Date.now().toString() + Math.random().toString(36).slice(2,7);
  const id = item?.id ? String(item.id) : baseId;

  const text = item?.text || item?.title || item?.name || "";

  const completed = !!item?.completed;
  const createdAt = item?.createdAt || item?.created_at || new Date().toISOString();

  let completedAt = item?.completedAt || item?.completed_at || null;
  if (completed && !completedAt) {
    completedAt = new Date().toISOString();
  }

  return { id, text, completed, createdAt, completedAt };
}

// Normalize Firestore remote object → localStorage shape
function normalizeRemoteData(raw) {
  const pick = (k, def) => (raw && raw.hasOwnProperty(k) ? raw[k] : def);
  const normalized = {};

  // TODOS
  const rawTodos = pick("todos", []);
  if (Array.isArray(rawTodos)) {
    normalized.todos = rawTodos.map(item => {
      if (typeof item === "object") return normalizeTodoObject(item);
      return normalizeTodoObject({ text: String(item), completed: false });
    });
  } else normalized.todos = [];

  // ROUTINE
  const rawRoutine = pick("routine", []);
  if (Array.isArray(rawRoutine)) {
    normalized.routine = rawRoutine.map(r => ({
      id: r?.id ? String(r.id) : Date.now().toString() + Math.random().toString(36).slice(2,7),
      time: r?.time || r?.t || "",
      activity: r?.activity || r?.name || ""
    }));
  } else normalized.routine = [];

  // TIME SESSIONS
  const rawSessions = pick("timeSessions", []);
  if (Array.isArray(rawSessions)) {
    normalized.timeSessions = rawSessions.map(s => ({
      date: s?.date || s?.createdAt || new Date().toISOString(),
      duration: Number(s?.duration) || 0,
      type: s?.type || "study",
      task: s?.task || s?.subject || null
    }));
  } else normalized.timeSessions = [];

  // TIMER STATE
  const rawTimer = pick("timerState", null);
  normalized.timerState = rawTimer && typeof rawTimer === "object"
    ? {
        seconds: Number(rawTimer.seconds) || 0,
        isRunning: !!rawTimer.isRunning,
        isBreak: !!rawTimer.isBreak,
        currentTask: rawTimer.currentTask || "",
        startTime: rawTimer.startTime || null
      }
    : { seconds: 0, isRunning: false, isBreak: false, currentTask: "", startTime: null };

  // OTHER KEYS
  normalized.currentStatsPeriod = pick("currentStatsPeriod", "today");
  normalized.theme = pick("theme", "light");
  normalized.username = pick("username", "User");
  normalized.email = pick("email", null);
  normalized.uid = pick("uid", null);
  normalized.isLoggedIn = !!pick("isLoggedIn", false);

  return normalized;
}

// Apply normalized data to localStorage
function applyNormalizedToLocalStorage(norm) {
  const keys = [
    "todos","routine","timeSessions","timerState",
    "currentStatsPeriod","theme","username","email","uid","isLoggedIn"
  ];

  keys.forEach(k => {
    try {
      if (norm.hasOwnProperty(k)) {
        localStorage.setItem(k, JSON.stringify(norm[k]));
      }
    } catch(e) {
      console.warn("applyNormalized failed:", k, e);
    }
  });
}

// Gather local data for migration
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

// ------------------------------------------------------
//  MAIN WRAPPER LOGIC
// ------------------------------------------------------
(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  ensureStorageFallback();

  function wrapStorageWithDocRef(docRef) {
    ensureStorageFallback();

    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function(key, value) {
      try {
        if (originalSet) originalSet.call(storage, key, value);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch(e) {}

      // Normalize todos before syncing
      if (key === "todos" && Array.isArray(value)) {
        value = value.map(t => normalizeTodoObject(t));
      }

      if (docRef) {
        const updateObj = {};
        updateObj[key] = value;

        docRef.set(updateObj, { merge: true }).catch(err =>
          console.error("sync error key:", key, err)
        );
      }
    };

    storage.get = function(key, def = null) {
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

  // ------------------------------------------------------
  // AUTH LISTENER
  // ------------------------------------------------------
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: signed out");

      // Allow page to continue
      window.__firestoreDataLoaded = true;

      // Send event to script.js
      document.dispatchEvent(new Event("cloud-sync-ready"));
      return;
    }

    const uid = user.uid;
    const docRef = db.collection("users").doc(uid);

    try {
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : {};

      const remoteHasData = snap.exists && Object.keys(remote).some(k => {
        const v = remote[k];
        if (v == null) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === "object") return Object.keys(v).length > 0;
        return true;
      });

      if (remoteHasData) {
        const normalized = normalizeRemoteData(remote);
        applyNormalizedToLocalStorage(normalized);
      } else {
        const localPayload = gatherLocalForMigration();
        const normalizedLocal = normalizeRemoteData(localPayload);

        const filteredWrite = {};
        Object.keys(normalizedLocal).forEach(k => {
          const v = normalizedLocal[k];
          if (v == null) return;
          if (Array.isArray(v) && v.length === 0) return;
          filteredWrite[k] = v;
        });

        if (Object.keys(filteredWrite).length > 0) {
          await docRef.set(filteredWrite, { merge: true });
        } else {
          await docRef.set(
            { createdAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      }

      // Mark ready & install wrapper
      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(docRef);

      // Notify UI
      document.dispatchEvent(new Event("cloud-sync-ready"));

    } catch (err) {
      console.error("firebase-wrapper: load/migrate error", err);

      // Still allow app to continue
      window.__firestoreDataLoaded = true;

      // Wrap with null (local only)
      wrapStorageWithDocRef(null);

      // Notify UI in error case too
      document.dispatchEvent(new Event("cloud-sync-ready"));
    }
  });

  console.log("firebase-wrapper: initialized");
})();
