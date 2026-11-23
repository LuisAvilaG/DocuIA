# Cobertura archivo por archivo

## Facturas: lógica y API

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/api/v1/catalog/items/route.ts` | 68 | completa |  |
| `app/api/v1/catalog/open-purchase-orders/route.ts` | 47 | completa |  |
| `app/api/v1/catalog/vendors/route.ts` | 62 | completa |  |
| `app/api/v1/catalogs/sync/route.ts` | 37 | completa |  |
| `app/api/v1/documents/[id]/file/route.ts` | 69 | completa |  |
| `app/api/v1/exceptions/[id]/resolve/route.ts` | 58 | completa |  |
| `app/api/v1/exceptions/[id]/retry/route.ts` | 131 | completa | 1 |
| `app/api/v1/history/export/route.ts` | 106 | completa |  |
| `app/api/v1/mappings/[id]/route.ts` | 130 | completa |  |
| `app/api/v1/mappings/route.ts` | 94 | completa |  |
| `app/api/v1/vendor-rules/[id]/route.ts` | 66 | completa | 1 |
| `app/api/v1/vendor-rules/resolve/route.ts` | 17 | completa |  |
| `app/api/v1/vendor-rules/route.ts` | 68 | completa |  |
| `app/api/v1/workflow/[docId]/approve/route.ts` | 184 | completa | 2 |
| `app/api/v1/workflow/[docId]/po-match/route.ts` | 114 | completa |  |
| `app/api/v1/workflow/[docId]/receipt/route.ts` | 44 | completa |  |
| `app/api/v1/workflow/[docId]/status/route.ts` | 47 | completa |  |
| `app/api/v1/workflow/[docId]/test-send/route.ts` | 65 | completa |  |
| `app/api/v1/workflow/status/route.ts` | 41 | completa |  |
| `app/api/v1/workflow/upload/route.ts` | 225 | completa |  |
| `lib/ap/friendly-error.ts` | 18 | completa | 1 |
| `lib/ap/invoice-stages.ts` | 79 | completa |  |
| `lib/ap/upload-access.ts` | 11 | completa |  |
| `lib/cfdi/sat.ts` | 61 | completa | 1 |
| `lib/cfdi/validation.ts` | 124 | completa |  |
| `lib/netsuite/client.ts` | 318 | completa |  |
| `lib/netsuite/connection.ts` | 39 | completa |  |
| `lib/netsuite/custom-forms.ts` | 57 | completa |  |
| `lib/netsuite/oauth.ts` | 113 | completa |  |
| `lib/netsuite/sync-catalog.ts` | 137 | completa | 1 |
| `lib/workflow/ap-checks.ts` | 238 | completa | 2 |
| `lib/workflow/cfdi-parser.ts` | 160 | completa | 2 |
| `lib/workflow/doc-metrics.ts` | 37 | completa |  |
| `lib/workflow/erp-extras.ts` | 71 | completa |  |
| `lib/workflow/extract.ts` | 372 | completa | 1 |
| `lib/workflow/log.ts` | 46 | completa |  |
| `lib/workflow/mappings.ts` | 75 | completa | 1 |
| `lib/workflow/match.ts` | 571 | completa | 2 |
| `lib/workflow/ns-payload.ts` | 196 | completa | 1 |
| `lib/workflow/pipeline.ts` | 765 | completa | 4 |
| `lib/workflow/po-match.ts` | 278 | completa | 2 |
| `lib/workflow/post-draft.ts` | 118 | completa |  |
| `lib/workflow/process-ns.ts` | 184 | completa | 2 |
| `lib/workflow/qa-send.ts` | 75 | completa |  |
| `lib/workflow/receipt-check.ts` | 128 | completa | 3 |
| `lib/workflow/review-corrections.ts` | 45 | completa | 1 |
| `lib/workflow/review-reason.ts` | 23 | completa |  |
| `lib/workflow/similarity.ts` | 76 | completa | 1 |
| `lib/workflow/test-send.ts` | 101 | completa | 1 |
| `lib/workflow/types.ts` | 146 | completa |  |
| `lib/workflow/validation.ts` | 55 | completa |  |
| `lib/workflow/vendor-rules-store.ts` | 125 | completa |  |
| `lib/workflow/vendor-rules.ts` | 71 | completa |  |

## Facturas: pantallas

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/(tenant)/catalogs/client.tsx` | 278 | completa |  |
| `app/(tenant)/catalogs/page.tsx` | 114 | completa | 1 |
| `app/(tenant)/dashboard/page.tsx` | 26 | completa |  |
| `app/(tenant)/dashboard/view.tsx` | 195 | completa |  |
| `app/(tenant)/documents/page.tsx` | 123 | completa |  |
| `app/(tenant)/documents/upload-drawer.tsx` | 470 | completa | 1 |
| `app/(tenant)/documents/view.tsx` | 193 | completa | 2 |
| `app/(tenant)/exceptions/client.tsx` | 186 | completa |  |
| `app/(tenant)/exceptions/page.tsx` | 56 | completa | 1 |
| `app/(tenant)/history/[id]/ap-panels.tsx` | 283 | completa |  |
| `app/(tenant)/history/[id]/doc-preview-lazy.tsx` | 17 | completa |  |
| `app/(tenant)/history/[id]/doc-preview.tsx` | 243 | completa | 2 |
| `app/(tenant)/history/[id]/invoice-actions.tsx` | 102 | completa |  |
| `app/(tenant)/history/[id]/invoice-head.tsx` | 36 | completa |  |
| `app/(tenant)/history/[id]/page.tsx` | 412 | completa | 6 |
| `app/(tenant)/history/[id]/review-client.tsx` | 1118 | completa | 8 |
| `app/(tenant)/invoice-settings/copy.ts` | 33 | completa |  |
| `app/(tenant)/invoice-settings/page.tsx` | 132 | completa |  |
| `app/(tenant)/invoice-settings/rows.tsx` | 174 | completa |  |
| `app/(tenant)/layout.tsx` | 64 | completa |  |
| `app/(tenant)/mappings/client.tsx` | 292 | completa | 3 |
| `app/(tenant)/mappings/page.tsx` | 68 | completa | 1 |
| `app/(tenant)/metrics/filters.tsx` | 73 | completa |  |
| `app/(tenant)/metrics/more-metrics.tsx` | 208 | completa | 1 |
| `app/(tenant)/metrics/page.tsx` | 369 | completa |  |
| `app/(tenant)/vendor-rules/client.tsx` | 421 | completa | 1 |
| `app/(tenant)/vendor-rules/page.tsx` | 39 | completa |  |
| `app/(tenant)/vendor-rules/rule-finder.tsx` | 78 | completa |  |
| `app/(tenant)/workflow/page.tsx` | 6 | completa |  |
| `components/shared/change-password-dialog.tsx` | 159 | completa |  |
| `components/tenant/dry-run-banner.tsx` | 52 | completa |  |
| `components/tenant/sandbox-test-send.tsx` | 101 | completa |  |
| `components/tenant/subsidiaries-table.tsx` | 83 | completa |  |
| `components/tenant/subsidiary-picker.tsx` | 104 | completa |  |
| `components/tenant/tenant-sidebar.tsx` | 248 | completa |  |
| `lib/dashboard/ap-dashboard.ts` | 90 | completa | 1 |
| `lib/stats/ap-metrics.ts` | 248 | completa | 1 |
| `lib/stats/ap-stats.ts` | 177 | completa | 3 |
| `lib/stats/contract-metrics.ts` | 121 | completa |  |

