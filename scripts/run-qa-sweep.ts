// Ejecuta a mano el apagado diario del modo QA (lo mismo que el cron «qa-mode»).
// Uso: npx tsx scripts/run-qa-sweep.ts
import "./_load-env";
import { sweepQaMode } from "@/lib/features/qa-mode-sweep";

sweepQaMode()
  .then((r) => { console.log(`Revisados ${r.checked}, apagados ${r.disabled}`); process.exit(0); })
  .catch((err) => { console.error(err); process.exit(1); });
