// firebase-init.js (final safe version)
window.firebaseReady = false;

(async () => {
  const backendUrl = "https://study-flow-ea7b.onrender.com";

  // Safety fallback: force firebaseReady after 7s so UI won't hang
  const failSafe = setTimeout(() => {
    console.warn("⚠ Backend slow or unreachable — forcing firebaseReady = true (fallback)");
    window.firebaseReady = true;
    document.dispatchEvent(new Event("firebase-ready"));
  }, 7000);

  try {
    const res = await fetch(`${backendUrl}/firebase-config`, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch Firebase config");
    const firebaseConfig = await res.json();
    if (!firebaseConfig || !firebaseConfig.apiKey) throw new Error("Invalid Firebase config");

    // Initialize Firebase (v8 style)
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    window.firestore = firebase.firestore();

    // success
    window.firebaseReady = true;
    clearTimeout(failSafe);
    console.log("🔥 Firebase initialized successfully");
    document.dispatchEvent(new Event("firebase-ready"));
  } catch (err) {
    console.error("Firebase init error:", err);
    // Fail-safe: still allow app to continue (offline mode)
    window.firebaseReady = true;
    clearTimeout(failSafe);
    document.dispatchEvent(new Event("firebase-ready"));
  }
})();
