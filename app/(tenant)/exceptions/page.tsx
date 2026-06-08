import { redirect } from "next/navigation";
import { getTenantSession } from "@/lib/auth/jwt";
import { db } from "@/lib/db";
import { exceptionQueue } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { ExceptionsClient } from "./client";

export default async function ExceptionsPage() {
  const session = await getTenantSession();
  if (!session) redirect("/login");

  let exceptions: {
    id: number; documentType: string | null; originalFilename: string | null;
    failureStage: string; failureReason: string | null; errorCode: string | null;
    status: string; retryCount: number; createdAt: string;
  }[] = [];

  try {
    const rows = await db.query.exceptionQueue.findMany({
      where: eq(exceptionQueue.organizationId, session.orgId),
      orderBy: [desc(exceptionQueue.createdAt)],
      limit: 100,
    });
    exceptions = rows.map(r => ({
      id:               r.id,
      documentType:     r.documentType,
      originalFilename: r.originalFilename,
      failureStage:     r.failureStage,
      failureReason:    r.failureReason,
      errorCode:        r.errorCode,
      status:           r.status,
      retryCount:       r.retryCount,
      createdAt:        r.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error("[exceptions]", err);
  }

  return <ExceptionsClient exceptions={exceptions} />;
}
