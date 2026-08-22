import { getFeishuSettings } from "./settings.js";

function clipText(text, max = 2000) {
  const value = String(text || "").trim();
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

async function signRequest(secret, timestamp) {
  const keyBytes = new TextEncoder().encode(`${timestamp}\n${secret}`);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new Uint8Array());
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cardPayload(title, text, template = "blue") {
  return {
    msg_type: "interactive",
    card: {
      schema: "2.0",
      config: {
        update_multi: true,
      },
      header: {
        title: {
          tag: "plain_text",
          content: String(title || "Leon Tools 通知"),
        },
        subtitle: {
          tag: "plain_text",
          content: "",
        },
        template,
        padding: "12px 12px 12px 12px",
      },
      body: {
        direction: "vertical",
        padding: "12px 12px 12px 12px",
        elements: [
          {
            tag: "markdown",
            content: clipText(text) || "(无内容)",
            text_align: "left",
            text_size: "normal_v2",
            margin: "0px 0px 0px 0px",
          },
        ],
      },
    },
  };
}

export async function sendFeishuPost(title, text, template = "blue") {
  const { url, secret } = await getFeishuSettings();
  if (!url) return { skipped: true };
  const payload = cardPayload(title, text, template);
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    payload.timestamp = timestamp;
    payload.sign = await signRequest(secret, timestamp);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } finally {
    clearTimeout(timer);
  }
  const result = await response.json().catch(() => ({}));
  const code = result.code ?? result.StatusCode;
  if (!response.ok || (code != null && Number(code) !== 0)) {
    throw new Error(result.msg || result.StatusMessage || `飞书通知失败 HTTP ${response.status}`);
  }
  return result;
}

async function notifyQuietly(title, text, template) {
  try {
    await sendFeishuPost(title, text, template);
  } catch {
    /* webhook 失败不影响本地操作 */
  }
}

export function notifyNoteCreated(content) {
  return notifyQuietly("新增便签", content, "blue");
}

export function notifyTodoCreated(content) {
  return notifyQuietly("新增待办", content, "orange");
}

export function notifyTodoCompleted(content) {
  return notifyQuietly("完成待办", content, "green");
}
