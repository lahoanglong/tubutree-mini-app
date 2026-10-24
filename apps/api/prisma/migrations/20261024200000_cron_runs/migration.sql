CREATE TABLE "cron_runs" (
    "job" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3) NOT NULL,
    "lastFinishedAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDurationMs" INTEGER NOT NULL,
    "lastAlertedAt" TIMESTAMP(3),

    CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("job")
);

INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES
  ('nt-ops-cron-failed', 'OPS_CRON_FAILED', 'INAPP', 'Tác vụ nền "{{job}}" đã lỗi {{count}} lần liên tiếp. Lỗi gần nhất: {{error}}. Xem mục Tác vụ nền ở màn Sức khoẻ hệ thống.')
ON CONFLICT DO NOTHING;
