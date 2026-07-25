// /api/price.js
// 프론트엔드에서 /api/geocode로 먼저 후보를 받아 사용자가 하나를 선택한 뒤,
// 그 결과(bCode, jibun)와 전용면적(선택)을 넘겨받아 국토부 실거래가를 조회한다.
//
// 파라미터: bCode (10자리 법정동코드), jibun (지번, 선택), dong (동 이름, 선택),
//          areaSqm (전용면적 ㎡, 선택 — 있으면 비슷한 면적대끼리만 평균)
//
// 환경변수:
//   MOLIT_SERVICE_KEY: 공공데이터포털 "국토교통부_아파트 매매 실거래가 자료" 일반 인증키

module.exports = async function handler(req, res) {
  const bCode = (req.query.bCode || "").trim();
  const jibun = (req.query.jibun || "").trim();
  const dong = (req.query.dong || "").trim();
  const areaSqm = parseFloat(req.query.areaSqm || "");
  const hasArea = !isNaN(areaSqm) && areaSqm > 0;

  if (!bCode) {
    return res.status(400).json({ error: "bCode 파라미터가 필요합니다." });
  }

  const MOLIT_KEY = process.env.MOLIT_SERVICE_KEY;
  if (!MOLIT_KEY) {
    return res.status(500).json({ error: "서버에 국토부 API 키가 설정되지 않았습니다." });
  }

  const lawdCd = bCode.slice(0, 5);

  try {
    const now = new Date();
    const months = [0, 1, 2].map((i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    });

    let allItems = [];
    for (const dealYmd of months) {
      const url =
        `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade` +
        `?serviceKey=${MOLIT_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=1000&pageNo=1&_type=json`;
      const r = await fetch(url);
      const rawText = await r.text();
      let j;
      try {
        j = JSON.parse(rawText);
      } catch (parseErr) {
        return res.status(502).json({
          error: "국토부 API 응답을 해석할 수 없습니다.",
          debug_molit_status: r.status,
          debug_molit_raw: rawText.slice(0, 500),
        });
      }
      const items = j?.response?.body?.items?.item;
      if (items) {
        allItems = allItems.concat(Array.isArray(items) ? items : [items]);
      } else if (j?.response?.header?.resultCode && j.response.header.resultCode !== "00") {
        return res.status(502).json({
          error: "국토부 API에서 오류를 반환했습니다.",
          debug_molit_resultCode: j.response.header.resultCode,
          debug_molit_resultMsg: j.response.header.resultMsg,
        });
      }
    }

    if (allItems.length === 0) {
      return res.status(404).json({ error: "최근 3개월 내 해당 지역 아파트 실거래 내역이 없습니다. 시세를 직접 입력해주세요." });
    }

    // 매칭 우선순위: (지번+면적) > 지번 > (동+면적) > 동 > (시군구+면적) > 시군구
    // 면적은 ±3㎡ 이내를 "같은 평형대"로 간주 (평수 환산: 1평 = 3.3058㎡)
    const AREA_TOLERANCE = 3;
    const withinArea = (it) => Math.abs(parseFloat(it.excluUseAr) - areaSqm) <= AREA_TOLERANCE;

    const normalizedJibun = jibun.replace(/[^0-9-]/g, "");
    const byJibun = allItems.filter((it) => {
      const itJibun = (it.jibun || "").toString().replace(/[^0-9-]/g, "");
      return normalizedJibun && itJibun === normalizedJibun;
    });
    const byDong = dong ? allItems.filter((it) => (it.umdNm || "").trim() === dong.trim()) : [];

    let usedItems = [];
    let scope = "";

    if (hasArea && byJibun.filter(withinArea).length > 0) {
      usedItems = byJibun.filter(withinArea); scope = "exact_area";
    } else if (byJibun.length > 0) {
      usedItems = byJibun; scope = "exact";
    } else if (hasArea && byDong.filter(withinArea).length > 0) {
      usedItems = byDong.filter(withinArea); scope = "dong_area";
    } else if (byDong.length > 0) {
      usedItems = byDong; scope = "dong";
    } else if (hasArea && allItems.filter(withinArea).length > 0) {
      usedItems = allItems.filter(withinArea); scope = "district_area";
    } else {
      usedItems = allItems; scope = "district";
    }

    const prices = usedItems
      .map((it) => parseInt(String(it.dealAmount).replace(/[^0-9]/g, ""), 10))
      .filter((n) => !isNaN(n));

    if (prices.length === 0) {
      return res.status(404).json({ error: "가격 정보를 확인할 수 없습니다. 시세를 직접 입력해주세요." });
    }

    const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avgAreaSqm = Math.round((usedItems.reduce((a, it) => a + (parseFloat(it.excluUseAr) || 0), 0) / usedItems.length) * 10) / 10;

    return res.status(200).json({
      marketValueManwon: avg,
      minManwon: min,
      maxManwon: max,
      sampleCount: prices.length,
      scope, // "exact_area" | "exact" | "dong_area" | "dong" | "district_area" | "district"
      avgAreaSqm,
      months,
      source: "국토교통부 아파트매매 실거래자료(공공데이터포털)",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "시세 조회 중 오류가 발생했습니다.", debug_message: err.message });
  }
};
