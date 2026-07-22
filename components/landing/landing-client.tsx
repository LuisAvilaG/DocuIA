"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./landing.css";

function ArrowIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function FileIcon({ size = 10, lines = false }: { size?: number; lines?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d={lines ? "M14 2v6h6M9 13h6M9 17h6" : "M14 2v6h6"} />
    </svg>
  );
}

// Sobrevive al doble-montaje de StrictMode en dev: la línea de tiempo del
// preloader corre una sola vez por carga y no debe cancelarse en el remount.
let preloaderPlayed = false;

function ExtractIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

export default function LandingClient() {
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

    root.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
      if (a.hasAttribute("data-contact")) return;
      const onClick = (e: MouseEvent) => {
        const id = a.getAttribute("href")!;
        if (id.length > 1 && document.querySelector(id)) {
          e.preventDefault();
          if (lenis) lenis.scrollTo(id, { duration: 1.3 });
          else document.querySelector(id)!.scrollIntoView();
        }
      };
      a.addEventListener("click", onClick);
      cleanups.push(() => a.removeEventListener("click", onClick));
    });

    /* ── Preloader orbital (una vez por sesión de pestaña) ──
       Vive FUERA de gsap.context: en dev StrictMode el primer montaje se
       limpia de inmediato y un ctx.revert() lo dejaría congelado en pantalla. */
    const pre = $("lpre");
    let preSeen = true;
    try { preSeen = !!sessionStorage.getItem("lp-pre"); } catch { preSeen = false; }
    const showPre = !reduced && !preSeen && !preloaderPlayed;
    if (showPre) {
      preloaderPlayed = true;
      try { sessionStorage.setItem("lp-pre", "1"); } catch { /* modo privado */ }
      gsap.timeline()
        .fromTo(".lpre-ring", { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: "power3.out", stagger: 0.08 }, 0)
        .to(".lpre-ring.r1", { rotate: 260, duration: 1.7, ease: "power1.inOut" }, 0)
        .to(".lpre-ring.r2", { rotate: -210, duration: 1.7, ease: "power1.inOut" }, 0)
        .fromTo(".lpre-wd", { opacity: 0, scale: 0.86, y: 6 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0.25)
        .to({}, { duration: 0.7 })
        .to(".lpre-ring", { scale: 2.6, opacity: 0, duration: 0.75, ease: "power3.in", stagger: 0.05 }, 1.7)
        .to(".lpre-wd", { opacity: 0, scale: 1.1, duration: 0.4, ease: "power2.in" }, 1.85)
        .to(pre, { autoAlpha: 0, duration: 0.5, ease: "power2.out",
          onComplete: () => { pre.style.display = "none"; } }, 2.05);
    } else if (!preloaderPlayed) {
      pre.style.display = "none";
    }
    const introDelay = showPre ? 2.0 : 0;

    const ctx = gsap.context(() => {
      const nav = $("nav");
      ScrollTrigger.create({
        start: "top -70",
        onEnter: () => nav.classList.add("solid"),
        onLeaveBack: () => nav.classList.remove("solid"),
      });

      /* ── Scroll-spy: resalta la sección activa en el nav ── */
      const spy = gsap.utils.toArray<HTMLAnchorElement>(".nav-links > a, .nav-links .nav-dd > a")
        .map((a) => {
          const href = a.getAttribute("href") ?? "";
          const el = href.length > 1 && href.startsWith("#") ? document.querySelector<HTMLElement>(href) : null;
          return { a, el };
        })
        .filter((x): x is { a: HTMLAnchorElement; el: HTMLElement } => !!x.el);
      if (spy.length) {
        let activeEl: HTMLAnchorElement | null = null;
        const updateSpy = () => {
          const mark = window.innerHeight * 0.4;
          let active = spy[0].a;
          for (const s of spy) {
            if (s.el.getBoundingClientRect().top <= mark) active = s.a;
          }
          if (active !== activeEl) {
            activeEl = active;
            spy.forEach(({ a }) => a.classList.toggle("active", a === active));
          }
        };
        gsap.ticker.add(updateSpy);
        cleanups.push(() => gsap.ticker.remove(updateSpy));
        updateSpy();
      }

      /* ── Entrada del hero: titular por caracteres ── */
      if (!reduced) {
        root.querySelectorAll<HTMLElement>("h1 .w").forEach((w) => {
          if (w.querySelector(".ch")) return;
          const split = (node: Node) => {
            [...node.childNodes].forEach((n) => {
              if (n.nodeType === 3) {
                const frag = document.createDocumentFragment();
                for (const c of n.textContent ?? "") {
                  const s = document.createElement("span");
                  s.className = "ch";
                  s.textContent = c;
                  frag.appendChild(s);
                }
                n.parentNode!.replaceChild(frag, n);
              } else if (n.nodeType === 1) split(n);
            });
          };
          split(w);
        });
        gsap.set("h1 .w", { y: 0 });
        gsap.timeline({ delay: introDelay, defaults: { ease: "power4.out" } })
          .fromTo("h1 .ch", { yPercent: 115, rotate: 7 }, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.025 }, 0.1)
          .to(".sub", { opacity: 1, duration: 0.9 }, 0.6)
          .to(".ctas", { opacity: 1, duration: 0.9 }, 0.75)
          .to("#machine", { opacity: 1, y: 0, duration: 1.1, ease: "power3.out" }, 0.5);
      }

      /* ── Botones magnéticos ── */
      if (!reduced && fine) {
        root.querySelectorAll<HTMLElement>(".btn-main:not(.send)").forEach((b) => {
          b.classList.add("mag");
          const qx = gsap.quickTo(b, "x", { duration: 0.4, ease: "power3.out" });
          const qy = gsap.quickTo(b, "y", { duration: 0.4, ease: "power3.out" });
          const onMove = (e: MouseEvent) => {
            const r = b.getBoundingClientRect();
            qx((e.clientX - r.left - r.width / 2) * 0.35);
            qy((e.clientY - r.top - r.height / 2) * 0.45);
          };
          const onLeave = () => gsap.to(b, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1,0.35)" });
          b.addEventListener("mousemove", onMove);
          b.addEventListener("mouseleave", onLeave);
          cleanups.push(() => { b.removeEventListener("mousemove", onMove); b.removeEventListener("mouseleave", onLeave); });
        });
      }

      /* ── Tilt 3D en la máquina del hero ── */
      if (!reduced && fine) {
        const card = root.querySelector<HTMLElement>(".doc-card");
        const zone = $("machine");
        if (card && zone) {
          gsap.set(card, { transformPerspective: 700 });
          const rx = gsap.quickTo(card, "rotationX", { duration: 0.5, ease: "power2.out" });
          const ry = gsap.quickTo(card, "rotationY", { duration: 0.5, ease: "power2.out" });
          const onMove = (e: MouseEvent) => {
            const r = zone.getBoundingClientRect();
            ry(((e.clientX - r.left) / r.width - 0.5) * 14);
            rx(-((e.clientY - r.top) / r.height - 0.5) * 10);
          };
          const onLeave = () => gsap.to(card, { rotationX: 0, rotationY: 0, duration: 1, ease: "elastic.out(1,0.4)" });
          zone.addEventListener("mousemove", onMove);
          zone.addEventListener("mouseleave", onLeave);
          cleanups.push(() => { zone.removeEventListener("mousemove", onMove); zone.removeEventListener("mouseleave", onLeave); });
        }
      }

      /* ── La máquina del hero: cicla factura → gasto → contrato ── */
      const DATA = [
        { fname: "factura_0044.pdf", type: "Factura",
          rows: [["Proveedor", "Fran John Corp."], ["Líneas detectadas", "9"], ["Impuestos", "$222.10"], ["Total", "$1,610.20"]],
          badge: "Cuadra", result: "Vendor bill creada en tu ERP" },
        { fname: "gasto_viaje_cdmx.jpg", type: "Gasto",
          rows: [["Colaborador", "Ana Ruiz"], ["Categoría", "Viajes"], ["Comprobantes", "6"], ["Total", "$5,512.50"]],
          badge: "Aprobado", result: "Registrado en tu ERP" },
        { fname: "contrato_garantia.pdf", type: "Contrato",
          rows: [["Apoderado", "María F. Soto"], ["Vigencia poderes", "12 oct 2026"], ["Cláusulas leídas", "14"], ["Validación cruzada", "3 documentos"]],
          badge: "Validado", result: "PDF generado con tu membrete" },
      ];
      const mrows = gsap.utils.toArray<HTMLElement>(".frow");
      let idx = 0;

      function fill(d: (typeof DATA)[number]) {
        $("fname").textContent = d.fname;
        $("ftype").textContent = d.type;
        d.rows.forEach((r, i) => { $("k" + (i + 1)).textContent = r[0]; $("v" + (i + 1)).textContent = r[1]; });
        $("vb").textContent = d.badge;
        $("rtext").textContent = d.result;
      }

      function cycle() {
        const d = DATA[idx % 3];
        const dot = $("d" + (idx % 3));
        fill(d);
        gsap.timeline({ onComplete: () => { idx++; cycle(); }, defaults: { ease: "power2.out" } })
          .set(["#scan"], { top: 16, opacity: 0 })
          .set(mrows, { opacity: 0, y: 10 })
          .set("#result", { opacity: 0, y: 10 })
          .set("#vb", { scale: 0.4, opacity: 0 })
          .set(["#d0", "#d1", "#d2"], { scaleX: 0 })
          .to(dot, { scaleX: 1, duration: 5.4, ease: "none" }, 0)
          .to("#scan", { opacity: 1, duration: 0.15 }, 0.1)
          .to("#scan", { top: "94%", duration: 1.5, ease: "power1.inOut" }, 0.1)
          .to(mrows, { opacity: 1, y: 0, duration: 0.45, stagger: 0.3 }, 0.35)
          .to("#scan", { opacity: 0, duration: 0.25 }, 1.5)
          .to("#vb", { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2.2)" }, 1.75)
          .to("#result", { opacity: 1, y: 0, duration: 0.5 }, 2.1)
          .to({}, { duration: 2.2 })
          .to(["#result", ...mrows, "#vb"], { opacity: 0, duration: 0.45, ease: "power2.in" });
      }
      if (!reduced) cycle();
      else { fill(DATA[0]); gsap.set([mrows, "#result"], { opacity: 1, y: 0 }); }

      /* ── Cómo funciona ── */
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
      gsap.to("#howFill", {
        scaleX: 1, ease: "none",
        scrollTrigger: {
          trigger: ".how-grid", start: "top 75%", end: "bottom 55%", scrub: 0.5,
          onUpdate: (self) => steps.forEach((s, i) => s.classList.toggle("lit", self.progress > i / steps.length + 0.04)),
        },
      });

      /* ── Banda tipográfica: avance + skew por velocidad de scroll ── */
      const track = $("track");
      let bandX = 0;
      const skewTo = gsap.quickTo(track, "skewX", { duration: 0.5, ease: "power2.out" });
      const bandTick = () => {
        const v = lenis ? lenis.velocity : 0;
        bandX -= 0.55 + Math.min(Math.abs(v) * 0.05, 3.2);
        const half = track.scrollWidth / 2;
        if (-bandX >= half) bandX += half;
        gsap.set(track, { x: bandX });
        skewTo(gsap.utils.clamp(-12, 12, -v * 0.32));
      };
      gsap.ticker.add(bandTick);
      cleanups.push(() => gsap.ticker.remove(bandTick));

      /* ── La plataforma en acción: tres escenas ── */
      const drows = gsap.utils.toArray<HTMLElement>(".drow");
      const stEls = drows.map((r) => r.querySelector(".st")!);
      const docsCounter = { v: 128 };
      const setSt = (i: number, cls: string, label: string) => { stEls[i].className = "st " + cls; stEls[i].innerHTML = "<i></i>" + label; };
      const bumpDocs = () => { docsCounter.v++; $("kDocs").textContent = String(docsCounter.v); };
      const sbItems = gsap.utils.toArray<HTMLElement>(".sb .it");
      const setSb = (i: number) => sbItems.forEach((el, j) => el.classList.toggle("on", j === i));

      const sim = gsap.timeline({
        repeat: -1, repeatDelay: 1.2, defaults: { ease: "power2.out" },
        scrollTrigger: { trigger: "#shot", start: "top 80%" },
      });

      /* Escena A: la cola del dashboard */
      sim.set("#sceneA", { autoAlpha: 1 }).set("#sceneB", { autoAlpha: 0 }).set("#sceneC", { autoAlpha: 0 }).call(() => setSb(0));
      drows.forEach((row, i) => {
        const t = i * 1.15;
        sim.fromTo(row, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, t);
        if (i === 2) {
          sim.call(() => { setSt(2, "st-exc", "Excepción · ítem sin mapeo"); $("kExc").textContent = "1"; $("kExc").classList.add("warn"); }, undefined, t + 1.1)
             .call(() => { setSt(2, "st-ok", "Resuelto · mapeo aprendido"); $("kExc").textContent = "0"; $("kExc").classList.remove("warn"); bumpDocs(); }, undefined, t + 3.4);
        } else {
          sim.call(() => { setSt(i, "st-ok", i === 4 ? "Validado · PDF" : "Completado"); bumpDocs(); }, undefined, t + 1.15);
        }
      });
      sim.to(drows, { opacity: 0, y: -8, duration: 0.4, stagger: 0.06, ease: "power2.in" }, "+=2.2")
         .call(() => drows.forEach((_, i) => setSt(i, "st-proc", "Procesando")));

      /* Transición al módulo de contratos */
      sim.to("#sceneA", { autoAlpha: 0, duration: 0.4 }, "+=0.2")
         .call(() => setSb(6))
         .to("#sceneB", { autoAlpha: 1, duration: 0.5 })
         .addLabel("B");

      /* Escena B: el lienzo de flujos de contratos */
      sim.fromTo(".ftop", { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.4 }, "B+=0.1")
         .fromTo(".fnode.ca", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, stagger: 0.16 }, "B+=0.3")
         .fromTo(".e-ab", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.45, stagger: 0.12 }, "B+=1.0")
         .fromTo(".fnode.cb", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, stagger: 0.16 }, "B+=1.35")
         .fromTo(".e-bc", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, stagger: 0.12 }, "B+=2.1")
         .fromTo(".fnode.cc", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45 }, "B+=2.6")
         .fromTo(".vchip", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, "B+=3.4")
         .fromTo(".e-cd", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4 }, "B+=3.8")
         .fromTo(".fnode.cd", { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.45 }, "B+=4.1")
         .fromTo(".gchip", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2.2)" }, "B+=4.8")
         .to("#sceneB", { autoAlpha: 0, duration: 0.45 }, "B+=7.2");

      /* Transición al módulo de gastos */
      sim.call(() => setSb(5))
         .to("#sceneC", { autoAlpha: 1, duration: 0.5 })
         .addLabel("C");

      /* Escena C: captura de un ticket de gastos */
      sim.fromTo(".ticket", { opacity: 0, scale: 0.88, rotate: -7 }, { opacity: 1, scale: 1, rotate: -2, duration: 0.5, ease: "back.out(1.6)" }, "C+=0.1")
         .fromTo(".rflash", { opacity: 0 }, { opacity: 0.9, duration: 0.09, yoyo: true, repeat: 1, ease: "none" }, "C+=0.6")
         .fromTo(".camchip", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4 }, "C+=0.85")
         .set(".rscan", { opacity: 1, top: 6 }, "C+=1.1")
         .to(".rscan", { top: "95%", duration: 1.2, ease: "power1.inOut" }, "C+=1.1")
         .set(".rscan", { opacity: 0 }, "C+=2.35")
         .fromTo(".x1", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, "C+=1.5")
         .fromTo(".x2", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, "C+=1.9")
         .fromTo(".x3", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, "C+=2.3")
         .fromTo(".xcat", { scale: 0.6 }, { scale: 1, duration: 0.35, ease: "back.out(2.4)" }, "C+=2.5")
         .fromTo(".x4", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, "C+=2.7")
         .fromTo(".xfoot", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.45 }, "C+=3.4")
         .call(() => { const s = $("xst"); s.className = "st st-ok"; s.innerHTML = "<i></i>Aprobado · Laura T."; }, undefined, "C+=4.9")
         .fromTo("#xdone", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.4, ease: "back.out(2)" }, "C+=5.5")
         .to("#sceneC", { autoAlpha: 0, duration: 0.45 }, "C+=7.6")
         .call(() => { const s = $("xst"); s.className = "st st-exc"; s.innerHTML = "<i></i>En aprobación"; setSb(0); })
         .to("#sceneA", { autoAlpha: 1, duration: 0.45 });

      gsap.fromTo("#shot", { scale: 0.95 }, {
        scale: 1, ease: "none",
        scrollTrigger: { trigger: "#shot", start: "top 92%", end: "top 40%", scrub: 0.5 },
      });

      /* ── Reveals ── */
      gsap.utils.toArray<HTMLElement>(".reveal").forEach((el) => {
        gsap.to(el, { opacity: 1, y: 0, duration: 1, ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 87%" } });
      });

      /* ── Campo de documentos con física en el hero ── */
      const heroField = $("heroField") as HTMLCanvasElement;
      if (!reduced && fine && heroField) {
        const fctx = heroField.getContext("2d")!;
        const hero = heroField.parentElement as HTMLElement;
        const DPR = Math.min(devicePixelRatio || 1, 2);
        let W = 0, H = 0, mxp = -9999, myp = -9999;
        const size = () => {
          W = heroField.clientWidth; H = heroField.clientHeight;
          heroField.width = W * DPR; heroField.height = H * DPR;
          fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        };
        size();
        addEventListener("resize", size);
        cleanups.push(() => removeEventListener("resize", size));
        const onFieldMove = (e: MouseEvent) => {
          const r = heroField.getBoundingClientRect();
          mxp = e.clientX - r.left; myp = e.clientY - r.top;
        };
        const onFieldLeave = () => { mxp = myp = -9999; };
        hero.addEventListener("mousemove", onFieldMove);
        hero.addEventListener("mouseleave", onFieldLeave);
        cleanups.push(() => { hero.removeEventListener("mousemove", onFieldMove); hero.removeEventListener("mouseleave", onFieldLeave); });

        const fdocs = Array.from({ length: 22 }, () => ({
          x: Math.random(), y: Math.random(), vx: 0, vy: 0,
          ph: Math.random() * Math.PI * 2, sp: 0.25 + Math.random() * 0.45,
          w: 18 + Math.random() * 16, rot: (Math.random() - 0.5) * 0.7,
        }));
        let rafId = 0;
        const draw = (t: number) => {
          fctx.clearRect(0, 0, W, H);
          const time = t / 1000;
          for (const d of fdocs) {
            const hx = d.x * W + Math.sin(time * d.sp + d.ph) * 16;
            const hy = d.y * H + Math.cos(time * d.sp * 0.8 + d.ph) * 12;
            const dx = hx + d.vx - mxp, dy = hy + d.vy - myp;
            const dist = Math.hypot(dx, dy);
            if (dist < 120) {
              const f = ((120 - dist) / 120) * 3;
              d.vx += (dx / (dist || 1)) * f; d.vy += (dy / (dist || 1)) * f;
            }
            d.vx *= 0.9; d.vy *= 0.9;
            const x = hx + d.vx, y = hy + d.vy, w = d.w, h = w * 1.28;
            fctx.save();
            fctx.translate(x, y);
            fctx.rotate(d.rot + Math.sin(time * 0.5 + d.ph) * 0.06);
            fctx.globalAlpha = 0.45;
            fctx.fillStyle = "#fff"; fctx.strokeStyle = "#E6E1D6"; fctx.lineWidth = 1;
            fctx.beginPath();
            fctx.roundRect(-w / 2, -h / 2, w, h, 4);
            fctx.fill(); fctx.stroke();
            fctx.fillStyle = "#3ED3AC";
            fctx.fillRect(-w / 2 + 4, -h / 2 + 5, w * 0.5, 1.8);
            fctx.fillStyle = "rgba(30,36,48,.22)";
            fctx.fillRect(-w / 2 + 4, -h / 2 + 10, w - 8, 1.4);
            fctx.fillRect(-w / 2 + 4, -h / 2 + 14, w * 0.7, 1.4);
            fctx.restore();
          }
          rafId = requestAnimationFrame(draw);
        };
        rafId = requestAnimationFrame(draw);
        cleanups.push(() => cancelAnimationFrame(rafId));
      }

      /* ── Modal de contacto ── */
      const modal = $("cmodal");
      const veil = modal.querySelector(".veil")!;
      const box = modal.querySelector(".box")!;
      const form = $("cform") as HTMLFormElement;
      const ok = $("cok");

      function openModal() {
        modal.classList.add("open");
        (form as HTMLElement).style.display = "";
        ok.style.display = "none";
        gsap.to(veil, { opacity: 1, duration: 0.35, ease: "power2.out" });
        gsap.fromTo(box, { opacity: 0, y: 28, scale: 0.97 }, { opacity: 1, y: 0, scale: 1, duration: 0.55, ease: "power3.out" });
        setTimeout(() => $("cf-name").focus(), 80);
      }
      function closeModal() {
        gsap.to(veil, { opacity: 0, duration: 0.3 });
        gsap.to(box, { opacity: 0, y: 18, scale: 0.97, duration: 0.3, ease: "power2.in",
          onComplete: () => { modal.classList.remove("open"); form.reset(); } });
      }
      root.querySelectorAll<HTMLElement>("[data-contact]").forEach((el) => {
        const onClick = (e: Event) => { e.preventDefault(); openModal(); };
        el.addEventListener("click", onClick);
        cleanups.push(() => el.removeEventListener("click", onClick));
      });
      const onVeil = () => closeModal();
      veil.addEventListener("click", onVeil);
      cleanups.push(() => veil.removeEventListener("click", onVeil));
      const xBtn = modal.querySelector(".x")!;
      xBtn.addEventListener("click", onVeil);
      cleanups.push(() => xBtn.removeEventListener("click", onVeil));
      const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); };
      addEventListener("keydown", onKey);
      cleanups.push(() => removeEventListener("keydown", onKey));

      const onSubmit = async (e: Event) => {
        e.preventDefault();
        const btn = form.querySelector<HTMLButtonElement>(".send")!;
        const hint = form.querySelector<HTMLElement>(".hint");
        const val = (id: string) => ($(id) as HTMLInputElement).value.trim();
        btn.disabled = true;
        btn.firstChild!.textContent = "Enviando… ";
        try {
          const phone = val("cf-phone");
          const res = await fetch("/api/v1/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: val("cf-name"),
              email: val("cf-email"),
              company: val("cf-company"),
              message: phone ? `Teléfono: ${phone}` : "",
            }),
          });
          const d = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(d.error || "No pudimos enviar tu solicitud.");
          $("cok-name").textContent = val("cf-name").split(" ")[0];
          (form as HTMLElement).style.display = "none";
          ok.style.display = "block";
          gsap.fromTo(ok, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" });
        } catch (err) {
          if (hint) { hint.textContent = err instanceof Error ? err.message : "Ocurrió un error. Inténtalo de nuevo."; hint.style.color = "#c0392b"; }
        } finally {
          btn.disabled = false;
          btn.firstChild!.textContent = "Enviar ";
        }
      };
      form.addEventListener("submit", onSubmit);
      cleanups.push(() => form.removeEventListener("submit", onSubmit));
    }, root);

    return () => {
      cleanups.forEach((fn) => fn());
      ctx.revert();
      lenis?.destroy();
    };
  }, []);

  return (
    <div className="lp" ref={rootRef}>
      <div className="lpre" id="lpre" aria-hidden="true">
        <div className="lpre-ring r1" />
        <div className="lpre-ring r2" />
        <span className="lpre-wd">Docu<b>IA</b></span>
      </div>

      <header className="nav" id="nav">
        <a className="logo" href="#" aria-label="DocuIA, inicio">
          <Image src="/logo-full.png" alt="DocuIA" width={1376} height={768} priority />
        </a>
        <nav className="nav-links">
          <a href="#como">Cómo funciona</a>
          <div className="nav-dd">
            <a href="#productos">Productos
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </a>
            <div className="nav-dd-panel">
              <a className="nav-dd-item" href="/productos/facturas">
                <span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg></span>
                <span><h5>AP Automation</h5><p>Facturas, OC y CFDI directo a tu ERP.</p></span>
              </a>
              <a className="nav-dd-item" href="/productos/gastos">
                <span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z" /><path d="M8 7h8M8 11h8" /></svg></span>
                <span><h5>Expense Management</h5><p>Tickets capturados, aprobados y registrados.</p></span>
              </a>
              <a className="nav-dd-item" href="/productos/contratos">
                <span className="di"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg></span>
                <span><h5>Contract Intelligence</h5><p>Flujos documentales validados con IA.</p></span>
              </a>
            </div>
          </div>
          <a href="#seguridad">Seguridad</a>
          <a href="#" data-contact>Contáctanos</a>
        </nav>
        <div className="nav-right">
          <a className="nav-login" href="/login">Acceder</a>
          <button className="nav-cta" type="button" data-contact>Solicitar demo</button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-grid" />
        <canvas className="hero-field" id="heroField" aria-hidden="true" />
        <div className="hero-inner">
          <div>
            <span className="eyebrow">Plataforma de documentos con IA</span>
            <h1>
              <span className="row"><span className="w">La&nbsp;contabilidad</span></span>
              <span className="row"><span className="w">que&nbsp;se&nbsp;hace</span></span>
              <span className="row"><span className="w"><em>sola</em>.</span></span>
            </h1>
            <p className="sub">
              Facturas y gastos aterrizan en tu ERP. Contratos salen validados y listos para
              firmar. La plataforma hace el trabajo pesado; tu equipo solo decide.
            </p>
            <div className="ctas">
              <button className="btn-main" type="button" data-contact>
                Solicitar una demo
                <span className="arr"><ArrowIcon /></span>
              </button>
            </div>
          </div>

          <div className="machine" id="machine">
            <div className="orbit o1" /><div className="orbit o2" />
            <div className="doc-card">
              <div className="scan" id="scan" />
              <div className="doc-top">
                <span className="fname">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12907F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  <span id="fname">factura_0044.pdf</span>
                </span>
                <span className="chip" id="ftype">Factura</span>
              </div>
              <div className="frow"><span className="k" id="k1">Proveedor</span><span className="v" id="v1">Fran John Corp.</span></div>
              <div className="frow"><span className="k" id="k2">Líneas detectadas</span><span className="v" id="v2">9</span></div>
              <div className="frow"><span className="k" id="k3">Impuestos</span><span className="v" id="v3">$222.10</span></div>
              <div className="frow">
                <span className="k" id="k4">Total</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="v" id="v4">$1,610.20</span>
                  <span className="badge" id="vb">Cuadra</span>
                </span>
              </div>
            </div>
            <div className="result" id="result">
              <span className="pill"><CheckIcon size={15} /><span id="rtext">Vendor bill creada en tu ERP</span></span>
            </div>
            <div className="dots"><span><i id="d0" /></span><span><i id="d1" /></span><span><i id="d2" /></span></div>
          </div>
        </div>
      </section>

      <section className="how" id="como">
        <div className="wrap">
          <p className="kicker reveal">Cómo funciona</p>
          <h2 className="h2 reveal">Modelos de IA que leen. Algoritmos que verifican. Tu equipo decide.</h2>
          <div className="how-grid">
            <div className="how-line"><i id="howFill" /></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">01</p><h3>El documento entra</h3><p>PDF, escaneo, XML o foto. Por el navegador, por lote o por API.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">02</p><h3>Modelos de IA lo leen</h3><p>Modelos multimodales extraen encabezado, líneas e impuestos, incluso de escaneos, con el origen exacto de cada dato.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">03</p><h3>Algoritmos lo verifican</h3><p>Un motor de reglas determinista cruza totales, detecta duplicados y aplica tus políticas. Nada entra sin cuadrar.</p></div>
            <div className="how-step" data-step><div className="pt"><i /></div><p className="num">04</p><h3>Llega a su destino</h3><p>Transacción lista en tu ERP, o documento validado en PDF. Con auditoría completa de cada paso.</p></div>
          </div>
        </div>
      </section>

      <section className="band">
        <div className="track" id="track">
          <span>Facturas <em>·</em> Gastos <em>·</em> Contratos <em>·</em> CFDI <em>·</em> Órdenes de compra <em>·</em>&nbsp;</span>
          <span>Facturas <em>·</em> Gastos <em>·</em> Contratos <em>·</em> CFDI <em>·</em> Órdenes de compra <em>·</em>&nbsp;</span>
        </div>
      </section>

      <section className="proof" id="producto">
        <div className="wrap">
          <p className="kicker reveal">El producto</p>
          <h2 className="h2 reveal">La plataforma en acción.</h2>
          <p className="lede reveal">Documentos entrando, validándose y aterrizando en tu ERP. Así se ve un lote cualquiera, un martes cualquiera.</p>
          <div className="shot reveal" id="shot" aria-label="Simulación animada de DocuIA procesando documentos">
            <div className="bar"><b /><b /><b /><span>app.docuia.com</span></div>
            <div className="app">
              <div className="sb">
                <div className="it on">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
                  Dashboard
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
                  Workflow
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  Historial
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
                  Excepciones
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
                  Mapeos
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM8 7h8M8 11h8M8 15h5" /></svg>
                  Gastos
                </div>
                <div className="it">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>
                  Contratos
                </div>
              </div>
              <div className="main">
                <div className="scene" id="sceneA">
                  <div className="kpis">
                    <div className="kpi"><p className="l">Docs este mes</p><p className="n" id="kDocs">128</p></div>
                    <div className="kpi"><p className="l">Excepciones</p><p className="n" id="kExc">0</p></div>
                    <div className="kpi"><p className="l">Sin captura manual</p><p className="n" id="kRate">99.2%</p></div>
                  </div>
                  <div className="tbl">
                    <div className="thead"><span>Documento</span><span>Tipo</span><span>Total</span><span>Estado</span></div>
                    <div className="drow"><span className="nm">factura_0044.pdf</span><span className="tp">Factura</span><span className="amt">$1,610.20</span><span className="st st-proc"><i />Procesando</span></div>
                    <div className="drow"><span className="nm">gasto_viaje_cdmx.jpg</span><span className="tp">Gasto</span><span className="amt">$5,512.50</span><span className="st st-proc"><i />Procesando</span></div>
                    <div className="drow"><span className="nm">factura_0045.pdf</span><span className="tp">Factura</span><span className="amt">$8,430.00</span><span className="st st-proc"><i />Procesando</span></div>
                    <div className="drow"><span className="nm">oc_2231.pdf</span><span className="tp">Orden de compra</span><span className="amt">$12,480.00</span><span className="st st-proc"><i />Procesando</span></div>
                    <div className="drow"><span className="nm">contrato_garantia.pdf</span><span className="tp">Contrato</span><span className="amt">—</span><span className="st st-proc"><i />Procesando</span></div>
                  </div>
                </div>

                <div className="scene" id="sceneB" style={{ opacity: 0, visibility: "hidden" }}>
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
                      <div className="fnode ca" style={{ left: "1.5%", top: "11%", width: "20%" }}>
                        <span className="hdl r" />
                        <div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#1</span></div>
                        <div className="fb">Contrato</div>
                      </div>
                      <div className="fnode ca" style={{ left: "1.5%", top: "44%", width: "20%" }}>
                        <span className="hdl r" />
                        <div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#2</span></div>
                        <div className="fb">Escritura de poderes</div>
                      </div>
                      <div className="fnode ca" style={{ left: "1.5%", top: "77%", width: "20%" }}>
                        <span className="hdl r" />
                        <div className="fh"><span className="fic"><FileIcon /></span>Entrada<span className="ord">#3</span></div>
                        <div className="fb">Certificado de vigencia</div>
                      </div>
                      <div className="fnode cb" style={{ left: "28%", top: "11%", width: "20%" }}>
                        <span className="hdl l" /><span className="hdl r" />
                        <div className="fh"><span className="fic"><ExtractIcon /></span>Extracción</div>
                        <div className="fb">contrato · 4 campos</div>
                      </div>
                      <div className="fnode cb" style={{ left: "28%", top: "44%", width: "20%" }}>
                        <span className="hdl l" /><span className="hdl r" />
                        <div className="fh"><span className="fic"><ExtractIcon /></span>Extracción</div>
                        <div className="fb">escritura_poderes · 3 campos</div>
                      </div>
                      <div className="fnode cb" style={{ left: "28%", top: "77%", width: "20%" }}>
                        <span className="hdl l" /><span className="hdl r" />
                        <div className="fh"><span className="fic"><ExtractIcon /></span>Extracción</div>
                        <div className="fb">certificado · 2 campos</div>
                      </div>
                      <div className="fnode cc" style={{ left: "56.5%", top: "44%", width: "22.5%" }}>
                        <span className="hdl l" /><span className="hdl r" />
                        <div className="fh">
                          <span className="fic">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>
                          </span>
                          Validación
                        </div>
                        <div className="fb">Firmante con poderes vigentes<span className="vchip">3/3 ✓</span></div>
                      </div>
                      <div className="fnode cd" style={{ left: "83.5%", top: "44%", width: "15%" }}>
                        <span className="hdl l" />
                        <div className="fh"><span className="fic"><FileIcon lines /></span>Generación</div>
                        <div className="fb">Cotización<span className="gchip">PDF</span></div>
                      </div>
                      <div className="fctrl"><span>+</span><span>−</span><span>⌖</span></div>
                      <div className="fmap">
                        <i style={{ left: 8, top: 10 }} /><i style={{ left: 8, top: 24 }} /><i style={{ left: 8, top: 38 }} />
                        <i style={{ left: 30, top: 24 }} /><i style={{ left: 52, top: 24 }} /><i style={{ left: 68, top: 24, width: 12 }} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="scene" id="sceneC" style={{ opacity: 0, visibility: "hidden" }}>
                  <div className="cw2">
                    <div className="tkwrap">
                      <div className="ticket">
                        <div className="rflash" />
                        <div className="rscan" />
                        <p className="rname">La Palma · Restaurante</p>
                        <p className="rmeta">14 jul 2026 · 14:32 · Ticket 08841</p>
                        <div className="ritem" style={{ marginTop: 13 }}><span>2× Comida corrida</span><span>$520.00</span></div>
                        <div className="ritem"><span>1× Agua mineral</span><span>$45.00</span></div>
                        <div className="ritem"><span>Servicio</span><span>$77.00</span></div>
                        <div className="rtot"><span>Total</span><span>$642.00</span></div>
                      </div>
                      <span className="camchip">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                        Foto capturada desde el celular
                      </span>
                    </div>
                    <div className="pane2">
                      <p className="pt2">Nuevo gasto</p>
                      <div className="xrow x1"><span className="k2">Comercio</span><b>La Palma · Restaurante</b></div>
                      <div className="xrow x2"><span className="k2">Fecha</span><b>14 jul 2026</b></div>
                      <div className="xrow x3"><span className="k2">Categoría</span><b><span className="xcat">Comidas · asignada por IA</span></b></div>
                      <div className="xrow x4" style={{ borderBottom: 0 }}><span className="k2">Monto</span><b>$642.00 <span className="xiva">IVA $88.55 detectado</span></b></div>
                      <div className="xfoot">
                        <span className="st st-exc" id="xst"><i />En aprobación</span>
                        <span className="st st-ok" id="xdone" style={{ opacity: 0 }}>Gasto registrado</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="products" id="productos">
        <div className="wrap">
          <p className="kicker reveal">Tres productos, una plataforma</p>
          <h2 className="h2 reveal">Activa solo lo que tu operación necesita.</h2>
          <a className="prow reveal" href="/productos/facturas">
            <span className="idx">01</span>
            <div>
              <h3>AP Automation</h3>
              <p className="claim">Cierra el mes sin capturar una sola factura.</p>
              <p>Facturas, órdenes de compra y CFDI se leen completos, encabezado y cada línea. El sistema valida contra tus reglas, detecta duplicados antes de que cuesten dinero y aprende cómo mapeas los ítems de cada proveedor para no volver a preguntarte.</p>
              <ul className="feats">
                <li><CheckIcon />Extracción línea por línea con trazabilidad</li>
                <li><CheckIcon />Totales, impuestos y duplicados verificados</li>
                <li><CheckIcon />Mapeos que se aprenden una vez, se aplican siempre</li>
                <li><CheckIcon />Modo de prueba sin tocar tu ERP</li>
              </ul>
              <span className="more">Conocer más<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </div>
          </a>
          <a className="prow reveal" href="/productos/gastos">
            <span className="idx">02</span>
            <div>
              <h3>Expense Management</h3>
              <p className="claim">Gastos que se reportan y aprueban sin perseguir a nadie.</p>
              <p>Tu equipo fotografía el ticket y el gasto queda extraído y categorizado según tus políticas. El informe fluye por aprobación con avisos automáticos y se registra en tu ERP sin recapturas.</p>
              <ul className="feats">
                <li><CheckIcon />Captura desde el celular</li>
                <li><CheckIcon />Categorías y políticas de tu empresa</li>
                <li><CheckIcon />Flujo de aprobación con avisos por correo</li>
              </ul>
              <span className="more">Conocer más<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </div>
          </a>
          <a className="prow reveal" href="/productos/contratos">
            <span className="idx">03</span>
            <div>
              <h3>Contract Intelligence</h3>
              <p className="claim">Monta tus propios flujos documentales, sin escribir código.</p>
              <p>Tú defines el flujo: qué tipos de documento entran, qué campos se extraen, qué reglas los validan entre sí y qué documento sale al final. El motor clasifica cada archivo, extrae con cita literal (clic en un dato y ves de dónde salió), cruza contratos contra poderes y certificados, y genera el documento final en PDF con tu membrete.</p>
              <ul className="feats">
                <li><CheckIcon />Flujos, campos y reglas configurables por caso</li>
                <li><CheckIcon />Cada dato con su cita en el documento original</li>
                <li><CheckIcon />Validación cruzada entre documentos</li>
                <li><CheckIcon />Alertas de vencimiento y renovación</li>
                <li><CheckIcon />Generación por plantilla en PDF</li>
              </ul>
              <span className="more">Conocer más<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </div>
          </a>
        </div>
      </section>

      <section className="secure" id="seguridad">
        <div className="wrap">
          <p className="kicker reveal">Seguridad y cumplimiento</p>
          <h2 className="h2 reveal">Tu información, bajo tus reglas.</h2>
          <p className="lede reveal">Procesas documentos sensibles y tus clientes te exigen cumplimiento. La plataforma está construida para eso desde el primer día, no como un parche.</p>
          <div className="sec-grid">
            <div className="sec-item reveal"><h3>Aislamiento por empresa</h3><p>Arquitectura multi-tenant: los datos de cada organización viven separados y nadie más puede verlos.</p></div>
            <div className="sec-item reveal"><h3>Cifrado en tránsito</h3><p>Toda la comunicación viaja cifrada, y el acceso se protege con credenciales robustas y API keys con permisos.</p></div>
            <div className="sec-item reveal"><h3>Auditoría de cada acción</h3><p>Quién subió, quién aprobó, qué cambió y cuándo. Registro completo listo para tus auditores y reguladores.</p></div>
            <div className="sec-item reveal"><h3>Acceso por roles</h3><p>Cada usuario ve y hace solo lo que le corresponde. Restricción por IP disponible para entornos exigentes.</p></div>
            <div className="sec-item reveal"><h3>Tus documentos son tuyos</h3><p>No se usan para entrenar modelos. Se procesan, se guardan bajo tu control y punto.</p></div>
            <div className="sec-item reveal"><h3>Retención configurable</h3><p>Tú decides cuánto tiempo se conservan los documentos y sus datos, según tus políticas y las de tus clientes.</p></div>
          </div>
          <p className="sec-note reveal">¿Tu equipo de seguridad o cumplimiento tiene preguntas? <a data-contact>Hablemos directamente</a>.</p>
        </div>
      </section>

      <section className="final" id="demo">
        <div className="halo" />
        <div className="inner">
          <div>
            <h2 className="reveal">El trabajo pesado ya tiene <em>quién lo haga</em>.</h2>
            <p className="reveal">Agenda 30 minutos y mira tus propios documentos procesarse en vivo.</p>
          </div>
          <button className="btn-main on-dark reveal" type="button" data-contact style={{ justifySelf: "start" }}>
            Solicitar una demo
            <span className="arr"><ArrowIcon /></span>
          </button>
        </div>
      </section>

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
              <a href="/productos/facturas">AP Automation</a>
              <a href="/productos/gastos">Expense Management</a>
              <a href="/productos/contratos">Contract Intelligence</a>
            </div>
          </div>
          <div>
            <h4>Plataforma</h4>
            <div className="fcol">
              <a href="#como">Cómo funciona</a>
              <a href="#seguridad">Seguridad</a>
              <a data-contact>Contáctanos</a>
              <a href="/login">Iniciar sesión</a>
            </div>
          </div>
        </div>
        <div className="fbot">
          <span>© {new Date().getFullYear()} DocuIA · Todos los derechos reservados</span>
        </div>
      </footer>

      <div className="cmodal" id="cmodal" role="dialog" aria-modal="true" aria-labelledby="cm-title">
        <div className="veil" />
        <div className="box">
          <button className="x" type="button" aria-label="Cerrar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
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
            <button className="btn-main send" type="submit">
              Enviar
              <span className="arr"><ArrowIcon /></span>
            </button>
          </form>
          <div className="ok" id="cok">
            <div className="ic">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h4>Listo, <span id="cok-name" /></h4>
            <p>Recibimos tus datos. Te contactaremos en menos de un día hábil para agendar.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
