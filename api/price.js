// /api/price.js
// Vercel Serverless Function
// 흐름: 주소 → (카카오) 법정동코드 → (국토부) 최근 3개월 아파트 실거래가 → 평균가 반환
//
// 환경변수 (Vercel 프로젝트 설정 > Environment Variables):
//   KAKAO_REST_KEY   : 카카오 디벨로퍼스에서 발급한 REST API 키
//   MOLIT_SERVICE_KEY: 공공데이터포털에서 발급한 "국토교통부_아파트매매 실거래자료" 서비스키 (Decoding 키 사용)

module.exports = async function handler(req, res) {
  const address = (req.query.address || "").trim();
  if (!address) {
    return res.status(400).json({ error: "address 파라미터가 필요합니다." });
  }

  const KAKAO_KEY = process.env.KAKAO_REST_KEY;
  const MOLIT_KEY = process.env.MOLIT_SERVICE_KEY;
  if (!KAKAO_KEY || !MOLIT_KEY) {
    return res.status(500).json({ error: "서버에 API 키가 설정되지 않았습니다. Vercel 환경변수를 확인하세요." });
  }

  try {
    // ---------- 1. 주소 -> 법정동코드 (카카오 로컬 API) ----------
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const doc = kakaoData.documents && kakaoData.documents[0];
    if (!doc) {
      return res.status(404).json({ error: "주소를 찾을 수 없습니다. 도로명 또는 지번 주소를 다시 확인해주세요." });
    }

    const bCode = doc.address ? doc.address.b_code : (doc.road_address ? doc.road_address.b_code : null);
    if (!bCode) {
      return res.status(404).json({ error: "법정동코드를 확인할 수 없는 주소입니다." });
    }
    const lawdCd = bCode.slice(0, 5); // 시군구 코드 5자리
    const dongName = doc.address ? doc.address.region_3depth_name : "";
    const jibun = doc.address ? `${doc.address.main_address_no}${doc.address.sub_address_no ? "-" + doc.address.sub_address_no : ""}` : "";

    // ---------- 2. 최근 3개월 실거래가 조회 (국토부, 아파트매매) ----------
    const now = new Date();
    const months = [0, 1, 2].map((i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    let allItems = [];
    for (const dealYmd of months) {
      const url =
        `https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev` +
        `?serviceKey=${MOLIT_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1&_type=json`;
      const r = await fetch(url);
      const j = await r.json();
      const items = j?.response?.body?.items?.item;
      if (items) {
        allItems = allItems.concat(Array.isArray(items) ? items : [items]);
      }
    }

    if (allItems.length === 0) {
      return res.status(404).json({ error: "최근 3개월 내 해당 지역 아파트 실거래 내역이 없습니다. 시세를 직접 입력해주세요." });
    }

    // ---------- 3. 지번/동 이름으로 유사 매물 우선 필터링, 없으면 지역 전체 평균 ----------
    const normalizedJibun = jibun.replace(/[^0-9-]/g, "");
    let matched = allItems.filter((it) => {
      const itJibun = (it.지번 || "").toString().replace(/[^0-9-]/g, "");
      return normalizedJibun && itJibun === normalizedJibun;
    });
    const usedItems = matched.length > 0 ? matched : allItems;
    const scope = matched.length > 0 ? "exact" : "district";

    const prices = usedItems
      .map((it) => parseInt(String(it.거래금액).replace(/[^0-9]/g, ""), 10))
      .filter((n) => !isNaN(n));

    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    return res.status(200).json({
      marketValueManwon: avg,
      minManwon: min,
      maxManwon: max,
      sampleCount: prices.length,
      scope, // "exact"(동일 지번 매물 기준) | "district"(같은 법정동 전체 평균)
      dong: dongName,
      months,
      source: "국토교통부 아파트매매 실거래자료(공공데이터포털)",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "시세 조회 중 오류가 발생했습니다." });
  }
}

