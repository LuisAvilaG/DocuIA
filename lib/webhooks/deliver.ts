import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { webhooks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { assertPublicHttpsUrl } from "./ssrf";

export type WebhookEvent = "document.completed" | "document.review" | "document.failed";

export type WebhookPayload = {
  event:          WebhookEvent;
  timestamp:      string;
  organizationId: string;
  document: {
    id:           number;
    status:       string;
    documentType: string;
    vendor:       string | null;
    total:        string | null;
    netsuiteDocId?: string | null;
    recordUrl?:    string | null;
    error?:        string | null;
  };
};

function sign(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

export async function deliverWebhooks(
  organizationId: string,
  event: WebhookEvent,
  payload: Omit<WebhookPayload, "event" | "timestamp" | "organizationId">
): Promise<void> {
  const hooks = await db.query.webhooks.findMany({
    where: and(
      eq(webhooks.organizationId, organizationId),
      eq(webhooks.isActive, true),
    ),
  });

  const eventShort = event.replace("document.", "") as "completed" | "review" | "failed";
  const active = hooks.filter(h => h.events?.includes(eventShort));
  if (active.length === 0) return;

  const body: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    organizationId,
    ...payload,
  };
  const bodyStr = JSON.stringify(body);

  await Promise.all(
    active.map(async hook => {
      const sig = sign(bodyStr, hook.secret);
      let statusCode = 0;
      try {
        // Re-validate at delivery time to defeat DNS rebinding since save.
        await assertPublicHttpsUrl(hook.url);
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type":     "application/json",
            "X-DocuIA-Event":   event,
            "X-DocuIA-Signature": sig,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(10_000),
        });
        statusCode = res.status;
      } catch {
        statusCode = 0;
      }
      await db.update(webhooks)
        .set({ lastTriggeredAt: new Date(), lastStatusCode: statusCode })
        .where(eq(webhooks.id, hook.id));
    })
  );
}
