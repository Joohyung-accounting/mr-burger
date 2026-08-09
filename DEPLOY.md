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
