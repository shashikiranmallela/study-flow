/* firebase-wrapper.js - Full structured sync (Option A)
   - Works with Firebase v8 (firebase.auth(), firebase.firestore())
   - Normalizes remote/cloud data -> localStorage keys used by script.js
   - Migrates local -> cloud when cloud is empty
   - Wraps storage.set for live sync
   - Ensures completedAt is preserved and generated when needed
*/

console.log("firebase-wrapper.js loaded");

// signal for script.js to wait for cloud load
window.__firestoreDataLoaded = false;

// Wait for firebase-init.js to set window.firebaseReady
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();
    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);
    // safety timeout (10s) - still resolve so UI doesn't hang forever
    setTimeout(() => { clearInterval(t); resolve(); }, 10000);
  });
}

// Ensure there's always a storage object so wrapper never fails
function ensureStorageFallback() {
  if (!window.storage) {
    console.warn("firebase-wrapper: creating fallback storage object");
    window.storage = {
      get: (k, def = null) => {
        try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
      },
      set: (k, v) => {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch(e) { console.warn(e); }
      }
    };
  }
}

// helper to ensure a todo object has required fields
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
    // if item marked completed but missing completedAt, create one
    completedAt = new Date().toISOString();
  }
  return { id, text, completed, createdAt, completedAt };
}

// Normalize remote values into the exact keys your script.js expects
function normalizeRemoteData(raw) {
  // raw is an object read from Firestore (or {})
  const normalized = {};

  // Helper: safe-get
  const pick = (k, def) => (raw && raw.hasOwnProperty(k) ? raw[k] : def);

  // todos: may be array of strings or array of objects or undefined
  const rawTodos = pick('todos', []);
  if (Array.isArray(rawTodos)) {
    normalized.todos = rawTodos.map(item => {
      if (item && typeof item === 'object') {
        // already proper object - ensure keys exist, including completedAt
        return normalizeTodoObject(item);
      } else {
        // primitive string -> turn into object
        return normalizeTodoObject({ text: String(item), completed: false });
      }
    }).filter(Boolean);
  } else {
    normalized.todos = [];
  }

  // routine: expect array of {id, time, activity}
  const rawRoutine = pick('routine', []);
  if (Array.isArray(rawRoutine)) {
    normalized.routine = rawRoutine.map(r => {
      if (r && typeof r === 'object') {
        return {
          id: r.id ? String(r.id) : Date.now().toString() + Math.random().toString(36).slice(2,7),
          time: r.time || (r.t || '') ,
          activity: r.activity || r.name || ''
        };
      } else {
        return { id: Date.now().toString(), time: '00:00', activity: String(r) || 'Activity' };
      }
    });
  } else {
    normalized.routine = [];
  }

  // timeSessions: expect array of {date, duration, type, task}
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
  } else {
    normalized.timeSessions = [];
  }

  // timerState: expect object (seconds, isRunning, isBreak, currentTask, startTime)
  const rawTimer = pick('timerState', null);
  normalized.timerState = (rawTimer && typeof rawTimer === 'object') ? {
    seconds: Number(rawTimer.seconds) || 0,
    isRunning: !!rawTimer.isRunning,
    isBreak: !!rawTimer.isBreak,
    currentTask: rawTimer.currentTask || '',
    startTime: rawTimer.startTime || null
  } : {
    seconds: 0, isRunning: false, isBreak: false, currentTask: '', startTime: null
  };

  // currentStatsPeriod
  normalized.currentStatsPeriod = pick('currentStatsPeriod', pick('statsPeriod', 'today'));

  // theme, username, email, uid, isLoggedIn
  normalized.theme = pick('theme', 'light');
  normalized.username = pick('username', pick('name', 'User'));
  normalized.email = pick('email', null);
  normalized.uid = pick('uid', null);
  normalized.isLoggedIn = !!pick('isLoggedIn', false);

  return normalized;
}

// Convert the in-memory normalized object into key-by-key localStorage writes
function applyNormalizedToLocalStorage(norm) {
  // keys your script.js expects
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

// Collect localStorage keys to prepare payload for migration
function gatherLocalForMigration() {
  const keys = ['todos','routine','timeSessions','timerState','currentStatsPeriod','theme','username','email','uid','isLoggedIn'];
  const payload = {};
  keys.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) {
        payload[k] = JSON.parse(v);
      }
    } catch (e) {
      // ignore invalid JSON
    }
  });
  return payload;
}

