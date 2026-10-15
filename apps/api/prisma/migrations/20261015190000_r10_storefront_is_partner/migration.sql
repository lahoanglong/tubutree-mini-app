ALTER TABLE "storefronts" ADD COLUMN "isPartner" BOOLEAN NOT NULL DEFAULT false;

UPDATE "storefronts" SET "isPartner" = true
 WHERE "type" = 'MERCHANT'
    OR ("type" = 'CTV' AND "ownerUserId" IN (SELECT "id" FROM "users" WHERE "role" = 'DEALER'));
