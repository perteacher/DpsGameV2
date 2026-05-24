import { useEffect, useRef, useState } from 'react'
import { Dimensions, Image, ImageBackground, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'

const BG_LOBBY = require('../../assets/images/bg_lobby.png')
const BG_HUNTING = require('../../assets/images/bg_hunting.png')
const BG_BOSS = require('../../assets/images/bg_boss.png')
const BEACON_강화 = require('../../assets/images/beacon_enhance.png')
const BEACON_보스 = require('../../assets/images/beacon_boss.png')
const BEACON_사냥 = require('../../assets/images/beacon_hunt.png')
const BEACON_판매 = require('../../assets/images/beacon_sell.png')

// 웹: Dimensions.get가 0 리턴 가능 → window.innerWidth/Height 우선 사용
const _dim = Dimensions.get('window')
let _w = _dim.width
let _h = _dim.height
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  if (window.innerWidth > 0) _w = window.innerWidth
  if (window.innerHeight > 0) _h = window.innerHeight
}
const 화면W = _w > 0 ? _w : 400
const 화면H = _h > 0 ? _h : 800

const 저장키 = 'dps_game_save_v4'  // v4: 보주/크리스탈 시스템

// ============================================
// 유틸 함수
// ============================================

const 단위목록 = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극', '항', '아', '나', '불', '무']

function 숫자포맷(n: number): string {
  if (n < 10000) return Math.floor(n).toString()
  let i = 0
  let v = n
  while (v >= 10000 && i < 단위목록.length - 1) {
    v = v / 10000
    i++
  }
  return (v >= 1000 ? Math.floor(v).toString() : v.toFixed(1)) + 단위목록[i]
}

// 강화 기준확률 룩업테이블 (레벨별 원본 맵 실측값)
// 인덱스 = 현재 강 단계 (1~50)
const 강화확률표: number[] = [
  0,                                          // 0 (unused)
  0.600, 0.600, 0.575, 0.543,                // 1~4
  0.500, 0.500, 0.500, 0.500, 0.470,         // 5~9
  0.465, 0.463, 0.452, 0.450, 0.450,         // 10~14
  0.440, 0.440, 0.440, 0.430, 0.420,         // 15~19
  0.380, 0.380, 0.360, 0.360, 0.350,         // 20~24
  0.300, 0.250, 0.250, 0.250, 0.250,         // 25~29
  0.250, 0.250, 0.200, 0.200, 0.200,         // 30~34
  0.200, 0.160, 0.120, 0.100, 0.050,         // 35~39
  0, 0, 0, 0,                                // 40~43 (특수 구간 — 기본 0%)
  0.100, 0.070, 0.040, 0.010, 0.000,         // 44~48 (개별확률)
  0.005,                                      // 49 (고정)
  0,                                          // 50 (초월 시스템)
]

type 강화스텟 = {
  가산1강: number; 가산2강: number; 가산3강: number
  가산1강2: number; 가산2강2: number; 가산3강2: number
  특수강화: number; 특수강화2: number
  특수파괴방지: number; 특수파괴방지2: number
  가산44강: number; 가산45강: number; 가산46강: number; 가산47강: number; 가산48강: number
  돈수급량: number; 유닛공업: number
}

// 강화 시도 — 스텟 적용 버전
// 반환: 0=실패, 1=+1, 2=+2, 3=+3
// 외부p1: 보주/크리스탈/영구강화에서 오는 추가 성공확률 (0~1 소수)
// 보석p: 레벨별 보석 추가 확률
type 보석p타입 = { add44: number; add45: number; add46: number; add47: number; add48: number }
const 빈보석p: 보석p타입 = { add44: 0, add45: 0, add46: 0, add47: 0, add48: 0 }
function 강화시도(단계: number, 스텟: 강화스텟, 외부p1: number = 0, 보석p: 보석p타입 = 빈보석p): number {
  if (단계 >= 50) return 0  // 초월 시스템 별도
  const r = Math.random()
  const base = 강화확률표[단계] ?? 0

  // 49강: 고정 0.5% + 외부보너스
  if (단계 === 49) {
    return r < Math.min(0.95, base + 외부p1) ? 1 : 0
  }
  // 48강: 개별확률 0% → 스텟 보너스만
  if (단계 === 48) {
    const bonus = 스텟.가산48강 * 0.0005 + 외부p1 + 보석p.add48
    return r < Math.min(0.95, bonus) ? 1 : 0
  }
  // 44~47강: 개별확률 + 스텟 + 외부보너스 + 보석
  if (단계 >= 44 && 단계 <= 47) {
    const lvBonus = [스텟.가산44강, 스텟.가산45강, 스텟.가산46강, 스텟.가산47강][단계 - 44] * 0.001
    const 보석추가 = [보석p.add44, 보석p.add45, 보석p.add46, 보석p.add47][단계 - 44]
    return r < Math.min(0.95, base + lvBonus + 외부p1 + 보석추가) ? 1 : 0
  }
  // 40~43강: 특수 확률 (기본 0%, 스텟 보너스만 — 외부보너스 미적용)
  if (단계 >= 40 && 단계 <= 43) {
    const bonus = (스텟.특수강화 + 스텟.특수강화2) * 0.001
    return r < Math.min(0.95, bonus) ? 1 : 0
  }
  // 36~39강: +3=0 +2=0, +1 = base*1.11 + 스텟 + 외부보너스
  if (단계 >= 36 && 단계 <= 39) {
    const p1 = Math.min(0.95, base * 1.11 + (스텟.가산1강 + 스텟.가산1강2 + 스텟.가산2강 + 스텟.가산2강2 + 스텟.가산3강 + 스텟.가산3강2) * 0.001 + 외부p1)
    return r < p1 ? 1 : 0
  }
  // 35강: +3=0, +2에 +3 확률 흡수
  if (단계 === 35) {
    const p2 = Math.min(0.95, base / 10 + base / 100 + (스텟.가산2강 + 스텟.가산2강2 + 스텟.가산3강 + 스텟.가산3강2) * 0.001)
    const p1 = Math.min(0.95, base + (스텟.가산1강 + 스텟.가산1강2) * 0.001 + 외부p1)
    if (r < p2) return 2
    if (r < p2 + p1) return 1
    return 0
  }
  // 1~34강: 표준 (+3/+2/+1/실패)
  const p3 = Math.min(0.95, base / 100 + (스텟.가산3강 + 스텟.가산3강2) * 0.001)
  const p2 = Math.min(0.95, base / 10  + (스텟.가산2강 + 스텟.가산2강2) * 0.001)
  const p1 = Math.min(0.95, base       + (스텟.가산1강 + 스텟.가산1강2) * 0.001 + 외부p1)
  if (r < p3) return 3
  if (r < p3 + p2) return 2
  if (r < p3 + p2 + p1) return 1
  return 0
}

function 강화비용(단계: number) {
  return 30 + 단계 * 20
}

// 강화 실패 페널티 결과 (강도 높을수록 가혹)
// 파괴방지: 특수파괴방지 + 특수파괴방지2 합산 포인트 (포인트당 0.1% 파괴방지)
function 강화실패결과(lv: number, 파괴방지: number = 0): { 감소: number; 파괴: boolean } {
  const r = Math.random()
  const 방지율 = Math.min(0.95, 파괴방지 * 0.001)  // 포인트당 0.1%
  if (lv <= 5) return { 감소: 0, 파괴: false }                                // 안전
  if (lv <= 15) {                                                              // 30% -1
    if (r < 0.3) return { 감소: 1, 파괴: false }
    return { 감소: 0, 파괴: false }
  }
  if (lv <= 30) {                                                              // 50% -1, 20% -2
    if (r < 0.2) return { 감소: 2, 파괴: false }
    if (r < 0.7) return { 감소: 1, 파괴: false }
    return { 감소: 0, 파괴: false }
  }
  if (lv <= 45) {                                                              // 35% -2, 60% -1, 5%→(5%-방지율) 파괴
    const 파괴p = Math.max(0, 0.05 - 방지율)
    if (r < 파괴p) return { 감소: 0, 파괴: true }
    if (r < 0.4) return { 감소: 2, 파괴: false }
    return { 감소: 1, 파괴: false }
  }
  // 46+ 60% -3, 20% -2, 20%→(20%-방지율) 파괴
  const 파괴p2 = Math.max(0, 0.2 - 방지율)
  if (r < 파괴p2) return { 감소: 0, 파괴: true }
  if (r < 0.4) return { 감소: 2, 파괴: false }
  return { 감소: 3, 파괴: false }
}

// 마린 무기 공식: base=6, upg_bonus=18 (원본 맵 UNIx 데이터)
// 1강=6, 10강=168, 30강=528, 60강=1068
function 공격력(단계: number) {
  return 6 + (단계 - 1) * 18
}

function 공격속도(단계: number) {
  if (단계 < 10) return 1.0
  if (단계 < 20) return 1.5
  if (단계 < 30) return 2.0
  if (단계 < 40) return 2.5
  if (단계 < 50) return 3.0
  return 4.0
}

function 유닛DPS(단계: number) {
  return 공격력(단계) * 공격속도(단계)
}

// DPS 단계별 자원 배수
function 자원배수(총DPS: number): number {
  if (총DPS < 50) return 1
  if (총DPS < 500) return 2
  if (총DPS < 5000) return 4
  if (총DPS < 50000) return 8
  if (총DPS < 500000) return 16
  if (총DPS < 5000000) return 32
  if (총DPS < 50000000) return 64
  return 128
}

// 캐릭터 레벨 — 다음 레벨 필요 경험치
function 다음경험치(lv: number): number {
  return Math.round(100 * Math.pow(1.35, lv - 1))
}

const 생산강도목록 = [1, 7, 11, 15, 18, 20, 22, 24, 26, 28, 30, 32] as const
const 생산비용표: Record<number, number> = {
  1: 1500, 7: 40000, 11: 700000, 15: 8000000,
  18: 100000000, 20: 600000000, 22: 3500000000, 24: 20000000000,
  26: 100000000000, 28: 600000000000, 30: 3500000000000, 32: 20000000000000,
}
function 생산비용(강도: number): number {
  return 생산비용표[강도] ?? Number.MAX_SAFE_INTEGER
}

// 판매 보상 (원본 맵 기반: 41강+ 크리스탈조각 드랍)
function 판매보상(lv: number): { 무색조각: number; 응무조: number; 크리스탈조각: number } {
  if (lv <= 20) return { 무색조각: lv * lv * 3, 응무조: 0, 크리스탈조각: 0 }
  if (lv <= 40) return { 무색조각: lv * lv * 8, 응무조: Math.max(0, lv - 20), 크리스탈조각: 0 }
  if (lv <= 44) return { 무색조각: 0, 응무조: (lv - 40) * 30, 크리스탈조각: (lv - 40) * 3 }
  return { 무색조각: 0, 응무조: (lv - 44) * 50, 크리스탈조각: (lv - 44) * 10 }
}

// 사냥터 슬롯 (총 공격수 마일스톤)
const 슬롯마일스톤 = [
  { 필요공격수: 0, 슬롯수: 8 },
  { 필요공격수: 1000, 슬롯수: 12 },
  { 필요공격수: 10000, 슬롯수: 16 },
  { 필요공격수: 100000, 슬롯수: 20 },
  { 필요공격수: 1000000, 슬롯수: 24 },
  { 필요공격수: 10000000, 슬롯수: 32 },
  { 필요공격수: 100000000, 슬롯수: 40 },
  { 필요공격수: 1000000000, 슬롯수: 48 },
]

function 현재슬롯수(공격수: number) {
  let 슬롯 = 8
  for (const m of 슬롯마일스톤) if (공격수 >= m.필요공격수) 슬롯 = m.슬롯수
  return 슬롯
}

// ============================================
// 상수
// ============================================

// 웹은 데스크탑 큰 화면 대응, 모바일은 헤더 공간 확보
const _isWeb = Platform.OS === 'web'
const 필드_W = Math.min(_isWeb ? 460 : 380, 화면W - 16)
const 필드_H = _isWeb
  ? Math.max(380, Math.min(560, 화면H - 220))
  : Math.max(280, Math.min(440, 화면H - 400))
const 마린_크기 = 34
const 적_크기 = 42      // 일반 적 (보스/몹용 별도)
const 몹_크기 = 90       // 사냥터 몹 (크게)
const 보스_크기 = 110    // 보스 (가장 큼)
const 공격사거리 = 180
const 기본이동속도 = 160

// 베이스 화면: 4 꼭지점 배치 (중앙 = 마린 spawn)
const ZONE_W = Math.min(105, (필드_W - 30) / 2)
const ZONE_H = 70
const ZONE_강화 = { x: 10, y: 10, w: ZONE_W, h: ZONE_H, label: '🔨 강화소', color: '#f5a623' }
const ZONE_보스존입구 = { x: 필드_W - ZONE_W - 10, y: 10, w: ZONE_W, h: ZONE_H, label: '⚔️ 보스존', color: '#e94560' }
const ZONE_사냥터입구 = { x: 10, y: 필드_H - ZONE_H - 10, w: ZONE_W, h: ZONE_H, label: '🐺 사냥터', color: '#9b59b6' }
const ZONE_판매소 = { x: 필드_W - ZONE_W - 10, y: 필드_H - ZONE_H - 10, w: ZONE_W, h: ZONE_H, label: '🛒 판매소', color: '#f1c40f' }
// 서브 화면 베이스 복귀 (아래쪽)
const ZONE_베이스입구 = { x: 필드_W / 2 - 50, y: 필드_H - 60, w: 100, h: 50, label: '🏠 베이스', color: '#7ed957' }

const 강화쿨다운 = 800  // 0.8초마다 자동 강화 시도

// ============================================
// 타입
// ============================================

type Pos = { x: number; y: number }
type 유닛상태 = 'idle' | 'move' | 'attack-move' | 'hold' | 'attacking'
type 화면 = 'base' | 'hunting' | 'boss'
type 유닛위치 = 'base' | 'hunting' | 'boss'

type 마린 = {
  id: number
  lv: number
  pos: Pos
  dest: Pos | null
  state: 유닛상태
  타겟적id: number | null
  마지막공격시간: number
  공격플래시Until: number
  마지막강화시간: number
  location: 유닛위치
}

type 몹 = {
  id: number
  pos: Pos
  hp: number
  maxHp: number
  flashUntil: number
  deadUntil: number  // > now면 죽은 상태
}

type 적 = {
  id: number
  pos: Pos
  hp: number
  maxHp: number
  flashUntil: number
}

type 구역 = { x: number; y: number; w: number; h: number; label: string; color: string }

// 보주 (원본 맵 12종 — 보스 처치 시 드랍, 3슬롯 장착)
type 보주타입 = '신위' | '절명' | '풍요' | '영겁' | '명운' | '성운' | '천운' | '무위' | '풍성' | '인연' | '폭식' | '공명'
type 보주 = { id: number; 종류: 보주타입; 등급: number }  // 등급 1-5
const 보주종류목록: 보주타입[] = ['신위', '절명', '풍요', '영겁', '명운', '성운', '천운', '무위', '풍성', '인연', '폭식', '공명']

// 명칭 크리스탈 (누적 수집형, 패시브 보너스)
type 명칭크리스탈목록 = {
  // 노말 (cost 50 크리스탈조각)
  방어: number; 행운: number; 경험: number; 무력: number
  절약: number; 총명: number; 보호: number; 각성: number
  // 레어 (cost 100)
  홍색: number; 주황: number; 노랑: number; 초록: number
  파랑: number; 남색: number; 보라: number; 하늘색: number; 무색명칭: number
  // 유니크 (cost 500)
  흑색: number; 백색명칭: number
  // 갤럭시 (cost 2000)
  우주: number
  // 퀘이사 (cost 200)
  길운Q: number; 무구Q: number; 집중Q: number; 절제Q: number
  탐욕Q: number; 증식Q: number; 미래Q: number; 돌파Q: number
  // 오리진 (cost 1000)
  창조O: number; 파멸O: number
}
const 초기명칭크리스탈: 명칭크리스탈목록 = {
  방어: 0, 행운: 0, 경험: 0, 무력: 0, 절약: 0, 총명: 0, 보호: 0, 각성: 0,
  홍색: 0, 주황: 0, 노랑: 0, 초록: 0, 파랑: 0, 남색: 0, 보라: 0, 하늘색: 0, 무색명칭: 0,
  흑색: 0, 백색명칭: 0, 우주: 0,
  길운Q: 0, 무구Q: 0, 집중Q: 0, 절제Q: 0, 탐욕Q: 0, 증식Q: 0, 미래Q: 0, 돌파Q: 0,
  창조O: 0, 파멸O: 0,
}

// 보석 시스템 (12종, 무색조각으로 구입)
type 보석타입 = '하급' | '중급' | '상급' | '특급' | '고급' | '재물' | '경험보석' | '보호보석' | '궁극' | '수호' | '초월보석' | '인내'
type 보석목록 = { [K in 보석타입]: number }
const 초기보석: 보석목록 = { 하급: 0, 중급: 0, 상급: 0, 특급: 0, 고급: 0, 재물: 0, 경험보석: 0, 보호보석: 0, 궁극: 0, 수호: 0, 초월보석: 0, 인내: 0 }

const 보석구입비용: Record<보석타입, number> = {
  하급: 100, 중급: 300, 상급: 500, 특급: 1000, 고급: 2000,
  재물: 200, 경험보석: 200, 보호보석: 500, 궁극: 1000, 수호: 500, 초월보석: 1000, 인내: 2000,
}

