# 🪞 MindMirror

Agent học tập Socratic: hỏi lại, gợi ý vừa đủ, đối chiếu với tài liệu của chính người học, và kết thúc bằng thẻ Gương Hiểu Biết có bằng chứng.

## Đưa web lên mạng (qua GitHub, không cần chạy trên máy)

Mỗi lần đẩy code lên nhánh `main`, GitHub Actions (`.github/workflows/deploy.yml`) tự: kiểm thử → tạo bảng Supabase → build giao diện →
deploy **một Cloudflare Worker phục vụ cả giao diện lẫn API** (một địa chỉ `https://mindmirror.<tên>.workers.dev`). Địa chỉ hiện ở trang tóm tắt của lần chạy workflow.

Vào repo → **Settings → Secrets and variables → Actions**:

| Loại | Tên | Lấy ở đâu | Bắt buộc? |
|---|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → Create Token → mẫu **Edit Cloudflare Workers** | Có |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → Workers & Pages (cột phải: Account ID) | Có |
| Variable | `SUPABASE_URL` | Supabase → Project Settings → API | Để bật đăng nhập Google |
| Variable | `SUPABASE_ANON_KEY` | Publishable key (công khai) | Để bật đăng nhập Google |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | Secret key | Để bật đăng nhập Google |
| Secret | `SUPABASE_DB_URL` | Nút Connect → Session pooler (điền mật khẩu DB) | Để tự tạo bảng |
| Secret | `GEMINI_API_KEY` | aistudio.google.com | Để có AI thật |
| Secret | `GROQ_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | console.groq.com, cloud.langfuse.com | Không |

Chế độ tự chọn theo những gì đã khai báo:
- **demo** (chỉ có Cloudflare): web công khai chạy ngay, mỗi trình duyệt một mã người dùng ngẫu nhiên, AI là bản mẫu; dữ liệu lưu tạm trong bộ nhớ Worker.
- **staging** (thêm Supabase): đăng nhập Google, dữ liệu lưu thật.
- **production** (thêm Gemini): đầy đủ.

Sau khi thêm/sửa secret: tab **Actions → deploy → Run workflow**. Lần đầu dùng Workers, vào dash.cloudflare.com → Workers & Pages một lần để Cloudflare tạo subdomain `workers.dev`.

Bật đăng nhập Google (một lần): Google Cloud Console → OAuth consent screen (External, thêm email nhóm vào Test users) → Credentials → OAuth client (Web), redirect URI
`https://<mã-project>.supabase.co/auth/v1/callback` → dán Client ID/Secret vào Supabase → Authentication → Providers → Google; Site URL = địa chỉ workers.dev.

## Chạy trên máy (tuỳ chọn)

```bash
npm start            # http://localhost:5173, không cần tài khoản
npm run deploy       # deploy từ máy thay vì qua GitHub
```

## Dành cho dev: chạy từng phần

```bash
cd api
npm install
npm test          # 83 test: engine, RAG, MCP, observability, evals, HTTP, injection
npm run chat -- reunderstand "LEFT JOIN vs INNER JOIN"
npm run chat -- reunderstand "Dạng chuẩn 2 (2NF)" --doc eval/fixtures/csdl-chuan-hoa.json
npm run eval:retrieval   # đo chất lượng RAG, chạy offline
```

Không có `GEMINI_API_KEY` → CLI dùng `DemoProvider` (heuristic offline cho ví dụ SQL JOIN) để thử luồng state machine.
Có key → gọi Gemini thật. Lệnh trong CLI: `/hint /answer /example /more /try /skip /topic /mode /finish /state /quit`.

## Nối model thật

1. Tạo `api/.dev.vars` từ `api/.dev.vars.example`, điền `GEMINI_API_KEY` (aistudio.google.com) và tuỳ chọn `GROQ_API_KEY`.
2. Muốn đi qua AI Gateway: điền `CF_ACCOUNT_ID`, `CF_GATEWAY_ID` trong `wrangler.toml` và `CF_AIG_TOKEN` trong `.dev.vars`.
   Không điền → gọi thẳng API nhà cung cấp (tiện khi dev).
3. Tên model nằm ở `MODEL_CORE / MODEL_LIGHT / MODEL_FALLBACK` — đổi bằng config, không sửa code.
4. `npm run chat` để trò chuyện, `npm run eval` để chạy bộ tình huống trong `api/eval/cases.json`.

