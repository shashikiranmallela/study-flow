// firebase-wrapper.js (final)
// Sync Firestore <-> localStorage and reliably signal the app when cloud data is ready.

console.log("firebase-wrapper.js loaded");

// Global flag script.js waits for
window.__firestoreDataLoaded = false;

// Wait until firebase-init.js sets window.firebaseReady
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();

    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);

    // Safety timeout (so UI doesn't hang forever)
    setTimeout(() => {
      clearInterval(t);
      resolve();
    }, 10000);
  });
}

// Ensure a fallback storage so wrapper never crashes if script.js hasn't defined storage yet
function ensureStorageFallback() {
  if (!window.storage) {
    console.warn("firebase-wrapper: creating fallback storage object");
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
        catch (e) { console.warn("fallback storage.set failed", e); }
      }
    };
  }
}

// Normalize a todo item so we always write consistent shapes to Firestore
function normalizeTodoObject(item) {
  const baseId = Date.now().toString() + Math.random().toString(36).slice(2,7);
  const id = item && item.id ? String(item.id) : baseId;
  const text = (item && (item.text || item.title || item.name)) ? (item.text || item.title || item.name) : "";
  const completed = !!(item && item.completed);
  const createdAt = (item && (item.createdAt || item.created_at)) ? (item.createdAt || item.created_at) : new Date().toISOString();
  let completedAt = null;
  if (item && (item.completedAt || item.completed_at)) {
    completedAt = item.completedAt || item.completed_at;
  } else if (completed) {
    completedAt = new Date().toISOString();
  }
  return { id, text, completed, createdAt, completedAt };
}

// Normalize remote Firestore document into the exact keys script.js expects
function normalizeRemoteData(raw) {
  const pick = (k, def) => (raw && raw.hasOwnProperty(k) ? raw[k] : def);
  const normalized = {};

  // TODOS
  const rawTodos = pick('todos', []);
  if (Array.isArray(rawTodos)) {
    normalized.todos = rawTodos.map(item => {
      if (item && typeof item === 'object') return normalizeTodoObject(item);
      return normalizeTodoObject({ text: String(item), completed: false });
    });
  } else normalized.todos = [];

  // ROUTINE
  const rawRoutine = pick('routine', []);
  if (Array.isArray(rawRoutine)) {
    normalized.routine = rawRoutine.map(r => {
      if (r && typeof r === 'object') {
        return {
          id: r.id ? String(r.id) : Date.now().toString() + Math.random().toString(36).slice(2,7),
          time: r.time || r.t || '',
          activity: r.activity || r.name || ''
        };
      } else {
        return { id: Date.now().toString(), time: '00:00', activity: String(r) || 'Activity' };
      }
    });
  } else normalized.routine = [];

  // TIME SESSIONS
  const rawSessions = pick('timeSessions', []);
  if (Array.isArray(rawSessions)) {
    normalized.timeSessions = rawSessions.map(s => {
      if (s && typeof s === 'object') {
        return {
          date: s.date || s.createdAt || new Date().toISOString(),
          duration: Number(s.duration) || 0,
          type: s.type || 'study',
          task: s.task || s.subject || null
        };
      } else {
        return { date: new Date().toISOString(), duration: 0, type: 'study', task: null };
      }
    });
  } else normalized.timeSessions = [];

  // TIMER STATE
  const rawTimer = pick('timerState', null);
  normalized.timerState = (rawTimer && typeof rawTimer === 'object') ? {
    seconds: Number(rawTimer.seconds) || 0,
    isRunning: !!rawTimer.isRunning,
    isBreak: !!rawTimer.isBreak,
    currentTask: rawTimer.currentTask || '',
    startTime: rawTimer.startTime || null
  } : { seconds: 0, isRunning: false, isBreak: false, currentTask: '', startTime: null };

  // OTHER SIMPLE KEYS
  normalized.currentStatsPeriod = pick('currentStatsPeriod', 'today');
  normalized.theme = pick('theme', 'light');
  normalized.username = pick('username', 'User');
  normalized.email = pick('email', null);
  normalized.uid = pick('uid', null);
  normalized.isLoggedIn = !!pick('isLoggedIn', false);

  return normalized;
}

// Write normalized object to exact localStorage keys script.js expects
function applyNormalizedToLocalStorage(norm) {
  const keys = ['todos','routine','timeSessions','timerState','currentStatsPeriod','theme','username','email','uid','isLoggedIn'];
  keys.forEach(k => {
    try {
      if (norm.hasOwnProperty(k)) {
        localStorage.setItem(k, JSON.stringify(norm[k]));
      }
    } catch (e) {
      console.warn('applyNormalizedToLocalStorage failed for', k, e);
    }
  });
}

