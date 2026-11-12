/**
 * ĐỒ THỊ KHÁI NIỆM (Đợt 3 — GraphRAG).
 *
 * Mô hình (tên nhãn/quan hệ viết ASCII để tránh lỗi chuẩn hoá Unicode trong Cypher):
 *   (:KhaiNiem {userId, key, name, description})      — Khái niệm
 *   (:TaiLieu  {userId, id, title})                   — Tài liệu
 *   (:Trang    {userId, key, documentId, page})       — Trang
 *   (KhaiNiem)-[:CAN_BIET_TRUOC {evidence}]->(KhaiNiem)   — CẦN_BIẾT_TRƯỚC: phải hiểu A trước khi học B
 *   (KhaiNiem)-[:LIEN_QUAN {evidence}]->(KhaiNiem)        — LIÊN_QUAN
 *   (KhaiNiem)-[:XUAT_HIEN_O {chunkId, quote}]->(Trang)   — XUẤT_HIỆN_Ở
 *   (Trang)-[:THUOC]->(TaiLieu)                            — quan hệ cấu trúc (trang thuộc tài liệu)
 *
 * MỌI nút gắn userId; mọi truy vấn đọc/ghi lọc theo userId lấy từ phiên đăng nhập (không bao giờ từ tham số người dùng gửi).
 * Mỗi quan hệ khái niệm mang "evidence": câu NGUYÊN VĂN trong đoạn tài liệu (đã kiểm chứng khi dựng và kiểm lại khi đọc).
 */

export type RelType = "CAN_BIET_TRUOC" | "LIEN_QUAN";
export const REL_TYPES: readonly RelType[] = ["CAN_BIET_TRUOC", "LIEN_QUAN"];

export interface GraphEvidence {
  documentId: string;
  documentTitle: string;
  page: number | null;
  chunkId: string;
  quote: string;
}

export interface ConceptNode {
  key: string;          // tên đã chuẩn hoá (chữ thường, bỏ dấu câu) — khoá gộp trùng
  name: string;
  description: string;
  /** Khoá của tên viết tắt/tên khác (vd "2nf" cho "Dạng chuẩn 2 (2NF)") — để tìm theo cách người học gọi. */
  aliases: string[];
  /** Khoá khái niệm RỘNG HƠN chứa nó (chủ đề/mục cha) do AI sắp — chỉ để vẽ mind map, không phải quan hệ có căn cứ. */
  parent?: string | null;
}

export interface GraphRelation {
  from: string;         // key
  to: string;           // key
  type: RelType;
  evidence: GraphEvidence;
}

export interface GraphMention {
  concept: string;      // key
  evidence: GraphEvidence;
}

export interface GraphWrite {
  userId: string;
  documents: { id: string; title: string }[];
  /** Trang đã được đọc trong lần dựng này (kể cả trang không rút được khái niệm) — để lần sau đọc tiếp. */
  pages: { documentId: string; page: number | null; v?: number }[];
  concepts: ConceptNode[];
  relations: GraphRelation[];
  mentions: GraphMention[];
}

export interface NeighborhoodResult {
  /** byName: khớp theo tên/viết tắt người học dùng; pageRank: thứ hạng trang RAG tốt nhất chứa khái niệm (nhỏ = tốt). */
  seeds: { key: string; name: string; byName: boolean; pageRank: number | null }[];
  relations: (GraphRelation & { fromName: string; toName: string })[];
}

export interface GraphView {
  concepts: (ConceptNode & { pages: (number | null)[]; documentIds: string[] })[];
  relations: (GraphRelation & { fromName: string; toName: string })[];
  documents: { id: string; title: string; extractedPages: number }[];
}

export interface GraphStore {
  readonly kind: string;
  ping(): Promise<boolean>;
  ensureSchema(): Promise<void>;
  write(w: GraphWrite): Promise<void>;
  /** Khoá "documentId:page" của các trang đã đọc (bằng bộ trích xuất phiên bản ≥ minVersion — trang đọc bằng bản cũ được đọc lại). */
  extractedPages(userId: string, documentIds: string[], minVersion?: number): Promise<Set<string>>;
  /** Khái niệm hạt giống (theo tên hoặc theo trang RAG tìm được) + quan hệ quanh chúng, chỉ trong tài liệu cho phép. */
  neighborhood(userId: string, documentIds: string[], q: { keys: string[]; pageKeys: string[] }, limit?: number): Promise<NeighborhoodResult>;
  view(userId: string, documentIds: string[], limit?: number, minVersion?: number): Promise<GraphView>;
  deleteDocument(userId: string, documentId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

/** Xếp hạt giống: khớp tên trước, rồi theo trang RAG xếp cao nhất; giữ tối đa n. */
export function rankSeeds<T extends { byName: boolean; pageRank: number | null }>(xs: T[], n = 5): T[] {
  return [...xs].sort((a, b) => Number(b.byName) - Number(a.byName) || (a.pageRank ?? 99) - (b.pageRank ?? 99)).slice(0, n);
}

export const pageKey = (documentId: string, page: number | null) => `${documentId}:${page ?? 0}`;
