// ===================================
// Bit Builder - Firebase Initialization
// ===================================

// Firebase Configuration (embed directly)
const firebaseConfig = {
    apiKey: "AIzaSyBR4Vi0-4MnRmrVfkjyFO_TIC7oVwEmwe0",
    authDomain: "bit-builder-4c59c.firebaseapp.com",
    databaseURL: "https://bit-builder-4c59c-default-rtdb.firebaseio.com",
    projectId: "bit-builder-4c59c",
    storageBucket: "bit-builder-4c59c.firebasestorage.app",
    messagingSenderId: "981445293965",
    appId: "1:981445293965:web:9b95346ee6dbc45b65afc4"
};

// Initialize Firebase
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
    getAuth, 
    signOut, 
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

// Set functions region if needed (adjust based on your deployment)
import { connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js';
// Uncomment if using emulator locally:
// connectFunctionsEmulator(functions, "localhost", 5001);

// Export for use in other scripts
window.firebaseApp = { auth, db, functions };

// ===================================
// Auth Helper Functions
// ===================================

async function signUpWithEmail(email, password, displayName) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        window.location.href = 'dashboard.html';
    } catch (error) {
        throw new Error(getAuthErrorMessage(error.code));
    }
}

async function signInWithEmail(email, password) {
    try {
        await signInWithEmailAndPassword(auth, email, password);
        window.location.href = 'dashboard.html';
    } catch (error) {
        throw new Error(getAuthErrorMessage(error.code));
    }
}

async function logOut() {
    try {
        await signOut(auth);
        window.location.href = 'index.html';
    } catch (error) {
        alert('Error logging out: ' + error.message);
    }
}

function getAuthErrorMessage(code) {
    const messages = {
        'auth/email-already-in-use': 'This email is already in use.',
        'auth/weak-password': 'Password should be at least 6 characters.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/user-not-found': 'User not found.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/too-many-requests': 'Too many failed login attempts. Please try again later.',
    };
    return messages[code] || 'Authentication failed. Please try again.';
}

// ===================================
// Auth State Observer
// ===================================

onAuthStateChanged(auth, (user) => {
    // Check if current page requires authentication
    const publicPages = ['index.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    if (user) {
        // User is signed in
        window.currentUser = user;
        
        if (publicPages.includes(currentPage)) {
            window.location.href = 'dashboard.html';
        }
    } else {
        // User is not signed in
        window.currentUser = null;
        
        if (!publicPages.includes(currentPage)) {
            window.location.href = 'index.html';
        }
    }
});

// Expose functions globally for HTML inline scripts
window.signUpWithEmail = signUpWithEmail;
window.signInWithEmail = signInWithEmail;
window.logOut = logOut;

// Logout button handler (if present)
if (document.getElementById('logout-btn')) {
    document.getElementById('logout-btn').addEventListener('click', logOut);
}
