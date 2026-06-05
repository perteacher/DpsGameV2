// 로그인 게이트 + 클라우드 세이브 동기화 + 단일 세션
// - 로그인해야만 플레이 가능 (전체화면 게이트)
// - 같은 계정 새 기기 로그인 시 기존 기기 강제 종료 (세션ID 실시간 감시)
// - 최신우선: 클라우드가 더 최신이면 받아서 새로고침 (오래된 기기가 덮어쓰기 방지)
import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Platform, Modal } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, type User,
} from 'firebase/auth'
import { auth, cloudLoadRaw, cloudSaveRaw, claimSession, watchSave } from './firebase'

function parse시간(json: string | null): number {
  if (!json) return 0
  try { return JSON.parse(json).마지막저장시간 || 0 } catch { return 0 }
}
function newSession() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }

export default function AuthBox({ 저장키 }: { 저장키: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [초기로딩, set초기로딩] = useState(true)
  const [kicked, setKicked] = useState('')
  const [열림, set열림] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [동기화중, set동기화중] = useState(false)

  const sessionRef = useRef('')
  const cloud마지막Ref = useRef(0)
  const cloudJsonRef = useRef<string | null>(null)
  const lastPushRef = useRef('')
  const unsubRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    const off = onAuthStateChanged(auth, u => {
      set초기로딩(false)
      setUser(u)
      if (u) onLogin(u.uid)
      else { if (unsubRef.current) { unsubRef.current(); unsubRef.current = null } }
    })
    return () => off()
  }, [])

  async function onLogin(uid: string) {
    setKicked('')
    await syncOnLogin(uid)
    // 단일 세션 등록 + 실시간 감시
    const sid = newSession(); sessionRef.current = sid
    try { await claimSession(uid, sid); await AsyncStorage.setItem(저장키 + '_sess', sid) } catch {}
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = watchSave(uid, d => {
      if (!d) return
      cloud마지막Ref.current = d.마지막저장시간 || 0
      cloudJsonRef.current = d.json || null
      if (d.session && d.session !== sessionRef.current) {
        // 다른 기기에서 로그인됨 → 이 기기 종료
        setKicked('⚠️ 다른 기기에서 로그인되어 이 기기는 종료되었습니다.')
        if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
        signOut(auth)
      }
    })
  }

  // 로그인 직후 동기화 — "세션 소유권" 기준 (시각 비교는 항상-최신 로컬 때문에 불가)
  async function syncOnLogin(uid: string) {
    try {
      set동기화중(true)
      const local = await AsyncStorage.getItem(저장키)
      const mySess = await AsyncStorage.getItem(저장키 + '_sess')  // 이 기기가 마지막에 점유한 세션
      const cloud = await cloudLoadRaw(uid)
      if (!cloud) {
        // 클라우드 없음(최초) → 로컬 업로드
        if (local) { await cloudSaveRaw(uid, local); lastPushRef.current = local; setMsg('☁️ 진행도 업로드됨') }
        else setMsg('로그인됨')
      } else if (cloud.session && mySess && cloud.session === mySess) {
        // 클라우드를 마지막에 쓴 게 '이 기기' → 로컬 유지(같은 기기 재접속)
        if (local && local !== cloud.json) { await cloudSaveRaw(uid, local); lastPushRef.current = local }
        else lastPushRef.current = cloud.json
        setMsg('☁️ 동기화됨')
      } else {
        // 다른 기기가 마지막 작성자 → 클라우드 받아오기(이게 핵심 수정)
        if (cloud.json !== local) {
          await AsyncStorage.setItem(저장키, cloud.json)
          lastPushRef.current = cloud.json
          setMsg('☁️ 다른 기기 세이브 불러옴 — 새로고침')
          if (Platform.OS === 'web') setTimeout(() => (window as any).location.reload(), 600)
        } else { lastPushRef.current = cloud.json; setMsg('☁️ 동기화됨') }
      }
    } catch (e: any) { setMsg('동기화 오류: ' + (e?.message || e)) }
    finally { set동기화중(false) }
  }

  // 30초마다: 클라우드가 더 최신이면 받아오고, 아니면 업로드
  useEffect(() => {
    if (!user) return
    const id = setInterval(async () => {
      try {
        const local = await AsyncStorage.getItem(저장키)
        const localT = parse시간(local)
        if (cloud마지막Ref.current > localT && cloudJsonRef.current) {
          // 다른 곳이 더 최신 → 받아서 새로고침 (덮어쓰기 방지)
          await AsyncStorage.setItem(저장키, cloudJsonRef.current)
          if (Platform.OS === 'web') (window as any).location.reload()
          return
        }
        if (local && local !== lastPushRef.current) {
          await cloudSaveRaw(user.uid, local); lastPushRef.current = local
        }
      } catch {}
    }, 30000)
    return () => clearInterval(id)
  }, [user])

  async function 로그인() {
    setMsg(''); setKicked('')
    try { await signInWithEmailAndPassword(auth, email.trim(), pw) }
    catch (e: any) { setMsg('로그인 실패: ' + 에러한글(e?.code)) }
  }
  async function 회원가입() {
    setMsg(''); setKicked('')
    if (pw.length < 6) { setMsg('비밀번호는 6자 이상'); return }
    try { await createUserWithEmailAndPassword(auth, email.trim(), pw) }
    catch (e: any) { setMsg('가입 실패: ' + 에러한글(e?.code)) }
  }
  async function 로그아웃() {
    try {
      const local = await AsyncStorage.getItem(저장키)
      if (user && local) await cloudSaveRaw(user.uid, local)
    } catch {}
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    await signOut(auth); setPw(''); set열림(false)
  }

  // 로그인 폼 (게이트 모달 + 로그아웃 안 한 상태 공용)
  const 로그인폼 = (
    <View style={{ gap: 8 }}>
      <TextInput value={email} onChangeText={setEmail} placeholder="이메일" placeholderTextColor="#777"
        autoCapitalize="none" keyboardType="email-address" style={inp} />
      <TextInput value={pw} onChangeText={setPw} placeholder="비밀번호 (6자 이상)" placeholderTextColor="#777"
        secureTextEntry style={inp} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={로그인} style={[btn('#3a5a8a'), { flex: 1 }]}><Text style={bt}>로그인</Text></TouchableOpacity>
        <TouchableOpacity onPress={회원가입} style={[btn('#3a7a5a'), { flex: 1 }]}><Text style={bt}>회원가입</Text></TouchableOpacity>
      </View>
      {kicked ? <Text style={{ color: '#ff6b6b', fontSize: 12 }}>{kicked}</Text> : null}
      {(msg || 동기화중) ? <Text style={{ color: '#f5a623', fontSize: 11 }}>{동기화중 ? '동기화 중…' : msg}</Text> : null}
    </View>
  )

  return (
    <>
      {/* 로그인 필수 게이트 (전체화면) */}
      <Modal visible={!user} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(10,12,22,0.96)', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <View style={{ width: 300, maxWidth: '100%', backgroundColor: '#16213e', borderWidth: 2, borderColor: '#5a3a8a', borderRadius: 12, padding: 18, gap: 10 }}>
            <Text style={{ color: '#e94560', fontSize: 18, fontWeight: 'bold', textAlign: 'center' }}>DPS 강화하기 ⚔️</Text>
            <Text style={{ color: '#aaa', fontSize: 12, textAlign: 'center' }}>
              {초기로딩 ? '로딩 중…' : '플레이하려면 로그인하세요'}
            </Text>
            {!초기로딩 && 로그인폼}
            <Text style={{ color: '#666', fontSize: 10, textAlign: 'center' }}>진행도는 계정에 저장되어 기기 간 공유됩니다</Text>
          </View>
        </View>
      </Modal>

      {/* 로그인 상태: 상단바 계정 버튼 */}
      {user && (
        <View>
          <TouchableOpacity onPress={() => set열림(v => !v)}
            style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#2a6a4a', borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>👤 {user.email?.split('@')[0] || '계정'}</Text>
          </TouchableOpacity>
          {열림 && (
            <View style={{ position: 'absolute', top: 28, right: 0, width: 230, backgroundColor: '#16213e', borderWidth: 2, borderColor: '#5a3a8a', borderRadius: 8, padding: 10, zIndex: 999, gap: 6 }}>
              <Text style={{ color: '#7ed957', fontSize: 12, fontWeight: 'bold' }}>☁️ {user.email}</Text>
              <Text style={{ color: '#aaa', fontSize: 10 }}>30초마다 자동 동기화 · 1기기만 접속</Text>
              <TouchableOpacity onPress={로그아웃} style={btn('#e94560')}><Text style={bt}>로그아웃</Text></TouchableOpacity>
              {(msg || 동기화중) ? <Text style={{ color: '#f5a623', fontSize: 10 }}>{동기화중 ? '동기화 중…' : msg}</Text> : null}
            </View>
          )}
        </View>
      )}
    </>
  )
}

const inp = { backgroundColor: '#0d1526', color: '#fff', borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, borderWidth: 1, borderColor: '#3a5a8a' } as const
const bt = { color: '#fff', fontSize: 13, fontWeight: 'bold', textAlign: 'center' } as const
function btn(bg: string) { return { backgroundColor: bg, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 8 } as const }

function 에러한글(code?: string): string {
  switch (code) {
    case 'auth/invalid-email': return '이메일 형식 오류'
    case 'auth/user-not-found': return '없는 계정'
    case 'auth/wrong-password': case 'auth/invalid-credential': return '비밀번호 틀림'
    case 'auth/email-already-in-use': return '이미 가입된 이메일'
    case 'auth/weak-password': return '비밀번호 너무 약함'
    case 'auth/too-many-requests': return '잠시 후 다시 시도'
    case 'auth/network-request-failed': return '네트워크 오류'
    default: return code || '오류'
  }
}
