// Firebase 초기화 + 클라우드 세이브 헬퍼
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyDQoDtFdsPjSU7TcVznKw_YOxKQ1aMWnZE',
  authDomain: 'dpsgame-e1dc8.firebaseapp.com',
  projectId: 'dpsgame-e1dc8',
  storageBucket: 'dpsgame-e1dc8.firebasestorage.app',
  messagingSenderId: '321747594906',
  appId: '1:321747594906:web:df87c09943a925ecf63923',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

export type 세이브문서 = { json?: string; 마지막저장시간?: number; session?: string; updated?: number }

// 세이브 문서: saves/{uid}
export async function cloudLoadRaw(uid: string): Promise<{ json: string; 마지막저장시간: number; session: string } | null> {
  const snap = await getDoc(doc(db, 'saves', uid))
  if (!snap.exists()) return null
  const d = snap.data() as 세이브문서
  if (typeof d.json !== 'string') return null
  return {
    json: d.json,
    마지막저장시간: typeof d.마지막저장시간 === 'number' ? d.마지막저장시간 : 0,
    session: typeof d.session === 'string' ? d.session : '',
  }
}

// 세이브 저장 (merge: session 필드 유지)
export async function cloudSaveRaw(uid: string, json: string): Promise<void> {
  let 마지막저장시간 = 0
  try { 마지막저장시간 = JSON.parse(json).마지막저장시간 || 0 } catch {}
  await setDoc(doc(db, 'saves', uid), { json, 마지막저장시간, updated: Date.now() }, { merge: true })
}

// 현재 활성 세션 ID 등록 (단일 세션 — 새 기기 로그인 시 이 값이 바뀜)
export async function claimSession(uid: string, sessionId: string): Promise<void> {
  await setDoc(doc(db, 'saves', uid), { session: sessionId }, { merge: true })
}

// 세이브 문서 실시간 감시 (세션 변경·최신시간 추적용)
export function watchSave(uid: string, cb: (d: 세이브문서 | null) => void): () => void {
  return onSnapshot(doc(db, 'saves', uid), snap => cb(snap.exists() ? (snap.data() as 세이브문서) : null))
}
