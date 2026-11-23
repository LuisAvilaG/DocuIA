import { db } from "@/lib/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getFeature } from "@/lib/features";
import { qaModeActive, type QaConfig } from "./qa-mode";

export interface QaModeState {
  active: boolean;
  expiresOn: string | null;
  config: QaConfig | null;
}

/** Estado vigente del modo QA de un cliente (lo usan el envío al ERP y el monitor). */
export async function qaModeState(organizationId: string, now = new Date()): Promise<QaModeState> {
  const [feature, org] = await Promise.all([
    getFeature(organizationId, "qa_mode").catch(() => null),
    db.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: { activeNsEnvironment: true, timezone: true },
    }),
  ]);
  if (!feature) return { active: false, expiresOn: null, config: null };
  const active = qaModeActive(feature.isEnabled, feature.config, org?.activeNsEnvironment, now, org?.timezone);
  const config = feature.config as unknown as QaConfig;
  return { active, expiresOn: active ? config.expires_on : null, config: active ? config : null };
}
