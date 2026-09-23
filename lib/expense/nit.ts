// Exact NIT match, with or without the check digit ("900123456-7",
// "9001234567", "900123456"). A substring match picked the wrong vendor.
export function nitCandidates(vendorNit: string): string[] {
  const clean = vendorNit.toUpperCase().replace(/[^0-9A-Z-]/g, "");
  const [base, checkDigit] = clean.split("-");
  const joined = clean.replace(/-/g, "");
  return [...new Set([clean, joined, base, checkDigit ? `${base}-${checkDigit}` : ""].filter(Boolean))];
}