// MAIN
(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Ensure storage exists while wrapper runs so no missing errors
  ensureStorageFallback();

  // Wrap function that will wrap storage later (when docRef available)
  function wrapStorageWithDocRef(docRef) {
    // ensure storage exists (again, in case script.js created it later)
    ensureStorageFallback();
    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function(key, value) {
      // call original
      try { if (originalSet) originalSet.call(storage, key, value); else localStorage.setItem(key, JSON.stringify(value)); }
      catch(e) { console.warn('storage.set original error', e); }

      // Before syncing to Firestore, normalize some keys to avoid writing broken structures
      if (key === 'todos' && Array.isArray(value)) {
        // Ensure every todo has id, createdAt, and completedAt when needed
        value = value.map(t => normalizeTodoObject(t));
      }

      // Sync to Firestore
      if (docRef) {
        try {
          // Prepare an update payload where top-level keys are maintained
          const updateObj = {};
          updateObj[key] = value;
          // Use merge so we don't overwrite other fields
          docRef.set(updateObj, { merge: true }).catch(err => {
            console.error('firebase-wrapper: failed to sync key', key, err);
          });
        } catch(e) {
          console.error('firebase-wrapper: sync error', e);
        }
      }
    };

    // preserve get behavior
    storage.get = function(key, defaultValue = null) {
      try { return originalGet ? originalGet.call(storage, key, defaultValue) : (JSON.parse(localStorage.getItem(key)) || defaultValue); }
      catch(e) { return defaultValue; }
    };

    console.log('firebase-wrapper: storage wrapped for sync');
  }

  // Auth state listener
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log('firebase-wrapper: signed out');
      // Not signed in: don't attempt cloud loads; still ensure script knows nothing to wait for
      window.__firestoreDataLoaded = true;
      return;
    }

    const uid = user.uid;
    const docRef = db.collection('users').doc(uid);

    try {
      // Get remote doc
      const snap = await docRef.get();
      const remote = snap.exists ? snap.data() : {};

      // If remote has keys and is non-empty, normalize and apply to localStorage
      const remoteHasData = snap.exists && Object.keys(remote).some(k => {
        const v = remote[k];
        if (v === null || v === undefined) return false;
        if (Array.isArray(v)) return v.length > 0;
        if (typeof v === 'object') return Object.keys(v).length > 0;
        return true;
      });

      if (remoteHasData) {
        const normalized = normalizeRemoteData(remote);
        applyNormalizedToLocalStorage(normalized);
        console.log('firebase-wrapper: applied remote -> localStorage', normalized);
      } else {
        // remote empty -> migrate local to cloud (only non-empty keys)
        const localPayload = gatherLocalForMigration();

        // Normalize local payload to ensure proper structure before writing
        const normalizedLocal = normalizeRemoteData(localPayload);
        // Only write keys that are present (non-empty) to avoid writing empty arrays and erasing remote later
        const writePayload = {};
        Object.keys(normalizedLocal).forEach(k => {
          const v = normalizedLocal[k];
          if (v === null || v === undefined) return;
          if (Array.isArray(v) && v.length === 0) return; // don't write empty arrays
          // otherwise write
          writePayload[k] = v;
        });

        if (Object.keys(writePayload).length > 0) {
          await docRef.set(writePayload, { merge: true });
          console.log('firebase-wrapper: migrated local -> Firestore', writePayload);
        } else {
          // create empty doc so future writes are easier (optional)
          await docRef.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          console.log('firebase-wrapper: created empty doc with createdAt');
        }
      }

      // After cloud->local or migration, mark loaded
      window.__firestoreDataLoaded = true;

      // wrap storage to sync live changes
      wrapStorageWithDocRef(docRef);

    } catch (err) {
      console.error('firebase-wrapper: error loading or migrating user data', err);
      // Still allow app to continue
      window.__firestoreDataLoaded = true;
      wrapStorageWithDocRef(null);
    }
  });

  console.log('firebase-wrapper: initialized');
})();
