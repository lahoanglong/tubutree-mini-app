-- Đơn đại lý vượt tồn kho: trước đây bị TỪ CHỐI thẳng. Nay cho đặt trước (backorder) —
-- reserve phần tồn kho ĐANG CÓ, ghi phần còn thiếu vào backorderedQty, và một job đối soát
-- lấp dần khi hàng về (theo Pancake sync tăng stock), FIFO theo đơn cũ trước.
--
-- Mọi đơn KHÔNG phải đại lý luôn có backorderedQty = 0 — không đổi hành vi checkout/CTV/subscription.

ALTER TABLE "order_items" ADD COLUMN "backorderedQty" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "order_items_variationId_backorderedQty_idx"
  ON "order_items"("variationId", "backorderedQty");
