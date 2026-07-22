"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

/** Abre el modal de contacto desde cualquier parte. */
export function openContact() {
  window.dispatchEvent(new Event("docuia:contact"));
}

/** Motion base de una página (Lenis, nav sólido, botones magnéticos,
 *  reveals, scroll suave). Para páginas sin animaciones de hero propias. */
export function SiteMotion() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const cleanups: Array<() => void> = [];

    let lenis: Lenis | null = null;
    if (!reduced) {
      lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (t: number) => lenis!.raf(t * 1000);
      gsap.ticker.add(raf); gsap.ticker.lagSmoothing(0);
      cleanups.push(() => gsap.ticker.remove(raf));
    }

    const nav = document.getElementById("nav");
    const onScroll = () => { if (nav) nav.classList.toggle("solid", window.scrollY > 70); };
    onScroll(); addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => removeEventListener("scroll", onScroll));

    document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
      if (a.hasAttribute("data-contact")) return;
      const onClick = (e: MouseEvent) => {
        const id = a.getAttribute("href")!;
        if (id.length > 1 && document.querySelector(id)) { e.preventDefault(); if (lenis) lenis.scrollTo(id, { duration: 1.3 }); else document.querySelector(id)!.scrollIntoView(); }
      };
      a.addEventListener("click", onClick);
      cleanups.push(() => a.removeEventListener("click", onClick));
    });

    const ctx = gsap.context(() => {
      if (!reduced && fine) {
        document.querySelectorAll<HTMLElement>(".btn-main:not(.send)").forEach((b) => {
          b.classList.add("mag");
          const qx = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3.out" });
          const qy = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
          const mv = (e: MouseEvent) => { const r = b.getBoundingClientRect(); qx((e.clientX - r.left - r.width / 2) * 0.35); qy((e.clientY - r.top - r.height / 2) * 0.45); };
          const lv = () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1,0.35)" });
          b.addEventListener("mousemove", mv); b.addEventListener("mouseleave", lv);
          cleanups.push(() => { b.removeEventListener("mousemove", mv); b.removeEventListener("mouseleave", lv); });
        });
      }
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.to(el, { opacity: 1, y: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%" } });
      });
    });

    return () => { cleanups.forEach((fn) => fn()); ctx.revert(); lenis?.destroy(); };
  }, []);
  return null;
}

function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  );
}

const PRODUCTS = [
  { href: "/productos/facturas", title: "AP Automation", desc: "Facturas, OC y CFDI directo a tu ERP.", d: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6"] },
  { href: "/productos/gastos", title: "Expense Management", desc: "Tickets capturados, aprobados y registrados.", d: ["M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z", "M8 7h8", "M8 11h8"] },
  { href: "/productos/contratos", title: "Contract Intelligence", desc: "Flujos documentales validados con IA.", d: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M9 13h6", "M9 17h6"] },
];

export function SiteNav({ home = false }: { home?: boolean }) {
  const p = (hash: string) => (home ? hash : `/${hash}`);
  return (
    <header className="nav" id="nav">
      <Link className="logo" href="/" aria-label="DocuIA, inicio">
        <Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} priority />
      </Link>
      <nav className="nav-links">
        <a href={p("#como")}>Cómo funciona</a>
        <div className="nav-dd">
          <a href={p("#productos")}>Productos
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </a>
          <div className="nav-dd-panel">
            {PRODUCTS.map((prod) => (
              <Link key={prod.title} className="nav-dd-item" href={prod.href}>
                <span className="di">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    {prod.d.map((dd, i) => <path key={i} d={dd} />)}
                  </svg>
                </span>
                <span><h5>{prod.title}</h5><p>{prod.desc}</p></span>
              </Link>
            ))}
          </div>
        </div>
        <a href={p("#seguridad")}>Seguridad</a>
        <a href="/planes">Planes</a>
        <a href="#" data-contact>Contáctanos</a>
      </nav>
      <div className="nav-right">
        <a className="nav-login" href="/login">Acceder</a>
        <button className="nav-cta" type="button" data-contact>Solicitar demo</button>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap ftop2">
        <div>
          <span className="logo" style={{ "--lh": "46px" } as React.CSSProperties}>
            <Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} />
          </span>
          <p className="desc">Procesamiento inteligente de documentos para equipos de finanzas y legal.</p>
        </div>
        <div>
          <h4>Productos</h4>
          <div className="fcol">
            <Link href="/productos/facturas">AP Automation</Link>
            <Link href="/productos/gastos">Expense Management</Link>
            <Link href="/productos/contratos">Contract Intelligence</Link>
          </div>
        </div>
        <div>
          <h4>Plataforma</h4>
          <div className="fcol">
            <a href="/#como">Cómo funciona</a>
            <a href="/#seguridad">Seguridad</a>
            <a href="#" data-contact>Contáctanos</a>
            <a href="/login">Iniciar sesión</a>
          </div>
        </div>
        <div>
          <h4>Legal</h4>
          <div className="fcol">
            <Link href="/legal/privacidad">Aviso de privacidad</Link>
            <Link href="/legal/terminos">Términos y condiciones</Link>
          </div>
        </div>
      </div>
      <div className="fbot"><span>© {new Date().getFullYear()} DocuIA · Todos los derechos reservados</span></div>
    </footer>
  );
}

