import test from "node:test";
import assert from "node:assert/strict";
import { reviewReason } from "../lib/workflow/review-reason";

test("motivo final de revisión: lo más importante primero, como mucho dos", () => {
  const base = { decisionReason: null, vendorSelected: true, lines: [{ selected_item_id: "1" }], confidence: 0.95, threshold: 0.9, neverAutoProcess: false };
  assert.equal(reviewReason({ ...base, lines: [{ selected_item_id: null }, { selected_item_id: null }, { selected_item_id: "1" }] }), "2 líneas sin ítem del ERP");
  assert.equal(reviewReason({ ...base, decisionReason: "No trae orden de compra", vendorSelected: false }), "No trae orden de compra · Proveedor sin identificar en el ERP");
  assert.equal(reviewReason({ ...base, confidence: 0.71 }), "Lectura con 71 % de confianza (pide 90 %)");
  assert.equal(reviewReason({ ...base, neverAutoProcess: true }), "La regla del proveedor pide revisarla siempre");
  assert.equal(reviewReason(base), "Revisión pedida por la configuración");
});

test("aviso cuando el documento de una casilla no parece de ese tipo", async () => {
  const { slotTypeWarning } = await import("../lib/contracts/pipeline");
  const docTypes = [{ key: "poliza", name: "Póliza" }, { key: "contrato", name: "Contrato" }];
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "contrato", docTypes, filled: 5, total: 6 }), "Se subió como Póliza, pero parece Contrato.");
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "poliza", docTypes, filled: 5, total: 6 }), null);
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: "unknown", docTypes, filled: 1, total: 8 }), "Se subió como Póliza, pero la IA encontró solo 1 de 8 datos esperados.");
  assert.equal(slotTypeWarning({ expected: "Póliza", detected: null, docTypes, filled: 1, total: 2 }), null, "con pocos campos no se juzga");
});

test("entrega del contratista: tipo real del archivo y token guardado como hash", async () => {
  const { sniffFile, hashToken } = await import("../lib/contracts/upload-links");
  assert.equal(sniffFile(Buffer.from("%PDF-1.7\n...")), "application/pdf");
  assert.equal(sniffFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffFile(Buffer.from("<html>no</html>")), null, "un .pdf falso no pasa");
  assert.match(hashToken("abc"), /^[0-9a-f]{64}$/);
  assert.notEqual(hashToken("abc"), "abc");
});

test("posición de la cita en una página escaneada (TSV de tesseract)", async () => {
  const { parseTesseractTsv } = await import("../lib/contracts/ocr-boxes");
  const { matchQuote } = await import("../lib/contracts/evidence");
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t",
    "4\t1\t1\t1\t1\t0\t100\t400\t600\t40\t-1\t",
    "5\t1\t1\t1\t1\t1\t100\t400\t180\t40\t91\tRepresentante",
    "5\t1\t1\t1\t1\t2\t290\t400\t90\t40\t93\tlegal:",
    "5\t1\t1\t1\t1\t3\t390\t400\t120\t40\t88\tJORGE",
    "5\t1\t1\t1\t1\t4\t520\t400\t180\t40\t90\tGUTIÉRREZ",
    "5\t1\t1\t1\t2\t1\t100\t900\t100\t40\t95\tSuplente",
  ].join("\n");
  const words = parseTesseractTsv(tsv);
  assert.equal(words.length, 5);
  assert.deepEqual(words[0], { text: "Representante", x1: 0.1, y1: 0.2, x2: 0.28, y2: 0.22 });
  const box = matchQuote(words, "Representante legal: Jorge Gutierrez");
  assert.ok(box);
  assert.ok(Math.abs(box.x1 - 0.1) < 1e-9 && Math.abs(box.x2 - 0.7) < 1e-9 && Math.abs(box.y1 - 0.2) < 1e-9);
  assert.deepEqual(parseTesseractTsv("sin cabecera"), []);
});

test("un bloqueante sin verificar queda a revisar, no pasa como correcto", async () => {
  const { caseVerdict, findingLevel } = await import("../lib/contracts/validate");
  assert.equal(findingLevel({ ok: null, severity: "block" }), "warn");
  assert.equal(findingLevel({ ok: false, severity: "block" }), "block");
  assert.equal(findingLevel({ ok: null, severity: "warn" }), "warn");
  assert.equal(findingLevel({ ok: false, severity: "info" }), null);
  assert.equal(findingLevel({ ok: true, severity: "block" }), null);
  assert.equal(caseVerdict([{ ok: true, severity: "block" }, { ok: null, severity: "block" }]), "warn");
  assert.equal(caseVerdict([{ ok: null, severity: "block" }, { ok: false, severity: "block" }]), "block");
  assert.equal(caseVerdict([{ ok: true, severity: "warn" }, { ok: null, severity: "info" }]), "ok");
});

test("una cláusula con su texto cuenta como presente; vacía o negada, como ausente", async () => {
  const { clausePresent } = await import("../lib/contracts/validate");
  assert.equal(clausePresent("El contratista indemnizará a la entidad por todo daño."), true);
  assert.equal(clausePresent(true), true);
  assert.equal(clausePresent("sí"), true);
  assert.equal(clausePresent(null), false);
  assert.equal(clausePresent(""), false);
  assert.equal(clausePresent("No"), false);
  assert.equal(clausePresent("No se encontró la cláusula"), false);
  assert.equal(clausePresent(false), false);
});

