import type { Metadata } from "next";
import { readUploadLink, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "@/lib/contracts/upload-links";
import { DeliveryForm } from "./delivery-form";

export const metadata: Metadata = { title: "Entregar documentos · DocuIA", robots: { index: false, follow: false } };

const CLOSED: Record<string, { title: string; text: string }> = {
  not_found: { title: "Este enlace no es válido", text: "Revisa que lo copiaste completo o pide uno nuevo a quien te lo envió." },
  expired: { title: "Este enlace venció", text: "Pide uno nuevo a quien te solicitó los documentos." },
  used: { title: "Ya recibimos tus documentos", text: "Este enlace sirve para una sola entrega. Si te falta algo, pide un enlace nuevo." },
  closed: { title: "Este caso ya no espera documentos", text: "Si crees que es un error, contacta a quien te los pidió." },
};

/** Página pública: el contratista entrega lo que le pidieron, sin crear cuenta. */
export default async function DeliverPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await readUploadLink(token);

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex max-w-xl flex-col gap-6">
        <p className="text-[13px] font-semibold text-muted-foreground">{link.ok ? link.orgName : "DocuIA"}</p>
        {!link.ok ? (
          <section className="rounded-xl border border-border bg-card p-6">
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{CLOSED[link.reason].title}</h1>
            <p className="mt-2 text-[14px] text-muted-foreground">{CLOSED[link.reason].text}</p>
          </section>
        ) : (
          <>
            <header>
              <h1 className="text-2xl font-semibold leading-tight tracking-[-0.025em]">Entregar documentos</h1>
              <p className="mt-1.5 text-[14px] text-muted-foreground">{link.caseTitle}</p>
            </header>
            <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
              {link.reason && <p className="text-[14px]"><b className="font-semibold">Motivo:</b> {link.reason}</p>}
              {link.documents.length > 0 && (
                <div>
                  <p className="text-[14px] font-semibold">Lo que necesitamos</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14px]">{link.documents.map((d) => <li key={d}>{d}</li>)}</ul>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                El enlace vence el {link.expiresAt.toLocaleDateString("es-MX", { day: "numeric", month: "long" })} y sirve para una sola entrega.
              </p>
            </section>
            <DeliveryForm token={token} maxFiles={MAX_FILES} maxMb={MAX_FILE_BYTES / 1024 / 1024} maxTotalMb={MAX_TOTAL_BYTES / 1024 / 1024} />
          </>
        )}
        <p className="text-center text-xs text-muted-foreground">Enviado con DocuIA</p>
      </div>
    </main>
  );
}
