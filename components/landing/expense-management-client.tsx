"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./landing.css";

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}
function Chevron() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>;
}
function Check() {
  return <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>;
}

export default function ExpenseManagementClient() {
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
          .to("#phone", { opacity: 1, y: 0, duration: 1.0, ease: "power3.out" }, 0.4)
          .to("#chain", { opacity: 1, y: 0, duration: 0.8, ease: "power3.out" }, 0.75);
      } else {
        gsap.set([".pp-sub", ".pp-ctas", "#phone", "#chain"], { opacity: 1, y: 0 });
      }

      /* Firma: captura desde el celular + cadena de aprobación */
      const xf = gsap.utils.toArray<HTMLElement>(".xf");
      const csteps = gsap.utils.toArray<HTMLElement>(".cstep");
      if (!reduced) {
        gsap.timeline({ repeat: -1, repeatDelay: 1.8, defaults: { ease: "power2.out" } })
          .set(xf, { opacity: 0, y: 6 }).set("#rscan", { opacity: 0, top: 0 }).set(csteps, { className: "cstep" })
          .fromTo("#rflash", { opacity: 0 }, { opacity: 0.85, duration: 0.08, yoyo: true, repeat: 1 }, 0.4)
          .set("#rscan", { opacity: 1, top: 6 }, 0.6)
          .to("#rscan", { top: "94%", duration: 1.1, ease: "power1.inOut" }, 0.6)
          .set("#rscan", { opacity: 0 }, 1.75)
          .to(xf, { opacity: 1, y: 0, duration: 0.4, stagger: 0.28 }, 1.0)
          .call(() => csteps[0]?.classList.add("on"), undefined, 2.2)
          .call(() => csteps[1]?.classList.add("on"), undefined, 2.9)
          .call(() => csteps[2]?.classList.add("on"), undefined, 3.6)
          .to({}, { duration: 2 });
      } else {
        gsap.set(xf, { opacity: 1, y: 0 });
        csteps.forEach((c) => c.classList.add("on"));
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

      /* Modal */
      const modal = $("cmodal"); const veil = modal.querySelector(".veil")!; const box = modal.querySelector(".box")!;
      const form = $("cform") as HTMLFormElement; const ok = $("cok");
      const openModal = () => { modal.classList.add("open"); (form as HTMLElement).style.display = ""; ok.style.display = "none"; gsap.to(veil, { opacity: 1, duration: 0.35 }); gsap.fromTo(box, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" }); setTimeout(() => $("cf-name").focus(), 80); };
      const closeModal = () => { gsap.to(veil, { opacity: 0, duration: 0.3 }); gsap.to(box, { opacity: 0, y: 18, scale: 0.97, duration: 0.3, ease: "power2.in", onComplete: () => { modal.classList.remove("open"); form.reset(); } }); };
      root.querySelectorAll<HTMLElement>("[data-contact]").forEach((el) => { const c = (e: Event) => { e.preventDefault(); openModal(); }; el.addEventListener("click", c); cleanups.push(() => el.removeEventListener("click", c)); });
      veil.addEventListener("click", closeModal); modal.querySelector(".x")!.addEventListener("click", closeModal);
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); };
      addEventListener("keydown", onKey); cleanups.push(() => removeEventListener("keydown", onKey));
      const onSubmit = async (e: Event) => {
        e.preventDefault();
        const btn = form.querySelector<HTMLButtonElement>(".send")!; const hint = form.querySelector<HTMLElement>(".hint");
        const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
        btn.disabled = true; btn.firstChild!.textContent = "Enviando… ";
        try {
          const phone = val("cf-phone");
          const res = await fetch("/api/v1/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: val("cf-name"), email: val("cf-email"), company: val("cf-company"), message: (phone ? `Teléfono: ${phone}. ` : "") + "Interés: Expense Management" }) });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "No pudimos enviar tu solicitud.");
          $("cok-name").textContent = val("cf-name").split(" ")[0]; (form as HTMLElement).style.display = "none"; ok.style.display = "block";
          gsap.fromTo(ok, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
        } catch (err) { if (hint) { hint.textContent = err instanceof Error ? err.message : "Ocurrió un error."; hint.style.color = "#c0392b"; } }
        finally { btn.disabled = false; btn.firstChild!.textContent = "Enviar "; }
      };
      form.addEventListener("submit", onSubmit); cleanups.push(() => form.removeEventListener("submit", onSubmit));
    }, root);

    return () => { cleanups.forEach((fn) => fn()); ctx.revert(); lenis?.destroy(); };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      <header className="nav" id="nav">
        <Link className="logo" href="/" aria-label="DocuIA, inicio"><Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} priority /></Link>
        <nav className="nav-links">
          <a href="/#como">Cómo funciona</a>
          <div className="nav-dd">
            <a href="/#productos">Productos <Chevron /></a>
            <div className="nav-dd-panel">
              <Link className="nav-dd-item" href="/productos/facturas"><span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg></span><span><h5>AP Automation</h5><p>Facturas, OC y CFDI directo a tu ERP.</p></span></Link>
              <Link className="nav-dd-item" href="/productos/gastos"><span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M8 7h8M8 11h8" /></svg></span><span><h5>Expense Management</h5><p>Tickets capturados, aprobados y registrados.</p></span></Link>
              <Link className="nav-dd-item" href="/productos/contratos"><span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg></span><span><h5>Contract Intelligence</h5><p>Flujos documentales validados con IA.</p></span></Link>
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
            <Link className="back" href="/#productos"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>Productos</Link>
            <span className="eyebrow" style={{ marginTop: 18 }}>Expense Management</span>
            <h1>
              <span className="row"><span className="w">Foto&nbsp;del&nbsp;ticket.</span></span>
              <span className="row"><span className="w">El&nbsp;resto,&nbsp;<em>solo</em>.</span></span>
            </h1>
            <p className="sub pp-sub">Tu equipo fotografía el comprobante y el gasto queda extraído y categorizado según tus políticas. El informe fluye por aprobación con avisos automáticos y se registra en tu ERP, sin que nadie recapture nada.</p>
            <div className="ctas pp-ctas"><button className="btn-main" type="button" data-contact>Ver una demo<span className="arr"><Arrow /></span></button></div>
          </div>

          <div style={{ position: "relative" }}>
            <div className="phone" id="phone" style={{ opacity: 0, transform: "translateY(30px)" }}>
              <span className="notch" />
              <div className="scr">
                <div className="rcpt" id="rcpt">
                  <div className="rflash" id="rflash" />
                  <div className="rscan" id="rscan" />
                  <div className="rline" /><div className="rline" style={{ width: "85%" }} /><div className="rline" style={{ width: "70%" }} /><div className="rline" style={{ width: "90%" }} /><div className="rline" style={{ width: "60%" }} />
                </div>
                <div className="xf x1"><span className="k">Comercio</span><span className="v">La Palma</span></div>
                <div className="xf x2"><span className="k">Monto</span><span className="v">$642.00</span></div>
                <div className="xf x3"><span className="k">Categoría</span><span className="cat">Comidas</span></div>
              </div>
            </div>
            <div className="chain" id="chain" style={{ opacity: 0, transform: "translateY(30px)" }}>
              <p className="ct">Aprobación</p>
              <div className="cstep"><span className="cd"><Check /></span>Ana Ruiz · envía</div>
              <div className="cstep"><span className="cd"><Check /></span>Laura T. · aprueba</div>
              <div className="cstep"><span className="cd"><Check /></span>Registrado en tu ERP</div>
            </div>
          </div>
        </div>
      </section>

      <section className="how" id="como" style={{ borderRadius: 0 }}>
        <div className="wrap">
          <p className="kicker reveal">Cómo funciona</p>
          <h2 className="h2 reveal">Del bolsillo al ERP, sin planillas.</h2>
          <div className="how-grid">
            <div className="how-line"><i id="howFill" /></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">01</p><h3>Fotografía el ticket</h3><p>Desde el celular, en el momento. Sin guardar papeles ni llenar hojas de cálculo.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">02</p><h3>Se extrae y categoriza</h3><p>Comercio, monto, fecha e impuestos, con la categoría según tus políticas.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">03</p><h3>Fluye por aprobación</h3><p>El aprobador recibe el aviso y resuelve en un clic. Todo queda registrado.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">04</p><h3>Se registra en tu ERP</h3><p>El gasto aprobado entra sin recapturas, con su comprobante adjunto.</p></div>
          </div>
        </div>
      </section>

      <section style={{ background: "#fff", padding: "20px 0 130px" }}>
        <div className="wrap">
          <p className="kicker reveal">Menos fricción</p>
          <h2 className="h2 reveal">A tu equipo le toma segundos. A ti, cero recaptura.</h2>
          <p className="reveal" style={{ marginTop: 14, fontSize: 15, lineHeight: 1.7, color: "var(--slate)", maxWidth: "58ch" }}>
            El colaborador solo toma la foto. Las políticas, la categorización, la aprobación y el registro ocurren solos. Contabilidad deja de perseguir comprobantes y de recapturar.
          </p>
          <div className="cases">
            <div className="case reveal"><h4>Captura desde el celular</h4><p>La foto del ticket es todo lo que tu equipo necesita hacer.</p></div>
            <div className="case reveal"><h4>Categorías y políticas</h4><p>Cada gasto se clasifica según las reglas de tu empresa.</p></div>
            <div className="case reveal"><h4>Flujo de aprobación</h4><p>Con avisos por correo; el aprobador resuelve en un clic.</p></div>
            <div className="case reveal"><h4>Sin recapturas</h4><p>El gasto aprobado entra a tu ERP tal cual, con su comprobante.</p></div>
            <div className="case reveal"><h4>Impuestos detectados</h4><p>El IVA y los desgloses se leen del comprobante, no a mano.</p></div>
            <div className="case reveal"><h4>Todo trazable</h4><p>Quién gastó, quién aprobó y cuándo, listo para auditoría.</p></div>
          </div>
        </div>
      </section>

      <section className="final" id="demo">
        <div className="halo" />
        <div className="inner">
          <div>
            <h2 className="reveal">Que reportar un gasto sea <em>una foto</em>.</h2>
            <p className="reveal">Te mostramos el flujo completo con gastos como los de tu equipo, en vivo.</p>
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
