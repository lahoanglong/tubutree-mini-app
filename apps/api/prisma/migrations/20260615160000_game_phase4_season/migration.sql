-- Vườn Xanh 2.0 Phase 4: mùa/sự kiện
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" TEXT,
    "region" TEXT,
    "featuredSpeciesIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "seasons_startAt_endAt_idx" ON "seasons"("startAt", "endAt");
