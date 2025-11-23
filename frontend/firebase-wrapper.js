/* firebase-wrapper.js
   Provides storage.get/set that sync to Firestore.
   Include AFTER firebase-init.js and BEFORE your script.js in index.html.
*/
// Wait until firebase is initialized
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

  // your existing wrapper code here
})();

const backendUrl = "https://study-flow-ea7b.onrender.com";

(function(){
  let currentUser = null;
  let firestoreCache = {};
  let isSyncing = false;

  // Initialize auth listener
  if (window.firebaseAuth) {
    window.firebaseAuth.onAuthStateChanged(async (user) => {
      currentUser = user;
      if (user) {
        await loadUserDataFromFirestore();
        if (typeof window.updateAuthUI === 'function') {
          window.updateAuthUI();
        }
      } else {
        firestoreCache = {};
        if (typeof window.updateAuthUI === 'function') {
          window.updateAuthUI();
        }
      }
    });
  }

  // Load all user data from Firestore
  async function loadUserDataFromFirestore() {
    if (!currentUser) return;
    
    try {
      const response = await fetch('${backendUrl}/api/user/data', {
        headers: {
          'Authorization': `Bearer ${await currentUser.getIdToken()}`
        }
      });

      if (!response.ok) {
        console.error('Failed to load user data:', response.statusText);
        return;
      }

      const data = await response.json();
      firestoreCache = data;
      console.log('User data loaded from Firestore');
    } catch (error) {
      console.error('Error loading user data from Firestore:', error);
    }
  }

  // Sync data to Firestore
  async function syncToFirestore(key, value) {
    if (!currentUser) {
      console.warn('User not authenticated, cannot sync to Firestore');
      return;
    }

    if (isSyncing) return;
    isSyncing = true;

    try {
      const payload = { [key]: value };
      const response = await fetch('/api/user/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await currentUser.getIdToken()}`
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

  // Storage API
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
