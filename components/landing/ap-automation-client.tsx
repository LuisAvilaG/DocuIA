"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./landing.css";
import { SiteNav, SiteFooter, ContactModal } from "./site-chrome";

function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  );
}
function Check({ s = 11 }: { s?: number }) {
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;
}

export default function ApAutomationClient() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    gsap.registerPlugin(ScrollTrigger);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const $ = (id: string) => document.getElementById(id)!;
    const cleanups: Array<() => void> = [];

    let lenis: Lenis | null = null;
    if (!reduced) {
      lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (t: number) => lenis!.raf(t * 1000);
      gsap.ticker.add(raf); gsap.ticker.lagSmoothing(0);
      cleanups.push(() => gsap.ticker.remove(raf));
    }

    const ctx = gsap.context(() => {
      const nav = $("nav");
      ScrollTrigger.create({ start: "top -70", onEnter: () => nav.classList.add("solid"), onLeaveBack: () => nav.classList.remove("solid") });

      if (!reduced) {
        root.querySelectorAll<HTMLElement>("h1 .w").forEach((w) => {
          const split = (node: Node) => { [...node.childNodes].forEach((n) => {
            if (n.nodeType === 3) { const frag = document.createDocumentFragment(); for (const c of n.textContent ?? "") { const s = document.createElement("span"); s.className = "ch"; s.textContent = c; frag.appendChild(s); } n.parentNode!.replaceChild(frag, n); }
            else if (n.nodeType === 1) split(n); }); };
          split(w);
        });
        gsap.set("h1 .w", { y: 0 });
        gsap.timeline({ defaults: { ease: "power4.out" } })
          .fromTo("h1 .ch", { yPercent: 115, rotate: 7 }, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.02 }, 0.1)
          .to(".pp-sub", { opacity: 1, duration: 0.9 }, 0.5)
          .to(".pp-ctas", { opacity: 1, duration: 0.9 }, 0.65)
          .to("#apcard", { opacity: 1, y: 0, duration: 1.0, ease: "power3.out" }, 0.4);
      } else {
        gsap.set([".pp-sub", ".pp-ctas", "#apcard"], { opacity: 1, y: 0 });
      }

      /* Firma: cotejo de factura contra OC + duplicado atrapado */
      const aplines = gsap.utils.toArray<HTMLElement>(".apline");
      const apmarks = gsap.utils.toArray<HTMLElement>(".apline .mk");
      if (!reduced) {
        gsap.timeline({ repeat: -1, repeatDelay: 2, defaults: { ease: "power2.out" } })
          .set(aplines, { opacity: 0, y: 8 }).set(apmarks, { scale: 0 })
          .set("#apbadge", { opacity: 0 }).set("#dupe", { opacity: 0, y: 10 })
          .to(aplines, { opacity: 1, y: 0, duration: 0.4, stagger: 0.35 }, 0.2)
          .to(apmarks, { scale: 1, duration: 0.35, ease: "back.out(2.4)", stagger: 0.35 }, 0.55)
          .to("#apbadge", { opacity: 1, duration: 0.4, ease: "back.out(2)" }, ">-0.1")
          .to("#dupe", { opacity: 1, y: 0, duration: 0.5 }, ">+0.2")
          .to({}, { duration: 2 })
          .to([".apline", "#apbadge", "#dupe"], { opacity: 0, duration: 0.4 });
      } else {
        gsap.set([aplines, apmarks, "#apbadge", "#dupe"], { opacity: 1, scale: 1, y: 0 });
      }

      if (!reduced && fine) {
        root.querySelectorAll<HTMLElement>(".btn-main:not(.send)").forEach((b) => {
          b.classList.add("mag");
          const qx = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3.out" });
          const qy = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
          const mv = (e: MouseEvent) => { const r = b.getBoundingClientRect(); qx((e.clientX - r.left - r.width / 2) * 0.35); qy((e.clientY - r.top - r.height / 2) * 0.45); };
          const lv = () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1,0.35)" });
          b.addEventListener("mousemove", mv); b.addEventListener("mouseleave", lv);
          cleanups.push(() => { b.removeEventListener("mousemove", mv); b.removeEventListener("mouseleave", lv); });
        });
      }

      const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
      if (steps.length) {
        gsap.to("#howFill", { scaleX: 1, ease: "none",
          scrollTrigger: { trigger: ".how-grid", start: "top 75%", end: "bottom 55%", scrub: 0.5,
            onUpdate: (self) => steps.forEach((s, i) => s.classList.toggle("lit", self.progress > i / steps.length + 0.03)) } });
      }

      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.to(el, { opacity: 1, y: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 87%" } });
      });

    }, root);

    return () => { cleanups.forEach((fn) => fn()); ctx.revert(); lenis?.destroy(); };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      <SiteNav />

      <section className="pp-hero">
        <div className="hero-grid" />
        <div className="hero-inner">
          <div>
            <Link className="back" href="/#productos"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>Productos</Link>
            <span className="eyebrow" style={{ marginTop: 18 }}>AP Automation</span>
            <h1>
              <span className="row"><span className="w">Factura&nbsp;que&nbsp;llega,</span></span>
              <span className="row"><span className="w">asiento&nbsp;que&nbsp;<em>cuadra</em>.</span></span>
            </h1>
            <p className="sub pp-sub">Facturas, órdenes de compra y CFDI se leen completos, encabezado y cada línea. El sistema coteja contra tus reglas, atrapa duplicados antes de que cuesten dinero y aprende los ítems de cada proveedor. Tú solo revisas lo que no cuadra.</p>
            <div className="ctas pp-ctas"><button className="btn-main" type="button" data-contact>Ver una demo<span className="arr"><Arrow /></span></button></div>
          </div>

          <div className="apcard" id="apcard" style={{ opacity: 0, transform: "translateY(30px)" }}>
            <div className="aph"><span>factura_0044.pdf</span><span className="chip">Factura</span></div>
            <div className="apmatch">Cotejando contra <b>OC-2231</b></div>
            <div className="apline"><span className="lbl">Plain Croissant ×11</span><span className="amt">$323.40<span className="mk"><Check /></span></span></div>
            <div className="apline"><span className="lbl">Turmeric Bread ×24</span><span className="amt">$216.00<span className="mk"><Check /></span></span></div>
            <div className="apline"><span className="lbl">Roll Box ×1</span><span className="amt">$7.00<span className="mk"><Check /></span></span></div>
            <div className="aptot"><span>Total</span><span className="amt">$1,610.20<span className="apbadge" id="apbadge">Cuadra ✓</span></span></div>
            <div className="dupe" id="dupe"><span className="dot" /><span>factura_0043.pdf</span><span className="tag">Duplicada · ya en tu ERP</span></div>
          </div>
        </div>
      </section>

      <section className="how" id="como" style={{ borderRadius: 0 }}>
        <div className="wrap">
          <p className="kicker reveal">Cómo funciona</p>
          <h2 className="h2 reveal">De la bandeja de entrada al ERP, sin teclear.</h2>
          <div className="how-grid">
            <div className="how-line"><i id="howFill" /></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">01</p><h3>Entra el documento</h3><p>Factura, OC o CFDI. Por correo, por lote o por API. PDF, XML o escaneo.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">02</p><h3>Se lee completo</h3><p>Proveedor, impuestos y cada línea, con el origen exacto de cada dato.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">03</p><h3>Coteja y limpia</h3><p>Cuadra contra la OC y tus reglas, y atrapa duplicados antes de pagarlos dos veces.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">04</p><h3>Aterriza en tu ERP</h3><p>La transacción llega mapeada y con auditoría completa. Modo prueba antes de tocar nada.</p></div>
          </div>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "20px 0 130px" }}>
        <div className="wrap">
          <p className="kicker reveal">Lo que hace la diferencia</p>
          <h2 className="h2 reveal">Aprende de cada proveedor, para no volver a preguntarte.</h2>
          <p className="reveal" style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7, color: "var(--slate)", maxWidth: "58ch" }}>
            La primera vez confirmas cómo mapea un ítem; a partir de ahí el sistema lo aplica solo. Cada factura llega más limpia que la anterior, y las excepciones bajan con el tiempo.
          </p>
          <div className="cases">
            <div className="case reveal"><h4>Extracción línea por línea</h4><p>Encabezado y detalle, con trazabilidad al documento original.</p></div>
            <div className="case reveal"><h4>Detección de duplicados</h4><p>Atrapa la misma factura antes de que se pague dos veces.</p></div>
            <div className="case reveal"><h4>Mapeos que se aprenden</h4><p>Confirmas una vez el ítem de un proveedor; se aplica siempre.</p></div>
            <div className="case reveal"><h4>Cotejo contra tus reglas</h4><p>Totales, impuestos y políticas verificados antes de entrar.</p></div>
            <div className="case reveal"><h4>Modo de prueba</h4><p>Procesa en dry run y revisa el resultado sin tocar tu ERP.</p></div>
            <div className="case reveal"><h4>Cola de excepciones</h4><p>Solo lo dudoso se detiene y se marca para tu revisión.</p></div>
          </div>
        </div>
      </section>

      <section className="final" id="demo">
        <div className="halo" />
        <div className="inner">
          <div>
            <h2 className="reveal">Deja de teclear facturas. <em>Empieza a revisarlas.</em></h2>
            <p className="reveal">Te mostramos la plataforma procesando facturas como las tuyas, en vivo.</p>
          </div>
          <button className="btn-main on-dark reveal" type="button" data-contact style={{ justifySelf: "start" }}>Solicitar una demo<span className="arr"><Arrow /></span></button>
        </div>
      </section>

      <SiteFooter />
      <ContactModal interest="AP Automation" />
    </div>
  );
}
