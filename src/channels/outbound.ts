import type { FetchImpl } from "../sources/github.js";

export function buildFeishuText(text: string) {
  return { msg_type: "text" as const, content: { text } };
}

export function buildDingTalkMarkdown(title: string, text: string) {
  return { msgtype: "markdown" as const, markdown: { title, text } };
}

export async function sendIfAllowed(input: { allow: boolean; url?: string | null; payload: unknown; fetchImpl: FetchImpl }) {
  if (!input.allow) return { sent: false as const, reason: "outbound_disabled" };
  if (!input.url) return { sent: false as const, reason: "no_destination" };
  const response = await input.fetchImpl(input.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.payload),
  });
  if (!response.ok) return { sent: false as const, reason: `http_${response.status}` };
  return { sent: true as const };
}