test("solo el CFDI de ingreso se procesa como factura", async () => {
  const { cfdiNotInvoiceReason } = await import("../lib/workflow/cfdi-parser");
  assert.equal(cfdiNotInvoiceReason("I"), null);
  assert.equal(cfdiNotInvoiceReason(""), null);
  assert.match(cfdiNotInvoiceReason("E") ?? "", /nota de crédito/);
  assert.match(cfdiNotInvoiceReason("p") ?? "", /pago/);
});

test("importe leído del comprobante: coma decimal y separadores de miles", async () => {
  const { toNumber } = await import("../lib/expense/extract");
  assert.equal(toNumber("45,90"), 45.9);
  assert.equal(toNumber("1.234,56"), 1234.56);
  assert.equal(toNumber("1,234.56"), 1234.56);
  assert.equal(toNumber("1,234"), 1234);
  assert.equal(toNumber("1.234"), 1234);
  assert.equal(toNumber("$ 1.500.000"), 1500000);
  assert.equal(toNumber(1610.5), 1610.5);
  assert.equal(toNumber(1.61), 1.61);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber("-12"), null, "un importe negativo no es válido");
});

test("CFDI: la serie forma parte del número y los atributos llegan sin escapes", async () => {
  const { cfdiInvoiceNumber, parseCfdi } = await import("../lib/workflow/cfdi-parser");
  assert.equal(cfdiInvoiceNumber({ serie: "A", folio: "123", uuid: "ABCDEF12-0000" }), "A-123");
  assert.equal(cfdiInvoiceNumber({ serie: "", folio: "123", uuid: "ABCDEF12-0000" }), "123");
  assert.equal(cfdiInvoiceNumber({ serie: "A", folio: "", uuid: "ABCDEF12-0000" }), "ABCDEF12");
  const cfdi = parseCfdi('<cfdi:Comprobante Serie="B" Folio="7" Total="10"><cfdi:Emisor Rfc="XAXX010101000" Nombre="P&#233;rez &amp; Hijos &quot;SA&quot;"/></cfdi:Comprobante>');
  assert.equal(cfdi.emisorNombre, 'Pérez & Hijos "SA"');
});

test("dos líneas de factura sobre la misma línea de OC se suman", async () => {
  const { buildNsPayload, draftFromReviewBody, mergeLinesOnSamePoLine } = await import("../lib/workflow/ns-payload");
  const line = (po_line: string | null, quantity: number, amount: number | null) => ({ internal_id: "9", item_document_name: "Tornillo", quantity, rate: 2, amount, unit: null, po_line });
  const merged = mergeLinesOnSamePoLine([line("1", 3, 6), line("2", 1, 2), line("1", 2, 5), line(null, 1, 2), line(null, 1, 2)]);
  assert.equal(merged.length, 4);
  assert.deepEqual([merged[0].quantity, merged[0].amount, merged[0].rate], [5, 11, 2.2]);
  const ctx = { organizationId: "o", documentId: 1, documentType: "invoice", nsSubsidiaryId: "1", dryRun: false };
  const draft = { vendorId: "1", vendorName: null, invoiceNumber: "1", invoiceDate: "", dueDate: null, currency: null, locationId: null, poId: null, lines: [line("1", 3, 6), line("1", 2, 5)] };
  assert.equal((buildNsPayload(draft, ctx).line_items as unknown[]).length, 2, "sin OC no se agrupa");
  assert.equal((buildNsPayload({ ...draft, poId: "77" }, ctx).line_items as unknown[]).length, 1);
  assert.equal(draftFromReviewBody({ vendor_internal_id: "1", line_items: [{ internal_id: "9", quantity: "" }] }), "La línea 1 no tiene cantidad");
});

