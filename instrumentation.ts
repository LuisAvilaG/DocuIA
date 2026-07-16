// Next.js instrumentation hook — runs once when the server process starts.
// Boots the pg-boss worker that processes the document pipeline off the HTTP
// request thread. Guarded to the Node.js runtime (pg-boss can't run on Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startPipelineWorker } = await import("@/lib/queue");
    await startPipelineWorker();
  } catch (err) {
    // Don't crash the server if the queue can't boot; uploads fall back to
    // inline processing, and the reap-stuck watchdog cleans up any orphans.
    console.error("[instrumentation] failed to start pipeline worker:", err);
  }
}
