-- Vườn Xanh 2.0 Phase 3: sổ tay loài cây
CREATE TYPE "SpeciesRarity" AS ENUM ('COMMON', 'RARE', 'LEGENDARY');

CREATE TABLE "plant_species" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scientificName" TEXT,
    "region" TEXT,
    "rarity" "SpeciesRarity" NOT NULL DEFAULT 'COMMON',
    "story" TEXT,
    "ecoFact" TEXT,
    "emoji" TEXT NOT NULL DEFAULT '🌳',
    "imageUrl" TEXT,
    CONSTRAINT "plant_species_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_species" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "speciesId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstCollectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_species_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_species_userId_speciesId_key" ON "user_species"("userId", "speciesId");
CREATE INDEX "user_species_userId_idx" ON "user_species"("userId");

ALTER TABLE "user_species" ADD CONSTRAINT "user_species_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_species" ADD CONSTRAINT "user_species_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "plant_species"("id") ON DELETE CASCADE ON UPDATE CASCADE;
