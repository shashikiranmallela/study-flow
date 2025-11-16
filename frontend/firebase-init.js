(async () => {
  try {
    // Use your actual Render backend URL
    const backendUrl = 'https://study-flow-ea7b.onrender.com';
    
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
  }
})();
