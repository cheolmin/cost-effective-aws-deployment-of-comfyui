# ComfyUI Environment Management

이 문서는 AWS ComfyUI 솔루션에 추가된 환경 관리 기능에 대해 설명합니다.

## 개요

ComfyUI 사용자들이 워크로드별로 여러 환경(가상환경, custom_nodes 세트)을 관리해야 하는 페인포인트를 해결하기 위해 환경 관리 기능을 추가했습니다.

### 주요 기능

1. **다중 환경 지원**: 워크로드별 독립적인 환경 구성
2. **공유 모델**: 모델 파일은 환경 간에 공유하여 스토리지 절약
3. **Lambda API**: REST API로 환경 관리 (목록, 생성, 전환, 삭제)
4. **커스텀 노드**: ComfyUI 웹 UI 내에서 직접 환경 관리

## 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Load Balancer               │
│  /api/environments/* → Lambda (Environment Manager)          │
│  /*                  → ECS Task (ComfyUI)                    │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │  Lambda  │   │   ECS    │   │   SSM    │
        │   API    │   │  Task    │   │ Parameter│
        └────┬─────┘   └────┬─────┘   └──────────┘
             │              │
             └──────┬───────┘
                    │
             ┌──────▼──────┐
             │    EFS      │
             │ (Shared)    │
             │             │
             │ /environments/    ← 환경별 데이터
             │   ├── default/
             │   ├── sdxl/
             │   └── flux/
             │ /shared/models/   ← 공유 모델
             └─────────────┘
```

## 환경 데이터 구조

EFS에 저장되는 환경 데이터 구조:

```
/mnt/efs/
├── config.json                 # 환경 설정 메타데이터
├── environments/
│   ├── default/
│   │   ├── custom_nodes/       # 환경별 커스텀 노드
│   │   ├── user/               # 사용자 설정
│   │   ├── output/             # 출력 이미지
│   │   └── extra_model_paths.yaml
│   ├── sdxl/
│   │   └── ...
│   └── flux/
│       └── ...
└── shared/
    └── models/                 # 공유 모델 (모든 환경에서 접근)
        ├── checkpoints/
        ├── loras/
        ├── vae/
        ├── controlnet/
        └── ...
```

## API 엔드포인트

### GET /api/environments
환경 목록 조회

**Response:**
```json
{
  "current_environment": "default",
  "environments": [
    {
      "name": "default",
      "description": "Default ComfyUI environment",
      "is_current": true,
      "custom_nodes_count": 5
    }
  ]
}
```

### POST /api/environments
새 환경 생성

**Request:**
```json
{
  "name": "my-env",
  "description": "My custom environment"
}
```

### PUT /api/environments/switch
환경 전환 (ECS 재시작 발생)

**Request:**
```json
{
  "name": "sdxl"
}
```

### DELETE /api/environments/{name}
환경 삭제

## ComfyUI 커스텀 노드

ComfyUI 웹 UI 내에서 환경을 관리할 수 있는 커스텀 노드가 포함되어 있습니다.

### 사용 가능한 노드

| 노드 | 설명 |
|------|------|
| 🌍 Environment Info | 현재 환경 정보 표시 |
| 🔍 Select Environment | 환경 선택 |
| ➕ Create Environment | 새 환경 생성 |
| 🔄 Switch Environment | 환경 전환 (재시작 필요) |
| 📦 Install Custom Node | 환경에 커스텀 노드 설치 |
| 📁 Shared Model Path | 공유 모델 경로 출력 |

### 웹 UI 메뉴

ComfyUI 상단에 환경 선택 버튼(🌍)이 추가됩니다. 클릭하면 환경 관리 다이얼로그가 열립니다.

## 배포 방법

### 1. 기존 스택 업데이트

```bash
# 의존성 설치
pip install -r requirements.txt

# CDK 배포
make
```

### 2. 새로운 리소스

배포 시 다음 리소스가 추가됩니다:

- **EFS File System**: 환경 데이터 저장
- **Lambda Function**: 환경 관리 API
- **ALB Rule**: /api/environments/* 경로 라우팅
- **SSM Parameter**: 현재 환경 상태 저장

## 사용 시나리오

### 시나리오 1: SDXL 전용 환경 만들기

1. 웹 UI에서 🌍 버튼 클릭
2. "Create New Environment"에서:
   - Name: `sdxl`
   - Description: `SDXL 이미지 생성 전용`
3. "Create Environment" 클릭
4. 생성된 환경에 필요한 커스텀 노드 설치:
   - ComfyUI-Manager로 설치하거나
   - 📦 Install Custom Node 노드 사용

### 시나리오 2: 환경 전환

1. 웹 UI에서 🌍 버튼 클릭
2. 원하는 환경의 "Switch" 버튼 클릭
3. 확인 후 ComfyUI 자동 재시작
4. 새 환경으로 전환 완료

### 시나리오 3: API로 환경 관리

```bash
# 환경 목록 조회
curl https://your-alb-url/api/environments

# 새 환경 생성
curl -X POST https://your-alb-url/api/environments \
  -H "Content-Type: application/json" \
  -d '{"name": "flux", "description": "Flux 모델 전용"}'

# 환경 전환
curl -X PUT https://your-alb-url/api/environments/switch \
  -H "Content-Type: application/json" \
  -d '{"name": "flux"}'
```

## 워크샵 가이드

워크샵에서 이 기능을 시연할 때:

1. **기본 환경 설명**: default 환경으로 시작
2. **환경 생성 시연**: 웹 UI로 새 환경 생성
3. **커스텀 노드 설치**: 환경별로 다른 노드 설치
4. **환경 전환 시연**: 워크로드에 맞는 환경으로 전환
5. **공유 모델 설명**: 모델은 한 번만 다운로드하면 모든 환경에서 사용 가능

## 제한 사항

- 환경 전환 시 ECS Task 재시작이 필요합니다 (약 1-2분 소요)
- 동시에 하나의 환경만 활성화할 수 있습니다 (단일 GPU)
- 환경 삭제 시 파일은 EFS에 보존됩니다 (수동 정리 필요)

## 참고

- [ComfyEnv](https://github.com/cancer32/ComfyEnv) - 환경 관리 컨셉 참고
- [cost-effective-aws-deployment-of-comfyui](https://github.com/aws-samples/cost-effective-aws-deployment-of-comfyui) - 베이스 솔루션
