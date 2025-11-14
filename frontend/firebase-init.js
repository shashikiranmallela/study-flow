(async () => {
  const res = await fetch('/firebase-config');
  const firebaseConfig = await res.json();

  firebase.initializeApp(firebaseConfig);
  window.firebaseAuth = firebase.auth();
  window.firestore = firebase.firestore();
})();
