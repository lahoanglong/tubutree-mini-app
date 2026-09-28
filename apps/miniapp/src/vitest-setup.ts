// Nạp matcher jest-dom (toBeInTheDocument, ...) cho mọi test component (*.spec.tsx).
// Subpath /vitest tự gọi expect.extend() bằng `expect` của vitest — không cần import thủ công
// ở từng file spec.
import '@testing-library/jest-dom/vitest';
