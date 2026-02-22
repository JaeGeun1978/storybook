import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';

// Firebase 설정
// 사용자가 본인의 Firebase 프로젝트 설정을 사용할 수 있도록
// 기본값은 재근쌤 스토리북 공용 설정
const firebaseConfig = {
  apiKey: "AIzaSyDEMOKEY_REPLACE_WITH_YOUR_OWN",
  authDomain: "jaegeun-storybook.firebaseapp.com",
  projectId: "jaegeun-storybook",
  storageBucket: "jaegeun-storybook.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};

let app: FirebaseApp;
let auth: Auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
} catch (error) {
  console.warn('Firebase 초기화 실패:', error);
}

const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async (): Promise<User | null> => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    console.error('Google 로그인 실패:', err);
    // 사용자가 팝업을 닫은 경우
    if (err.code === 'auth/popup-closed-by-user') {
      return null;
    }
    throw error;
  }
};

export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(auth);
  } catch (error) {
    console.error('로그아웃 실패:', error);
  }
};

export const onAuthChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};

export type { User };
export { auth };
