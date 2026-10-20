import { deflateRawSync } from "zlib";
import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "@/lib/letters/zip";
import { decodeCsv, detectDelimiter, parseCsv } from "./csv";
import { ImportFileError, MAX_IMPORT_ROWS, parseSpreadsheet } from "./parse";
import { decodeXml, readXlsx } from "./xlsx-read";
import { openZip, ZipError } from "./zip-read";

// ---- Test helpers: build workbooks the way Excel does (compressed), and by hand (stored) ----

function deflatedZip(files: { name: string; text: string }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.text, "utf8");
    const packed = deflateRawSync(raw);
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function workbook(opts: { sheetXml: string; shared?: string[]; hyperlinks?: Record<string, string>; sheetNames?: string[] }): Buffer {
  const names = opts.sheetNames ?? ["Leads"];
  const files = [
    { name: "[Content_Types].xml", text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: "xl/workbook.xml", text: `<?xml version="1.0"?><workbook ${NS}><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", text: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
    { name: "xl/worksheets/sheet1.xml", text: opts.sheetXml },
    { name: "xl/worksheets/sheet2.xml", text: `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Second</t></is></c></row></sheetData></worksheet>` },
  ];
  if (opts.shared) files.push({ name: "xl/sharedStrings.xml", text: `<sst ${NS}>${opts.shared.map((s) => `<si>${s}</si>`).join("")}</sst>` });
  if (opts.hyperlinks) {
    const ids = Object.keys(opts.hyperlinks);
    files.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", text: `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ids.map((ref, i) => `<Relationship Id="rId${i + 1}" Type="x/hyperlink" Target="${opts.hyperlinks![ref]}" TargetMode="External"/>`).join("")}</Relationships>` });
  }
  return deflatedZip(files);
}

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and line breaks inside quotes", () => {
    const rows = parseCsv('Name,Address,Note\r\n"Ace, Roofing","1 Main St\nDublin","He said ""hi"""\r\nBeta,,\r\n');
    expect(rows).toEqual([["Name", "Address", "Note"], ["Ace, Roofing", "1 Main St\nDublin", 'He said "hi"'], ["Beta", "", ""]]);
  });

  it("copes with LF, CR and a missing final newline, and drops empty rows", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2\r")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv(",,\n x ,,")).toEqual([[" x ", "", ""]]);
  });

  it("detects semicolon and tab files", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter('"a,b",c')).toBe(",");
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("decodes UTF-8 with a BOM, and falls back to Windows-1252", () => {
    expect(decodeCsv(Buffer.from("﻿Name\nCafé", "utf8"))).toBe("Name\nCafé");
    expect(decodeCsv(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe("Café");
  });
});

describe("readXlsx", () => {
  it("reads shared strings, inline strings, numbers and booleans from a compressed workbook", () => {
    const sheetXml = `<worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>4.5</v></c><c r="C2" t="inlineStr"><is><t>inline</t></is></c></row>
      <row r="3"><c r="A3" t="s"><v>4</v></c><c r="C3" t="b"><v>1</v></c></row>
    </sheetData></worksheet>`;
    const rows = readXlsx(workbook({ sheetXml, shared: ["<t>Company</t>", "<t>Rating</t>", "<t>Flag</t>", "<t>Ace &amp; Sons</t>", '<r><t>Rich </t></r><r><t xml:space="preserve">text</t></r><rPh><t>ignored</t></rPh>'] })).rows;
    expect(rows).toEqual([["Company", "Rating", "Flag"], ["Ace & Sons", "4.5", "inline"], ["Rich text", "", "TRUE"]]);
  });

  it("puts cells in the right column when some are missing, and skips empty rows", () => {
    const sheetXml = `<worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c><c r="D1" t="inlineStr"><is><t>D</t></is></c></row>
      <row r="2"/>
      <row r="5"><c r="C5" t="inlineStr"><is><t>c5</t></is></c></row>
    </sheetData></worksheet>`;
    expect(readXlsx(workbook({ sheetXml })).rows).toEqual([["A", "", "", "D"], ["", "", "c5", ""]]);
  });

  it("uses a hyperlink's address in place of its label, and strips mailto:", () => {
    const sheetXml = `<worksheet ${NS}><sheetData>
      <row r="1"><c r="A1" t="inlineStr"><is><t>Maps</t></is></c><c r="B1" t="inlineStr"><is><t>Email</t></is></c></row>
      <row r="2"><c r="A2" t="inlineStr"><is><t>View on Maps</t></is></c><c r="B2" t="inlineStr"><is><t>mail me</t></is></c></row>
    </sheetData><hyperlinks><hyperlink ref="A2" r:id="rId1"/><hyperlink ref="B2" r:id="rId2"/></hyperlinks></worksheet>`;
    const rows = readXlsx(workbook({ sheetXml, hyperlinks: { A2: "https://maps.example/place/1", B2: "mailto:info@ace.example" } })).rows;
    expect(rows[1]).toEqual(["https://maps.example/place/1", "info@ace.example"]);
  });

  it("writes long numbers out in full, not in scientific notation", () => {
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>3.53871234567E+11</v></c></row></sheetData></worksheet>`;
    expect(readXlsx(workbook({ sheetXml })).rows[0][0]).toBe("353871234567");
  });

  it("can read another sheet, lists their names, and falls back to the first for a bad index", () => {
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c></row></sheetData></worksheet>`;
    const file = workbook({ sheetXml, sheetNames: ["Builders", "Carpenters"] });
    expect(readXlsx(file, 1)).toMatchObject({ sheets: ["Builders", "Carpenters"], sheetIndex: 1, rows: [["Second"]] });
    expect(readXlsx(file, 9).rows).toEqual([["First"]]);
  });

  it("decodes XML entities including numeric ones", () => {
    expect(decodeXml("A &amp; B &lt;c&gt; &#233; &#x20AC; &bogus; &#0;")).toBe("A & B <c> é € &bogus; ");
  });

  it("also reads a workbook that stores its parts uncompressed", () => {
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>stored</t></is></c></row></sheetData></worksheet>`;
    const stored = buildZip([
      { name: "xl/workbook.xml", data: Buffer.from(`<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", data: Buffer.from('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>') },
      { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml) },
    ]);
    expect(readXlsx(stored).rows).toEqual([["stored"]]);
  });
});

describe("openZip is strict about what it opens", () => {
  it("refuses something that is not a zip, and a truncated one", () => {
    expect(() => openZip(Buffer.from("this is plain text, not a workbook at all"))).toThrow(ZipError);
    const good = deflatedZip([{ name: "a.txt", text: "hello" }]);
    expect(() => openZip(good.subarray(0, 25))).toThrow(ZipError);
  });

  it("refuses an encrypted entry", () => {
    const file = deflatedZip([{ name: "a.txt", text: "hello" }]);
    // Set the "encrypted" bit in the central directory entry.
    const dirAt = file.readUInt32LE(file.length - 22 + 16);
    file.writeUInt16LE(file.readUInt16LE(dirAt + 8) | 1, dirAt + 8);
    expect(() => openZip(file)).toThrow(/password/i);
  });

  it("will not unpack more than an entry says it contains", () => {
    const file = deflatedZip([{ name: "a.txt", text: "x".repeat(10_000) }]);
    const dirAt = file.readUInt32LE(file.length - 22 + 16);
    file.writeUInt32LE(100, dirAt + 24); // claims to be 100 bytes
    expect(() => openZip(file).read("a.txt")).toThrow(/damaged/);
  });

  it("refuses a part declared as enormous", () => {
    const file = deflatedZip([{ name: "a.txt", text: "hello" }]);
    const dirAt = file.readUInt32LE(file.length - 22 + 16);
    file.writeUInt32LE(200 * 1024 * 1024, dirAt + 24);
    expect(() => openZip(file)).toThrow(/too large/i);
  });
});

describe("parseSpreadsheet", () => {
  const csv = (text: string, name = "leads.csv") => parseSpreadsheet(name, Buffer.from(text));

  it("takes the first row as headings, drops empty rows and columns, and tidies the headings", () => {
    const r = csv("Company Name, Company  Website ,,Company Name\nAce,ace.ie,,x\n,,,\nBeta,,,y\n");
    expect(r.headers).toEqual(["Company Name", "Company Website", "Company Name (2)"]);
    expect(r.rows).toEqual([["Ace", "ace.ie", "x"], ["Beta", "", "y"]]);
  });

  it("names a heading-less column that has data", () => {
    expect(csv("A,\n1,2\n").headers).toEqual(["A", "Column 2"]);
  });

  it("refuses PDFs, old .xls files, binary files and the wrong file type with a clear message", () => {
    expect(() => parseSpreadsheet("x.pdf", Buffer.from("%PDF-1.7 rest"))).toThrow(/PDF/);
    expect(() => parseSpreadsheet("x.xls", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toThrow(/\.xls/);
    expect(() => parseSpreadsheet("x.csv", Buffer.from([65, 0, 66, 0]))).toThrow(/spreadsheet/);
    expect(() => parseSpreadsheet("x.docx2", Buffer.from("a,b"))).toThrow(/Excel/);
    expect(() => parseSpreadsheet("x.csv", Buffer.alloc(0))).toThrow(/empty/);
    expect(() => parseSpreadsheet("x.csv", Buffer.from(",,\n,,"))).toThrow(/nothing/);
  });

  it("refuses too many rows instead of quietly cutting the file", () => {
    const big = "name\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `c${i}`).join("\n");
    expect(() => csv(big)).toThrow(ImportFileError);
    expect(csv("name\n" + Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `c${i}`).join("\n")).rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("cuts an extremely long cell and says so", () => {
    const r = csv(`a\n${"x".repeat(6000)}`);
    expect(r.rows[0][0]).toHaveLength(5000);
    expect(r.cellsShortened).toBe(1);
  });

  it("recognises an Apple Numbers file, by its name or by how it is built, and says how to convert it", () => {
    const numbers = buildZip([
      { name: "Index/Document.iwa", data: Buffer.from("snappy-compressed protobuf") },
      { name: "Index/Tables/DataList.iwa", data: Buffer.from("x") },
      { name: "Metadata/Properties.plist", data: Buffer.from("<plist/>") },
    ]);
    // Even called something else, a file built like a Numbers document is one.
    expect(() => parseSpreadsheet("leads.zip", numbers)).toThrow(/Apple Numbers file.*Export To.*Excel/);
    expect(() => parseSpreadsheet("leads.numbers", numbers)).toThrow(/Apple Numbers file/);
    // Named .numbers but not even a zip (an older package, or a copy that was damaged on the way): the same helpful message.
    expect(() => parseSpreadsheet("Leads.NUMBERS", Buffer.from("not a zip at all"))).toThrow(/Apple Numbers file/);
    // A real Numbers file is often over the size limit; it still gets the useful message, not "too large".
    expect(() => parseSpreadsheet("Big.numbers", Buffer.alloc(6 * 1024 * 1024))).toThrow(/Apple Numbers file/);
    // An ordinary Excel file is not mistaken for one.
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Company Name</t></is></c></row></sheetData></worksheet>`;
    expect(parseSpreadsheet("leads.xlsx", workbook({ sheetXml })).headers).toEqual(["Company Name"]);
  });

  it("reads an Excel file through the same path", () => {
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Company Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t> Ace </t></is></c></row></sheetData></worksheet>`;
    expect(parseSpreadsheet("leads.xlsx", workbook({ sheetXml }))).toMatchObject({ headers: ["Company Name"], rows: [["Ace"]], sheets: ["Leads"] });
  });

  it("turns a damaged Excel file into a readable message", () => {
    expect(() => parseSpreadsheet("x.xlsx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("not really a zip")]))).toThrow(ImportFileError);
  });
});

// A spreadsheet is uploaded by a person, but it may have come from anywhere. None of these may take noticeably longer
// to read than a normal file, whatever they contain.
describe("a hostile spreadsheet cannot make the reader slow", () => {
  const read = (sheetXml: string, shared?: string[]) => {
    const file = workbook({ sheetXml, shared });
    const started = Date.now();
    const rows = readXlsx(file).rows;
    return { rows, ms: Date.now() - started };
  };

  it("tens of thousands of cells that never close", () => {
    const { rows, ms } = read(`<worksheet ${NS}><sheetData><row r="1">${'<c r="A1" t="inlineStr"><is><t>x</t>'.repeat(120_000)}`);
    expect(ms).toBeLessThan(1500);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("tens of thousands of cell tags that never even finish opening", () => {
    const { ms } = read(`<worksheet ${NS}><sheetData><row r="1">${'<c r="A1" t="s" '.repeat(150_000)}`);
    expect(ms).toBeLessThan(1500);
  });

  it("tens of thousands of rows that never close", () => {
    const { ms } = read(`<worksheet ${NS}><sheetData>${'<row r="1">'.repeat(150_000)}`);
    expect(ms).toBeLessThan(1500);
  });

  it("shared strings full of phonetic hints and text runs that never close", () => {
    const sheetXml = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`;
    const { ms } = read(sheetXml, [`${"<rPh sb=\"0\" eb=\"1\"><t>".repeat(60_000)}`, `${"<t>".repeat(100_000)}`]);
    expect(ms).toBeLessThan(1500);
  });

  it("attribute text of enormous length with quotes that never close", () => {
    const { ms } = read(`<worksheet ${NS}><sheetData><row r="1"><c r="A1" ${"t=\"".repeat(200_000)}`);
    expect(ms).toBeLessThan(1500);
  });

  it("a worksheet whose hyperlinks each claim an enormous area", () => {
    const links = Array.from({ length: 20_000 }, () => '<hyperlink ref="A1:ZZ99999" r:id="rId1"/>').join("");
    const { rows, ms } = read(`<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>safe</t></is></c></row></sheetData><hyperlinks>${links}</hyperlinks></worksheet>`);
    expect(ms).toBeLessThan(1500);
    expect(rows).toEqual([["safe"]]);
  });

  it("still reads a perfectly normal large sheet quickly", () => {
    const cells = (r: number) => Array.from({ length: 30 }, (_, c) => `<c r="${String.fromCharCode(65 + (c % 26))}${r}" t="inlineStr"><is><t>value ${r}-${c}</t></is></c>`).join("");
    const sheetXml = `<worksheet ${NS}><sheetData>${Array.from({ length: 5000 }, (_, i) => `<row r="${i + 1}">${cells(i + 1)}</row>`).join("")}</sheetData></worksheet>`;
    const { rows, ms } = read(sheetXml);
    expect(rows).toHaveLength(5000);
    expect(ms).toBeLessThan(3000);
  });
});
