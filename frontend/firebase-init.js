// -----------------------------------------------------------
// firebase-init.js
// Fetch secure Firebase config from backend and initialize app
// -----------------------------------------------------------

(async () => {
  try {
    const backendUrl = "https://study-flow-ea7b.onrender.com";

    const res = await fetch(`${backendUrl}/firebase-config`);
    if (!res.ok) throw new Error("Failed to fetch Firebase config");

    const firebaseConfig = await res.json();

    if (!firebaseConfig.apiKey) {
      throw new Error("Firebase config missing required fields");
    }

    // 🔥 Prevent duplicate app initialization
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("🔥 Firebase initialized successfully");
    } else {
      console.warn("Firebase already initialized, skipped.");
    }

    // expose global for wrapper
    window.firebaseAuth = firebase.auth();
    window.firestore = firebase.firestore();
    window.firebaseReady = true;

  } catch (err) {
    console.error("Firebase init error:", err);
  }
})();
