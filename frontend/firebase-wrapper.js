/* FINAL FIXED WRAPPER – GUARANTEED WORKING */

console.log("firebase-wrapper.js loaded");

// script.js waits for this
window.__firestoreDataLoaded = false;

// --- Wait for Firebase ---
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();
    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
}

// --- Ensure storage object ALWAYS exists ---
function ensureStorageExists() {
  if (!window.storage) {
    console.warn("wrapper: storage was missing → creating fallback storage");

    window.storage = {
      get: (key, def = null) => {
        try {
          const v = localStorage.getItem(key);
          return v ? JSON.parse(v) : def;
        } catch {
          return def;
        }
      },
      set: (key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
      }
    };
  }
}

// --- Wrap storage for syncing ---
function wrapStorage(docRef) {
  ensureStorageExists(); // make sure it exists

  const originalSet = storage.set;
  const originalGet = storage.get;

  storage.set = function (key, value) {
    originalSet.call(storage, key, value);

    // Sync to Firestore
    if (docRef) {
      const update = {};
      update[key] = value;
      docRef.set(update, { merge: true });
    }
  };

  console.log("firebase-wrapper: storage wrapped successfully");
}

(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase is ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  const SYNC_KEYS = [
    "todos",
    "routine",
    "timeSessions",
    "timerState",
    "currentStatsPeriod",
    "username",
    "isLoggedIn",
    "theme"
  ];

  let docRef = null;

  async function loadUserData(uid) {
    docRef = db.collection("users").doc(uid);

    const snap = await docRef.get();

    if (snap.exists && Object.keys(snap.data()).length > 0) {
      console.log("firebase-wrapper: Firestore data:", snap.data());

      const data = snap.data();
      for (let key in data) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
      console.log("firebase-wrapper: Remote → LocalStorage applied");
    } else {
      // MIGRATION: local → cloud
      console.log("firebase-wrapper: migrating local → cloud");

      const payload = {};
      SYNC_KEYS.forEach((key) => {
        const val = localStorage.getItem(key);
        if (val !== null) payload[key] = JSON.parse(val);
      });

      await docRef.set(payload, { merge: true });
    }

    window.__firestoreDataLoaded = true;
  }

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: user logged out");
      return;
    }

    console.log("firebase-wrapper: user logged in:", user.uid);

    // Step 1 — load cloud data
    await loadUserData(user.uid);

    // Step 2 — ensure storage exists
    ensureStorageExists();

    // Step 3 — wrap it for syncing
    wrapStorage(docRef);
  });

  console.log("firebase-wrapper: Fully initialized");
})();
