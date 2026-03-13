# Final Cut Pro CLI / MCP

macOS에서 설치된 Final Cut Pro를 로컬 CLI 또는 MCP 서버로 감싸서, 사람이 직접 누르지 않고도 AI가 작업을 호출할 수 있게 만드는 프로젝트입니다.

## 용도

이 프로젝트는 이런 경우를 위한 것입니다.

- Final Cut Pro는 이미 설치되어 있고, AI에게 반복 작업을 시키고 싶은 경우
- 영상 편집을 자세히 모르지만 자연어로 AI에게 시켜서 작업 흐름을 단순화하고 싶은 경우
- Final Cut Pro의 현재 상태를 읽고, 프로젝트나 라이브러리를 확인하고, `FCPXML`을 가져오는 작업을 자동화하고 싶은 경우

핵심 개념은 단순합니다.

- Final Cut Pro가 먼저 Mac에 설치되어 있어야 합니다.
- 이 프로젝트가 Final Cut Pro와 통신하는 CLI/MCP 레이어 역할을 합니다.
- AI는 Final Cut Pro를 직접 아는 것이 아니라, 이 도구가 노출한 명령이나 MCP tool을 통해 Final Cut Pro를 조작합니다.

즉 구조는 아래와 같습니다.

```text
AI client
  -> this CLI / MCP server
  -> Final Cut Pro on your Mac
```

## 현재 가능한 것

현재 구현은 Final Cut Pro에서 공식적으로 확인되는 자동화 표면에 맞춰져 있습니다.

- 설치된 Final Cut Pro 앱 감지
- Final Cut Pro 실행
- 환경/권한 점검(`doctor`)
- 라이브러리, 이벤트, 프로젝트 읽기
- `.fcpxml` 파일 import
- 5초 타이틀 전용 프로젝트 생성
- 멀티 세그먼트 스토리보드 프로젝트 생성

이 프로젝트는 아직 Final Cut Pro 전체 편집 기능을 직접 제어하는 수준은 아닙니다. 현재 Apple Events 사전은 읽기 중심이라서, 깊은 편집 자동화는 보통 아래 방식으로 확장해야 합니다.

- `FCPXML` 생성/수정
- Shortcuts 또는 workflow extensions
- Accessibility 기반 UI 자동화

## 언제 쓰면 좋은가

영상 편집 자체를 잘 모르는 사람도 아래처럼 쓸 수 있습니다.

- "지금 열려 있는 라이브러리와 프로젝트 목록 보여줘"
- "이 `FCPXML` 가져와서 프로젝트 초안 만들기"
- "AI가 현재 프로젝트 구조를 읽고 다음 작업 순서를 제안하게 하기"

즉, 편집 기술을 모두 외우는 대신 AI에게 지시하고, AI는 이 도구를 통해 Final Cut Pro에 작업을 전달하는 방식입니다.

## 설치 전제

먼저 아래가 준비되어 있어야 합니다.

- macOS
- Final Cut Pro 또는 Final Cut Pro Trial 설치
- Node.js 22 이상
- Final Cut Pro를 최소 1번은 직접 실행한 상태

권한도 필요합니다.

- 첫 자동화 시도 때 macOS가 Automation 권한을 물을 수 있습니다.
- 필요하면 접근성 권한도 나중에 추가로 필요할 수 있습니다.

## 설치 방법

```bash
cd /Users/minwokim/Documents/GitHub/final-cut-pro-mcp
npm install
npm run build
```

빌드 후 CLI와 MCP 엔트리는 각각 아래 파일입니다.

- `dist/cli.js`
- `dist/mcp.js`

## CLI로 쓰는 방법

AI 연결 없이 로컬 명령으로만 써도 됩니다.

```bash
npm run cli -- help
npm run cli -- app-info
npm run cli -- open
npm run cli -- doctor --json
npm run cli -- list-libraries --json
npm run cli -- import-fcpxml ./example.fcpxml
npm run cli -- create-title-project --text 시작 --seconds 5
npm run cli -- create-title-project --text 시작 --seconds 5 --effect zoom
npm run cli -- create-storyboard-project --segments "시작|2|zoom;핵심|2|move;마무리|1|fade"
```

