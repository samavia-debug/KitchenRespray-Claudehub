import type { RenderedLetter } from "./layout";
import { LETTERHEAD, mmToEmu, mmToTwips } from "./letterhead";
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

/** Runs of the letter's text in the body font, with bold and italic where the text has them. */
function runsXml(runs: { text: string; bold?: boolean; italic?: boolean }[]): string {
  return runs
    .map(
      (r) =>
        `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`
    )
    .join("");
}

/**
 * The letterhead artwork as a full-page picture in the page header, behind the text, so it is on every page and
 * the letter's own text stays editable on top of it.
 */
function artworkHeader(): string {
  const cx = mmToEmu(LETTERHEAD.pageWidthMm);
  const cy = mmToEmu(LETTERHEAD.pageHeightMm);
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    '<wp:docPr id="1" name="Letterhead" descr="Company letterhead"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="letterhead.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    "</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>"
  );
}

export type SignatureImage = { data: Uint8Array; type: "png" | "jpeg"; width: number; height: number };

const SIGNATURE_HEIGHT_MM = 15;
const SIGNATURE_MAX_WIDTH_MM = 60;

/** The signature picture on its own line, where the room to sign was: 15 mm high, or narrower if it is a wide one. */
function signaturePicture(sig: SignatureImage): string {
  const aspect = sig.height > 0 ? sig.width / sig.height : 3;
  const heightMm = Math.min(SIGNATURE_HEIGHT_MM, SIGNATURE_MAX_WIDTH_MM / aspect);
  const cy = mmToEmu(heightMm);
  const cx = Math.round(cy * aspect);
  return (
    '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:docPr id="2" name="Signature" descr="Signature"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="signature"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdSign"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  );
}

/**
 * The letter as a Word document: the same content as the preview, as plain editable paragraphs. With `artwork`
 * (the letterhead picture) it is placed behind every page and the margins keep the text clear of its header and footer.
 * With `signature` (the signer's picture) it is placed above the typed name, in the room left to sign.
 */
export function buildDocx(l: RenderedLetter, now: Date = new Date(), artwork?: Uint8Array, signature?: SignatureImage): Buffer {
  const body: string[] = [];

  if (l.banner) body.push(paragraph([{ text: l.banner, bold: true, color: "B3261E", size: 20 }], { after: 240 }));

  l.letterhead.forEach((line, i) =>
    body.push(paragraph([{ text: line, bold: i === 0, size: i === 0 ? 30 : 20 }], { after: i === l.letterhead.length - 1 ? 360 : 40, align: "right" }))
  );

  body.push(paragraph([{ text: l.dateText }], { after: 240 }));
  l.recipientLines.forEach((line, i) => body.push(paragraph([{ text: line }], { after: i === l.recipientLines.length - 1 ? 240 : 0 })));
  if (l.greeting) body.push(paragraph([{ text: l.greeting }]));
  if (l.subject) body.push(paragraph([{ text: l.subject, bold: true }], { after: 240 }));
  l.blocks.forEach((block) => {
    if (block.kind === "text") {
      // A line break inside a paragraph is kept as a Word line break.
      const runs = block.lines.map((line, i) => `${i > 0 ? "<w:r><w:br/></w:r>" : ""}${runsXml(line)}`).join("");
      body.push(`<w:p><w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>${runs}</w:p>`);
      return;
    }
    // A list as indented lines with a hanging bullet or number, so it needs no list definitions and edits like any text.
    block.items.forEach((item, i) => {
      const last = i === block.items.length - 1;
      const marker = block.ordered ? `${i + 1}.` : "•";
      body.push(
        `<w:p><w:pPr><w:spacing w:after="${last ? 200 : 60}" w:line="276" w:lineRule="auto"/><w:ind w:left="567" w:hanging="283"/></w:pPr>` +
          `${runsXml([{ text: marker }])}<w:r><w:tab/></w:r>${runsXml(item)}</w:p>`
      );
    });
  });
  if (l.closing) body.push(paragraph([{ text: l.closing }], { after: 120 }));
  if (signature) {
    // The picture takes the place of the two blank lines left to sign in.
    body.push(signaturePicture(signature));
    l.signature.slice(2).forEach((line, i) => body.push(paragraph([{ text: line, bold: i === 0 }], { after: 0 })));
  } else {
    l.signature.forEach((line, i) => body.push(paragraph([{ text: line, bold: i === 2 }], { after: 0 })));
  }
  if (l.footer) body.push(paragraph([{ text: l.footer, size: 18, color: "6B6B6B" }], { after: 0 }));

  // A4. Plain: 2 cm margins. On the letterhead: clear of its header bar and contact bar.
  const margins = artwork
    ? `w:top="${mmToTwips(LETTERHEAD.topMm)}" w:right="${mmToTwips(LETTERHEAD.sideMm)}" w:bottom="${mmToTwips(LETTERHEAD.bottomMm)}" w:left="${mmToTwips(LETTERHEAD.sideMm)}" w:header="0" w:footer="0"`
    : 'w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708"';
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
    body.join("") +
    `<w:sectPr>${artwork ? '<w:headerReference w:type="default" r:id="rIdHeader"/>' : ""}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar ${margins} w:gutter="0"/></w:sectPr>` +
    "</w:body></w:document>";

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (artwork || signature?.type === "png" ? '<Default Extension="png" ContentType="image/png"/>' : "") +
    (signature?.type === "jpeg" ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : "") +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    (artwork ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "") +
    "</Types>";

  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    "</Relationships>";

  const enc = (s: string) => new TextEncoder().encode(s);
  const parts: { name: string; data: Uint8Array }[] = [
    { name: "[Content_Types].xml", data: enc(contentTypes) },
    { name: "_rels/.rels", data: enc(rels) },
    { name: "word/document.xml", data: enc(documentXml) },
  ];
  const relationships = (items: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
  const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const signatureFile = signature ? `signature.${signature.type === "png" ? "png" : "jpg"}` : "";

  const documentRels = [
    artwork ? `<Relationship Id="rIdHeader" Type="${office}/header" Target="header1.xml"/>` : "",
    signature ? `<Relationship Id="rIdSign" Type="${office}/image" Target="media/${signatureFile}"/>` : "",
  ].join("");
  if (documentRels) parts.push({ name: "word/_rels/document.xml.rels", data: enc(relationships(documentRels)) });
  if (artwork) {
    parts.push(
      { name: "word/header1.xml", data: enc(artworkHeader()) },
      { name: "word/_rels/header1.xml.rels", data: enc(relationships(`<Relationship Id="rIdImage" Type="${office}/image" Target="media/letterhead.png"/>`)) },
      { name: "word/media/letterhead.png", data: artwork }
    );
  }
  if (signature) parts.push({ name: `word/media/${signatureFile}`, data: signature.data });
  return buildZip(parts, now);
}
