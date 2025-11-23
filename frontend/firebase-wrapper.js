/* CLEAN & SAFE FIREBASE WRAPPER
   - Waits for firebaseReady safely
   - Wraps localStorage only AFTER Firebase + Auth is ready
   - Syncs user data to Firestore
   - Prevents race conditions & “No Firebase App” errors
*/

console.log("firebase-wrapper.js loaded");

function waitForFirebase() {
  return new Promise(res => {
    if (window.firebaseReady) return res();
    const t = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(t);
        res();
      }
    }, 50);
  });
}

(async () => {
  // Wait for Firebase initialization from firebase-init.js
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase is ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let docRef = null;

  const SYNC_KEYS = [
    "todos",
    "routine",
    "timeSessions",
    "timerState",
    "currentStatsPeriod",
    "username",
    "isLoggedIn",
    "theme",
  ];

  // Wrap storage after script.js has executed
  function wrapStorage() {
    if (!window.storage) return console.error("storage object missing!");

    const originalSet = storage.set;
    const originalGet = storage.get;

    storage.set = function (key, value) {
      originalSet.call(storage, key, value);

      if (currentUser && docRef) {
        const update = {};
        update[key] = value;
        docRef.set(update, { merge: true });
      }
    };

    console.log("firebase-wrapper: storage wrapped successfully");
  }

  // Load Firestore user data back into localStorage
  async function loadUserData(uid) {
    docRef = db.collection("users").doc(uid);

    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data();
      for (let key in data) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
      console.log("firebase-wrapper: loaded remote data -> localStorage");
    } else {
      console.log("firebase-wrapper: new user, creating empty doc");
      await docRef.set({}, { merge: true });
    }
  }

  // Listen to login/logout
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: user logged out");
      currentUser = null;
      return;
    }

    currentUser = user;
    console.log("firebase-wrapper: user logged in:", user.uid);

    // Load Firestore → localStorage
    await loadUserData(user.uid);

    // Now wrap storage & enable syncing
    wrapStorage();
  });

  console.log("firebase-wrapper: fully initialized");
})();
