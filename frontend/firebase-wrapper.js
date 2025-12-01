/* firebase-wrapper.js - Fixed & Clean
   - Syncs Firebase <-> localStorage
   - Always dispatches "cloud-sync-ready"
   - Ensures __firestoreDataLoaded = true in ALL cases
*/

console.log("firebase-wrapper.js loaded");

// Signal for script.js
window.__firestoreDataLoaded = false;

// --------------------- HELPERS -----------------------

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
    }, 10000); // 10 sec safety
  });
}

function ensureStorageFallback() {
  if (!window.storage) {
    window.storage = {
      get: (k, def = null) => {
        try { return JSON.parse(localStorage.getItem(k)) || def; }
        catch { return def; }
      },
      set: (k, v) => {
        try { localStorage.setItem(k, JSON.stringify(v)); }
        catch(e) {}
      }
    };
  }
}

// normalize todo object
function normalizeTodoObject(item) {
  const baseId = Date.now().toString() + Math.random().toString(36).slice(2, 7);
  const id = item?.id ? String(item.id) : baseId;

  return {
    id,
    text: item?.text || item?.name || "",
    completed: !!item?.completed,
    createdAt: item?.createdAt || new Date().toISOString(),
    completedAt: item?.completedAt || (item?.completed ? new Date().toISOString() : null)
  };
}

// normalize raw firestore document
function normalizeRemoteData(raw) {
  const pick = (k, def) => (raw?.hasOwnProperty(k) ? raw[k] : def);

  return {
    todos: Array.isArray(pick("todos", []))
      ? pick("todos", []).map(t => normalizeTodoObject(t))
      : [],

    routine: Array.isArray(pick("routine", []))
      ? pick("routine", [])
      : [],

    timeSessions: Array.isArray(pick("timeSessions", []))
      ? pick("timeSessions", [])
      : [],

    timerState: pick("timerState", {
      seconds: 0, isRunning: false, isBreak: false, currentTask: "", startTime: null
    }),

    currentStatsPeriod: pick("currentStatsPeriod", "today"),
    theme: pick("theme", "light"),
    username: pick("username", "User"),
    email: pick("email", null),
    uid: pick("uid", null),
    isLoggedIn: !!pick("isLoggedIn", false)
  };
}

function applyNormalizedToLocalStorage(norm) {
  Object.keys(norm).forEach(k => {
    try { localStorage.setItem(k, JSON.stringify(norm[k])); }
    catch(e) {}
  });
}

function gatherLocalForMigration() {
  const keys = [
    "todos","routine","timeSessions","timerState",
    "currentStatsPeriod","theme","username","email","uid","isLoggedIn"
  ];

  const out = {};
  keys.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) {
      try { out[k] = JSON.parse(v); } catch(e) {}
    }
  });
  return out;
}

// --------------- WRAP STORAGE FOR LIVE SYNC ------------------

function wrapStorageWithDocRef(docRef) {
  ensureStorageFallback();

  const originalSet = storage.set;
  const originalGet = storage.get;

  storage.set = function(key, value) {

    // save locally
    try {
      if (originalSet) originalSet.call(storage, key, value);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch(e) { console.warn(e); }

    // special normalize for todos
    if (key === "todos" && Array.isArray(value)) {
      value = value.map(t => normalizeTodoObject(t));
    }

    // sync to cloud
    if (docRef) {
      const updateObj = {};
      updateObj[key] = value;

      docRef.set(updateObj, { merge: true }).catch(err =>
        console.error("Firestore sync error:", key, err)
      );
    }
  };

  storage.get = function(key, def = null) {
    try {
      return originalGet
        ? originalGet.call(storage, key, def)
        : (JSON.parse(localStorage.getItem(key)) || def);
    } catch(e) { return def; }
  };

  console.log("firebase-wrapper: storage wrapped");
}

// --------------------- MAIN ---------------------------

(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  ensureStorageFallback();

  auth.onAuthStateChanged(async (user) => {

    // ------------------ SIGNED OUT ------------------
    if (!user) {
      console.log("firebase-wrapper: signed out");
      window.__firestoreDataLoaded = true;

      // notify script.js
      document.dispatchEvent(new Event("cloud-sync-ready"));
      return;
    }

    // ----------------- SIGNED IN -------------------
    const uid = user.uid;
    const docRef = db.collection("users").doc(uid);

    try {
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : {};

      // check if remote has meaningful data
      const remoteHasData = snap.exists &&
        Object.keys(remote).some(k => {
          const v = remote[k];
          if (v === null || v === undefined) return false;
          if (Array.isArray(v)) return v.length > 0;
          if (typeof v === "object") return Object.keys(v).length > 0;
          return true;
        });

      if (remoteHasData) {
        const normalized = normalizeRemoteData(remote);
        applyNormalizedToLocalStorage(normalized);
        console.log("firebase-wrapper: remote -> localStorage done");
      } else {
        // migrate local -> cloud
        const local = gatherLocalForMigration();
        const norm = normalizeRemoteData(local);

        const writeObj = {};
        Object.keys(norm).forEach(k => {
          const v = norm[k];
          if (Array.isArray(v) && v.length === 0) return;
          if (v === null || v === undefined) return;
          writeObj[k] = v;
        });

        if (Object.keys(writeObj).length > 0) {
          await docRef.set(writeObj, { merge: true });
          console.log("firebase-wrapper: migrated local -> cloud");
        }
      }

      // mark loaded BEFORE wrapping
      window.__firestoreDataLoaded = true;

      // wrap storage for sync
      wrapStorageWithDocRef(docRef);

      // notify UI
      document.dispatchEvent(new Event("cloud-sync-ready"));

    } catch (err) {
      console.error("firebase-wrapper ERROR:", err);

      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(null);

      // notify UI even if failed
      document.dispatchEvent(new Event("cloud-sync-ready"));
    }
  });

  console.log("firebase-wrapper: initialized");
})();

