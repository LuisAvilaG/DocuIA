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
 *   lines:                         array of item line objects (item sublist)
 *   expense_lines:                 array of expense line objects (expense sublist —
 *                                  account-based, used for vendor bills without a
 *                                  catalog item, e.g. employee expenses paid to vendor)
 *   po_internal_id:                optional — if set, transforms PO → Vendor Bill
 *   dry_run:                       true/false (default true) — validate without saving
 *   location_internal_id:          optional
 *   currency_internal_id:          optional
 *   apply_to_po_lines:             true/false (default true) — false: do not create the bill from the PO
 *                                  (po_internal_id is ignored and the bill is saved on its own)
 *   set_unselected_po_lines_to_zero: true/false (default false) — zero qty/amount on PO lines not matched by DocuIA
 *   allow_additional_lines:        true/false (default true)
 *   custom_fields:                 optional { custbody_x: "value" } — body fields to set (CFDI UUID, uso, etc.)
 *   attachments:                   optional [{ name, kind: "xml"|"pdf", content_base64 }] — attached to the bill
 *   attachment_folder_id:          File Cabinet folder for the attachments (required to attach)
 *
 * Line object:
 *   item_internal_id: required
 *   quantity:         number
 *   rate:             number
 *   amount:           number
 *   unit:             string (unit internal id)
 *   description:      string
 *
 * Expense line object (expense sublist):
 *   account_internal_id: required (GL account internal id)
 *   amount:              number
 *   memo:                string
 *   department:          string (internal id)
 *   class:               string (internal id)
 *   location:            string (internal id)
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/record", "N/search", "N/format", "N/log", "N/file", "N/encode", "N/runtime"], (record, search, format, log, file, encode, runtime) => {

  // Safe JSON for logs (NetSuite log details cap ~4000 chars).
  function j(v, max) {
    try { return JSON.stringify(v).slice(0, max || 3800); }
    catch (e) { return String(v); }
  }

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
    // new Date(2026, 12, 45) is a valid date in another month: only a day that
    // exists is accepted (so 05/13/2026 read as day/month is refused, not moved).
    const ymd = (y, m, d) => {
      const date = new Date(y, m - 1, d);
      return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
    };
    const dot   = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (dot)   return ymd(Number(dot[3]), Number(dot[2]), Number(dot[1]));
    const slash = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slash) return ymd(Number(slash[3]), Number(slash[2]), Number(slash[1]));
    const iso   = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso)   return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    try { return format.parse({ value: v, type: format.Type.DATE }); } catch (e) { return null; }
  }

  function trySet(rec, fieldId, value) {
    try { rec.setValue({ fieldId, value }); return true; } catch (e) { return false; }
  }
  function tryCurrent(rec, sub, fieldId, value) {
    try { rec.setCurrentSublistValue({ sublistId: sub, fieldId, value }); return true; } catch (e) { return false; }
  }
  function tryGet(rec, fieldId) {
    try { return rec.getValue({ fieldId }); } catch (e) { return null; }
  }
  // Accounts without Multiple Currencies have no currency field to set.
  function multiCurrency() {
    try { return runtime.isFeatureInEffect({ feature: "MULTICURRENCY" }) === true; } catch (e) { return false; }
  }

  // Warnings that mean the record would not carry what was sent. The record is
  // not saved with any of them: a bill for less (or more) than the invoice,
  // reported as created, is worse than a rejected request.
  const BLOCKING = {
    NO_MATCHED_PO_LINE:              "Una línea de la factura no está en la OC y la configuración no permite líneas adicionales.",
    LINE_SKIPPED_NO_ITEM:            "Una línea llegó sin ítem.",
    EXPENSE_LINE_SKIPPED_NO_ACCOUNT: "Una línea de gasto llegó sin cuenta contable.",
    LINE_WITHOUT_PRICE:              "Una línea llegó sin precio ni importe.",
    PO_LINE_NOT_EXCLUDED:            "No se pudo excluir una línea de la OC que esta factura no cubre.",
  };

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

  // Resolve a currency value to an internal id. Accepts either a numeric
  // internal id (returned as-is) or an ISO code / symbol (e.g. "USD"),
  // resolved via a currency search.
  function resolveCurrency(value) {
    const raw = s(value);
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return raw; // already an internal id
    try {
      const rows = search.create({
        type: "currency",
        filters: [["symbol", "is", raw.toUpperCase()]],
        columns: ["internalid"],
      }).run().getRange({ start: 0, end: 1 });
      if (rows && rows.length) return s(rows[0].getValue("internalid"));
    } catch (e) { /* fall through */ }
    return null;
  }

  function findByExternalId(typeCode, externalId) {
    if (!s(externalId)) return null;
    try {
      const rows = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ["type", "anyof", typeCode], "AND",
          ["mainline", "is", "T"], "AND",
          ["externalid", "is", String(externalId)],
        ],
        columns: ["internalid"],
      }).run().getRange({ start: 0, end: 1 });
      return rows && rows.length ? s(rows[0].getValue("internalid")) : null;
    } catch (e) { return null; }
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

  // Localizations hang custom segments on the location (e.g. DRT region, zone
  // and consumption center) and their tax engines read them from the
  // transaction, as the UI does when you pick a location. Copies every custom
  // segment the location has onto the header; unknown ones are skipped.
  function copyLocationSegments(rec, locId, warnings) {
    try {
      const loc = record.load({ type: record.Type.LOCATION, id: locId });
      loc.getFields().filter((f) => /^cseg/i.test(f)).forEach((f) => {
        const v = loc.getValue({ fieldId: f });
        if (v === null || v === undefined || v === "") return;
        if (!trySet(rec, f, v)) warnings.push({ code: "SEGMENT_NOT_SET", field: f });
      });
    } catch (e) {
      warnings.push({ code: "LOCATION_SEGMENTS_UNAVAILABLE", message: s(e && e.message) });
    }
  }

  // Opens the record already on its form and vendor, like the UI does. Setting
  // the custom form afterwards re-initializes the record, and SuiteTax can keep
  // a tax context without the vendor ("entity: null" on save).
  function createWithDefaults(type, body, warnings) {
    const defaults = {};
    const customForm = n(body.customform);
    if (customForm !== null) defaults.customform = customForm;
    const vendorId = s(body.vendor_internal_id);
    if (vendorId) defaults.entity = vendorId;
    if (Object.keys(defaults).length) {
      try {
        return record.create({ type, isDynamic: true, defaultValues: defaults });
      } catch (e) {
        warnings.push({ code: "DEFAULT_VALUES_NOT_ACCEPTED", message: s(e && e.message) });
      }
    }
    return record.create({ type, isDynamic: true });
  }

  // Fails with a clear message instead of NetSuite's tax-engine "entity: null".
  function ensureVendor(rec, vendorId, subId) {
    if (!vendorId || s(rec.getValue({ fieldId: "entity" })) === vendorId) return;
    const err = new Error(
      "El proveedor " + vendorId + " no está asignado a la subsidiaria " + (subId || "(sin subsidiaria)") +
      " en el ERP. Asígnalo a esa subsidiaria en la ficha del proveedor o procesa el documento en la subsidiaria correcta."
    );
    err.name = "VENDOR_NOT_IN_SUBSIDIARY";
    throw err;
  }

  function applyHeader(rec, body, docNumber, docDate, warnings) {
    // Only when the record is not already on that form: switching forms
    // re-initializes the record (see createWithDefaults).
    const customForm = n(body.customform);
    if (customForm !== null && s(rec.getValue({ fieldId: "customform" })) !== String(customForm)) trySet(rec, "customform", customForm);

    // Same order as the UI (and the account-specific scripts that work in
    // localized accounts): vendor, subsidiary, vendor again if the subsidiary
    // cleared it, the location's segments and location, then number and date.
    const vendorId = s(body.vendor_internal_id);
    const subId = s(body.subsidiary_internal_id);
    if (vendorId) rec.setValue({ fieldId: "entity", value: vendorId });
    if (subId) trySet(rec, "subsidiary", subId);
    if (vendorId && s(rec.getValue({ fieldId: "entity" })) !== vendorId) trySet(rec, "entity", vendorId);
    ensureVendor(rec, vendorId, subId);

    const locId = s(body.location_internal_id);
    if (locId) {
      copyLocationSegments(rec, locId, warnings);
      trySet(rec, "location", locId);
    }

    rec.setValue({ fieldId: "tranid",   value: docNumber });
    rec.setValue({ fieldId: "trandate", value: docDate });

    // The currency is part of the amount: saved in the vendor's default one,
    // 1,000 USD becomes 1,000 of something else. With Multiple Currencies on,
    // a currency that cannot be applied stops the request before anything is
    // saved; without the feature there is a single currency and nothing to set.
    const currency = s(body.currency_internal_id);
    if (currency) {
      const strict = multiCurrency();
      const resolved = resolveCurrency(currency);
      if (!resolved) {
        if (strict) throw new Error("La moneda " + currency + " no existe en el ERP. No se creó el registro.");
        warnings.push({ code: "CURRENCY_NOT_FOUND", currency: currency });
      } else {
        const ok = trySet(rec, "currency", resolved);
        const applied = ok && s(tryGet(rec, "currency")) === resolved;
        if (!applied) {
          if (strict) throw new Error("El ERP no aceptó la moneda " + currency + " para este proveedor u orden de compra. No se creó el registro.");
          warnings.push({ code: "CURRENCY_NOT_SET", currency: currency });
        }
      }
    }

    const externalId = s(body.external_id);
    // Without it the app cannot recognise this record on a retry.
    if (externalId && !trySet(rec, "externalid", externalId)) warnings.push({ code: "EXTERNAL_ID_NOT_SET" });

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
      // Location before the item: the item triggers line sourcing and tax
      // calculation, which in SuiteTax / localized accounts need the location.
      const loc = s(ln.location);
      if (loc) rec.setCurrentSublistValue({ sublistId: "item", fieldId: "location", value: loc });
      rec.setCurrentSublistValue({ sublistId: "item", fieldId: "item", value: itemId });
      if (loc && s(rec.getCurrentSublistValue({ sublistId: "item", fieldId: "location" })) !== loc) tryCurrent(rec, "item", "location", loc);
      setUnit(rec, s(ln.unit), warnings, itemId);

      const qty = n(ln.quantity);
      if (qty !== null) tryCurrent(rec, "item", "quantity", qty);
      const rate = n(ln.rate);
      if (rate !== null) tryCurrent(rec, "item", "rate", rate);
      const amt = n(ln.amount);
      if (amt !== null) tryCurrent(rec, "item", "amount", amt);
      // Neither: the ERP would price the line by itself (item default, or zero).
      if (rate === null && amt === null) warnings.push({ code: "LINE_WITHOUT_PRICE", item_internal_id: itemId });
      const desc = s(ln.description);
      if (desc) tryCurrent(rec, "item", "description", desc);

      rec.commitLine({ sublistId: "item" });

      const lineIdx = rec.getLineCount({ sublistId: "item" }) - 1;
      repairRate(rec, lineIdx, ln, warnings);
    }
  }

  function applyExpenseLines(rec, expenseLines, warnings) {
    for (const el of expenseLines) {
      const account = s(el.account_internal_id);
      if (!account) {
        warnings.push({ code: "EXPENSE_LINE_SKIPPED_NO_ACCOUNT" });
        continue;
      }
      rec.selectNewLine({ sublistId: "expense" });
      rec.setCurrentSublistValue({ sublistId: "expense", fieldId: "account", value: account });

      const amt = n(el.amount);
      if (amt !== null) tryCurrent(rec, "expense", "amount", amt);
      const memo = s(el.memo);
      if (memo) tryCurrent(rec, "expense", "memo", memo);
      const dept = s(el.department);
      if (dept) tryCurrent(rec, "expense", "department", dept);
      const cls = s(el.class);
      if (cls) tryCurrent(rec, "expense", "class", cls);
      const loc = s(el.location);
      if (loc) tryCurrent(rec, "expense", "location", loc);

      rec.commitLine({ sublistId: "expense" });
    }
  }

  function applyLinesTransform(rec, lines, opts, warnings) {
    const count = rec.getLineCount({ sublistId: "item" });
    const byItem = {};
    const byPoLine = {};
    for (let i = 0; i < count; i++) {
      const itemId = s(tryGetSub(rec, "item", "item", i));
      // On a bill made from a PO, "orderline" is the id of the PO line it bills;
      // "line" is the bill's own line number and only matches by coincidence.
      const poLine = s(tryGetSub(rec, "item", "orderline", i)) || s(tryGetSub(rec, "item", "line", i));
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
        // The PO line that was asked for is not on the bill: said, not hidden.
        if (poLine && match !== null) warnings.push({ code: "PO_LINE_FALLBACK", item_internal_id: itemId, po_line: poLine });
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
    // The bill starts with every open line of the PO. Those the invoice does
    // not cover are taken off (last first, so the indexes still to check do
    // not move); if a line cannot be removed it is set to zero, and if that
    // fails too the request stops: the bill would be for more than the invoice.
    if (opts.set_unselected_po_lines_to_zero) {
      for (let i = count - 1; i >= 0; i--) {
        if (used.has(i)) continue;
        try {
          rec.removeLine({ sublistId: "item", line: i });
        } catch (e) {
          try {
            rec.selectLine({ sublistId: "item", line: i });
            const zeroed = tryCurrent(rec, "item", "quantity", 0);
            tryCurrent(rec, "item", "amount", 0);
            rec.commitLine({ sublistId: "item" });
            if (!zeroed) warnings.push({ code: "PO_LINE_NOT_EXCLUDED", line: i });
          } catch (e2) {
            warnings.push({ code: "PO_LINE_NOT_EXCLUDED", line: i });
          }
        }
      }
    }
  }

  function createVendorBill(body, warnings) {
    const vendorId  = s(body.vendor_internal_id);
    const subId     = s(body.subsidiary_internal_id) || null;
    // apply_to_po_lines false: the bill is not created from the purchase order
    // (the PO stays open); it is saved on its own with the lines received.
    const poId      = b(body.apply_to_po_lines, true) ? (s(body.po_internal_id) || null) : null;
    const invNumber = s(body.invoice_number || body.invoiceNumber);
    const invDate   = parseDate(body.invoice_date || body.invoiceDate);
    const lines     = Array.isArray(body.lines) ? body.lines : [];
    const expenseLines = Array.isArray(body.expense_lines) ? body.expense_lines : [];
    const dryRun    = b(body.dry_run, true);

    if (!vendorId)  return { ok: false, error: "vendor_internal_id is required" };
    if (!invNumber) return { ok: false, error: "invoice_number is required" };
    if (!invDate)   return { ok: false, error: "invoice_date is required (YYYY-MM-DD)" };
    if (!lines.length && !expenseLines.length) {
      return { ok: false, error: "at least one item line or expense line is required" };
    }

    // Idempotency: prefer externalId (atomic, survives tranid edits), fall back to tranid.
    const externalId = s(body.external_id);
    // matched_by tells the caller whether this is its own earlier request
    // (external id) or another bill that happens to carry the same number.
    const byExternalId = findByExternalId("VendBill", externalId);
    const existing = byExternalId || findDuplicate("VendBill", vendorId, invNumber, subId);
    if (existing) return { ok: true, dry_run: dryRun, already_exists: true, matched_by: byExternalId ? "external_id" : "document_number", mode: poId ? "transform" : "standalone", vendor_bill_internal_id: existing, warnings };

    // The app validates the catalog choice too, but the RESTlet must protect
    // direct callers from transforming a PO owned by another vendor/subsidiary.
    if (poId) {
      const poValidation = validatePurchaseOrderForTransform(poId, vendorId, subId);
      if (!poValidation.ok) return poValidation;
    }

    const mode = poId ? "transform" : "standalone";
    const rec  = poId
      ? record.transform({ fromType: record.Type.PURCHASE_ORDER, fromId: poId, toType: record.Type.VENDOR_BILL, isDynamic: true })
      : createWithDefaults(record.Type.VENDOR_BILL, body, warnings);

    applyHeader(rec, body, invNumber, invDate, warnings);
    const billDueDate = parseDate(body.due_date);
    if (billDueDate) trySet(rec, "duedate", billDueDate);
    applyCustomFields(rec, body, warnings);

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
    }
    if (expenseLines.length) {
      applyExpenseLines(rec, expenseLines, warnings);
    }

    const blocking = warnings.filter((w) => BLOCKING[w.code]);
    if (blocking.length) {
      return { ok: false, error: BLOCKING[blocking[0].code] + " No se creó el registro.", error_name: blocking[0].code, warnings };
    }
    // The subsidiary is set with a tolerant setter; a vendor not assigned to it
    // leaves the record on another one.
    const actualSub = s(tryGet(rec, "subsidiary"));
    if (subId && actualSub && actualSub !== subId) {
      return { ok: false, error: "El ERP no asignó la subsidiaria solicitada (el proveedor puede no estar asignado a ella). No se creó el registro.", error_name: "SUBSIDIARY_NOT_SET", warnings };
    }

    if (dryRun) return { ok: true, dry_run: true, mode, would_create: "vendor_bill", preview: { vendor_internal_id: vendorId, invoice_number: invNumber, lines_count: lines.length, expense_lines_count: expenseLines.length }, warnings };

    // Line sourcing can also reset the header; check the vendor once more.
    ensureVendor(rec, vendorId, subId);
    log.audit({ title: "docuia-process:saving", details: "vendor_bill mode=" + mode + " entity=" + s(rec.getValue({ fieldId: "entity" })) + " subsidiary=" + s(rec.getValue({ fieldId: "subsidiary" })) + " lines=" + lines.length + " expense=" + expenseLines.length + " warnings=" + j(warnings, 1000) });
    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    const attachments = attachFiles(id, body, warnings);
    return { ok: true, dry_run: false, mode, vendor_bill_internal_id: String(id), attachments, warnings };
  }

  // Body fields sent by DocuIA (CFDI UUID, uso CFDI, método de pago...). Only
  // custom body fields are accepted; a field that does not exist is a warning.
  function applyCustomFields(rec, body, warnings) {
    const fields = body.custom_fields && typeof body.custom_fields === "object" ? body.custom_fields : {};
    Object.keys(fields).forEach((fieldId) => {
      if (!/^custbody[a-z0-9_]+$/i.test(fieldId)) return;
      if (!trySet(rec, fieldId, s(fields[fieldId]))) warnings.push({ code: "CUSTOM_FIELD_NOT_SET", field: fieldId });
    });
  }

  // XML / PDF of the invoice, saved in the File Cabinet and attached to the bill.
  function attachFiles(billId, body, warnings) {
    const list = Array.isArray(body.attachments) ? body.attachments : [];
    if (!list.length) return [];
    const folder = n(body.attachment_folder_id);
    if (folder === null) { warnings.push({ code: "ATTACHMENT_FOLDER_MISSING" }); return []; }
    const attached = [];
    if (list.length > 4) warnings.push({ code: "ATTACHMENTS_OVER_LIMIT", sent: list.length, attached: 4 });
    list.slice(0, 4).forEach((a) => {
      try {
        const isXml = s(a.kind) === "xml";
        const contents = isXml
          ? encode.convert({ string: s(a.content_base64), inputEncoding: encode.Encoding.BASE_64, outputEncoding: encode.Encoding.UTF_8 })
          : s(a.content_base64);
        // Prefixed with the bill id: two vendors with invoice "1001" would
        // otherwise write the same file name in the folder, and the second
        // replaces the first.
        const f = file.create({
          name: billId + "_" + (s(a.name) || (isXml ? "cfdi.xml" : "factura.pdf")),
          fileType: isXml ? file.Type.XMLDOC : file.Type.PDF,
          contents,
          folder,
        });
        const fileId = f.save();
        record.attach({ record: { type: "file", id: fileId }, to: { type: record.Type.VENDOR_BILL, id: billId } });
        attached.push(String(fileId));
      } catch (err) {
        warnings.push({ code: "ATTACHMENT_FAILED", name: s(a.name), message: String(err.message || err) });
      }
    });
    return attached;
  }

  function validatePurchaseOrderForTransform(poId, vendorId, subId) {
    try {
      const po = record.load({ type: record.Type.PURCHASE_ORDER, id: poId, isDynamic: false });
      if (s(po.getValue({ fieldId: "entity" })) !== vendorId) {
        return { ok: false, error: "The selected purchase order does not belong to the vendor" };
      }
      if (subId && s(po.getValue({ fieldId: "subsidiary" })) !== subId) {
        return { ok: false, error: "The selected purchase order does not belong to the subsidiary" };
      }
      // "orderstatus" is the status letter; "status" on a loaded record is its
      // label in the user's language. C = rejected, G = fully billed, H = closed.
      // F is "Pending Bill": received and ready to bill, the usual case.
      const status = s(tryGet(po, "orderstatus")).toUpperCase();
      if (status === "C" || status === "G" || status === "H") {
        return { ok: false, error: "La orden de compra elegida ya no está abierta (rechazada, facturada por completo o cerrada)." };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: "Could not validate the selected purchase order: " + String(err.message || err) };
    }
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

    const externalId = s(body.external_id);
    const byExternalId = findByExternalId("PurchOrd", externalId);
    const existing = byExternalId || findDuplicate("PurchOrd", vendorId, docNum, subId);
    if (existing) return { ok: true, dry_run: dryRun, already_exists: true, matched_by: byExternalId ? "external_id" : "document_number", mode: "purchase_order", purchase_order_internal_id: existing, warnings };

    const rec = record.create({ type: record.Type.PURCHASE_ORDER, isDynamic: true });
    applyHeader(rec, body, docNum, docDate, warnings);

    const dueDate = parseDate(body.due_date || body.dueDate);
    if (dueDate) trySet(rec, "duedate", dueDate);

    applyLinesStandalone(rec, lines, warnings);

    if (dryRun) return { ok: true, dry_run: true, mode: "purchase_order", would_create: "purchase_order", preview: { vendor_internal_id: vendorId, document_number: docNum, lines_count: lines.length }, warnings };

    log.audit({ title: "docuia-process:saving", details: "purchase_order lines=" + lines.length + " warnings=" + j(warnings, 1000) });
    const id = rec.save({ enableSourcing: true, ignoreMandatoryFields: false });
    return { ok: true, dry_run: false, mode: "purchase_order", purchase_order_internal_id: String(id), warnings };
  }

  function post(body) {
    body = body || {};
    const warnings = [];
    const docType = s(body.document_type || body.documentType).toLowerCase();

    log.audit({
      title: "docuia-process:request",
      details: "docType=" + (docType || "invoice")
        + " vendor=" + s(body.vendor_internal_id)
        + " subsidiary=" + s(body.subsidiary_internal_id)
        + " location=" + s(body.location_internal_id)
        + " currency=" + s(body.currency_internal_id)
        + " dry_run=" + s(body.dry_run)
        + " lines=" + (Array.isArray(body.lines) ? body.lines.length : 0)
        + " | body=" + j(body),
    });

    try {
      const result = docType === "purchase_order"
        ? createPurchaseOrder(body, warnings)
        : createVendorBill(body, warnings);

      if (!result.ok) {
        log.error({ title: "docuia-process:validation_failed", details: j(result) });
      } else {
        log.audit({ title: "docuia-process:ok", details: j(result) });
      }
      return result;
    } catch (err) {
      // NetSuite throws rich error objects — surface name + message + the fields
      // it complained about, and log the full thing for the execution log.
      const name = err && err.name ? String(err.name) : "";
      const msg  = err && err.message ? String(err.message) : String(err);
      log.error({
        title: "docuia-process:exception",
        details: "name=" + name + " message=" + msg
          + " | stack=" + (err && err.stack ? String(err.stack).slice(0, 1500) : "n/a")
          + " | body=" + j(body, 1500),
      });
      return { ok: false, error: name ? (name + ": " + msg) : msg, error_name: name, warnings };
    }
  }

  return { post };
});
