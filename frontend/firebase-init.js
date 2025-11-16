(async () => {
  try {
    // Use your Render backend URL
    const backendUrl = 'https://studyflow-backend-xxxx.onrender.com';
    
    const res = await fetch(`${backendUrl}/firebase-config`);
    if (!res.ok) {
      throw new Error(`Failed to fetch Firebase config: ${res.statusText}`);
    }
    
    const firebaseConfig = await res.json();
    
    // Validate config
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
      console.error('Firebase config incomplete:', firebaseConfig);
      throw new Error('Firebase configuration is incomplete');
    }
    
    firebase.initializeApp(firebaseConfig);
    window.firebaseAuth = firebase.auth();
    window.firestore = firebase.firestore();
    
    console.log('Firebase initialized successfully');
  } catch (err) {
    console.error('Firebase initialization error:', err);
    // Fallback: still initialize even if config fetch fails (uses hardcoded config if available)
  }
})();
