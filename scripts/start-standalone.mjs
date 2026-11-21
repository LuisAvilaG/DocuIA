// Runs the production build the way the container does. The build is
// "standalone" (next.config.ts), which `next start` does not serve as such:
// this copies public/ and the static assets next to the standalone server, as
// the Dockerfile does, and starts it.
//   npm run build && npm run start:standalone
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const server = ".next/standalone/server.js";
if (!existsSync(server)) {
  console.error("No hay build de producción: ejecuta `npm run build` primero.");
  process.exit(1);
}
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });

// The standalone server reads only the environment: load the local files first.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}
const child = spawn(process.execPath, [server], { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
