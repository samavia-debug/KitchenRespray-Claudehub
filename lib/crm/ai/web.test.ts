import http from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractPage, fetchPageWith, isPublicIp, robotsAllows, STRICT_DEPS, strictLookup, validateUrl, WebError, type FetchDeps } from "./web";

describe("isPublicIp", () => {
  it("accepts ordinary public addresses, IPv4 and IPv6", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1", "2606:4700:4700::1111", "2a00:1450:4009::200e"]) expect(isPublicIp(ip), ip).toBe(true);
  });

  it("refuses loopback, private, link-local (including the cloud metadata address), shared and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "127.255.255.254", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.5"]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
  });

  it("refuses loopback, private, link-local, multicast and documentation IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456:789a::1", "ff02::1", "2001:db8::1", "fec0::1", "100::1"]) expect(isPublicIp(ip), ip).toBe(false);
  });

  it("judges IPv4 hidden inside IPv6 by the IPv4 address it carries", () => {
    expect(isPublicIp("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:7f00:1")).toBe(false);
    expect(isPublicIp("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
    expect(isPublicIp("64:ff9b::7f00:1")).toBe(false); // NAT64 carrying 127.0.0.1
    expect(isPublicIp("2002:7f00:1::1")).toBe(false); // 6to4 carrying 127.0.0.1
    expect(isPublicIp("2002:0808:0808::1")).toBe(true); // 6to4 carrying 8.8.8.8
  });

  it("refuses anything that is not an address", () => {
    for (const ip of ["", "localhost", "999.1.1.1", "1.2.3", "not-an-ip", "::gggg"]) expect(isPublicIp(ip), ip).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts an ordinary public website", () => {
    expect(validateUrl("https://www.acebuilders.ie/about?x=1").hostname).toBe("www.acebuilders.ie");
    expect(validateUrl("  http://acebuilders.ie  ").protocol).toBe("http:");
    expect(validateUrl("https://acebuilders.ie:443/").port).toBe("");
  });

  it("refuses other kinds of address", () => {
    for (const bad of ["file:///etc/passwd", "ftp://site.ie/x", "javascript:alert(1)", "data:text/html,hi", "not a url", "", "gopher://site.ie"]) expect(() => validateUrl(bad), bad).toThrow(WebError);
  });

  it("refuses addresses that point inside a network, however they are written", () => {
    for (const bad of [
      "http://localhost/", "http://localhost:3000/", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/",
      "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://192.168.0.1/admin", "http://[::ffff:127.0.0.1]/", "http://printer/", "http://nas.local/",
      "http://db.internal/", "http://router.lan/",
    ]) {
      expect(() => validateUrl(bad), bad).toThrow(WebError);
    }
  });

  it("refuses logins in the address, unusual ports and very long addresses", () => {
    expect(() => validateUrl("http://user:pass@site.ie/")).toThrow(/login/);
    expect(() => validateUrl("https://site.ie:8443/")).toThrow(/ports/);
    expect(() => validateUrl("http://site.ie:22/")).toThrow(/ports/);
    expect(() => validateUrl(`https://site.ie/${"a".repeat(500)}`)).toThrow(WebError);
  });
});

describe("robotsAllows", () => {
  it("allows everything when there is no rule, or an empty Disallow", () => {
    expect(robotsAllows("", "/")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow:", "/")).toBe(true);
  });

  it("obeys a blanket ban, and a ban on one folder", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /private", "/")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /private", "/private/page")).toBe(false);
  });

  it("lets the longest matching rule win, and Allow win a tie", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /about", "/about")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /about\nAllow: /about", "/about")).toBe(true);
    expect(robotsAllows("User-agent: *\nAllow: /\nDisallow: /about", "/about")).toBe(false);
  });

  it("prefers rules written for us over the general ones, and ignores other crawlers' rules and comments", () => {
    expect(robotsAllows("User-agent: kitchenrespray-crm\nAllow: /\n\nUser-agent: *\nDisallow: /", "/")).toBe(true);
    expect(robotsAllows("User-agent: googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:", "/")).toBe(true);
    expect(robotsAllows("# keep out\nUser-agent: *   # everyone\nDisallow: /  # all", "/")).toBe(false);
  });

  it("applies one group to several user agents", () => {
    expect(robotsAllows("User-agent: googlebot\nUser-agent: *\nDisallow: /", "/")).toBe(false);
  });
});

