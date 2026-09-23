import Image from "next/image";
import { Lock, PackageX } from "lucide-react";
import { LogoutButton } from "./logout-button";

// Terminal screen for signed-in people who cannot use the portal right now.
// Layouts redirect here instead of to each other, which used to loop forever
// (e.g. an expense submitter whose organization lost the Expenses product).
const REASONS = {
  ip: {
    icon: Lock,
    title: "Acceso restringido",
    body: "Tu dirección IP no tiene permiso para acceder a este portal. Contacta al administrador de tu organización.",
  },
  product: {
    icon: PackageX,
    title: "Módulo no disponible",
    body: "Tu organización no tiene activo el módulo que usas en DocuIA. Contacta al administrador de tu organización.",
  },
} as const;

export default async function UnavailablePage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const content = REASONS[reason === "ip" ? "ip" : "product"];
  const Icon = content.icon;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <Image src="/logo-full.png" alt="DocuIA" width={200} height={56} className="object-contain mx-auto mb-8" />
        <div className="bg-card border border-border rounded-xl px-6 py-8">
          <Icon className="w-8 h-8 mx-auto mb-3 text-muted-foreground" aria-hidden />
          <h1 className="text-base font-semibold text-foreground">{content.title}</h1>
          <p className="text-sm text-muted-foreground mt-2">{content.body}</p>
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}
