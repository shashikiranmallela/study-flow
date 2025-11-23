/* firebase-wrapper.js
   Handles Firestore syncing and authentication redirects, safely.
*/

// Wait until firebase is fully initialized by firebase-init.js
function waitForFirebase() {
  return new Promise((resolve) => {
    if (window.firebaseReady) return resolve();
    const check = setInterval(() => {
      if (window.firebaseReady) {
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}

const backendUrl = "https://study-flow-ea7b.onrender.com";

(async () => {
  await waitForFirebase();
  console.log("🔥 Firebase ready!");

  let currentUser = null;
  let cache = {};
  let isSyncing = false;

  // -----------------------------
  // SINGLE AUTH LISTENER 🔥 FIXED
  // -----------------------------
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    const path = window.location.pathname.toLowerCase();

    if (user) {
      // ✔ Logged in
      console.log("User logged in:", user.uid);

      // Redirect AWAY from loginpage.html
      if (path.includes("loginpage.html")) {
        window.location.href = "index.html";
        return;
      }

      // Load user data
      await loadUserData();

      // Update UI (if exist)
      if (typeof window.updateAuthUI === "function") {
        window.updateAuthUI();
      }

    } else {
      // ❌ Not logged in
      console.log("No user logged in");

      cache = {}; // clear cache

      // Redirect AWAY from dashboard to login
      if (path.includes("index.html")) {
        window.location.href = "loginpage.html";
        return;
      }

      if (typeof window.updateAuthUI === "function") {
        window.updateAuthUI();
      }
    }
  });

  // -----------------------------
  // LOAD USER DATA SAFELY
  // -----------------------------
  async function loadUserData() {
    if (!currentUser) return;

    try {
      const token = await currentUser.getIdToken();

      const response = await fetch(`${backendUrl}/api/user/data`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // 🔥 IMPORTANT FIX:
      // backend ALWAYS returns {} instead of error
      const data = await response.json();
      cache = data || {};

      console.log("User data loaded:", cache);

    } catch (e) {
      console.error("Error loading user data:", e);
      // DO NOT redirect — prevents 5-sec loop
    }
  }

  // -----------------------------
  // SYNC USER DATA
  // -----------------------------
  async function sync(key, value) {
    if (!currentUser) return console.warn("Not logged in, cannot sync");

    if (isSyncing) return;
    isSyncing = true;

    try {
      const token = await currentUser.getIdToken();

      const payload = { [key]: value };
      await fetch(`${backendUrl}/api/user/data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      console.log("Synced", key);

    } catch (e) {
      console.error("Error syncing:", e);
    } finally {
      isSyncing = false;
    }
  }

  // -----------------------------
  // STORAGE API (used by script.js)
  // -----------------------------
  window.storage = {
    get: (key, defaultValue = null) => {
      return cache.hasOwnProperty(key) ? cache[key] : defaultValue;
    },
    set: (key, value) => {
      cache[key] = value;
      if (currentUser) sync(key, value);
    }
  };

  console.log("🔥 firebase-wrapper.js fully initialized");
})();


  console.log("Firebase wrapper initialized");
})();


