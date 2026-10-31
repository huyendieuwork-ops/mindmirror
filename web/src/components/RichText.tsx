import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Hiển thị câu trả lời AI có cấu trúc: tiêu đề, danh sách, bảng, khối code, công thức (KaTeX) và sơ đồ (Mermaid).
 * KaTeX/Mermaid chỉ được tải (từ CDN, có version cố định) khi câu trả lời thực sự có công thức/sơ đồ → không làm nặng bundle.
 * renderInline: xử lý **đậm** và chỉ số trích dẫn [n] (do trang phiên học cung cấp).
 */
export default function RichText({ text, renderInline }: { text: string; renderInline: (line: string, key: number) => ReactNode[] }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const inline = (s: string, k: number) => <InlineRich text={s} k={k} renderInline={renderInline} />;

  while (i < lines.length) {
    const line = lines[i]!;
    // Khối code / sơ đồ
    const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1]!.toLowerCase();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      const code = body.join("\n");
      blocks.push(lang === "mermaid" ? <Mermaid key={i} code={code} /> : <pre key={i} className="overflow-x-auto rounded-xl bg-paper px-4 py-3 text-[0.85rem] leading-relaxed"><code>{code}</code></pre>);
      continue;
    }
    // Công thức khối $$ ... $$
    if (/^\s*\$\$/.test(line)) {
      const body: string[] = [line.replace(/^\s*\$\$/, "")];
      if (!/\$\$\s*$/.test(body[0]!) || body[0]!.trim() === "") {
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i]!)) body.push(lines[i++]!);
        if (i < lines.length) body.push(lines[i]!);
      }
      i++;
      blocks.push(<Formula key={i} expr={body.join("\n").replace(/\$\$\s*$/, "").trim()} display />);
      continue;
    }
    // Bảng markdown
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={i} className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            {head && <thead className="bg-paper/80"><tr>{head.map((c, j) => <th key={j} className="px-3 py-2 text-left font-semibold text-ink">{inline(c, i * 100 + j)}</th>)}</tr></thead>}
            <tbody className="divide-y divide-line">
              {body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{inline(c, i * 1000 + ri * 10 + j)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    // Danh sách
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={i} className={`ml-5 space-y-1 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((it, j) => <li key={j}>{inline(it, i * 100 + j)}</li>)}</Tag>);
      continue;
    }
    // Tiêu đề
    const h = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<p key={i} className="pt-1 font-semibold text-ink">{inline(h[1]!, i)}</p>);
      i++;
      continue;
    }
    if (line.trim()) blocks.push(<p key={i}>{inline(line, i)}</p>);
    i++;
  }
  return <>{blocks}</>;
}

/** `code` và $công thức$ trong dòng; phần còn lại giao cho renderInline (đậm + trích dẫn). */
function InlineRich({ text, k, renderInline }: { text: string; k: number; renderInline: (line: string, key: number) => ReactNode[] }) {
  const parts = text.split(/(`[^`]+`|\$[^$\n]{1,200}\$)/g);
  return (
    <>
      {parts.map((p, j) => {
        if (/^`[^`]+`$/.test(p)) return <code key={j} className="rounded bg-paper px-1.5 py-0.5 text-[0.88em]">{p.slice(1, -1)}</code>;
        if (/^\$[^$]+\$$/.test(p) && /[\\^_=+{}()]|[a-zA-Z]\s*[<>]/.test(p)) return <Formula key={j} expr={p.slice(1, -1)} />;
        return <span key={j}>{renderInline(p, k * 10 + j)}</span>;
      })}
    </>
  );
}

// ---------- tải thư viện ngoài khi cần ----------
const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => res(); s.onerror = () => { loaded.delete(src); rej(new Error("load_failed")); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}
function loadCss(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href; l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";
function Formula({ expr, display = false }: { expr: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCss(`${KATEX}/katex.min.css`);
    loadScript(`${KATEX}/katex.min.js`)
      .then(() => { if (alive) setHtml((window as any).katex.renderToString(expr, { throwOnError: false, displayMode: display, trust: false })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [expr, display]);
  if (!html) return display ? <pre className="overflow-x-auto rounded-xl bg-paper px-4 py-2 text-sm">{expr}</pre> : <code className="rounded bg-paper px-1">{expr}</code>;
  return display ? <div className="overflow-x-auto py-1" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

let mermaidSeq = 0;
function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const id = useRef(`mm-diagram-${++mermaidSeq}`);
  useEffect(() => {
    let alive = true;
    loadScript("https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js")
      .then(async () => {
        const m = (window as any).mermaid;
        m.initialize({ startOnLoad: false, securityLevel: "strict", theme: document.documentElement.dataset.theme === "dark" ? "dark" : "neutral" });
        const out = await m.render(id.current, code);
        if (alive) setSvg(out.svg);
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [code]);
  if (svg) return <div className="overflow-x-auto rounded-xl border border-line bg-sheet p-3" dangerouslySetInnerHTML={{ __html: svg }} />;
  return <pre className="overflow-x-auto rounded-xl bg-paper px-4 py-3 text-[0.85rem]">{failed ? code : "Đang vẽ sơ đồ…"}</pre>;
}
