"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./landing.css";
import { SiteNav, SiteFooter, ContactModal } from "./site-chrome";

function Arrow() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
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

      <SiteFooter />
      <ContactModal interest="Expense Management" />
    </div>
  );
}
