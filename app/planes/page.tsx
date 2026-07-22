import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav, SiteFooter, ContactModal, SiteMotion } from "@/components/landing/site-chrome";
import "@/components/landing/landing.css";

export const metadata: Metadata = {
  title: "Planes — Pagas por producto y por volumen | DocuIA",
  description:
    "DocuIA se contrata à la carte: activas AP Automation, Expense Management o Contract Intelligence por separado, y el precio escala con tu volumen mensual de documentos.",
  openGraph: {
    title: "Planes — DocuIA",
    description: "À la carte, por producto y por volumen. Activa uno, dos o los tres.",
    locale: "es_MX",
    type: "website",
  },
};

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
  );
}
function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  );
}

const PLANS = [
  {
    name: "Arranque", badge: null, price: "$149", per: "USD / mes por producto",
    vol: "Hasta 250 documentos al mes",
    feats: ["Extracción con IA y validación fiscal (CFDI/SAT · SII)", "1 entidad, hasta 5 usuarios", "Exportación e integración por API básica", "Cola de excepciones", "Soporte por correo"],
    cta: "Empezar", ctaClass: "ghost", feat: false,
  },
  {
    name: "Crecimiento", badge: "Más popular", price: "$499", per: "USD / mes por producto",
    vol: "Hasta 1,000 documentos al mes",
    feats: ["Todo lo de Arranque, más:", "Integración nativa con tu ERP (NetSuite y más)", "Cotejo contra OC y reglas de negocio", "Usuarios ilimitados · hasta 3 entidades", "Aprobaciones multinivel y tableros", "Soporte prioritario"],
    cta: "Solicitar demo", ctaClass: "solid", feat: true,
  },
  {
    name: "Escala", badge: null, price: "$1,199", per: "USD / mes por producto",
    vol: "Hasta 5,000 documentos al mes",
    feats: ["Todo lo de Crecimiento, más:", "Entidades ilimitadas · multi-moneda · multi-país", "SSO y roles avanzados", "Ambiente de pruebas y automatizaciones", "Analítica avanzada", "Customer Success dedicado"],
    cta: "Solicitar demo", ctaClass: "ghost", feat: false,
  },
  {
    name: "Enterprise", badge: null, price: "A la medida", per: "Más de 5,000 documentos al mes",
    vol: "Volumen ilimitado",
    feats: ["Todo lo de Escala, más:", "Despliegue dedicado y residencia de datos", "Integraciones a la medida", "SLA y auditoría avanzada", "Onboarding acompañado"],
    cta: "Contactar ventas", ctaClass: "ghost", feat: false,
  },
];

export default function PlanesPage() {
  return (
    <div className="lp">
      <SiteMotion />
      <SiteNav />

      <section className="pp-hero tight">
        <div className="hero-grid" />
        <div className="hero-inner">
          <div>
            <span className="eyebrow">Planes</span>
            <h1 style={{ maxWidth: "18ch" }}>Pagas por producto y por volumen.</h1>
            <p className="sub" style={{ opacity: 1 }}>
              DocuIA se contrata à la carte: activas AP Automation, Expense Management o
              Contract Intelligence por separado, y el precio escala con los documentos que
              procesas al mes. Empiezas con uno y sumas los demás cuando tu operación lo pida.
            </p>
          </div>
        </div>
      </section>

      <section className="plans" id="precios">
        <div className="wrap">
          <div className="plangrid">
            {PLANS.map((pl) => (
              <div key={pl.name} className={`plan${pl.feat ? " feat" : ""} reveal`}>
                {pl.badge && <span className="badge2">{pl.badge}</span>}
                <h3>{pl.name}</h3>
                <div className="price">
                  {pl.price}
                  {pl.price.startsWith("$") && <small> /mes</small>}
                </div>
                <p className="per">{pl.per}</p>
                <p className="vol">{pl.vol}</p>
                <ul>
                  {pl.feats.map((f) => (
                    <li key={f}><Check />{f}</li>
                  ))}
                </ul>
                <a className={`pcta ${pl.ctaClass}`} href="#" data-contact>{pl.cta}</a>
              </div>
            ))}
          </div>
          <p className="bundle reveal">
            ¿Activas más de uno? <b>2 productos: −15%</b> · <b>3 productos: −25%</b> sobre el total.
          </p>
          <p className="plannote reveal">
            Precios por producto, en USD, con facturación anual. El volumen adicional se cobra por documento
            según tu plan. En la demo armamos la combinación y el volumen que le queda a tu operación.
          </p>
        </div>
      </section>

      <section className="final" id="demo">
        <div className="halo" />
        <div className="inner">
          <div>
            <h2 className="reveal">¿No sabes qué plan te queda? <em>Lo vemos juntos.</em></h2>
            <p className="reveal">Nos cuentas tu volumen y qué documentos procesas, y te armamos la propuesta exacta.</p>
          </div>
          <button className="btn-main on-dark reveal" type="button" data-contact style={{ justifySelf: "start" }}>
            Hablar con ventas<span className="arr"><Arrow /></span>
          </button>
        </div>
      </section>

      <SiteFooter />
      <ContactModal interest="Planes" />
    </div>
  );
}
