/**
 * Bootstrap có giữ thân thô (req.rawBody) cho /api/webhooks/zalo-oa hay không. Chữ ký X-ZEvent-Signature băm trên thân thô; thiếu nó
 * controller băm lại JSON.stringify(body đã parse), lệch khi Zalo gửi ký tự thoát (\\/, \\u0026) và mọi tin loại đó bị 401.
 * Đổi thành true cùng lúc với việc thêm `verify` lưu buffer cho route này trong createBodyParsers (bootstrap.ts).
 */
export const ZALO_OA_RAW_BODY_CAPTURED = false;
