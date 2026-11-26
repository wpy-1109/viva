import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import type { FetchImpl } from "./github.js";

const BLOCKED = new BlockList();
BLOCKED.addSubnet("0.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("10.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("100.64.0.0", 10, "ipv4");
BLOCKED.addSubnet("127.0.0.0", 8, "ipv4");
BLOCKED.addSubnet("169.254.0.0", 16, "ipv4");
BLOCKED.addSubnet("172.16.0.0", 12, "ipv4");
BLOCKED.addSubnet("192.168.0.0", 16, "ipv4");
BLOCKED.addSubnet("198.18.0.0", 15, "ipv4");
BLOCKED.addSubnet("224.0.0.0", 4, "ipv4");
BLOCKED.addAddress("::1", "ipv6");
BLOCKED.addSubnet("fc00::", 7, "ipv6");
BLOCKED.addSubnet("fe80::", 10, "ipv6");
BLOCKED.addSubnet("ff00::", 8, "ipv6");

export function assertPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 0) throw new Error("not_ip");
  const kind = family === 6 ? "ipv6" : "ipv4";
  const normalized = address.replace(/^\[|\]$/g, "");
  if (BLOCKED.check(normalized, kind)) throw new Error("blocked_address");
}

const SPECIAL_HOST = /^(localhost|.*\.localhost|.*\.local)$/i;

export type PinnedConnect = (input: { url: URL; address: string }) => Promise<Response>;

export async function safeFetch(input: string, deps: {
  resolver: (host: string) => Promise<string[]>;
  fetchImpl?: FetchImpl;
  connect?: PinnedConnect;
  maxBytes?: number;
  redirects?: number;
}) {
  const maxBytes = deps.maxBytes ?? 1_048_576;
  let current = new URL(input);
  if (current.username || current.password) throw new Error("userinfo_rejected");
  for (let hop = 0; hop <= (deps.redirects ?? 3); hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("bad_scheme");
    if (SPECIAL_HOST.test(current.hostname)) throw new Error("blocked_address");
    const addresses = isIP(current.hostname) ? [current.hostname] : await deps.resolver(current.hostname);
    if (addresses.length === 0) throw new Error("dns_failed");
    for (const address of addresses) assertPublicAddress(address);
    const address = addresses[0];
    const response = deps.connect
      ? await deps.connect({ url: current, address })
      : await deps.fetchImpl!(current.toString(), { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("bad_redirect");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`url_${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new Error("body_too_large");
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("body_too_large");
    return { url: current.toString(), text: stripHtml(text, response.headers.get("content-type")), contentType: response.headers.get("content-type") };
  }
  throw new Error("too_many_redirects");
}

export function pinnedConnect(input: { url: URL; address: string }) {
  const lib = input.url.protocol === "https:" ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const request = lib.request({
      protocol: input.url.protocol,
      hostname: input.address,
      servername: input.url.hostname,
      method: "GET",
      path: `${input.url.pathname}${input.url.search}`,
      headers: { host: input.url.host, "user-agent": "viva/0.1" },
      timeout: 15_000,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(", "));
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 0, headers }));
      });
    });
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

function stripHtml(text: string, contentType: string | null) {
  if (!contentType?.includes("html")) return text;
  return text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
