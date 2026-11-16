-- W184: đếm số lần webhook (Pancake, Gomdon) bị từ chối 401 theo nguồn và khung 5 phút. Chỉ thêm bảng mới, không đổi dữ liệu có sẵn.
-- CreateTable
CREATE TABLE "webhook_reject_counters" (
    "source" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_reject_counters_pkey" PRIMARY KEY ("source","bucketStart")
);
