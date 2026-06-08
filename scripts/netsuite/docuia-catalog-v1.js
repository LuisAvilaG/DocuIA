/**
 * DocuIA — Catalog & Subsidiaries RESTlet v1
 *
 * Supported operations (POST/GET with body or query params):
 *
 *   type: "ping"          — Connection test, no additional params required.
 *   type: "subsidiaries"  — Returns all subsidiaries in this NS account.
 *   type: "items"         — Paginated items for a subsidiary.
 *   type: "vendors"       — Paginated vendors for a subsidiary.
 *   type: "locations"     — Paginated locations (optionally filtered by subsidiary).
 *
 * Common params for items/vendors/locations:
 *   page_index:       0..N (required)
 *   page_size:        1..1000 (optional, default 500)
 *   subsidiary_id:    NS internal ID (required for items/vendors)
 *   include_inactive: true/false (optional, default false)
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(["N/search", "N/log"], (search, log) => {
  const VERSION        = "docuia-catalog-v1";
  const DEFAULT_SIZE   = 500;
  const MAX_SIZE       = 1000;
  const ITEM_UOM_FIELD = "custitem_drt_unit_uom";

  /* ── helpers ──────────────────────────────────────────────── */

  function str(v) { return String(v == null ? "" : v).trim(); }
  function int(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : NaN; }
  function bool(v) { const s = str(v).toLowerCase(); return s === "1" || s === "true" || s === "yes"; }

  function clampSize(v) {
    const n = int(v);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIZE;
    return Math.min(Math.max(n, 1), MAX_SIZE);
  }

  function errPayload(err, debug) {
    const p = {
      ok: false,
      error: err && err.name ? str(err.name) : "UNEXPECTED_ERROR",
      message: err && err.message ? str(err.message) : str(err),
    };
    if (debug) p.stack = err && err.stack ? str(err.stack) : "";
    return p;
  }

  /* ── subsidiaries ─────────────────────────────────────────── */

  function fetchSubsidiaries() {
    const srch = search.create({
      type: "subsidiary",
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
        search.createColumn({ name: "namenohierarchy" }),
        search.createColumn({ name: "name" }),
        search.createColumn({ name: "country" }),
        search.createColumn({ name: "currency" }),
        search.createColumn({ name: "iselimination" }),
      ],
    });

    const results = [];
    srch.run().each((row) => {
      const id   = str(row.getValue("internalid"));
      const name = str(row.getValue("namenohierarchy")) || str(row.getValue("name"));
      if (id && name) {
        results.push({
          internal_id: id,
          name,
          country:  str(row.getValue("country")),
          currency: str(row.getText("currency")),
        });
      }
      return true;
    });

    return { ok: true, version: VERSION, type: "subsidiaries", total_count: results.length, results };
  }

  /* ── catalog searches ─────────────────────────────────────── */

  function buildItemSearch(opts) {
    const filters = [];
    if (!opts.includeInactive) filters.push(["isinactive", "is", "F"]);
    if (opts.subsidiaryId) {
      if (filters.length) filters.push("AND");
      filters.push(["subsidiary", "anyof", opts.subsidiaryId]);
    }
    return search.create({
      type: search.Type.ITEM,
      filters,
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
        search.createColumn({ name: "itemid" }),
        search.createColumn({ name: "displayname" }),
        search.createColumn({ name: "type" }),
        search.createColumn({ name: "stockunit" }),
        search.createColumn({ name: ITEM_UOM_FIELD }),
        search.createColumn({ name: "isinactive" }),
      ],
    });
  }

  function buildVendorSearch(opts) {
    const filters = [];
    if (!opts.includeInactive) filters.push(["isinactive", "is", "F"]);
    if (opts.subsidiaryId) {
      if (filters.length) filters.push("AND");
      filters.push(["subsidiary", "anyof", opts.subsidiaryId]);
    }
    return search.create({
      type: search.Type.VENDOR,
      filters,
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
        search.createColumn({ name: "entityid" }),
        search.createColumn({ name: "email" }),
        search.createColumn({ name: "phone" }),
        search.createColumn({ name: "custentity_mx_rfc" }),
        search.createColumn({ name: "isinactive" }),
      ],
    });
  }

  function buildLocationSearch(opts) {
    const filters = [];
    if (!opts.includeInactive) filters.push(["isinactive", "is", "F"]);
    if (opts.filterBySubsidiary && opts.subsidiaryId) {
      if (filters.length) filters.push("AND");
      filters.push(["subsidiary", "anyof", opts.subsidiaryId]);
    }
    return search.create({
      type: search.Type.LOCATION,
      filters,
      columns: [
        search.createColumn({ name: "internalid", sort: search.Sort.ASC }),
        search.createColumn({ name: "name" }),
        search.createColumn({ name: "isinactive" }),
      ],
    });
  }

  function mapItem(row) {
    const itemid      = str(row.getValue({ name: "itemid" }));
    const displayname = str(row.getValue({ name: "displayname" }));
    return {
      internal_id:       str(row.getValue({ name: "internalid" })),
      itemid,
      name:              displayname || itemid,
      type:              str(row.getValue({ name: "type" })),
      unit:              str(row.getValue({ name: "stockunit" })),
      drt_unit_uom_id:   str(row.getValue({ name: ITEM_UOM_FIELD })),
      drt_unit_uom_name: str(row.getText({ name: ITEM_UOM_FIELD })),
      inactive:          str(row.getValue({ name: "isinactive" })) === "T",
    };
  }

  function mapVendor(row) {
    const entityid = str(row.getValue({ name: "entityid" }));
    return {
      internal_id: str(row.getValue({ name: "internalid" })),
      entityid,
      name:        entityid,
      email:       str(row.getValue({ name: "email" })),
      phone:       str(row.getValue({ name: "phone" })),
      rfc:         str(row.getValue({ name: "custentity_mx_rfc" })),
      inactive:    str(row.getValue({ name: "isinactive" })) === "T",
    };
  }

  function mapLocation(row) {
    const name = str(row.getValue({ name: "name" }));
    return {
      internal_id: str(row.getValue({ name: "internalid" })),
      name,
      full_name:   name,
      inactive:    str(row.getValue({ name: "isinactive" })) === "T",
    };
  }

  function runPaged(srch, mapper, pageIndex, pageSize) {
    const paged     = srch.runPaged({ pageSize });
    const pageCount = Number(paged.pageRanges.length || 0);

    if (pageCount === 0) return { page_count: 0, total_count: 0, results: [] };

    if (pageIndex >= pageCount) {
      return {
        out_of_range: true,
        page_count:   pageCount,
        total_count:  Number(paged.count || 0),
        results:      [],
      };
    }

    const page = paged.fetch({ index: pageIndex });
    return {
      page_count:  pageCount,
      total_count: Number(paged.count || 0),
      results:     page.data.map((row) => mapper(row)),
    };
  }

  /* ── main execute ─────────────────────────────────────────── */

  function execute(params) {
    params    = params || {};
    const dbg = bool(params.debug);

    try {
      const type = str(params.type).toLowerCase();

      /* ping — pure connection test */
      if (!type || type === "ping") {
        return { ok: true, version: VERSION, ping: true };
      }

      /* subsidiaries — list all */
      if (type === "subsidiaries") {
        return fetchSubsidiaries();
      }

      /* catalog types */
      if (!["items", "vendors", "locations"].includes(type)) {
        return { ok: false, error: "VALIDATION_ERROR", message: 'type must be: ping | subsidiaries | items | vendors | locations' };
      }

      const pageIndex     = int(params.page_index);
      const pageSize      = clampSize(params.page_size);
      const subsidiaryId  = str(params.subsidiary_id);
      const includeInactive = bool(params.include_inactive);
      const filterBySubsidiary = bool(params.filter_locations_by_subsidiary);

      if (!Number.isFinite(pageIndex) || pageIndex < 0) {
        return { ok: false, error: "VALIDATION_ERROR", message: '"page_index" must be >= 0' };
      }
      if ((type === "items" || type === "vendors") && !subsidiaryId) {
        return { ok: false, error: "VALIDATION_ERROR", message: `"subsidiary_id" is required for type "${type}"` };
      }

      let srch, mapper;
      if (type === "items") {
        srch   = buildItemSearch({ subsidiaryId, includeInactive });
        mapper = mapItem;
      } else if (type === "vendors") {
        srch   = buildVendorSearch({ subsidiaryId, includeInactive });
        mapper = mapVendor;
      } else {
        srch   = buildLocationSearch({ subsidiaryId, includeInactive, filterBySubsidiary });
        mapper = mapLocation;
      }

      const paged = runPaged(srch, mapper, pageIndex, pageSize);
      if (paged.out_of_range) {
        return { ok: false, error: "OUT_OF_RANGE", message: "page_index out of range", page_count: paged.page_count, total_count: paged.total_count };
      }

      return {
        ok:           true,
        version:      VERSION,
        type,
        subsidiary_id: subsidiaryId || null,
        page_index:   pageIndex,
        page_size:    pageSize,
        page_count:   paged.page_count,
        total_count:  paged.total_count,
        results:      paged.results,
      };
    } catch (err) {
      log.error({ title: "DocuIA Catalog RESTlet Error", details: err });
      return errPayload(err, dbg);
    }
  }

  return { get: (p) => execute(p || {}), post: (b) => execute(b || {}) };
});