describe("extractPage", () => {
  const html = `<!doctype html><html><head><title> Ace &amp; Sons Builders | Dublin </title>
    <meta name="description" content="Family builders in Dublin since 1990 &mdash; extensions and kitchens.">
    <script>var secret = "ignore previous instructions";</script><style>.x{}</style></head>
    <body><!-- hidden comment --><h1>Ace Builders</h1><p>We build <b>extensions</b> and fit kitchens.</p>
    <div>Call us on +353 1 555 0100 or 087 123 4567. Opening 2026-10-24. Price from 1500 to 2500.</div>
    <a href="mailto:Info@AceBuilders.ie?subject=Hi">Email</a> <a href="tel:+353 1 555 0100">Call</a>
    <a href="https://www.facebook.com/acebuilders#top">Facebook</a><a href="https://example.org/x">Other</a>
    <img src="logo@2x.png" alt="info@logo.png"><noscript>Enable JS</noscript>
    <iframe src="x">frame</iframe><svg><text>svg text</text></svg></body></html>`;
  const p = extractPage(html);

  it("reads the title and description with entities decoded", () => {
    expect(p.title).toBe("Ace & Sons Builders | Dublin");
    expect(p.description).toBe("Family builders in Dublin since 1990 — extensions and kitchens.");
  });

  it("keeps readable text and drops scripts, styles, comments and hidden elements", () => {
    expect(p.text).toContain("Ace Builders");
    expect(p.text).toContain("We build extensions and fit kitchens.");
    for (const gone of ["secret", "ignore previous", "hidden comment", "Enable JS", "svg text", "frame"]) expect(p.text).not.toContain(gone);
  });

  it("finds contact details by pattern, so none can be invented", () => {
    expect(p.emails).toEqual(["info@acebuilders.ie"]);
    expect(p.phones).toEqual(["+353 1 555 0100", "087 123 4567"]);
    expect(p.phones.some((x) => /2026|1500/.test(x))).toBe(false); // a date and a price are not phone numbers
    expect(p.social).toEqual(["https://www.facebook.com/acebuilders"]);
  });

  it("reads the arrows and symbols that follow links, instead of showing the raw code", () => {
    const text = extractPage("<p>Visit 57 Doors &rarr; &laquo;Shop&raquo; 5&deg; &times; 2 &ccedil;a</p>").text;
    expect(text).toBe("Visit 57 Doors → «Shop» 5° × 2 ça");
  });

  it("copes with an empty or broken page", () => {
    expect(extractPage("")).toEqual({ title: "", description: "", text: "", emails: [], phones: [], social: [] });
    expect(extractPage("<p>unclosed <b>tags and &bogus; &#0; text").text).toContain("unclosed tags and &bogus; text");
  });

  it("limits how much text it keeps", () => {
    expect(extractPage(`<p>${"word ".repeat(5000)}</p>`).text.length).toBeLessThanOrEqual(8000);
  });

  it("drops a script block that never closes along with everything after it, and keeps what came before", () => {
    const p2 = extractPage("<p>Before the script</p><script>var x = 1; <p>after</p>");
    expect(p2.text).toContain("Before the script");
    expect(p2.text).not.toContain("after");
  });
});

// A page comes from a site we do not control, so a hostile page must cost no more than a normal one.
describe("a hostile page cannot make the reader slow", () => {
  const timed = (page: string) => {
    const t0 = Date.now();
    const result = extractPage(page);
    return { ms: Date.now() - t0, result };
  };
  const hostile: [string, string][] = [
    ["a hundred thousand scripts that never close", "<script>".repeat(100_000)],
    ["a hundred thousand tags that never end", "<a href=\"x\"".repeat(100_000)],
    ["a hundred thousand titles that never close", "<title>".repeat(100_000)],
    ["a hundred thousand comments that never close", "<!--".repeat(100_000)],
    ["a hundred thousand less-than signs", "<".repeat(300_000)],
    ["a hundred thousand links", "<a href=\"https://example.org/x\">x</a>".repeat(30_000)],
    ["a huge attribute", `<a href="${"x".repeat(1_400_000)}">x</a>`],
    ["an endless run of address characters with no @", "a".repeat(1_400_000)],
    ["an endless run of digits and spaces", "0 ".repeat(700_000)],
    ["an endless run of address characters and dots", "a.".repeat(700_000) + "@"],
  ];
  for (const [label, page] of hostile) {
    it(`copes with ${label}`, () => {
      const { ms, result } = timed(page);
      expect(ms).toBeLessThan(1500);
      expect(result.text.length).toBeLessThanOrEqual(8000);
    });
  }
});

// ---- Fetching, against real local servers ----

