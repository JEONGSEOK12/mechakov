# 배포하기

서버 하나가 게임 페이지와 WebSocket을 함께 처리해요. 계정 데이터(보관함, 업그레이드)는 `PROFILES_FILE` 경로의 JSON 파일에 저장돼요.

## Docker로 어디든

Docker를 지원하는 곳(Fly.io, Railway, Render, 내 서버 등)이면 이 저장소 그대로 올릴 수 있어요.

```bash
docker build -t mechakov .
docker run -p 8080:8080 -v mechakov-data:/data mechakov
```

http://localhost:8080 으로 접속돼요. 호스팅 서비스에서 챙길 것은 두 가지예요.

- `PORT` 환경 변수 (기본 8080). 대부분의 서비스가 알아서 넣어줘요.
- `/data`(또는 `PROFILES_FILE`로 지정한 곳)를 재시작해도 남는 디스크에 연결하기. 연결하지 않으면 서버가 다시 시작될 때 모든 계정 데이터가 사라져요.

WebSocket을 지원해야 하고, 방 상태를 메모리에 들고 있으니 서버를 한 대만 띄워야 해요.

## 예: Fly.io

`fly.toml`이 준비되어 있어요. 카드 등록이 필요하고, 항상 켜두는 설정이라 매달 소액이 청구돼요.

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
# fly.toml의 app 이름을 아무도 안 쓰는 이름으로 바꾼 뒤
fly apps create <앱 이름>
fly volumes create mechakov_data --region nrt --size 1
fly deploy
```

끝나면 `https://<앱 이름>.fly.dev` 로 접속할 수 있어요.

## 확인

- 서버 상태: `/health`
- 지금 접속자 수와 방 목록: `/rooms`