test("plantilla Word: un valor que contiene el texto de otro campo no se vuelve a reemplazar", async () => {
  const { default: PizZip } = await import("pizzip");
  const { fillWordTemplate } = await import("../lib/contracts/word-template");
  const zip = new PizZip();
  zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Contratista</w:t></w:r></w:p><w:p><w:r><w:t>Objeto</w:t></w:r></w:p></w:body></w:document>`);
  const out = fillWordTemplate(zip.generate({ type: "nodebuffer" }), {
    storageKey: "k", originalName: "t.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mappings: [
      { id: "1", anchorText: "Contratista", fieldKey: "contratista", fieldLabel: "Contratista" },
      { id: "2", anchorText: "Objeto", fieldKey: "objeto", fieldLabel: "Objeto" },
    ],
  }, { contratista: "Objeto Social SAS", objeto: "Obra civil" });
  const xml = new PizZip(out).file("word/document.xml")!.asText();
  const text = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
  assert.deepEqual(text, ["Objeto Social SAS", "Obra civil"]);
});

test("PDF desde el editor: tabulaciones, líneas en blanco y caracteres de control no rompen la generación", async () => {
  const { renderHtmlPdf, renderPdf } = await import("../lib/contracts/generate");
  const value = "Línea 1\tcon tab\r\n\r\nLínea 3\u0001\u0081\f fin";
  const html = await renderHtmlPdf("<p>{{x}}</p><ul><li>{{x}}</li></ul>", { x: value }, { title: "Título" });
  assert.deepEqual(html.missing, []);
  assert.ok(html.bytes.length > 0);
  assert.ok((await renderPdf(`x: ${value}`)).length > 0);
});

test("dos líneas del mismo ítem van a líneas distintas de la OC cuando la primera ya se agotó", async () => {
  const { comparePoLines, DEFAULT_PO_MATCH_CONFIG } = await import("../lib/workflow/po-match");
  const { assignPoLines, buildNsPayload } = await import("../lib/workflow/ns-payload");
  const poLine = (line: string, quantity: number, rate: number) => ({ line, item_internal_id: "9", item_name: "Tornillo", quantity, quantity_billed: 0, quantity_received: quantity, rate, amount: quantity * rate, closed: false });
  const po = { internal_id: "77", tranid: "OC-1", lines: [poLine("1", 10, 5), poLine("2", 10, 6)] } as never;
  const inv = (index: number, quantity: number, rate: number) => ({ index, description: "Tornillo", itemId: "9", quantity, rate, amount: quantity * rate });

  const two = comparePoLines([inv(0, 10, 5), inv(1, 10, 6)], po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false });
  assert.deepEqual(two.lines.map((l) => [l.poLine, l.status]), [["1", "match"], ["2", "match"]]);

  // Una sola línea de factura que cubre dos líneas de la OC se reparte entre ambas.
  const one = comparePoLines([inv(0, 15, 5)], po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false });
  assert.deepEqual(one.lines[0].allocations, [{ poLine: "1", quantity: 10 }, { poLine: "2", quantity: 5 }]);
  const draftLine = { internal_id: "9", item_document_name: "Tornillo", quantity: 15, rate: 5, amount: 75.01, unit: null };
  const split = assignPoLines([draftLine], one.lines);
  assert.deepEqual(split.map((l) => [l.po_line, l.quantity, l.amount]), [["1", 10, 50.01], ["2", 5, 25]]);

  // El índice de la comparación puede no ser la posición en el borrador (líneas sin ítem omitidas).
  const shifted = assignPoLines([draftLine], [{ index: 0, poLine: null }, { index: 1, poLine: "2" }], () => 1);
  assert.equal(shifted[0].po_line, "2");

  // Con líneas ligadas a la OC, lo que la factura no cubre va en cero.
  const ctx = { organizationId: "o", documentId: 1, documentType: "invoice", nsSubsidiaryId: "1", dryRun: false };
  const draft = { vendorId: "1", vendorName: null, invoiceNumber: "1", invoiceDate: "", dueDate: null, currency: null, locationId: null, poId: "77", lines: split };
  assert.equal(buildNsPayload(draft, ctx).set_unselected_po_lines_to_zero, true);
  assert.equal(buildNsPayload({ ...draft, poId: null }, ctx).set_unselected_po_lines_to_zero, false);
});

test("los avisos del ERP que cambian lo registrado se informan", async () => {
  const { erpWarnings, erpWarningNote } = await import("../lib/workflow/process-ns");
  const warnings = erpWarnings({ warnings: [{ code: "CURRENCY_NOT_SET", currency: "USD" }, { code: "ADDED_LINE_NOT_IN_PO" }, { code: "CURRENCY_NOT_SET" }] });
  assert.equal(warnings.length, 1);
  assert.match(erpWarningNote(warnings) ?? "", /moneda del proveedor/);
  assert.equal(erpWarningNote(erpWarnings({ ok: true })), null);
});

test("CFDI: un «>» dentro de un atributo no corta el concepto y «OCT2024» no es una OC", async () => {
  const { findPoReference, parseCfdi } = await import("../lib/workflow/cfdi-parser");
  const cfdi = parseCfdi(`<cfdi:Comprobante Folio="7" Total="116"><cfdi:Conceptos><cfdi:Concepto Descripcion="TUBO > 2 PULG" Cantidad='2' ValorUnitario="50" Importe="100"/></cfdi:Conceptos></cfdi:Comprobante>`);
  assert.deepEqual(cfdi.lineas.map((l) => [l.descripcion, l.cantidad, l.importe]), [["TUBO > 2 PULG", 2, 100]]);
  assert.equal(findPoReference('<x Descripcion="SERVICIO OCT2024"/>'), "");
  assert.equal(findPoReference('<x Descripcion="CAJA POS-1234"/>'), "");
  assert.equal(findPoReference('<x CondicionesDePago="OC 1043"/>'), "1043");
  assert.equal(findPoReference('<x Descripcion="Orden de compra: ABC-778"/>'), "ABC-778");
});

test("un número con 429 o 503 dentro no es un error del servicio de lectura", async () => {
  const { friendlyError } = await import("../lib/ap/friendly-error");
  const dup = "Factura duplicada: ACME #INV-14290 ya existe (doc #87)";
  assert.equal(friendlyError(dup), dup);
  assert.match(friendlyError('429 {"type":"error","error":{"type":"rate_limit_error"}}') ?? "", /servicio de lectura/);
  assert.match(friendlyError("HTTP 503: Service Unavailable") ?? "", /ERP no respondió/);
  assert.match(friendlyError("HTTP 401: Invalid login attempt") ?? "", /credenciales del ERP/);
  const exists = "Ya existe en el ERP un registro de este proveedor con el número 401 (id 403); no se creó otro.";
  assert.equal(friendlyError(exists), exists);
});

test("con «solo avisar», una diferencia con la OC llega a una persona", async () => {
  const { comparePoLines, poOutcome, DEFAULT_PO_MATCH_CONFIG } = await import("../lib/workflow/po-match");
  const po = { internal_id: "77", tranid: "OC-1", lines: [{ line: "1", item_internal_id: "9", item_name: "Tornillo", quantity: 10, quantity_billed: 0, quantity_received: 10, rate: 5, amount: 50, closed: false }] } as never;
  const cmp = comparePoLines([{ index: 0, description: "Tornillo", itemId: "9", quantity: 10, rate: 6, amount: 60 }], po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false });
  assert.equal(poOutcome(cmp, { onMismatch: "warn", extraLines: "warn" }).kind, "needs_review");
  assert.equal(poOutcome(cmp, { onMismatch: "approval", extraLines: "warn" }).kind, "needs_approval");
  const same = comparePoLines([{ index: 0, description: "Tornillo", itemId: "9", quantity: 10, rate: 5, amount: 50 }], po, DEFAULT_PO_MATCH_CONFIG, { requireReceipt: false });
  assert.equal(poOutcome(same, { onMismatch: "warn", extraLines: "warn" }).kind, "ok");
});

test("las correcciones se cuentan por línea aunque una línea leída no se envíe", async () => {
  const { reviewCorrections } = await import("../lib/workflow/review-corrections");
  const read = (description: string, quantity: number) => ({ description, selected_item_id: "1", quantity, rate: 2, amount: quantity * 2 });
  const sent = (item_document_name: string, quantity: number) => ({ internal_id: "1", item_document_name, quantity, rate: 2, amount: quantity * 2, unit: null });
  const payload = { document: { vendor: { selected_internal_id: "5" }, invoice_number: "1", invoice_date: "2026-01-01", lines: [read("A", 1), read("Flete", 9), read("B", 3)] } };
  const draft = { vendorId: "5", vendorName: null, invoiceNumber: "1", invoiceDate: "2026-01-01", dueDate: null, currency: null, locationId: null, poId: null, lines: [sent("A", 1), sent("B", 3)] };
  assert.deepEqual(reviewCorrections(payload, draft), { line_count: 1 });
});

test("el día, la semana y el mes empiezan en la zona del cliente, no en UTC", async () => {
  const { startOfDayIn, startOfWeekIn, startOfMonthIn, weekdayIn, safeTimeZone } = await import("../lib/time-zone");
  const tz = "America/Mexico_City"; // UTC−6, sin horario de verano
  // Jueves 12 nov 2026, 18:30 en Ciudad de México = viernes 13 a las 00:30 UTC.
  const now = new Date("2026-11-13T00:30:00.000Z");
  assert.equal(startOfDayIn(tz, now).toISOString(), "2026-11-12T06:00:00.000Z");
  assert.equal(weekdayIn(tz, now), 3);
  assert.equal(startOfWeekIn(tz, now).toISOString(), "2026-11-09T06:00:00.000Z");
  assert.equal(startOfMonthIn(tz, now).toISOString(), "2026-11-01T06:00:00.000Z");
  // Con cambio de hora (Nueva York pasa de UTC−4 a UTC−5 el 1 de noviembre).
  assert.equal(startOfMonthIn("America/New_York", new Date("2026-11-20T15:00:00.000Z")).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(safeTimeZone("No/Existe"), "America/Mexico_City");
  assert.equal(safeTimeZone("America/Bogota"), "America/Bogota");

  const { periodRange } = await import("../lib/stats/ap-stats");
  const range = periodRange("month", now, tz);
  assert.equal(range.from.toISOString(), "2026-11-01T06:00:00.000Z");
  assert.equal(range.prevFrom.toISOString(), "2026-10-01T06:00:00.000Z");
  assert.match(range.label, /noviembre.*2026/);
});

test("una línea sin precio ni importe no se envía al ERP", async () => {
  const { draftFromReviewBody } = await import("../lib/workflow/ns-payload");
  const body = (line: Record<string, unknown>) => ({ vendor_internal_id: "1", line_items: [{ internal_id: "9", quantity: 1, ...line }] });
  assert.equal(draftFromReviewBody(body({})), "La línea 1 no tiene precio ni importe");
  assert.equal(typeof draftFromReviewBody(body({ rate: 5 })), "object");
  assert.equal(typeof draftFromReviewBody(body({ amount: 5 })), "object");
});

test("contratos: quien está nombrado en un paso lo firma antes que el paso abierto", async () => {
  const { checkApproval } = await import("../lib/contracts/approval-rules");
  const steps = [
    { key: "base", label: "Siempre", approvers: { mode: "any" as const, userIds: [] } },
    { key: "cond_0", label: "valor > 100", approvers: { mode: "users" as const, userIds: ["gerente"] } },
  ];
  const base = { steps, creatorId: null, noSelfApproval: false, blocked: false, exceptionUserIds: [] };
  const first = checkApproval({ ...base, done: [], actor: { id: "gerente", canApprove: true } });
  assert.equal(first.ok && first.step.key, "cond_0");
  const second = checkApproval({ ...base, done: [{ stepKey: "cond_0", byId: "gerente", byEmail: null, at: "", reason: null }], actor: { id: "analista", canApprove: true } });
  assert.equal(second.ok && second.step.key, "base");
  assert.equal(second.ok && second.last, true);
});

test("contratos: un texto con dos cifras no es un número, y un nombre parecido no es el mismo", async () => {
  const { normalizeContractNumber, textValuesMatch, compareContractValues } = await import("../lib/contracts/normalization");
  assert.equal(normalizeContractNumber("$58.833.600"), 58833600);
  assert.equal(normalizeContractNumber("USD 1.500.000,50"), 1500000.5);
  assert.equal(normalizeContractNumber("1 500 000"), 1500000);
  assert.equal(normalizeContractNumber("$58.833.600 más IVA 19%"), null);
  assert.equal(normalizeContractNumber("24 meses (2 años)"), null);
  assert.equal(normalizeContractNumber(1200.5), 1200.5);

  assert.equal(textValuesMatch("María José Pérez", "María José Soto"), false);
  assert.equal(textValuesMatch("CT-12", "CT-123"), false);
  assert.equal(textValuesMatch("Juan Pérez", "PEREZ GÓMEZ, JUAN"), true);
  assert.equal(textValuesMatch("Ecopetrol", "Ecopetrol S.A."), true);
  assert.equal(textValuesMatch("ACME", "ACME SAS"), true);
  assert.equal(textValuesMatch("ACME", "ACME Logística SAS"), false);

  const amounts = { left: "$ 1.000.000,00", right: "1.000.000", leftField: "valor_bruto", rightField: "valor_bruto" };
  assert.equal(compareContractValues(amounts), true, "valor_bruto es un monto, no un identificador");
  assert.equal(compareContractValues({ left: "1500", right: "1501", leftField: "precio_unitario", rightField: "precio_unitario", numericTolerance: 5 }), true);
  assert.equal(compareContractValues({ left: "860.505.064-1", right: "8605050641", leftField: "nit_contratista", rightField: "nit" }), true);
  assert.equal(compareContractValues({ left: "860.505.064-1", right: "8605050641", leftField: "nitContratista", rightField: "rut" }), true);
});

test("contratos: la revocación escrita como frase se reconoce", async () => {
  const { revocationStated } = await import("../lib/contracts/validate");
  assert.equal(revocationStated("Sí, revocado el 12/03/2024"), true);
  assert.equal(revocationStated("Revocado parcialmente"), true);
  assert.equal(revocationStated(true), true);
  assert.equal(revocationStated("No"), false);
  assert.equal(revocationStated("No ha sido revocado"), false);
  assert.equal(revocationStated("Vigente, sin revocaciones"), false);
  assert.equal(revocationStated(null), false);
  assert.equal(revocationStated("Ver anotación al margen"), null);
});

test("contratos: fechas escritas de otras formas y cláusulas negadas con punto", async () => {
  const { normalizeContractDate } = await import("../lib/contracts/normalization");
  assert.equal(normalizeContractDate("16 de mayo del 2025"), "2025-05-16");
  assert.equal(normalizeContractDate("1° de marzo de 2025."), "2025-03-01");
  assert.equal(normalizeContractDate("2025-05-16T00:00:00"), "2025-05-16");
  assert.equal(normalizeContractDate("16/05/2025"), "2025-05-16");
  const { clausePresent } = await import("../lib/contracts/validate");
  assert.equal(clausePresent("No aplica."), false);
  assert.equal(clausePresent("No."), false);
  assert.equal(clausePresent("No pactada"), false);
  assert.equal(clausePresent("No competencia: el contratista se obliga a no prestar servicios a terceros."), true);
});

test("la hora del cliente se expresa como fecha local del proceso", async () => {
  const { wallClockIn } = await import("../lib/time-zone");
  // 13 nov 00:30 UTC es todavía 12 nov a las 18:30 en Ciudad de México.
  const local = wallClockIn("America/Mexico_City", new Date("2026-11-13T00:30:00.000Z"));
  assert.deepEqual([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()], [2026, 10, 12, 18]);
});

test("contratos: la etapa de aprobación se revisa al guardar el flujo", async () => {
  const { validateFlowReferences } = await import("../lib/contracts/flow");
  const approval = (data: Record<string, unknown>) => ({
    nodes: [
      { id: "i", kind: "intake", position: { x: 0, y: 0 }, data: { docTypeKey: "contrato" } },
      { id: "e", kind: "extract", position: { x: 0, y: 0 }, data: { docTypeKey: "contrato", fields: [{ fieldKey: "valor" }] } },
      { id: "a", kind: "approval", position: { x: 0, y: 0 }, data: { name: "Aprobación", base: { mode: "any", userIds: [] }, conditions: [], exceptionUserIds: [], ...data } },
    ],
    edges: [],
  }) as never;
  assert.equal(validateFlowReferences(approval({})), null);
  assert.match(validateFlowReferences(approval({ base: { mode: "users", userIds: [] } })) ?? "", /no hay ninguna marcada/);
  const condition = (field: string) => ({ label: "", docType: "contrato", field, op: "gt", value: 100, approvers: { mode: "users", userIds: ["u1"] } });
  assert.equal(validateFlowReferences(approval({ conditions: [condition("valor")] })), null);
  assert.match(validateFlowReferences(approval({ conditions: [condition("valor_total")] })) ?? "", /valor_total/);
});

test("gastos: lo que la empresa paga a un proveedor es factura de proveedor", async () => {
  const { expenseRecordType, defaultExpenseCurrency } = await import("../lib/expense/item-input");
  assert.equal(expenseRecordType("company_pays_vendor", "unknown", false), "vendor_bill");
  assert.equal(expenseRecordType("company_pays_vendor", "documento_equivalente", false), "vendor_bill");
  assert.equal(expenseRecordType("company_pays_vendor", "invoice", false), "vendor_bill");
  assert.equal(expenseRecordType("company_pays_vendor", "receipt", true), "vendor_bill");
  assert.equal(expenseRecordType("company_pays_vendor", "receipt", false), "expense_report");
  assert.equal(expenseRecordType("employee_paid", "invoice", false), "expense_report");
  assert.equal(defaultExpenseCurrency("MX"), "MXN");
  assert.equal(defaultExpenseCurrency("CO"), "COP");
  assert.equal(defaultExpenseCurrency(null), "COP");
});

test("gastos: el informe se revisa con las reglas de la sincronización antes de enviarse", async () => {
  const { expenseItemProblems } = await import("../lib/expense/sync-precheck");
  const category = { netsuiteCategoryId: "5", netsuiteAccountId: "60" };
  const line = (patch: Record<string, unknown>) => ({ lineNumber: 1, nsRecordType: "expense_report", currency: "COP", vendorNit: null, invoiceNumber: null, needsDocumentoEquivalente: false, invoiceDate: new Date("2026-03-05"), expenseDate: null, category, ...patch });
  assert.deepEqual(expenseItemProblems([line({})]), []);
  assert.match(expenseItemProblems([line({ category: null })])[0], /sin categoría/);
  assert.match(expenseItemProblems([line({}), line({ lineNumber: 2, currency: "USD" })])[0], /mezcla monedas/);
  const bill = expenseItemProblems([line({ nsRecordType: "vendor_bill" })]);
  assert.equal(bill.length, 2);
  assert.deepEqual(expenseItemProblems([line({ nsRecordType: "vendor_bill", vendorNit: "900123456", needsDocumentoEquivalente: true })]), []);
  // Una factura de proveedor necesita su fecha; un gasto personal no.
  assert.match(expenseItemProblems([line({ nsRecordType: "vendor_bill", vendorNit: "900123456", needsDocumentoEquivalente: true, invoiceDate: null })])[0], /falta la fecha/);
  assert.deepEqual(expenseItemProblems([line({ invoiceDate: null })]), []);
});

test("gastos: los importes conservan centavos en las monedas que los usan", async () => {
  const { formatExpenseAmount } = await import("../lib/expense/totals");
  assert.match(formatExpenseAmount(120000, "COP"), /120\.000$/);
  assert.match(formatExpenseAmount(45.5, "USD"), /45,50/);
  assert.doesNotMatch(formatExpenseAmount(45, "USD"), /,00/);
});

test("plantilla Word: un código de campo partido en dos corridas se detecta, y un enlace normal no", async () => {
  const { hasDangerousField, fieldInstructions } = await import("../lib/security/docx");
  const field = (...runs: string[]) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r>${runs.map((r) => `<w:r><w:instrText xml:space="preserve">${r}</w:instrText></w:r>`).join("")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  assert.equal(hasDangerousField(field("INCLUDE", 'PICTURE "http://169.254.169.254/x"')), true);
  assert.equal(hasDangerousField(field(' INCLUDETEXT "c:\\\\x.txt"')), true);
  assert.equal(hasDangerousField(field("&#73;NCLUDEPICTURE x")), true);
  assert.equal(hasDangerousField(field(' HYPERLINK "https://acme.com/link"')), false);
  assert.equal(hasDangerousField(field(" PAGE ") + field(" DATE ")), false);
  assert.equal(hasDangerousField('<w:fldSimple w:instr=" DDEAUTO cmd x "/>'), true);
  // Dos campos seguidos no se pegan entre sí.
  assert.deepEqual(fieldInstructions(field(" PAGE IN") + field("CLUDEPICTURE")), [" PAGE IN", "CLUDEPICTURE"]);
});

test("webhooks: solo se bloquean los rangos reservados, no redes públicas vecinas", async () => {
  const { isPrivateIp } = await import("../lib/webhooks/ssrf");
  for (const ip of ["10.1.2.3", "169.254.169.254", "192.168.1.1", "192.0.2.10", "198.51.100.7", "203.0.113.9", "127.0.0.1"]) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ["192.0.66.20", "198.51.45.1", "203.0.178.191", "8.8.8.8"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("gastos: importes y fecha tal como los escribió el modelo", async () => {
  const { amountFromAnswer, toIsoDate } = await import("../lib/expense/extract");
  // JSON.parse ya habría convertido 12.500 en 12.5.
  const answer = '{"subtotal": 12.500, "tax_amount": "1.995,00", "total": 14495, "retention_amount": null}';
  const raw = JSON.parse(answer) as Record<string, unknown>;
  assert.equal(amountFromAnswer(answer, raw, "subtotal"), 12500);
  assert.equal(amountFromAnswer(answer, raw, "tax_amount"), 1995);
  assert.equal(amountFromAnswer(answer, raw, "total"), 14495);
  assert.equal(amountFromAnswer(answer, raw, "retention_amount"), null);
  assert.equal(amountFromAnswer('{"total": 45.9}', { total: 45.9 }, "total"), 45.9);
  assert.equal(toIsoDate("2026-03-05"), "2026-03-05");
  assert.equal(toIsoDate("05/03/2026"), "2026-03-05");
  assert.equal(toIsoDate("5 de marzo de 2026"), null);
  assert.equal(toIsoDate("31/02/2026"), null);
});

test("gastos: un NIT sin dígito de verificación no es inválido; con dígito, debe coincidir", async () => {
  const { validateNitColombia, validateExpenseAmounts } = await import("../lib/expense/tax-engine");
  assert.equal(validateNitColombia("900123456"), true);
  assert.equal(validateNitColombia("800197268-4"), true);
  assert.equal(validateNitColombia("800197268-5"), false);
  assert.equal(validateNitColombia("123"), false);
  assert.equal(validateExpenseAmounts({ subtotal: 1e13, taxAmount: 0, retentionAmount: 0, total: 1e13 }).ok, false);
});

test("zona horaria: el día del cliente, no el del servidor", async () => {
  const { dayIn } = await import("../lib/time-zone");
  // 01:30 UTC del 6 de marzo todavía es 5 de marzo en Bogotá.
  assert.equal(dayIn("America/Bogota", new Date("2026-03-06T01:30:00Z")), "2026-03-05");
  assert.equal(dayIn("UTC", new Date("2026-03-06T01:30:00Z")), "2026-03-06");
});

test("contratos: el texto bajo una zona marcada, en orden de lectura", async () => {
  const { wordsInArea } = await import("../lib/contracts/pdf-words");
  const word = (text: string, x1: number, y1: number) => ({ text, x1, x2: x1 + 0.05, y1, y2: y1 + 0.02 });
  const words = [word("Bogotá", 0.30, 0.200), word("NIT", 0.10, 0.201), word("900.123.456-7", 0.17, 0.199), word("Fecha", 0.10, 0.25), word("fuera", 0.80, 0.20)];
  assert.equal(wordsInArea(words, { x: 0.05, y: 0.18, width: 0.4, height: 0.1 }), "NIT 900.123.456-7 Bogotá Fecha");
  assert.equal(wordsInArea(words, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }), "");
});

test("lista de IP permitidas: IPv4 mapeada en IPv6 y rangos IPv6", async () => {
  const { isAllowedIp } = await import("../lib/security/ip-allowlist");
  assert.equal(isAllowedIp("::ffff:203.0.113.10", ["203.0.113.0/24"]), true);
  assert.equal(isAllowedIp("203.0.113.10", ["::ffff:203.0.113.10"]), true);
  assert.equal(isAllowedIp("2001:db8:0:1::25", ["2001:db8::/48"]), true);
  assert.equal(isAllowedIp("2001:db9::1", ["2001:db8::/48"]), false);
  assert.equal(isAllowedIp("2001:0db8:0000:0000:0000:0000:0000:0001", ["2001:db8::1"]), true);
  assert.equal(isAllowedIp("198.51.100.7", ["203.0.113.0/24", "2001:db8::/48"]), false);
  // Una entrada sin prefijo no abre todo.
  assert.equal(isAllowedIp("198.51.100.7", ["203.0.113.0/"]), false);
});

test("números: negativos contables, sin volver negativo un número entre paréntesis de un contrato", async () => {
  const { parseLocaleNumber } = await import("../lib/numbers");
  assert.equal(parseLocaleNumber("1.500,00-"), -1500);
  assert.equal(parseLocaleNumber("(1,500.00)"), -1500);
  assert.equal(parseLocaleNumber("($ 200)"), -200);
  assert.equal(parseLocaleNumber("(30)"), 30);
  assert.equal(parseLocaleNumber("-45,90"), -45.9);
  assert.equal(parseLocaleNumber("150.000"), 150000);
});

test("modo QA: el último día termina a la medianoche del cliente", async () => {
  const { qaModeActive } = await import("../lib/features/qa-mode");
  const config = { expires_on: "2026-11-20" };
  // 20 nov, 18:05 en Ciudad de México = 21 nov 00:05 UTC.
  const evening = new Date("2026-11-21T00:05:00Z");
  assert.equal(qaModeActive(true, config, "sandbox", evening, "America/Mexico_City"), true);
  assert.equal(qaModeActive(true, config, "sandbox", evening), false);
  assert.equal(qaModeActive(true, config, "sandbox", new Date("2026-11-21T06:05:00Z"), "America/Mexico_City"), false);
});

test("visor de PDF: el worker servido es el de la versión instalada de pdf.js", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const installed = "node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
  if (!existsSync(installed)) return;
  const sha = (path: string) => createHash("sha1").update(readFileSync(path)).digest("hex");
  assert.equal(sha("public/pdf.worker.min.mjs"), sha(installed), "ejecuta `npm run sync:pdf-worker`");
});

test("IA: una imagen pesada se reduce antes de enviarla; una ligera va tal cual", async () => {
  const { fitImages } = await import("../lib/ai/image-fit");
  let sharp: (typeof import("sharp"))["default"];
  try { sharp = (await import("sharp")).default; } catch { return; }
  // Ruido: no se comprime, así que el PNG sale pesado como una foto real.
  const side = 2200;
  const noise = Buffer.alloc(side * side * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24;
  const heavy = await sharp(noise, { raw: { width: side, height: side, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(heavy.length > 5 * 1024 * 1024);
  const light = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#fff" } }).png().toBuffer();
  const request = { model: "claude-haiku-5-5", instruction: "x", parts: [
    { kind: "file" as const, base64: heavy.toString("base64"), mimeType: "image/png" },
    { kind: "file" as const, base64: light.toString("base64"), mimeType: "image/png" },
    { kind: "text" as const, text: "nota" },
  ] };
  const fitted = await fitImages(request);
  const [first, second] = fitted.parts as Array<{ kind: "file"; base64: string; mimeType: string }>;
  assert.equal(first.mimeType, "image/jpeg");
  assert.ok(first.base64.length * 0.75 < 5 * 1024 * 1024, "queda por debajo de lo que acepta el modelo");
  assert.equal(second.base64, request.parts[1].kind === "file" ? request.parts[1].base64 : "");
  assert.deepEqual(fitted.parts[2], request.parts[2]);
});

test("SAT: el & de un RFC se escribe &amp; dentro de la expresión", async () => {
  const { satExpression } = await import("../lib/cfdi/sat");
  assert.equal(satExpression({ emisorRfc: "A&B010101AB1", receptorRfc: "ANO010203AB4", total: 100, uuid: "abc" }), "?re=A&amp;B010101AB1&rr=ANO010203AB4&tt=100.00&id=ABC");
});

test("OC: con «Aplicar factura a líneas de PO» apagado la factura va sola y la OC queda de referencia", async () => {
  const { buildNsPayload } = await import("../lib/workflow/ns-payload");
  const draft = {
    vendorId: "17", vendorName: "Proveedor", invoiceNumber: "F-1", invoiceDate: "2026-11-20", dueDate: null, currency: "MXN", locationId: null, poId: "900",
    lines: [{ internal_id: "5", item_document_name: "Tornillo", quantity: 10, rate: 2, amount: 20, unit: null, po_line: "3" }],
  };
  const ctx = { organizationId: "org", documentId: 1, documentType: "invoice", nsSubsidiaryId: "7", dryRun: false };
  const on = buildNsPayload(draft, { ...ctx, poConfig: { apply_to_po_lines: true } });
  assert.equal(on.po_internal_id, "900");
  assert.equal(on.set_unselected_po_lines_to_zero, true);
  assert.equal((on.line_items as Array<{ po_line: string | null }>)[0].po_line, "3");
  assert.equal(on.memo, undefined);
  const off = buildNsPayload(draft, { ...ctx, poConfig: { apply_to_po_lines: false, set_unselected_po_lines_to_zero: true } });
  assert.equal(off.po_internal_id, null);
  assert.equal(off.apply_to_po_lines, false);
  assert.equal(off.set_unselected_po_lines_to_zero, false);
  assert.equal((off.line_items as Array<{ po_line: string | null }>)[0].po_line, null);
  assert.match(String(off.memo), /900/);
  // Sin configuración se comporta como hasta ahora.
  assert.equal(buildNsPayload(draft, ctx).po_internal_id, "900");
});

test("totales por moneda: nunca se suman monedas distintas", async () => {
  const { amountsByCurrency } = await import("../lib/stats/doc-currency");
  assert.deepEqual(amountsByCurrency([{ currency: "MXN", amount: 100 }, { currency: "USD", amount: 45 }, { currency: "MXN", amount: "50.5" }, { currency: "EUR", amount: 0 }]),
    [{ currency: "MXN", amount: 150.5 }, { currency: "USD", amount: 45 }]);
  assert.deepEqual(amountsByCurrency([]), []);
});

test("acceso: el motivo real cuando la empresa no puede entrar", async () => {
  const { orgBlockMessage } = await import("../lib/auth/org-block");
  const now = new Date("2026-11-23T12:00:00Z");
  assert.equal(orgBlockMessage({ status: "active", trialEndsAt: null }, now), null);
  assert.equal(orgBlockMessage({ status: "trial", trialEndsAt: null }, now), null);
  assert.equal(orgBlockMessage({ status: "trial", trialEndsAt: new Date("2026-12-01T00:00:00Z") }, now), null);
  assert.match(orgBlockMessage({ status: "trial", trialEndsAt: new Date("2026-11-01T00:00:00Z") }, now) ?? "", /periodo de prueba/);
  assert.match(orgBlockMessage({ status: "suspended", trialEndsAt: null }, now) ?? "", /suspendida/);
  assert.match(orgBlockMessage({ status: "active", trialEndsAt: null, deletedAt: now }, now) ?? "", /ya no está disponible/);
  assert.match(orgBlockMessage(null, now) ?? "", /ya no está disponible/);
});
