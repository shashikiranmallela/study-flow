/* firebase-wrapper.js
   Provides storage.get/set that sync to Firestore.
   Include AFTER firebase-init.js and BEFORE your script.js in index.html.
*/

// Wait until firebase is fully initialized
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

(async () => {
  await waitForFirebase();
  console.log("Firebase ready!");
})();

const backendUrl = "https://study-flow-ea7b.onrender.com";

(function(){
  let currentUser = null;
  let firestoreCache = {};
  let isSyncing = false;

  // Auth listener
  firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;

    const path = window.location.pathname.toLowerCase();

    if (user) {
        // Redirect logged-in users AWAY from loginpage
        if (path.includes("loginpage.html")) {
            window.location.href = "index.html";
        }

        // Load user data
        await loadUserDataFromFirestore();

        if (typeof window.updateAuthUI === 'function') {
            window.updateAuthUI();
        }

    } else {
        // Redirect NON-logged users AWAY from dashboard
        if (path.includes("index.html")) {
            window.location.href = "loginpage.html";
        }

        firestoreCache = {};

        if (typeof window.updateAuthUI === 'function') {
            window.updateAuthUI();
        }
    }
  });

  // Load user data from backend
  async function loadUserDataFromFirestore() {
    if (!currentUser) return;
    
    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${backendUrl}/api/user/data`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        console.error('Failed to load user data:', response.statusText);
        return;
      }

      firestoreCache = await response.json();
      console.log('User data loaded from Firestore');
    } catch (error) {
      console.error('Error loading user data from Firestore:', error);
    }
  }

  // Sync to Firestore
  async function syncToFirestore(key, value) {
    if (!currentUser) {
      console.warn('User not authenticated, cannot sync to Firestore');
      return;
    }

    if (isSyncing) return;
    isSyncing = true;

    try {
      const token = await currentUser.getIdToken();
      const payload = { [key]: value };

      const response = await fetch(`${backendUrl}/api/user/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('Failed to sync data to Firestore:', response.statusText);
      } else {
        console.log(`Synced ${key} to Firestore`);
      }

    } catch (error) {
      console.error('Error syncing to Firestore:', error);
    } finally {
      isSyncing = false;
    }
  }

  // Storage
  window.storage = {
    get: function(key, defaultValue = null) {
      try {
        if (currentUser && firestoreCache.hasOwnProperty(key)) {
          return firestoreCache[key];
        }
        return defaultValue;
      } catch (err) {
        console.error('storage.get error:', err);
        return defaultValue;
      }
    },

    set: function(key, value) {
      try {
        firestoreCache[key] = value;
        if (currentUser) {
          syncToFirestore(key, value);
        } else {
          console.warn('User not authenticated, data not saved to Firestore');
        }
      } catch (err) {
        console.error('storage.set error:', err);
      }
    }
  };

  console.log('Firebase wrapper initialized');
})();

