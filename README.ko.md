# Irwin

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

**Windows, Ubuntu, macOS용 MongoDB 데스크톱 작업 공간.** Irwin은 MIT 라이선스의 오픈 소스 프로젝트입니다. [호환성 표](docs/COMPATIBILITY.md)에 있는 각 운영 체제의 설치 검증이 완료될 때까지 플랫폼 지원은 미리 보기 단계입니다.

번역의 기준은 [영문 README](README.md)입니다. 앱 UI는 현재 영어와 중국어 번체를 지원하며, 다른 가이드는 영어 또는 중국어 번체로 작성되어 있습니다.

![Irwin 작업 공간](docs/images/irwin-workspace.png)

## 플랫폼 상태

| 플랫폼                          | 현재 검증 내용                                                                                                                                                    | 상태                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Windows 11 x64                  | 서명되지 않은 로컬 후보 빌드가 패키징 후 데스크톱 기본 동작 테스트를 통과했습니다. 새 환경 설치, 최초 다운로드 경고, 업그레이드, 제거는 아직 검증하지 않았습니다. | 미리 보기                |
| Ubuntu 24.04 x64                | Debian 패키징은 설정되어 있으나 실제 Ubuntu Desktop에서 설치와 실행을 검증하지 않았습니다.                                                                        | 관리자 검증 대기         |
| Ubuntu 22.04 x64                | Linux 빌드 대상이지만 실제 데스크톱에서 검증하지 않았습니다.                                                                                                      | 정식 지원 미제공         |
| macOS 14+ Intel / Apple Silicon | 관리자는 M3 MacBook Air에서 DMG로 설치하고 실행했다고 보고했습니다. 정확한 macOS 버전과 DMG 식별 정보, 나머지 작업 흐름, Intel 검증은 아직 확인이 필요합니다.     | 일부 실제 환경 검증 완료 |

릴리스가 공개되면 GitHub Releases에서 설치 파일을 다운로드할 수 있습니다. 앱 스토어를 통한 설치는 필요하지 않습니다. 미리 보기 설치 파일에는 유료 배포자 서명이나 Apple 공증이 없습니다. [설치 가이드](docs/INSTALLATION.md)에서 체크섬 확인과 첫 실행 시 예상되는 경고를 설명합니다. 로컬 패키징 명령이 출력하는 경로는 빌드 결과이며 다운로드 링크가 아닙니다.

버전 0.1.0의 설치 파일 이름은 `Irwin-0.1.0-win-x64.exe`, `Irwin-0.1.0-linux-x64.deb`, `Irwin-0.1.0-mac-x64.dmg`, `Irwin-0.1.0-mac-arm64.dmg`로 설정되어 있습니다. 이 이름은 빌드 결과를 나타내며 아직 공개 다운로드가 제공되지 않습니다.

## 기능

- MongoDB 연결을 관리하고 Table, Tree, JSON 보기로 컬렉션을 탐색합니다.
- BSON 타입을 보존하며 문서를 조회하고 편집합니다. 각 탭은 독립된 mongosh 세션을 사용합니다.
- 자신의 클라우드 또는 로컬 LLM을 연결해 쿼리 초안을 만들고 MongoDB Explain을 해석합니다. 연결마다 직접 활성화하며 전송할 컨텍스트를 검토할 수 있습니다. AI 초안은 자동으로 실행되지 않습니다. 사용자가 검토하고 적용한 뒤 직접 실행합니다.
- JSON, JSONL, CSV, BSON 가져오기와 내보내기에 진행 상황, 취소 기능, 파괴적 작업에 대한 명시적인 보호 장치를 제공합니다.
- 연결 프로필과 설정을 로컬 SQLite에 저장합니다. 저장된 비밀 정보는 운영 체제의 암호화 기능으로 보호합니다. 안전한 저장 기능을 사용할 수 없으면 현재 세션에서만 비밀 정보를 유지합니다.

작업 흐름과 제한 사항은 [사용자 가이드](docs/USER_GUIDE.md)를 참고하세요.

## Irwin 설치

Windows, Ubuntu, macOS 설치 방법은 [설치 가이드](docs/INSTALLATION.md)를 참고하세요. 공개 설치 파일은 아직 없습니다. 플랫폼 상태와 미완료 검증 항목은 [호환성 표](docs/COMPATIBILITY.md)에 기록되어 있습니다.

## 소스에서 빌드

Node.js 24, pnpm 11.1.0, Windows, Linux 또는 macOS의 네이티브 개발 환경이 필요합니다. 설치 파일은 대상 운영 체제에서 빌드하세요. 설정된 대상은 Windows x64, Ubuntu/Debian x64, macOS 14+ x64/arm64입니다.

```sh
git clone https://github.com/piayru/irwin.git
cd irwin
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm tools:fetch
pnpm dev
```

`pnpm tools:fetch`는 현재 플랫폼의 MongoDB Database Tools를 다운로드하고 `vendor/tools-manifest.json`의 SHA-256 값으로 압축 파일을 검증합니다.

macOS 패키징은 Intel과 Apple Silicon용 DMG를 모두 생성합니다. 먼저 `pnpm tools:fetch mac-x64`와 `pnpm tools:fetch mac-arm64`를 실행해 두 도구 묶음을 준비하세요. 패키징 사전 검사는 두 아키텍처를 모두 확인합니다.

Irwin은 npm 패키지가 아닌 데스크톱 앱으로 배포됩니다. 실수로 게시하는 것을 방지하기 위해 패키지 설정에서 npm 게시를 비활성화했습니다. 소스 저장소에는 루트의 `LICENSE`가 적용됩니다.

## 검사와 패키징

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm package --publish never
pnpm release:verify
```

`pnpm test`는 일회용 MongoDB 8.0.18 테스트 프로세스를 실행하고 전용 테스트 데이터베이스에 데이터를 씁니다. 테스트 URI를 운영 환경으로 지정하지 마세요. 통합 테스트에서 MongoDB 테스트 바이너리를 받으려면 네트워크 연결이 필요합니다. 데스크톱과 설치 파일 검증에는 [릴리스 체크리스트](docs/RELEASE_CHECKLIST.md)의 각 운영 체제에서 수행하는 수동 검사가 필요합니다. CI는 이 검사를 대체하지 않습니다.

## 프로젝트 문서

- [문서 목록](docs/README.md)
- [Irwin 설치](docs/INSTALLATION.md)
- [호환성과 검증 상태](docs/COMPATIBILITY.md)
- [아키텍처와 보안 경계](docs/ARCHITECTURE.md)
- [릴리스 및 플랫폼 검증 체크리스트](docs/RELEASE_CHECKLIST.md)
- [테스트 가이드](docs/TESTING.md)
- [로컬 데이터 및 인증 정보 저장](docs/USER_GUIDE.md#連線)
- [기여 안내](CONTRIBUTING.md)
- [비공개 취약점 신고](SECURITY.md)
- [타사 라이선스 고지](THIRD_PARTY_NOTICES.md)
- [변경 기록](CHANGELOG.md)

Irwin은 독립 프로젝트이며 MongoDB의 공식 제품이 아닙니다. MongoDB, mongosh, MongoDB Database Tools의 이름과 라이선스에는 각각의 규정이 적용됩니다.
