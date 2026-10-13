import type { RenderedLetter } from "./layout";
import { buildZip } from "./zip";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Control characters are not allowed in XML text.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

type Run = { text: string; bold?: boolean; size?: number; color?: string };

function paragraph(runs: Run[], opts: { after?: number; align?: "left" | "center" | "right" | "both" } = {}): string {
  const rs = runs
    .map((r) => {
      const props = [
        '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>',
        r.bold ? "<w:b/>" : "",
        r.color ? `<w:color w:val="${r.color}"/>` : "",
        `<w:sz w:val="${r.size ?? 22}"/>`,
      ].join("");
      return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
    })
    .join("");
  const ppr = `<w:pPr><w:spacing w:after="${opts.after ?? 200}" w:line="276" w:lineRule="auto"/>${opts.align ? `<w:jc w:val="${opts.align}"/>` : ""}</w:pPr>`;
  return `<w:p>${ppr}${rs}</w:p>`;
}

/** The letter as a Word document: the same content as the preview, as plain editable paragraphs. */
export function buildDocx(l: RenderedLetter, now: Date = new Date()): Buffer {
  const body: string[] = [];

  if (l.banner) body.push(paragraph([{ text: l.banner, bold: true, color: "B3261E", size: 20 }], { after: 240 }));

  l.letterhead.forEach((line, i) =>
    body.push(paragraph([{ text: line, bold: i === 0, size: i === 0 ? 30 : 20 }], { after: i === l.letterhead.length - 1 ? 360 : 40, align: "right" }))
  );

  body.push(paragraph([{ text: l.dateText }], { after: 240 }));
  l.recipientLines.forEach((line, i) => body.push(paragraph([{ text: line }], { after: i === l.recipientLines.length - 1 ? 240 : 0 })));
  if (l.greeting) body.push(paragraph([{ text: l.greeting }]));
  if (l.subject) body.push(paragraph([{ text: l.subject, bold: true }], { after: 240 }));
  l.paragraphs.forEach((p) => {
    // A line break inside a paragraph is kept as a Word line break.
    const parts = p.split("\n");
    const runs: string = parts
      .map((t, i) => `${i > 0 ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`)
      .join("");
    body.push(`<w:p><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${runs}</w:p>`);
  });
  if (l.closing) body.push(paragraph([{ text: l.closing }], { after: 120 }));
  l.signature.forEach((line, i) => body.push(paragraph([{ text: line, bold: i === 2 }], { after: 0 })));
  if (l.footer) body.push(paragraph([{ text: l.footer, size: 18, color: "6B6B6B" }], { after: 0 }));

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join("") +
    // A4, 2 cm margins.
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    "</w:body></w:document>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const enc = (s: string) => new TextEncoder().encode(s);
  return buildZip(
    [
      { name: "[Content_Types].xml", data: enc(contentTypes) },
      { name: "_rels/.rels", data: enc(rels) },
      { name: "word/document.xml", data: enc(documentXml) },
    ],
    now
  );
}
