import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin";
import { ensureBucket } from "@/lib/storage/minio";

export async function POST() {
  const { error } = await requireAdminSession();
  if (error) return error;

  const bucket = process.env.MINIO_BUCKET || "docuia";

  try {
    await ensureBucket();
    return NextResponse.json({ ok: true, bucket });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[storage/init]", err);
    return NextResponse.json({ ok: false, bucket, error: message }, { status: 500 });
  }
}
