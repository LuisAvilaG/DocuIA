// Why an organization cannot be used right now, in words for the person at the
// login form. Shown only after the password was verified, so it tells nothing
// to someone who is guessing accounts.

export interface OrgAccessFacts {
  status: string;
  trialEndsAt: Date | null;
  deletedAt?: Date | null;
}

/** The reason, or null when the organization is operating (same rule as operatingOrganization in lib/auth/jwt.ts). */
export function orgBlockMessage(org: OrgAccessFacts | null | undefined, now = new Date()): string | null {
  if (!org || org.deletedAt) return "La cuenta de tu empresa ya no está disponible. Contacta a DocuIA.";
  if (org.status === "trial") {
    return org.trialEndsAt && org.trialEndsAt <= now
      ? "El periodo de prueba de tu empresa terminó. Contacta a DocuIA para continuar."
      : null;
  }
  if (org.status === "active") return null;
  if (org.status === "suspended") return "La cuenta de tu empresa está suspendida. Contacta a DocuIA.";
  return "La cuenta de tu empresa no está activa. Contacta a DocuIA.";
}
