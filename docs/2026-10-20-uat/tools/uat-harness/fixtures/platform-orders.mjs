// Đơn Pancake NGOÀI app (sàn + chat) cho giả Pancake. lane-up sinh state/lane-N/pancake/platform-orders.json từ đây khi file chưa có;
// sau đó agent sửa thẳng file JSON (giả Pancake đọc lại ở mỗi request). Mốc thời gian tính lùi từ lúc sinh.
// Trường theo những gì apps/api/src/modules/external-points/external-order.mapper.ts đọc (Open API Pancake, chưa đối chiếu payload thật).

const DAY = 86_400_000;

/** Chuỗi giờ VN không múi giờ như Pancake ("2026-10-12T15:00:00"); mapper hiểu là +07:00. */
function vn(d) {
  return new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 19);
}

function history(now, steps) {
  return steps.map(([status, daysAgo]) => ({ status, updated_at: vn(new Date(now - daysAgo * DAY)) }));
}

function order({ id, source, marketplaceId, account, status, steps, phone, tracking, orderSn, price, qty = 1, now }) {
  const last = steps[steps.length - 1];
  return {
    id,
    order_sources: source,
    account,
    marketplace_id: marketplaceId,
    is_from_ecommerce: marketplaceId !== null,
    status,
    inserted_at: vn(new Date(now - steps[0][1] * DAY)),
    updated_at: vn(new Date(now - last[1] * DAY)),
    status_history: history(now, steps),
    items: [{ quantity: qty, discount_each_product: 0, variation_info: { retail_price: price, name: 'Nước rửa chén sinh học Fuwa3e' } }],
    total_price: price * qty,
    total_discount: 0,
    shipping_fee: 0,
    bill_full_name: 'Khách sàn UAT',
    bill_phone_number: phone,
    shipping_address: { full_name: 'Khách sàn UAT', phone_number: phone, address: '1 Lê Lợi, Phường Sài Gòn, TP HCM' },
    ...(tracking ? { partner: { extend_code: tracking }, tracking_number: tracking } : {}),
    ...(orderSn ? { invoice_info_list: [{ order_sn: orderSn }] } : {}),
    creator: { id: 'pc-staff-01', name: 'Nhân viên Pancake UAT' },
  };
}

export function makePlatformOrders(now = Date.now()) {
  return [
    // Shopee đã giao 3 ngày trước — khách quay lại quét mã: điểm chờ (giao + 14 ngày).
    order({ now, id: 7700001, source: -3, marketplaceId: -3, account: 'shopee-tubu', status: 3,
      steps: [[0, 6], [2, 5], [3, 3]], phone: '0901000003', tracking: 'SPXVN05UAT0001', orderSn: '2610UATSHOPEE01', price: 125000, qty: 2 }),
    // Shopee đã giao 20 ngày trước — quét xong là đủ 14 ngày, job cộng ngay.
    order({ now, id: 7700002, source: -3, marketplaceId: -3, account: 'shopee-tubu', status: 3,
      steps: [[0, 23], [2, 22], [3, 20]], phone: '0901000001', tracking: 'SPXVN05UAT0002', orderSn: '2610UATSHOPEE02', price: 199000 }),
    // TikTok đang giao — quét được nhưng chưa có mốc giao.
    order({ now, id: 7700003, source: -9, marketplaceId: -9, account: 'tiktok-tubu', status: 2,
      steps: [[0, 2], [2, 1]], phone: '0901000003', tracking: 'GHNUAT00000003', orderSn: '2610UATTIKTOK03', price: 89000, qty: 3 }),
    // Lazada đã hoàn — quét phải bị từ chối / huỷ điểm.
    order({ now, id: 7700004, source: -4, marketplaceId: -4, account: 'lazada-tubu', status: 5,
      steps: [[0, 12], [2, 11], [4, 9], [5, 7]], phone: '0901000003', tracking: 'LZDUAT00000004', orderSn: '2610UATLAZADA04', price: 159000 }),
    // Đơn chat/điện thoại CSKH lên (B9) theo SĐT khách đã có trong app. Cần chatSources chứa "-1|fb-page-tubu|" (mẫu đã đặt).
    order({ now, id: 7700005, source: -1, marketplaceId: null, account: 'fb-page-tubu', status: 3,
      steps: [[0, 4], [2, 3], [3, 2]], phone: '0901000003', tracking: 'GHTKUAT0000005', price: 210000 }),
    // Đơn chat của SĐT chưa từng vào Mini App — giữ 30 ngày chờ khách vào app.
    order({ now, id: 7700006, source: -1, marketplaceId: null, account: 'fb-page-tubu', status: 3,
      steps: [[0, 4], [2, 3], [3, 2]], phone: '0901000013', tracking: 'GHTKUAT0000006', price: 180000 }),
  ];
}
