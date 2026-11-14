import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";

const STORE_NAME = "terence-web-studio-projects";
const COOKIE_NAME = "tws_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 2_500_000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function getSecret() {
  return process.env.STUDIO_ADMIN_PASSWORD || "";
}

function signature(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function makeSession(secret) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = randomBytes(16).toString("hex");
  const payload = `${expires}.${nonce}`;
  return `${payload}.${signature(payload, secret)}`;
}

function readCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function validSession(request, secret) {
  const token = readCookie(request, COOKIE_NAME);
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresText, nonce, supplied] = parts;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000) || !/^[a-f0-9]{32}$/.test(nonce)) return false;
  const expected = signature(`${expiresText}.${nonce}`, secret);
  const a = Buffer.from(supplied || "", "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieHeader(value, maxAge) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function safeProject(input) {
  if (!input || typeof input !== "object") return null;
  const title = String(input.title || "").trim().slice(0, 120);
  const category = String(input.category || "Other").trim().slice(0, 60);
  const description = String(input.description || "").trim().slice(0, 1200);
  let url = "";
  try {
    const parsed = new URL(String(input.url || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    url = parsed.href;
  } catch { return null; }
  const image = typeof input.image === "string" ? input.image : "";
  if (image && (!image.startsWith("data:image/jpeg;base64,") || image.length > 1_800_000)) return null;
  const status = input.status === "published" ? "published" : "draft";
  if (!title || !description) return null;
  return {
    id: String(input.id || randomUUID()).slice(0, 80),
    title, category, description, url, image, status,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now()
  };
}

async function readProjects(store) {
  return (await store.get("projects", { type: "json", consistency: "strong" })) || [];
}

export default async (request, context) => {
  const secret = getSecret();
  if (!secret) return json({ error: "Admin access is not configured on Netlify." }, 503);

  const url = new URL(request.url);
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (request.method === "GET") {
    const isAdmin = url.searchParams.get("admin") === "1" && validSession(request, secret);
    const projects = await readProjects(store);
    return json(isAdmin ? projects : projects.filter(project => project.status === "published"));
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST" });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Request origin not allowed." }, 403);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Request is too large. Please use a smaller screenshot." }, 413);

  let body;
  try {
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) return json({ error: "Request is too large. Please use a smaller screenshot." }, 413);
    body = JSON.parse(rawBody);
  } catch { return json({ error: "Invalid request." }, 400); }

  if (body.action === "login") {
    const supplied = String(body.password || "");
    const expected = Buffer.from(secret);
    const actual = Buffer.from(supplied);
    const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!matches) return json({ error: "Incorrect password." }, 401);
    const token = makeSession(secret);
    return json({ ok: true }, 200, {
      "Set-Cookie": cookieHeader(token, SESSION_SECONDS)
    });
  }

  if (body.action === "logout") {
    return json({ ok: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }

  if (!validSession(request, secret)) return json({ error: "Please sign in to manage projects." }, 401);

  if (body.action === "save") {
    const project = safeProject(body.project);
    if (!project) return json({ error: "Project details are invalid. Check the title, description, URL and screenshot." }, 400);
    const projects = await readProjects(store);
    const index = projects.findIndex(item => item.id === project.id);
    if (index >= 0) projects[index] = project;
    else projects.unshift(project);
    await store.setJSON("projects", projects);
    return json({ ok: true, project });
  }

  if (body.action === "delete") {
    const id = String(body.id || "");
    if (!id) return json({ error: "Project ID is required." }, 400);
    const projects = await readProjects(store);
    await store.setJSON("projects", projects.filter(project => project.id !== id));
    return json({ ok: true });
  }

  if (body.action === "import") {
    const existing = await readProjects(store);
    if (existing.length) return json({ error: "Online projects already exist; import was stopped to avoid overwriting them." }, 409);
    if (!Array.isArray(body.projects) || body.projects.length > 100) return json({ error: "Invalid project import." }, 400);
    const imported = body.projects.map(safeProject);
    if (imported.some(project => !project)) return json({ error: "One or more saved projects could not be imported." }, 400);
    await store.setJSON("projects", imported);
    return json({ ok: true, count: imported.length });
  }

  return json({ error: "Unknown action." }, 400);
};

export const config = { path: "/api/*" };
