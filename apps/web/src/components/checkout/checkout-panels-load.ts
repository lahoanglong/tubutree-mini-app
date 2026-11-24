// Chỗ DUY NHẤT nạp `checkout-panels` (chunk các khối tải lười của trang thanh toán): một lệnh `import()` nên chỉ thêm một id chunk vào webpack
// runtime mà mọi trang tải. Spec `checkout-panels-lazy.spec.tsx` chặn tệp khác nhập `checkout-panels`, kể cả nhập tĩnh (sẽ kéo cả khối về JS
// tải lần đầu của /thanh-toan).

export type CheckoutPanels = typeof import('./checkout-panels');

let loaded: CheckoutPanels | undefined;
let pending: Promise<CheckoutPanels> | undefined;

/** Module các khối nếu đã tải xong: khối dựng ngay ở lần vẽ đầu, không qua trạng thái chờ. */
export function loadedCheckoutPanels(): CheckoutPanels | undefined {
  return loaded;
}

/**
 * Tải chunk các khối (gộp các lần gọi trùng). Hỏng thì thử lại ngay một lần: webpack bỏ chunk hỏng khỏi bộ nhớ nên lần sau tải lại thật.
 * Vẫn hỏng thì lần gọi sau bắt đầu lại từ đầu (nút Thử lại của khối).
 */
export function loadPanels(): Promise<CheckoutPanels> {
  pending ??= import('./checkout-panels')
    .catch(() => import('./checkout-panels'))
    .then(
      (m) => (loaded = m),
      (err: unknown) => {
        pending = undefined;
        throw err;
      },
    );
  return pending;
}

/** Bắt đầu tải sẵn (lúc rảnh, lúc giỏ làm nóng Thanh toán, lúc bấm Đặt hàng). Không bao giờ lỗi: khối tự tải lại và báo khi được vẽ. */
export function loadCheckoutPanels(): Promise<void> {
  return loadPanels().then(
    () => undefined,
    () => undefined,
  );
}
