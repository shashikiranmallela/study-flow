// firebase-init.js (ADDED - your Firebase config)
const firebaseConfig = {
  apiKey: "AIzaSyDsJgKx5v_VyGtwUle69gtcM8VUWvMp1O4",
  authDomain: "studyflow-b4ddf.firebaseapp.com",
  projectId: "studyflow-b4ddf",
  storageBucket: "studyflow-b4ddf.firebasestorage.app",
  messagingSenderId: "456016833263",
  appId: "1:456016833263:web:f6d4ef97231a43c103491a",
  measurementId: "G-D93TWJDXDG"
};
if (typeof firebase === 'undefined') {
  console.error('Firebase SDK not loaded. Ensure firebase scripts are included before this file.');
} else {
  firebase.initializeApp(firebaseConfig);
  window.firebaseAuth = firebase.auth();
  window.firestore = firebase.firestore();
}
