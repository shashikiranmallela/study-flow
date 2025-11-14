/* firebase-wrapper.js
   Provides storage.get/set that mirror localStorage and sync to Firestore when user is signed-in.
   Include AFTER firebase-init.js and BEFORE your script.js in index.html.
*/
(function(){
  window.storage = {
    get: function(key, defaultValue){
      try {
        var user = (window.firebaseAuth && window.firebaseAuth.currentUser) ? window.firebaseAuth.currentUser : null;
        if (user && window.__firestoreCache && window.__firestoreCache.hasOwnProperty(key)) {
          return window.__firestoreCache[key];
        }
        var item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch(err) { console.error('storage.get', err); return defaultValue; }
    },
    set: function(key, value){
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(e){ console.warn('localStorage.set failed', e); }
      try {
        var user = (window.firebaseAuth && window.firebaseAuth.currentUser) ? window.firebaseAuth.currentUser : null;
        if (user) {
          var uid = user.uid;
          var docRef = window.firestore.collection('users').doc(uid);
          var obj = {};
          obj[key] = value;
          // write under appData map
          docRef.set({ appData: obj }, { merge: true }).catch(function(e){ console.error('firestore write failed', e); });
          window.__firestoreCache = window.__firestoreCache || {};
          window.__firestoreCache[key] = value;
        }
      } catch(err){ console.error('storage.set', err); }
    }
  };

  // Auth listener to populate cache and merge local->firestore
  if (window.firebaseAuth) {
    window.__firestoreCache = {};
    window.firebaseAuth.onAuthStateChanged(async function(user){
      if (user) {
        try {
          var docRef = window.firestore.collection('users').doc(user.uid);
          var snap = await docRef.get();
          var appData = (snap.exists && snap.data().appData) ? snap.data().appData : {};
          window.__firestoreCache = Object.assign({}, appData);
          // merge local keys if remote missing
          var keys = ['todos','timeSessions','timerState','username','theme','routine','currentStatsPeriod','isLoggedIn'];
          var toSet = {};
          keys.forEach(function(k){
            try {
              var raw = localStorage.getItem(k);
              if (raw && !window.__firestoreCache.hasOwnProperty(k)) {
                toSet[k] = JSON.parse(raw);
                window.__firestoreCache[k] = JSON.parse(raw);
              }
            } catch(e){}
          });
          if (Object.keys(toSet).length > 0) {
            await docRef.set({ appData: toSet }, { merge: true });
          }
        } catch(e){ console.error('auth sync failed', e); }
      } else {
        window.__firestoreCache = {};
      }
      if (typeof window.updateAuthUI === 'function') window.updateAuthUI();
    });
  } else {
    console.warn('firebaseAuth not detected; ensure firebase-init.js loaded before firebase-wrapper.js');
  }
})();
