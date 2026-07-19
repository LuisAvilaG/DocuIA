"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./landing.css";

function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
function Chevron() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function FileIcon({ lines = false }: { lines?: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d={lines ? "M14 2v6h6M9 13h6M9 17h6" : "M14 2v6h6"} />
    </svg>
  );
}

const PRODUCTS = [
  { href: "/#productos", title: "AP Automation", desc: "Facturas, OC y CFDI directo a tu ERP.", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" },
  { href: "/#productos", title: "Expense Management", desc: "Tickets capturados, aprobados y registrados.", d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z M8 7h8 M8 11h8" },
  { href: "/productos/contratos", title: "Contract Intelligence", desc: "Flujos documentales validados con IA.", d: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6" },
];

export default function ContractIntelligenceClient() {
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
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      cleanups.push(() => gsap.ticker.remove(raf));
    }

    const ctx = gsap.context(() => {
      const nav = $("nav");
      ScrollTrigger.create({ start: "top -70", onEnter: () => nav.classList.add("solid"), onLeaveBack: () => nav.classList.remove("solid") });

      /* Título por caracteres + entrada */
      if (!reduced) {
        root.querySelectorAll<HTMLElement>("h1 .w").forEach((w) => {
          const split = (node: Node) => {
            [...node.childNodes].forEach((n) => {
              if (n.nodeType === 3) {
                const frag = document.createDocumentFragment();
                for (const c of n.textContent ?? "") { const s = document.createElement("span"); s.className = "ch"; s.textContent = c; frag.appendChild(s); }
                n.parentNode!.replaceChild(frag, n);
              } else if (n.nodeType === 1) split(n);
            });
          };
          split(w);
        });
        gsap.set("h1 .w", { y: 0 });
        gsap.timeline({ defaults: { ease: "power4.out" } })
          .fromTo("h1 .ch", { yPercent: 115, rotate: 7 }, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.02 }, 0.1)
          .to(".pp-sub", { opacity: 1, duration: 0.9 }, 0.5)
          .to(".pp-ctas", { opacity: 1, duration: 0.9 }, 0.65)
          .to("#trace", { opacity: 1, y: 0, duration: 1.0, ease: "power3.out" }, 0.4);
      } else {
        gsap.set([".pp-sub", ".pp-ctas", "#trace"], { opacity: 1, y: 0 });
      }

      /* Trazabilidad del hero: la cita aparece una vez y se queda;
         el campo pulsa sutil su vínculo con la cita, sin dejar huecos. */
      if (!reduced) {
        gsap.timeline({ delay: 0.9 })
          .set("#fld", { className: "fld hot" })
          .to("#cite", { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" });
        gsap.to("#fld", { duration: 1.4, repeat: -1, yoyo: true, repeatDelay: 1.6, ease: "sine.inOut",
          onRepeat: () => {} , keyframes: [{ boxShadow: "0 0 0 0 rgba(18,144,127,0)" }, { boxShadow: "0 0 0 4px rgba(18,144,127,.14)" }, { boxShadow: "0 0 0 0 rgba(18,144,127,0)" }] });
      } else {
        gsap.set("#cite", { opacity: 1, y: 0 });
        gsap.set("#fld", { className: "fld hot" });
      }

      /* Botones magnéticos */
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

      /* Constructor de flujo: se dibuja al entrar en pantalla */
      const flowTl = gsap.timeline({ scrollTrigger: { trigger: ".ppflow", start: "top 72%" }, defaults: { ease: "power2.out" } });
      flowTl.fromTo(".ftop", { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.4 })
        .fromTo(".fnode.ca", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, stagger: 0.14 }, 0.1)
        .fromTo(".e-ab", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, stagger: 0.1 }, 0.7)
        .fromTo(".fnode.cb", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, stagger: 0.14 }, 1.0)
        .fromTo(".e-bc", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, stagger: 0.1 }, 1.6)
        .fromTo(".fnode.cc", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45 }, 2.0)
        .fromTo(".vchip", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, 2.6)
        .fromTo(".e-cd", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4 }, 2.9)
        .fromTo(".fnode.cd", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45 }, 3.1)
        .fromTo(".gchip", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, 3.6);

      /* Cómo funciona: línea + pasos */
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
      if (steps.length) {
        gsap.to("#howFill", { scaleX: 1, ease: "none",
          scrollTrigger: { trigger: ".how-grid", start: "top 75%", end: "bottom 55%", scrub: 0.5,
            onUpdate: (self) => steps.forEach((s, i) => s.classList.toggle("lit", self.progress > i / steps.length + 0.03)) } });
      }

      /* Reveals */
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.to(el, { opacity: 1, y: 0, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 87%" } });
      });

      /* Modal de contacto */
      const modal = $("cmodal");
      const veil = modal.querySelector(".veil")!;
      const box = modal.querySelector(".box")!;
      const form = $("cform") as HTMLFormElement;
      const ok = $("cok");
      const openModal = () => {
        modal.classList.add("open"); (form as HTMLElement).style.display = ""; ok.style.display = "none";
        gsap.to(veil, { opacity: 1, duration: 0.35 });
        gsap.fromTo(box, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" });
        setTimeout(() => $("cf-name").focus(), 80);
      };
      const closeModal = () => {
        gsap.to(veil, { opacity: 0, duration: 0.3 });
        gsap.to(box, { opacity: 0, y: 18, scale: 0.97, duration: 0.3, ease: "power2.in", onComplete: () => { modal.classList.remove("open"); form.reset(); } });
      };
      root.querySelectorAll<HTMLElement>("[data-contact]").forEach((el) => {
        const c = (e: Event) => { e.preventDefault(); openModal(); };
        el.addEventListener("click", c); cleanups.push(() => el.removeEventListener("click", c));
      });
      veil.addEventListener("click", closeModal);
      modal.querySelector(".x")!.addEventListener("click", closeModal);
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); };
      addEventListener("keydown", onKey); cleanups.push(() => removeEventListener("keydown", onKey));
      const onSubmit = async (e: Event) => {
        e.preventDefault();
        const btn = form.querySelector<HTMLButtonElement>(".send")!;
        const hint = form.querySelector<HTMLElement>(".hint");
        const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
        btn.disabled = true; btn.firstChild!.textContent = "Enviando… ";
        try {
          const phone = val("cf-phone");
          const res = await fetch("/api/v1/contact", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: val("cf-name"), email: val("cf-email"), company: val("cf-company"), message: (phone ? `Teléfono: ${phone}. ` : "") + "Interés: Contract Intelligence" }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "No pudimos enviar tu solicitud.");
          $("cok-name").textContent = val("cf-name").split(" ")[0];
          (form as HTMLElement).style.display = "none"; ok.style.display = "block";
          gsap.fromTo(ok, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
        } catch (err) {
          if (hint) { hint.textContent = err instanceof Error ? err.message : "Ocurrió un error."; hint.style.color = "#c0392b"; }
        } finally { btn.disabled = false; btn.firstChild!.textContent = "Enviar "; }
      };
      form.addEventListener("submit", onSubmit); cleanups.push(() => form.removeEventListener("submit", onSubmit));
    }, root);

    return () => { cleanups.forEach((fn) => fn()); ctx.revert(); lenis?.destroy(); };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      <header className="nav" id="nav">
        <Link className="logo" href="/" aria-label="DocuIA, inicio">
          <Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} priority />
        </Link>
        <nav className="nav-links">
          <a href="/#como">Cómo funciona</a>
          <div className="nav-dd">
            <a href="/#productos">Productos <Chevron /></a>
            <div className="nav-dd-panel">
              {PRODUCTS.map((p) => (
                <Link key={p.title} className="nav-dd-item" href={p.href}>
                  <span className="di">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      {p.d.split(" M").map((seg, i) => <path key={i} d={(i ? "M" : "") + seg} />)}
                    </svg>
                  </span>
                  <span><h5>{p.title}</h5><p>{p.desc}</p></span>
                </Link>
              ))}
            </div>
          </div>
          <a href="/#seguridad">Seguridad</a>
          <a href="#" data-contact>Contáctanos</a>
        </nav>
        <div className="nav-right">
          <a className="nav-login" href="/login">Acceder</a>
          <button className="nav-cta" type="button" data-contact>Solicitar demo</button>
        </div>
      </header>

      <section className="pp-hero">
        <div className="hero-grid" />
        <div className="hero-inner">
          <div>
            <Link className="back" href="/#productos">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
              Productos
            </Link>
            <span className="eyebrow" style={{ marginTop: 18 }}>Contract Intelligence</span>
            <h1>
              <span className="row"><span className="w">Tú&nbsp;defines&nbsp;el&nbsp;flujo.</span></span>
              <span className="row"><span className="w">La&nbsp;IA&nbsp;lo&nbsp;<em>ejecuta</em>.</span></span>
            </h1>
            <p className="sub pp-sub">
              Un motor genérico, no una plantilla: tú decides qué documentos entran, qué campos
              se extraen, qué reglas los validan entre sí y qué documento sale. Sin escribir código,
              sin depender de tu ERP.
            </p>
            <div className="ctas pp-ctas">
              <button className="btn-main" type="button" data-contact>Ver una demo<span className="arr"><Arrow /></span></button>
            </div>
          </div>

          <div className="trace" id="trace" style={{ opacity: 0, transform: "translateY(30px)" }}>
            <p className="tt">Caso · Seguro de garantía · 3 documentos</p>
            <div className="fld" id="fld">
              <span>Apoderado</span>
              <b>María Fernanda Soto <span className="tag">Vigente</span></b>
            </div>
            <div className="cite" id="cite" style={{ opacity: 0 }}>
              <p className="cl">Cita · Escritura de poderes, pág. 4</p>
              <p>…confiere poder a <mark>doña María Fernanda Soto</mark> para suscribir contratos de garantía en representación de la sociedad…</p>
            </div>
            <div className="fld" style={{ marginTop: 10 }}>
              <span>Validación cruzada</span>
              <b style={{ color: "var(--lteal-dark)" }}>Firmante vigente · 3/3 ✓</b>
            </div>
          </div>
        </div>
      </section>

      <section className="how" id="como" style={{ borderRadius: 0 }}>
        <div className="wrap">
          <p className="kicker reveal">Cómo funciona</p>
          <h2 className="h2 reveal">Del expediente crudo al documento firmado.</h2>
          <div className="how-grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
            <div className="how-line"><i id="howFill" /></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">01</p><h3>Defines el flujo</h3><p>Tipos de documento, campos, reglas de validación y plantilla de salida. Todo configurable.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">02</p><h3>Clasifica cada doc</h3><p>La IA reconoce qué es cada archivo del caso por su función legal, no por su nombre.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">03</p><h3>Extrae con cita</h3><p>Cada dato trae la cita literal de dónde salió. Un clic y ves el párrafo original.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">04</p><h3>Valida cruzando</h3><p>Comprueba reglas entre documentos: firmantes, vigencias, montos, cláusulas.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">05</p><h3>Genera el PDF</h3><p>Renderiza el documento final desde tu plantilla, con tu membrete, listo para firmar.</p></div>
          </div>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "20px 0 120px" }}>
        <div className="wrap">
          <p className="kicker reveal">El motor</p>
          <h2 className="h2 reveal">Un lienzo, no un formulario rígido.</h2>
          <p className="reveal" style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7, color: "var(--slate)", maxWidth: "58ch" }}>
            Cada flujo es un grafo de nodos que tú armas: entradas, extracción, validación y generación. Lo que en el demo del mercado corre en un navegador con la API expuesta, aquí vive server-side, multi-tenant y con auditoría.
          </p>
          <div className="ppflow reveal">
            <div className="fcanvas">
              <div className="ftop">
                <span className="fname2">Flujo · Seguros de Garantía CL</span>
                <span className="fsave">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
                  Guardar
                </span>
              </div>
              <div className="fstage">
                <svg className="fedges" viewBox="0 0 1000 360" preserveAspectRatio="none">
                  <path className="e-ab" pathLength={1} d="M215 66 C 250 66, 245 66, 280 66" />
                  <path className="e-ab" pathLength={1} d="M215 186 C 250 186, 245 186, 280 186" />
                  <path className="e-ab" pathLength={1} d="M215 306 C 250 306, 245 306, 280 306" />
                  <path className="e-bc" pathLength={1} d="M485 66 C 530 66, 520 186, 565 186" />
                  <path className="e-bc" pathLength={1} d="M485 186 C 525 186, 525 186, 565 186" />
                  <path className="e-bc" pathLength={1} d="M485 306 C 530 306, 520 186, 565 186" />
                  <path className="e-cd" pathLength={1} d="M790 186 C 815 186, 810 186, 835 186" />
                </svg>
                <div className="fnode ca" style={{ left: "1.5%", top: "11%", width: "20%" }}><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#1</span></div><div className="fb">Contrato</div></div>
                <div className="fnode ca" style={{ left: "1.5%", top: "44%", width: "20%" }}><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#2</span></div><div className="fb">Escritura de poderes</div></div>
                <div className="fnode ca" style={{ left: "1.5%", top: "77%", width: "20%" }}><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#3</span></div><div className="fb">Certificado de vigencia</div></div>
                <div className="fnode cb" style={{ left: "28%", top: "11%", width: "20%" }}><span className="hdl l" /><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon lines /></span>Extracción</div><div className="fb">contrato · 4 campos</div></div>
                <div className="fnode cb" style={{ left: "28%", top: "44%", width: "20%" }}><span className="hdl l" /><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon lines /></span>Extracción</div><div className="fb">escritura · 3 campos</div></div>
                <div className="fnode cb" style={{ left: "28%", top: "77%", width: "20%" }}><span className="hdl l" /><span className="hdl r" /><div className="fh"><span className="fic"><FileIcon lines /></span>Extracción</div><div className="fb">certificado · 2 campos</div></div>
                <div className="fnode cc" style={{ left: "56.5%", top: "44%", width: "22.5%" }}><span className="hdl l" /><span className="hdl r" /><div className="fh"><span className="fic"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg></span>Validación</div><div className="fb">Firmante con poderes vigentes<span className="vchip">3/3 ✓</span></div></div>
                <div className="fnode cd" style={{ left: "83.5%", top: "44%", width: "15%" }}><span className="hdl l" /><div className="fh"><span className="fic"><FileIcon lines /></span>Generación</div><div className="fb">Cotización<span className="gchip">PDF</span></div></div>
                <div className="fctrl"><span>+</span><span>−</span><span>⌖</span></div>
                <div className="fmap"><i style={{ left: 8, top: 10 }} /><i style={{ left: 8, top: 24 }} /><i style={{ left: 8, top: 38 }} /><i style={{ left: 30, top: 24 }} /><i style={{ left: 52, top: 24 }} /><i style={{ left: 68, top: 24, width: 12 }} /></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="secure" style={{ background: "var(--paper)" }}>
        <div className="wrap">
          <p className="kicker reveal">Un motor, muchos verticales</p>
          <h2 className="h2 reveal">El mismo flujo, para lo que tu negocio necesite.</h2>
          <p className="reveal" style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7, color: "var(--slate)", maxWidth: "56ch" }}>
            Empiezas con un playbook precargado y lo editas sin código. Sirve para cualquier expediente donde varios documentos se validan entre sí.
          </p>
          <div className="cases">
            <div className="case reveal"><h4>Seguros de garantía</h4><p>Contrato, poderes y vigencia validados; cotización generada.</p></div>
            <div className="case reveal"><h4>NDAs y contratos</h4><p>Extrae partes, plazos y cláusulas clave; alerta vencimientos.</p></div>
            <div className="case reveal"><h4>Due diligence</h4><p>Cruza sociedades, poderes y estados financieros de un dataroom.</p></div>
            <div className="case reveal"><h4>Arrendamientos</h4><p>Rentas, garantías y fechas de renovación con alertas automáticas.</p></div>
            <div className="case reveal"><h4>KYC / onboarding</h4><p>Identidad, representación legal y documentos de respaldo.</p></div>
            <div className="case reveal"><h4>Obra y licitaciones</h4><p>Bases, propuestas y anexos verificados contra requisitos.</p></div>
          </div>
        </div>
      </section>

      <section className="final" id="demo">
        <div className="halo" />
        <div className="inner">
          <div>
            <h2 className="reveal">Trae tu expediente más complicado. <em>Lo procesamos en vivo.</em></h2>
            <p className="reveal">Te armamos un flujo con tus propios documentos y ves la validación cruzada al instante.</p>
          </div>
          <button className="btn-main on-dark reveal" type="button" data-contact style={{ justifySelf: "start" }}>Solicitar una demo<span className="arr"><Arrow /></span></button>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap ftop2">
          <div>
            <span className="logo" style={{ "--lh": "46px" } as React.CSSProperties}><Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} /></span>
            <p className="desc">Procesamiento inteligente de documentos para equipos de finanzas y legal.</p>
          </div>
          <div>
            <h4>Productos</h4>
            <div className="fcol">
              <a href="/#productos">AP Automation</a>
              <a href="/#productos">Expense Management</a>
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
        </div>
        <div className="fbot"><span>© {new Date().getFullYear()} DocuIA · Todos los derechos reservados</span></div>
      </footer>

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
    </div>
  );
}
