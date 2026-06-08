// All cross-table Drizzle relations live here to avoid circular imports.
import { relations } from "drizzle-orm";
import { organizations, orgUsers } from "./organizations";
import { subsidiaries, subsidiaryDocumentConfigs } from "./subsidiaries";
import { orgFeatures, subscriptions } from "./plans";
import { nsConnections } from "./connections";
import {
  expenseReports, expenseItems, expenseDocuments,
  expenseCategories, catalogDepartments, catalogClasses,
} from "./expenses";

export const orgRelations = relations(organizations, ({ many }) => ({
  users:         many(orgUsers),
  features:      many(orgFeatures),
  subsidiaries:  many(subsidiaries),
  subscription:  many(subscriptions),
  nsConnections: many(nsConnections),
}));

export const nsConnectionRelations = relations(nsConnections, ({ one }) => ({
  organization: one(organizations, {
    fields: [nsConnections.organizationId],
    references: [organizations.id],
  }),
}));

export const orgUserRelations = relations(orgUsers, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgUsers.organizationId],
    references: [organizations.id],
  }),
}));

export const subsidiaryRelations = relations(subsidiaries, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [subsidiaries.organizationId],
    references: [organizations.id],
  }),
  documentConfigs: many(subsidiaryDocumentConfigs),
}));

export const subsidiaryDocConfigRelations = relations(subsidiaryDocumentConfigs, ({ one }) => ({
  subsidiary: one(subsidiaries, {
    fields: [subsidiaryDocumentConfigs.subsidiaryId],
    references: [subsidiaries.id],
  }),
}));

export const orgFeaturesRelations = relations(orgFeatures, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgFeatures.organizationId],
    references: [organizations.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
}));

// ── Expense relations ─────────────────────────────────────────────────

export const expenseReportsRelations = relations(expenseReports, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [expenseReports.organizationId],
    references: [organizations.id],
  }),
  submitter: one(orgUsers, {
    fields: [expenseReports.submitterId],
    references: [orgUsers.id],
  }),
  items: many(expenseItems),
}));

export const expenseItemsRelations = relations(expenseItems, ({ one, many }) => ({
  report: one(expenseReports, {
    fields: [expenseItems.reportId],
    references: [expenseReports.id],
  }),
  category: one(expenseCategories, {
    fields: [expenseItems.categoryId],
    references: [expenseCategories.id],
  }),
  department: one(catalogDepartments, {
    fields: [expenseItems.departmentId],
    references: [catalogDepartments.id],
  }),
  class: one(catalogClasses, {
    fields: [expenseItems.classId],
    references: [catalogClasses.id],
  }),
  documents: many(expenseDocuments),
}));

export const expenseDocumentsRelations = relations(expenseDocuments, ({ one }) => ({
  item: one(expenseItems, {
    fields: [expenseDocuments.itemId],
    references: [expenseItems.id],
  }),
}));
