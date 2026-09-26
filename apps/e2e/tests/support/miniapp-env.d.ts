// Chỉ để type-check: tests/support/mock-api.ts `import type` từ apps/miniapp/src/services/**, mà
// services/api.ts đọc `import.meta.env.VITE_API_BASE_URL` (type của vite/client — e2e không cài vite).
interface ImportMetaEnv {
  readonly [key: string]: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
