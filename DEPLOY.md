# 배포 — Cloudflare Pages

게임은 이미 정적 사이트입니다. **빌드 단계가 없고** `www/`를 그대로 올리면 됩니다.
저장소에 필요한 설정은 전부 커밋되어 있습니다.

| 파일 | 역할 |
|---|---|
| `wrangler.toml` | `[assets] directory = "./www"` — Workers 정적 자산으로 배포 |
| `www/_headers` | 캐시·보안 헤더. HTML은 `no-cache`(배포가 바로 반영되도록), 아이콘은 30일 |
| `.gitignore` | `node_modules/`, `android/`, 키스토어, 스크린샷 하네스 제외 |

> Cloudflare 대시보드가 이제 Workers 중심으로 바뀌어서 Deploy command에
> `npx wrangler deploy`를 기본값으로 넣어줍니다. 그래서 설정을 Pages 형식
> (`pages_build_output_dir`)에서 **Workers 정적 자산 형식**으로 맞췄습니다.
> 서빙 결과는 동일하고 `_headers`도 그대로 적용됩니다.

로컬 저장소는 이미 초기화되어 첫 커밋까지 되어 있습니다 (`main` 브랜치).

### 서체 — 웹은 그대로, 스토어 빌드는 내재화 권장

Organic 스킨은 **Caprasimo**(디스플레이)와 **Figtree**(본문)를 씁니다.
`index.html`이 Google Fonts에서 `display=swap`으로 받아오고, CSS에는 실제
폴백 스택(`Trebuchet MS` → `Segoe UI` → `system-ui`)이 들어 있어서
**네트워크가 없어도 레이아웃은 동일**하고 글자만 폴백으로 나옵니다.

웹 배포는 이대로 두면 됩니다. **Capacitor 빌드는 내재화를 권합니다** —
설치형 앱의 첫 실행이 비행기 모드일 수 있고, 그때 타이틀이 폴백으로 뜹니다.

1. 두 서체의 `woff2`를 받아 `www/fonts/`에 넣습니다
   (Caprasimo 400, Figtree 400/600/700 — 둘 다 OFL).
2. `index.html`의 `<link rel="preconnect">` 2줄과 Google Fonts `<link>`를 지우고,
   `css/style.css` 맨 위에 `@font-face` 5개를 `font-display: swap`으로 선언합니다.
3. `--font-heading` / `--font-body` 값은 건드리지 않습니다 — 이름이 같습니다.

`www/_headers`에 `/fonts/*`를 `public, max-age=2592000`으로 추가하면
웹 쪽 캐시도 아이콘과 같아집니다.

---

## 인앱 구매를 붙이기 전에

게임 안의 상점(THE OUTFITTERS)은 완성돼 있지만 **결제는 연결돼 있지 않습니다.**
`www/js/billing.js`가 샌드박스 어댑터로 돌고, 구매 버튼은 돈을 받지 않고 그냥
성공을 돌려줍니다. 상점 화면이 그 사실을 자기 입으로 말합니다.

> **샌드박스가 켜진 채로 출시하면 안 됩니다.** 판정은 `Billing.sandbox` 하나입니다.

### 1) 어댑터 갈아끼우기

`billing.js`는 다섯 개 함수만 아는 이음매입니다 —
`start / priceOf / purchase / restore`(+ `verify`). Play 쪽 구현을 만들어
`Billing.use(impl)`로 넘기면 UI는 한 줄도 안 바뀝니다.
`@capacitor-community/in-app-purchases`나 Play Billing Library를 감싼
작은 플러그인이면 됩니다.

### 2) Play Console에 상품 만들기

SKU는 `Core.STORE`에 있는 그대로입니다.

| SKU | 유형 |
|---|---|
| `mrb.skin.garden` `mrb.skin.berry` `mrb.skin.head` `mrb.skin.night` `mrb.skin.gold` | 관리형 상품 (1회) |
| `mrb.gear.clogs` `mrb.gear.thermo` `mrb.gear.awning` | 관리형 상품 (1회) |
| `mrb.till.small` `mrb.till.big` | **소모품** (다시 살 수 있어야 함) |

**가격은 코드에 없습니다.** 지역·세금·프로모션은 스토어가 관리하고,
`"$2.99"`를 코드에 박으면 첫날부터 어딘가에서 틀립니다. `priceOf()`가
스토어에서 받은 문자열을 그대로 보여주고, 아직 안 왔으면 티어 동전이 대신 섭니다.

### 3) 영수증 검증 — 이건 선택이 아닙니다

지금 소유 정보는 **기기의 세이브 파일**에 있습니다. 그건 플레이어의 파일이고,
누구든 고칠 수 있습니다. `Core.sanitiseSave`는 이 빌드가 실제로 파는 id만
통과시키지만, 그건 정리이지 보안이 아닙니다.

구매를 사실로 만드는 건 영수증입니다 — 플랫폼 토큰을 서버로 보내고,
서버가 Google Play Developer API로 검증하고, **서버가 소유를 말합니다.**
`Billing.verify()`가 그 자리이고 지금은 그냥 true를 돌려줍니다.
`worker/index.js`와 D1이 이미 클라우드 세이브를 들고 있으니 붙일 곳은 있습니다.

