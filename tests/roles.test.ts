import test from "node:test";
import assert from "node:assert/strict";
import { canAccessTenantArea, canApprove, canReviewExpenses, canSyncExpenses, isTenantRole } from "../lib/auth/permissions";
import { accessPayloadSchema } from "../lib/auth/token-payload";

test("approver works like an operator and approves in every product", () => {
  assert.equal(canAccessTenantArea("approver", { area: "documents", permission: "write" }), true);
  assert.equal(canAccessTenantArea("approver", { area: "contracts", permission: "write" }), true);
  assert.equal(canAccessTenantArea("approver", { area: "expenses", permission: "write" }), true);
  assert.equal(canAccessTenantArea("approver", { area: "settings" }), false);
  for (const area of ["documents", "contracts", "expenses"] as const) assert.equal(canApprove("approver", area), true);
  assert.equal(canSyncExpenses("approver"), false);
});

test("accountant owns expense accounting and only reads AP documents", () => {
  assert.equal(canAccessTenantArea("accountant", { area: "expenses", permission: "write" }), true);
  assert.equal(canAccessTenantArea("accountant", { area: "documents" }), true);
  assert.equal(canAccessTenantArea("accountant", { area: "documents", permission: "write" }), false);
  assert.equal(canAccessTenantArea("accountant", { area: "contracts" }), false);
  assert.equal(canApprove("accountant", "expenses"), true);
  assert.equal(canApprove("accountant", "documents"), false);
  assert.equal(canSyncExpenses("accountant"), true);
});

test("existing roles keep their previous access", () => {
  assert.equal(canApprove("operator", "documents"), false);
  assert.equal(canReviewExpenses("operator"), false);
  assert.equal(canAccessTenantArea("operator", { area: "expenses" }), false);
  assert.equal(canAccessTenantArea("viewer", { area: "documents", permission: "write" }), false);
  assert.equal(canAccessTenantArea("expense_submitter", { area: "documents" }), false);
  assert.equal(canReviewExpenses("expense_submitter"), false);
  assert.equal(canAccessTenantArea("unknown_role", { area: "profile" }), false);
  assert.equal(isTenantRole("superuser"), false);
});

test("access tokens accept the new roles", () => {
  const base = {
    sub: "10000000-0000-4000-8000-000000000002", type: "org_user", sessionId: "10000000-0000-4000-8000-000000000003",
    tokenUse: "access", email: "a@example.com", orgId: "10000000-0000-4000-8000-000000000001",
  };
  assert.equal(accessPayloadSchema.safeParse({ ...base, role: "approver" }).success, true);
  assert.equal(accessPayloadSchema.safeParse({ ...base, role: "accountant" }).success, true);
  assert.equal(accessPayloadSchema.safeParse({ ...base, role: "root" }).success, false);
});
