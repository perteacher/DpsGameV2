# DPS 강화하기 — 개발 핸드오프 문서

> 스타크래프트 유즈맵 "DPS 강화하기"를 **React Native / Expo (웹 정적 export)** 방치형 RPG 웹게임으로 이식. GitHub Pages 배포.

## 1. 기본 정보
- **소스 경로(현 PC)**: `C:\Users\Administrator\DpsGame`
- **라이브 URL**: https://perteacher.github.io/DpsGameV2/  (2026-06-14 변경, 기존 dnjsrmstm1.github.io에서 이전)
- **배포 대상 리포**: `perteacher/DpsGameV2` (git remote 이름 = `neworigin`) — ⚠️ `DpsGame` 아님! 새 환경에선 remote/PAT를 perteacher로 설정.
- **언어**: 식별자·주석 전부 한글.

## 2. 기술 스택
- Expo (웹 static export: `npx expo export --platform web`), Expo Router
- Firebase: `firebase/app`, `firebase/auth`(이메일/비번), `firebase/firestore`(getDoc/setDoc merge, onSnapshot) — 클라우드 세이브
- AsyncStorage(`@react-native-async-storage/async-storage`) — 로컬 세이브, 키 `dps_game_save_v4`
- gh-pages 배포 (캐시 ~10분 → 테스트 시 하드 새로고침 Ctrl+Shift+R 필수)

## 3. 핵심 파일
- `src/app/index.tsx` (~4500줄) — **게임 전체 로직**(틱 루프, 강화, 사냥/보스, 통화, 상점, UI). 단일 거대 파일.
- `src/AuthBox.tsx` — 로그인 게이트 + 클라우드 세이브 동기화 + 단일 세션.
- `src/firebase.ts` — Firebase 설정 + cloudLoadRaw/cloudSaveRaw/claimSession/watchSave.

## 4. 빌드 & 배포 워크플로 (매 변경마다)
```bash
cd /c/Users/Administrator/DpsGame
npx tsc --noEmit -p tsconfig.json          # 타입체크
npx expo export --platform web              # dist/ 생성
git add -A && git commit -m "..."
git push neworigin master
npx gh-pages -d dist -r "https://perteacher:<GITHUB_PAT>@github.com/perteacher/DpsGameV2.git"
```
- `<GITHUB_PAT>` = perteacher 계정의 GitHub Personal Access Token (이 문서엔 비밀상 미기재 — git remote 설정 또는 비번관리자에 있음).
- (구 환경은 dnjsrmstm1 계정/PAT 였음. 2026-06-14 perteacher로 이전.)
- **BUILD 라벨**: 타이틀에 `BUILD C31` 식으로 표시. 변경 배포마다 C## 증가 → 사용자가 캐시된 옛 빌드인지 확인용. (현재 C31)
- 사용자는 본인 기기(PC/태블릿)에서 라이브 URL로 검증. 로컬 preview 안 씀.

## 5. 원본 수치 출처 (엑셀)
- **`C:\Users\Administrator\Desktop\기본\유닛 기본 수치.xlsx`** (Sheet1, A1:H61) — **강별 권위 수치**:
  - A=강화단계, B=기본공격력, C=1업당수치, D=공격속도, **E=판매경험치(일반)**, **F=판매경험치(초월)**, G=판매시 무조건 획득 재화, H=확률 획득 재화.
  - 51강=판매불가(강화실패시 초월경험 1). 52~56강=초월XP(F열: 500/8000/10만/140만/2500만)+크리조각+박스. 57~60강=응무조+퀘이사박스(초월XP 없음).
- **`C:\Users\Administrator\Downloads\DPS계산기(뉴비용).xlsx`**:
  - `old1` K열 = 보석 강화 비용 공식 (게임 `보석현재비용`과 일치 확인됨).
  - `DB1` A열 = 레벨별 누적 필요경험 → **레벨업 필요경험 = `3*lv*(lv-1)+10`** (캐릭레벨·초월레벨 둘 다 이 공식. 초월1렙=10).
- xlsx 분석: python openpyxl (`data_only=True`=값). 한글은 UTF-8 파일로 덤프 후 읽기.

