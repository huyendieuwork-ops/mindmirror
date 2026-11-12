import type { Note } from "./api";

/**
 * Xuất ghi chú ra PDF hoặc Word (.docx) ngay trên trình duyệt, không cần thư viện mới:
 *  - Word: tự dựng gói .docx tối giản bằng JSZip (đã có sẵn trong dự án) → chữ tiếng Việt giữ nguyên, sửa tiếp được trong Word.
 *  - PDF: vẽ từng trang A4 lên canvas bằng phông của trình duyệt (dấu tiếng Việt hiển thị đúng) rồi ghép thành PDF.
 */

const fmt = (iso: string) => new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
const titleOf = (n: Note) => n.title.trim() || "Ghi chú không tên";

export function fileBase(notes: Note[]): string {
  const base = notes.length === 1 ? titleOf(notes[0]!) : "ghi-chu-mindmirror";
  const slug = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${slug || "ghi-chu"}-${day}`;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

/* ---------------- Word (.docx) ---------------- */
const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.size ?? 23}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
const para = (inner: string, o: { after?: number; pageBreak?: boolean; heading?: boolean } = {}) =>
  `<w:p><w:pPr>${o.heading ? '<w:pStyle w:val="Heading1"/><w:keepNext/>' : ""}${o.pageBreak ? "<w:pageBreakBefore/>" : ""}<w:spacing w:after="${o.after ?? 60}"/></w:pPr>${inner}</w:p>`;

export async function exportDocx(notes: Note[]): Promise<void> {
  const { default: JSZip } = await import("jszip");
  const body = notes.map((n, i) =>
    para(run(titleOf(n), { bold: true, size: 32, color: "1F2A44" }), { heading: true, pageBreak: i > 0, after: 80 }) +
    para(run(`Cập nhật: ${fmt(n.updatedAt)}`, { size: 18, color: "8A94A6" }), { after: 240 }) +
    n.body.split("\n").map((line) => para(run(line))).join(""),
  ).join("");
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const zip = new JSZip();
  const add = (name: string, data: string) => zip.file(name, data, { createFolders: false }); // không ghi mục thư mục vào gói (Word trên đám mây có thể từ chối)
  add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  add("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="23"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  add("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(notes.length === 1 ? titleOf(notes[0]!) : "Ghi chú MindMirror")}</dc:title><dc:creator>MindMirror</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  download(blob, `${fileBase(notes)}.docx`);
}

/* ---------------- PDF ---------------- */
// Trang A4 vẽ ở 144 dpi (gấp đôi 72 dpi của PDF) cho chữ nét.
const PW = 595.28, PH = 841.89, K = 2;
const FONT = '"Be Vietnam Pro", "Segoe UI", Roboto, Arial, sans-serif';

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  if (!text) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/(\s+)/)) {
    const test = line + word;
    if (ctx.measureText(test).width <= max || !line.trim()) {
      if (ctx.measureText(test).width > max && !line.trim()) {
        // Từ quá dài (đường link…): cắt theo ký tự.
        let chunk = "";
        for (const ch of word) { if (ctx.measureText(chunk + ch).width > max) { out.push(chunk); chunk = ch; } else chunk += ch; }
        line = chunk;
      } else line = test;
    } else { out.push(line.trimEnd()); line = word.trimStart(); }
  }
  out.push(line.trimEnd());
  return out;
}

function renderPages(notes: Note[]): HTMLCanvasElement[] {
  const pages: HTMLCanvasElement[] = [];
  const M = 56 * K, maxW = PW * K - 2 * M, bottom = PH * K - 70 * K;
  let ctx!: CanvasRenderingContext2D, y = 0;
  const newPage = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(PW * K); c.height = Math.round(PH * K);
    ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.textBaseline = "top";
    pages.push(c); y = M;
  };
  const write = (text: string, size: number, color: string, weight = 400, gapAfter = 0, lh = 1.45) => {
    ctx.font = `${weight} ${size * K}px ${FONT}`;
    for (const l of wrap(ctx, text, maxW)) {
      if (y + size * K * lh > bottom) { newPage(); ctx.font = `${weight} ${size * K}px ${FONT}`; }
      ctx.fillStyle = color; ctx.fillText(l, M, y); y += size * K * lh;
    }
    y += gapAfter * K;
  };
  notes.forEach((n) => {
    newPage();
    write(titleOf(n), 20, "#1f2a44", 700, 2, 1.3);
    write(`Cập nhật: ${fmt(n.updatedAt)}`, 9, "#8a94a6", 400, 12);
    for (const line of n.body.split("\n")) write(line, 11.5, "#1f2a44", 400, 2);
  });
  pages.forEach((c, i) => {
    const g = c.getContext("2d")!;
    g.font = `400 ${8 * K}px ${FONT}`; g.fillStyle = "#8a94a6"; g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillText(`MindMirror · ${i + 1}/${pages.length}`, c.width / 2, c.height - 30 * K);
  });
  return pages;
}

async function jpegBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}

/** PDF tối giản: mỗi trang là một ảnh JPEG khổ A4 (DCTDecode). */
function buildPdf(images: { bytes: Uint8Array; w: number; h: number }[], title: string): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (x: string | Uint8Array) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (id: number, body: () => void) => { offsets[id] = len; push(`${id} 0 obj\n`); body(); push("\nendobj\n"); };
  const n = images.length;
  // 1 Catalog, 2 Pages, 3 Info; mỗi trang i: Page = 4+3i, Contents = 5+3i, Image = 6+3i
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${images.map((_, i) => `${4 + 3 * i} 0 R`).join(" ")}] >>`));
  const hex = (s: string) => "<FEFF" + [...s].map((ch) => { const c = ch.codePointAt(0)!; return c > 0xffff ? ch.split("").map((u) => u.charCodeAt(0).toString(16).padStart(4, "0")).join("") : c.toString(16).padStart(4, "0"); }).join("").toUpperCase() + ">";
  obj(3, () => push(`<< /Title ${hex(title)} /Creator ${hex("MindMirror")} /Producer ${hex("MindMirror")} >>`));
  images.forEach((im, i) => {
    const page = 4 + 3 * i, contents = 5 + 3 * i, image = 6 + 3 * i;
    obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im${i} ${image} 0 R >> >> /Contents ${contents} 0 R >>`));
    const stream = `q ${PW} 0 0 ${PH} 0 0 cm /Im${i} Do Q`;
    obj(contents, () => { push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
    obj(image, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); push(im.bytes); push("\nendstream"); });
  });
  const total = 4 + 3 * n;
  const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function exportPdf(notes: Note[]): Promise<void> {
  try { await (document as any).fonts?.ready; } catch { /* bỏ qua */ }
  const canvases = renderPages(notes);
  const images = [];
  for (const c of canvases) images.push({ bytes: await jpegBytes(c), w: c.width, h: c.height });
  download(buildPdf(images, notes.length === 1 ? titleOf(notes[0]!) : "Ghi chú MindMirror"), `${fileBase(notes)}.pdf`);
}
