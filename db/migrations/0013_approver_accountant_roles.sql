ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'approver' BEFORE 'operator';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'accountant' BEFORE 'operator';