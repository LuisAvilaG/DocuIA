import { NextRequest } from "next/server";
import type { PgBoss } from "pg-boss";

/**
 * The application already owns a durable pg-boss worker.  These schedules live
 * in PostgreSQL, so they survive deploys and are claimed only once when the
 * app is scaled to more than one replica.
 *
 * The protected HTTP handlers remain the single implementation of each task.
 * Calling them in-process avoids duplicating the tenant/feature rules while
 * retaining the endpoints for an authenticated manual diagnostic run.
 */
export const INTERNAL_SCHEDULES = [
  { key: "reap-stuck", queue: "system-reap-stuck", cron: "*/5 * * * *", expireInSeconds: 120 },
  { key: "auto-sync", queue: "system-auto-sync", cron: "*/5 * * * *", expireInSeconds: 20 * 60 },
  { key: "expense-categories-sync", queue: "system-expense-categories-sync", cron: "20 2 * * *", expireInSeconds: 20 * 60 },
  { key: "retention", queue: "system-retention", cron: "0 3 * * *", expireInSeconds: 20 * 60 },
  { key: "scheduled-reports", queue: "system-scheduled-reports", cron: "0 8 * * *", expireInSeconds: 10 * 60 },
  { key: "contract-alerts", queue: "system-contract-alerts", cron: "15 8 * * *", expireInSeconds: 10 * 60 },
] as const;

type ScheduledTask = (typeof INTERNAL_SCHEDULES)[number];

const SCHEDULE_TIMEZONE = "America/Mexico_City";
const INTERNAL_REQUEST_URL = "http://docuia-internal/scheduler";
let schedulerBoot: Promise<void> | null = null;

async function invokeTask(task: ScheduledTask): Promise<unknown> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET is required for the internal scheduler");
  }

  const request = new NextRequest(`${INTERNAL_REQUEST_URL}/${task.key}`, {
    headers: { "x-cron-secret": secret },
  });

  let response: Response;
  switch (task.key) {
    case "reap-stuck": {
      const route = await import("@/app/api/internal/cron/reap-stuck/route");
      response = await route.GET(request);
      break;
    }
    case "auto-sync": {
      const route = await import("@/app/api/internal/cron/auto-sync/route");
      response = await route.GET(request);
      break;
    }
    case "expense-categories-sync": {
      const route = await import("@/app/api/internal/cron/expense-categories-sync/route");
      response = await route.GET(request);
      break;
    }
    case "retention": {
      const route = await import("@/app/api/internal/cron/retention/route");
      response = await route.GET(request);
      break;
    }
    case "scheduled-reports": {
      const route = await import("@/app/api/internal/cron/scheduled-reports/route");
      response = await route.GET(request);
      break;
    }
    case "contract-alerts": {
      const route = await import("@/app/api/internal/cron/contract-alerts/route");
      response = await route.GET(request);
      break;
    }
  }

  const payload = await response.json() as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error ?? `Task ${task.key} failed with HTTP ${response.status}`);
  }
  return payload;
}

/** Registers idempotent, database-backed schedules and their workers. */
export async function startInternalScheduler(boss: PgBoss): Promise<void> {
  if (schedulerBoot) return schedulerBoot;
  schedulerBoot = registerInternalScheduler(boss).catch((error: unknown) => {
    schedulerBoot = null;
    throw error;
  });
  return schedulerBoot;
}

async function registerInternalScheduler(boss: PgBoss): Promise<void> {
  if (process.env.INTERNAL_SCHEDULER_ENABLED === "false") {
    console.info("[scheduler] disabled by INTERNAL_SCHEDULER_ENABLED=false");
    return;
  }

  for (const task of INTERNAL_SCHEDULES) {
    // `exclusive` prevents a slow run from piling up duplicate work.  Each
    // task has its own queue, so a NetSuite sync never blocks retention/reporting.
    await boss.createQueue(task.queue, {
      policy: "exclusive",
      expireInSeconds: task.expireInSeconds,
      retryLimit: 1,
      retryDelay: 60,
      retryBackoff: true,
      deleteAfterSeconds: 7 * 24 * 60 * 60,
    });

    await boss.work(task.queue, async () => {
      await invokeTask(task);
      console.info("[scheduler] completed", { task: task.key });
    });

    await boss.schedule(task.queue, task.cron, {}, {
      key: task.key,
      tz: SCHEDULE_TIMEZONE,
      expireInSeconds: task.expireInSeconds,
      retryLimit: 1,
      retryDelay: 60,
      retryBackoff: true,
    });
  }

  console.info("[scheduler] internal schedules registered", {
    timezone: SCHEDULE_TIMEZONE,
    tasks: INTERNAL_SCHEDULES.map(({ key, cron }) => ({ key, cron })),
  });
}
