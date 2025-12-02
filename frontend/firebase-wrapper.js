
console.log("firebase-wrapper.js loaded");

// Flag that script.js waits for
window.__firestoreDataLoaded = false;

// Wait until firebase-init.js finishes
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

// Create storage fallback
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
        try {
          localStorage.setItem(k, JSON.stringify(v));
        } catch (e) {
          console.warn(e);
        }
      }
    };
  }
}

// Normalize todos
function normalizeTodoObject(item) {
  const id = item?.id || (Date.now().toString() + Math.random().toString(36).slice(2, 7));
  const text = item?.text || item?.title || "";
  const createdAt = item?.createdAt || new Date().toISOString();

  let completedAt = item?.completedAt || null;
  if (item?.completed && !completedAt) {
    completedAt = new Date().toISOString();
  }

  return {
    id: String(id),
    text,
    completed: !!item?.completed,
    createdAt,
    completedAt
  };
}

// Normalize remote Firestore data
function normalizeRemoteData(raw) {
  const pick = (k, def) => (raw && raw.hasOwnProperty(k) ? raw[k] : def);
  const out = {};

  // TODOS
  const rawTodos = pick("todos", []);
  out.todos = Array.isArray(rawTodos)
    ? rawTodos.map(t => typeof t === "object" ? normalizeTodoObject(t) : normalizeTodoObject({ text: String(t) }))
    : [];

  // ROUTINE
  out.routine = Array.isArray(pick("routine", []))
    ? pick("routine", []).map(r => ({
        id: r.id || Date.now().toString(),
        time: r.time || "",
        activity: r.activity || ""
      }))
    : [];

  // SESSIONS
  out.timeSessions = Array.isArray(pick("timeSessions", []))
    ? pick("timeSessions", []).map(s => ({
        date: s.date || new Date().toISOString(),
        duration: Number(s.duration) || 0,
        type: s.type || "study",
        task: s.task || null
      }))
    : [];

  // TIMER
  const rawTimer = pick("timerState", null);
  out.timerState = rawTimer
    ? {
        seconds: Number(rawTimer.seconds) || 0,
        isRunning: !!rawTimer.isRunning,
        isBreak: !!rawTimer.isBreak,
        currentTask: rawTimer.currentTask || "",
        startTime: rawTimer.startTime || null
      }
    : { seconds: 0, isRunning: false, isBreak: false, currentTask: "", startTime: null };

  // OTHER
  out.currentStatsPeriod = pick("currentStatsPeriod", "today");
  out.theme = pick("theme", "light");
  out.username = pick("username", "User");
  out.email = pick("email", null);
  out.uid = pick("uid", null);
  out.isLoggedIn = !!pick("isLoggedIn", false);

  return out;
}

// Apply data to localStorage
function applyToLocal(norm) {
  Object.entries(norm).forEach(([key, value]) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("local write fail:", key, e);
    }
  });
}

// Gather local for migration
function gatherLocalForMigration() {
  const keys = [
    "todos", "routine", "timeSessions", "timerState",
    "currentStatsPeriod", "theme", "username",
    "email", "uid", "isLoggedIn"
  ];
  const out = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v != null) out[k] = JSON.parse(v);
    } catch {}
  });
  return out;
}

// ------------------------------------------------------
// MAIN WRAPPER LOGIC
// ------------------------------------------------------
(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready");

  ensureStorageFallback();

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Patch storage to sync to Firestore
  function wrapStorageWithFirestore(docRef) {
    const originalSet = storage.set;

    storage.set = (key, value) => {
      try {
        originalSet(key, value);
      } catch {}

      // Sync todos normalized
      if (key === "todos" && Array.isArray(value)) {
        value = value.map(t => normalizeTodoObject(t));
      }

      if (docRef) {
        const updateObj = {};
        updateObj[key] = value;
        docRef.set(updateObj, { merge: true }).catch(err =>
          console.error("❌ Firestore sync error:", err)
        );
      }
    };
  }

  // --------------------------
  // AUTH STATE LISTENER
  // --------------------------
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: user logged out");

      window.__firestoreDataLoaded = true;
      document.dispatchEvent(new Event("cloud-sync-ready"));
      return;
    }

    const uid = user.uid;
    const docRef = db.collection("users").doc(uid);

    try {
      const snap = await docRef.get();
      const remoteData = snap.exists ? snap.data() : {};

      const remoteHasData =
        snap.exists &&
        Object.values(remoteData).some(v =>
          Array.isArray(v) ? v.length > 0 :
          typeof v === "object" ? Object.keys(v).length > 0 :
          !!v
        );

      if (remoteHasData) {
        // Load cloud → local
        const normalized = normalizeRemoteData(remoteData);
        applyToLocal(normalized);
      } else {
        // Push local → cloud
        const localData = gatherLocalForMigration();
        const normalizedLocal = normalizeRemoteData(localData);

        const toWrite = {};
        Object.entries(normalizedLocal).forEach(([k, v]) => {
          if (Array.isArray(v) && v.length === 0) return;
          if (v == null) return;
          toWrite[k] = v;
        });

        await docRef.set(
          Object.keys(toWrite).length ? toWrite : { createdAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
      }

      // After loading + applying → wrap localStorage
      wrapStorageWithFirestore(docRef);

      window.__firestoreDataLoaded = true;
      document.dispatchEvent(new Event("cloud-sync-ready"));
      console.log("firebase-wrapper: SYNC READY");

    } catch (err) {
      console.error("firebase-wrapper ERROR:", err);

      wrapStorageWithFirestore(null);
      window.__firestoreDataLoaded = true;
      document.dispatchEvent(new Event("cloud-sync-ready"));
    }
  });

  console.log("firebase-wrapper: initialized");
})();
