CREATE TYPE "public"."org_status" AS ENUM('trial', 'active', 'suspended', 'churned');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'viewer', 'expense_submitter');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('org_user', 'platform_admin');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."usage_event_type" AS ENUM('doc_processed', 'ai_primary_call', 'ai_fallback_call', 'sync_run', 'api_call', 'bulk_upload_doc', 'webhook_delivery');--> statement-breakpoint
CREATE TYPE "public"."feature_category" AS ENUM('extraction', 'mapping', 'workflow', 'sync', 'integration', 'analytics', 'security', 'enterprise', 'storage', 'expenses');--> statement-breakpoint
CREATE TYPE "public"."feature_type" AS ENUM('boolean', 'config', 'boolean_config');--> statement-breakpoint
CREATE TYPE "public"."plan_required" AS ENUM('starter', 'growth', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."ns_connection_status" AS ENUM('pending', 'testing', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."ns_environment" AS ENUM('sandbox', 'production');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'extracting', 'review', 'pending_approval', 'approved', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('invoice', 'purchase_order', 'xml_cfdi');--> statement-breakpoint
CREATE TYPE "public"."exception_status" AS ENUM('pending', 'in_progress', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."failure_stage" AS ENUM('extract', 'validate', 'process');--> statement-breakpoint
CREATE TYPE "public"."workflow_log_status" AS ENUM('STARTED', 'INFO', 'SUCCESS', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."expense_document_type" AS ENUM('invoice', 'receipt', 'cuenta_cobro', 'documento_equivalente', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."expense_ns_record_type" AS ENUM('expense_report', 'vendor_bill');--> statement-breakpoint
CREATE TYPE "public"."expense_payment_method" AS ENUM('personal', 'company_pays_vendor');--> statement-breakpoint
CREATE TYPE "public"."expense_report_status" AS ENUM('draft', 'submitted', 'under_review', 'approved', 'rejected', 'syncing', 'synced', 'exception');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"user_type" "user_type" NOT NULL,
	"organization_id" varchar(36),
	"refresh_token" varchar(255) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_users" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"email" varchar(191) NOT NULL,
	"password_hash" varchar(255),
	"full_name" varchar(255),
	"role" "user_role" DEFAULT 'operator' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"invited_by" varchar(36),
	"email_verified" boolean DEFAULT false NOT NULL,
	"verify_token" varchar(100),
	"reset_token" varchar(100),
	"reset_token_expires_at" timestamp,
	"netsuite_employee_id" varchar(64),
	"manager_id" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"status" "org_status" DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp,
	"stripe_customer_id" varchar(100),
	"billing_email" varchar(255),
	"timezone" varchar(60) DEFAULT 'America/Mexico_City' NOT NULL,
	"logo_url" text,
	"primary_color" varchar(7),
	"active_ns_environment" varchar(20) DEFAULT 'sandbox',
	"auto_process_threshold" real DEFAULT 0.85 NOT NULL,
	"ai_api_key_encrypted" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"email" varchar(191) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"full_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_features" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"feature_id" varchar(80) NOT NULL,
	"admin_granted" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"config_json" json,
	"enabled_by" varchar(36),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"price_monthly" numeric(10, 2) DEFAULT '0' NOT NULL,
	"price_yearly" numeric(10, 2),
	"docs_limit" integer DEFAULT 100 NOT NULL,
	"users_limit" integer DEFAULT 1 NOT NULL,
	"subsidiaries_limit" integer DEFAULT 1 NOT NULL,
	"overage_per_doc" numeric(8, 4) DEFAULT '0' NOT NULL,
	"stripe_price_id_monthly" varchar(100),
	"stripe_price_id_yearly" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"plan_id" varchar(50) NOT NULL,
	"stripe_subscription_id" varchar(100),
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"current_period_start" timestamp NOT NULL,
	"current_period_end" timestamp NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp,
	"trial_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"date" varchar(10) NOT NULL,
	"docs_processed" integer DEFAULT 0 NOT NULL,
	"docs_invoice" integer DEFAULT 0 NOT NULL,
	"docs_po" integer DEFAULT 0 NOT NULL,
	"docs_xml" integer DEFAULT 0 NOT NULL,
	"ai_primary_calls" integer DEFAULT 0 NOT NULL,
	"ai_fallback_calls" integer DEFAULT 0 NOT NULL,
	"ai_tokens_input" integer DEFAULT 0 NOT NULL,
	"ai_tokens_output" integer DEFAULT 0 NOT NULL,
	"sync_runs" integer DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36),
	"event_type" "usage_event_type" NOT NULL,
	"document_type" varchar(60),
	"ai_model" varchar(120),
	"tokens_input" integer,
	"tokens_output" integer,
	"duration_ms" integer,
	"metadata_json" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"category" "feature_category" NOT NULL,
	"feature_type" "feature_type" DEFAULT 'boolean' NOT NULL,
	"default_enabled" boolean DEFAULT false NOT NULL,
	"default_config" json,
	"config_schema" json,
	"plan_required" "plan_required" DEFAULT 'starter' NOT NULL,
	"is_beta" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ns_connections" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"environment" "ns_environment" NOT NULL,
	"account_id" varchar(100) NOT NULL,
	"consumer_key" text NOT NULL,
	"consumer_secret" text NOT NULL,
	"token_id" text NOT NULL,
	"token_secret" text NOT NULL,
	"catalog_script_id" varchar(50),
	"catalog_deploy_id" varchar(50),
	"process_script_id" varchar(50),
	"process_deploy_id" varchar(50),
	"connection_status" "ns_connection_status" DEFAULT 'pending' NOT NULL,
	"connection_tested_at" timestamp,
	"connection_error" text,
	"scripts_installed" boolean DEFAULT false NOT NULL,
	"scripts_installed_at" timestamp,
	"install_method" varchar(20),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"internal_id" varchar(64) NOT NULL,
	"itemid" varchar(191),
	"name" varchar(500),
	"type" varchar(120),
	"unit" varchar(120),
	"drt_unit_id" varchar(255),
	"drt_unit_name" varchar(255),
	"service_only" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_locations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"internal_id" varchar(64) NOT NULL,
	"name" varchar(500),
	"full_name" varchar(500),
	"is_inactive" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_vendors" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"internal_id" varchar(64) NOT NULL,
	"entityid" varchar(191),
	"name" varchar(500),
	"email" varchar(255),
	"phone" varchar(100),
	"rfc" varchar(50),
	"is_inactive" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_mappings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"vendor" varchar(191) NOT NULL,
	"vendor_norm" varchar(191) NOT NULL,
	"vendor_item_name" varchar(512) NOT NULL,
	"vendor_item_norm" varchar(512) NOT NULL,
	"netsuite_internal_id" varchar(64) NOT NULL,
	"netsuite_item_name" varchar(255),
	"netsuite_unit" varchar(64),
	"times_confirmed" integer DEFAULT 1 NOT NULL,
	"auto_map" boolean DEFAULT false NOT NULL,
	"last_confirmed" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subsidiaries" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(255) NOT NULL,
	"ns_subsidiary_id" varchar(50) NOT NULL,
	"currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"locale" varchar(10) DEFAULT 'en-US' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subsidiary_document_configs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"document_type" varchar(50) NOT NULL,
	"extraction_engine" varchar(50) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"engine_config" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exception_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36),
	"document_type" varchar(60),
	"original_filename" varchar(500),
	"storage_key" text,
	"extraction_json" json,
	"failure_stage" "failure_stage" NOT NULL,
	"failure_reason" text,
	"error_code" varchar(80),
	"status" "exception_status" DEFAULT 'pending' NOT NULL,
	"assigned_to" varchar(36),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"last_retry_at" timestamp,
	"resolved_at" timestamp,
	"resolved_by" varchar(36),
	"resolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "history_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36) NOT NULL,
	"document_type" "document_type" NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"vendor" varchar(191),
	"num_doc" varchar(191),
	"total" numeric(14, 2) DEFAULT '0',
	"products" json,
	"storage_key" text,
	"url_netsuite" text,
	"netsuite_doc_id" varchar(191),
	"extraction_engine" varchar(120),
	"fallback_used" boolean DEFAULT false NOT NULL,
	"processed_by" varchar(36),
	"approved_by" varchar(36),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runtime_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"request_id" varchar(80),
	"stage" varchar(32),
	"step" varchar(64),
	"status" "workflow_log_status",
	"model" varchar(120),
	"engine" varchar(120),
	"document_type" varchar(32),
	"vendor" varchar(255),
	"invoice_number" varchar(120),
	"line_count" integer,
	"duration_ms" integer,
	"http_status" integer,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"meta_json" json,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" varchar(36) NOT NULL,
	"admin_email" varchar(191) NOT NULL,
	"action" varchar(100) NOT NULL,
	"target_org_id" varchar(36),
	"target_org_name" varchar(255),
	"target_user_id" varchar(36),
	"target_feature" varchar(80),
	"before_json" json,
	"after_json" json,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"scopes" json NOT NULL,
	"last_used_at" timestamp,
	"last_used_ip" varchar(64),
	"expires_at" timestamp,
	"created_by" varchar(36) NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impersonation_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"admin_id" varchar(36) NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"target_user_id" varchar(36) NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" varchar(36) NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"notify_doc_processed" boolean DEFAULT true NOT NULL,
	"notify_doc_failed" boolean DEFAULT true NOT NULL,
	"notify_doc_needs_review" boolean DEFAULT true NOT NULL,
	"notify_duplicate_found" boolean DEFAULT true NOT NULL,
	"notify_sync_failed" boolean DEFAULT true NOT NULL,
	"notify_sync_completed" boolean DEFAULT false NOT NULL,
	"notify_quota_80pct" boolean DEFAULT true NOT NULL,
	"notify_quota_100pct" boolean DEFAULT true NOT NULL,
	"notify_billing_invoice" boolean DEFAULT true NOT NULL,
	"notify_weekly_report" boolean DEFAULT false NOT NULL,
	"notify_monthly_report" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"step_account_created" boolean DEFAULT true NOT NULL,
	"step_email_verified" boolean DEFAULT false NOT NULL,
	"step_ns_configured" boolean DEFAULT false NOT NULL,
	"step_first_sync" boolean DEFAULT false NOT NULL,
	"step_first_doc" boolean DEFAULT false NOT NULL,
	"step_team_invited" boolean DEFAULT false NOT NULL,
	"step_mappings_10" boolean DEFAULT false NOT NULL,
	"step_webhook_configured" boolean DEFAULT false NOT NULL,
	"health_score" smallint DEFAULT 0 NOT NULL,
	"total_steps" smallint DEFAULT 8 NOT NULL,
	"completed_steps" smallint DEFAULT 0 NOT NULL,
	"completed_at" timestamp,
	"last_evaluated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{"completed","review","failed"}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"last_status_code" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"user_email" varchar(255),
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" text,
	"metadata" jsonb,
	"ip_address" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_classes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36),
	"netsuite_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_inactive" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_departments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36),
	"netsuite_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"is_inactive" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_approval_chains" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"name" varchar(150) DEFAULT 'Default' NOT NULL,
	"steps_json" json NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"subsidiary_id" varchar(36),
	"netsuite_category_id" varchar(64) NOT NULL,
	"netsuite_account_id" varchar(64),
	"netsuite_account_name" varchar(255),
	"netsuite_tax_code" varchar(64),
	"name" varchar(255) NOT NULL,
	"daily_cap" numeric(12, 2),
	"monthly_cap" numeric(12, 2),
	"required_doc_types" json DEFAULT '[]'::json,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"item_id" varchar(36) NOT NULL,
	"file_key" varchar(500),
	"mime_type" varchar(100),
	"original_name" varchar(255),
	"ocr_raw" json,
	"ocr_confidence" numeric(4, 3),
	"document_type_detected" "expense_document_type" DEFAULT 'unknown',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"report_id" varchar(36) NOT NULL,
	"line_number" integer DEFAULT 1 NOT NULL,
	"category_id" integer,
	"department_id" integer,
	"class_id" integer,
	"expense_date" timestamp,
	"description" text,
	"vendor_name" varchar(500),
	"vendor_nit" varchar(50),
	"vendor_ns_internal_id" varchar(64),
	"invoice_number" varchar(100),
	"invoice_date" timestamp,
	"subtotal" numeric(14, 2),
	"tax_amount" numeric(14, 2) DEFAULT '0',
	"retention_amount" numeric(14, 2) DEFAULT '0',
	"total" numeric(14, 2),
	"currency" varchar(10) DEFAULT 'COP' NOT NULL,
	"payment_method" "expense_payment_method" DEFAULT 'personal' NOT NULL,
	"document_type_detected" "expense_document_type" DEFAULT 'unknown',
	"needs_documento_equivalente" boolean DEFAULT false NOT NULL,
	"ns_record_type" "expense_ns_record_type",
	"ns_record_id" varchar(64),
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_reports" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"organization_id" varchar(36) NOT NULL,
	"submitter_id" varchar(36) NOT NULL,
	"purpose" varchar(500) NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"status" "expense_report_status" DEFAULT 'draft' NOT NULL,
	"rejected_reason" text,
	"submitted_at" timestamp,
	"approved_at" timestamp,
	"approved_by" varchar(36),
	"netsuite_expense_report_id" varchar(64),
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_tax_rules" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" varchar(36),
	"country_code" varchar(5) NOT NULL,
	"name" varchar(150) NOT NULL,
	"trigger_json" json NOT NULL,
	"taxes_json" json NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" varchar(191) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_idx" ON "auth_sessions" USING btree ("refresh_token");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id","user_type");--> statement-breakpoint
