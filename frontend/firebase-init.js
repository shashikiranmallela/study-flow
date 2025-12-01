(async () => {
  try {
    const backendUrl = 'https://study-flow-ea7b.onrender.com';
    
    const res = await fetch(`${backendUrl}/firebase-config`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Firebase config: ${res.statusText}`);
    }
    
    const firebaseConfig = await res.json();
    
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.error('Firebase config incomplete:', firebaseConfig);
      throw new Error('Firebase configuration is incomplete');
    }
    
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    window.firestore = firebase.firestore();
    window.firebaseReady = true;


    console.log('Firebase initialized successfully');

    // 🔥 IMPORTANT: Tell the rest of the app Firebase is ready
    window.firebaseReady = true;

  } catch (err) {
    console.error('Firebase initialization error:', err);
  }
})();

