// Initializes Firebase (module) if `FIREBASE_CONFIG` is present and exposes helper methods on `window.FB`.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

async function initFirebase(){
  if(typeof FIREBASE_CONFIG === 'undefined') return;
  try{
    const app = initializeApp(FIREBASE_CONFIG);
    const db = getFirestore(app);

    // Save a single user's record (speeds/bacs arrays)
    async function saveUser(name, userData){
      if(!name || !userData) return;
      const docRef = doc(db, 'users', name);
      await setDoc(docRef, {
        speeds: userData.speeds || [],
        bacs: userData.bacs || [],
        updatedAt: serverTimestamp()
      }, { merge: true });
    }

    // Start realtime sync: calls onUpdate(remoteData) with full object mapping
    function startSync(onUpdate){
      const col = collection(db, 'users');
      return onSnapshot(col, snap => {
        const obj = {};
        snap.forEach(d=>{
          const data = d.data();
          obj[d.id] = {
            speeds: Array.isArray(data.speeds) ? data.speeds : [],
            bacs: Array.isArray(data.bacs) ? data.bacs : []
          };
        });
        try{ onUpdate(obj); }catch(e){ console.error('onUpdate handler failed', e); }
      }, err => console.error('Firestore snapshot error', err));
    }

    window.FB = { app, db, saveUser, startSync };
    console.log('Firebase initialized and window.FB available');
    // Notify other scripts that Firebase is ready
    try{ window.dispatchEvent(new Event('firebase-ready')); }catch(e){ console.warn('Could not dispatch firebase-ready event', e); }
  }catch(err){
    console.error('Firebase init error', err);
  }
}

initFirebase();
