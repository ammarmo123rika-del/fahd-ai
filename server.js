const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 3000;
const OLLAMA = "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.FAHD_MODEL || "llama3.2";
const NUM_CTX = Number(process.env.FAHD_CTX || 2048);
const TEMP = Number(process.env.FAHD_TEMP || 0.6);
const MAX_BODY = 15 * 1024 * 1024; // 15 MB request limit (covers base64 images)

const SYSTEM_PROMPT =
  process.env.FAHD_SYSTEM ||
  'You are Fahd AI, a fast helpful assistant (Arabic/English). Be concise. Use Markdown. Code: complete working solutions. Reply in the user language.';

function send(res, status, type, data) {
  res.writeHead(status, { "Content-Type": type });
  res.end(data);
}

function sendJson(res, status, obj) {
  send(res, status, "application/json", JSON.stringify(obj));
}

// Read the full request body as JSON (with a size cap).
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooBig) return reject(new Error("Request too large (max 15 MB)."));
      try { resolve(JSON.parse(raw || "{}")); }
      catch { reject(new Error("Invalid JSON body.")); }
    });
    req.on("error", reject);
  });
}

async function ollamaTags() {
  const r = await fetch(`${OLLAMA}/api/tags`);
  if (!r.ok) throw new Error("Ollama is not running.");
  const data = await r.json();
  return (data.models || []).map((m) => ({
    name: m.name,
    size: m.size,
    capabilities: m.details ? m.details.families : [],
    vision: (m.capabilities || []).includes("vision"),
    tools: (m.capabilities || []).includes("tools"),
  }));
}

// Build the final Ollama message list: system prompt + chat + attachments.
// Attachments: {type:"image"|"text", name, data(base64), mime}
function buildMessages(messages, attachments) {
  const list = (messages || []).slice();
  if (list[0]?.role !== "system") list.unshift({ role: "system", content: SYSTEM_PROMPT });
  if (!list.length) list.push({ role: "user", content: "" });
  const last = list[list.length - 1];
  if (last.role !== "user") list.push({ role: "user", content: "" });
  const user = list[list.length - 1];

  const images = [];
  const texts = [];
  for (const a of attachments || []) {
    if (a.type === "image") {
      images.push(a.data);
    } else {
      let text = "";
      try {
        const buf = Buffer.from(a.data || "", "base64");
        text = buf.toString("utf-8");
        if (!text.trim()) text = "(empty file)";
      } catch {
        text = "(could not read file)";
      }
      texts.push(`[Attachment: ${a.name || "file.txt"}]\n${text}`);
    }
  }
  if (images.length) user.images = images;
  if (texts.length) user.content = (user.content ? user.content + "\n\n" : "") + texts.join("\n\n");
  return list;
}

// Stream the chat answer from Ollama to the client as NDJSON deltas: {d:"text"} / {error:"..."}
async function streamChat(messages, model, attachments, res) {
  const list = buildMessages(messages, attachments);
  let r;
  try {
    r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: list,
        stream: true,
        keep_alive: "30m",
        options: { temperature: TEMP, top_p: 0.9, num_ctx: NUM_CTX, num_predict: 1024 },
      }),
    });
  } catch {
    res.write(JSON.stringify({ error: "Cannot reach Ollama. Is it running?" }) + "\n");
    return;
  }

  if (!r.ok || !r.body) {
    let msg = "Ollama error: " + r.status;
    try { const d = await r.json(); if (d.error) msg = d.error; } catch {}
    res.write(JSON.stringify({ error: msg }) + "\n");
    return;
  }

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line);
          if (o.message?.content) {
            res.write(JSON.stringify({ d: o.message.content }) + "\n");
          } else if (o.error) {
            res.write(JSON.stringify({ error: o.error }) + "\n");
          }
        } catch {}
      }
    }
  } catch (e) {
    res.write(JSON.stringify({ error: "Stream interrupted: " + e.message }) + "\n");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];

    if (url === "/api/health") {
      try {
        const r = await fetch(`${OLLAMA}/api/tags`);
        const models = await r.json();
        return sendJson(res, 200, {
          ok: true,
          ollama: r.ok,
          model: DEFAULT_MODEL,
          models: (models.models || []).map((m) => m.name),
        });
      } catch {
        return sendJson(res, 200, { ok: true, ollama: false, model: DEFAULT_MODEL, models: [] });
      }
    }

    if (url === "/api/models") {
      try {
        const models = await ollamaTags();
        return sendJson(res, 200, { models });
      } catch (e) {
        return sendJson(res, 200, { models: [], error: e.message });
      }
    }

    if (url === "/api/pull" && req.method === "POST") {
      const body = await readBody(req);
      const model = String(body.model || "").trim();
      if (!model) return sendJson(res, 400, { error: "Model name is required." });

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      });
      res.write(`Downloading ${model}...\n`);

      const child = spawn("ollama", ["pull", model], { shell: false });
      child.stdout.on("data", (d) => res.write(String(d)));
      child.stderr.on("data", (d) => res.write(String(d)));
      child.on("error", (e) => res.write(`Error: ${e.message}\n`));
      child.on("close", (code) => {
        res.write(code === 0 ? "\nDone.\n" : `\nFailed with code ${code}.\n`);
        res.end();
      });
      return;
    }

    if (url === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const model = String(body.model || "").trim() || DEFAULT_MODEL;
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
      await streamChat(messages, model, attachments, res);
      res.end();
      return;
    }

    // Static files
    let fileUrl = url;
    if (fileUrl === "/") fileUrl = "/index.html";
    const file = path.join(__dirname, fileUrl);
    if (!file.startsWith(__dirname)) return send(res, 403, "text/plain", "Forbidden");
    if (!fs.existsSync(file)) return send(res, 404, "text/plain", "Not found");

    const ext = path.extname(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css",
      ".js": "text/javascript",
      ".json": "application/json",
    };
    send(res, 200, types[ext] || "application/octet-stream", fs.readFileSync(file));
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`Fahd AI: http://localhost:${PORT}`));
