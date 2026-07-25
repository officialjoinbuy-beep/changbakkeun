// /api/geocode.js
// 주소 문자열 -> 카카오 로컬 API로 후보 주소 목록(최대 5개) 반환
// 동명 도로명(예: "양지로 120"이 여러 시/구에 존재)이 여러 개 매칭될 수 있어
// 프론트엔드에서 사용자가 직접 하나를 선택하도록 후보를 그대로 넘긴다.

module.exports = async function handler(req, res) {
  const address = (req.query.address || "").trim();
  if (!address) {
    return res.status(400).json({ error: "address 파라미터가 필요합니다." });
  }

  const KAKAO_KEY = process.env.KAKAO_REST_KEY;
  if (!KAKAO_KEY) {
    return res.status(500).json({ error: "서버에 카카오 API 키가 설정되지 않았습니다." });
  }

  try {
    const kakaoRes = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&size=5`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const docs = kakaoData.documents || [];

    if (docs.length === 0) {
      return res.status(404).json({ error: "주소를 찾을 수 없습니다. 도로명 또는 지번 주소를 다시 확인해주세요." });
    }

    const candidates = docs.map((doc) => {
      const addr = doc.address;
      const road = doc.road_address;
      const bCode = addr ? addr.b_code : (road ? road.b_code : null);
      const jibun = addr ? `${addr.main_address_no}${addr.sub_address_no ? "-" + addr.sub_address_no : ""}` : "";
      return {
        label: road ? road.address_name : (addr ? addr.address_name : doc.address_name),
        jibunLabel: addr ? addr.address_name : "",
        bCode,
        jibun,
        dong: addr ? addr.region_3depth_name : "",
        sido: addr ? addr.region_1depth_name : "",
        sigungu: addr ? addr.region_2depth_name : "",
      };
    }).filter((c) => c.bCode);

    if (candidates.length === 0) {
      return res.status(404).json({ error: "법정동코드를 확인할 수 없는 주소입니다." });
    }

    return res.status(200).json({ candidates });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "주소 검색 중 오류가 발생했습니다." });
  }
};
