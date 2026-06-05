// Firebase 초기화 + 클라우드 세이브 헬퍼
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore'

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

// 세이브 문서: saves/{uid} = { json, updated, 마지막저장시간 }
export async function cloudLoadRaw(uid: string): Promise<{ json: string; 마지막저장시간: number } | null> {
  const snap = await getDoc(doc(db, 'saves', uid))
  if (!snap.exists()) return null
  const d = snap.data() as any
  if (typeof d.json !== 'string') return null
  return { json: d.json, 마지막저장시간: typeof d.마지막저장시간 === 'number' ? d.마지막저장시간 : 0 }
}

export async function cloudSaveRaw(uid: string, json: string): Promise<void> {
  let 마지막저장시간 = 0
  try { 마지막저장시간 = JSON.parse(json).마지막저장시간 || 0 } catch {}
  await setDoc(doc(db, 'saves', uid), { json, 마지막저장시간, updated: Date.now() })
}