## Triển khai

```bash
# Supabase: chạy supabase/migrations/0001_init.sql trong SQL Editor, bật Google provider
cd api
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put CF_AIG_TOKEN
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# sửa wrangler.toml: APP_ENV="production", SUPABASE_URL, ALLOWED_ORIGIN, CF_ACCOUNT_ID
npx wrangler deploy
```

Chưa cấu hình Supabase → API dùng `MemoryStore` (mất dữ liệu khi Worker khởi động lại; chỉ để dev).
Dev không cần đăng nhập: `APP_ENV=development` + `DEV_AUTH_BYPASS=true` → gửi header `X-Dev-User: <uuid>`.

## Giai đoạn 2: RAG · MCP · Observability · Evals

### RAG — kiểm tra kiến thức dựa trên tài liệu thật
1. Frontend trích chữ PDF/PPTX trên trình duyệt (`web-snippets/extract-document.ts`, pdf.js + đọc XML slide) → `POST /api/documents`.
2. Backend cắt đoạn theo trang, giữ tiêu đề mục, đánh dấu đoạn có câu giống chỉ thị cho AI (nghi prompt injection), embedding bằng Gemini nếu có key.
3. Tìm kiếm lai: BM25 (âm tiết + cặp âm tiết, thống nhất "hoá/hóa") + vector, gộp bằng RRF; Supabase làm điều tương tự bằng `match_chunks` (pgvector + full‑text).
4. Mở phiên có `document_ids` → model đề xuất 2–5 **tiêu chí kiểm tra rút từ tài liệu**, mỗi tiêu chí kèm trích dẫn; tiêu chí nào có quote không nằm trong tài liệu thì bị bỏ.
5. Mỗi lượt: truy xuất 4 đoạn liên quan → model nhận xét kèm nhãn `[S1]` → backend chỉ giữ trích dẫn có nguyên văn trong đoạn, đánh số lại `[1]`, trả kèm tên tài liệu + trang.
6. Guardrail bám tài liệu: nói người học **sai** mà không chỉ ra được tài liệu nói gì → hạ xuống "chưa rõ"; nói **đúng** phải gắn tiêu chí hoặc nguồn.

### MCP — lấy học liệu từ Google Drive, Notion…
- MCP client tự viết (JSON‑RPC qua Streamable HTTP, đọc cả JSON lẫn SSE, giữ `mcp-session-id`) để chạy trên Workers.
- `POST /api/connectors` → `initialize` + `tools/list` → tự chọn tool tìm kiếm và tool đọc; **loại mọi tool có thể ghi/xoá** (`destructiveHint`, tên chứa delete/update/create…).
- Người học tìm (`GET /items?q=`) và **chọn từng file** để nhập (`POST /import`); agent không tự duyệt toàn bộ Drive. File nhập vào đi đúng đường RAG ở trên.
- Token được mã hoá AES‑GCM (`CONNECTOR_ENC_KEY`), chặn SSRF (chỉ https, chặn IP nội bộ, có thể giới hạn `MCP_ALLOWED_HOSTS`).
- Giới hạn hiện tại: người dùng dán token (vd token tích hợp Notion, hoặc MCP server Drive của nhóm). Luồng OAuth 2.1 đầy đủ của remote MCP server là việc tiếp theo.

### Observability — theo dõi từng bước Agent
Mỗi lượt là một trace: `agent.turn → policy.decide → rag.retrieve → agent.respond → llm.<provider> (mỗi lần thử/fallback) → validate.output`, kèm độ trễ, token, chi phí ước tính, đoạn tài liệu được chọn, số bằng chứng bị loại vì bịa quote, số phán đoán bị hạ vì thiếu căn cứ.
- Đẩy sang **Langfuse** (`LANGFUSE_PUBLIC_KEY/SECRET_KEY`) và/hoặc **LangSmith** (`LANGSMITH_API_KEY`), chạy nền bằng `waitUntil`.
- Tóm tắt luôn được lưu ở bảng `agent_traces`; xem bằng `GET /api/sessions/:id/traces`.
- Mặc định **không ghi nội dung học tập** (`TRACE_CONTENT=metadata`: chỉ độ dài + hash); `redacted`/`full` chỉ dùng khi debug.