## Contratos: lógica y API

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/api/public/entregar/[token]/route.ts` | 49 | completa | 3 |
| `app/api/v1/contracts/ai-analysis/improve/route.ts` | 23 | completa |  |
| `app/api/v1/contracts/ai-analysis/templates/route.ts` | 59 | completa |  |
| `app/api/v1/contracts/approvers/route.ts` | 20 | completa |  |
| `app/api/v1/contracts/archive/[id]/file/route.ts` | 22 | completa |  |
| `app/api/v1/contracts/archive/[id]/references/route.ts` | 38 | completa |  |
| `app/api/v1/contracts/archive/[id]/route.ts` | 75 | completa |  |
| `app/api/v1/contracts/archive/references/[id]/route.ts` | 42 | completa |  |
| `app/api/v1/contracts/archive/route.ts` | 53 | completa |  |
| `app/api/v1/contracts/cases/[id]/approve/route.ts` | 127 | completa |  |
| `app/api/v1/contracts/cases/[id]/findings/route.ts` | 24 | completa |  |
| `app/api/v1/contracts/cases/[id]/generate/route.ts` | 122 | completa |  |
| `app/api/v1/contracts/cases/[id]/output/route.ts` | 72 | completa |  |
| `app/api/v1/contracts/cases/[id]/reject/route.ts` | 55 | completa |  |
| `app/api/v1/contracts/cases/[id]/reopen/route.ts` | 52 | completa |  |
| `app/api/v1/contracts/cases/[id]/request-documents/route.ts` | 108 | completa | 2 |
| `app/api/v1/contracts/cases/[id]/resubmit/route.ts` | 30 | completa |  |
| `app/api/v1/contracts/cases/[id]/route.ts` | 26 | completa |  |
| `app/api/v1/contracts/cases/[id]/support/route.ts` | 36 | completa |  |
| `app/api/v1/contracts/cases/[id]/upload-link/route.ts` | 31 | completa |  |
| `app/api/v1/contracts/cases/route.ts` | 133 | completa | 1 |
| `app/api/v1/contracts/documents/[id]/file/route.ts` | 45 | completa |  |
| `app/api/v1/contracts/documents/[id]/route.ts` | 113 | completa | 1 |
| `app/api/v1/contracts/flow/[id]/export/route.ts` | 83 | completa |  |
| `app/api/v1/contracts/flow/[id]/publish/route.ts` | 34 | completa |  |
| `app/api/v1/contracts/flow/[id]/route.ts` | 144 | completa | 1 |
| `app/api/v1/contracts/flow/[id]/test/route.ts` | 33 | completa |  |
| `app/api/v1/contracts/flow/[id]/variants/[variantId]/file/route.ts` | 26 | completa |  |
| `app/api/v1/contracts/flow/[id]/variants/[variantId]/route.ts` | 52 | completa |  |
| `app/api/v1/contracts/flow/[id]/variants/route.ts` | 101 | completa |  |
| `app/api/v1/contracts/flow/[id]/word-template/route.ts` | 82 | completa | 1 |
| `app/api/v1/contracts/flow/import/route.ts` | 97 | completa |  |
| `app/api/v1/contracts/flow/route.ts` | 94 | completa |  |
| `app/api/v1/contracts/flow/rule-from-text/route.ts` | 41 | completa |  |
| `app/api/v1/contracts/learnings/[id]/route.ts` | 51 | completa |  |
| `app/api/v1/contracts/uploads/[id]/parts/[part]/route.ts` | 20 | completa |  |
| `app/api/v1/contracts/uploads/[id]/route.ts` | 26 | completa |  |
| `app/api/v1/contracts/uploads/route.ts` | 22 | completa |  |
| `app/entregar/[token]/delivery-form.tsx` | 90 | completa |  |
| `app/entregar/[token]/page.tsx` | 53 | completa |  |
| `lib/contracts/ai-analysis.ts` | 142 | completa |  |
| `lib/contracts/approval-reminders.ts` | 71 | completa |  |
| `lib/contracts/approval-rules.ts` | 69 | completa | 1 |
| `lib/contracts/approval-state.ts` | 48 | completa |  |
| `lib/contracts/archive-case-sync.ts` | 31 | completa |  |
| `lib/contracts/archive-validations.ts` | 20 | completa |  |
| `lib/contracts/archive.ts` | 160 | completa |  |
| `lib/contracts/assemble.ts` | 70 | completa |  |
| `lib/contracts/calculations.ts` | 159 | completa | 1 |
| `lib/contracts/config.ts` | 52 | completa |  |
| `lib/contracts/document-pages.ts` | 153 | completa |  |
| `lib/contracts/document-requests.ts` | 43 | completa | 1 |
| `lib/contracts/evidence.ts` | 154 | completa |  |
| `lib/contracts/extract.ts` | 123 | completa |  |
| `lib/contracts/flow-diff.ts` | 32 | completa |  |
| `lib/contracts/flow-test.ts` | 53 | completa |  |
| `lib/contracts/flow-transfer.ts` | 69 | completa |  |
| `lib/contracts/flow-versions.ts` | 79 | completa |  |
| `lib/contracts/flow.ts` | 351 | completa | 2 |
| `lib/contracts/generate.ts` | 415 | completa | 3 |
| `lib/contracts/home.ts` | 123 | completa |  |
| `lib/contracts/normalization.ts` | 119 | completa | 3 |
| `lib/contracts/ocr-boxes.ts` | 58 | completa |  |
| `lib/contracts/page-selection.ts` | 362 | completa |  |
| `lib/contracts/pipeline.ts` | 424 | completa | 4 |
| `lib/contracts/plan.ts` | 131 | completa |  |
| `lib/contracts/presets.ts` | 139 | completa |  |
| `lib/contracts/reference-codes.ts` | 70 | completa | 1 |
| `lib/contracts/reference-demo.ts` | 32 | completa |  |
| `lib/contracts/revalidate.ts` | 98 | completa |  |
| `lib/contracts/rule-from-text.ts` | 73 | completa |  |
| `lib/contracts/status.ts` | 33 | completa |  |
| `lib/contracts/trace.ts` | 86 | completa |  |
| `lib/contracts/upload-client.ts` | 31 | completa |  |
| `lib/contracts/upload-links.ts` | 117 | completa |  |
| `lib/contracts/uploads.ts` | 152 | completa | 2 |
| `lib/contracts/validate.ts` | 325 | completa | 5 |
| `lib/contracts/validation-rows.ts` | 101 | completa |  |
| `lib/contracts/visual-training.ts` | 36 | completa |  |
| `lib/contracts/word-template.ts` | 245 | completa | 1 |
| `lib/contracts/word-to-pdf.ts` | 49 | completa |  |

## Contratos: pantallas

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/(tenant)/cases/[id]/page.tsx` | 1 | completa |  |
| `app/(tenant)/cases/history/page.tsx` | 6 | completa |  |
| `app/(tenant)/cases/new-case-dialog.tsx` | 253 | completa |  |
| `app/(tenant)/cases/page.tsx` | 125 | completa |  |
| `app/(tenant)/cases/view.tsx` | 172 | completa |  |
| `app/(tenant)/contracts/[id]/actions.tsx` | 117 | completa |  |
| `app/(tenant)/contracts/[id]/ai-analysis-results.tsx` | 56 | completa |  |
| `app/(tenant)/contracts/[id]/case-activity.tsx` | 81 | completa | 2 |
| `app/(tenant)/contracts/[id]/case-checks-lazy.tsx` | 9 | completa |  |
| `app/(tenant)/contracts/[id]/case-checks.tsx` | 249 | completa | 1 |
| `app/(tenant)/contracts/[id]/case-documents.tsx` | 238 | completa | 1 |
| `app/(tenant)/contracts/[id]/case-processing-refresh.tsx` | 13 | completa |  |
| `app/(tenant)/contracts/[id]/output-downloads.tsx` | 53 | completa |  |
| `app/(tenant)/contracts/[id]/page.tsx` | 318 | completa | 4 |
| `app/(tenant)/contracts/[id]/resubmit-panel.tsx` | 132 | completa | 1 |
| `app/(tenant)/contracts/approvals/approvals-client.tsx` | 174 | completa |  |
| `app/(tenant)/contracts/approvals/page.tsx` | 86 | completa | 1 |
| `app/(tenant)/contracts/archive/client.tsx` | 186 | completa | 1 |
| `app/(tenant)/contracts/archive/page.tsx` | 12 | completa |  |
| `app/(tenant)/contracts/components/decision-dialog.tsx` | 250 | completa | 1 |
| `app/(tenant)/contracts/dashboard/page.tsx` | 137 | completa | 2 |
| `app/(tenant)/contracts/flow/[id]/page.tsx` | 15 | completa |  |
| `app/(tenant)/contracts/flow/approval-form.tsx` | 128 | completa | 1 |
| `app/(tenant)/contracts/flow/client.tsx` | 1023 | completa | 6 |
| `app/(tenant)/contracts/flow/doc-editor.tsx` | 164 | completa | 2 |
| `app/(tenant)/contracts/flow/editor-lazy.tsx` | 16 | completa |  |
| `app/(tenant)/contracts/flow/flows-list-client.tsx` | 209 | completa | 1 |
| `app/(tenant)/contracts/flow/page.tsx` | 14 | completa |  |
| `app/(tenant)/contracts/flow/rule-from-text.tsx` | 55 | completa | 1 |
| `app/(tenant)/contracts/flow/versions-panel.tsx` | 142 | completa |  |
| `app/(tenant)/contracts/flow/visual-training-workspace.tsx` | 229 | completa | 1 |
| `app/(tenant)/contracts/flow/word-template-workspace.tsx` | 156 | completa | 1 |
| `app/(tenant)/contracts/metrics/charts.tsx` | 91 | completa |  |
| `app/(tenant)/contracts/metrics/metrics-client.tsx` | 139 | completa | 4 |
| `app/(tenant)/contracts/metrics/more-metrics.tsx` | 136 | completa |  |
| `app/(tenant)/contracts/metrics/page.tsx` | 45 | completa | 1 |
| `app/(tenant)/contracts/page.tsx` | 4 | completa |  |
| `app/(tenant)/contracts/quality/page.tsx` | 31 | completa |  |
| `app/(tenant)/contracts/quality/quality-client.tsx` | 104 | completa |  |

