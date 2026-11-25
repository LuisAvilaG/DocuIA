import { pgTable, varchar, integer, json, timestamp, date, index, uniqueIndex } from "drizzle-orm/pg-core";

// ── Mapa de aprobaciones ──────────────────────────────────────────────
// Quién firma un caso se dibuja en un mapa (preguntas que abren caminos y
// firmas de roles o personas). Los mapas nombran roles, no personas: cada rol
// tiene sus personas, un suplente y las ausencias de cada quien.

// Un rol de firma (Jurídica, Gerencia…) y quién lo cubre cuando nadie del rol puede.
export const approvalRoles = pgTable("approval_roles", {
  id:               varchar("id", { length: 36 }).primaryKey(),
  organizationId:   varchar("organization_id", { length: 36 }).notNull(),
  name:             varchar("name", { length: 120 }).notNull(),
  substituteUserId: varchar("substitute_user_id", { length: 36 }),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("approval_roles_org_idx").on(t.organizationId),
]);

export const approvalRoleMembers = pgTable("approval_role_members", {
  roleId:         varchar("role_id", { length: 36 }).notNull(),
  userId:         varchar("user_id", { length: 36 }).notNull(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
}, (t) => [
  uniqueIndex("approval_role_members_role_user_idx").on(t.roleId, t.userId),
  index("approval_role_members_org_idx").on(t.organizationId),
]);

// Días (en la zona de la organización, ambos incluidos) en que alguien no firma.
export const approvalAbsences = pgTable("approval_absences", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  userId:         varchar("user_id", { length: 36 }).notNull(),
  startsOn:       date("starts_on", { mode: "string" }).notNull(),
  endsOn:         date("ends_on", { mode: "string" }).notNull(),
  createdBy:      varchar("created_by", { length: 36 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("approval_absences_org_idx").on(t.organizationId),
]);

// El mapa: el borrador que se edita y la última versión publicada, que es la
// que reciben los casos nuevos (cada caso guarda la copia con la que empezó).
export const approvalMaps = pgTable("approval_maps", {
  id:             varchar("id", { length: 36 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 36 }).notNull(),
  name:           varchar("name", { length: 150 }).notNull(),
  draftJson:      json("draft_json").notNull(),
  publishedJson:  json("published_json"),
  version:        integer("version").notNull().default(0),
  publishedAt:    timestamp("published_at"),
  publishedBy:    varchar("published_by", { length: 36 }),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("approval_maps_org_idx").on(t.organizationId),
]);
