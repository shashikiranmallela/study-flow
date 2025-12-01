// ----------------------------------------------------
// FINAL firebase-init.js (with SAFE FALLBACK)
// ----------------------------------------------------

window.firebaseReady = false;

(async () => {
  const backendUrl = "https://study-flow-ea7b.onrender.com";

  // ---- SAFETY TIMER: force firebaseReady = true after 7 seconds ----
  const failSafe = setTimeout(() => {
    console.warn("⚠ Backend slow — forcing firebaseReady = true");
    window.firebaseReady = true;
    document.dispatchEvent(new Event("firebase-ready"));
  }, 7000);

  try {
    const res = await fetch(`${backendUrl}/firebase-config`, { cache: "no-store" });

    if (!res.ok) throw new Error("Failed to fetch Firebase config");

    const firebaseConfig = await res.json();

    if (!firebaseConfig.apiKey) throw new Error("Invalid Firebase config");

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    window.firestore = firebase.firestore();

    // SUCCESS
    window.firebaseReady = true;
    clearTimeout(failSafe);

    console.log("🔥 Firebase initialized successfully");
    document.dispatchEvent(new Event("firebase-ready"));

  } catch (err) {
    console.error("Firebase init error:", err);

    // FAILOVER: still allow UI to continue
    window.firebaseReady = true;
    document.dispatchEvent(new Event("firebase-ready"));
  }
})();
