import { cn } from "@/lib/utils";

// Small line illustrations, one per product, drawn in the panel palette
// (navy strokes, teal accents, paper fills). Decorative: always aria-hidden.

const NAVY  = "oklch(0.22 0.10 240)";
const TEAL  = "oklch(0.48 0.15 182)";
const MINT  = "oklch(0.65 0.14 182)";
const PAPER = "oklch(0.995 0.002 90)";
const SAND  = "oklch(0.94 0.008 80)";
const INK   = "oklch(0.80 0.01 240)";

/** AP Automation: an invoice read by the model and pushed into the ERP. */
function InvoiceArt() {
  return (
    <>
      {/* invoice sheet */}
      <rect x="18" y="12" width="76" height="96" rx="6" fill={PAPER} stroke={NAVY} strokeWidth="1.6" />
      <rect x="28" y="22" width="26" height="6" rx="3" fill={NAVY} />
      <rect x="28" y="34" width="44" height="3" rx="1.5" fill={INK} />
      <rect x="28" y="42" width="38" height="3" rx="1.5" fill={INK} />
      <line x1="28" y1="54" x2="84" y2="54" stroke={INK} strokeWidth="1.2" />
      <rect x="28" y="60" width="30" height="3" rx="1.5" fill={INK} />
      <rect x="70" y="60" width="14" height="3" rx="1.5" fill={INK} />
      <rect x="28" y="68" width="36" height="3" rx="1.5" fill={INK} />
      <rect x="70" y="68" width="14" height="3" rx="1.5" fill={INK} />
      <rect x="28" y="76" width="24" height="3" rx="1.5" fill={INK} />
      <rect x="70" y="76" width="14" height="3" rx="1.5" fill={INK} />
      <rect x="56" y="88" width="30" height="10" rx="3" fill={TEAL} />
      <rect x="62" y="92" width="18" height="2.5" rx="1.25" fill={PAPER} />
      {/* sparkle: the model reading it */}
      <path d="M100 30 l2.4 6.6 6.6 2.4 -6.6 2.4 -2.4 6.6 -2.4 -6.6 -6.6 -2.4 6.6 -2.4z" fill={MINT} />
      {/* flow into the ERP */}
      <path d="M96 66 h22" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeDasharray="3 3" />
      <path d="M114 61 l6 5 -6 5" fill="none" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* ERP: database cylinder */}
      <ellipse cx="136" cy="52" rx="12" ry="4.5" fill={SAND} stroke={NAVY} strokeWidth="1.6" />
      <path d="M124 52 v28 a12 4.5 0 0 0 24 0 v-28" fill={SAND} stroke={NAVY} strokeWidth="1.6" />
      <path d="M124 62 a12 4.5 0 0 0 24 0 M124 71 a12 4.5 0 0 0 24 0" fill="none" stroke={NAVY} strokeWidth="1.2" />
    </>
  );
}

/** Expense Management: a receipt and the card that paid it, approved. */
function ReceiptArt() {
  return (
    <>
      {/* receipt with torn bottom edge */}
      <path d="M30 12 h64 v88 l-6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 -6 -5 -6 5 z" fill={PAPER} stroke={NAVY} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="40" y="22" width="22" height="5" rx="2.5" fill={NAVY} />
      <rect x="40" y="34" width="30" height="3" rx="1.5" fill={INK} />
      <rect x="76" y="34" width="10" height="3" rx="1.5" fill={INK} />
      <rect x="40" y="42" width="24" height="3" rx="1.5" fill={INK} />
      <rect x="76" y="42" width="10" height="3" rx="1.5" fill={INK} />
      <rect x="40" y="50" width="28" height="3" rx="1.5" fill={INK} />
      <rect x="76" y="50" width="10" height="3" rx="1.5" fill={INK} />
      <line x1="40" y1="60" x2="86" y2="60" stroke={INK} strokeWidth="1.2" strokeDasharray="2 2" />
      <rect x="40" y="66" width="18" height="4" rx="2" fill={NAVY} />
      <rect x="70" y="66" width="16" height="4" rx="2" fill={NAVY} />
      {/* approval stamp */}
      <circle cx="104" cy="40" r="15" fill={PAPER} stroke={TEAL} strokeWidth="2" />
      <path d="M97 40.5 l4.5 4.5 9 -9.5" fill="none" stroke={TEAL} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* card */}
      <rect x="96" y="70" width="52" height="32" rx="5" fill={NAVY} />
      <rect x="96" y="77" width="52" height="6" fill={MINT} />
      <rect x="103" y="90" width="18" height="4" rx="2" fill={INK} opacity="0.8" />
      <circle cx="138" cy="92" r="4" fill={MINT} opacity="0.9" />
    </>
  );
}

/** Contract Intelligence: a signed contract under a lens, with the seal. */
function ContractArt() {
  return (
    <>
      {/* back sheet */}
      <rect x="30" y="18" width="72" height="92" rx="6" fill={SAND} stroke={NAVY} strokeWidth="1.2" />
      {/* front sheet */}
      <rect x="22" y="10" width="72" height="92" rx="6" fill={PAPER} stroke={NAVY} strokeWidth="1.6" />
      <rect x="32" y="20" width="30" height="5" rx="2.5" fill={NAVY} />
      <rect x="32" y="31" width="52" height="2.5" rx="1.25" fill={INK} />
      <rect x="32" y="37" width="48" height="2.5" rx="1.25" fill={INK} />
      <rect x="32" y="43" width="52" height="2.5" rx="1.25" fill={INK} />
      <rect x="32" y="49" width="40" height="2.5" rx="1.25" fill={INK} />
      <rect x="32" y="58" width="52" height="2.5" rx="1.25" fill={INK} />
      <rect x="32" y="64" width="44" height="2.5" rx="1.25" fill={INK} />
      {/* highlighted clause */}
      <rect x="30" y="72" width="36" height="7" rx="2" fill={MINT} opacity="0.35" />
      <rect x="32" y="74" width="30" height="2.5" rx="1.25" fill={NAVY} />
      {/* signature */}
      <path d="M34 92 c4 -8 8 -6 10 -2 s6 4 10 -4 s6 2 12 2" fill="none" stroke={NAVY} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="32" y1="96" x2="70" y2="96" stroke={INK} strokeWidth="1.2" />
      {/* seal */}
      <circle cx="82" cy="88" r="8" fill={TEAL} />
      <circle cx="82" cy="88" r="4.5" fill="none" stroke={PAPER} strokeWidth="1.2" />
      {/* lens */}
      <circle cx="120" cy="52" r="20" fill="oklch(0.65 0.14 182 / 0.10)" stroke={NAVY} strokeWidth="1.8" />
      <circle cx="120" cy="52" r="14" fill="none" stroke={TEAL} strokeWidth="1" opacity="0.6" />
      <path d="M134.5 66.5 l12 12" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
      <rect x="110" y="46" width="20" height="2.5" rx="1.25" fill={NAVY} />
      <rect x="110" y="52" width="14" height="2.5" rx="1.25" fill={TEAL} />
      <rect x="110" y="58" width="18" height="2.5" rx="1.25" fill={NAVY} />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = {
  ap_automation: InvoiceArt,
  expense_management: ReceiptArt,
  contract_intelligence: ContractArt,
};

export function ProductArt({ product, className }: { product: string; className?: string }) {
  const Art = ART[product];
  if (!Art) return null;
  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" focusable="false" className={cn("block w-full h-auto", className)}>
      <Art />
    </svg>
  );
}
