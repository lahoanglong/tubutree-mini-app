/**
 * zmp-ui (Sheet, TabBar) nhập `resize-observer-polyfill` (~8 KB đã nén). Bản build nhắm safari13.1 trở lên,
 * nơi ResizeObserver đã có sẵn, nên vite.config.mts trỏ gói đó về file này. Lớp rỗng chỉ để môi trường thiếu API
 * (máy rất cũ) không vỡ trang: Sheet vẫn mở, chỉ không tự đo lại khi nội dung đổi cỡ.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const NativeOrNoop: typeof ResizeObserver =
  typeof globalThis.ResizeObserver === 'function' ? globalThis.ResizeObserver : (NoopResizeObserver as unknown as typeof ResizeObserver);

export default NativeOrNoop;