### Evals — hai loại đánh giá tách bạch
| | Learner Assessment | Agent Evals |
|---|---|---|
| Đánh giá ai | Người học | Chính AI |
| Ở đâu | `src/agent/assessment.ts`, thẻ Gương Hiểu Biết, `GET /api/sessions/:id/assessment` | `scripts/eval.ts`, `eval/fixtures/`, CI |
| Kết quả | Mỗi tiêu chí: tự thể hiện / đúng sau hỗ trợ / cần luyện / chưa đủ căn cứ; đã vận dụng chưa | accuracy, κ với người chấm, over‑claim, nhất quán, faithfulness, hit@k, độ trễ, chi phí |

Chi tiết cách gán nhãn, định nghĩa chỉ số và ngưỡng: `docs/EVALS.md`.

## Giai đoạn 3: AI Agent MVP (workflow · tool calling · MCP server · guardrails · evals)

Xem **[docs/AGENT_ARCHITECTURE.md](docs/AGENT_ARCHITECTURE.md)**: sơ đồ kiến trúc & workflow, danh sách công cụ, RAG, MCP, các lớp guardrail,
cách xem observability (Cài đặt → Chế độ kỹ thuật), cách chạy evals (`npm run eval:agent`), ví dụ phiên Socratic, hướng dẫn demo và giới hạn.

- `src/agent/tools.ts` — tool registry (5 công cụ, schema vào/ra, kiểm quyền) dùng chung cho native tool calling và MCP server.
- `src/agent/input-guard.ts` — guardrail đầu vào; `src/agent/guardrails.ts` — guardrail đầu ra/đánh giá.
- `src/mcp/server.ts` — `POST /mcp` (JSON-RPC 2.0), công cụ chỉ-đọc, xác thực JWT.
- `scripts/agent-eval.ts` + `eval/agent-cases.json` — 51 ca (41 offline deterministic, 10 live có giới hạn lời gọi).

## Cấu trúc

```
api/src/
  agent/
    types.ts        LearningState, Phase, Action, Evidence, Gap, MirrorCard
    policy.ts       Bộ điều phối bằng code: nhận diện ý định (0 call), tập hành động hợp lệ, giới hạn vòng
    prompts.ts      System prompt tiếng Việt, ngữ cảnh 6 lượt gần nhất, nguồn bọc <source> (untrusted)
    schema.ts       Zod cho output model (turn / card / summary)
    evidence.ts     Xác thực quote có thật trong lời người học
    guardrails.ts   Loại câu "% hiểu", chẩn đoán năng lực; giới hạn độ dài
    engine.ts       runTurn(): Quan sát → Quyết định → LLM → Kiểm chứng → Cập nhật state
    mirror-card.ts  Thẻ Gương Hiểu Biết: trạng thái tính bằng code, model chỉ viết lời
    assessment.ts   Learner Assessment theo tiêu chí, tính bằng code từ bằng chứng
  rag/              text.ts (tiếng Việt, cắt đoạn), hybrid.ts (BM25/vector/RRF), embeddings.ts,
                    ingest.ts, retriever.ts, grounding.ts (kiểm chứng trích dẫn)
  mcp/              client.ts (MCP JSON-RPC/SSE), library-source.ts (chọn tool chỉ-đọc), crypto.ts (AES-GCM, SSRF)
  obs/              tracer.ts, exporters.ts (Langfuse, LangSmith, console), pricing.ts
  providers/        gemini.ts, groq.ts, router.ts (retry/fallback, generation span), mock.ts
  store/            Store interface, MemoryStore, SupabaseStore (luôn lọc user_id)
  http/             Hono app (REST API), xác thực JWT Supabase qua JWKS
api/scripts/        chat-cli.ts, eval.ts, lib/metrics.ts
api/eval/           cases.json (hành vi), fixtures/ (giáo trình mẫu, gold truy xuất, gold chấm điểm)
web-snippets/       extract-document.ts (PDF/PPTX → văn bản, phía trình duyệt)
supabase/migrations/0001_init.sql, 0002_rag_mcp_obs.sql
```

## Một lượt Agent hoạt động thế nào

