import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDmD2wXzdhXn8acFb9tn1SlgguUU890fn8",
  authDomain: "citric-runway-knzsc.firebaseapp.com",
  projectId: "citric-runway-knzsc",
  storageBucket: "citric-runway-knzsc.firebasestorage.app",
  messagingSenderId: "67782995983",
  appId: "1:67782995983:web:dc18a61a6af7c83b06f37a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
