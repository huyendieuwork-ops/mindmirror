/**
 * CI: sinh api/wrangler.deploy.toml từ biến môi trường của GitHub Actions.
 *  - Chưa có SUPABASE_URL  → APP_ENV=demo: web công khai, đăng nhập giả lập theo trình duyệt.
 *  - Có Supabase, chưa có Gemini → staging: đăng nhập Google thật, AI demo.
 *  - Có cả hai → production.
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const e = process.env;
const supa = (e.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
const appEnv = !supa ? "demo" : e.HAS_GEMINI === "true" ? "production" : "staging";
const name = (e.WORKER_NAME || "mindmirror").trim();

let toml = readFileSync("api/wrangler.toml", "utf8")
  .replace(/^name = .*$/m, `name = "${name}"`)
  .replace(/^APP_ENV = .*$/m, `APP_ENV = "${appEnv}"`)
  .replace(/^SUPABASE_URL = .*$/m, `SUPABASE_URL = "${supa}"`)
  .replace(/^ALLOWED_ORIGIN = .*$/m, `ALLOWED_ORIGIN = "http://localhost:5173"`);
if (appEnv === "demo") toml = toml.replace(/^\[vars\]$/m, `[vars]\nDEV_AUTH_BYPASS = "true"`);
if (e.CF_ACCOUNT_ID_FOR_GATEWAY) toml = toml.replace(/^CF_ACCOUNT_ID = .*$/m, `CF_ACCOUNT_ID = "${e.CF_ACCOUNT_ID_FOR_GATEWAY}"`);
writeFileSync("api/wrangler.deploy.toml", toml);

console.log(`APP_ENV=${appEnv} worker=${name}`);
if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, `app_env=${appEnv}\n`);