1. **Ý định**: nút bấm (`intent`) hoặc luật regex cho câu ngắn ("cho em đáp án", "bỏ câu này", "kết thúc"…).
2. **Policy (code)**:
   - `skip`, `switch_mode`, hết lượt → trả lời deterministic, **không gọi model**.
   - `finish` → tạo thẻ; không có bằng chứng `observed` thì **không gọi model**, ghi "chưa đủ căn cứ".
   - Đầu phiên Hiểu lại chỉ cho `ask_explain / ask_clarification / ask_why` (không giảng bài).
   - 2 vòng trên cùng gap chưa tiến triển → chỉ cho `give_example / explain_foundation`.
   - Gợi ý tăng dần 1 → 2 → 3; "đáp án" luôn được đáp ứng ngay.
3. **Model** trả JSON (`next_action`, `assistant_text`, `observed_evidence`, `suspected_gaps`…). JSON hỏng hoặc
   `next_action` ngoài tập cho phép → sửa **một** lần, sau đó ép nhãn.
4. **Kiểm chứng**: quote không có trong lời người học → loại. Gap chỉ được "giải quyết" khi có bằng chứng thật trong lượt.
   Bằng chứng sau khi đã nhận hỗ trợ được gắn `assisted` (thẻ cuối phân biệt "tự làm" và "sau gợi ý").
5. **Lưu**: chỉ lưu khi thành công; model lỗi → 503 `retryable`, client gửi lại cùng `client_turn_id` (idempotent).

Fallback: 429 có Retry‑After ngắn → chờ 1 lần; dài → Groq. 5xx/timeout → retry 1 lần có jitter → Groq. 401/403 → báo lỗi, không fallback.

## API

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/api/sessions` | `{mode, topic, goal?, self_confidence?, source_text?}` — tối đa 3 phiên/ngày |
| GET | `/api/sessions` | danh sách phiên của tôi |
| GET | `/api/sessions/:id` | messages, gaps, evidence, card (nếu đã kết thúc) |
| POST | `/api/sessions/:id/turn` | `{text, intent?, client_turn_id}` — `intent`: hint, show_answer, explain_more, give_example, try, skip, change_topic, switch_mode, finish |
| POST | `/api/sessions/:id/finish` | tạo Thẻ Gương Hiểu Biết |
| POST | `/api/sessions/:id/pause` | tạm dừng |
| GET / PATCH | `/api/me/settings` | aiStyle, supportPreference, challengeLevel, selfAssessment |
| DELETE | `/api/me/data` | `{scope: "sessions"\|"all", confirm: "XOA"}` |
| GET | `/api/sessions/:id/assessment` | Learner Assessment theo tiêu chí |
| GET | `/api/sessions/:id/traces` | tóm tắt trace từng lượt |
| POST | `/api/documents` | `{title, kind: pdf\|slides\|text, pages:[{page, text}]}` |
| GET / DELETE | `/api/documents[/:id]` | thư viện tài liệu |
| POST | `/api/documents/search` | `{query, document_ids, k}` — xem trước kết quả truy xuất |
| POST | `/api/connectors` | `{name, url, preset: google_drive\|notion\|generic, token?}` |
| GET | `/api/connectors/:id/items?q=` | tìm tài liệu qua MCP |
| POST | `/api/connectors/:id/import` | `{items:[{id, title}]}` (≤ 10) → tài liệu trong thư viện |

`POST /api/sessions` nhận thêm `document_ids` (≤ 5). Mỗi lượt trả thêm `citations` và `traceId`.

## Frontend (`web/`)

React + Vite + Tailwind. Màn hình: chọn chế độ và tài liệu, phiên trò chuyện (trích dẫn hiện như vết dạ quang ở lề kèm số trang,
tiêu chí từ tài liệu với trạng thái, tab "Agent đã làm gì" xem trace), thẻ Gương Hiểu Biết, thư viện tài liệu + kết nối MCP, lịch sử, cài đặt.
PDF/PPTX được trích chữ ngay trên trình duyệt (`web/src/lib/extract.ts`). Chạy riêng: `cd web && npm run dev` (cần `cd api && npm run dev`).

## Chưa làm (giai đoạn tiếp)

Luồng OAuth 2.1 cho remote MCP,
OCR cho PDF scan, `GET /api/me/usage` và trần token/ngày, mở rộng bộ eval lên 30–50 ca và có người chấm thứ hai.