function 보석보너스합산(b: 보석목록) {
  // 강화확률 추가 (decimal, 0~1)
  const add44 = b.하급 * 0.001 + b.궁극 * 0.0001 + b.초월보석 * 0.0001
  const add45 = b.중급 * 0.001 + b.궁극 * 0.0001 + b.초월보석 * 0.0001
  const add46 = b.상급 * 0.001 + b.궁극 * 0.0001 + b.초월보석 * 0.0001
  const add47 = b.특급 * 0.001 + b.궁극 * 0.0001 + b.초월보석 * 0.0001
  const add48 = b.고급 * 0.0005 + b.초월보석 * 0.0001
  // 파괴방지 (points, 10 points = 1%)
  const 파괴방지 = b.보호보석 * 1 + b.수호 * 0.1
  // 자원/경험/초월 배수
  const 자원배수추가 = b.재물 * 0.1
  const 경험배수 = 1 + b.경험보석 * 0.1
  const 초월확률추가 = b.인내 * 0.00001  // 0.001% per gem
  return { add44, add45, add46, add47, add48, 파괴방지, 자원배수추가, 경험배수, 초월확률추가 }
}

// 고유유닛 업그레이드 스텟
type 고유유닛스텟 = {
  공격력: number   // 0~20, 강화당 공격력 +500
  공속: number     // 0~6, 공격속도 단계
  경험치: number   // 0~5, 강화당 경험치 +20%
  추가1강: number  // 0~20, 강화당 +1강 확률 +0.25%
  특수강화: number // 0~10, 강화당 특수강화 확률 +0.5%
  위치2: boolean   // false=사냥터1, true=사냥터2
  파괴방지: number // 0~200, 강화당 파괴방지 +0.1%
}
const 초기고유유닛: 고유유닛스텟 = { 공격력: 0, 공속: 0, 경험치: 0, 추가1강: 0, 특수강화: 0, 위치2: false, 파괴방지: 0 }

function 고유유닛공격력(스텟: 고유유닛스텟) { return 500 + 스텟.공격력 * 500 }
function 고유유닛공속(스텟: 고유유닛스텟): number {
  const tbl = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
  return tbl[Math.min(스텟.공속, 6)]
}
function 고유유닛DPS(스텟: 고유유닛스텟) { return 고유유닛공격력(스텟) * 고유유닛공속(스텟) }

// ============================================
// 유틸
// ============================================

function 거리(a: Pos, b: Pos) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function 이동좌표(현재: Pos, 목적: Pos, 거리량: number): Pos {
  const d = 거리(현재, 목적)
  if (d <= 거리량) return 목적
  const t = 거리량 / d
  return { x: 현재.x + (목적.x - 현재.x) * t, y: 현재.y + (목적.y - 현재.y) * t }
}

function 점이사각형안에(점: Pos, x1: number, y1: number, x2: number, y2: number) {
  return 점.x >= x1 && 점.x <= x2 && 점.y >= y1 && 점.y <= y2
}

function 점이구역안에(점: Pos, z: 구역) {
  return 점.x >= z.x && 점.x <= z.x + z.w && 점.y >= z.y && 점.y <= z.y + z.h
}

let 다음마린ID = 0
function 새마린ID() { return 다음마린ID++ }

function 새마린(lv: number, pos: Pos, location: 'base' | 'hunting' = 'base'): 마린 {
  return {
    id: 새마린ID(),
    lv,
    pos,
    dest: null,
    state: 'idle',
    타겟적id: null,
    마지막공격시간: 0,
    공격플래시Until: 0,
    마지막강화시간: 0,
    location,
  }
}

function 베이스시작위치(i: number): Pos {
  // 4 꼭지점 사이 중앙 영역에 마린 packing (zone과 안 겹침)
  const cx = 필드_W / 2
  const cy = 필드_H / 2
  const cols = 6
  const xStep = 26
  const yStep = 22
  const maxRows = 6
  const col = i % cols
  const row = Math.floor(i / cols) % maxRows
  const xStart = cx - (cols - 1) * xStep / 2
  const yStart = cy - (maxRows - 1) * yStep / 2
  return clampPosStatic({ x: xStart + col * xStep, y: yStart + row * yStep })
}

// static clamp (필드 경계 내)
function clampPosStatic(p: Pos): Pos {
  const r = 마린_크기 / 2 + 2
  return {
    x: Math.max(r, Math.min(필드_W - r, p.x)),
    y: Math.max(r, Math.min(필드_H - r, p.y)),
  }
}

function 사냥터시작위치(i: number): Pos {
  const cols = 12
  const row = Math.floor(i / cols)
  // 적/보스(위)와 베이스 비콘(아래) 사이 중간 영역
  const yBase = 필드_H - 90
  return { x: 25 + (i % cols) * 30, y: yBase - row * 22 }
}

function 초기마린들(): 마린[] {
  다음마린ID = 0
  return Array.from({ length: 8 }, (_, i) => 새마린(1, 베이스시작위치(i)))
}

function 보스HP(보스번호: number): number {
  return Math.round(300 * Math.pow(2.5, 보스번호 - 1))
}

function 보스DPS게이트(보스번호: number): number {
  return Math.round(보스HP(보스번호) / 60)
}


// 마린 색상 (lv tier별)
function 마린색(lv: number): string {
  if (lv <= 10) return '#7ed957'
  if (lv <= 20) return '#f5a623'
  if (lv <= 30) return '#4a90e2'
  if (lv <= 40) return '#9b59b6'
  if (lv <= 50) return '#f1c40f'
  return '#e94560'
}


// 유닛 sprite sheet 좌표 (1~60 lv → 시트 row/col)
// 신규 lv = (타입-1)*6 + 컬러. 타입 1~10, 컬러 1~6
// 시트: row = 컬러(1~6), col = 타입(1~10)
function 유닛스프라이트(lv: number): { row: number; col: number } {
  const type = Math.floor((lv - 1) / 6) + 1  // 1~10 (시트 column)
  const color = ((lv - 1) % 6) + 1            // 1~6 (시트 row)
  return { row: color - 1, col: type - 1 }
}

// 보주 효과표 (등급당 보너스 — 원본 맵 12보주 기반)
const 보주효과표: Record<보주타입, { 타입: string; 값: number; 설명: string }> = {
  신위: { 타입: '공격', 값: 0.08, 설명: '공격력 +8%' },
  절명: { 타입: '크리', 값: 0.03, 설명: '크리 +3%p' },
  풍요: { 타입: '자원', 값: 0.10, 설명: '자원 +10%' },
  영겁: { 타입: '공속', 값: 0.05, 설명: '공속 +5%' },
  명운: { 타입: '판매', 값: 0.12, 설명: '판매보상 +12%' },
  성운: { 타입: '무색', 값: 0.08, 설명: '무색조각 +8%' },
  천운: { 타입: '이속', 값: 0.06, 설명: '이속 +6%' },
  무위: { 타입: '강화', 값: 0.015, 설명: '강화확률 +1.5%p' },
  풍성: { 타입: '배수', 값: 0.05, 설명: 'DPS배수 +5%' },
  인연: { 타입: '자원', 값: 0.08, 설명: '자원 +8%' },
  폭식: { 타입: '공격', 값: 0.05, 설명: '공격력 +5%' },
  공명: { 타입: '조각', 값: 0.08, 설명: '크리스탈조각 +8%' },
}

function 보주합산(장착ids: number[], 인벤: 보주[], 타입: string): number {
  let total = 0
  for (const id of 장착ids) {
    const g = 인벤.find(b => b.id === id)
    if (g) {
      const eff = 보주효과표[g.종류]
      if (eff.타입 === 타입) total += g.등급 * eff.값
    }
  }
  return total
}

function 보주판매가(등급: number): number {
  return [0, 500, 2000, 8000, 25000, 100000][등급] ?? 500
}

// 명칭 크리스탈 패시브 보너스 합산
function 명칭크리스탈보너스(m: 명칭크리스탈목록) {
  const 개별확률 = (m.행운 + m.홍색 + m.보라) * 0.01 + m.백색명칭 * 0.02 + m.우주 * 0.05
  const 파괴방지 = (m.보호 + m.노랑 + m.남색) * 2 + (m.흑색 + m.백색명칭) * 3 + m.우주 * 5
  const 초월확률 = m.무색명칭 * 2 + m.흑색 * 5 + m.우주 * 10
  const 무색배수 = (m.총명 + m.주황 + m.하늘색) * 0.5 + m.흑색 * 1.0 + m.우주 * 2.0
  const 판매배수 = (m.절약 + m.주황 + m.보라) * 0.05 + m.흑색 * 0.10 + m.우주 * 1.00
  return { 개별확률, 파괴방지, 초월확률, 무색배수, 판매배수 }
}

function 초기적들(보스번호: number = 1): 적[] {
  const hp = 보스HP(보스번호)
  return [{ id: 0, pos: { x: 필드_W / 2, y: 필드_H * 0.45 }, hp, maxHp: hp, flashUntil: 0 }]
}

function 초기몹들(): 몹[] {
  // 사냥터 1마리 (큰 몹, 가운데 위)
  return [{
    id: 0,
    pos: { x: 필드_W / 2, y: 130 },
    hp: 99999, maxHp: 99999, flashUntil: 0, deadUntil: 0,
  }]
}

// ============================================
// 메인 앱
// ============================================

