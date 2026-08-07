# 베플리카 — Render 배포 가이드

Node + SQLite 앱을 Render에 올려 **고정 주소 · 상시 · HTTPS**로 운영합니다.
(PC·터널 필요 없음. `render.yaml`이 서비스+영구 디스크를 자동 구성합니다.)

---

## 1단계. GitHub에 코드 올리기 (내 계정에서)

이미 로컬 커밋은 되어 있습니다(`main` 브랜치). GitHub 저장소만 만들어 push 하면 됩니다.

1. https://github.com/new 에서 새 저장소 생성 (예: 이름 `beplica`, **Private** 권장, README 등 추가 옵션은 체크 안 함)
2. 터미널에서:

```bash
cd /Users/long/Desktop/Personal/Mobile/jem
git remote add origin https://github.com/<내계정>/beplica.git
git push -u origin main
```

> 커밋 작성자 정보를 바꾸고 싶으면(선택):
> `git config user.name "이름"` / `git config user.email "메일"`

---

## 2단계. Render에서 배포

1. https://render.com 가입 (GitHub 계정으로 로그인 추천)
2. 대시보드 → **New +** → **Blueprint**
3. 방금 만든 GitHub 저장소 연결 → Render가 `render.yaml`을 읽어 자동 구성
   - 서비스 `beplica` (Node, **Starter 플랜 ≈ $7/월**, Singapore 리전)
   - 영구 디스크 1GB (`/var/data` — SQLite·업로드 저장)
   - `SESSION_SECRET` 자동 생성
4. **Apply / Deploy** → 결제 정보 입력(Starter 플랜) → 빌드 대기 (수 분)
5. 완료되면 주소 발급: `https://beplica.onrender.com`
   - (이름이 이미 있으면 뒤에 접미사가 붙거나 다른 이름으로 바꾸면 됨)

첫 접속 시 샘플 데이터가 자동 시드됩니다.
- 소비자: 위 주소 / 관리자: 위 주소 + `/admin`
- 로그인: 본사 `jem`/`jem1234`, 가게 `greenfair`/`shop1234` 등

---

## 이후 운영

- **코드 수정 → GitHub `main`에 push 하면 자동 재배포** (`autoDeploy: true`)
- **데이터·업로드는 영구 디스크(`/var/data`)에 저장**되어 재배포에도 유지됨
- **커스텀 도메인**: Render 서비스 → Settings → Custom Domains 에서 내 도메인 연결 가능

## 참고 / 한계

- **로그인 세션은 메모리 저장**이라, 재배포·재시작 시 로그아웃됩니다(다시 로그인하면 됨). 데모/초기 운영엔 무방.
- 지금 로컬/터널에서 쌓인 데이터(예: 데모 중 만든 주문)는 Render로 자동 이전되지 않습니다. Render는 새로 시드된 샘플로 시작합니다.
- 규모가 커지면: 인스턴스 등급 상향(돈만 추가) → 아주 커지면 SQLite→Postgres 이전.
