/**
 * DocuIA — Process Documents RESTlet v1
 *
 * Creates Vendor Bills (from PO transform or standalone) and Purchase Orders
 * in NetSuite via TBA OAuth 1.0a.
 *
 * POST body params:
 *   document_type:                 "invoice" | "purchase_order" (default: "invoice")
 *   vendor_internal_id:            required
 *   subsidiary_internal_id:        recommended
 *   invoice_number:                required
 *   invoice_date:                  required — YYYY-MM-DD | DD/MM/YYYY | DD.MM.YYYY
 *   lines:                         array of line objects
 *   po_internal_id:                optional — if set, transforms PO → Vendor Bill
 *   dry_run:                       true/false (default true) — validate without saving
 *   location_internal_id:          optional
 *   currency_internal_id:          optional
 *   apply_to_po_lines:             true/false (default true)
 *   set_unselected_po_lines_to_zero: true/false (default false) — zero qty/amount on PO lines not matched by DocuIA
 *   allow_additional_lines:        true/false (default true)
 *
 * Line object:
 *   item_internal_id: required
 *   quantity:         number
 *   rate:             number
 *   amount:           number
 *   unit:             string (unit internal id)
 *   description:      string
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/search", "N/format"], (record, search, format) => {

  function s(v) { return v == null ? "" : String(v).trim(); }
  function n(v) { if (v == null || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; }
  function b(v, def) {
    if (v === true || v === false) return v;
    const r = s(v).toLowerCase();
    if (!r) return def;
    if (["1", "true", "yes", "on"].includes(r)) return true;
    if (["0", "false", "no", "off"].includes(r)) return false;
    return def;
  }

  function parseDate(raw) {
    const v = s(raw);
    if (!v) return null;
    const dot   = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dot)   return new Date(Number(dot[3]), Number(dot[2]) - 1, Number(dot[1]));
    const slash = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash) return new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
    const iso   = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso)   return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    try { return format.parse({ value: v, type: format.Type.DATE }); } catch (e) { return null; }
  }

  function trySet(rec, fieldId, value) {
    try { rec.setValue({ fieldId, value }); return true; } catch (e) { return false; }
  }
  function tryCurrent(rec, sub, fieldId, value) {
    try { rec.setCurrentSublistValue({ sublistId: sub, fieldId, value }); return true; } catch (e) { return false; }
  }
  function tryGetSub(rec, sub, fieldId, line) {
    try { return rec.getSublistValue({ sublistId: sub, fieldId, line }); } catch (e) { return null; }
  }

  function setUnit(rec, unit, warnings, itemId) {
    if (!s(unit)) return false;
    const ok = tryCurrent(rec, "item", "units", unit)
            || tryCurrent(rec, "item", "unit", unit)
            || tryCurrent(rec, "item", "uom", unit);
    if (!ok) warnings.push({ code: "UNIT_NOT_SET", item_internal_id: itemId });
    return ok;
  }

  function repairRate(rec, lineIdx, ln, warnings) {
    const rate = n(ln && ln.rate);
    if (rate === null || rate <= 0) return;
    const persisted = n(tryGetSub(rec, "item", "rate", lineIdx));
    if (persisted !== null && persisted !== 0) return;
    warnings.push({
      code: "RATE_NOT_APPLIED",
      message: "Rate was provided but NetSuite persisted 0.",
      item_internal_id: s(ln && ln.item_internal_id),
      input_rate: rate,
    });
  }

  function findDuplicate(typeCode, vendorId, tranId, subsidiaryId) {
    const filters = [
      ["type", "anyof", typeCode], "AND",
      ["mainline", "is", "T"], "AND",
      ["entity", "anyof", String(vendorId)], "AND",
      ["tranid", "is", String(tranId)],
    ];
    if (subsidiaryId) filters.push("AND", ["subsidiary", "anyof", String(subsidiaryId)]);
    const rows = search.create({ type: search.Type.TRANSACTION, filters, columns: ["internalid"] })
      .run().getRange({ start: 0, end: 1 });
    return rows && rows.length ? s(rows[0].getValue("internalid")) : null;
  }

  function applyHeader(rec, body, docNumber, docDate, warnings) {
    const customForm = n(body.customform);
    if (customForm !== null) trySet(rec, "customform", customForm);

    const vendorId = s(body.vendor_internal_id);
    if (vendorId) rec.setValue({ fieldId: "entity", value: vendorId });

    rec.setValue({ fieldId: "tranid",   value: docNumber });
    rec.setValue({ fieldId: "trandate", value: docDate });

    const subId = s(body.subsidiary_internal_id);
    if (subId) trySet(rec, "subsidiary", subId);

    const locId = s(body.location_internal_id);
    if (locId) trySet(rec, "location", locId);

    const currency = s(body.currency_internal_id);
    if (currency) {
      const ok = trySet(rec, "currency", currency);
      if (!ok) warnings.push({ code: "CURRENCY_NOT_SET" });
    }

    const memo = s(body.memo);
    if (memo) trySet(rec, "memo", memo);
  }

  function applyLinesStandalone(rec, lines, warnings) {
    for (const ln of lines) {
      const itemId = s(ln.item_internal_id);
      if (!itemId) {
        warnings.push({ code: "LINE_SKIPPED_NO_ITEM" });
        continue;
      }
      rec.selectNewLine({ sublistId: "item" });
      rec.setCurrentSublistValue({ sublistId: "item", fieldId: "item", value: itemId });

      const loc = s(ln.location);
      if (loc) tryCurrent(rec, "item", "location", loc);
      setUnit(rec, s(ln.unit), warnings, itemId);

      const qty = n(ln.quantity);
      if (qty !== null) tryCurrent(rec, "item", "quantity", qty);
      const rate = n(ln.rate);
      if (rate !== null) tryCurrent(rec, "item", "rate", rate);
      const amt = n(ln.amount);
      if (amt !== null) tryCurrent(rec, "item", "amount", amt);
      const desc = s(ln.description);
      if (desc) tryCurrent(rec, "item", "description", desc);

      rec.commitLine({ sublistId: "item" });

      const lineIdx = rec.getLineCount({ sublistId: "item" }) - 1;
      repairRate(rec, lineIdx, ln, warnings);
    }
  }

  function applyLinesTransform(rec, lines, opts, warnings) {
    const count = rec.getLineCount({ sublistId: "item" });
    const byItem = {};
    const byPoLine = {};
    for (let i = 0; i < count; i++) {
      const itemId = s(tryGetSub(rec, "item", "item", i));
      const poLine = s(tryGetSub(rec, "item", "line", i));
      if (itemId) { if (!byItem[itemId]) byItem[itemId] = []; byItem[itemId].push(i); }
      if (poLine) byPoLine[poLine] = i;
    }
    const used = new Set();

    for (const ln of lines) {
      const itemId = s(ln.item_internal_id);
      const poLine = s(ln.po_line);
      let match = null;

      if (poLine && byPoLine[poLine] !== undefined) match = byPoLine[poLine];
      else if (itemId && byItem[itemId]) {
        for (const idx of byItem[itemId]) { if (!used.has(idx)) { match = idx; break; } }
      }

      if (match !== null) {
        rec.selectLine({ sublistId: "item", line: match });
        setUnit(rec, s(ln.unit), warnings, itemId);
        const qty = n(ln.quantity); if (qty !== null) tryCurrent(rec, "item", "quantity", qty);
        const rate = n(ln.rate);   if (rate !== null) tryCurrent(rec, "item", "rate", rate);
        const amt = n(ln.amount);  if (amt !== null)  tryCurrent(rec, "item", "amount", amt);
        const desc = s(ln.description); if (desc) tryCurrent(rec, "item", "description", desc);
        rec.commitLine({ sublistId: "item" });
        repairRate(rec, match, ln, warnings);
        used.add(match);
        continue;
      }

      if (opts.allow_additional_lines && itemId) {
        rec.selectNewLine({ sublistId: "item" });
        rec.setCurrentSublistValue({ sublistId: "item", fieldId: "item", value: itemId });
        setUnit(rec, s(ln.unit), warnings, itemId);
        const qty = n(ln.quantity); if (qty !== null) tryCurrent(rec, "item", "quantity", qty);
        const rate = n(ln.rate);   if (rate !== null) tryCurrent(rec, "item", "rate", rate);
        const amt = n(ln.amount);  if (amt !== null)  tryCurrent(rec, "item", "amount", amt);
        const desc = s(ln.description); if (desc) tryCurrent(rec, "item", "description", desc);
        rec.commitLine({ sublistId: "item" });
        warnings.push({ code: "ADDED_LINE_NOT_IN_PO", item_internal_id: itemId });
      } else {
        warnings.push({ code: "NO_MATCHED_PO_LINE", item_internal_id: itemId || null });
      }
    }

    // Zero out PO lines that DocuIA did not match (client config: set_unselected_po_lines_to_zero)
    if (opts.set_unselected_po_lines_to_zero) {
      for (let i = 0; i < count; i++) {
        if (!used.has(i)) {
          rec.selectLine({ sublistId: "item", line: i });
          tryCurrent(rec, "item", "quantity", 0);
          tryCurrent(rec, "item", "amount", 0);
          rec.commitLine({ sublistId: "item" });
        }
      }
    }
  }

  function createVendorBill(body, warnings) {
    const vendorId  = s(body.vendor_internal_id);
    const subId     = s(body.subsidiary_internal_id) || null;
    const poId      = s(body.po_internal_id) || null;
    const invNumber = s(body.invoice_number || body.invoiceNumber);
    const invDate   = parseDate(body.invoice_date || body.invoiceDate);
    const lines     = Array.isArray(body.lines) ? body.lines : [];
    const dryRun    = b(body.dry_run, true);

    if (!vendorId)  return { ok: false, error: "vendor_internal_id is required" };
    if (!invNumber) return { ok: false, error: "invoice_number is required" };
    if (!invDate)   return { ok: false, error: "invoice_date is required (YYYY-MM-DD)" };

    const existing = findDuplicate("VendBill", vendorId, invNumber, subId);
    if (existing) return { ok: true, dry_run: dryRun, already_exists: true, mode: poId ? "transform" : "standalone", vendor_bill_internal_id: existing, warnings };

    const mode = poId ? "transform" : "standalone";
    const rec  = poId
      ? record.transform({ fromType: record.Type.PURCHASE_ORDER, fromId: poId, toType: record.Type.VENDOR_BILL, isDynamic: true })
      : record.create({ type: record.Type.VENDOR_BILL, isDynamic: true });

    applyHeader(rec, body, invNumber, invDate, warnings);

    if (lines.length) {
      if (mode === "standalone") {
        applyLinesStandalone(rec, lines, warnings);
      } else {
        applyLinesTransform(rec, lines, {
          apply_to_po_lines:             b(body.apply_to_po_lines, true),
          set_unselected_po_lines_to_zero: b(body.set_unselected_po_lines_to_zero, false),
          allow_additional_lines:        b(body.allow_additional_lines, true),
        }, warnings);
      }
    } else {
      warnings.push({ code: "NO_LINES", message: "No lines provided." });
    }

    if (dryRun) return { ok: true, dry_run: true, mode, would_create: "vendor_bill", preview: { vendor_internal_id: vendorId, invoice_number: invNumber, lines_count: lines.length }, warnings };

    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return { ok: true, dry_run: false, mode, vendor_bill_internal_id: String(id), warnings };
  }

  function createPurchaseOrder(body, warnings) {
    const vendorId = s(body.vendor_internal_id);
    const subId    = s(body.subsidiary_internal_id) || null;
    const docNum   = s(body.invoice_number || body.document_number || body.tranid);
    const docDate  = parseDate(body.invoice_date || body.date || body.trandate);
    const lines    = Array.isArray(body.lines) ? body.lines : [];
    const dryRun   = b(body.dry_run, true);

    if (!vendorId) return { ok: false, error: "vendor_internal_id is required" };
    if (!docNum)   return { ok: false, error: "document_number is required for purchase_order" };
    if (!docDate)  return { ok: false, error: "date is required (YYYY-MM-DD)" };
    if (!lines.length) return { ok: false, error: "lines are required for purchase_order" };

    const existing = findDuplicate("PurchOrd", vendorId, docNum, subId);
    if (existing) return { ok: true, dry_run: dryRun, already_exists: true, mode: "purchase_order", purchase_order_internal_id: existing, warnings };

    const rec = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });
    applyHeader(rec, body, docNum, docDate, warnings);

    const dueDate = parseDate(body.due_date || body.dueDate);
    if (dueDate) trySet(rec, "duedate", dueDate);

    applyLinesStandalone(rec, lines, warnings);

    if (dryRun) return { ok: true, dry_run: true, mode: "purchase_order", would_create: "purchase_order", preview: { vendor_internal_id: vendorId, document_number: docNum, lines_count: lines.length }, warnings };

    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return { ok: true, dry_run: false, mode: "purchase_order", purchase_order_internal_id: String(id), warnings };
  }

  function post(body) {
    body = body || {};
    const warnings = [];
    try {
      const docType = s(body.document_type || body.documentType).toLowerCase();
      if (docType === "purchase_order") return createPurchaseOrder(body, warnings);
      return createVendorBill(body, warnings);
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), warnings };
    }
  }

  return { post };
});