export default function App() {
  const [현재화면, set현재화면] = useState<화면>('base')
  const [마린들, set마린들] = useState<마린[]>(() => 초기마린들())
  const [적들, set적들] = useState<적[]>(() => 초기적들(1))
  const [몹들, set몹들] = useState<몹[]>(() => 초기몹들())
  const [mineral, setMineral] = useState(100)
  const [총공격수, set총공격수] = useState(0)
  const [보스처치수, set보스처치수] = useState(0)
  const [최고DPS, set최고DPS] = useState(0)
  // 통화
  const [무색조각, set무색조각] = useState(0)
  const [응무조, set응무조] = useState(0)
  const [크리스탈조각, set크리스탈조각] = useState(0)
  // 보주 (보스 드랍, 3슬롯 장착)
  const [보주목록, set보주목록] = useState<보주[]>([])
  const [장착보주, set장착보주] = useState<number[]>([])
  // 캐릭터 레벨
  const [캐릭레벨, set캐릭레벨] = useState(1)
  const [경험치, set경험치] = useState(0)
  const [잔여포인트, set잔여포인트] = useState(0)
  const [일반스텟, set일반스텟] = useState<강화스텟>({
    돈수급량: 0, 유닛공업: 0,
    가산1강: 0, 가산2강: 0, 가산3강: 0,
    특수강화: 0, 가산1강2: 0, 가산2강2: 0, 가산3강2: 0,
    특수강화2: 0, 특수파괴방지: 0, 특수파괴방지2: 0,
    가산44강: 0, 가산45강: 0, 가산46강: 0, 가산47강: 0, 가산48강: 0,
  })
  const [초월스텟, set초월스텟] = useState({ 추가초월확률: 0 })
  const [스텟탭, set스텟탭] = useState<'일반' | '초월'>('일반')
  const [명칭크리스탈, set명칭크리스탈] = useState<명칭크리스탈목록>(() => ({ ...초기명칭크리스탈 }))
  const [명칭크리스탈패널열림, set명칭크리스탈패널열림] = useState(false)
  const [명칭크리스탈탭, set명칭크리스탈탭] = useState<'노말' | '레어' | '유니크' | '갤럭시' | '퀘이사' | '오리진'>('노말')
  // 크레딧 (보스 처치 보상, 고유유닛 강화에 사용)
  const [크레딧, set크레딧] = useState(0)
  // 보석
  const [보석, set보석] = useState<보석목록>(() => ({ ...초기보석 }))
  const [보석패널열림, set보석패널열림] = useState(false)
  // 고유유닛
  const [고유유닛, set고유유닛] = useState<고유유닛스텟>(() => ({ ...초기고유유닛 }))
  const [고유유닛패널열림, set고유유닛패널열림] = useState(false)
  const [고유유닛pos, set고유유닛pos] = useState<Pos>({ x: 필드_W * 0.4, y: 200 })
  const [고유유닛선택, set고유유닛선택] = useState(false)
  // 초월레벨
  const [초월레벨, set초월레벨] = useState(0)
  const [초월잔여포인트, set초월잔여포인트] = useState(0)
  // 영구강화 (무색조각/응무조 사용)
  const [업그레이드, set업그레이드] = useState({ 공격력: 0, 자원: 0, 강화확률: 0, 이속: 0, 공속: 0 })
  // 패널
  const [보주패널열림, set보주패널열림] = useState(false)
  const [강화패널열림, set강화패널열림] = useState(false)
  // 통계
  const [누적강화성공, set누적강화성공] = useState(0)
  const [누적판매, set누적판매] = useState(0)
  const [최고마린lv, set최고마린lv] = useState(1)
  // 자동화
  const [자동강화ON, set자동강화ON] = useState(false)
  const [자동강화최대lv, set자동강화최대lv] = useState(1)
  const [자동판매ON, set자동판매ON] = useState(false)
  const [자동판매lv, set자동판매lv] = useState(50)
  const [자동구입강도, set자동구입강도] = useState(1)
  const [자동구입ON, set자동구입ON] = useState(false)
  const [자동응축ON, set자동응축ON] = useState(false)
  const [자동패널열림, set자동패널열림] = useState(false)
  const [선택ID, set선택ID] = useState<number[]>([])
  const [드래그박스, set드래그박스] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [생산패널열림, set생산패널열림] = useState(false)
  const [메시지, set메시지] = useState('')
  const [로드완료, set로드완료] = useState(false)

  // refs (게임 루프 stale closure 방지)
  const 마린들Ref = useRef(마린들); 마린들Ref.current = 마린들
  const 적들Ref = useRef(적들); 적들Ref.current = 적들
  const 몹들Ref = useRef(몹들); 몹들Ref.current = 몹들
  const mineralRef = useRef(mineral); mineralRef.current = mineral
  const 총공격수Ref = useRef(총공격수); 총공격수Ref.current = 총공격수
  const 보스처치수Ref = useRef(보스처치수); 보스처치수Ref.current = 보스처치수
  const 보스킬쿨다운Ref = useRef(0)
  const 최고DPSRef = useRef(최고DPS); 최고DPSRef.current = 최고DPS
  const 장착보주Ref = useRef(장착보주); 장착보주Ref.current = 장착보주
  const 보주목록Ref = useRef(보주목록); 보주목록Ref.current = 보주목록
  const 무색조각Ref = useRef(무색조각); 무색조각Ref.current = 무색조각
  const 응무조Ref = useRef(응무조); 응무조Ref.current = 응무조
  const 크리스탈조각Ref = useRef(크리스탈조각); 크리스탈조각Ref.current = 크리스탈조각
  const 캐릭레벨Ref = useRef(캐릭레벨); 캐릭레벨Ref.current = 캐릭레벨
  const 경험치Ref = useRef(경험치); 경험치Ref.current = 경험치
  const 잔여포인트Ref = useRef(잔여포인트); 잔여포인트Ref.current = 잔여포인트
  const 일반스텟Ref = useRef(일반스텟); 일반스텟Ref.current = 일반스텟
  const 초월스텟Ref = useRef(초월스텟); 초월스텟Ref.current = 초월스텟
  const 명칭크리스탈Ref = useRef(명칭크리스탈); 명칭크리스탈Ref.current = 명칭크리스탈
  const 크레딧Ref = useRef(크레딧); 크레딧Ref.current = 크레딧
  const 보석Ref = useRef(보석); 보석Ref.current = 보석
  const 고유유닛Ref = useRef(고유유닛); 고유유닛Ref.current = 고유유닛
  const 고유유닛posRef = useRef(고유유닛pos); 고유유닛posRef.current = 고유유닛pos
  const 고유유닛선택Ref = useRef(고유유닛선택); 고유유닛선택Ref.current = 고유유닛선택
  const 초월레벨Ref = useRef(초월레벨); 초월레벨Ref.current = 초월레벨
  const 초월잔여포인트Ref = useRef(초월잔여포인트); 초월잔여포인트Ref.current = 초월잔여포인트
  const 업그레이드Ref = useRef(업그레이드); 업그레이드Ref.current = 업그레이드
  const 자동강화ONRef = useRef(자동강화ON); 자동강화ONRef.current = 자동강화ON
  const 자동강화최대lvRef = useRef(자동강화최대lv); 자동강화최대lvRef.current = 자동강화최대lv
  const 자동판매ONRef = useRef(자동판매ON); 자동판매ONRef.current = 자동판매ON
  const 자동판매lvRef = useRef(자동판매lv); 자동판매lvRef.current = 자동판매lv
  const 자동구입ONRef = useRef(자동구입ON); 자동구입ONRef.current = 자동구입ON
  const 자동응축ONRef = useRef(자동응축ON); 자동응축ONRef.current = 자동응축ON
  type Dmg플로팅 = { id: number; x: number; y: number; dmg: number; crit: boolean; until: number }
  const [dmg플로팅들, setDmg플로팅들] = useState<Dmg플로팅[]>([])
  const dmgIdRef = useRef(0)
  const 자동구입강도Ref = useRef(자동구입강도); 자동구입강도Ref.current = 자동구입강도
  const 자동구입타이머Ref = useRef(0)
  const 보석연속타이머Ref = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastTapRef = useRef<{ id: number; time: number } | null>(null)
  const 선택IDRef = useRef(선택ID); 선택IDRef.current = 선택ID
  const 현재화면Ref = useRef(현재화면); 현재화면Ref.current = 현재화면
  const 생산패널열림Ref = useRef(생산패널열림); 생산패널열림Ref.current = 생산패널열림
  const 메시지타이머Ref = useRef(0)
  const dragStartRef = useRef<Pos | null>(null)
  const 터치이동중Ref = useRef(false)
  const fieldRef = useRef<any>(null)

  const 베이스마린들 = 마린들.filter(m => m.location === 'base')
  const 사냥터마린들 = 마린들.filter(m => m.location === 'hunting')
  const 보스존마린들 = 마린들.filter(m => m.location === 'boss')
  const 화면마린들 = 현재화면 === 'hunting' ? 사냥터마린들 : 현재화면 === 'boss' ? 보스존마린들 : 베이스마린들
  // 보주 효과 합산 (렌더 시점)
  const _보주공격r = 보주합산(장착보주, 보주목록, '공격')
  const _보주크리r = 보주합산(장착보주, 보주목록, '크리')
  const _보주공속r = 보주합산(장착보주, 보주목록, '공속')
  const _보주자원r = 보주합산(장착보주, 보주목록, '자원')
  const _보주배수r = 보주합산(장착보주, 보주목록, '배수')
  const _공격력배수r = (1 + _보주공격r + 업그레이드.공격력 * 0.03)
  const _공속배수r = 1 + _보주공속r + 업그레이드.공속 * 0.02
  const _크리r = Math.min(0.95, _보주크리r)
  const 사냥터캡 = 8 + 보스처치수 * 4
  const 보스존캡 = 8
  const 사냥터DPS = 보스존마린들.filter(m => m.state === 'attacking').reduce((s, m) => s + 공격력(m.lv) * _공격력배수r * 공격속도(m.lv) * _공속배수r * (1 + _크리r), 0)
  const 현재배수 = 자원배수(Math.max(사냥터DPS, 최고DPS)) * (1 + _보주배수r)
  const 사냥터마린DPS = 사냥터마린들.reduce((s, m) => s + 공격력(m.lv) * _공격력배수r * 공격속도(m.lv) * _공속배수r * (1 + _크리r), 0)
  const 시간당미네랄 = 사냥터마린DPS * 현재배수 * (1 + _보주자원r) * 3600
  const 선택한마린들 = 마린들.filter(m => 선택ID.includes(m.id)).sort((a, b) => b.lv - a.lv)

  // 메시지 자동 숨김
  function 메시지표시(msg: string) {
    set메시지(msg)
    메시지타이머Ref.current = Date.now()
  }

  // 저장 로드
  useEffect(() => {
    AsyncStorage.getItem(저장키).then(json => {
      if (json) {
        try {
          const d = JSON.parse(json)
          if (d.마린들 && Array.isArray(d.마린들)) {
            const restored = d.마린들.map((m: any) => ({
              ...새마린(m.lv || 1, m.pos || 베이스시작위치(0)),
              id: m.id,
              lv: m.lv || 1,
              pos: m.pos || 베이스시작위치(0),
              location: m.location || 'base',
            }))
            다음마린ID = Math.max(...restored.map((m: 마린) => m.id), 0) + 1
            set마린들(restored)
          }
          if (typeof d.mineral === 'number') setMineral(d.mineral)
          if (typeof d.총공격수 === 'number') set총공격수(d.총공격수)
          if (typeof d.보스처치수 === 'number') {
            set보스처치수(d.보스처치수)
            set적들(초기적들(d.보스처치수 + 1))
          }
          if (typeof d.최고DPS === 'number') set최고DPS(d.최고DPS)
          if (typeof d.무색조각 === 'number') set무색조각(d.무색조각)
          if (typeof d.응무조 === 'number') set응무조(d.응무조)
          if (typeof d.크리스탈조각 === 'number') set크리스탈조각(d.크리스탈조각)
          if (Array.isArray(d.보주목록)) set보주목록(d.보주목록)
          if (Array.isArray(d.장착보주)) set장착보주(d.장착보주)
          if (typeof d.누적강화성공 === 'number') set누적강화성공(d.누적강화성공)
          if (typeof d.누적판매 === 'number') set누적판매(d.누적판매)
          if (typeof d.최고마린lv === 'number') set최고마린lv(d.최고마린lv)
          if (typeof d.자동강화ON === 'boolean') set자동강화ON(d.자동강화ON)
          if (typeof d.자동강화최대lv === 'number') set자동강화최대lv(d.자동강화최대lv)
          if (typeof d.자동판매ON === 'boolean') set자동판매ON(d.자동판매ON)
          if (typeof d.자동판매lv === 'number') set자동판매lv(d.자동판매lv)
          if (typeof d.자동구입강도 === 'number') set자동구입강도(d.자동구입강도)
          if (typeof d.자동구입ON === 'boolean') set자동구입ON(d.자동구입ON)
          if (typeof d.자동응축ON === 'boolean') set자동응축ON(d.자동응축ON)
          if (d.업그레이드 && typeof d.업그레이드 === 'object') set업그레이드(prev => ({ ...prev, ...d.업그레이드}))
          if (typeof d.캐릭레벨 === 'number') set캐릭레벨(d.캐릭레벨)
          if (typeof d.경험치 === 'number') set경험치(d.경험치)
          if (typeof d.잔여포인트 === 'number') set잔여포인트(d.잔여포인트)
          if (d.일반스텟 && typeof d.일반스텟 === 'object') set일반스텟(prev => ({ ...prev, ...d.일반스텟 }))
          if (d.초월스텟 && typeof d.초월스텟 === 'object') set초월스텟(prev => ({ ...prev, ...d.초월스텟 }))
          if (d.명칭크리스탈 && typeof d.명칭크리스탈 === 'object') set명칭크리스탈(prev => ({ ...prev, ...d.명칭크리스탈 }))
          if (typeof d.크레딧 === 'number') set크레딧(d.크레딧)
          if (d.보석 && typeof d.보석 === 'object') set보석(prev => ({ ...prev, ...d.보석 }))
          if (d.고유유닛 && typeof d.고유유닛 === 'object') set고유유닛(prev => ({ ...prev, ...d.고유유닛 }))
          if (typeof d.초월레벨 === 'number') set초월레벨(d.초월레벨)
          if (typeof d.초월잔여포인트 === 'number') set초월잔여포인트(d.초월잔여포인트)
          // 오프라인 보상
          if (typeof d.마지막저장시간 === 'number' && d.마지막저장시간 > 0) {
            const 경과초 = Math.min(8 * 3600, (Date.now() - d.마지막저장시간) / 1000)
            if (경과초 > 60 && d.마린들) {
              const huntingMs = d.마린들.filter((m: any) => m.location === 'hunting')
              const dps = huntingMs.reduce((s: number, m: any) => s + 유닛DPS(m.lv || 1), 0)
              if (dps > 0) {
                const 보상 = Math.floor(dps * 자원배수(d.최고DPS || 0) * 경과초 * 0.5)
                if (보상 > 0) {
                  setMineral(prev => prev + 보상)
                  메시지표시(`🌙 오프라인 ${Math.floor(경과초 / 60)}분 → 💎 ${숫자포맷(보상)}`)
                }
              }
            }
          }
        } catch {}
      }
      set로드완료(true)
    })
  }, [])

  // 자동 저장
  useEffect(() => {
    if (!로드완료) return
    const minimal마린들 = 마린들.map(m => ({ id: m.id, lv: m.lv, pos: m.pos, location: m.location }))
    AsyncStorage.setItem(저장키, JSON.stringify({
      마린들: minimal마린들, mineral, 총공격수, 보스처치수, 최고DPS,
      무색조각, 응무조, 크리스탈조각,
      보주목록, 장착보주,
      업그레이드,
      캐릭레벨, 경험치, 잔여포인트,
      일반스텟, 초월스텟, 명칭크리스탈,
      크레딧, 보석, 고유유닛, 초월레벨, 초월잔여포인트,
      누적강화성공, 누적판매, 최고마린lv,
      자동강화ON, 자동강화최대lv, 자동판매ON, 자동판매lv, 자동구입강도, 자동구입ON, 자동응축ON,
      마지막저장시간: Date.now(),
    }))
  }, [마린들, mineral, 총공격수, 보스처치수, 최고DPS,
      무색조각, 응무조, 크리스탈조각,
      보주목록, 장착보주,
      업그레이드,
      캐릭레벨, 경험치, 잔여포인트,
      일반스텟, 초월스텟, 명칭크리스탈,
      크레딧, 보석, 고유유닛, 초월레벨, 초월잔여포인트,
      누적강화성공, 누적판매, 최고마린lv,
      자동강화ON, 자동강화최대lv, 자동판매ON, 자동판매lv, 자동구입강도, 자동구입ON, 자동응축ON, 로드완료])

  // ============================================
  // 게임 루프
  // ============================================
  useEffect(() => {
    let lastTick = Date.now()
    const tick = () => {
      const now = Date.now()
      const dt = Math.min(0.1, (now - lastTick) / 1000)
      lastTick = now

      // 만료된 floating 제거
      setDmg플로팅들(prev => prev.filter(d => d.until > now))

      // 메시지 자동 숨김
      if (메시지타이머Ref.current && now - 메시지타이머Ref.current > 3000) {
        set메시지('')
        메시지타이머Ref.current = 0
      }

      const currentMarines = 마린들Ref.current
      const currentEnemies = 적들Ref.current
      const currentMineral = mineralRef.current
      const huntingMarines = currentMarines.filter(m => m.location === 'hunting')
      const bossMarines = currentMarines.filter(m => m.location === 'boss')

      // 보주 멀티플라이어 사전 계산
      const eqBj = 장착보주Ref.current
      const invBj = 보주목록Ref.current
      const upg = 업그레이드Ref.current
      const 스텟 = 일반스텟Ref.current
      const 보주공격 = 보주합산(eqBj, invBj, '공격')
      const 보주자원 = 보주합산(eqBj, invBj, '자원')
      const 보주강화 = 보주합산(eqBj, invBj, '강화')
      const 보주이속 = 보주합산(eqBj, invBj, '이속')
      const 보주크리 = 보주합산(eqBj, invBj, '크리')
      const 보주공속 = 보주합산(eqBj, invBj, '공속')
      const 보주배수 = 보주합산(eqBj, invBj, '배수')
      const 명칭보너스 = 명칭크리스탈보너스(명칭크리스탈Ref.current)
      const 보석b = 보석보너스합산(보석Ref.current)
      const 고유유닛스텟cur = 고유유닛Ref.current
      const 고유DPS = 고유유닛DPS(고유유닛스텟cur)
      const 초월lv = 초월레벨Ref.current
      const 공격력배수 = (1 + 보주공격 + upg.공격력 * 0.03 + 스텟.유닛공업 * 0.05)
      const 공속배수 = 1 + 보주공속 + upg.공속 * 0.02
      const 자원배수기여 = (1 + 보주자원 + upg.자원 * 0.05 + 스텟.돈수급량 * 0.03 + 보석b.자원배수추가) * (1 + 보주배수)
      const 속도 = Math.min(450, 기본이동속도 * (1 + 보주이속 + upg.이속 * 0.03))
      const 보스존캡 = 8
      const 사냥터캡 = 8 + 보스처치수Ref.current * 4
      const 평균크리 = Math.min(0.95, 보주크리)
      const 효과DPS = (lv: number) => 공격력(lv) * 공격력배수 * 공격속도(lv) * 공속배수 * (1 + 평균크리)
      const huntingDPS = bossMarines.filter(m => m.state === 'attacking').reduce((s, m) => s + 효과DPS(m.lv), 0)
      if (huntingDPS > 최고DPSRef.current) {
        set최고DPS(huntingDPS)
      }
      const currentBatch = 자원배수(Math.max(huntingDPS, 최고DPSRef.current)) * (1 + 보주배수)
      const 보스게이트 = 보스DPS게이트(보스처치수Ref.current + 1)

      // 필드 경계 클램프
      function clampPos(p: Pos): Pos {
        const r = 마린_크기 / 2
        return {
          x: Math.max(r, Math.min(필드_W - r, p.x)),
          y: Math.max(r, Math.min(필드_H - r, p.y)),
        }
      }

      let 추가미네랄 = 0  // 사냥터 mob 공격으로 획득
      let 추가공격수 = 0
      let 잔여Mineral = currentMineral
      const 플래시적: number[] = []
      const 플래시몹: number[] = []
      const 몹데미지맵 = new Map<number, number>()
      let 사냥터추가 = 0
      let 베이스추가 = 0
      const 기존사냥터수 = huntingMarines.length
      const 기존베이스수 = currentMarines.length - huntingMarines.length

      // 인덱스 도우미
      function nearestEnemy(p: Pos) {
        const list = currentEnemies
          .map(e => ({ e, d: 거리(p, e.pos) }))
          .filter(x => x.d <= 공격사거리)
          .sort((a, b) => a.d - b.d)
        return list[0]?.e
      }

      let 보스존추가 = 0
      const 기존보스존수 = currentMarines.filter(m => m.location === 'boss').length
      const 기존사냥수 = currentMarines.filter(m => m.location === 'hunting').length
      const 판매수집: { lv: number }[] = []
      let 화면전환target: 화면 | null = null

      function processBaseZones(m: 마린): 마린 {
        // 이동 중인 마린은 zone 효과 트리거하지 않음 (도착해서 idle일 때만)
        // 단, 자동 강화로 강화소로 이동하는 경우는 dest에 도착했으면 idle로 변환됨
        if (m.state !== 'idle') return m
        // 보스존 입구 (max 8 고정)
        if (점이구역안에(m.pos, ZONE_보스존입구)) {
          if (기존보스존수 + 보스존추가 < 보스존캡) {
            const 새m = {
              ...m,
              location: 'boss' as const,
              pos: 사냥터시작위치(기존보스존수 + 보스존추가),
              state: 'idle' as 유닛상태,
              dest: null,
              타겟적id: null,
            }
            보스존추가++
            화면전환target = 'boss'
            return 새m
          } else {
            if (메시지타이머Ref.current === 0 || now - 메시지타이머Ref.current > 1500) {
              메시지표시('🚫 보스존 가득참')
            }
            return { ...m, state: 'idle', dest: null }
          }
        }
        // 사냥터 입구 (cap = 사냥터캡)
        if (점이구역안에(m.pos, ZONE_사냥터입구)) {
          if (기존사냥수 + 사냥터추가 < 사냥터캡) {
            const 새m = {
              ...m,
              location: 'hunting' as const,
              pos: 사냥터시작위치(기존사냥수 + 사냥터추가),
              state: 'idle' as 유닛상태,
              dest: null,
              타겟적id: null,
            }
            사냥터추가++
            if (!화면전환target) 화면전환target = 'hunting'
            return 새m
          } else {
            if (메시지타이머Ref.current === 0 || now - 메시지타이머Ref.current > 1500) {
              메시지표시('🚫 사냥터 가득참')
            }
            return { ...m, state: 'idle', dest: null }
          }
        }
        // 판매소: 마린 판매
        if (점이구역안에(m.pos, ZONE_판매소)) {
          판매수집.push({ lv: m.lv })
          return { ...m, id: -1 }  // 마킹: 제거 대상
        }
        // 강화소 체크 (자동 강화)
        if (점이구역안에(m.pos, ZONE_강화) && now - m.마지막강화시간 >= 강화쿨다운) {
          const 비용 = 강화비용(m.lv)
          if (잔여Mineral >= 비용) {
            잔여Mineral -= 비용
            const idx = currentMarines.indexOf(m)
            const 시작점 = clampPos(베이스시작위치(idx))
            const 새m = {
              ...m,
              마지막강화시간: now,
              // 강화 완료 후 시작지점으로 복귀 (clamp 보장)
              pos: 시작점,
              state: 'idle' as 유닛상태,
              dest: null,
            }
            const 외부강화보너스 = 보주강화 + upg.강화확률 * 0.005 + 명칭보너스.개별확률 + 고유유닛스텟cur.추가1강 * 0.0025 + 고유유닛스텟cur.특수강화 * 0.005
            // 50강 → 51강 초월 시도
            if (m.lv === 50) {
              const 초월p = (초월스텟Ref.current.추가초월확률 + 명칭보너스.초월확률 + 초월lv) * 0.00001 + 보석b.초월확률추가
              const 초월성공 = Math.random() < Math.min(0.95, 초월p)
              if (초월성공) {
                새m.lv = 51
                set초월레벨(p => p + 1)
                set초월잔여포인트(p => p + 1)
                set누적강화성공(p => p + 1)
                set최고마린lv(p => Math.max(p, 51))
                메시지표시('✨ 초월 성공! 51강 달성!')
              }
              return 새m
            }
            const 증가 = m.lv < 50 ? 강화시도(m.lv, 스텟, 외부강화보너스, 보석b) : 0
            if (증가 > 0) {
              // 성공 (+1강 / +2강 / +3강)
              새m.lv = m.lv + 증가
              set누적강화성공(p => p + 1)
              set최고마린lv(p => Math.max(p, 새m.lv))
            } else {
              // 실패 페널티
              const r = 강화실패결과(m.lv, 스텟.특수파괴방지 + 스텟.특수파괴방지2 + 명칭보너스.파괴방지 + 보석b.파괴방지 + 고유유닛스텟cur.파괴방지)
              if (r.파괴) {
                if (메시지타이머Ref.current === 0 || now - 메시지타이머Ref.current > 1000) {
                  메시지표시(`💥 ${m.lv}강 마린 파괴!`)
                }
                return { ...새m, id: -1 }  // 마킹: 제거
              }
              if (r.감소 > 0) {
                새m.lv = Math.max(1, m.lv - r.감소)
                if (메시지타이머Ref.current === 0 || now - 메시지타이머Ref.current > 1000) {
                  메시지표시(`📉 ${m.lv}강 → ${새m.lv}강`)
                }
              }
            }
            return 새m
          }
        }
        return m
      }

      const newMarines = currentMarines.map(m => {
        let n = { ...m }
        const cd = 1000 / (공격속도(n.lv) * 공속배수)

        // 사냥터 (mob): 공격→미네랄 / 보스존: 공격→무색조각
        function nearestMob(p: Pos): 몹 | undefined {
          const list = 몹들Ref.current
            .filter(m => m.deadUntil <= now)
            .map(m => ({ m, d: 거리(p, m.pos) }))
            .filter(x => x.d <= 공격사거리)
            .sort((a, b) => a.d - b.d)
          return list[0]?.m
        }

        // 위치별 분기
        if (n.location === 'hunting' || n.location === 'boss') {
          // 베이스 입구 체크 (서브 화면 → 베이스)
          if (점이구역안에(n.pos, ZONE_베이스입구)) {
            const 새m = {
              ...n,
              location: 'base' as const,
              pos: 베이스시작위치(기존베이스수 + 베이스추가),
              state: 'idle' as 유닛상태,
              dest: null,
              타겟적id: null,
            }
            베이스추가++
            return 새m
          }
        }

        if (n.location === 'boss') {
          // ========== 보스존 마린 (재화 X, DPS만 기여) ==========
          const 적 = currentEnemies.find(e => e.id === n.타겟적id)

          if (n.state === 'attacking' && 적) {
            const d = 거리(n.pos, 적.pos)
            if (d > 공격사거리) {
              n.pos = clampPos(이동좌표(n.pos, 적.pos, 속도 * dt))
            } else if (now - n.마지막공격시간 >= cd) {
              n.마지막공격시간 = now
              n.공격플래시Until = now + 150
              추가공격수 += 1
              플래시적.push(적.id)
              // 보스존 데미지 floating (재화 X, gate만 본다)
              const isCrit = Math.random() < 평균크리
              const dmgShow = Math.round(공격력(n.lv) * 공격력배수 * (isCrit ? 2 : 1))
              if (Math.random() < 0.4) {
                const fid = dmgIdRef.current++
                setDmg플로팅들(prev => [...prev.slice(-20), {
                  id: fid, x: 적.pos.x + (Math.random() - 0.5) * 40, y: 적.pos.y - 보스_크기 / 2,
                  dmg: dmgShow, crit: isCrit, until: now + 900,
                }])
              }
            }
            return n
          }
          if (n.state === 'attacking' && !적) { n.state = 'idle'; n.타겟적id = null }
          if (n.state === 'move' && n.dest) {
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return n
          }
          if (n.state === 'attack-move' && n.dest) {
            const 가까운적 = nearestEnemy(n.pos)
            if (가까운적) { n.state = 'attacking'; n.타겟적id = 가까운적.id; return n }
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return n
          }
          if (n.state === 'idle' || n.state === 'hold') {
            const 가까운적 = nearestEnemy(n.pos)
            if (가까운적) { n.state = 'attacking'; n.타겟적id = 가까운적.id }
            return n
          }
          return n
        } else if (n.location === 'hunting') {
          // ========== 사냥터 마린 (미네랄 획득, 몹 처치) ==========
          const target = 몹들Ref.current.find(mb => mb.id === n.타겟적id && mb.deadUntil <= now)

          if (n.state === 'attacking' && target) {
            const d = 거리(n.pos, target.pos)
            if (d > 공격사거리) {
              n.pos = clampPos(이동좌표(n.pos, target.pos, 속도 * dt))
            } else if (now - n.마지막공격시간 >= cd) {
              n.마지막공격시간 = now
              n.공격플래시Until = now + 150
              const isCrit = Math.random() < 평균크리
              const dmg = 공격력(n.lv) * 공격력배수 * (isCrit ? 2 : 1)
              // 사냥터 공격력 +50% + 티어 배수 (1~25강=×1, 26~40강=×2, 41+강=×4)
              const 사냥터티어 = n.lv <= 25 ? 1 : n.lv <= 40 ? 2 : 4
              추가미네랄 += dmg * 1.5 * 사냥터티어 * currentBatch * 자원배수기여
              추가공격수 += 1
              플래시몹.push(target.id)
              몹데미지맵.set(target.id, (몹데미지맵.get(target.id) ?? 0) + dmg)
            }
            return n
          }
          if (n.state === 'attacking' && !target) { n.state = 'idle'; n.타겟적id = null }
          if (n.state === 'move' && n.dest) {
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return n
          }
          if (n.state === 'attack-move' && n.dest) {
            const 가까운몹 = nearestMob(n.pos)
            if (가까운몹) { n.state = 'attacking'; n.타겟적id = 가까운몹.id; return n }
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return n
          }
          if (n.state === 'idle' || n.state === 'hold') {
            const 가까운몹 = nearestMob(n.pos)
            if (가까운몹) { n.state = 'attacking'; n.타겟적id = 가까운몹.id }
            return n
          }
          return n
        } else {
          // ========== 베이스 마린 ==========
          if (n.state === 'move' && n.dest) {
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return processBaseZones(n)
          }
          if (n.state === 'attack-move' && n.dest) {
            n.pos = clampPos(이동좌표(n.pos, n.dest, 속도 * dt))
            if (거리(n.pos, n.dest) < 1) { n.dest = null; n.state = 'idle' }
            return processBaseZones(n)
          }
          if (n.state === 'attacking' || n.state === 'hold') {
            n.state = 'idle'; n.타겟적id = null
          }
          // 자동 판매 우선
          if (n.state === 'idle' && 자동판매ONRef.current && n.lv === 자동판매lvRef.current) {
            n.state = 'move'
            n.dest = { x: ZONE_판매소.x + ZONE_판매소.w / 2, y: ZONE_판매소.y + ZONE_판매소.h / 2 }
          }
          // 자동 강화
          else if (n.state === 'idle' && 자동강화ONRef.current && n.lv <= 자동강화최대lvRef.current) {
            n.state = 'move'
            n.dest = { x: ZONE_강화.x + ZONE_강화.w / 2, y: ZONE_강화.y + ZONE_강화.h / 2 }
          }
          return processBaseZones(n)
        }
      })

      // 판매소 zone에 도달한 마린 판매 처리
      let 판매무색 = 0, 판매응무조 = 0, 판매크리조각 = 0
      const 판매보주드랍: 보주[] = []
      const 판매보상배수 = 1 + 보주합산(eqBj, invBj, '판매') + 명칭보너스.판매배수
      const 무색배수 = 1 + 보주합산(eqBj, invBj, '무색') + 명칭보너스.무색배수
      const 조각배수 = 1 + 보주합산(eqBj, invBj, '조각')
      for (const s of 판매수집) {
        const r = 판매보상(s.lv)
        판매무색 += Math.round(r.무색조각 * 판매보상배수 * 무색배수)
        판매응무조 += Math.round(r.응무조 * 판매보상배수)
        판매크리조각 += Math.round(r.크리스탈조각 * 판매보상배수 * 조각배수)
        // 45강+ 판매 시 보주 드랍 확률 (원본 맵: 45강 뽑기)
        if (s.lv >= 45 && Math.random() < 0.15) {
          const 종류 = 보주종류목록[Math.floor(Math.random() * 보주종류목록.length)]
          const 등급 = Math.min(5, 1 + Math.floor((s.lv - 45) / 5) + (Math.random() < 0.2 ? 1 : 0))
          판매보주드랍.push({ id: Date.now() + Math.random(), 종류, 등급 })
        }
      }
      // id=-1 마린 제거 (판매소 도달 + 강화 실패 파괴)
      const finalMarines = newMarines.filter(m => m.id !== -1)
      set마린들(finalMarines)

      // 자동 구입 (총 마린 200 미만일 때만)
      const 판매lv고정 = 자동판매ONRef.current ? 자동판매lvRef.current : 0
      const 총마린수예상 = currentMarines.length - 판매수집.length
      if (자동구입ONRef.current && now - 자동구입타이머Ref.current >= 200 && 총마린수예상 < 200) {
        const lv = 자동구입강도Ref.current
        const 판매충돌 = 판매lv고정 > 0 && lv === 판매lv고정
        if (!판매충돌) {
          const cost = 생산비용(lv)
          const 가용 = 잔여Mineral + 추가미네랄
          if (가용 >= cost) {
            자동구입타이머Ref.current = now
            잔여Mineral -= cost
            set마린들(prev => {
              const baseCount = prev.filter(m => m.location === 'base').length
              return [...prev, 새마린(lv, 베이스시작위치(baseCount), 'base')]
            })
          }
        }
      }

      // 고유유닛 DPS 기여 (사냥터 배치 상시 적용)
      if (고유DPS > 0) {
        const 고유티어 = 고유유닛스텟cur.위치2 ? 2 : 1
        추가미네랄 += 고유DPS * 1.5 * 고유티어 * currentBatch * 자원배수기여 * dt
      }

      // currency 업데이트
      if (잔여Mineral !== currentMineral) setMineral(잔여Mineral + 추가미네랄)
      else if (추가미네랄 > 0) setMineral(prev => prev + 추가미네랄)
      if (판매무색 > 0) set무색조각(prev => prev + 판매무색)
      if (판매응무조 > 0) set응무조(prev => prev + 판매응무조)
      if (판매크리조각 > 0) set크리스탈조각(prev => prev + 판매크리조각)
      if (판매보주드랍.length > 0) set보주목록(prev => [...prev, ...판매보주드랍])

      // 자동 응축 (무색 1만 이상 시 자동 변환)
      if (자동응축ONRef.current) {
        const 예상무색 = 무색조각Ref.current + 판매무색
        if (예상무색 >= 10000) {
          const 변환 = Math.floor(예상무색 / 10000)
          set무색조각(prev => prev - 변환 * 10000)
          set응무조(prev => prev + 변환)
        }
      }

      if (추가공격수 > 0) set총공격수(prev => prev + 추가공격수)

      if (판매수집.length > 0) {
        set누적판매(p => p + 판매수집.length)
        // 판매 XP: lv * 10
        const 판매XP = 판매수집.reduce((s, x) => s + x.lv * 10, 0)
        if (판매XP > 0) XP획득(판매XP)
        const parts: string[] = []
        if (판매무색 > 0) parts.push(`🔷+${숫자포맷(판매무색)}`)
        if (판매응무조 > 0) parts.push(`💠+${판매응무조}`)
        if (판매크리조각 > 0) parts.push(`🔮+${판매크리조각}`)
        if (판매보주드랍.length > 0) parts.push(`⚔️보주(${판매보주드랍.map(b => b.종류).join(',')})`)
        메시지표시(`🛒 판매 ${판매수집.length} ${parts.join(' ')}`)
      }

      // 몹 플래시 (무적 - 죽지 않음)
      if (플래시몹.length > 0) {
        set몹들(prev => prev.map(m =>
          플래시몹.includes(m.id) ? { ...m, flashUntil: now + 150 } : m
        ))
      }

      // 보스 플래시
      if (플래시적.length > 0) {
        set적들(prev => prev.map(e => 플래시적.includes(e.id) ? { ...e, flashUntil: now + 150 } : e))
      }
      // 보스 DPS gate 통과 시 처치 (슬롯+4, 보주 드랍, 크리스탈조각)
      if (huntingDPS >= 보스게이트 && now - 보스킬쿨다운Ref.current >= 2000) {
        보스킬쿨다운Ref.current = now
        const baseN = 보스처치수Ref.current
        set보스처치수(prev => prev + 1)
        if (Platform.OS !== 'web') Vibration.vibrate([0, 100, 50, 100])
        // 크리스탈조각 드랍 (보스번호 * 10)
        const 조각드랍 = Math.round((baseN + 1) * 10 * (1 + 보주합산(eqBj, invBj, '조각')))
        set크리스탈조각(prev => prev + 조각드랍)
        // 보스 처치 XP: 보스번호 * 200
        XP획득((baseN + 1) * 200)
        // 크레딧 보상
        set크레딧(prev => prev + 10 + baseN * 5)
        // 보주 드랍 (50%)
        if (Math.random() < 0.5) {
          const 종류 = 보주종류목록[Math.floor(Math.random() * 보주종류목록.length)]
          const 등급 = Math.min(5, 1 + Math.floor((baseN + 1) / 3) + (Math.random() < 0.15 ? 1 : 0))
          const 새보주: 보주 = { id: Date.now() + Math.random(), 종류, 등급 }
          set보주목록(prev => [...prev, 새보주])
          메시지표시(`⚔️ 보스 ${baseN + 1} 클리어! 사냥터+4 🔮+${조각드랍} 🌟${종류}(${등급}성)`)
        } else {
          메시지표시(`⚔️ 보스 ${baseN + 1} 클리어! 사냥터+4 🔮+${조각드랍}`)
        }
      }
      if (화면전환target && 현재화면Ref.current === 'base') {
        set현재화면(화면전환target)
        if (화면전환target === 'boss') {
          메시지표시(`⚔️ 보스존 입장! (${기존보스존수 + 보스존추가}/${사냥터캡})`)
        } else if (화면전환target === 'hunting') {
          메시지표시(`🐺 사냥터 입장! (${기존사냥수 + 사냥터추가}마리)`)
        }
      }
    }
    const timer = setInterval(tick, 33)
    return () => clearInterval(timer)
  }, [])

  // ============================================
  // 명령 함수
  // ============================================
  function 이동명령(목적: Pos) {
    const c = clampPosStatic(목적)  // 마린이 도달 가능한 좌표로 clamp
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) ? { ...m, state: 'move', dest: c, 타겟적id: null } : m
    ))
  }
  function 공격이동명령(목적: Pos) {
    const c = clampPosStatic(목적)
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) ? { ...m, state: 'attack-move', dest: c, 타겟적id: null } : m
    ))
  }
  function 공격명령(적id: number) {
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) ? { ...m, state: 'attacking', 타겟적id: 적id, dest: null } : m
    ))
  }
  function 정지명령() {
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) ? { ...m, state: 'idle', dest: null, 타겟적id: null } : m
    ))
  }
  function hold명령() {
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) ? { ...m, state: 'hold', dest: null, 타겟적id: null } : m
    ))
  }

  // 사냥터 마린 전체 베이스로 복귀
  function 사냥터마린전체복귀() {
    set마린들(prev => {
      const huntingList = prev.filter(m => m.location === 'hunting')
      let baseIdx = prev.filter(m => m.location === 'base').length
      return prev.map(m => {
        if (m.location !== 'hunting') return m
        const pos = 베이스시작위치(baseIdx++)
        return { ...m, location: 'base' as const, pos, state: 'idle' as 유닛상태, dest: null, 타겟적id: null }
      })
    })
    set현재화면('base')
    메시지표시('🏠 사냥터 마린 베이스 복귀')
  }

  // XP 획득 → 레벨업 처리
  function XP획득(amount: number) {
    const 경험배수 = 보석보너스합산(보석Ref.current).경험배수
    let xp = 경험치Ref.current + Math.round(amount * 경험배수)
    let lv = 캐릭레벨Ref.current
    let pts = 잔여포인트Ref.current
    const startLv = lv
    while (xp >= 다음경험치(lv)) {
      xp -= 다음경험치(lv)
      lv++
      pts++
    }
    set경험치(xp)
    set캐릭레벨(lv)
    set잔여포인트(pts)
    if (lv > startLv) 메시지표시(`🎊 레벨업! Lv.${lv} (+${lv - startLv} 포인트)`)
  }

  // 스탯 포인트 분배 (일반 스텟)
  function 스탯올리기(stat: keyof 강화스텟, amount = 1) {
    if (잔여포인트Ref.current < amount) return
    set잔여포인트(p => p - amount)
    set일반스텟(prev => ({ ...prev, [stat]: prev[stat] + amount }))
  }
  // 스탯 포인트 분배 (초월 스텟, 초월잔여포인트 사용)
  function 초월스탯올리기(stat: keyof typeof 초월스텟, amount = 1) {
    if (초월잔여포인트Ref.current < amount) { 메시지표시('⛔ 초월 포인트 부족 (51강 달성 시 획득)'); return }
    set초월잔여포인트(p => p - amount)
    set초월스텟(prev => ({ ...prev, [stat]: prev[stat] + amount }))
  }

  // 보석 구입 (무색조각 사용)
  function 보석구입(종류: 보석타입) {
    const 비용 = 보석구입비용[종류]
    if (무색조각Ref.current < 비용) { 메시지표시(`🔷 무색조각 ${숫자포맷(비용)} 필요`); return }
    set무색조각(prev => prev - 비용)
    set보석(prev => ({ ...prev, [종류]: prev[종류] + 1 }))
    메시지표시(`💎 ${종류} 보석 구입!`)
  }

  function 보석연속시작(종류: 보석타입) {
    보석구입(종류)
    보석연속타이머Ref.current = setInterval(() => 보석구입(종류), 200)
  }
  function 보석연속종료() {
    if (보석연속타이머Ref.current) {
      clearInterval(보석연속타이머Ref.current)
      보석연속타이머Ref.current = null
    }
  }

  // 고유유닛 강화 (크레딧 사용)
  const 고유유닛강화비용표: Record<keyof Omit<고유유닛스텟, '위치2'>, (lv: number) => number> = {
    공격력:   lv => (lv + 1) * 100,
    공속:     lv => (lv + 1) * 200,
    경험치:   lv => (lv + 1) * 150,
    추가1강:  lv => (lv + 1) * 80,
    특수강화: lv => (lv + 1) * 250,
    파괴방지: lv => (lv + 1) * 50,
  }
  const 고유유닛상한: Record<keyof Omit<고유유닛스텟, '위치2'>, number> = {
    공격력: 20, 공속: 6, 경험치: 5, 추가1강: 20, 특수강화: 10, 파괴방지: 200,
  }
  function 고유유닛강화(stat: keyof Omit<고유유닛스텟, '위치2'>) {
    const lv = 고유유닛Ref.current[stat] as number
    if (lv >= 고유유닛상한[stat]) { 메시지표시('MAX'); return }
    const 비용 = 고유유닛강화비용표[stat](lv)
    if (크레딧Ref.current < 비용) { 메시지표시(`💰 크레딧 ${비용} 필요`); return }
    set크레딧(prev => prev - 비용)
    set고유유닛(prev => ({ ...prev, [stat]: (prev[stat] as number) + 1 }))
  }
  function 고유유닛위치변경() {
    if (!고유유닛Ref.current.위치2 && 크레딧Ref.current < 500) { 메시지표시('💰 크레딧 500 필요'); return }
    if (!고유유닛Ref.current.위치2) set크레딧(prev => prev - 500)
    set고유유닛(prev => ({ ...prev, 위치2: !prev.위치2 }))
  }

  // 명칭 크리스탈 구입
  function 명칭크리스탈구입(키: keyof 명칭크리스탈목록, 비용: number) {
    if (크리스탈조각 < 비용) { 메시지표시('🔮 크리스탈조각 부족!'); return }
    set크리스탈조각(prev => prev - 비용)
    set명칭크리스탈(prev => ({ ...prev, [키]: (prev[키] as number) + 1 }))
  }

  // 단순 화면 전환 (탭)
  function 베이스탭() { set현재화면('base'); set선택ID([]) }
  function 사냥터탭() { set현재화면('hunting'); set선택ID([]) }

  // 판매소 zone 안 도달한 선택 마린 강제 판매 (수동)
  function 판매() {
    const sel = 마린들Ref.current.filter(m => 선택IDRef.current.includes(m.id))
    if (sel.length === 0) { 메시지표시('판매할 마린 선택'); return }
    // 선택 마린을 판매소로 이동시킴
    set마린들(prev => prev.map(m =>
      선택IDRef.current.includes(m.id) && m.location === 'base'
        ? { ...m, state: 'move' as 유닛상태, dest: { x: ZONE_판매소.x + ZONE_판매소.w / 2, y: ZONE_판매소.y + ZONE_판매소.h / 2 } }
        : m
    ))
    메시지표시(`🛒 판매소로 이동 (${sel.length}마리)`)
  }

  // 무색조각 1만 → 응무조 1 변환
  function 응축하기() {
    if (무색조각 < 10000) { 메시지표시('무색조각 1만 필요'); return }
    const 변환 = Math.floor(무색조각 / 10000)
    set무색조각(prev => prev - 변환 * 10000)
    set응무조(prev => prev + 변환)
    메시지표시(`💠 ${변환} 응축 (1만 무색 → 1 응무)`)
  }

  function 유닛구매(강도: number) {
    const 비용 = 생산비용(강도)
    const 총마린수 = 마린들Ref.current.length
    if (총마린수 >= 200) { 메시지표시('🚫 마린 가득참 (총 200 최대)'); return }
    const baseCount = 마린들Ref.current.filter(m => m.location === 'base').length
    if (mineralRef.current < 비용) {
      메시지표시(`⚠️ 자원 부족 (${숫자포맷(비용)} 필요)`)
      return
    }
    setMineral(prev => prev - 비용)
    set마린들(prev => {
      const bc = prev.filter(m => m.location === 'base').length
      const 새 = 새마린(강도, 베이스시작위치(bc), 'base')
      return [...prev, 새]
    })
    메시지표시(`✓ ${강도}강 마린 생산!`)
  }

  // ============================================
  // 키보드 (PC 전용)
  // ============================================
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const handler = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (선택IDRef.current.length === 0 && (k === 'h' || k === 's')) return
      if (k === 'h') hold명령()
      if (k === 's') 정지명령()
      if (k === 'escape') set선택ID([])
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // ============================================
  // 우클릭 비활성화
  // ============================================
  useEffect(() => {
    if (Platform.OS !== 'web') return
    const el = fieldRef.current
    if (!el) return
    const ctx = (e: any) => e.preventDefault()
    const wheel = (e: any) => e.preventDefault()
    const touchmove = (e: any) => e.preventDefault()
    el.addEventListener('contextmenu', ctx)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchmove', touchmove, { passive: false })
    return () => {
      el.removeEventListener('contextmenu', ctx)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchmove', touchmove)
    }
  }, [현재화면])

  // ============================================
  // 터치 핸들러
  // ============================================
  function findUnitAt(p: Pos) {
    return 마린들Ref.current.find(m =>
      m.location === 현재화면Ref.current &&
      거리(m.pos, p) < 마린_크기 / 2 + 10
    )
  }
  function findEnemyAt(p: Pos) {
    return 적들Ref.current.find(e => 거리(e.pos, p) < 적_크기 / 2 + 10)
  }

  const fieldResponderProps = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: any) => {
      const p: Pos = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
      dragStartRef.current = p
      터치이동중Ref.current = false
    },
    onResponderMove: (e: any) => {
      if (!dragStartRef.current) return
      const cur: Pos = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
      const start = dragStartRef.current
      const d = Math.hypot(start.x - cur.x, start.y - cur.y)
      if (d > 8) 터치이동중Ref.current = true
      if (터치이동중Ref.current) {
        set드래그박스({
          x1: Math.min(start.x, cur.x),
          y1: Math.min(start.y, cur.y),
          x2: Math.max(start.x, cur.x),
          y2: Math.max(start.y, cur.y),
        })
      }
    },
    onResponderRelease: (e: any) => {
      if (!dragStartRef.current) return
      const start = dragStartRef.current
      const end: Pos = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }
      const wasDragging = 터치이동중Ref.current
      dragStartRef.current = null
      터치이동중Ref.current = false
      set드래그박스(null)

      if (!wasDragging) {
        const 마린 = findUnitAt(end)
        const 적 = findEnemyAt(end)
        const screen = 현재화면Ref.current

        // 0. 고유유닛 탭 체크 (사냥터 화면)
        if (screen === 'hunting') {
          if (거리(end, 고유유닛posRef.current) < 마린_크기 / 2 + 10) {
            if (고유유닛선택Ref.current) {
              set고유유닛선택(false)
            } else {
              set고유유닛선택(true)
              set고유유닛패널열림(true)
              set선택ID([])
            }
            return
          }
          if (고유유닛선택Ref.current) {
            set고유유닛pos(clampPosStatic(end))
            return
          }
        }

        // 1. 마린 탭 = 선택 (더블탭 = 같은 강도 전체)
        if (마린) {
          const tapNow = Date.now()
          const last = lastTapRef.current
          if (last && last.id === 마린.id && tapNow - last.time < 350) {
            // 더블탭 → 같은 강도 마린 전체 선택
            const sameLv = 마린들Ref.current.filter(m =>
              m.location === 현재화면Ref.current && m.lv === 마린.lv
            )
            set선택ID(sameLv.map(m => m.id))
            lastTapRef.current = null
          } else {
            set선택ID([마린.id])
            lastTapRef.current = { id: 마린.id, time: tapNow }
          }
          return
        }
        // 2. 선택O + 적 = 공격
        if (선택IDRef.current.length > 0 && 적 && screen === 'hunting') {
          공격명령(적.id)
          return
        }
        // 4. 선택O + 빈곳 = 이동
        if (선택IDRef.current.length > 0) {
          이동명령(end)
          return
        }
      } else {
        const x1 = Math.min(start.x, end.x)
        const y1 = Math.min(start.y, end.y)
        const x2 = Math.max(start.x, end.x)
        const y2 = Math.max(start.y, end.y)
        const inBox = 마린들Ref.current.filter(m =>
          m.location === 현재화면Ref.current && 점이사각형안에(m.pos, x1, y1, x2, y2)
        )
        set선택ID(inBox.map(m => m.id))
      }
    },
  }

  function 게임초기화() {
    if (typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm('정말 처음부터 시작할까요?')) return
    }
    set마린들(초기마린들())
    setMineral(100)
    set총공격수(0)
    set보스처치수(0)
    set최고DPS(0)
    set무색조각(0); set응무조(0); set크리스탈조각(0)
    set보주목록([]); set장착보주([])
    set업그레이드({ 공격력: 0, 자원: 0, 강화확률: 0, 이속: 0, 공속: 0 })
    set캐릭레벨(1); set경험치(0); set잔여포인트(0)
    set일반스텟({ 돈수급량: 0, 유닛공업: 0, 가산1강: 0, 가산2강: 0, 가산3강: 0, 특수강화: 0, 가산1강2: 0, 가산2강2: 0, 가산3강2: 0, 특수강화2: 0, 특수파괴방지: 0, 특수파괴방지2: 0, 가산44강: 0, 가산45강: 0, 가산46강: 0, 가산47강: 0, 가산48강: 0 })
    set초월스텟({ 추가초월확률: 0 })
    set명칭크리스탈({ ...초기명칭크리스탈 })
    set크레딧(0)
    set보석({ ...초기보석 })
    set고유유닛({ ...초기고유유닛 })
    set초월레벨(0)
    set초월잔여포인트(0)
    set누적강화성공(0); set누적판매(0); set최고마린lv(1)
    set보주패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false)
    set보석패널열림(false); set고유유닛패널열림(false)
    set몹들(초기몹들())
    set자동강화ON(false); set자동강화최대lv(1)
    set자동판매ON(false); set자동판매lv(50)
    set자동구입강도(1); set자동구입ON(false); set자동응축ON(false)
    set적들(초기적들(1))
    set선택ID([])
    set현재화면('base')
    set생산패널열림(false)
    메시지표시('🔄 초기화됨')
  }

  // ============================================
  // 렌더
  // ============================================
  const now = Date.now()

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1a1a2e' }} edges={['top']}>
    <ScrollView
      contentContainerStyle={styles.container}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>DPS 강화하기 ⚔️ RTS</Text>

      <View style={styles.statBox}>
        <View style={styles.statRow}>
          <Text style={styles.stat}>💎 {숫자포맷(mineral)}</Text>
          <Text style={styles.statResource}>🔷 {숫자포맷(무색조각)}</Text>
          <TouchableOpacity onPress={응축하기} style={styles.convertBtn}>
            <Text style={styles.convertBtnText}>↑응축</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => set자동응축ON(v => !v)} style={[styles.convertBtn, { backgroundColor: 자동응축ON ? '#7ed957' : '#444' }]}>
            <Text style={styles.convertBtnText}>{자동응축ON ? '자동✓' : '자동'}</Text>
          </TouchableOpacity>
          <Text style={styles.statResource}>💠 {숫자포맷(응무조)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statBatch}>× {현재배수}</Text>
          <Text style={styles.statSmall}>📈 {숫자포맷(시간당미네랄)}/h</Text>
          <Text style={styles.statSmall}>🔮 {숫자포맷(크리스탈조각)}</Text>
          <Text style={[styles.statSmall, { color: 잔여포인트 > 0 ? '#f5a623' : '#aaa' }]}>Lv.{캐릭레벨}{잔여포인트 > 0 ? ` (+${잔여포인트}P)` : ''}</Text>
          {초월레벨 > 0 && <Text style={[styles.statSmall, { color: '#a855f7' }]}>🌀초월Lv.{초월레벨}{초월잔여포인트 > 0 ? ` (+${초월잔여포인트}P)` : ''}</Text>}
          {크레딧 > 0 && <Text style={[styles.statSmall, { color: '#f5a623' }]}>💰 {숫자포맷(크레딧)}크레딧</Text>}
        </View>
      </View>

      {/* 화면 전환 탭 */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, 현재화면 === 'base' && styles.tabActive]}
          onPress={() => { set현재화면('base'); set선택ID([]) }}
        >
          <Text style={styles.tabText}>🏠 ({베이스마린들.length}) [{마린들.length}/200]</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, 현재화면 === 'hunting' && styles.tabActive]}
          onPress={() => { set현재화면('hunting'); set선택ID([]) }}
        >
          <Text style={styles.tabText}>🐺 사냥 ({사냥터마린들.length}/{사냥터캡})</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, 현재화면 === 'boss' && styles.tabActiveRed]}
          onPress={() => { set현재화면('boss'); set선택ID([]) }}
        >
          <Text style={styles.tabText}>⚔️ 보스 ({보스존마린들.length}/{보스존캡})</Text>
        </TouchableOpacity>
      </View>

      {/* 작은 버튼 바 (생산/자동/보주/크리스탈) */}
      <View style={styles.smallBtnBar}>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !생산패널열림
          set생산패널열림(v); if (v) { set자동패널열림(false); set보주패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false); set보석패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>🏭 생산</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !자동패널열림
          set자동패널열림(v); if (v) { set생산패널열림(false); set보주패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false); set보석패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>🤖 자동</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !강화패널열림
          set강화패널열림(v); if (v) { set생산패널열림(false); set자동패널열림(false); set보주패널열림(false); set명칭크리스탈패널열림(false); set보석패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>✨ 강화</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !보주패널열림
          set보주패널열림(v); if (v) { set생산패널열림(false); set자동패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false); set보석패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>⚔️ 보주 ({장착보주.length}/3)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !명칭크리스탈패널열림
          set명칭크리스탈패널열림(v); if (v) { set생산패널열림(false); set자동패널열림(false); set보주패널열림(false); set강화패널열림(false); set보석패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>🌟 크리스탈</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !보석패널열림
          set보석패널열림(v); if (v) { set생산패널열림(false); set자동패널열림(false); set보주패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false); set고유유닛패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>💎 보석</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtn} onPress={() => {
          const v = !고유유닛패널열림
          set고유유닛패널열림(v); if (v) { set생산패널열림(false); set자동패널열림(false); set보주패널열림(false); set강화패널열림(false); set명칭크리스탈패널열림(false); set보석패널열림(false) }
        }}>
          <Text style={styles.smallBtnText}>🦸 고유({크레딧})</Text>
        </TouchableOpacity>
      </View>

      {/* 선택된 마린 표시 */}
      {선택ID.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.selectedBar}
          contentContainerStyle={styles.selectedBarContent}
        >
          <Text style={styles.selectedLabel}>
            선택 {선택한마린들.length} (DPS {숫자포맷(선택한마린들.reduce((s,m)=>s+유닛DPS(m.lv),0))} · 평균 +{선택한마린들.length > 0 ? Math.round(선택한마린들.reduce((s,m)=>s+m.lv,0)/선택한마린들.length) : 0}):
          </Text>
          {선택한마린들.map(m => (
            <TouchableOpacity key={m.id} style={[styles.selectedChip, { borderColor: 마린색(m.lv) }]} onPress={() => set선택ID([m.id])}>
              <Text style={styles.selectedChipEmoji}>🪖</Text>
              <Text style={[styles.selectedChipLv, { color: 마린색(m.lv) }]}>+{m.lv}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 필드 (화면별 배경 이미지 + 단색 fallback + responder) */}
      <View style={[styles.field, {
        backgroundColor: 현재화면 === 'base' ? '#1a2a3e'
          : 현재화면 === 'hunting' ? '#1a3e2a'
          : '#3e1a2a',
        // @ts-ignore - 웹: 필드 위에서 터치/휠 스크롤 막기
        ...(Platform.OS === 'web' ? { touchAction: 'none', overscrollBehavior: 'contain' } : {}),
      }]}>
      {/* 배경 이미지 (절대 첫 자식, 터치 무시) */}
      <View style={{ position: 'absolute', top: 0, left: 0, width: 필드_W, height: 필드_H }} pointerEvents="none">
        <Image
          source={현재화면 === 'base' ? BG_LOBBY : 현재화면 === 'hunting' ? BG_HUNTING : BG_BOSS}
          style={{ width: 필드_W, height: 필드_H, opacity: 0.55 }}
          resizeMode="cover"
        />
      </View>
      <View
        ref={fieldRef}
        style={styles.fieldInner}
        {...fieldResponderProps}
      >
        {/* BASE: 4개 zone (비콘 이미지 + 라벨) */}
        {현재화면 === 'base' && (
          <>
            {[
              { z: ZONE_강화, img: BEACON_강화 },
              { z: ZONE_보스존입구, img: BEACON_보스 },
              { z: ZONE_사냥터입구, img: BEACON_사냥 },
              { z: ZONE_판매소, img: BEACON_판매 },
            ].map(({ z, img }, i) => (
              <View key={i} style={[styles.zone, {
                left: z.x, top: z.y, width: z.w, height: z.h, borderColor: z.color,
                backgroundColor: 'transparent',
                borderWidth: 0,
              }]} pointerEvents="none">
                <Image source={img} style={{ width: z.w, height: z.h - 14, resizeMode: 'contain' }} />
                <Text style={[styles.zoneLabel, { color: z.color, textShadowColor: '#000', textShadowRadius: 3 }]}>{z.label}</Text>
              </View>
            ))}
          </>
        )}

        {/* HUNTING/BOSS: 베이스 비콘 */}
        {(현재화면 === 'hunting' || 현재화면 === 'boss') && (
          <View style={[styles.zone, {
            left: ZONE_베이스입구.x, top: ZONE_베이스입구.y,
            width: ZONE_베이스입구.w, height: ZONE_베이스입구.h,
            borderColor: ZONE_베이스입구.color,
            backgroundColor: ZONE_베이스입구.color + '15',
          }]} pointerEvents="none">
            <Text style={[styles.zoneLabel, { color: ZONE_베이스입구.color }]}>{ZONE_베이스입구.label}</Text>
          </View>
        )}

        {/* HUNTING: 몹 1마리 (무적, 큰 크기) */}
        {현재화면 === 'hunting' && 몹들.map(mb => {
          const flash = mb.flashUntil > now
          return (
            <View key={mb.id} pointerEvents="none">
              <View style={[styles.enemy, {
                left: mb.pos.x - 몹_크기 / 2,
                top: mb.pos.y - 몹_크기 / 2,
                backgroundColor: flash ? '#ff6b6b' : '#4a4a8a',
                borderColor: '#7a7aaa',
                width: 몹_크기, height: 몹_크기,
                borderRadius: 몹_크기 / 2,
              }]}>
                <Text style={{ fontSize: 56 }}>🐺</Text>
              </View>
              <Text style={[styles.bossLabel, {
                left: mb.pos.x - 100, top: mb.pos.y - 몹_크기 / 2 - 22, width: 200,
                color: '#7ed957', fontSize: 12, fontWeight: 'bold',
              }]}>⚔️ DPS {숫자포맷(사냥터마린DPS)}</Text>
            </View>
          )
        })}

        {/* 고유유닛 (사냥터에 항상 배치) */}
        {현재화면 === 'hunting' && (
          <View pointerEvents="none">
            {고유유닛선택 && (
              <View style={[styles.selectRing, {
                left: 고유유닛pos.x - 마린_크기 / 2 - 3,
                top: 고유유닛pos.y - 마린_크기 / 2 - 3,
                borderColor: '#a855f7',
              }]} />
            )}
            <View style={[styles.marine, {
              left: 고유유닛pos.x - 마린_크기 / 2,
              top: 고유유닛pos.y - 마린_크기 / 2,
              borderColor: '#a855f7',
              borderWidth: 고유유닛선택 ? 3 : 2,
              backgroundColor: '#a855f740',
            }]}>
              <Text style={styles.marineText}>🦸</Text>
            </View>
            <Text style={[styles.marineLv, {
              left: 고유유닛pos.x - 15,
              top: 고유유닛pos.y + 마린_크기 / 2 - 2,
              color: '#a855f7',
            }]}>고유</Text>
          </View>
        )}

        {/* 데미지 floating (보스존만) */}
        {현재화면 === 'boss' && dmg플로팅들.map(d => {
          const t = Math.max(0, (d.until - now) / 900)
          return (
            <Text key={d.id} pointerEvents="none" style={{
              position: 'absolute',
              left: d.x - 40, top: d.y - (1 - t) * 40,  // 위로 떠오름
              width: 80, textAlign: 'center',
              color: d.crit ? '#ffeb3b' : '#fff',
              fontSize: d.crit ? 18 : 13,
              fontWeight: 'bold',
              opacity: t,
              textShadowColor: '#000', textShadowRadius: 3,
            }}>
              {d.crit ? '💥' : ''}{숫자포맷(d.dmg)}
            </Text>
          )
        })}

        {/* BOSS: 보스 1마리 (큰 크기, HP X) */}
        {현재화면 === 'boss' && 적들.map(e => {
          const flash = e.flashUntil > now
          const gate = 보스DPS게이트(보스처치수 + 1)
          const ok = 사냥터DPS >= gate
          return (
            <View key={e.id} pointerEvents="none">
              <View style={[styles.enemy, {
                left: e.pos.x - 보스_크기 / 2,
                top: e.pos.y - 보스_크기 / 2,
                backgroundColor: flash ? '#ff6b6b' : '#5a2a2a',
                width: 보스_크기, height: 보스_크기, borderRadius: 보스_크기 / 2,
              }]}>
                <Text style={{ fontSize: 68 }}>👹</Text>
              </View>
              <Text style={[styles.bossLabel, { left: e.pos.x - 100, top: e.pos.y - 보스_크기 / 2 - 50, width: 200 }]}>
                👹 보스 {보스처치수 + 1}
              </Text>
              <Text style={[styles.bossLabel, {
                left: e.pos.x - 100, top: e.pos.y - 보스_크기 / 2 - 34, width: 200,
                color: ok ? '#7ed957' : '#ccc', fontSize: 10,
              }]}>
                DPS {숫자포맷(사냥터DPS)} / {숫자포맷(gate)} {ok ? '✓ 클리어 중' : '✗ DPS 부족'}
              </Text>
            </View>
          )
        })}

        {/* 마린 (현재 화면에 있는 마린만) */}
        {화면마린들.map(m => {
          const selected = 선택ID.includes(m.id)
          const flash = m.공격플래시Until > now
          return (
            <View key={m.id} pointerEvents="none">
              {selected && (
                <View style={[styles.selectRing, {
                  left: m.pos.x - 마린_크기 / 2 - 3,
                  top: m.pos.y - 마린_크기 / 2 - 3,
                }]} />
              )}
              <View style={[styles.marine, {
                left: m.pos.x - 마린_크기 / 2,
                top: m.pos.y - 마린_크기 / 2,
                borderColor: flash ? '#f5a623' : (selected ? '#7ed957' : 마린색(m.lv)),
                borderWidth: selected ? 3 : 2,
                backgroundColor: 마린색(m.lv) + '40',  // tier 색 반투명 배경
              }]}>
                <Text style={styles.marineText}>🪖</Text>
              </View>
              <Text style={[styles.marineLv, {
                left: m.pos.x - 15,
                top: m.pos.y + 마린_크기 / 2 - 2,
                color: 마린색(m.lv),
              }]}>+{m.lv}</Text>
            </View>
          )
        })}

        {드래그박스 && (
          <View style={[styles.dragBox, {
            left: 드래그박스.x1,
            top: 드래그박스.y1,
            width: 드래그박스.x2 - 드래그박스.x1,
            height: 드래그박스.y2 - 드래그박스.y1,
          }]} pointerEvents="none" />
        )}

      </View>
      </View>

      {/* 힌트 */}
      <View style={styles.hintBar}>
        <Text style={styles.hintText}>
          {선택ID.length > 0
            ? '👆 빈곳=이동, 적=공격, 마린=선택, 빈드래그=해제'
            : '👆 마린 탭 또는 드래그로 선택'}
        </Text>
      </View>

      {메시지 ? <Text style={styles.message}>{메시지}</Text> : null}

      {/* 베이스 안내 */}
      {현재화면 === 'base' && (
        <View style={styles.zoneInfo}>
          <Text style={styles.zoneInfoText}>🔨 강화소 | ⚔️ 보스존 (최대 12) | 🐺 사냥터 (몹→💎) | 🛒 판매소</Text>
        </View>
      )}
      {(현재화면 === 'hunting' || 현재화면 === 'boss') && (
        <View style={styles.zoneInfo}>
          <Text style={styles.zoneInfoText}>🏠 베이스 비콘으로 마린 보내면 베이스 복귀</Text>
        </View>
      )}

      {/* 영구강화 패널 */}
      {강화패널열림 && (
        <View style={styles.prodPanel}>
          <View style={styles.prodHeader}>
            <Text style={styles.prodTitle}>✨ 영구강화</Text>
            <TouchableOpacity onPress={() => set강화패널열림(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.prodSubtitle}>Lv.{캐릭레벨} · XP {경험치}/{다음경험치(캐릭레벨)} · 포인트 {잔여포인트} · 초월포인트 {초월잔여포인트}</Text>
          {/* 스텟 탭 */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
            <TouchableOpacity
              style={[styles.statTabBtn, 스텟탭 === '일반' && styles.statTabBtnOn]}
              onPress={() => set스텟탭('일반')}
            >
              <Text style={[styles.statTabText, 스텟탭 === '일반' && { color: '#000' }]}>일반 스텟</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.statTabBtn, 스텟탭 === '초월' && styles.statTabBtnOn, 캐릭레벨 < 300000 && { opacity: 0.4 }]}
              onPress={() => set스텟탭('초월')}
            >
              <Text style={[styles.statTabText, 스텟탭 === '초월' && { color: '#000' }]}>초월 스텟 {캐릭레벨 < 300000 ? '🔒' : ''}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {/* 일반 스텟 */}
            {스텟탭 === '일반' && (() => {
              const canUp = 잔여포인트 > 0
              const 일반목록: { key: keyof 강화스텟; label: string; 효과: string }[] = [
                { key: '돈수급량',      label: '💰 돈 수급량',       효과: `자원 +${일반스텟.돈수급량 * 3}%` },
                { key: '유닛공업',      label: '⚔️ 유닛 공격력',     효과: `공격 +${일반스텟.유닛공업 * 5}%` },
                { key: '가산1강',       label: '🔨 +1강 확률',        효과: `+${(일반스텟.가산1강 * 0.1).toFixed(1)}%` },
                { key: '가산2강',       label: '🔨 +2강 확률',        효과: `+${(일반스텟.가산2강 * 0.1).toFixed(1)}%` },
                { key: '가산3강',       label: '🔨 +3강 확률',        효과: `+${(일반스텟.가산3강 * 0.1).toFixed(1)}%` },
                { key: '특수강화',      label: '⚡ 특수강화 확률',    효과: `+${(일반스텟.특수강화 * 0.1).toFixed(1)}%` },
                { key: '가산1강2',      label: '🔩 +1강 확률 (2)',     효과: `+${(일반스텟.가산1강2 * 0.1).toFixed(1)}%` },
                { key: '가산2강2',      label: '🔩 +2강 확률 (2)',     효과: `+${(일반스텟.가산2강2 * 0.1).toFixed(1)}%` },
                { key: '가산3강2',      label: '🔩 +3강 확률 (2)',     효과: `+${(일반스텟.가산3강2 * 0.1).toFixed(1)}%` },
                { key: '특수강화2',     label: '⚡ 특수강화 (2)',      효과: `+${(일반스텟.특수강화2 * 0.1).toFixed(1)}%` },
                { key: '특수파괴방지',  label: '🛡️ 파괴방지',         효과: `+${(일반스텟.특수파괴방지 * 0.1).toFixed(1)}%` },
                { key: '특수파괴방지2', label: '🛡️ 파괴방지 (2)',      효과: `+${(일반스텟.특수파괴방지2 * 0.1).toFixed(1)}%` },
                { key: '가산44강',      label: '🌟 44강 확률',         효과: `+${(일반스텟.가산44강 * 0.1).toFixed(1)}%` },
                { key: '가산45강',      label: '🌟 45강 확률',         효과: `+${(일반스텟.가산45강 * 0.1).toFixed(1)}%` },
                { key: '가산46강',      label: '🌟 46강 확률',         효과: `+${(일반스텟.가산46강 * 0.1).toFixed(1)}%` },
                { key: '가산47강',      label: '🌟 47강 확률',         효과: `+${(일반스텟.가산47강 * 0.1).toFixed(1)}%` },
                { key: '가산48강',      label: '💎 48강 확률',         효과: `+${(일반스텟.가산48강 * 0.05).toFixed(2)}%` },
              ]
              return 일반목록.map(({ key, label, 효과 }) => {
                const val = 일반스텟[key]
                return (
                  <View key={key} style={styles.statRow2}>
                    <Text style={styles.statLabel}>{label}</Text>
                    <Text style={styles.statVal}>{val} <Text style={{ color: '#aaa', fontSize: 9 }}>({효과})</Text></Text>
                    <TouchableOpacity style={[styles.statBtn, !canUp && styles.statBtnOff]} onPress={() => 스탯올리기(key)}>
                      <Text style={styles.statBtnText}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.statBtn, { backgroundColor: canUp ? '#7ed957' : '#444', marginLeft: 4 }]} onPress={() => 스탯올리기(key, 잔여포인트)}>
                      <Text style={[styles.statBtnText, { color: canUp ? '#000' : '#888', fontSize: 10 }]}>ALL</Text>
                    </TouchableOpacity>
                  </View>
                )
              })
            })()}
            {/* 초월 스텟 */}
            {스텟탭 === '초월' && (
              <>
                {초월레벨 === 0 ? (
                  <Text style={{ color: '#a855f7', textAlign: 'center', padding: 16, fontSize: 13 }}>
                    🔒 초월 스텟은 51강 달성 시 초월 포인트를 획득합니다{'\n'}현재 초월레벨: {초월레벨} (포인트: {초월잔여포인트})
                  </Text>
                ) : (
                  (() => {
                    const canUp = 초월잔여포인트 > 0
                    const 초월목록: { key: keyof typeof 초월스텟; label: string; 효과: string }[] = [
                      { key: '추가초월확률', label: '🌀 추가 초월확률', 효과: `+${(초월스텟.추가초월확률 * 0.001).toFixed(3)}%` },
                    ]
                    return (
                      <>
                        <Text style={{ color: '#a855f7', fontSize: 11, marginBottom: 6 }}>🌀 초월레벨 {초월레벨} · 초월 포인트 {초월잔여포인트}</Text>
                        {초월목록.map(({ key, label, 효과 }) => {
                          const val = 초월스텟[key]
                          return (
                            <View key={key} style={styles.statRow2}>
                              <Text style={styles.statLabel}>{label}</Text>
                              <Text style={styles.statVal}>{val} <Text style={{ color: '#aaa', fontSize: 9 }}>({효과})</Text></Text>
                              <TouchableOpacity style={[styles.statBtn, !canUp && styles.statBtnOff]} onPress={() => 초월스탯올리기(key)}>
                                <Text style={styles.statBtnText}>+</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={[styles.statBtn, { backgroundColor: canUp ? '#7ed957' : '#444', marginLeft: 4 }]} onPress={() => 초월스탯올리기(key, 초월잔여포인트)}>
                                <Text style={[styles.statBtnText, { color: canUp ? '#000' : '#888', fontSize: 10 }]}>ALL</Text>
                              </TouchableOpacity>
                            </View>
                          )
                        })}
                      </>
                    )
                  })()
                )}
              </>
            )}
            <View style={styles.divider} />
            <Text style={[styles.upgLabel, { color: '#e94560', marginBottom: 4 }]}>✨ 영구강화</Text>
            <Text style={[styles.prodSubtitle, { marginBottom: 6 }]}>🔷무색조각 · 💠응무조 사용</Text>
            {([
              { key: '공격력', label: '⚔️ 공격력', 효과: '+3%/Lv', 통화: '무색' as const, 비용: (lv: number) => (lv + 1) * 500, max: 20 },
              { key: '자원', label: '💰 자원 획득', 효과: '+5%/Lv', 통화: '무색' as const, 비용: (lv: number) => (lv + 1) * 800, max: 20 },
              { key: '강화확률', label: '🎯 강화확률', 효과: '+0.5%p/Lv', 통화: '응무' as const, 비용: (lv: number) => (lv + 1) * 30, max: 20 },
              { key: '이속', label: '💨 이동속도', 효과: '+3%/Lv', 통화: '응무' as const, 비용: (lv: number) => (lv + 1) * 20, max: 20 },
              { key: '공속', label: '⚡ 공격속도', 효과: '+2%/Lv', 통화: '응무' as const, 비용: (lv: number) => (lv + 1) * 25, max: 20 },
            ] as const).map(def => {
              const lv = 업그레이드[def.key]
              const maxed = lv >= def.max
              const cost = maxed ? 0 : def.비용(lv)
              const cur = def.통화 === '무색' ? 무색조각 : 응무조
              const canBuy = !maxed && cur >= cost
              const 통화기호 = def.통화 === '무색' ? '🔷' : '💠'
              return (
                <View key={def.key} style={styles.upgRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.upgLabel}>{def.label} <Text style={{ color: '#f5a623' }}>Lv.{lv}/{def.max}</Text></Text>
                    <Text style={styles.upgEffect}>{def.효과} — 현재 {def.key === '공격력' ? `+${lv * 3}%` : def.key === '자원' ? `+${lv * 5}%` : def.key === '강화확률' ? `+${(lv * 0.5).toFixed(1)}%p` : def.key === '이속' ? `+${lv * 3}%` : `+${lv * 2}%`}</Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.upgBtn, !canBuy && styles.upgBtnOff, { minWidth: 70, paddingHorizontal: 6 }]}
                    onPress={() => {
                      if (!canBuy) return
                      if (def.통화 === '무색') set무색조각(p => p - cost)
                      else set응무조(p => p - cost)
                      set업그레이드(prev => ({ ...prev, [def.key]: prev[def.key as keyof typeof prev] + 1 }))
                      메시지표시(`✨ ${def.label} +1 → Lv.${lv + 1}`)
                    }}
                  >
                    <Text style={styles.upgBtnText}>{maxed ? 'MAX' : `${통화기호}${숫자포맷(cost)}`}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.upgBtn, { backgroundColor: canBuy ? '#7ed957' : '#444', minWidth: 46, paddingHorizontal: 4, marginLeft: 4 }]}
                    onPress={() => {
                      if (!canBuy) return
                      let l = lv, spent = 0, count = 0
                      while (l < def.max) {
                        const c = def.비용(l)
                        if (spent + c > cur) break
                        spent += c; l++; count++
                      }
                      if (count === 0) return
                      if (def.통화 === '무색') set무색조각(p => p - spent)
                      else set응무조(p => p - spent)
                      set업그레이드(prev => ({ ...prev, [def.key]: l }))
                      메시지표시(`✨ ${def.label} +${count} → Lv.${l}`)
                    }}
                  >
                    <Text style={[styles.upgBtnText, { color: canBuy ? '#000' : '#888' }]}>전체</Text>
                  </TouchableOpacity>
                </View>
              )
            })}
          </ScrollView>
        </View>
      )}

      {/* 보주 패널 (보스 드랍, 3슬롯 장착) */}
      {보주패널열림 && (
        <View style={styles.prodPanel}>
          <View style={styles.prodHeader}>
            <Text style={styles.prodTitle}>⚔️ 보주 ({장착보주.length}/3 장착)</Text>
            <TouchableOpacity onPress={() => set보주패널열림(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.prodSubtitle}>탭=장착/해제 · 🔷=판매 (미장착만)</Text>
          {보주목록.filter(g => !장착보주.includes(g.id)).length > 0 && (
            <TouchableOpacity
              style={{ backgroundColor: '#7ed957', borderRadius: 6, padding: 6, marginBottom: 6, alignItems: 'center' }}
              onPress={() => {
                const 미장착 = 보주목록.filter(g => !장착보주.includes(g.id))
                const 총합 = 미장착.reduce((s, g) => s + 보주판매가(g.등급), 0)
                set보주목록(prev => prev.filter(g => 장착보주.includes(g.id)))
                set무색조각(prev => prev + 총합)
                메시지표시(`💰 보주 ${미장착.length}개 판매 → 🔷${숫자포맷(총합)}`)
              }}
            >
              <Text style={{ color: '#000', fontSize: 12, fontWeight: 'bold' }}>
                🔷 미장착 전체 판매 ({보주목록.filter(g => !장착보주.includes(g.id)).length}개)
              </Text>
            </TouchableOpacity>
          )}
          <ScrollView style={{ maxHeight: 280 }}>
            {보주목록.length === 0 ? (
              <Text style={{ color: '#666', textAlign: 'center', padding: 16 }}>보주 없음 — 보스 처치하면 드랍</Text>
            ) : (
              보주목록.map(g => {
                const 장착됨 = 장착보주.includes(g.id)
                const eff = 보주효과표[g.종류]
                const 효과값 = (g.등급 * eff.값 * 100).toFixed(eff.값 < 0.02 ? 1 : 0)
                const 가득 = !장착됨 && 장착보주.length >= 3
                const 판매가 = 보주판매가(g.등급)
                return (
                  <View key={g.id} style={[styles.gemRow, 장착됨 && styles.gemRowEq, 가득 && { opacity: 0.4 }]}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 6 }}
                      onPress={() => {
                        if (장착됨) {
                          set장착보주(prev => prev.filter(id => id !== g.id))
                        } else if (장착보주.length < 3) {
                          set장착보주(prev => [...prev, g.id])
                        } else {
                          메시지표시('슬롯 가득 — 다른 보주 해제 먼저')
                        }
                      }}
                    >
                      <Text style={styles.gemGrade}>{'⭐'.repeat(g.등급)}</Text>
                      <Text style={[styles.gemType, { width: 40 }]}>{g.종류}</Text>
                      <Text style={styles.gemEffect}>{eff.설명.replace(/\d+(\.\d+)?%/, `${효과값}%`)}</Text>
                      <Text style={[styles.gemBadge, 장착됨 && { color: '#7ed957' }]}>{장착됨 ? '장착' : '해제'}</Text>
                    </TouchableOpacity>
                    {!장착됨 && (
                      <TouchableOpacity
                        style={{ backgroundColor: '#3a2a1a', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3, marginLeft: 4 }}
                        onPress={() => {
                          set보주목록(prev => prev.filter(x => x.id !== g.id))
                          set무색조각(prev => prev + 판매가)
                          메시지표시(`🔷 +${숫자포맷(판매가)}`)
                        }}
                      >
                        <Text style={{ color: '#f5a623', fontSize: 11, fontWeight: 'bold' }}>🔷{숫자포맷(판매가)}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              })
            )}
          </ScrollView>
        </View>
      )}

      {/* 명칭 크리스탈 패널 */}
      {명칭크리스탈패널열림 && (() => {
        type 크탭 = '노말' | '레어' | '유니크' | '갤럭시' | '퀘이사' | '오리진'
        type 크정보 = { 키: keyof 명칭크리스탈목록; 이름: string; 비용: number; 색상: string; 효과: string; 구현: boolean }
        const 크리스탈목록표: Record<크탭, 크정보[]> = {
          노말: [
            { 키: '방어',  이름: '방어의 크리스탈',  비용: 50,  색상: '#4a90e2', 효과: '개별확률 하락 방어 240h (준비중)',      구현: false },
            { 키: '행운',  이름: '행운의 크리스탈',  비용: 50,  색상: '#7ed957', 효과: `개별확률 +${(명칭크리스탈.행운 * 1).toFixed(0)}% (회당+1%)`,    구현: true },
            { 키: '경험',  이름: '경험의 크리스탈',  비용: 50,  색상: '#9b59b6', 효과: '초월경험치 +50% (준비중)',             구현: false },
            { 키: '무력',  이름: '무력의 크리스탈',  비용: 50,  색상: '#e94560', 효과: '51~56강 업그레이드 +2 (준비중)',       구현: false },
            { 키: '절약',  이름: '절약의 크리스탈',  비용: 50,  색상: '#f5a623', 효과: `판매보상 +${(명칭크리스탈.절약 * 5).toFixed(0)}% (회당+5%)`,    구현: true },
            { 키: '총명',  이름: '총명의 크리스탈',  비용: 50,  색상: '#1abc9c', 효과: `무색조각 +${(명칭크리스탈.총명 * 50).toFixed(0)}% (회당+50%)`,  구현: true },
            { 키: '보호',  이름: '보호의 크리스탈',  비용: 50,  색상: '#3498db', 효과: `파괴방지 +${(명칭크리스탈.보호 * 0.2).toFixed(1)}% (회당+0.2%)`, 구현: true },
            { 키: '각성',  이름: '각성의 크리스탈',  비용: 50,  색상: '#e67e22', 효과: '각성의 보석 +100% (준비중)',           구현: false },
          ],
          레어: [
            { 키: '홍색',   이름: '홍색의 크리스탈',  비용: 100, 색상: '#e74c3c', 효과: `개별확률 +${(명칭크리스탈.홍색 * 1).toFixed(0)}% + 하락방어 240h`, 구현: true },
            { 키: '주황',   이름: '주황의 크리스탈',  비용: 100, 색상: '#e67e22', 효과: `판매 +${(명칭크리스탈.주황 * 5).toFixed(0)}% + 무색 +${(명칭크리스탈.주황 * 50).toFixed(0)}%`, 구현: true },
            { 키: '노랑',   이름: '노랑의 크리스탈',  비용: 100, 색상: '#f1c40f', 효과: `파괴방지 +${(명칭크리스탈.노랑 * 0.2).toFixed(1)}% + 각성보석 (준비중)`, 구현: true },
            { 키: '초록',   이름: '초록의 크리스탈',  비용: 100, 색상: '#2ecc71', 효과: '51~56강 업그레이드 +2 + 초월경험치 (준비중)',     구현: false },
            { 키: '파랑',   이름: '파랑의 크리스탈',  비용: 100, 색상: '#3498db', 효과: '51~56강 업그레이드 +2 + 하락방어 240h (준비중)',  구현: false },
            { 키: '남색',   이름: '남색의 크리스탈',  비용: 100, 색상: '#2980b9', 효과: `파괴방지 +${(명칭크리스탈.남색 * 0.2).toFixed(1)}% + 초월경험치 (준비중)`, 구현: true },
            { 키: '보라',   이름: '보라의 크리스탈',  비용: 100, 색상: '#9b59b6', 효과: `개별확률 +${(명칭크리스탈.보라 * 1).toFixed(0)}% + 판매 +${(명칭크리스탈.보라 * 5).toFixed(0)}%`, 구현: true },
            { 키: '하늘색', 이름: '하늘색 크리스탈',  비용: 100, 색상: '#5dade2', 효과: `무색 +${(명칭크리스탈.하늘색 * 50).toFixed(0)}% + 각성보석 (준비중)`, 구현: true },
            { 키: '무색명칭', 이름: '무색의 크리스탈', 비용: 100, 색상: '#bdc3c7', 효과: `초월확률 +${(명칭크리스탈.무색명칭 * 0.2).toFixed(1)}% (회당+0.2%)`, 구현: true },
          ],
          유니크: [
            { 키: '흑색', 이름: '흑색의 크리스탈', 비용: 500, 색상: '#7f8c8d', 효과: `하락방어 60h + 무색 +${(명칭크리스탈.흑색 * 100).toFixed(0)}% + 판매 +${(명칭크리스탈.흑색 * 10).toFixed(0)}% + 초월확률 +${(명칭크리스탈.흑색 * 0.5).toFixed(1)}%`, 구현: true },
            { 키: '백색명칭', 이름: '백색의 크리스탈', 비용: 500, 색상: '#ecf0f1', 효과: `개별확률 +${(명칭크리스탈.백색명칭 * 2).toFixed(0)}% + 파괴방지 +${(명칭크리스탈.백색명칭 * 0.3).toFixed(1)}% + 초월경험치 (준비중)`, 구현: true },
          ],
          갤럭시: [
            { 키: '우주', 이름: '우주의 크리스탈', 비용: 2000, 색상: '#a855f7', 효과: `개별확률 +${(명칭크리스탈.우주 * 5).toFixed(0)}% + 파괴방지 +${(명칭크리스탈.우주 * 0.5).toFixed(1)}% + 초월확률 +${(명칭크리스탈.우주 * 1).toFixed(0)}% + 무색 +${(명칭크리스탈.우주 * 200).toFixed(0)}% + 판매 +${(명칭크리스탈.우주 * 100).toFixed(0)}%`, 구현: true },
          ],
          퀘이사: [
            { 키: '길운Q',  이름: '길운의 크리스탈',  비용: 200, 색상: '#f5a623', 효과: '51~53강 강화확률 +2%p (준비중)', 구현: false },
            { 키: '무구Q',  이름: '무구의 크리스탈',  비용: 200, 색상: '#e94560', 효과: '57~59강 업그레이드 +8 (준비중)', 구현: false },
            { 키: '집중Q',  이름: '집중의 크리스탈',  비용: 200, 색상: '#4a90e2', 효과: '56강 융합확률 +1%p (준비중)',    구현: false },
            { 키: '절제Q',  이름: '절제의 크리스탈',  비용: 200, 색상: '#7ed957', 효과: '융합 필요수 -10% (준비중)',      구현: false },
            { 키: '탐욕Q',  이름: '탐욕의 크리스탈',  비용: 200, 색상: '#f1c40f', 효과: '광산 크레딧 +20% (준비중)',      구현: false },
            { 키: '증식Q',  이름: '증식의 크리스탈',  비용: 200, 색상: '#1abc9c', 효과: '유닛 생산수 +10% (준비중)',       구현: false },
            { 키: '미래Q',  이름: '미래의 크리스탈',  비용: 200, 색상: '#9b59b6', 효과: 'ExPoint +20% (준비중)',           구현: false },
            { 키: '돌파Q',  이름: '돌파의 크리스탈',  비용: 200, 색상: '#e74c3c', 효과: '엑스트라 보스 데미지 +10% (준비중)', 구현: false },
          ],
          오리진: [
            { 키: '창조O', 이름: '창조의 크리스탈', 비용: 1000, 색상: '#ffd700', 효과: '광산 크레딧/ExPoint/데미지/초월경험치 (준비중)', 구현: false },
            { 키: '파멸O', 이름: '파멸의 크리스탈', 비용: 1000, 색상: '#ff4444', 효과: '57~58강 확률/크리티컬/돈/생산량 (준비중)',       구현: false },
          ],
        }
        const 탭목록: 크탭[] = ['노말', '레어', '유니크', '갤럭시', '퀘이사', '오리진']
        const 현재목록 = 크리스탈목록표[명칭크리스탈탭]
        return (
          <View style={styles.prodPanel}>
            <View style={styles.prodHeader}>
              <Text style={styles.prodTitle}>🌟 명칭 크리스탈</Text>
              <TouchableOpacity onPress={() => set명칭크리스탈패널열림(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.prodSubtitle}>🔮 크리스탈조각: {숫자포맷(크리스탈조각)}</Text>
            {/* 탭 */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6, gap: 4 }}>
              {탭목록.map(t => (
                <TouchableOpacity key={t} style={[styles.statTabBtn, 명칭크리스탈탭 === t && styles.statTabBtnOn]} onPress={() => set명칭크리스탈탭(t)}>
                  <Text style={[styles.statTabText, 명칭크리스탈탭 === t && { color: '#000' }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <ScrollView style={{ maxHeight: 300 }}>
              {현재목록.map(info => {
                const 현재수 = 명칭크리스탈[info.키] as number
                const 살수있음 = 크리스탈조각 >= info.비용
                return (
                  <View key={info.키} style={[styles.upgRow, { borderLeftWidth: 3, borderLeftColor: info.색상, paddingLeft: 8, opacity: info.구현 ? 1 : 0.6 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.upgLabel, { color: info.색상 }]}>{info.이름} ×{현재수}</Text>
                      <Text style={[styles.upgEffect, { color: info.구현 ? '#ccc' : '#666' }]}>{info.효과}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.upgBtn, !살수있음 && styles.upgBtnOff]}
                      onPress={() => 명칭크리스탈구입(info.키, info.비용)}
                    >
                      <Text style={styles.upgBtnText}>구입</Text>
                      <Text style={[styles.upgEffect, { color: 살수있음 ? '#fff' : '#666', fontSize: 9 }]}>🔮{info.비용}</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        )
      })()}

      {/* 보석 패널 */}
      {보석패널열림 && (() => {
        const 보석정보: { 종류: 보석타입; 이모지: string; 설명: string; 효과: string }[] = [
          { 종류: '하급',    이모지: '🔸', 설명: '하급 강화의 보석',  효과: `44강 +${(보석.하급 * 0.1).toFixed(1)}% (회당+0.1%)` },
          { 종류: '중급',    이모지: '🔶', 설명: '중급 강화의 보석',  효과: `45강 +${(보석.중급 * 0.1).toFixed(1)}% (회당+0.1%)` },
          { 종류: '상급',    이모지: '💠', 설명: '상급 강화의 보석',  효과: `46강 +${(보석.상급 * 0.1).toFixed(1)}% (회당+0.1%)` },
          { 종류: '특급',    이모지: '🔷', 설명: '특급 강화의 보석',  효과: `47강 +${(보석.특급 * 0.1).toFixed(1)}% (회당+0.1%)` },
          { 종류: '고급',    이모지: '💎', 설명: '고급 강화의 보석',  효과: `48강 +${(보석.고급 * 0.05).toFixed(2)}% (회당+0.05%)` },
          { 종류: '재물',    이모지: '💰', 설명: '재물의 보석',       효과: `자원 +${(보석.재물 * 10).toFixed(0)}% (회당+10%)` },
          { 종류: '경험보석',이모지: '📗', 설명: '경험의 보석',       효과: `경험치 +${(보석.경험보석 * 10).toFixed(0)}% (회당+10%)` },
          { 종류: '보호보석',이모지: '🛡️', 설명: '보호의 보석',       효과: `파괴방지 +${보석.보호보석 * 0.1}% (회당+0.1%)` },
          { 종류: '궁극',    이모지: '🌟', 설명: '궁극 강화의 보석',  효과: `44~47강 각 +${(보석.궁극 * 0.01).toFixed(2)}% (회당+0.01%)` },
          { 종류: '수호',    이모지: '🔮', 설명: '수호의 보석',       효과: `파괴방지 +${(보석.수호 * 0.01).toFixed(2)}% (회당+0.01%)` },
          { 종류: '초월보석',이모지: '✨', 설명: '초월 강화의 보석',  효과: `44~48강 각 +${(보석.초월보석 * 0.01).toFixed(2)}% (회당+0.01%)` },
          { 종류: '인내',    이모지: '🌀', 설명: '인내의 보석',       효과: `51강확률 +${(보석.인내 * 0.001).toFixed(3)}% (회당+0.001%)` },
        ]
        return (
          <View style={styles.prodPanel}>
            <View style={styles.prodHeader}>
              <Text style={styles.prodTitle}>💎 보석 ({Object.values(보석).reduce((s, v) => s + v, 0)}개 보유)</Text>
              <TouchableOpacity onPress={() => set보석패널열림(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.prodSubtitle}>🔷 무색조각: {숫자포맷(무색조각)} · 탭=구입</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {보석정보.map(({ 종류, 이모지, 설명, 효과 }) => {
                const 비용 = 보석구입비용[종류]
                const 보유수 = 보석[종류]
                const ok = 무색조각 >= 비용
                return (
                  <View key={종류} style={styles.upgRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.upgLabel}>{이모지} {설명} <Text style={{ color: '#f5a623' }}>×{보유수}</Text></Text>
                      <Text style={styles.upgEffect}>{효과}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.upgBtn, !ok && styles.upgBtnOff, { minWidth: 70 }]}
                      onPressIn={() => 보석연속시작(종류)}
                      onPressOut={보석연속종료}
                    >
                      <Text style={styles.upgBtnText}>🔷{숫자포맷(비용)}</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        )
      })()}

      {/* 고유유닛 패널 */}
      {고유유닛패널열림 && (() => {
        const 고유DPS현재 = 고유유닛DPS(고유유닛)
        const upgList: { stat: keyof Omit<고유유닛스텟, '위치2'>; 이모지: string; 설명: string; 상한: number }[] = [
          { stat: '공격력',   이모지: '⚔️', 설명: '공격력 +500/강화 (기본500)',         상한: 20 },
          { stat: '공속',     이모지: '⚡', 설명: '공격속도 단계 (1→1.5→2→2.5→3→3.5→4)', 상한: 6 },
          { stat: '경험치',   이모지: '📗', 설명: '경험치 획득 +20%/강화',               상한: 5 },
          { stat: '추가1강',  이모지: '🎯', 설명: '+1강 확률 +0.25%/강화',               상한: 20 },
          { stat: '특수강화', 이모지: '🌟', 설명: '특수강화 확률 +0.5%/강화',            상한: 10 },
          { stat: '파괴방지', 이모지: '🛡️', 설명: '파괴방지 +0.1%/강화',               상한: 200 },
        ]
        return (
          <View style={styles.prodPanel}>
            <View style={styles.prodHeader}>
              <Text style={styles.prodTitle}>🦸 고유유닛 강화</Text>
              <TouchableOpacity onPress={() => set고유유닛패널열림(false)}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.prodSubtitle}>💰 크레딧: {숫자포맷(크레딧)} · 보스 처치 시 획득</Text>
            <Text style={[styles.prodSubtitle, { color: '#7ed957' }]}>
              DPS {숫자포맷(고유DPS현재)} (공격력 {고유유닛공격력(고유유닛)} × 속도 {고유유닛공속(고유유닛).toFixed(1)})
            </Text>
            <Text style={[styles.prodSubtitle, { color: '#a855f7' }]}>
              위치: {고유유닛.위치2 ? '사냥터2 (×2배)' : '사냥터1 (×1배)'}
            </Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {upgList.map(({ stat, 이모지, 설명, 상한 }) => {
                const lv = 고유유닛[stat] as number
                const maxed = lv >= 상한
                const 비용 = maxed ? 0 : 고유유닛강화비용표[stat](lv)
                const ok = !maxed && 크레딧 >= 비용
                return (
                  <View key={stat} style={styles.upgRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.upgLabel}>{이모지} {stat} <Text style={{ color: '#f5a623' }}>Lv.{lv}/{상한}</Text></Text>
                      <Text style={styles.upgEffect}>{설명}</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.upgBtn, !ok && styles.upgBtnOff, { minWidth: 70 }]}
                      onPress={() => 고유유닛강화(stat)}
                    >
                      <Text style={styles.upgBtnText}>{maxed ? 'MAX' : `💰${숫자포맷(비용)}`}</Text>
                    </TouchableOpacity>
                  </View>
                )
              })}
              <View style={styles.divider} />
              <View style={styles.upgRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upgLabel}>📍 위치 변경 <Text style={{ color: '#f5a623' }}>{고유유닛.위치2 ? '사냥터2' : '사냥터1'}</Text></Text>
                  <Text style={styles.upgEffect}>{고유유닛.위치2 ? '사냥터1로 이동 (무료)' : '사냥터2 배치 (💰500)'}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.upgBtn, { backgroundColor: (!고유유닛.위치2 && 크레딧 < 500) ? '#444' : '#4a90e2' }]}
                  onPress={고유유닛위치변경}
                >
                  <Text style={styles.upgBtnText}>{고유유닛.위치2 ? '↩사냥터1' : '💰500'}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        )
      })()}

      {/* 자동화 패널 */}
      {자동패널열림 && (
        <View style={styles.prodPanel}>
          <View style={styles.prodHeader}>
            <Text style={styles.prodTitle}>🤖 자동화</Text>
            <TouchableOpacity onPress={() => set자동패널열림(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.prodSubtitle}>자동 판매가 자동 구입보다 우선 적용</Text>

          {/* 자동 강화 */}
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>🔨 강화 ≤</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동강화최대lv(v => Math.max(1, v - 5))}>
              <Text style={styles.sliderArrowText}>≪</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동강화최대lv(v => Math.max(1, v - 1))}>
              <Text style={styles.sliderArrowText}>◀</Text>
            </TouchableOpacity>
            <Text style={styles.sliderValue}>+{자동강화최대lv}</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동강화최대lv(v => Math.min(49, v + 1))}>
              <Text style={styles.sliderArrowText}>▶</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동강화최대lv(v => Math.min(49, v + 5))}>
              <Text style={styles.sliderArrowText}>≫</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.autoToggle, 자동강화ON && styles.autoToggleOn]}
              onPress={() => set자동강화ON(v => !v)}
            >
              <Text style={styles.autoToggleText}>{자동강화ON ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {/* 자동 판매 */}
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>🛒 판매 =</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동판매lv(v => Math.max(1, v - 5))}>
              <Text style={styles.sliderArrowText}>≪</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동판매lv(v => Math.max(1, v - 1))}>
              <Text style={styles.sliderArrowText}>◀</Text>
            </TouchableOpacity>
            <Text style={styles.sliderValue}>+{자동판매lv}</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동판매lv(v => Math.min(60, v + 1))}>
              <Text style={styles.sliderArrowText}>▶</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동판매lv(v => Math.min(60, v + 5))}>
              <Text style={styles.sliderArrowText}>≫</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.autoToggle, 자동판매ON && styles.autoToggleOnRed]}
              onPress={() => set자동판매ON(v => !v)}
            >
              <Text style={styles.autoToggleText}>{자동판매ON ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {/* 자동 구입 */}
          <View style={styles.sliderRow}>
            <Text style={styles.sliderLabel}>🏭 구입 =</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동구입강도(v => { const i = 생산강도목록.indexOf(v as any); return 생산강도목록[Math.max(0, i - 1)] ?? v })}>
              <Text style={styles.sliderArrowText}>◀</Text>
            </TouchableOpacity>
            <Text style={styles.sliderValue}>+{자동구입강도}</Text>
            <TouchableOpacity style={styles.sliderArrow} onPress={() => set자동구입강도(v => { const i = 생산강도목록.indexOf(v as any); return 생산강도목록[Math.min(생산강도목록.length - 1, i + 1)] ?? v })}>
              <Text style={styles.sliderArrowText}>▶</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.autoToggle, 자동구입ON && styles.autoToggleOn]}
              onPress={() => set자동구입ON(v => !v)}
            >
              <Text style={styles.autoToggleText}>{자동구입ON ? 'ON' : 'OFF'}</Text>
            </TouchableOpacity>
          </View>

          {자동판매ON && 자동구입ON && 자동구입강도 === 자동판매lv && (
            <Text style={{ color: '#e94560', fontSize: 11, marginTop: 4 }}>
              ⚠️ 구입 lv = 판매 lv → 구입 스킵
            </Text>
          )}
        </View>
      )}

      {/* 유닛 생산 패널 */}
      {생산패널열림 && (
        <View style={styles.prodPanel}>
          <View style={styles.prodHeader}>
            <Text style={styles.prodTitle}>🏭 유닛 생산소</Text>
            <TouchableOpacity onPress={() => set생산패널열림(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.prodSubtitle}>강도를 선택하여 마린을 구매하세요</Text>
          <View style={styles.prodGrid}>
            {생산강도목록.map(강도 => {
              const 비용 = 생산비용(강도)
              const 가능 = mineral >= 비용
              return (
                <TouchableOpacity
                  key={강도}
                  style={[styles.prodBtn, !가능 && styles.prodBtnDisabled]}
                  onPress={() => 유닛구매(강도)}
                >
                  <Text style={styles.prodBtnLv}>+{강도}</Text>
                  <Text style={styles.prodBtnCost}>{숫자포맷(비용)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      )}

      {/* 키보드 안내 (PC) */}
      {Platform.OS === 'web' && (
        <View style={styles.controls}>
          <Text style={styles.controlsTitle}>⌨️ 키보드 (PC)</Text>
          <Text style={styles.controlsText}>H=수비 S=정지 Esc=선택해제</Text>
        </View>
      )}

      <TouchableOpacity style={styles.resetButton} onPress={게임초기화}>
        <Text style={styles.resetButtonText}>🔄 초기화</Text>
      </TouchableOpacity>
    </ScrollView>
    </SafeAreaView>
  )
}

// ============================================
// 스타일
// ============================================

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#1a1a2e',
    alignItems: 'center',
    padding: 4,
    paddingTop: 2,
  },
  title: {
    fontSize: 13,
    color: '#e94560',
    fontWeight: 'bold',
    marginBottom: 1,
  },
  statBox: {
    backgroundColor: '#16213e',
    padding: 4,
    borderRadius: 6,
    width: 필드_W,
    alignItems: 'center',
    marginBottom: 2,
  },
  stat: { fontSize: 15, color: '#ffffff', marginBottom: 2 },
  statResource: { fontSize: 14, color: '#7ed957', fontWeight: 'bold' },
  statEX: { fontSize: 13, color: '#f5a623', fontWeight: 'bold', backgroundColor: '#3a2a1a', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 },
  convertBtn: { backgroundColor: '#7ed957', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  convertBtnText: { color: '#000', fontSize: 10, fontWeight: 'bold' },
  autoHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#333' },
  autoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  autoColLv: { width: 40, color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  autoColTog: { flex: 1, color: '#aaa', fontSize: 11, textAlign: 'center' },
  autoToggle: { flex: 1, backgroundColor: '#1f2a48', borderRadius: 4, paddingVertical: 4, marginHorizontal: 2, alignItems: 'center' },
  autoToggleOn: { backgroundColor: '#7ed957' },
  autoToggleOnRed: { backgroundColor: '#e94560' },
  autoToggleText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  autoBuyRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap', gap: 3 },
  autoBuyLv: { backgroundColor: '#1f2a48', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  autoBuyLvOn: { backgroundColor: '#f5a623' },
  autoBuyLvText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  sliderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 4 },
  sliderLabel: { color: '#aaa', fontSize: 11, flex: 1 },
  sliderArrow: { backgroundColor: '#1f2a48', borderRadius: 4, width: 30, height: 28, alignItems: 'center', justifyContent: 'center' },
  sliderArrowText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  sliderValue: { color: '#f5a623', fontSize: 14, fontWeight: 'bold', width: 45, textAlign: 'center' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statSmall: { fontSize: 12, color: '#aaaaaa' },
  statBatch: {
    fontSize: 14,
    color: '#f5a623',
    fontWeight: 'bold',
    backgroundColor: '#3a2a1a',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tabBar: {
    flexDirection: 'row',
    width: 필드_W,
    marginBottom: 2,
    gap: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 3,
    paddingHorizontal: 4,
    backgroundColor: '#16213e',
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tabActive: {
    borderColor: '#7ed957',
    backgroundColor: '#2a3a2a',
  },
  tabActiveRed: {
    borderColor: '#e94560',
    backgroundColor: '#3a2a2a',
  },
  tabText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
  selectedBar: {
    width: 필드_W,
    maxHeight: 50,
    marginBottom: 6,
  },
  selectedBarContent: {
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  selectedLabel: { color: '#aaaaaa', fontSize: 12, marginRight: 4 },
  selectedChip: {
    backgroundColor: '#16213e',
    borderColor: '#7ed957',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  selectedChipEmoji: { fontSize: 14 },
  selectedChipLv: { color: '#f5a623', fontSize: 11, fontWeight: 'bold' },
  field: {
    width: 필드_W,
    height: 필드_H,
    backgroundColor: '#0d1421',
    borderWidth: 2,
    borderColor: '#444',
    borderRadius: 8,
    overflow: 'hidden',
  },
  fieldInner: {
    position: 'absolute' as const,
    top: 0, left: 0,
    width: 필드_W,
    height: 필드_H,
    cursor: 'crosshair',
  } as any,
  fieldAttackMode: { borderColor: '#e94560' },
  zone: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 8,
    padding: 6,
  },
  zoneLabel: { fontSize: 11, fontWeight: 'bold' },
  enemy: {
    position: 'absolute',
    width: 적_크기,
    height: 적_크기,
    borderRadius: 적_크기 / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#8a4a4a',
  },
  enemyText: { fontSize: 16 },
  bossLabel: { position: 'absolute', width: 120, textAlign: 'center', color: '#ff6b6b', fontSize: 10, fontWeight: 'bold' },
  hpBarBg: { position: 'absolute', width: 100, height: 8, backgroundColor: '#333', borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: '#555' },
  hpBarFill: { height: '100%', backgroundColor: '#ff6b6b' },
  hpText: { position: 'absolute', width: 120, textAlign: 'center', color: '#fff', fontSize: 9, fontWeight: 'bold' },
  marine: {
    position: 'absolute',
    width: 마린_크기,
    height: 마린_크기,
    backgroundColor: '#16213e',
    borderRadius: 마린_크기 / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  marineText: { fontSize: 14 },
  marineLv: {
    position: 'absolute',
    color: '#f5a623',
    fontSize: 9,
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
  },
  selectRing: {
    position: 'absolute',
    width: 마린_크기 + 6,
    height: 마린_크기 + 6,
    borderRadius: (마린_크기 + 6) / 2,
    borderWidth: 2,
    borderColor: '#7ed957',
  },
  rangeRing: {
    position: 'absolute',
    borderRadius: 공격사거리,
    borderWidth: 1,
    borderColor: 'rgba(126, 217, 87, 0.25)',
    borderStyle: 'dashed',
  },
  dragBox: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: '#7ed957',
    backgroundColor: 'rgba(126, 217, 87, 0.15)',
  },
  cursorHint: {
    position: 'absolute',
    top: 8,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#e94560',
    fontWeight: 'bold',
    fontSize: 12,
  },
  actionBar: {
    flexDirection: 'row',
    width: 필드_W,
    marginTop: 4,
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 4,
    gap: 3,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 6,
    backgroundColor: '#1f2a48',
    borderRadius: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionBtnActive: {
    borderColor: '#7ed957',
    backgroundColor: '#2a3a2a',
  },
  actionBtnActiveRed: {
    borderColor: '#e94560',
    backgroundColor: '#3a2a2a',
  },
  actionBtnEmoji: { fontSize: 20 },
  actionBtnText: { color: '#ffffff', fontSize: 10, marginTop: 1, fontWeight: '600' },
  smallBtnBar: {
    flexDirection: 'row',
    width: 필드_W,
    marginBottom: 2,
    gap: 3,
  },
  smallBtn: {
    flex: 1,
    backgroundColor: '#1f2a48',
    borderRadius: 5,
    paddingVertical: 3,
    alignItems: 'center',
  },
  smallBtnText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  statRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  statLabel: { color: '#aaa', fontSize: 11, flex: 1 },
  statVal: { color: '#f5a623', fontSize: 13, fontWeight: 'bold', minWidth: 40, textAlign: 'right', marginRight: 4 },
  statBtn: { backgroundColor: '#e94560', borderRadius: 4, width: 28, height: 24, alignItems: 'center', justifyContent: 'center' },
  statBtnOff: { backgroundColor: '#444' },
  statBtnText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 6 },
  upgRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#222' },
  upgLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  upgEffect: { color: '#aaa', fontSize: 11, marginTop: 1 },
  upgBtn: { backgroundColor: '#e94560', borderRadius: 5, paddingHorizontal: 10, paddingVertical: 8, minWidth: 80, alignItems: 'center' },
  upgBtnOff: { backgroundColor: '#444' },
  upgBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  gemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6, borderTopWidth: 1, borderTopColor: '#222', gap: 8 },
  gemRowEq: { backgroundColor: '#1a3a1a' },
  gemGrade: { color: '#f5a623', fontSize: 11 },
  gemType: { color: '#fff', fontSize: 13, fontWeight: 'bold', width: 50 },
  gemEffect: { color: '#7ed957', fontSize: 12, flex: 1 },
  gemBadge: { color: '#888', fontSize: 11, fontWeight: 'bold' },
  hintBar: {
    width: 필드_W,
    marginTop: 2,
    backgroundColor: '#16213e',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  hintText: { color: '#7ed957', fontSize: 10, fontWeight: '600' },
  message: {
    marginTop: 2,
    fontSize: 12,
    color: '#f5a623',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  zoneInfo: {
    marginTop: 2,
    width: 필드_W,
    backgroundColor: '#16213e',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 4,
  },
  zoneInfoText: { color: '#aaaaaa', fontSize: 9, marginVertical: 0 },
  backButton: {
    marginTop: 10,
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#7ed957',
    width: 필드_W,
    alignItems: 'center',
  },
  backButtonText: { color: '#7ed957', fontSize: 14, fontWeight: 'bold' },
  prodPanel: {
    position: 'absolute',
    top: 150,  // stat/tab/smallBtn 아래
    left: 8,
    right: 8,
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#7ed957',
    zIndex: 100,
    maxHeight: 화면H - 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 12,
  },
  prodHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  prodTitle: { color: '#7ed957', fontSize: 16, fontWeight: 'bold' },
  closeBtn: { color: '#aaa', fontSize: 20, paddingHorizontal: 8 },
  prodSubtitle: { color: '#aaaaaa', fontSize: 11, marginBottom: 8 },
  prodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'space-between',
  },
  prodBtn: {
    width: '23%',
    backgroundColor: '#1f2a48',
    borderRadius: 6,
    padding: 6,
    alignItems: 'center',
    marginBottom: 4,
  },
  prodBtnDisabled: { opacity: 0.4 },
  prodBtnLv: { color: '#f5a623', fontSize: 14, fontWeight: 'bold' },
  prodBtnCost: { color: '#aaaaaa', fontSize: 10, marginTop: 1 },
  controls: {
    backgroundColor: '#16213e',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 3,
    width: 필드_W,
  },
  controlsTitle: { color: '#e94560', fontSize: 10, fontWeight: 'bold', marginBottom: 0 },
  controlsText: { color: '#aaaaaa', fontSize: 9 },
  resetButton: {
    marginTop: 4,
    backgroundColor: '#333',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  resetButtonText: { color: '#aaa', fontSize: 10 },
  statTabBtn: {
    flex: 1, backgroundColor: '#1f2a48', borderRadius: 6,
    paddingVertical: 5, alignItems: 'center', borderWidth: 1, borderColor: '#444',
  },
  statTabBtnOn: { backgroundColor: '#7ed957', borderColor: '#7ed957' },
  statTabText: { color: '#aaa', fontSize: 12, fontWeight: 'bold' },
})
