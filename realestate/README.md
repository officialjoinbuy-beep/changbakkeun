# 등기 세이프 — 배포 가이드

## 구성
```
/index.html      메인 웹앱 (등기부 파싱 + 위험도 분석 + 시세 조회 UI)
/api/price.js    시세 조회용 Vercel 서버리스 함수 (카카오 + 국토부 API 프록시)
```

## 1. API 키 발급 (둘 다 무료)

**카카오 REST API 키**
1. https://developers.kakao.com → 애플리케이션 추가
2. 앱 키 > REST API 키 복사
3. 플랫폼 설정에서 Web 플랫폼에 배포 도메인 등록

**국토부 실거래가 API 키**
1. https://www.data.go.kr → "국토교통부_아파트매매 실거래자료" 검색 → 활용신청
2. 승인 후 마이페이지에서 서비스키(Decoding 값) 복사
3. 초기 일일 호출 한도 1,000건 (부족하면 활용신청서로 증량 요청 가능)

## 2. Vercel 배포
1. 이 폴더를 GitHub 저장소로 push
2. Vercel에서 New Project → 해당 저장소 Import
3. Project Settings > Environment Variables에 아래 2개 등록
   - `KAKAO_REST_KEY`
   - `MOLIT_SERVICE_KEY`
4. Deploy

배포 후 `https://[프로젝트명].vercel.app` 접속하면 바로 사용 가능.

## 3. 참고
- 등기부 PDF 파싱, 위험도 스코어링은 전부 브라우저(클라이언트)에서 처리되어 API 호출이 없습니다.
- 시세 조회만 `/api/price`를 통해 카카오(주소→법정동코드) + 국토부(실거래가) 순으로 호출합니다.
- 현재는 **아파트 실거래가만** 지원합니다. 연립/다세대·오피스텔 확장 시 국토부의 별도 엔드포인트
  (`RTMSDataSvcRHTrade` 등) 추가 연동이 필요합니다.
- 국토부 응답에 동일 지번 매물이 없으면 같은 법정동 전체 평균으로 대체됩니다 (`scope: "district"`).
  이 경우 UI에 "해당 법정동 전체 평균"으로 표시되니 참고용으로만 안내하세요.