`create-title-project`에서 현재 지원하는 효과 프리셋:

- `basic`: 기본 타이틀 + 스케일 확대 키프레임
- `zoom`: Final Cut 기본 `Zoom` 타이틀
- `fade`: Final Cut 기본 `Fade` 타이틀
- `move`: Final Cut 기본 `Move` 타이틀

`create-storyboard-project`는 한 프로젝트 안에 여러 자막 컷을 순서대로 생성합니다.

- 인라인 입력: `--segments "문구|초|효과;문구|초|효과"`
- 파일 입력: `--segments-file ./story.json`

`story.json` 예시:

```json
{
  "segments": [
    { "text": "시작", "durationSeconds": 2, "effectPreset": "zoom" },
    { "text": "핵심 장면", "durationSeconds": 2, "effectPreset": "move", "positionY": -120 },
    { "text": "마무리", "durationSeconds": 1, "effectPreset": "fade" }
  ]
}
```

CLI만 쓸 거라면 MCP는 굳이 필요 없습니다.

## AI에 탑재하는 방법

AI가 이 도구를 호출하게 하려면 MCP를 쓰는 편이 맞습니다. MCP를 지원하는 AI 클라이언트에 이 서버를 등록하면, AI가 아래 tool을 통해 Final Cut Pro를 조작할 수 있습니다.

서버 실행:

```bash
npm run mcp
```

배포용으로 연결할 때는 보통 아래처럼 `dist/mcp.js`를 stdio 명령으로 등록하면 됩니다.

```bash
node /Users/minwokim/Documents/GitHub/final-cut-pro-mcp/dist/mcp.js
```

AI 클라이언트에서 연결되면 현재 노출되는 tool은 다음과 같습니다.

- `fcp_app_info`
- `fcp_open`
- `fcp_doctor`
- `fcp_list_libraries`
- `fcp_import_fcpxml`
- `fcp_create_title_project`
- `fcp_create_storyboard_project`

정리하면:

- 사람이 AI에게 자연어로 요청
- AI가 MCP tool 호출
- 이 서버가 로컬 Final Cut Pro에 명령 전달

## 어떤 AI에 연결할 수 있나

현재 기준으로는 아래처럼 정리하는 게 정확합니다.

- Codex: 가능. 로컬 `stdio` MCP 서버를 바로 등록할 수 있습니다.
- Claude Code: 가능. 로컬 `stdio` MCP 서버를 바로 등록할 수 있습니다.
- Gemini CLI: 가능. `~/.gemini/settings.json`에 MCP 서버를 등록하는 방식입니다.
- ChatGPT 웹/앱: 부분 가능. 다만 이 프로젝트의 현재 형태인 로컬 `stdio` 서버를 그대로 붙일 수는 없습니다.

중요한 차이는 여기입니다.

- Codex, Claude Code, Gemini CLI는 로컬 머신에서 MCP 프로세스를 직접 실행할 수 있습니다.
- ChatGPT는 현재 앱/개발자 모드에서 MCP를 지원하지만, 공식 문서 기준으로 원격 `HTTP` 또는 `SSE` 방식이 대상입니다.

즉, 현재 이 프로젝트는 아래 세 가지에는 바로 연결됩니다.

- Codex
- Claude Code
- Gemini CLI

반대로 ChatGPT에 바로 붙이려면 추가 작업이 필요합니다.

- 현재 `stdio` 서버를 원격 `HTTP` 또는 `SSE` MCP 서버로 감싸기
- 또는 별도 브리지 서버를 두고 ChatGPT Apps / Developer mode로 연결하기

이건 공식 문서를 바탕으로 한 정리입니다. ChatGPT에서 MCP 자체는 이제 되지만, 이 프로젝트의 현재 로컬 `stdio` 형태를 그대로 연결하는 것은 맞지 않습니다.

## 클라이언트별 연결 방법

### Codex

이미 이 Mac에서는 아래 명령으로 등록해 둔 상태입니다.

```bash
codex mcp add final-cut-pro -- node /Users/minwokim/Documents/GitHub/final-cut-pro-mcp/dist/mcp.js
```

확인:

