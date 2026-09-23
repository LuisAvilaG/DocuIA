import test from "node:test";
import assert from "node:assert/strict";
import PizZip from "pizzip";
import { fillWordTemplate, type WordTemplateConfig } from "../lib/contracts/word-template";

function docx(body: string): Buffer {
  const zip = new PizZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return Buffer.from(zip.generate({ type: "nodebuffer" }));
}

function documentXml(buffer: Buffer): string {
  return new PizZip(buffer).file("word/document.xml")!.asText();
}

function text(xml: string): string {
  return [...xml.matchAll(/<w:t\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("");
}

const base: Omit<WordTemplateConfig, "mappings"> = {
  storageKey: "k", originalName: "t.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

test("an anchor selected across a tab and split runs is filled", () => {
  const source = docx(`<w:p><w:r><w:t>Valor</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">del  contrato</w:t></w:r></w:p>`);
  const out = documentXml(fillWordTemplate(source, {
    ...base,
    mappings: [{ id: "1", anchorText: "Valor del contrato", fieldKey: "valor", fieldLabel: "Valor" }],
  }, { valor: "$ 1.000" }));
  assert.equal(text(out), "$ 1.000");
  assert.doesNotMatch(out, /<w:tab\/>/, "the tab inside the selection is replaced too");
});

test("empty self-closing runs do not swallow neighbouring text", () => {
  const source = docx(`<w:p><w:r><w:t/></w:r><w:r><w:t>Cliente</w:t></w:r></w:p>`);
  const out = documentXml(fillWordTemplate(source, {
    ...base, mappings: [{ id: "1", anchorText: "Cliente", fieldKey: "cliente", fieldLabel: "Cliente" }],
  }, { cliente: "ACME" }));
  assert.equal(text(out), "ACME");
  assert.match(out, /<w:t\/>/);
});

test("table rows repeat with spaced placeholders and plain lists", () => {
  const row = `<w:tr><w:tc><w:p><w:r><w:t>{{repeat:amparos}}{{ nombre }} - {{index}}</w:t></w:r></w:p></w:tc></w:tr>`;
  const out = documentXml(fillWordTemplate(docx(`<w:tbl>${row}</w:tbl>`), {
    ...base, mappings: [],
    tableRepeats: [{ id: "r", rowAnchorText: "{{repeat:amparos}}", fieldKey: "amparos", fieldLabel: "Amparos" }],
  }, { amparos: [{ nombre: "Cumplimiento" }, { nombre: "Calidad" }] }));
  assert.equal(text(out), "Cumplimiento - 1Calidad - 2");

  const listRow = `<w:tr><w:tc><w:p><w:r><w:t>{{repeat:asegurados}}{{item}}</w:t></w:r></w:p></w:tc></w:tr>`;
  const listOut = documentXml(fillWordTemplate(docx(`<w:tbl>${listRow}</w:tbl>`), {
    ...base, mappings: [],
    tableRepeats: [{ id: "r", rowAnchorText: "{{repeat:asegurados}}", fieldKey: "asegurados", fieldLabel: "Asegurados" }],
  }, { asegurados: ["Ana", "Luis"] }));
  assert.equal(text(listOut), "AnaLuis");
});
