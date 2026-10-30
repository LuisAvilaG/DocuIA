import { AuditFeed } from "@/components/admin/audit-feed";

export default async function ClientActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <section className="-mb-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.02em]">Lo que el equipo de plataforma hizo en este cliente.</h2>
        <p className="text-[15px] text-muted-foreground mt-1.5">Últimos 90 días. Lo que hacen los usuarios del cliente queda en su propio log de auditoría.</p>
      </section>
      <AuditFeed filters={{ orgId: id, period: "90d" }} showOrg={false} />
    </>
  );
}