CREATE UNIQUE INDEX "org_users_email_unique_idx" ON "org_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_admins_email_idx" ON "platform_admins" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_features_org_feature_idx" ON "org_features" USING btree ("organization_id","feature_id");--> statement-breakpoint
CREATE INDEX "org_features_feature_idx" ON "org_features" USING btree ("feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_org_idx" ON "subscriptions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_idx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_org_date_idx" ON "usage_daily" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "usage_daily_date_idx" ON "usage_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "usage_events_org_date_idx" ON "usage_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_type_date_idx" ON "usage_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "features_category_idx" ON "features" USING btree ("category");--> statement-breakpoint
CREATE INDEX "features_plan_idx" ON "features" USING btree ("plan_required");--> statement-breakpoint
CREATE UNIQUE INDEX "ns_connections_org_env_idx" ON "ns_connections" USING btree ("organization_id","environment");--> statement-breakpoint
CREATE INDEX "ns_connections_org_idx" ON "ns_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_items_sub_internal_idx" ON "catalog_items" USING btree ("subsidiary_id","internal_id");--> statement-breakpoint
CREATE INDEX "catalog_items_sub_name_idx" ON "catalog_items" USING btree ("subsidiary_id","name");--> statement-breakpoint
CREATE INDEX "catalog_items_sub_itemid_idx" ON "catalog_items" USING btree ("subsidiary_id","itemid");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_locations_sub_internal_idx" ON "catalog_locations" USING btree ("subsidiary_id","internal_id");--> statement-breakpoint
CREATE INDEX "catalog_locations_sub_name_idx" ON "catalog_locations" USING btree ("subsidiary_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_vendors_sub_internal_idx" ON "catalog_vendors" USING btree ("subsidiary_id","internal_id");--> statement-breakpoint
CREATE INDEX "catalog_vendors_sub_name_idx" ON "catalog_vendors" USING btree ("subsidiary_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "item_mappings_unique_idx" ON "item_mappings" USING btree ("subsidiary_id","vendor_norm","vendor_item_norm");--> statement-breakpoint
CREATE INDEX "item_mappings_vendor_idx" ON "item_mappings" USING btree ("subsidiary_id","vendor_norm");--> statement-breakpoint
CREATE INDEX "item_mappings_automap_idx" ON "item_mappings" USING btree ("subsidiary_id","auto_map");--> statement-breakpoint
CREATE INDEX "subsidiaries_org_idx" ON "subsidiaries" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subsidiaries_org_ns_idx" ON "subsidiaries" USING btree ("organization_id","ns_subsidiary_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_doc_configs_unique_idx" ON "subsidiary_document_configs" USING btree ("subsidiary_id","document_type");--> statement-breakpoint
CREATE INDEX "sub_doc_configs_subsidiary_idx" ON "subsidiary_document_configs" USING btree ("subsidiary_id");--> statement-breakpoint
CREATE INDEX "exceptions_org_status_idx" ON "exception_queue" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "exceptions_assigned_idx" ON "exception_queue" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "history_docs_org_idx" ON "history_documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "history_docs_sub_idx" ON "history_documents" USING btree ("subsidiary_id");--> statement-breakpoint
CREATE INDEX "history_docs_vendor_idx" ON "history_documents" USING btree ("organization_id","vendor");--> statement-breakpoint
CREATE INDEX "history_docs_status_idx" ON "history_documents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "history_docs_num_doc_idx" ON "history_documents" USING btree ("organization_id","num_doc");--> statement-breakpoint
CREATE INDEX "wf_logs_org_date_idx" ON "workflow_runtime_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "wf_logs_request_idx" ON "workflow_runtime_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "wf_logs_status_idx" ON "workflow_runtime_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_admin_idx" ON "admin_audit_log" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "admin_audit_log" USING btree ("target_org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "admin_audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "impersonation_admin_idx" ON "impersonation_sessions" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "impersonation_org_idx" ON "impersonation_sessions" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notif_prefs_user_idx" ON "notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_prefs_org_idx" ON "notification_preferences" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_org_idx" ON "onboarding_progress" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "onboarding_health_idx" ON "onboarding_progress" USING btree ("health_score");--> statement-breakpoint
CREATE INDEX "webhooks_organization_id_idx" ON "webhooks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "t_audit_log_org_idx" ON "tenant_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "t_audit_log_org_created_idx" ON "tenant_audit_log" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_classes_org_ns_idx" ON "catalog_classes" USING btree ("organization_id","netsuite_id");--> statement-breakpoint
CREATE INDEX "catalog_classes_org_idx" ON "catalog_classes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_departments_org_ns_idx" ON "catalog_departments" USING btree ("organization_id","netsuite_id");--> statement-breakpoint
CREATE INDEX "catalog_departments_org_idx" ON "catalog_departments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expense_approval_chains_org_idx" ON "expense_approval_chains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_org_ns_idx" ON "expense_categories" USING btree ("organization_id","netsuite_category_id");--> statement-breakpoint
CREATE INDEX "expense_categories_org_idx" ON "expense_categories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expense_documents_item_idx" ON "expense_documents" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "expense_items_report_idx" ON "expense_items" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "expense_items_vendor_nit_idx" ON "expense_items" USING btree ("vendor_nit");--> statement-breakpoint
CREATE INDEX "expense_items_invoice_idx" ON "expense_items" USING btree ("report_id","invoice_number");--> statement-breakpoint
CREATE INDEX "expense_reports_org_idx" ON "expense_reports" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "expense_reports_submitter_idx" ON "expense_reports" USING btree ("submitter_id");--> statement-breakpoint
CREATE INDEX "expense_reports_status_idx" ON "expense_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "expense_tax_rules_org_country_idx" ON "expense_tax_rules" USING btree ("organization_id","country_code");--> statement-breakpoint
CREATE INDEX "expense_tax_rules_country_idx" ON "expense_tax_rules" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");