import { z } from "zod";

const identity = z.object({
  sub: z.string().uuid(),
  type: z.enum(["org_user", "platform_admin"]),
  sessionId: z.string().uuid(),
});

export const accessPayloadSchema = identity.extend({
  tokenUse: z.literal("access"),
  email: z.string().email(),
  orgId: z.string().uuid().optional(),
  role: z.enum(["admin", "operator", "viewer", "expense_submitter"]).optional(),
  homePath: z.enum(["/dashboard", "/contracts/dashboard", "/accounting/expenses"]).optional(),
}).refine(p => p.type !== "org_user" || Boolean(p.orgId && p.role));

export const refreshPayloadSchema = identity.extend({
  tokenUse: z.literal("refresh"),
  tokenNonce: z.string().regex(/^[a-f0-9]{64}$/),
});
