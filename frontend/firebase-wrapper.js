/* firebase-wrapper.js
   Replaces the incomplete wrapper. Works with Firebase v8 (firebase.auth(), firebase.firestore()).
   Put this file as frontend/firebase-wrapper.js (overwrite existing).
*/

(function () {
  // Wait until firebase-init.js signals firebaseReady
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

  // Helper to pause a little (used for retry)
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Firestore doc path helper
  function userDataDocRef(uid) {
    return window.firestore.collection('users').doc(uid).collection('meta').doc('appData');
    // alternatively you could use: firestore.collection('users').doc(uid) (flat). 
    // Using subcollection 'meta/appData' to avoid accidental overwrites and to keep growth manageable.
  }

  // Merge remote object into localStorage (safe merge)
  function applyRemoteToLocal(remoteObj) {
    if (!remoteObj) return;
    Object.keys(remoteObj).forEach(key => {
      try {
        localStorage.setItem(key, JSON.stringify(remoteObj[key]));
      } catch(e) {
        console.warn("Failed to set localStorage from remote:", key, e);
      }
    });
  }

  // Read local keys used by your app and prepare object for Firestore
  function gatherLocalAppData(keysToInclude) {
    const obj = {};
    keysToInclude.forEach(key => {
      try {
        const val = localStorage.getItem(key);
        if (val !== null) obj[key] = JSON.parse(val);
      } catch(e) {
        console.warn("Failed to get local key:", key, e);
      }
    });
    return obj;
  }

  // Keys we care about (based on your script.js)
  const SYNC_KEYS = [
    'todos',
    'routine',
    'timeSessions',
    'timerState',
    'currentStatsPeriod',
    'username',
    'isLoggedIn',
    'theme'
  ];

  (async function init() {
    await waitForFirebase();
    console.log('firebase-wrapper: firebaseReady detected');

    let currentUser = null;
    let docRef = null;
    let isSyncing = false;
    let localCache = {}; // in-memory cache (optional)

    // Function to fetch Firestore doc for current user
    async function loadUserData(uid) {
      docRef = userDataDocRef(uid);
      try {
        const snap = await docRef.get();
        if (snap.exists) {
          const data = snap.data() || {};
          // apply to localStorage (merge remote data into local)
          applyRemoteToLocal(data);
          console.log('firebase-wrapper: remote data applied to localStorage', data);
        } else {
          console.log('firebase-wrapper: no remote doc (new user). Will migrate local to cloud if local exists.');
          // If there is local data, push it to Firestore
          const localObj = gatherLocalAppData(SYNC_KEYS);
          if (Object.keys(localObj).length > 0) {
            await docRef.set(localObj, { merge: true });
            console.log('firebase-wrapper: migrated localStorage -> Firestore for new user', localObj);
          } else {
            // create an empty doc so future writes are straightforward
            await docRef.set({}, { merge: true });
          }
        }
      } catch (err) {
        console.error('firebase-wrapper: error loading user data', err);
      }
    }

    // Function to sync a single key to Firestore
    async function syncKeyToFirestore(key, value) {
      if (!docRef) return;
      try {
        const payload = {};
        payload[key] = value;
        await docRef.set(payload, { merge: true });
        // console.log('firebase-wrapper: synced key', key);
      } catch (err) {
        console.error('firebase-wrapper: failed to sync key', key, err);
      }
    }

    // Override the global storage object (keep same API)
    // If storage wasn't declared yet in script.js, we still define it.
    // But since script.js already defines `const storage = { ... }`, we will mutate its methods.
    function wrapStorageMethods() {
      try {
        if (typeof storage === 'undefined') {
          window.storage = {
            get: (k, def = null) => {
              try {
                const v = localStorage.getItem(k);
                return v ? JSON.parse(v) : def;
              } catch(e) { return def; }
            },
            set: (k, v) => {
              try {
                localStorage.setItem(k, JSON.stringify(v));
                if (currentUser) syncKeyToFirestore(k, v);
              } catch(e) { console.warn('storage.set failed', e); }
            }
          };
          console.log('firebase-wrapper: storage created and wrapped');
          return;
        }

        // If storage exists, replace its set/get with wrappers
        const originalGet = storage.get;
        const originalSet = storage.set;

        storage.get = function(key, defaultValue = null) {
          try {
            return originalGet ? originalGet.call(storage, key, defaultValue) : (JSON.parse(localStorage.getItem(key)) || defaultValue);
          } catch (e) { return defaultValue; }
        };

        storage.set = function(key, value) {
          try {
            if (originalSet) originalSet.call(storage, key, value);
            else localStorage.setItem(key, JSON.stringify(value));
            // Sync to Firestore if user is logged in
            if (currentUser) {
              syncKeyToFirestore(key, value).catch(e => console.error(e));
            }
          } catch (e) {
            console.warn('wrapped storage.set error', e);
          }
        };

        console.log('firebase-wrapper: storage wrapped (existing storage replaced)');
      } catch (err) {
        console.error('firebase-wrapper: wrapStorageMethods error', err);
      }
    }

    // Listen for auth changes
    firebase.auth().onAuthStateChanged(async (user) => {
      currentUser = user;
      if (user) {
        console.log('firebase-wrapper: user signed in', user.uid);
        await loadUserData(user.uid);
      } else {
        console.log('firebase-wrapper: no user signed in');
        docRef = null;
      }
    });

    // Initialize wrapper after small delay to allow script.js to define storage
    // (script.js is included after firebase-wrapper.js in your HTML, but in case order differs)
    // So we retry wrapping for a short period.
    for (let attempt = 0; attempt < 10; attempt++) {
      wrapStorageMethods();
      // If storage.set now is the wrapped one, break
      if (storage && typeof storage.set === 'function') {
        break;
      }
      await sleep(100);
    }

    // Expose tiny debug API on window for manual sync
    window.__firebaseWrapper = {
      syncAllLocalToCloud: async function() {
        if (!firebase.auth().currentUser) throw new Error('Not signed in');
        const uid = firebase.auth().currentUser.uid;
        docRef = userDataDocRef(uid);
        const payload = gatherLocalAppData(SYNC_KEYS);
        await docRef.set(payload, { merge: true });
        console.log('firebase-wrapper: manual syncAllLocalToCloud done', payload);
      },
      loadCloudToLocal: async function() {
        if (!firebase.auth().currentUser) throw new Error('Not signed in');
        await loadUserData(firebase.auth().currentUser.uid);
      },
      currentUser: () => firebase.auth().currentUser ? firebase.auth().currentUser.uid : null
    };

    console.log("🔥 firebase-wrapper.js fully initialized");
  })();

})();