// Read localStorage keys to prepare migration payload
function gatherLocalForMigration() {
  const keys = ['todos','routine','timeSessions','timerState','currentStatsPeriod','theme','username','email','uid','isLoggedIn'];
  const payload = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) payload[k] = JSON.parse(v);
    } catch (e) {
      // ignore invalid JSON
    }
  });
  return payload;
}

// MAIN: wait for firebase-init, then sync / wrap storage
(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready (or timeout)");

  // defensive checks
  if (!window.firebase || !firebase.auth || !firebase.firestore) {
    console.warn("firebase-wrapper: firebase sdk not available - using localStorage only");
    ensureStorageFallback();
    // mark loaded so UI can proceed
    window.__firestoreDataLoaded = true;
    document.dispatchEvent(new Event("cloud-sync-ready"));
    return;
  }

  const auth = firebase.auth();
  const db = firebase.firestore();

  ensureStorageFallback();

  // Wrap storage to sync all writes to the user's Firestore doc (merge)
  function wrapStorageWithDocRef(docRef) {
    ensureStorageFallback();
    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function(key, value) {
      // keep local behavior
      try {
        if (originalSet) originalSet.call(storage, key, value);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn("firebase-wrapper: storage.set original error", e);
      }

      // normalize todos before sending to Firestore
      if (key === 'todos' && Array.isArray(value)) {
        value = value.map(t => normalizeTodoObject(t));
      }

      // Send update to Firestore (merge)
      if (docRef) {
        try {
          const updateObj = {};
          updateObj[key] = value;
          docRef.set(updateObj, { merge: true }).catch(err => {
            console.error('firebase-wrapper: failed to sync key', key, err);
          });
        } catch (e) {
          console.error('firebase-wrapper: sync error', e);
        }
      }
    };

    // preserve get semantics
    storage.get = function(key, defaultValue = null) {
      try {
        if (originalGet) return originalGet.call(storage, key, defaultValue);
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    };

    console.log('firebase-wrapper: storage wrapped for sync');
  }

  // Auth state listener: load or migrate data for signed-in users
  auth.onAuthStateChanged(async (user) => {
    // If no user signed in: mark ready so UI won't wait
    if (!user) {
      console.log('firebase-wrapper: signed out');
      window.__firestoreDataLoaded = true;
      // wrap with null to preserve local-only behavior (so storage.set continues to work)
      wrapStorageWithDocRef(null);
      // MUST dispatch the event — script.js listens for this
      document.dispatchEvent(new Event("cloud-sync-ready"));
      return;
    }

    const uid = user.uid;
    const docRef = db.collection('users').doc(uid);

    try {
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : {};

      // Determine if remote doc has any meaningful data
      const remoteHasData = snap.exists && Object.keys(remote).some(k => {
        const v = remote[k];
        if (v == null) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        return true;
      });

      if (remoteHasData) {
        // Apply remote -> local
        const normalized = normalizeRemoteData(remote);
        applyNormalizedToLocalStorage(normalized);
        console.log('firebase-wrapper: applied remote -> localStorage', Object.keys(normalized));
      } else {
        // Remote empty -> migrate local -> cloud (only non-empty keys)
        const localPayload = gatherLocalForMigration();
        const normalizedLocal = normalizeRemoteData(localPayload);

        const writePayload = {};
        Object.keys(normalizedLocal).forEach(k => {
          const v = normalizedLocal[k];
          if (v == null) return;
          if (Array.isArray(v) && v.length === 0) return; // don't write empty arrays that could overwrite
          writePayload[k] = v;
        });

        if (Object.keys(writePayload).length > 0) {
          await docRef.set(writePayload, { merge: true });
          console.log('firebase-wrapper: migrated local -> Firestore', Object.keys(writePayload));
        } else {
          // optional initial doc
          await docRef.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          console.log('firebase-wrapper: created empty doc with createdAt');
        }
      }

      // Mark ready, wrap storage to live-sync, and notify UI
      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(docRef);
      document.dispatchEvent(new Event("cloud-sync-ready"));
      console.log('firebase-wrapper: ready & dispatched cloud-sync-ready');

    } catch (err) {
      console.error('firebase-wrapper: error loading or migrating user data', err);

      // Allow app to proceed (local-only) and wrap storage so local writes continue
      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(null);
      document.dispatchEvent(new Event("cloud-sync-ready"));
    }
  });

  console.log('firebase-wrapper: initialized (listener attached)');
})();
