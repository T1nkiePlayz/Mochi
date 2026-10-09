import { assertEquals } from "jsr:@std/assert@1";
import { clientIp, rateLimited, resetRateLimit, handle } from "./handler.ts";

Deno.test("client IP ignores caller-controlled X-Forwarded-For", () => {
  assertEquals(clientIp(new Request("https://example.test", {
    headers: { "x-forwarded-for": "203.0.113.55" },
  })), "unknown");
});

Deno.test("client IP accepts valid Cloudflare IPv4 and IPv6 metadata", () => {
  assertEquals(clientIp(new Request("https://example.test", {
    headers: { "cf-connecting-ip": "203.0.113.7" },
  })), "203.0.113.7");
  assertEquals(clientIp(new Request("https://example.test", {
    headers: { "cf-connecting-ip": "2001:DB8::1" },
  })), "2001:db8::1");
});

Deno.test("malformed IP metadata shares the unknown bucket", () => {
  for (const ip of ["999.1.1.1", "1.2.3", "1.2.3.4, 5.6.7.8", "not-an-ip", ""]) {
    assertEquals(clientIp(new Request("https://example.test", {
      headers: { "cf-connecting-ip": ip, "x-forwarded-for": "203.0.113.8" },
    })), "unknown", ip);
  }
});

Deno.test("rate limiter permits 120 requests and limits the next request", () => {
  resetRateLimit();
  for (let i = 0; i < 120; i++) assertEquals(rateLimited("198.51.100.10", 10_000), false);
  assertEquals(rateLimited("198.51.100.10", 10_000), true);
  assertEquals(rateLimited("198.51.100.10", 70_001), false);
  resetRateLimit();
});

Deno.test("oversized request bodies are rejected before JSON parsing", async () => {
  const body = JSON.stringify({ route: "games", padding: "x".repeat(9000) });
  const response = await handle(new Request("https://example.test", {
    method: "POST",
    headers: { "cf-connecting-ip": "198.51.100.20", "content-type": "application/json" },
    body,
  }));
  assertEquals(response.status, 400);
  const payload = await response.json();
  assertEquals(payload.code, "bad_request");
  assertEquals(payload.error, "Request body is too large.");
});
