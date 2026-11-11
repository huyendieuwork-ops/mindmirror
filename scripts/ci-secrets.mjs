/** CI: gom các secret có giá trị thành file JSON tạm cho `wrangler secret bulk` (file bị xoá ngay sau đó). */
import { writeFileSync } from "node:fs";
const keys = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "GEMINI_API_KEY", "GROQ_API_KEY", "CF_AIG_TOKEN",
  "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGSMITH_API_KEY", "CONNECTOR_ENC_KEY", "TAVILY_API_KEY",
  "NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD", "NEO4J_DATABASE"];
const out = Object.fromEntries(keys.filter((k) => (process.env[k] ?? "").trim()).map((k) => [k, process.env[k].trim()]));
writeFileSync(process.argv[2], JSON.stringify(out), { mode: 0o600 });
console.log(`secrets: ${Object.keys(out).join(", ") || "(không có)"}`);
