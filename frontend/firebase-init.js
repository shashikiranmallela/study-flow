// -----------------------------------------------------------
// firebase-init.js
// Initialises Firebase (v8 SDK) IMMEDIATELY - no backend call needed.
//
// Why: the old version downloaded this config from the Render backend.
// On Render's free plan the backend sleeps and needs ~50s to wake up,
// which broke login/sync on the first visit. A Firebase *web* config is
// public by design (it is not a secret); your data is protected by
// Firestore security rules, not by hiding this object.
// -----------------------------------------------------------

(function () {
  try {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK did not load (check your internet connection / ad-blocker)");
    }

    const firebaseConfig = {
      apiKey: "AIzaSyDsJgKx5v_VyGtwUle69gtcM8VUWvMp1O4",
      authDomain: "studyflow-b4ddf.firebaseapp.com",
      projectId: "studyflow-b4ddf",
      storageBucket: "studyflow-b4ddf.firebasestorage.app",
      messagingSenderId: "456016833263",
      appId: "1:456016833263:web:f6d4ef97231a43c103491a"
    };

    // Prevent duplicate app initialization
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    // expose globals for the wrapper / other scripts
    window.firebaseAuth = firebase.auth();
    if (typeof firebase.firestore === "function") {
      window.firestore = firebase.firestore();
    }
    window.firebaseReady = true;
  } catch (err) {
    console.error("Firebase init error:", err);
    window.firebaseReady = false;
  }
})();// -----------------------------------------------------------
// firebase-init.js
// Initialises Firebase (v8 SDK) IMMEDIATELY - no backend call needed.
//
// Why: the old version downloaded this config from the Render backend.
// On Render's free plan the backend sleeps and needs ~50s to wake up,
// which broke login/sync on the first visit. A Firebase *web* config is
// public by design (it is not a secret); your data is protected by
// Firestore security rules, not by hiding this object.
// -----------------------------------------------------------

(function () {
  try {
    if (typeof firebase === "undefined") {
      throw new Error("Firebase SDK did not load (check your internet connection / ad-blocker)");
    }

    const firebaseConfig = {
      apiKey: "AIzaSyDsJgKx5v_VyGtwUle69gtcM8VUWvMp1O4",
      authDomain: "studyflow-b4ddf.firebaseapp.com",
      projectId: "studyflow-b4ddf",
      storageBucket: "studyflow-b4ddf.firebasestorage.app",
      messagingSenderId: "456016833263",
      appId: "1:456016833263:web:f6d4ef97231a43c103491a"
    };

    // Prevent duplicate app initialization
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    // expose globals for the wrapper / other scripts
    window.firebaseAuth = firebase.auth();
    if (typeof firebase.firestore === "function") {
      window.firestore = firebase.firestore();
    }
    window.firebaseReady = true;
  } catch (err) {
    console.error("Firebase init error:", err);
    window.firebaseReady = false;
  }
})();