```bash
codex mcp list
codex mcp get final-cut-pro
```

코드를 바꾼 뒤에는 다시 빌드해야 합니다.

```bash
cd /Users/minwokim/Documents/GitHub/final-cut-pro-mcp
npm run build
```

### Claude Code

Claude Code는 로컬 `stdio` MCP 서버를 직접 등록할 수 있습니다.

```bash
claude mcp add --transport stdio final-cut-pro -- \
  node /Users/minwokim/Documents/GitHub/final-cut-pro-mcp/dist/mcp.js
```

확인:

```bash
claude mcp list
claude mcp get final-cut-pro
```

### Gemini CLI

Gemini CLI는 공식 문서 기준으로 `~/.gemini/settings.json`에서 MCP 서버를 구성합니다.

예시:

```json
{
  "mcpServers": {
    "final-cut-pro": {
      "command": "node",
      "args": [
        "/Users/minwokim/Documents/GitHub/final-cut-pro-mcp/dist/mcp.js"
      ]
    }
  }
}
```

그 뒤 Gemini CLI를 실행하면 됩니다.

```bash
gemini
```

### ChatGPT

ChatGPT도 지금은 MCP 기반 앱/커넥터를 지원합니다. 다만 이 프로젝트는 현재 로컬 `stdio` 서버이므로 그대로는 연결 대상이 아닙니다.

정리하면:

- ChatGPT에서 MCP 자체는 가능
- 하지만 현재 프로젝트는 ChatGPT용으로 바로 연결되는 형태는 아님
- ChatGPT에 붙이려면 원격 `HTTP` 또는 `SSE` MCP 엔드포인트가 추가로 필요

## 첫 번째 데모 프롬프트

사용자 입장에서 가장 직관적인 데모 문장은 이런 식이 맞습니다.

```text
프로그램을 열어서 프로젝트 하나 파고, 자막으로 "시작" 이라는 문구로 시작되는 5초짜리 영상 만들어줘.
```

이제 이 문장은 실제로 처리 가능한 프롬프트입니다.

현재 구현으로 바로 가능한 프롬프트:

- `Final Cut Pro 열어줘`
- `지금 상태 점검해줘(doctor 실행)`
- `현재 라이브러리와 프로젝트 구조 읽어줘`
- `이 FCPXML 가져와줘: /절대/경로/example.fcpxml`
- `무제 라이브러리에 프로젝트 하나 만들고, 시작이라는 문구가 들어간 5초짜리 타이틀 프로젝트 만들어줘`
- `3컷 스토리보드로 만들어줘: 시작(2초, zoom), 핵심(2초, move), 마무리(1초, fade)`

이 타이틀 프로젝트 생성은 내부적으로 아래 방식으로 동작합니다.

- Final Cut Pro용 `FCPXML` 생성
- 기존 `.fcpbundle` 라이브러리 지정 import
- 5초 시퀀스와 텍스트 타이틀 프로젝트 생성

다만 아직 아래 단계는 별도 구현이 필요합니다.

- 타임라인 세부 편집
- 실미디어(영상/오디오) 자동 배치 및 컷 편집
- 최종 영상 export

## 추천 사용 시나리오

예를 들어 실제 편집을 잘 모르는 사용자는 이런 식으로 쓸 수 있습니다.

- "Final Cut Pro 열고 현재 라이브러리 구조부터 읽어줘"
- "내가 준 `FCPXML`을 가져와서 초안 프로젝트를 준비해줘"
- "프로젝트 이름과 구조를 보고 다음 편집 순서를 정리해줘"

이 프로젝트는 "AI가 편집자를 완전히 대체한다"기보다, "Final Cut Pro의 반복 작업과 준비 작업을 AI가 대신 처리하게 만든다"는 용도에 가깝습니다.

## 주의사항

- `list-libraries`는 Final Cut Pro가 열려 있지 않거나 Automation 권한이 없으면 타임아웃될 수 있습니다.
- 처음에는 Final Cut Pro를 한 번 직접 열고 권한 요청을 허용하는 편이 안전합니다.
- `import-fcpxml`은 `open -a "<Final Cut Pro>" <file>` 방식으로 동작합니다.