그때까지 로컬 소유는 **신뢰**이지 증거가 아닙니다. 그래서 파는 물건 중에
난이도 시뮬레이션이 읽는 숫자를 움직이는 건 하나도 없습니다 — 위조돼도
스킨 하나 더 입는 것 이상은 아무 일도 일어나지 않습니다.

### 4) Play 정책상 빠뜨리면 반려되는 것들

- **구매 복원** — 이미 화면에 있습니다(`RESTORE PURCHASES`). 어댑터의
  `restore()`가 실제 소유 SKU를 돌려주게만 하면 됩니다.
- **소모품 소비 처리** — `mrb.till.*`는 지급 후 `consume` 해야 다시 팔립니다.
  안 하면 두 번째 구매가 막힙니다.
- **결제 정보는 앱이 만지지 않습니다** — 카드번호를 받는 화면을 만들지 마세요.
  Play 결제창이 전부 처리하고, 데이터 보안 양식에도 그렇게 신고합니다.
- **환불/취소** — 취소는 오류가 아닙니다. `buy()`가 `{ ok:false, reason:'cancelled' }`를
  돌려주고 UI는 아무 말도 하지 않습니다. 그대로 두세요.

---

## 1) GitHub — 완료됨 ✅

`https://github.com/Joohyung-accounting/mr-burger` (public) 에 `main` 브랜치로 올라가 있습니다.

## 2) Cloudflare 연결 — 여기만 남았습니다

### 왜 실패했나

두 가지가 겹쳤습니다.

1. **저장소 목록에 `mr-burger`가 안 뜸** — Cloudflare의 GitHub App이 그 저장소에
   접근 권한을 못 받았습니다. 그래서 "Clone a public repository via Git URL"로
   우회하게 되는데,
2. **그 경로는 Cloudflare가 새 저장소를 만들려고 합니다** — 화면에도
   "A Git repository will be created for you"라고 쓰여 있습니다.
   그런데 `mr-burger`는 이미 존재하므로 이름이 충돌해서
   *"unable to create a repository ... create one manually"* 오류가 납니다.

### ✅ 해법 A — GitHub App에 권한 주고 기존 저장소 연결 (권장)

1. GitHub → 우측 상단 프로필 → **Settings**
2. 왼쪽 맨 아래 **Integrations → Applications** → **Installed GitHub Apps**
3. **Cloudflare Workers and Pages** → **Configure**
4. **Repository access**
   - `All repositories` 선택, 또는
   - `Only select repositories` → **Select repositories** → `mr-burger` 추가
5. **Save**
6. Cloudflare 화면으로 돌아가 새로고침 → 이제 목록에 `mr-burger`가 뜹니다.
   Git URL 칸은 **비우고** 목록에서 선택하세요

이러면 저장소를 새로 만들 필요가 없어서 그 오류 자체가 발생하지 않습니다.

### ✅ 해법 B — 이름 충돌만 피하기

해법 A가 번거로우면, "Clone a public repository" 경로를 그대로 쓰되
**Project name을 `mr-burger`가 아닌 다른 이름**(예: `mr-burger-game`)으로 바꾸세요.
Cloudflare가 그 이름으로 새 저장소를 만들므로 충돌하지 않습니다.
다만 **원본과 분리된 복사본**이 되어, 앞으로 이 폴더에서 `git push` 해도
자동 배포되지 않습니다.

### 빌드 설정 (어느 경로든 동일)

| 항목 | 값 |
|---|---|
| Production branch | `main` |
| Build command | **비워둘 것** |
| Deploy command | `npx wrangler deploy` |

`wrangler.toml`이 `www/`를 정적 자산으로 지정하고 있어서 나머지는 자동입니다.
`Build output directory` 칸은 이 방식에선 필요 없습니다.

### ✅ 해법 C — CLI로 바로 (제일 확실, 대시보드 안 거침)

```bash
cd "c:\Users\ojh99\OneDrive\바탕 화면\AI Agent\mr-burger"
npx wrangler login     # 브라우저가 열립니다 — 승인해 주세요
npx wrangler deploy
```

`https://mr-burger.<계정>.workers.dev` 로 바로 올라갑니다.
검증 완료: `npx wrangler deploy --dry-run`이 `www`에서 자산을 정상적으로 읽습니다.

> 이 방식은 Git 자동배포가 붙지 않습니다. 나중에 붙이려면 해법 A로 저장소를
> 연결하면 됩니다 (같은 프로젝트에 이어서 연결 가능).

---

## 확인

배포 후 점검할 것:

- [ ] 폰에서 열어서 세로 화면 레이아웃 확인
- [ ] 첫 탭(PLAY) 후 소리와 BGM이 나오는지 — 브라우저는 사용자 조작 전에 오디오를 막습니다
- [ ] "홈 화면에 추가"로 설치되는지 (`manifest.json`이 이미 있습니다)
- [ ] 재배포 후 새로고침 한 번에 새 버전이 뜨는지 (`_headers`의 `no-cache` 덕분에 그래야 합니다)

## 참고

- 커스텀 도메인은 Pages 프로젝트 → **Custom domains**에서 붙입니다
- 이 저장소는 Play Store용 Capacitor 설정도 함께 들고 있습니다 (`capacitor.config.json`).
  웹 배포와 앱 빌드가 같은 `www/`를 공유합니다
