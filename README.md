# 회원 포인트 관리 시스템

## 기술 스택
- **프론트엔드**: HTML / CSS / Vanilla JS (반응형)
- **백엔드**: Node.js + Express
- **데이터베이스**: SQLite (sql.js - 파일 기반, 설치 불필요)

## 프로젝트 구조
```
point-manager/
├── server.js           # Express 서버
├── data.sqlite         # SQLite DB 파일 (자동 생성)
├── public/
│   └── index.html      # 프론트엔드
└── package.json
```

## 실행 방법

### 1. 의존성 설치
```bash
npm install
```

### 2. 서버 실행
```bash
node server.js
```

### 3. 접속
```
http://localhost:3000
```

---

## API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | /api/members | 회원 목록 (검색: ?search=) |
| GET | /api/members/:id | 회원 단건 조회 |
| POST | /api/members | 회원 등록 |
| PUT | /api/members/:id | 회원 수정 |
| DELETE | /api/members/:id | 회원 삭제 |
| POST | /api/members/:id/points | 포인트 변경 |
| GET | /api/members/:id/history | 포인트 내역 |
| GET | /api/stats | 통계 |

---

## 주요 기능
- 회원 등록 / 수정 / 삭제
- 포인트 적립 / 사용 / 직접 조정
- 포인트 변경 이력 조회 (최근 50건)
- 이름·회원번호 실시간 검색
- 대시보드 통계 (전체 회원수, 총 포인트, 오늘 신규)
- 데스크톱 / 태블릿 / 모바일 반응형

## 회원 데이터 구조
```json
{
  "id": 1,
  "member_no": "M20240001",
  "name": "홍길동",
  "points": 5000,
  "created_at": "2024-01-01 12:00:00"
}
```
