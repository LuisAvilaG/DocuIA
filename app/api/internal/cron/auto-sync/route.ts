import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nsConnections, subsidiaries, catalogItems, catalogVendors, catalogLocations, orgFeatures } from "@/db/schema";
import { and, eq, max, sql } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { fetchCatalogPage } from "@/lib/netsuite/client";
import type { NSCredentials } from "@/lib/netsuite/oauth";
import type { NSCatalogItem, NSVendor, NSLocation } from "@/lib/netsuite/client";
import { decryptField } from "@/lib/crypto/encrypt";

function cronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("x-cron-secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const orgs = await db.query.organizations.findMany({ columns: { id: true } });
    const summary: Record<string, unknown> = {};

    for (const org of orgs) {
      let feat;
      try {
        feat = await getFeature(org.id, "auto_sync");
      } catch {
        continue;
      }
      if (!feat.isEnabled) continue;

      const config = feat.config as { interval_hours?: number; check_every_minutes?: number; start_delay_seconds?: number; last_check_at?: string };
      const intervalMs = (config.interval_hours ?? 24) * 3600_000;
      const checkEveryMs = Math.max(1, config.check_every_minutes ?? 5) * 60_000;
      const lastCheckAt = config.last_check_at ? new Date(config.last_check_at).getTime() : 0;
      if (lastCheckAt && Date.now() - lastCheckAt < checkEveryMs) {
        summary[org.id] = { skipped: "check interval not reached" };
        continue;
      }

      const [featureOverride] = await db.select({ configJson: orgFeatures.configJson, updatedAt: orgFeatures.updatedAt })
        .from(orgFeatures)
        .where(and(eq(orgFeatures.organizationId, org.id), eq(orgFeatures.featureId, "auto_sync")));
      const startDelayMs = Math.max(0, config.start_delay_seconds ?? 20) * 1000;
      if (featureOverride?.updatedAt && Date.now() - featureOverride.updatedAt.getTime() < startDelayMs) {
        summary[org.id] = { skipped: "initial delay not reached" };
        continue;
      }

      // `check_every_minutes` controls the tenant's effective cadence even when
      // the deployment invokes this endpoint more frequently.
      await db.update(orgFeatures).set({
        configJson: { ...((featureOverride?.configJson ?? {}) as Record<string, unknown>), last_check_at: new Date().toISOString() },
      }).where(and(eq(orgFeatures.organizationId, org.id), eq(orgFeatures.featureId, "auto_sync")));

      const advancedFeature = await getFeature(org.id, "sync_advanced");
      const advanced = advancedFeature.config as {
        page_size?: number;
        mx_max_subsidiaries_per_run?: number;
        mx_service_category_id?: number;
        request_timeout_ms?: number;
      };
      const pageSize = Math.min(1000, Math.max(50, Math.round(advanced.page_size ?? 500)));
      const timeoutMs = Math.min(120_000, Math.max(5_000, Math.round(advanced.request_timeout_ms ?? 45_000)));

      const allSubs = await db.query.subsidiaries.findMany({
        where: and(
          eq(subsidiaries.organizationId, org.id),
          eq(subsidiaries.isActive, true),
        ),
      });
      const mxLimit = Math.max(0, Math.round(advanced.mx_max_subsidiaries_per_run ?? 0));
      const mxSubs = allSubs.filter(sub => sub.currency === "MXN");
      const otherSubs = allSubs.filter(sub => sub.currency !== "MXN");
      const subs = mxLimit > 0 ? [...otherSubs, ...mxSubs.slice(0, mxLimit)] : allSubs;

      const conn = await db.query.nsConnections.findFirst({
        where: and(
          eq(nsConnections.organizationId, org.id),
          eq(nsConnections.isActive, true),
        ),
      });

      if (!conn?.catalogScriptId || !conn?.catalogDeployId) {
        summary[org.id] = { skipped: "no catalog script configured" };
        continue;
      }

      const creds: NSCredentials = {
        accountId:      conn.accountId,
        consumerKey:    decryptField(conn.consumerKey),
        consumerSecret: decryptField(conn.consumerSecret),
        tokenId:        decryptField(conn.tokenId),
        tokenSecret:    decryptField(conn.tokenSecret),
      };

      const orgSummary: Record<string, unknown> = {};

      for (const sub of subs) {
        // Check last sync via most recent updatedAt in catalog tables
        const [lastSync] = await db
          .select({ lastAt: max(catalogItems.updatedAt) })
          .from(catalogItems)
          .where(eq(catalogItems.subsidiaryId, sub.id));

        const lastAt = lastSync?.lastAt;
        if (lastAt && Date.now() - lastAt.getTime() < intervalMs) {
          orgSummary[sub.id] = { skipped: "not due yet" };
          continue;
        }

        const syncTypes: Array<"items" | "vendors" | "locations"> = ["items", "vendors", "locations"];
        const subSummary: Record<string, number> = {};

        for (const type of syncTypes) {
          let page = 0;
          let total = 0;
          const now = new Date();

          while (true) {
            const result = await fetchCatalogPage(
              creds, conn.catalogScriptId, conn.catalogDeployId,
              type, sub.nsSubsidiaryId, page, pageSize, timeoutMs,
              type === "items" && sub.currency === "MXN" ? String(advanced.mx_service_category_id ?? "") : undefined,
            );
            if (!result.ok || !result.data) break;
            const rows = result.data.results;
            if (!rows.length) break;

            // Batch upsert the whole page in one statement (was one round-trip
            // per row → 500 per page). set: reads each row's own EXCLUDED values.
            if (type === "items") {
              const values = (rows as NSCatalogItem[]).map(row => ({
                subsidiaryId: sub.id,
                internalId:   row.internal_id,
                itemid:       row.itemid || null,
                name:         row.name   || null,
                type:         row.type   || null,
                unit:         row.unit   || null,
                drtUnitId:    row.drt_unit_uom_id   || null,
                drtUnitName:  row.drt_unit_uom_name || null,
                updatedAt:    now,
              }));
              if (values.length) {
                await db.insert(catalogItems).values(values).onConflictDoUpdate({
                  target: [catalogItems.subsidiaryId, catalogItems.internalId],
                  set: {
                    itemid: sql`excluded.itemid`, name: sql`excluded.name`, type: sql`excluded.type`,
                    unit: sql`excluded.unit`, drtUnitId: sql`excluded.drt_unit_id`,
                    drtUnitName: sql`excluded.drt_unit_name`, updatedAt: sql`excluded.updated_at`,
                  },
                });
              }
            }
            if (type === "vendors") {
              const values = (rows as NSVendor[]).map(row => ({
                subsidiaryId: sub.id, internalId: row.internal_id,
                entityid: row.entityid || null, name: row.name || null,
                email: row.email || null, phone: row.phone || null,
                rfc: row.rfc || null, isInactive: row.inactive ?? false, updatedAt: now,
              }));
              if (values.length) {
                await db.insert(catalogVendors).values(values).onConflictDoUpdate({
                  target: [catalogVendors.subsidiaryId, catalogVendors.internalId],
                  set: {
                    entityid: sql`excluded.entityid`, name: sql`excluded.name`,
                    email: sql`excluded.email`, phone: sql`excluded.phone`,
                    rfc: sql`excluded.rfc`, isInactive: sql`excluded.is_inactive`,
                    updatedAt: sql`excluded.updated_at`,
                  },
                });
              }
            }
            if (type === "locations") {
              // Drop this subsidiary's locations once before repopulating, to
              // clear rows wrongly stored for other subsidiaries before the
              // subsidiary filter existed.
              if (page === 0) {
                await db.delete(catalogLocations).where(eq(catalogLocations.subsidiaryId, sub.id));
              }
              const values = (rows as NSLocation[]).map(row => ({
                subsidiaryId: sub.id, internalId: row.internal_id,
                name: row.name || null, fullName: row.full_name || null,
                isInactive: row.inactive ?? false, updatedAt: now,
              }));
              if (values.length) {
                await db.insert(catalogLocations).values(values).onConflictDoUpdate({
                  target: [catalogLocations.subsidiaryId, catalogLocations.internalId],
                  set: {
                    name: sql`excluded.name`, fullName: sql`excluded.full_name`,
                    isInactive: sql`excluded.is_inactive`, updatedAt: sql`excluded.updated_at`,
                  },
                });
              }
            }

            total += rows.length;
            if (page + 1 >= result.data.page_count) break;
            page++;
          }
          subSummary[type] = total;
        }
        orgSummary[sub.id] = subSummary;
      }
      summary[org.id] = orgSummary;
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[cron/auto-sync]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