## Gastos

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/(expenses)/expenses/[id]/item/new/item-capture-client.tsx` | 736 | completa | 3 |
| `app/(expenses)/expenses/[id]/item/new/page.tsx` | 52 | completa |  |
| `app/(expenses)/expenses/[id]/page.tsx` | 43 | completa |  |
| `app/(expenses)/expenses/[id]/report-detail.tsx` | 219 | completa | 1 |
| `app/(expenses)/expenses/new/new-report-form.tsx` | 92 | completa |  |
| `app/(expenses)/expenses/new/page.tsx` | 21 | completa |  |
| `app/(expenses)/expenses/page.tsx` | 40 | completa |  |
| `app/(expenses)/expenses/reports-list.tsx` | 89 | completa |  |
| `app/(expenses)/layout.tsx` | 43 | completa |  |
| `app/(tenant)/accounting/expenses/[id]/accounting-detail.tsx` | 524 | completa | 2 |
| `app/(tenant)/accounting/expenses/[id]/page.tsx` | 95 | completa |  |
| `app/(tenant)/accounting/expenses/accounting-list.tsx` | 202 | completa | 1 |
| `app/(tenant)/accounting/expenses/page.tsx` | 58 | completa | 1 |
| `app/api/v1/expenses/categories/[id]/route.ts` | 42 | completa | 1 |
| `app/api/v1/expenses/categories/route.ts` | 31 | completa |  |
| `app/api/v1/expenses/classes/route.ts` | 28 | completa |  |
| `app/api/v1/expenses/departments/route.ts` | 28 | completa |  |
| `app/api/v1/expenses/documents/[id]/file/route.ts` | 45 | completa | 1 |
| `app/api/v1/expenses/items/[id]/route.ts` | 114 | completa |  |
| `app/api/v1/expenses/items/route.ts` | 98 | completa | 1 |
| `app/api/v1/expenses/ocr/route.ts` | 74 | completa | 1 |
| `app/api/v1/expenses/reports/[id]/approve/route.ts` | 83 | completa |  |
| `app/api/v1/expenses/reports/[id]/reject/route.ts` | 75 | completa |  |
| `app/api/v1/expenses/reports/[id]/reopen/route.ts` | 43 | completa |  |
| `app/api/v1/expenses/reports/[id]/route.ts` | 51 | completa |  |
| `app/api/v1/expenses/reports/[id]/submit/route.ts` | 126 | completa | 1 |
| `app/api/v1/expenses/reports/[id]/sync/route.ts` | 48 | completa |  |
| `app/api/v1/expenses/reports/export/route.ts` | 120 | completa | 1 |
| `app/api/v1/expenses/reports/route.ts` | 78 | completa | 1 |
| `app/api/v1/expenses/submitters/route.ts` | 41 | completa |  |
| `app/api/v1/expenses/sync/route.ts` | 79 | completa |  |
| `app/api/v1/expenses/validate/route.ts` | 139 | completa | 1 |
| `components/expense/expense-sidebar.tsx` | 175 | completa |  |
| `lib/expense/catalog-access.ts` | 14 | completa |  |
| `lib/expense/config.ts` | 67 | completa |  |
| `lib/expense/extract.ts` | 160 | completa | 1 |
| `lib/expense/item-input.ts` | 85 | completa | 1 |
| `lib/expense/nit.ts` | 8 | completa |  |
| `lib/expense/sync-catalogs.ts` | 264 | completa | 3 |
| `lib/expense/sync-to-netsuite.ts` | 560 | completa | 7 |
| `lib/expense/tax-engine.ts` | 283 | completa | 1 |
| `lib/expense/totals.ts` | 26 | completa | 1 |

## Autenticación, seguridad e infraestructura

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `.github/workflows/ci.yml` | 36 | completa |  |
| `Dockerfile` | 59 | completa |  |
| `app/(auth)/forgot-password/page.tsx` | 98 | completa |  |
| `app/(auth)/login/page.tsx` | 166 | completa |  |
| `app/(auth)/reset-password/page.tsx` | 134 | completa |  |
| `app/(auth)/unavailable/logout-button.tsx` | 28 | completa |  |
| `app/(auth)/unavailable/page.tsx` | 39 | completa |  |
| `app/api/internal/cron/approval-reminders/route.ts` | 22 | completa |  |
| `app/api/internal/cron/auto-sync/route.ts` | 229 | completa | 3 |
| `app/api/internal/cron/expense-categories-sync/route.ts` | 76 | completa | 2 |
| `app/api/internal/cron/qa-mode/route.ts` | 23 | completa |  |
| `app/api/internal/cron/reap-stuck/route.ts` | 88 | completa | 1 |
| `app/api/internal/cron/receipt-check/route.ts` | 24 | completa |  |
| `app/api/internal/cron/retention/route.ts` | 126 | completa | 1 |
| `app/api/internal/cron/scheduled-reports/route.ts` | 176 | completa | 2 |
| `app/api/scripts/netsuite/[filename]/route.ts` | 36 | completa |  |
| `app/api/v1/audit-log/route.ts` | 32 | completa | 1 |
| `app/api/v1/auth/change-password/route.ts` | 65 | completa |  |
| `app/api/v1/auth/forgot-password/route.ts` | 77 | completa | 1 |
| `app/api/v1/auth/login/route.ts` | 110 | completa | 1 |
| `app/api/v1/auth/logout/route.ts` | 27 | completa |  |
| `app/api/v1/auth/refresh/route.ts` | 88 | completa | 1 |
| `app/api/v1/auth/reset-password/route.ts` | 79 | completa |  |
| `app/api/v1/contact/route.ts` | 67 | completa |  |
| `app/api/v1/features/dry-run/route.ts` | 49 | completa |  |
| `app/api/v1/features/route.ts` | 15 | completa |  |
| `app/api/v1/settings/api-keys/[id]/route.ts` | 35 | completa |  |
| `app/api/v1/settings/api-keys/route.ts` | 71 | completa | 1 |
| `app/api/v1/settings/features/[featureId]/route.ts` | 36 | completa |  |
| `app/api/v1/settings/route.ts` | 67 | completa |  |
| `app/api/v1/team/[userId]/reset-password/route.ts` | 38 | completa | 1 |
| `app/api/v1/team/[userId]/route.ts` | 61 | completa |  |
| `app/api/v1/team/route.ts` | 91 | completa |  |
| `app/api/v1/webhooks/[id]/route.ts` | 71 | completa |  |
| `app/api/v1/webhooks/route.ts` | 88 | completa | 1 |
| `docker-compose.yml` | 43 | completa |  |
| `instrumentation.ts` | 52 | completa |  |
| `lib/ai/batch-jobs.ts` | 125 | completa | 3 |
| `lib/ai/provider.ts` | 285 | completa | 2 |
| `lib/ai/usage.ts` | 92 | completa |  |
| `lib/audit/admin.ts` | 134 | completa |  |
| `lib/audit/log.ts` | 31 | completa |  |
| `lib/auth/admin.ts` | 25 | completa |  |
| `lib/auth/cookies.ts` | 33 | completa |  |
| `lib/auth/input.ts` | 9 | completa |  |
| `lib/auth/jwt.ts` | 172 | completa |  |
| `lib/auth/permissions.ts` | 64 | completa |  |
| `lib/auth/rate-limit.ts` | 44 | completa | 1 |
| `lib/auth/token-payload.ts` | 21 | completa |  |
| `lib/bootstrap/seed-admin.ts` | 26 | completa |  |
| `lib/bootstrap/seed-catalog.ts` | 47 | completa | 1 |
| `lib/crypto/encrypt.ts` | 54 | completa |  |
| `lib/db/index.ts` | 28 | completa |  |
| `lib/email/send.ts` | 195 | completa |  |
| `lib/env.ts` | 48 | completa |  |
| `lib/features/catalog.ts` | 740 | completa |  |
| `lib/features/index.ts` | 141 | completa | 1 |
| `lib/features/qa-mode-state.ts` | 26 | completa |  |
| `lib/features/qa-mode-sweep.ts` | 40 | completa |  |
| `lib/features/qa-mode.ts` | 83 | completa | 1 |
| `lib/features/tenant-editable.ts` | 87 | completa |  |
| `lib/features/tenant-settings.ts` | 61 | completa |  |
| `lib/numbers.ts` | 55 | completa | 1 |
| `lib/products/index.ts` | 48 | completa |  |
| `lib/products/registry.ts` | 160 | completa |  |
| `lib/queue/index.ts` | 199 | completa |  |
| `lib/scheduler/index.ts` | 138 | completa |  |
| `lib/security/docx.ts` | 81 | completa | 2 |
| `lib/security/files.ts` | 20 | completa |  |
| `lib/security/html.ts` | 25 | completa |  |
| `lib/security/http.ts` | 156 | completa |  |
| `lib/security/ip-allowlist.ts` | 41 | completa | 2 |
| `lib/security/request-ip.ts` | 11 | completa |  |
| `lib/security/return-path.ts` | 20 | completa |  |
| `lib/security/storage-key.ts` | 4 | completa |  |
| `lib/security/upload-receipt.ts` | 24 | completa |  |
| `lib/status-config.ts` | 44 | completa |  |
| `lib/status-vocabulary.ts` | 66 | completa |  |
| `lib/storage/minio.ts` | 133 | completa |  |
| `lib/subsidiaries/invoice-format.ts` | 33 | completa |  |
| `lib/utils.ts` | 6 | completa |  |
| `lib/webhooks/deliver.ts` | 77 | completa |  |
| `lib/webhooks/ssrf.ts` | 101 | completa | 1 |
| `next.config.ts` | 41 | completa | 1 |
| `proxy.ts` | 85 | completa |  |

## Superadmin y configuración

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `app/(admin)/admin/administrators/page.tsx` | 26 | completa |  |
| `app/(admin)/admin/audit/audit-view.tsx` | 55 | completa |  |
| `app/(admin)/admin/audit/page.tsx` | 8 | completa |  |
| `app/(admin)/admin/clients/[id]/activity/page.tsx` | 17 | completa |  |
| `app/(admin)/admin/clients/[id]/erp/erp-view.tsx` | 262 | completa |  |
| `app/(admin)/admin/clients/[id]/erp/page.tsx` | 62 | completa |  |
| `app/(admin)/admin/clients/[id]/features/features-view.tsx` | 248 | completa | 1 |
| `app/(admin)/admin/clients/[id]/features/page.tsx` | 72 | completa |  |
| `app/(admin)/admin/clients/[id]/layout.tsx` | 40 | completa |  |
| `app/(admin)/admin/clients/[id]/page.tsx` | 103 | completa | 1 |
| `app/(admin)/admin/clients/[id]/usage/page.tsx` | 96 | completa | 1 |
| `app/(admin)/admin/clients/[id]/users/page.tsx` | 24 | completa |  |
| `app/(admin)/admin/clients/[id]/users/users-view.tsx` | 127 | completa |  |
| `app/(admin)/admin/clients/clients-view.tsx` | 201 | completa | 1 |
| `app/(admin)/admin/clients/new/page.tsx` | 9 | completa |  |
| `app/(admin)/admin/clients/new/wizard.tsx` | 447 | completa | 2 |
| `app/(admin)/admin/clients/page.tsx` | 31 | completa |  |
| `app/(admin)/admin/features/page.tsx` | 149 | completa | 2 |
| `app/(admin)/admin/layout.tsx` | 20 | completa |  |
| `app/(admin)/admin/login/page.tsx` | 194 | completa |  |
| `app/(admin)/admin/metrics/page.tsx` | 131 | completa |  |
| `app/(admin)/admin/monitor-view.tsx` | 132 | completa | 1 |
| `app/(admin)/admin/page.tsx` | 15 | completa |  |
| `app/(tenant)/settings/client.tsx` | 1427 | completa | 5 |
| `app/(tenant)/settings/page.tsx` | 143 | completa |  |
| `app/(tenant)/settings/team-tab.tsx` | 268 | completa |  |
| `app/api/admin/audit/route.ts` | 73 | completa | 1 |
| `app/api/admin/auth/login/route.ts` | 92 | completa |  |
| `app/api/admin/auth/logout/route.ts` | 27 | completa |  |
| `app/api/admin/auth/refresh/route.ts` | 71 | completa |  |
| `app/api/admin/clients/[id]/ai-config/route.ts` | 92 | completa |  |
| `app/api/admin/clients/[id]/connection/route.ts` | 208 | completa | 3 |
| `app/api/admin/clients/[id]/connection/test/route.ts` | 58 | completa |  |
| `app/api/admin/clients/[id]/environment/route.ts` | 72 | completa | 1 |
| `app/api/admin/clients/[id]/expenses/categories/route.ts` | 51 | completa | 1 |
| `app/api/admin/clients/[id]/expenses/route.ts` | 120 | completa |  |
| `app/api/admin/clients/[id]/features/[featureId]/route.ts` | 84 | completa |  |
| `app/api/admin/clients/[id]/logs/route.ts` | 41 | completa |  |
| `app/api/admin/clients/[id]/products/route.ts` | 103 | completa |  |
| `app/api/admin/clients/[id]/route.ts` | 160 | completa | 2 |
| `app/api/admin/clients/[id]/subsidiaries/[subId]/route.ts` | 104 | completa | 1 |
| `app/api/admin/clients/[id]/subsidiaries/route.ts` | 100 | completa |  |
| `app/api/admin/clients/[id]/sync/route.ts` | 37 | completa |  |
| `app/api/admin/clients/[id]/users/[userId]/route.ts` | 65 | completa |  |
| `app/api/admin/clients/[id]/users/route.ts` | 91 | completa |  |
| `app/api/admin/clients/route.ts` | 141 | completa | 1 |
| `app/api/admin/features/[id]/route.ts` | 68 | completa | 1 |
| `app/api/admin/features/route.ts` | 49 | completa | 1 |
| `app/api/admin/metrics/today/route.ts` | 17 | completa |  |
| `app/api/admin/ns/probe-scripts/route.ts` | 32 | completa |  |
| `app/api/admin/ns/subsidiaries/route.ts` | 36 | completa |  |
| `app/api/admin/ns/test-connection/route.ts` | 33 | completa |  |
| `app/api/admin/platform-admins/[adminId]/route.ts` | 116 | completa |  |
| `app/api/admin/platform-admins/route.ts` | 100 | completa |  |
| `app/api/admin/storage/init/route.ts` | 22 | completa |  |
| `components/admin/admin-layout-client.tsx` | 24 | completa |  |
| `components/admin/admin-rail.tsx` | 67 | completa |  |
| `components/admin/audit-feed.tsx` | 87 | completa | 1 |
| `components/admin/client-lifecycle-dialog.tsx` | 163 | completa | 1 |
| `components/admin/client-panel.tsx` | 167 | completa | 2 |
| `components/admin/client-tabs.tsx` | 34 | completa |  |
| `components/admin/custom-form-config.tsx` | 191 | completa |  |
| `components/admin/feature-config-panel.tsx` | 134 | completa |  |
| `components/admin/filter-link.tsx` | 20 | completa |  |
| `components/admin/form.tsx` | 147 | completa |  |
| `components/admin/platform-admins-client.tsx` | 95 | completa |  |
| `components/admin/product-art.tsx` | 121 | completa |  |
| `components/admin/ui.tsx` | 160 | completa |  |
| `lib/admin/ai-metrics.ts` | 117 | completa | 1 |
| `lib/admin/health.ts` | 241 | completa |  |
| `lib/admin/monitor.ts` | 189 | completa | 5 |
| `lib/admin/purge-org.ts` | 180 | completa | 3 |

## Base de datos, scripts y tests

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `db/migrations/0000_baseline.sql` | 645 | completa |  |
| `db/migrations/0001_products.sql` | 25 | completa |  |
| `db/migrations/0002_contracts.sql` | 104 | completa |  |
| `db/migrations/0003_contract_approval.sql` | 2 | completa |  |
| `db/migrations/0004_smooth_blindfold.sql` | 12 | completa |  |
| `db/migrations/0005_equal_black_queen.sql` | 1 | completa |  |
| `db/migrations/0006_nifty_mercury.sql` | 3 | completa |  |
| `db/migrations/0007_remove_white_label.sql` | 3 | completa |  |
| `db/migrations/0008_contract_features.sql` | 1 | completa |  |
| `db/migrations/0009_contract_extraction_learning.sql` | 16 | completa |  |
| `db/migrations/0010_contract_visual_training.sql` | 19 | completa |  |
| `db/migrations/0011_open_dragon_lord.sql` | 26 | completa |  |
| `db/migrations/0012_exception_document_link.sql` | 2 | completa |  |
| `db/migrations/0013_approver_accountant_roles.sql` | 2 | completa |  |
| `db/migrations/0014_ap_po_matching.sql` | 26 | completa |  |
| `db/migrations/0015_fantastic_fat_cobra.sql` | 73 | completa |  |
| `db/migrations/0016_org_lifecycle.sql` | 2 | completa |  |
| `db/migrations/0017_ai_batches.sql` | 28 | completa |  |
| `db/migrations/0018_status_events.sql` | 34 | completa |  |
| `db/migrations/0019_subsidiary_invoice_format.sql` | 3 | completa |  |
| `db/migrations/0020_qa_mode_documents.sql` | 2 | completa |  |
| `db/migrations/0021_retire_obligations.sql` | 5 | completa |  |
| `db/migrations/0022_learning_retired_at.sql` | 3 | completa |  |
| `db/migrations/0023_document_requests.sql` | 2 | completa |  |
| `db/migrations/0024_flow_versions.sql` | 19 | completa |  |
| `db/migrations/0025_validation_evidence.sql` | 1 | completa |  |
| `db/migrations/0026_doc_metrics.sql` | 1 | completa |  |
| `db/migrations/0027_contractor_upload_links.sql` | 17 | completa |  |
| `db/schema/ai-batches.ts` | 36 | completa | 1 |
| `db/schema/audit.ts` | 20 | completa |  |
| `db/schema/connections.ts` | 46 | completa |  |
| `db/schema/contract-archive.ts` | 84 | completa |  |
| `db/schema/contracts.ts` | 262 | completa |  |
| `db/schema/documents.ts` | 129 | completa | 1 |
| `db/schema/expenses.ts` | 201 | completa |  |
| `db/schema/features.ts` | 39 | completa |  |
| `db/schema/index.ts` | 19 | completa |  |
| `db/schema/organizations.ts` | 81 | completa |  |
| `db/schema/plans.ts` | 118 | completa |  |
| `db/schema/platform.ts` | 113 | completa |  |
| `db/schema/products.ts` | 34 | completa |  |
| `db/schema/rate-limits.ts` | 12 | completa |  |
| `db/schema/relations.ts` | 102 | completa |  |
| `db/schema/status-events.ts` | 19 | completa |  |
| `db/schema/subsidiaries.ts` | 124 | completa | 1 |
| `db/schema/users.ts` | 16 | completa |  |
| `db/schema/vendor-rules.ts` | 22 | completa |  |
| `db/schema/webhooks.ts` | 18 | completa |  |
| `drizzle.config.ts` | 10 | completa |  |
| `scripts/_load-env.ts` | 6 | completa |  |
| `scripts/backfill-contract-flows.ts` | 47 | completa |  |
| `scripts/create-admin.ts` | 50 | completa |  |
| `scripts/e2e-admin-tab-test.mjs` | 93 | completa |  |
| `scripts/e2e-email-check.mjs` | 44 | completa |  |
| `scripts/e2e-expense-test.mjs` | 353 | completa | 1 |
| `scripts/e2e-ui-test.mjs` | 64 | completa |  |
| `scripts/migrate-feature-grants.ts` | 28 | completa | 1 |
| `scripts/migrate.mjs` | 37 | completa |  |
| `scripts/netsuite/docuia-catalog-v1.js` | 414 | completa | 5 |
| `scripts/netsuite/docuia-process-v1.js` | 567 | completa | 14 |
| `scripts/ns-bill-probe.ts` | 103 | completa | 1 |
| `scripts/ns-demo-scan.ts` | 160 | completa |  |
| `scripts/remove-bg.mjs` | 50 | completa |  |
| `scripts/reset-admin-password.ts` | 20 | completa | 1 |
| `scripts/run-qa-sweep.ts` | 8 | completa |  |
| `scripts/security-integration.mjs` | 124 | completa | 1 |
| `scripts/security-public-check.mjs` | 17 | completa |  |
| `scripts/security-storage-test.ts` | 47 | completa |  |
| `scripts/seed-demo.ts` | 374 | completa | 1 |
| `scripts/seed-expense-rules.ts` | 36 | completa | 1 |
| `scripts/seed-features.ts` | 27 | completa |  |
| `scripts/seed-products.ts` | 70 | completa | 1 |
| `scripts/take-screenshots.mjs` | 159 | completa | 1 |
| `tests/ai-provider.test.ts` | 17 | completa |  |
| `tests/ai-usage.test.ts` | 53 | completa |  |
| `tests/ap-extract.test.ts` | 77 | completa |  |
| `tests/ap-metrics.test.ts` | 58 | completa |  |
| `tests/ap-redesign.test.ts` | 77 | completa |  |
| `tests/cfdi-po-reference.test.ts` | 14 | completa |  |
| `tests/cfdi-validation.test.ts` | 55 | completa |  |
| `tests/cfdi.test.ts` | 51 | completa |  |
| `tests/contract-approval-rules.test.ts` | 60 | completa |  |
| `tests/contract-archive-flow.test.ts` | 20 | completa |  |
| `tests/contract-evidence.test.ts` | 57 | completa |  |
| `tests/contract-flow-versions.test.ts` | 48 | completa |  |
| `tests/contract-page-selection.test.ts` | 94 | completa |  |
| `tests/contract-reference-codes.test.ts` | 24 | completa |  |
| `tests/contracts.test.ts` | 58 | completa |  |
| `tests/expenses.test.ts` | 50 | completa |  |
| `tests/features-phase1.test.ts` | 93 | completa |  |
| `tests/flow-transfer.test.ts` | 41 | completa |  |
| `tests/integration-contract-archive.ts` | 109 | completa |  |
| `tests/ns-payload.test.ts` | 56 | completa |  |
| `tests/numbers.test.ts` | 34 | completa |  |
| `tests/pending-features.test.ts` | 147 | completa |  |
| `tests/po-match.test.ts` | 108 | completa |  |
| `tests/roles.test.ts` | 44 | completa |  |
| `tests/security.test.ts` | 170 | completa |  |
| `tests/session.test.ts` | 77 | completa |  |
| `tests/word-template.test.ts` | 58 | completa |  |

## Componentes compartidos y landing

| Archivo | Líneas | Lectura | Hallazgos |
|---|---:|---|---:|
| `DESIGN.json` | 235 | completa |  |
| `app/dev/kit/page.tsx` | 94 | completa |  |
| `app/layout.tsx` | 29 | completa |  |
| `app/legal/privacidad/page.tsx` | 106 | completa |  |
| `app/legal/terminos/page.tsx` | 108 | completa |  |
| `app/page.tsx` | 19 | completa |  |
| `app/planes/page.tsx` | 126 | completa |  |
| `app/productos/contratos/page.tsx` | 19 | completa |  |
| `app/productos/facturas/page.tsx` | 19 | completa |  |
| `app/productos/gastos/page.tsx` | 19 | completa |  |
| `components.json` | 25 | completa |  |
| `components/kit/actions.tsx` | 51 | completa |  |
| `components/kit/charts.tsx` | 219 | completa | 3 |
| `components/kit/drawer.tsx` | 62 | completa | 1 |
| `components/kit/empty-state.tsx` | 19 | completa |  |
| `components/kit/index.ts` | 11 | completa |  |
| `components/kit/notice.tsx` | 35 | completa |  |
| `components/kit/page-frame.tsx` | 15 | completa | 1 |
| `components/kit/page-header.tsx` | 47 | completa |  |
| `components/kit/palette.ts` | 8 | completa |  |
| `components/kit/stage-nav.tsx` | 94 | completa |  |
| `components/kit/status-pill.tsx` | 35 | completa |  |
| `components/landing/ap-automation-client.tsx` | 184 | completa |  |
| `components/landing/contract-intelligence-client.tsx` | 269 | completa |  |
| `components/landing/expense-management-client.tsx` | 198 | completa |  |
| `components/landing/landing-client.tsx` | 774 | completa | 3 |
| `components/landing/site-chrome.tsx` | 262 | completa | 8 |
| `components/providers/feature-provider.tsx` | 44 | completa |  |
| `components/providers/session-refresh.tsx` | 110 | completa | 3 |
| `components/ui/alert.tsx` | 76 | completa |  |
| `components/ui/avatar.tsx` | 109 | completa |  |
| `components/ui/badge.tsx` | 52 | completa |  |
| `components/ui/button.tsx` | 58 | completa |  |
| `components/ui/card.tsx` | 103 | completa |  |
| `components/ui/dialog.tsx` | 160 | completa |  |
| `components/ui/dropdown-menu.tsx` | 268 | completa |  |
| `components/ui/form-select.tsx` | 30 | completa |  |
| `components/ui/input.tsx` | 20 | completa |  |
| `components/ui/label.tsx` | 20 | completa |  |
| `components/ui/progress.tsx` | 83 | completa |  |
| `components/ui/scroll-area.tsx` | 55 | completa |  |
| `components/ui/select-menu.tsx` | 121 | completa | 1 |
| `components/ui/select.tsx` | 201 | completa |  |
| `components/ui/separator.tsx` | 25 | completa |  |
| `components/ui/sheet.tsx` | 138 | completa |  |
| `components/ui/skeleton.tsx` | 13 | completa |  |
| `components/ui/switch.tsx` | 32 | completa |  |
| `components/ui/table.tsx` | 116 | completa |  |
| `components/ui/tabs.tsx` | 82 | completa |  |
| `components/ui/textarea.tsx` | 18 | completa |  |
| `components/ui/tooltip.tsx` | 66 | completa |  |
| `eslint.config.mjs` | 22 | completa |  |
| `package.json` | 86 | completa | 2 |
| `postcss.config.mjs` | 7 | completa |  |
| `public/pdf.worker.min.mjs` | 28 | omitido: binario a efectos prácticos: bundle minificado de terceros ( |  |
| `tsconfig.json` | 34 | completa |  |

