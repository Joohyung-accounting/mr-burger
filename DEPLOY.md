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

## 1) GitHub — 완료됨 ✅

`https://github.com/Joohyung-accounting/mr-burger` (public) 에 `main` 브랜치로 올라가 있습니다.

## 2) Cloudflare Pages 연결 — 여기만 남았습니다

### ⚠️ "create a repository manually and deploy from an existing repository" 오류가 뜬다면

Cloudflare의 **템플릿/프레임워크 시작하기** 경로를 타면 Cloudflare가 GitHub에
저장소를 *대신 만들려고* 시도하고, 권한이 없으면 이 오류가 납니다.
저장소는 이미 있으니 그 경로를 쓸 필요가 없습니다. **기존 저장소를 연결하는 경로**로 가세요.

### 올바른 경로

1. [dash.cloudflare.com](https://dash.cloudflare.com) → 왼쪽 **Compute (Workers & Pages)**
2. **Create** 버튼 → 상단 탭에서 **Pages** 선택
   *(Workers 탭이나 "Start with a template"이 아니라 Pages 탭입니다)*
3. **Connect to Git** → **GitHub** → 계정 승인
4. GitHub App 권한 화면에서 **반드시 `mr-burger`에 접근을 허용**하세요
   - `All repositories` 또는 `Only select repositories` → `mr-burger` 체크
   - 여기서 빠뜨리면 다음 화면 목록에 저장소가 안 뜹니다
5. 저장소 목록에서 `Joohyung-accounting/mr-burger` 선택 → **Begin setup**
6. 빌드 설정:
   | 항목 | 값 |
   |---|---|
   | Project name | `mr-burger` |
   | Production branch | `main` |
   | Framework preset | **None** |
   | Build command | **비워둘 것** |
   | Build output directory | **`www`** |
7. **Save and Deploy**

1~2분 뒤 `https://mr-burger.pages.dev` 로 접속됩니다.
이후 `git push` 할 때마다 자동 재배포됩니다.

### 그래도 안 되면 — CLI 직접 업로드

```bash
npx wrangler login          # 브라우저가 열립니다 — 여기서 승인 필요
npx wrangler pages deploy   # wrangler.toml이 www/를 알아서 씁니다
```

> **주의**: 이렇게 만든 프로젝트는 **Direct Upload** 타입이 되고, 나중에 같은 이름으로
> Git 연동으로 바꿀 수 없습니다. Git 자동배포를 원하시면 프로젝트를 지우고 위 경로로
> 다시 만들거나, CLI로는 다른 이름(`mr-burger-cli` 등)을 쓰세요.

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
