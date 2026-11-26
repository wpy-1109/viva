import { describe, expect, it } from "vitest";
import { safeFetch } from "../src/sources/url.js";

function resolverFor(map: Record<string, string[]>) {
  return async (host: string) => map[host] ?? [];
}

describe("url fetching", () => {
  it("refuses ipv6 loopback and unique-local addresses", async () => {
    await expect(safeFetch("http://[::1]/", { resolver: async () => ["::1"], fetchImpl: fetch })).rejects.toThrow(/blocked_address/);
    await expect(safeFetch("http://ula.example/", { resolver: async () => ["fd00::1"], fetchImpl: fetch })).rejects.toThrow(/blocked_address/);
  });

  it("refuses private, loopback, and metadata addresses before connecting", async () => {
    const resolver = resolverFor({
      "public.example": ["203.0.113.10"],
      "meta.example": ["169.254.169.254"],
      "lan.example": ["192.168.1.20"],
      "local.example": ["127.0.0.1"],
    });
    await expect(safeFetch("http://meta.example/latest", { resolver, fetchImpl: fetch })).rejects.toThrow(/blocked_address/);
    await expect(safeFetch("https://lan.example/a", { resolver, fetchImpl: fetch })).rejects.toThrow(/blocked_address/);
    await expect(safeFetch("http://127.0.0.1/", { resolver, fetchImpl: fetch })).rejects.toThrow(/blocked_address/);
  });

  it("does not follow a redirect onto a private address", async () => {
    let connections = 0;
    const result = safeFetch("https://public.example/start", {
      resolver: resolverFor({ "public.example": ["203.0.113.10"], "lan.example": ["10.1.1.1"] }),
      fetchImpl: async () => {
        connections += 1;
        return new Response(null, { status: 302, headers: { location: "https://lan.example/secret" } });
      },
    });
    await expect(result).rejects.toThrow(/blocked_address/);
    expect(connections).toBe(1);
  });

  it("connects only to the address checked before a later DNS answer changes", async () => {
    const seen: string[] = [];
    let lookups = 0;
    const result = await safeFetch("https://public.example/page", {
      resolver: async () => {
        lookups += 1;
        return lookups === 1 ? ["203.0.113.10"] : ["127.0.0.1"];
      },
      connect: async ({ address }) => {
        seen.push(address);
        return new Response("公开正文", { status: 200, headers: { "content-type": "text/plain" } });
      },
    });
    expect(result.text).toContain("公开正文");
    expect(seen).toEqual(["203.0.113.10"]);
    expect(lookups).toBe(1);
  });

  it("rejects a name that resolves to both a public and a private address", async () => {
    await expect(safeFetch("https://mixed.example/a", {
      resolver: async () => ["203.0.113.10", "10.1.1.1"],
      connect: async () => { throw new Error("should not connect"); },
    })).rejects.toThrow(/blocked_address/);
  });

  it("rejects non-http schemes and oversized bodies", async () => {
    await expect(safeFetch("file:///etc/passwd", { resolver: async () => [], fetchImpl: fetch })).rejects.toThrow(/bad_scheme/);
    await expect(safeFetch("https://public.example/big", {
      resolver: resolverFor({ "public.example": ["203.0.113.10"] }),
      fetchImpl: async () => new Response("x".repeat(1_100_000), { status: 200, headers: { "content-type": "text/plain" } }),
      maxBytes: 1_048_576,
    })).rejects.toThrow(/body_too_large/);
  });
});