## 6. 게임 시스템 요약 (현재 밸런스값)
- **강화 1~60강**: `강화확률표`(원본 실측) × 밴드배율(초반0.73/중반1.0). 51강=초월시도(`0.005 + (추가초월확률+명칭+초월레벨)*0.00001 + 보석`). **초월레벨 1당 +0.001%**.
- **통화**: 미네랄(💎 메인), 크레딧(판매비용 sink), ExPoint(⭐ 가챠/패시브), 무색조각, 응무조, 크리스탈조각/상급, 각성의보석, 초월P(초월잔여포인트), 초월XP(초월경험치).
- **사냥터1/2/3**: lv≤25→1, ≤40→2, else→3. tier3(허수광산)=크레딧+미네랄. `소득배수(lv)`: 51강+ = `9000*3^(lv-51)` (50강 대비 ~1.03배 보정). 크레딧도 소득배수 적용.
- **고유유닛 단수**: income효과 = `√단수` (채광력보너스=√단수-1, Lv3단수배율=√단수). 40억단 목표 대비 지수폭주 방지.
- **보스존**: 10단계 DPS게이트(`huntingDPS >= 보스게이트`). 10클리어 후 **엑스트라 보스존**(입장 불가, DPS 수입구동 안 함).
- **판매**: `판매보상(lv)`(45~60강, 엑셀 일치). 초월XP=`판매보상.ExP`(엑셀 F열). 30만 캐릭레벨 전엔 51강+ 판매불가(적립X).
- **환생**: `누적50강생산 × 100` ExPoint 지급 후 리셋. (50강 강화/자동·수동구입 모두 카운트)
- **🎯 최종 목표**: 60강 유닛 **20만 마리 희생**(판매)(`누적60강희생`).

## 7. ⚠️ 반복된 핵심 버그 패턴 — STALE REF
게임 틱 루프가 React 리렌더보다 빨리 여러 번 돈다. `XRef.current`는 렌더 때만 state로 갱신되므로 **틱 간 stale**. 잔액을 ref로 게이팅/계산하면 같은 값에 중복 차감 → **과지출/음수/유실**.
- **규칙**: 틱 안에서 통화 변동 시 `set X(...)`와 함께 **`XRef.current`도 즉시 동기화**.
- 적용 완료: 크레딧, 초월경험치, mineral, 최고DPS.
- `set X(prev => prev + delta)` 형태(함수형)는 안전. ref로 읽어서 계산하는 곳만 위험.

## 8. 클라우드 동기화 설계 (AuthBox — 고생해서 안정화함)
- **진행도 기준**: 최고강 높은 쪽 채택. 동점 → `마지막저장시간` 최근 우선.
- **계정-기기 바인딩** (`저장키+'_uid'`): 새 계정 로그인 시 이 기기의 다른 계정 로컬 안 물려받음(클라우드 비면 새로 시작).
- **safeReload**: 시간창 가드(10초 3회 초과 차단) — 무한 새로고침 방지.
- **sessionStorage `dps_adopt` 핸드오프**: 채택한 클라우드 데이터를 reload 후 게임이 우선 로드(autosave가 못 덮음). ← 동기화가 화면에 반영 안 되던 핵심 버그 해결책.
- **단일 세션**: 새 기기 로그인하면 기존 기기 로그아웃(kick). 점유 직후 3초 grace로 자기-킥 방지.
- **업로드 가드**: 클라우드 최고강이 더 높으면 낮은 기기가 못 덮음.
- 남은 저위험 이슈: 최고강 동점 + 저장시각 0(구save)이면 로컬이 클라우드 덮을 수 있음.

## 9. 작업 방식 (사용자 선호)
- **케이브맨 모드**(짧은 한국어) + **cavecrew 서브에이전트**(investigator/builder/reviewer)로 컨텍스트 절약.
- 변경 후 **자동 배포**(타입체크→export→commit→push→gh-pages). 끝까지 완수, 확인 떠넘기지 말 것.
- 밸런스 수치는 사용자 결정 사항 — 애매하면 묻되, "알아서 해줘" 하면 합리적으로 정하고 알려줌.

## 10. 빌드 히스토리 (최근)
- C12~C21: 클라우드 동기화 안정화(진행도 기준, 계정바인딩, reload 가드, sessionStorage 핸드오프, 단일세션).
- C22: 보스존 자동교전 + 엑스트라 보스존 표시.
- C23: 51강+ 경제(소득배수 5만→9000, 크레딧에 소득배수 적용) + 50강 생산 환생카운트.
- C24/C26/C27: stale-ref 동기화(크레딧/초월경험/mineral/최고DPS).
- C25: 단수 income 지수→√단수 + 엑스트라 보스존 입장차단.
- C26: 초월 미해금 전 51강+ 판매불가 + 엑보존 수입차단.
- C28~C31: 초월XP 수급 — 원인은 `판매보상.ExP`가 ExPoint로 새던 것 → 초월XP로 redirect(C29). C31에서 엑셀 F열과 정확히 일치(중복표 제거) + 52강 판매비용 1e12 원복.
