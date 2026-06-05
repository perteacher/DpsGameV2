// 로그인 게이트 + 클라우드 세이브 동기화 + 단일 세션
// 동기화 판별 = '세이브 version(증가 카운터)' 기준. 데이터와 함께 다녀서 확실함.
// (세션ID는 다른 기기 로그인 감지=강제종료(kick) 전용)
import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, Platform, Modal } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, type User,
} from 'firebase/auth'
import { auth, cloudLoadRaw, cloudSaveRaw, claimSession, watchSave } from './firebase'

function newSession() { return Math.random().toString(36).slice(2) + Date.now().toString(36) }
function 최고강(j: string | null): string { try { return j ? String(JSON.parse(j).최고마린lv ?? '?') : '-' } catch { return '?' } }

export default function AuthBox({ 저장키, onAuth }: { 저장키: string; onAuth?: (loggedIn: boolean) => void }) {
  const [user, setUser] = useState<User | null>(null)
  const [초기로딩, set초기로딩] = useState(true)
  const [kicked, setKicked] = useState('')
  const [열림, set열림] = useState(false)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const [동기화중, set동기화중] = useState(false)

  const sessionRef = useRef('')
  const lastPushRef = useRef('')
  const myVerRef = useRef(0)              // 이 기기가 가진 데이터 버전
  const 읽기성공Ref = useRef(false)        // 클라우드 읽기 성공해야만 업로드 허용
  const unsubRef = useRef<null | (() => void)>(null)

  const verKey = 저장키 + '_ver'
  const sessKey = 저장키 + '_sess'

  useEffect(() => {
    const off = onAuthStateChanged(auth, u => {
      set초기로딩(false); setUser(u); onAuth?.(!!u)
      if (u) onLogin(u.uid)
      else if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    })
    return () => off()
  }, [])

  async function onLogin(uid: string) {
    setKicked(''); set동기화중(true); 읽기성공Ref.current = false
    let local: string | null = null, myVerStr: string | null = null
    let cloud: Awaited<ReturnType<typeof cloudLoadRaw>> = null
    try {
      local = await AsyncStorage.getItem(저장키)
      myVerStr = await AsyncStorage.getItem(verKey)
      cloud = await cloudLoadRaw(uid)
    } catch (e: any) {
      setMsg('❌ 클라우드 읽기 실패: ' + (e?.code || e?.message || e) + ' — 업로드 차단')
      set동기화중(false); return
    }
    읽기성공Ref.current = true
    const myVer = parseInt(myVerStr || '0', 10) || 0
    const cloudVer = cloud?.version || 0
    myVerRef.current = myVer
    const 진단 = `클라우드:${cloud ? `v${cloudVer}·최고${최고강(cloud.json)}강` : '없음'} / 로컬:v${myVer}·최고${최고강(local)}강`

    // 세션 점유(kick용) + 영속
    const sid = newSession(); sessionRef.current = sid
    try { await claimSession(uid, sid); await AsyncStorage.setItem(sessKey, sid) } catch {}

    if (cloud && cloudVer > myVer) {
      // 클라우드가 더 최신 버전 → 채택 + 즉시 새로고침
      try { await AsyncStorage.setItem(저장키, cloud.json); await AsyncStorage.setItem(verKey, String(cloudVer)) } catch {}
      lastPushRef.current = cloud.json; myVerRef.current = cloudVer
      setMsg('☁️ 클라우드 불러옴 — ' + 진단); set동기화중(false)
      if (Platform.OS === 'web') { (window as any).location.reload() }
      return
    }

    // 내 로컬이 최신(또는 동일/클라우드 없음) → 업로드 (버전 +1)
    if (local) {
      const newVer = Math.max(cloudVer, myVer) + 1
      try { await cloudSaveRaw(uid, local, newVer); await AsyncStorage.setItem(verKey, String(newVer)) } catch {}
      lastPushRef.current = local; myVerRef.current = newVer
      setMsg(`☁️ 업로드됨(v${newVer}) — ` + 진단)
    } else setMsg('로그인됨 — ' + 진단)
    set동기화중(false)

    // 실시간 감시 (다른 기기 로그인 = 세션 변경 → 종료)
    if (unsubRef.current) unsubRef.current()
    unsubRef.current = watchSave(uid, d => {
      if (!d) return
      if (d.session && d.session !== sessionRef.current) {
        setKicked('⚠️ 다른 기기에서 로그인되어 이 기기는 종료되었습니다.')
        if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
        signOut(auth)
      }
    })
  }

  // 2분마다 로컬 변경분 업로드
  useEffect(() => {
    if (!user) return
    const id = setInterval(() => 업로드(user.uid), 120000)
    return () => clearInterval(id)
  }, [user])

  async function 업로드(uid: string, 강제 = false) {
    if (!읽기성공Ref.current) { if (강제) setMsg('⚠️ 동기화 미완료 — 업로드 차단(데이터 보호)'); return }
    try {
      const local = await AsyncStorage.getItem(저장키)
      if (local && (강제 || local !== lastPushRef.current)) {
        const newVer = (myVerRef.current || 0) + 1
        await cloudSaveRaw(uid, local, newVer)
        await AsyncStorage.setItem(verKey, String(newVer))
        myVerRef.current = newVer; lastPushRef.current = local
        if (강제) setMsg(`☁️ 동기화 완료 v${newVer} ` + new Date().toLocaleTimeString())
      } else if (강제) setMsg('변경사항 없음')
    } catch (e: any) { if (강제) setMsg('업로드 오류: ' + (e?.message || e)) }
  }

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
      if (user && 읽기성공Ref.current) {
        const local = await AsyncStorage.getItem(저장키)
        if (local) { const v = (myVerRef.current || 0) + 1; await cloudSaveRaw(user.uid, local, v); await AsyncStorage.setItem(verKey, String(v)) }
      }
    } catch {}
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null }
    await signOut(auth); setPw(''); set열림(false)
  }

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

      {user && (
        <View>
          <TouchableOpacity onPress={() => set열림(v => !v)}
            style={{ paddingHorizontal: 8, paddingVertical: 2, backgroundColor: '#2a6a4a', borderRadius: 4 }}>
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>👤 {user.email?.split('@')[0] || '계정'}</Text>
          </TouchableOpacity>
          {열림 && (
            <View style={{ position: 'absolute', top: 28, right: 0, width: 240, backgroundColor: '#16213e', borderWidth: 2, borderColor: '#5a3a8a', borderRadius: 8, padding: 10, zIndex: 999, gap: 6 }}>
              <Text style={{ color: '#7ed957', fontSize: 12, fontWeight: 'bold' }}>☁️ {user.email}</Text>
              <Text style={{ color: '#aaa', fontSize: 10 }}>2분마다 자동 동기화 · 1기기만 접속</Text>
              <TouchableOpacity onPress={() => 업로드(user.uid, true)} style={btn('#3a5a8a')}><Text style={bt}>지금 동기화(업로드)</Text></TouchableOpacity>
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
