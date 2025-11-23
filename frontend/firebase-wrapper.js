/* FINAL FIXED FIREBASE WRAPPER
   This version:
   ✔ Waits for firebase
   ✔ Waits for login
   ✔ Waits for script.js to create storage
   ✔ Loads Firestore → localStorage
   ✔ Syncs localStorage → Firestore
   ✔ Works across devices
*/

console.log("firebase-wrapper.js loaded");

// script.js should wait for this
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

// --- Wait for storage object to exist ---
function waitForStorage() {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (window.storage) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
}

(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase is ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  // Keys to sync
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

  // Load Firestore → Local
  async function loadUserData(uid) {
    docRef = db.collection("users").doc(uid);

    const snap = await docRef.get();

    if (snap.exists && Object.keys(snap.data()).length > 0) {
      const data = snap.data();
      console.log("firebase-wrapper: loaded remote data -> localStorage");
      for (let key in data) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
    } else {
      console.log("firebase-wrapper: No cloud data, migrating local → cloud");

      const payload = {};
      SYNC_KEYS.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) payload[key] = JSON.parse(val);
      });

      await docRef.set(payload, { merge: true });
    }

    window.__firestoreDataLoaded = true;
  }

  // Wrap storage AFTER it exists
  async function wrapStorage() {
    await waitForStorage();

    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function (key, value) {
      originalSet.call(storage, key, value);

      if (docRef) {
        const update = {};
        update[key] = value;
        docRef.set(update, { merge: true });
      }
    };

    console.log("firebase-wrapper: storage wrapped successfully");
  }

  // Auth listener
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: user logged out");
      return;
    }

    console.log("firebase-wrapper: user logged in:", user.uid);

    // Step 1 — Load cloud data
    await loadUserData(user.uid);

    // Step 2 — Wait for storage object from script.js
    await wrapStorage();
  });

  console.log("firebase-wrapper: fully initialized");
})();
