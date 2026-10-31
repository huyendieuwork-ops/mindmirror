#!/usr/bin/env node
/**
 * MindMirror — cài đặt & triển khai bằng một lệnh.
 *
 *   node setup.mjs            Cài đặt + chạy thử trên máy (không cần tài khoản nào)
 *   node setup.mjs deploy     Đưa lên Cloudflare (Workers + Pages) và Supabase
 *   node setup.mjs migrate    Chỉ chạy migration database
 *
 * Script KHÔNG ghi key bí mật vào repo. Key chỉ được gửi thẳng tới Cloudflare (wrangler secret)
 * và một file tạm bị xoá ngay sau đó. Cấu hình không bí mật được nhớ ở .mindmirror-deploy.json để chạy lại.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, mkdtempSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const API = join(ROOT, "api");
const WEB = join(ROOT, "web");
const STATE_FILE = join(ROOT, ".mindmirror-deploy.json");
const isWin = process.platform === "win32";
const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const step = (n, t) => console.log(`\n${c.b(`[${n}]`)} ${t}`);
const ok = (t) => console.log(`    ${c.g("✓")} ${t}`);
const warn = (t) => console.log(`    ${c.y("!")} ${t}`);
const die = (t) => { console.error(`\n${c.r("✗")} ${t}`); process.exit(1); };

// ---------- tiện ích ----------
function run(cmd, args, { cwd = ROOT, env = {}, capture = false, input } = {}) {
  const r = spawnSync(cmd, args, {
    cwd, env: { ...process.env, ...env }, shell: isWin, encoding: "utf8",
    stdio: capture ? ["pipe", "pipe", "pipe"] : input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit", input,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
const npx = (args, opts) => run("npx", ["--yes", ...args], opts);

function ask(q, { secret = false, def = "" } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const label = `    ${q}${def && !secret ? c.d(` [${def}]`) : def && secret ? c.d(" [đã lưu — Enter để giữ]") : ""}: `;
    if (secret) {
      rl._writeToOutput = (s) => rl.output.write(s.startsWith(label) ? label : s.includes("\n") ? "\n" : "•");
    }
    rl.question(label, (a) => { rl.close(); if (secret) process.stdout.write("\n"); resolve(a.trim() || def); });
  });
}

const loadState = () => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {});
const saveState = (s) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) die(`Cần Node.js 20 trở lên (đang có ${process.versions.node}). Tải tại https://nodejs.org`);
  ok(`Node.js ${process.versions.node}`);
}

function install() {
  for (const [name, dir] of [["backend", API], ["frontend", WEB]]) {
    if (existsSync(join(dir, "node_modules"))) { ok(`${name}: đã cài`); continue; }
    console.log(c.d(`    đang cài ${name}…`));
    if (run("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir }).code) die(`npm install (${name}) thất bại`);
    ok(`${name}: cài xong`);
  }
  if (!existsSync(join(ROOT, "node_modules", "pg"))) run("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, capture: true });
}

// ---------- chạy local ----------
async function local() {
  step(1, "Kiểm tra môi trường"); checkNode();
  step(2, "Cài thư viện"); install();
  step(3, "Cấu hình chạy thử");
  const devVars = join(API, ".dev.vars");
  if (!existsSync(devVars)) {
    const gem = await ask("GEMINI_API_KEY (Enter để bỏ qua — dùng bản demo offline)", { secret: true });
    writeFileSync(devVars, [
      "DEV_AUTH_BYPASS=true",
      `CONNECTOR_ENC_KEY=${randomBytes(32).toString("base64")}`,
      gem ? `GEMINI_API_KEY=${gem}` : "# GEMINI_API_KEY=",
    ].join("\n") + "\n");
    ok("Đã tạo api/.dev.vars (không bị commit)");
  } else ok("Dùng api/.dev.vars có sẵn");
  step(4, "Kiểm thử nhanh");
  if (run("npm", ["test", "--silent"], { cwd: API, capture: true }).code) warn("Một số test thất bại — chạy `cd api && npm test` để xem"); else ok("Tất cả test đạt");
  step(5, "Khởi động");
  console.log(`    Backend: http://127.0.0.1:8787   Frontend: ${c.b("http://localhost:5173")}   (Ctrl+C để dừng)\n`);
  const procs = [
    spawn("npx", ["wrangler", "dev", "--port", "8787", "--ip", "127.0.0.1"], { cwd: API, shell: isWin, stdio: "inherit" }),
    spawn("npx", ["vite", "--port", "5173", "--open"], { cwd: WEB, shell: isWin, stdio: "inherit" }),
  ];
  const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

// ---------- migration ----------
async function migrate(dbUrl) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("create table if not exists public._mindmirror_migrations (name text primary key, applied_at timestamptz default now())");
  const done = new Set((await client.query("select name from public._mindmirror_migrations")).rows.map((r) => r.name));
  const files = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) { ok(`${f} (đã chạy trước đó)`); continue; }
    const sql = readFileSync(join(ROOT, "supabase", "migrations", f), "utf8");
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into public._mindmirror_migrations(name) values ($1)", [f]);
      await client.query("commit");
      ok(f);
    } catch (e) {
      await client.query("rollback");
      await client.end();
      die(`Migration ${f} lỗi: ${e.message}`);
    }
  }
  await client.end();
}

// ---------- deploy ----------
async function deploy() {
  const st = loadState();
  step(1, "Kiểm tra môi trường"); checkNode(); install();

  step(2, "Đăng nhập Cloudflare");
  let who = npx(["wrangler", "whoami"], { cwd: API, capture: true });
  if (/not authenticated|You are not logged in/i.test(who.out) || who.code) {
    console.log("    Trình duyệt sẽ mở trang đăng nhập Cloudflare — cậu đăng nhập và bấm Allow.");
    if (npx(["wrangler", "login"], { cwd: API }).code) die("Đăng nhập Cloudflare chưa thành công.");
    who = npx(["wrangler", "whoami"], { cwd: API, capture: true });
  }
  const email = /associated with the email ([^\s.]+@[^\s]+?)\.?\s/i.exec(who.out)?.[1];
  ok(`Đã đăng nhập Cloudflare${email ? ` (${email})` : ""}`);

  step(3, "Thông tin Supabase", );
  console.log(c.d("    Lấy ở supabase.com/dashboard → project → Project Settings → API (và Connect → Session pooler)"));
  st.supabaseUrl = (await ask("Project URL (https://xxxx.supabase.co)", { def: st.supabaseUrl })).replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(st.supabaseUrl)) warn("URL trông không giống Supabase — vẫn tiếp tục.");
  st.supabaseAnon = await ask("Publishable / anon key (công khai, dùng cho frontend)", { def: st.supabaseAnon });
  const serviceRole = await ask("Secret / service_role key", { secret: true });
  const jwtSecret = await ask("Legacy JWT secret (chỉ khi dự án cũ dùng HS256 — Enter để bỏ qua)", { secret: true });
  saveState(st);

  step(4, "Tạo bảng trong database");
  const dbUrl = await ask("Connection string (Session pooler, có mật khẩu DB) — Enter để tự chạy SQL bằng tay", { secret: true });
  if (dbUrl) await migrate(dbUrl);
  else warn("Bỏ qua. Mở Supabase → SQL Editor và chạy lần lượt các file trong supabase/migrations/.");

  step(5, "Khoá AI và theo dõi");
  console.log(c.d("    Gemini: aistudio.google.com → Get API key. Groq: console.groq.com → API Keys. Langfuse: cloud.langfuse.com → Settings → API Keys"));
  const gemini = await ask("GEMINI_API_KEY (Enter = chạy bản demo không có AI thật)", { secret: true });
  const groq = await ask("GROQ_API_KEY (dự phòng, có thể bỏ qua)", { secret: true });
  const lfPub = await ask("LANGFUSE_PUBLIC_KEY (có thể bỏ qua)", { def: st.langfusePublic ?? "" });
  const lfSec = lfPub ? await ask("LANGFUSE_SECRET_KEY", { secret: true }) : "";
  if (lfPub) st.langfusePublic = lfPub;
  st.encKeySet = st.encKeySet ?? false;
  saveState(st);

  // 6. Deploy backend (lần 1 — chưa biết domain frontend)
  st.workerName = st.workerName ?? "mindmirror-api";
  st.pagesProject = st.pagesProject ?? "mindmirror";
  const appEnv = gemini || st.hasGemini ? "production" : "staging";
  const deployApi = (origin) => {
    const toml = readFileSync(join(API, "wrangler.toml"), "utf8")
      .replace(/^name = .*$/m, `name = "${st.workerName}"`)
      .replace(/^APP_ENV = .*$/m, `APP_ENV = "${appEnv}"`)
      .replace(/^SUPABASE_URL = .*$/m, `SUPABASE_URL = "${st.supabaseUrl}"`)
      .replace(/^ALLOWED_ORIGIN = .*$/m, `ALLOWED_ORIGIN = "${origin}"`);
    const cfg = join(API, "wrangler.deploy.toml");
    writeFileSync(cfg, toml);
    const r = npx(["wrangler", "deploy", "--config", "wrangler.deploy.toml"], { cwd: API, capture: true });
    unlinkSync(cfg);
    if (r.code) { console.log(r.out); die("Deploy backend thất bại (xem log ở trên)."); }
    return /https:\/\/[\w.-]+\.workers\.dev/.exec(r.out)?.[0];
  };
  step(6, "Đưa backend lên Cloudflare Workers");
  const apiUrl = deployApi(st.pagesUrl ?? "http://localhost:5173") ?? st.apiUrl;
  if (!apiUrl) die("Không đọc được địa chỉ workers.dev. Lần đầu dùng Workers? Vào dash.cloudflare.com → Workers & Pages để chọn subdomain rồi chạy lại.");
  st.apiUrl = apiUrl; saveState(st);
  ok(`Backend: ${apiUrl}`);

  // 7. Secrets — gửi một lần qua file tạm rồi xoá
  const secrets = {};
  if (serviceRole) secrets.SUPABASE_SERVICE_ROLE_KEY = serviceRole;
  if (jwtSecret) secrets.SUPABASE_JWT_SECRET = jwtSecret;
  if (gemini) { secrets.GEMINI_API_KEY = gemini; st.hasGemini = true; }
  if (groq) secrets.GROQ_API_KEY = groq;
  if (lfPub && lfSec) { secrets.LANGFUSE_PUBLIC_KEY = lfPub; secrets.LANGFUSE_SECRET_KEY = lfSec; }
  if (!st.encKeySet) { secrets.CONNECTOR_ENC_KEY = randomBytes(32).toString("base64"); st.encKeySet = true; }
  if (Object.keys(secrets).length) {
    step(7, `Lưu ${Object.keys(secrets).length} khoá bí mật vào Cloudflare`);
    const dir = mkdtempSync(join(tmpdir(), "mm-"));
    const f = join(dir, "s.json");
    writeFileSync(f, JSON.stringify(secrets), { mode: 0o600 });
    const r = npx(["wrangler", "secret", "bulk", f, "--name", st.workerName], { cwd: API, capture: true });
    unlinkSync(f);
    if (r.code) { console.log(r.out.replace(/"[A-Za-z0-9_\-./+=]{20,}"/g, '"***"')); die("Lưu secret thất bại."); }
    ok(Object.keys(secrets).join(", "));
    saveState(st);
  }

  // 8. Frontend
  step(8, "Build và đưa frontend lên Cloudflare Pages");
  const env = { VITE_API_URL: apiUrl, VITE_SUPABASE_URL: st.supabaseUrl, VITE_SUPABASE_ANON_KEY: st.supabaseAnon };
  if (run("npm", ["run", "build"], { cwd: WEB, env }).code) die("Build frontend thất bại.");
  npx(["wrangler", "pages", "project", "create", st.pagesProject, "--production-branch", "main"], { cwd: WEB, capture: true }); // đã có thì bỏ qua
  const pd = npx(["wrangler", "pages", "deploy", "dist", "--project-name", st.pagesProject, "--branch", "main", "--commit-dirty=true"], { cwd: WEB, capture: true });
  if (pd.code) { console.log(pd.out); die("Deploy frontend thất bại."); }
  const list = npx(["wrangler", "pages", "project", "list"], { cwd: WEB, capture: true }).out;
  const row = list.split("\n").find((l) => l.includes(st.pagesProject)) ?? "";
  const prod = /([\w-]+\.pages\.dev)/.exec(row)?.[1];
  st.pagesUrl = prod ? `https://${prod}` : /https:\/\/[\w.-]+\.pages\.dev/.exec(pd.out)?.[0];
  saveState(st);
  ok(`Frontend: ${st.pagesUrl}`);

  // 9. Deploy lại backend với CORS đúng domain frontend
  step(9, "Cho phép frontend gọi backend (CORS)");
  deployApi(`${st.pagesUrl},http://localhost:5173`);
  ok("Xong");

  step(10, "Kiểm tra");
  try {
    const h = await (await fetch(`${apiUrl}/health`)).json();
    const cfg = await (await fetch(`${apiUrl}/api/config`)).json();
    ok(`Backend phản hồi (${h.ok ? "ok" : "?"}), model: ${cfg.model}, theo dõi: ${cfg.tracing.join(", ") || "chưa bật"}`);
  } catch { warn("Chưa gọi được backend — Cloudflare có thể cần thêm vài giây."); }

  console.log(`\n${c.g(c.b("Đã triển khai."))} Mở ${c.b(st.pagesUrl)}\n`);
  console.log(c.b("Việc cần làm một lần trên Supabase để đăng nhập Google chạy được:"));
  console.log(`  1. Authentication → URL Configuration: Site URL = ${st.pagesUrl}`);
  console.log(`     Redirect URLs: thêm ${st.pagesUrl}/** và http://localhost:5173/**`);
  console.log(`  2. Authentication → Sign In / Providers → Google: bật, dán Client ID + Client Secret`);
  console.log(`  3. Google Cloud Console → APIs & Services → Credentials → OAuth client (Web):`);
  console.log(`     Authorized redirect URI = ${st.supabaseUrl}/auth/v1/callback`);
}

const cmd = process.argv[2] ?? "local";
if (cmd === "deploy") await deploy();
else if (cmd === "migrate") {
  checkNode();
  if (process.env.CI) await migrate(process.env.SUPABASE_DB_URL ?? die("Thiếu SUPABASE_DB_URL"));
  else { install(); await migrate(await ask("Connection string (Session pooler)", { secret: true })); }
}
else await local();
