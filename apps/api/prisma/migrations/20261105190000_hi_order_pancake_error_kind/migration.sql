-- Loại lỗi đẩy đơn sang Pancake (DATA | CONFIG | REJECTED | TRANSIENT). Cột nullable, không backfill: đơn cũ để null.
ALTER TABLE "orders" ADD COLUMN "pancakeErrorKind" TEXT;
