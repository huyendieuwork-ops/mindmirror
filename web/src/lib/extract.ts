/**
 * Trích văn bản PDF / PowerPoint NGAY TRÊN TRÌNH DUYỆT rồi gửi lên POST /api/documents.
 * (Worker Free chỉ có 10 ms CPU/request — không parse PDF ở server.)
 *
 *   npm i pdfjs-dist jszip
 *
 * Dùng trong frontend React:
 *   const payload = await extractDocument(file);
 *   await fetch(`${API}/api/documents`, { method: "POST", headers: {...auth, "content-type": "application/json"}, body: JSON.stringify(payload) });
 */
import * as pdfjs from "pdfjs-dist";
import JSZip from "jszip";

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ExtractedDocument {
  title: string;
  kind: "pdf" | "slides" | "text";
  pages: { page: number | null; text: string }[];
  scannedPages: number[]; // trang gần như không có chữ → có thể là ảnh scan (chưa hỗ trợ OCR ở MVP)
}

const MAX_PAGES = 400;

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const name = file.name.replace(/\.[^.]+$/, "");
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return extractPdf(file, name);
  if (/\.pptx$/i.test(file.name)) return extractPptx(file, name);
  if (/\.(txt|md)$/i.test(file.name)) {
    const text = await file.text();
    return { title: name, kind: "text", pages: text.split("\f").map((t, i) => ({ page: i + 1, text: t })), scannedPages: [] };
  }
  throw new Error("Định dạng chưa hỗ trợ (PDF, PPTX, TXT, MD).");
}

async function extractPdf(file: File, title: string): Promise<ExtractedDocument> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: ExtractedDocument["pages"] = [];
  const scanned: number[] = [];
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it: any) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (text.length < 20) scanned.push(i);
    pages.push({ page: i, text });
  }
  return { title, kind: "pdf", pages, scannedPages: scanned };
}

async function extractPptx(file: File, title: string): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = Object.keys(zip.files)
    .map((p) => ({ p, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(p)?.[1]) }))
    .filter((x) => x.n)
    .sort((a, b) => a.n - b.n);
  const pages: ExtractedDocument["pages"] = [];
  for (const { p, n } of slideFiles.slice(0, MAX_PAGES)) {
    const slide = paragraphs(await zip.file(p)!.async("string"));
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    const notes = notesXml ? paragraphs(notesXml) : "";
    pages.push({ page: n, text: notes ? `${slide}\n\nGhi chú: ${notes}` : slide });
  }
  return { title, kind: "slides", pages, scannedPages: pages.filter((x) => x.text.length < 5).map((x) => x.page!) };
}

/** Lấy chữ trong <a:t>, giữ ngắt đoạn theo <a:p>. */
function paragraphs(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  return Array.from(doc.getElementsByTagNameNS(A, "p"))
    .map((p) => Array.from(p.getElementsByTagNameNS(A, "t")).map((t) => t.textContent ?? "").join(""))
    .filter((s) => s.trim())
    .join("\n");
}