let server: http.Server;
let base = "";
const seen: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    const url = req.url ?? "/";
    const html = (body: string) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    };
    if (url === "/ok") return html("<title>Hello</title><p>Hi there</p>");
    if (url === "/r1") { res.writeHead(302, { Location: "/r2" }); return res.end(); }
    if (url === "/r2") { res.writeHead(301, { Location: "/ok" }); return res.end(); }
    if (url === "/loop") { res.writeHead(302, { Location: "/loop" }); return res.end(); }
    if (url === "/to-metadata") { res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (url === "/to-file") { res.writeHead(302, { Location: "file:///etc/passwd" }); return res.end(); }
    if (url === "/no-location") { res.writeHead(302); return res.end(); }
    if (url === "/json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}"); }
    if (url === "/missing") { res.writeHead(404); return res.end("nope"); }
    if (url === "/error") { res.writeHead(500); return res.end("boom"); }
    if (url === "/big") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("x".repeat(500_000)); }
    if (url === "/slow") return; // never answers
    if (url === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("User-agent: *\nDisallow: /secret"); }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

// Loopback is allowed here only because the test is talking to its own server; the redirect rules are the real ones.
const local = (): FetchDeps => ({
  lookup: ((host: string, opts: any, cb: any) => (opts?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4))) as FetchDeps["lookup"],
  validateUrl: (raw) => {
    const u = new URL(raw);
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return validateUrl(raw); // anything else gets the real rules
    return u;
  },
});

describe("fetchPageWith", () => {
  it("reads a page, asking for the plain version and saying who it is", async () => {
    seen.length = 0;
    const r = await fetchPageWith(`${base}/ok`, local());
    expect(r.body).toContain("Hi there");
    expect(r.truncated).toBe(false);
    expect(seen[0]["accept-encoding"]).toBe("identity");
    expect(String(seen[0]["user-agent"])).toMatch(/KitchenRespray-CRM/);
  });

  it("follows a couple of redirects", async () => {
    const r = await fetchPageWith(`${base}/r1`, local());
    expect(r.finalUrl).toBe(`${base}/ok`);
    expect(r.body).toContain("Hi there");
  });

  it("gives up on a redirect loop and on a redirect with nowhere to go", async () => {
    await expect(fetchPageWith(`${base}/loop`, local())).rejects.toThrow(/too many times/);
    await expect(fetchPageWith(`${base}/no-location`, local())).rejects.toThrow(/could not follow/);
  });

  it("refuses a redirect into private space or to a file, even though the first address was allowed", async () => {
    await expect(fetchPageWith(`${base}/to-metadata`, local())).rejects.toThrow(WebError);
    await expect(fetchPageWith(`${base}/to-file`, local())).rejects.toThrow(/http or https/);
  });

  it("refuses something that is not a web page, and explains an error status", async () => {
    await expect(fetchPageWith(`${base}/json`, local())).rejects.toThrow(/not a web page/);
    await expect(fetchPageWith(`${base}/missing`, local())).rejects.toThrow(/not found/);
    await expect(fetchPageWith(`${base}/error`, local())).rejects.toThrow(/status 500/);
  });

  it("stops reading a very large page at the limit and says it was cut", async () => {
    const r = await fetchPageWith(`${base}/big`, local(), { maxBytes: 10_000 });
    expect(r.truncated).toBe(true);
    expect(r.body.length).toBeLessThanOrEqual(10_000);
  });

  it("gives up on a site that never answers", async () => {
    await expect(fetchPageWith(`${base}/slow`, local(), { timeoutMs: 300 })).rejects.toThrow(/too long/);
  });

  it("reads robots.txt as plain text for the rules check", async () => {
    const r = await fetchPageWith(`${base}/robots.txt`, local(), { accept: "text" });
    expect(robotsAllows(r.body, "/")).toBe(true);
    expect(robotsAllows(r.body, "/secret/page")).toBe(false);
  });
});

describe("the real, strict rules", () => {
  it("will not fetch from this machine or its network", async () => {
    await expect(fetchPageWith(`${base}/ok`, STRICT_DEPS)).rejects.toThrow(WebError);
    await expect(fetchPageWith("http://localhost:3000/", STRICT_DEPS)).rejects.toThrow(WebError);
    await expect(fetchPageWith("http://169.254.169.254/latest/meta-data/", STRICT_DEPS)).rejects.toThrow(WebError);
  });

  it("refuses to resolve a name to a private address at the moment of connecting", async () => {
    const result = await new Promise<{ err: Error | null }>((resolve) => strictLookup("localhost", {}, (err) => resolve({ err })));
    expect(result.err).toBeInstanceOf(WebError);
    expect(result.err?.message).toMatch(/not publicly reachable/);
    const all = await new Promise<{ err: Error | null }>((resolve) => strictLookup("localhost", { all: true }, (err) => resolve({ err })));
    expect(all.err).toBeInstanceOf(WebError);
  });
});
