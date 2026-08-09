# 배포 — Cloudflare Pages

게임은 이미 정적 사이트입니다. **빌드 단계가 없고** `www/`를 그대로 올리면 됩니다.
저장소에 필요한 설정은 전부 커밋되어 있습니다.

| 파일 | 역할 |
|---|---|
| `wrangler.toml` | `pages_build_output_dir = "www"` — 출력 폴더 지정 |
| `www/_headers` | 캐시·보안 헤더. HTML은 `no-cache`(배포가 바로 반영되도록), 아이콘은 30일 |
| `.gitignore` | `node_modules/`, `android/`, 키스토어, 스크린샷 하네스 제외 |

로컬 저장소는 이미 초기화되어 첫 커밋까지 되어 있습니다 (`main` 브랜치).

---

## 남은 두 단계 — 계정 인증이 필요합니다

제가 대신 로그인할 수 없는 부분입니다. 이 PC에 `gh` CLI도, Cloudflare 인증도 없습니다.

### 1) GitHub에 올리기

GitHub에서 **빈 저장소** `mr-burger`를 하나 만든 다음 (README/`.gitignore` 추가 체크 해제):

```bash
cd "c:\Users\ojh99\OneDrive\바탕 화면\AI Agent\mr-burger"
git remote add origin https://github.com/<your-account>/mr-burger.git
git push -u origin main
```

`gh` CLI를 쓰신다면 저장소 생성까지 한 줄입니다:

```bash
winget install --id GitHub.cli      # 아직 없다면
gh auth login
gh repo create mr-burger --public --source=. --push
```

### 2) Cloudflare Pages에 연결

**대시보드 경로 (요청하신 GitHub 연동 — 푸시할 때마다 자동 배포)**

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**
2. **Connect to Git** → GitHub 승인 → `mr-burger` 저장소 선택
3. 빌드 설정:
   - Framework preset: **None**
   - Build command: **비워둘 것**
   - Build output directory: **`www`**
   - (`wrangler.toml`이 있어서 대부분 자동으로 잡힙니다)
4. **Save and Deploy**

1~2분 뒤 `https://mr-burger.pages.dev` 로 접속됩니다. 이후 `git push` 할 때마다 자동 재배포됩니다.

**CLI로 바로 올리기 (GitHub 없이, 제일 빠름)**

```bash
npx wrangler login          # 브라우저가 열립니다 — 여기서 승인해 주셔야 합니다
npx wrangler pages deploy   # wrangler.toml이 www/를 알아서 씁니다
```

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