export function ContactModal({ interest }: { interest?: string }) {
  useEffect(() => {
    const $ = (id: string) => document.getElementById(id)!;
    const modal = $("cmodal");
    const veil = modal.querySelector(".veil")!;
    const box = modal.querySelector(".box")!;
    const form = $("cform") as HTMLFormElement;
    const ok = $("cok");

    const open = () => {
      modal.classList.add("open");
      (form as HTMLElement).style.display = "";
      ok.style.display = "none";
      const hint = form.querySelector<HTMLElement>(".hint");
      if (hint) hint.style.color = "";
      gsap.to(veil, { opacity: 1, duration: 0.35 });
      gsap.fromTo(box, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" });
      setTimeout(() => $("cf-name").focus(), 80);
    };
    const close = () => {
      gsap.to(veil, { opacity: 0, duration: 0.3 });
      gsap.to(box, { opacity: 0, y: 18, scale: 0.97, duration: 0.3, ease: "power2.in", onComplete: () => { modal.classList.remove("open"); form.reset(); } });
    };

    const onContact = () => open();
    window.addEventListener("docuia:contact", onContact);
    const onDocClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.("[data-contact]");
      if (t) { e.preventDefault(); open(); }
    };
    document.addEventListener("click", onDocClick);
    const onVeil = () => close();
    veil.addEventListener("click", onVeil);
    const xBtn = modal.querySelector(".x")!;
    xBtn.addEventListener("click", onVeil);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modal.classList.contains("open")) close(); };
    addEventListener("keydown", onKey);

    const onSubmit = async (e: Event) => {
      e.preventDefault();
      const btn = form.querySelector<HTMLButtonElement>(".send")!;
      const hint = form.querySelector<HTMLElement>(".hint");
      const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
      btn.disabled = true; btn.firstChild!.textContent = "Enviando… ";
      try {
        const phone = val("cf-phone");
        const parts = [phone ? `Teléfono: ${phone}.` : "", interest ? `Interés: ${interest}` : ""].filter(Boolean);
        const res = await fetch("/api/v1/contact", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: val("cf-name"), email: val("cf-email"), company: val("cf-company"), message: parts.join(" ") }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "No pudimos enviar tu solicitud.");
        $("cok-name").textContent = val("cf-name").split(" ")[0];
        (form as HTMLElement).style.display = "none"; ok.style.display = "block";
        gsap.fromTo(ok, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
      } catch (err) {
        if (hint) { hint.textContent = err instanceof Error ? err.message : "Ocurrió un error."; hint.style.color = "#c0392b"; }
      } finally { btn.disabled = false; btn.firstChild!.textContent = "Enviar "; }
    };
    form.addEventListener("submit", onSubmit);

    return () => {
      window.removeEventListener("docuia:contact", onContact);
      document.removeEventListener("click", onDocClick);
      veil.removeEventListener("click", onVeil);
      xBtn.removeEventListener("click", onVeil);
      removeEventListener("keydown", onKey);
      form.removeEventListener("submit", onSubmit);
    };
  }, [interest]);

  return (
    <div className="cmodal" id="cmodal" role="dialog" aria-modal="true" aria-labelledby="cm-title">
      <div className="veil" />
      <div className="box">
        <button className="x" type="button" aria-label="Cerrar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
        <form id="cform">
          <h3 id="cm-title">Hablemos de tu operación</h3>
          <p className="hint">Déjanos tus datos y te buscamos para agendar una demo con tus propios documentos.</p>
          <label htmlFor="cf-name">Nombre</label>
          <input id="cf-name" name="name" required minLength={2} placeholder="Tu nombre" />
          <label htmlFor="cf-company">Empresa</label>
          <input id="cf-company" name="company" required minLength={2} placeholder="Nombre de tu empresa" />
          <label htmlFor="cf-email">Email laboral</label>
          <input id="cf-email" name="email" type="email" required placeholder="nombre@empresa.com" />
          <label htmlFor="cf-phone">Teléfono <span style={{ fontWeight: 400, color: "var(--sand)" }}>(opcional)</span></label>
          <input id="cf-phone" name="phone" type="tel" placeholder="+52 ..." />
          <button className="btn-main send" type="submit">Enviar<span className="arr"><Arrow /></span></button>
        </form>
        <div className="ok" id="cok">
          <div className="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg></div>
          <h4>Listo, <span id="cok-name" /></h4>
          <p>Recibimos tus datos. Te contactaremos en menos de un día hábil para agendar.</p>
        </div>
      </div>
    </div>
  );
}
