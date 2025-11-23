/* CLEAN WORKING FIREBASE WRAPPER
   - Cloud sync (Firestore)
   - Load user data BEFORE script.js initializes
   - Prevents “No Firebase App” and race conditions
   - Works on multiple devices (same login → same data)
*/

console.log("firebase-wrapper.js loaded");

// Tell script.js to wait until cloud data is loaded
window.__firestoreDataLoaded = false;

// Helper: wait for firebase-init.js to finish
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

(async () => {
  await waitForFirebase();
  console.log("firebase-wrapper: Firebase is ready");

  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let docRef = null;

  // Keys your app uses
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

  // ---- Load Firestore Data → localStorage ----
  async function loadUserData(uid) {
    docRef = db.collection("users").doc(uid);

    const snap = await docRef.get();

    if (snap.exists) {
      const data = snap.data();

      console.log("firebase-wrapper: Firestore data:", data);

      // Write cloud data → localStorage
      for (let key in data) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
      console.log("firebase-wrapper: Remote → LocalStorage applied");
    } else {
      console.log("firebase-wrapper: No data, creating empty doc");
      await docRef.set({}, { merge: true });
    }

    // Tell script.js that cloud sync is complete
    window.__firestoreDataLoaded = true;
  }

  // ---- Wrap localStorage sync ----
  function wrapStorage() {
    if (!window.storage) {
      console.error("storage object missing!");
      return;
    }

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

  // ---- Listen for login state ----
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("firebase-wrapper: user logged out");
      currentUser = null;
      return;
    }

    currentUser = user;
    console.log("firebase-wrapper: user logged in:", user.uid);

    // Load user data from cloud
    await loadUserData(user.uid);

    // Wrap storage after data is loaded
    wrapStorage();
  });

  console.log("firebase-wrapper: Fully initialized");
})();
