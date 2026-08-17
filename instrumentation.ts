// Next.js instrumentation hook — runs once when the server process starts.
// Boots the pg-boss worker that processes the document pipeline off the HTTP
// request thread. Guarded to the Node.js runtime (pg-boss can't run on Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // First-boot: seed the products/features catalog so the feature guard has a
  // catalog to resolve against (otherwise isFeatureEnabled throws on a fresh DB).
  try {
    const { seedCatalog } = await import("@/lib/bootstrap/seed-catalog");
    await seedCatalog();
  } catch (err) {
    console.error("[instrumentation] seed catalog failed:", err);
  }

  // First-boot: create the platform super-admin from env if it doesn't exist.
  try {
    const { seedPlatformAdmin } = await import("@/lib/bootstrap/seed-admin");
    await seedPlatformAdmin();
  } catch (err) {
    console.error("[instrumentation] seed admin failed:", err);
  }

  try {
    const { getBoss, startPipelineWorker } = await import("@/lib/queue");
    await startPipelineWorker();

    const { startInternalScheduler } = await import("@/lib/scheduler");
    await startInternalScheduler(await getBoss());
  } catch (err) {
    // Don't crash the server if background work can't boot; uploads fall back
    // to inline processing and scheduled maintenance resumes on the next boot.
    console.error("[instrumentation] failed to start background workers:", err);
  }
}
