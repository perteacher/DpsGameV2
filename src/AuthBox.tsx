// 로그인 UI + 클라우드 세이브 동기화 (자급자족: 같은 저장키의 AsyncStorage를 직접 읽고/씀)
import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, type User,
} from 'firebase/auth'
import { auth, cloudLoadRaw, cloudSaveRaw } from './firebase'

function parse시간(json: string | null): number {
  if (!json) return 0
  try { return JSON.parse(json).마지막저장시간 || 0 } catch { return 0 }
}

export default function AuthBox({ 저장키 }: { 저장키: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [열림, set열림] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [동기화중, set동기화중] = useState(false)
  const lastPushRef = useRef<string>('')

  // 로그인 상태 추적
  useEffect(() => onAuthStateChanged(auth, u => { setUser(u); if (u) syncOnLogin(u.uid) }), [])

  // 로그인 직후 동기화: 클라우드가 더 최신이면 받아서 적용(리로드), 아니면 로컬 업로드
  async function syncOnLogin(uid: string) {
    try {
      set동기화중(true)
      const local = await AsyncStorage.getItem(저장키)
      const localT = parse시간(local)
      const cloud = await cloudLoadRaw(uid)
      if (cloud && cloud.마지막저장시간 > localT) {
        await AsyncStorage.setItem(저장키, cloud.json)
        lastPushRef.current = cloud.json
        setMsg('☁️ 클라우드 세이브 불러옴 — 새로고침')
        if (Platform.OS === 'web') setTimeout(() => (window as any).location.reload(), 600)
      } else if (local) {
        await cloudSaveRaw(uid, local)
        lastPushRef.current = local
        setMsg('☁️ 현재 진행도 업로드됨')
      } else {
        setMsg('로그인됨 (세이브 없음)')
      }
    } catch (e: any) {
      setMsg('동기화 오류: ' + (e?.message || e))
    } finally { set동기화중(false) }
  }

  // 주기적 업로드 (30초마다, 변경 시에만)
  useEffect(() => {
    if (!user) return
    const id = setInterval(async () => {
      try {
        const local = await AsyncStorage.getItem(저장키)
        if (local && local !== lastPushRef.current) {
          await cloudSaveRaw(user.uid, local)
          lastPushRef.current = local
        }
      } catch {}
    }, 30000)
    return () => clearInterval(id)
  }, [user])

  async function 로그인() {
    setMsg('')
    try { await signInWithEmailAndPassword(auth, email.trim(), pw) }
    catch (e: any) { setMsg('로그인 실패: ' + 에러한글(e?.code)) }
  }
  async function 회원가입() {
    setMsg('')
    if (pw.length < 6) { setMsg('비밀번호는 6자 이상'); return }
    try { await createUserWithEmailAndPassword(auth, email.trim(), pw) }
    catch (e: any) { setMsg('가입 실패: ' + 에러한글(e?.code)) }
  }
  async function 로그아웃() {
    try {
      const local = await AsyncStorage.getItem(저장키)
      if (user && local) await cloudSaveRaw(user.uid, local) // 나가기 전 마지막 업로드
    } catch {}
    await signOut(auth)
    setMsg('로그아웃됨'); setPw('')
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => set열림(v => !v)}
        style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: user ? '#2a6a4a' : '#5a3a8a', borderRadius: 4 }}
      >
        <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>
          {user ? '👤 ' + (user.email?.split('@')[0] || '계정') : '👤 로그인'}
        </Text>
      </TouchableOpacity>

      {열림 && (
        <View style={{
          position: 'absolute', top: 28, right: 0, width: 240, backgroundColor: '#16213e',
          borderWidth: 2, borderColor: '#5a3a8a', borderRadius: 8, padding: 10, zIndex: 999, gap: 6,
        }}>
          {user ? (
            <>
              <Text style={{ color: '#7ed957', fontSize: 12, fontWeight: 'bold' }}>☁️ {user.email}</Text>
              <Text style={{ color: '#aaa', fontSize: 10 }}>30초마다 자동 동기화 · 기기 간 공유</Text>
              <TouchableOpacity onPress={로그아웃} style={btn('#e94560')}><Text style={bt}>로그아웃</Text></TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>로그인 / 회원가입</Text>
              <TextInput
                value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor="#777"
                autoCapitalize="none" keyboardType="email-address"
                style={inp}
              />
              <TextInput
                value={pw} onChangeText={setPw} placeholder="비밀번호(6자+)" placeholderTextColor="#777"
                secureTextEntry style={inp}
              />
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <TouchableOpacity onPress={로그인} style={[btn('#3a5a8a'), { flex: 1 }]}><Text style={bt}>로그인</Text></TouchableOpacity>
                <TouchableOpacity onPress={회원가입} style={[btn('#3a7a5a'), { flex: 1 }]}><Text style={bt}>회원가입</Text></TouchableOpacity>
              </View>
            </>
          )}
          {(msg || 동기화중) ? <Text style={{ color: '#f5a623', fontSize: 10 }}>{동기화중 ? '동기화 중…' : msg}</Text> : null}
        </View>
      )}
    </View>
  )
}

const inp = { backgroundColor: '#0d1526', color: '#fff', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, borderWidth: 1, borderColor: '#3a5a8a' } as const
const bt = { color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' } as const
function btn(bg: string) { return { backgroundColor: bg, borderRadius: 4, paddingVertical: 7, paddingHorizontal: 8 } as const }

function 에러한글(code?: string): string {
  switch (code) {
    case 'auth/invalid-email': return '이메일 형식 오류'
    case 'auth/user-not-found': return '없는 계정'
    case 'auth/wrong-password': case 'auth/invalid-credential': return '비밀번호 틀림'
    case 'auth/email-already-in-use': return '이미 가입된 이메일'
    case 'auth/weak-password': return '비밀번호 너무 약함'
    case 'auth/too-many-requests': return '잠시 후 다시'
    default: return code || '오류'
  }
}
