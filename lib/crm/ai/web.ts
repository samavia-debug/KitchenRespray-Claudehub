import { lookup as dnsLookup } from "dns";
import http from "http";
import https from "https";
import { isIP } from "net";

// Reads a company's own public web page so the AI can summarise what it says. The address comes from a record, so it is
// treated as untrusted: this must never be usable to reach anything inside our own network. Hence:
// - only http and https, no logins in the address, no IP-address or single-word hosts, only the usual web ports
// - the address the connection really goes to is checked when it connects, so a name that points somewhere private
//   (or changes its answer between checks) is refused
// - redirects are followed by hand, a few at a time, and each hop is checked afresh
// - the size, the time and the kind of content are all capped, and compressed responses are not accepted

export class WebError extends Error {}

export const USER_AGENT = "KitchenRespray-CRM/1.0 (company research)";
const ROBOTS_AGENT = "kitchenrespray-crm";

// ---------- addresses ----------

function v4(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

const BLOCKED_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8], [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24], [[192, 88, 99, 0], 24], [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24], [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
];

function inV4(p: number[], base: number[], bits: number): boolean {
  const toInt = (a: number[]) => ((a[0] << 24) >>> 0) + (a[1] << 16) + (a[2] << 8) + a[3];
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((toInt(p) & mask) >>> 0) === ((toInt(base) & mask) >>> 0);
}

export function isPublicV4(ip: string): boolean {
  const p = v4(ip);
  return !!p && !BLOCKED_V4.some(([base, bits]) => inV4(p, base, bits));
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function parseV6(raw: string): number[] | null {
  let ip = raw.toLowerCase().split("%")[0];
  // A dotted IPv4 tail ("::ffff:1.2.3.4") becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (tail) {
    const q = v4(tail[1]);
    if (!q) return null;
    ip = ip.slice(0, -tail[1].length) + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.length === 8 && groups.every((n) => !Number.isNaN(n)) ? groups : null;
}

const groupsToV4 = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

export function isPublicV6(ip: string): boolean {
  const g = parseV6(ip);
  if (!g) return false;
  // IPv4 inside IPv6: judged by the IPv4 address it carries.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(groupsToV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(groupsToV4(g[6], g[7]));
  if (g[0] === 0x2002) return isPublicV4(groupsToV4(g[1], g[2]));
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::, ::1 and the old IPv4-compatible form
  // Only global unicast (2000::/3) is public, minus the ranges set aside for documentation, tunnelling and tests.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0 || g[1] === 0x0002)) return false;
  return true;
}

export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  return kind === 4 ? isPublicV4(ip) : kind === 6 ? isPublicV6(ip) : false;
}

// ---------- the address ----------

const PRIVATE_SUFFIX = /\.(local|localhost|internal|lan|home|corp|intranet|test|invalid|example)$/;

/** A web address that is safe to fetch, or a WebError saying why not. */
export function validateUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length > 400) throw new WebError("That is not a web address I can read.");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new WebError("That is not a web address I can read.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new WebError("Only web addresses starting with http or https can be read.");
  if (u.username || u.password) throw new WebError("Web addresses with a login in them are not read.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(host.replace(/^\[|\]$/g, ""))) throw new WebError("Addresses made of numbers are not read.");
  if (host === "localhost" || !host.includes(".") || PRIVATE_SUFFIX.test(host)) throw new WebError("That address is not a public website.");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (port !== 80 && port !== 443) throw new WebError("Only the usual web ports are used.");
  return u;
}

// ---------- fetching ----------

type LookupCallback = (err: NodeJS.ErrnoException | null, address: any, family?: number) => void;
export type LookupFn = (hostname: string, options: any, callback: LookupCallback) => void;

/** DNS lookup that refuses to answer with anything that is not a public address, at the moment of connecting. */
export const strictLookup: LookupFn = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = (addresses as unknown as { address: string; family: number }[]) ?? [];
    if (list.length === 0 || list.some((a) => !isPublicIp(a.address))) return callback(new WebError("That website is not publicly reachable.") as NodeJS.ErrnoException, "", 0);
    if (options?.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

export type FetchDeps = { validateUrl: (raw: string) => URL; lookup: LookupFn };
export const STRICT_DEPS: FetchDeps = { validateUrl, lookup: strictLookup };

export type FetchOptions = { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; accept?: "html" | "text" };
export type Fetched = { finalUrl: string; body: string; truncated: boolean };

function requestOnce(url: URL, deps: FetchDeps, opts: Required<FetchOptions>): Promise<{ status: number; location: string | null; contentType: string; body: string; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        method: "GET",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: { "User-Agent": USER_AGENT, Accept: opts.accept === "html" ? "text/html,application/xhtml+xml" : "text/plain", "Accept-Encoding": "identity" },
        lookup: deps.lookup as any,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if ((status >= 300 && status < 400) || status >= 400) {
          res.resume();
          return resolve({ status, location, contentType, body: "", truncated: false });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - opts.maxBytes)));
            res.destroy();
          } else chunks.push(c);
        });
        res.on("close", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8"), truncated }));
        res.on("error", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8"), truncated }));
      }
    );
    const timer = setTimeout(() => req.destroy(new WebError("The website took too long to answer.")), opts.timeoutMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e instanceof WebError ? e : new WebError(/not publicly reachable/.test(e.message) ? e.message : "Could not reach that website."));
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

/**
 * Fetches one page. `deps` decides what addresses are allowed (the real ones are strict; tests give it permissive ones
 * to exercise the redirect, size and content rules against a local server).
 */
export async function fetchPageWith(raw: string, deps: FetchDeps, options: FetchOptions = {}): Promise<Fetched> {
  const opts: Required<FetchOptions> = { timeoutMs: 8000, maxBytes: 1_500_000, maxRedirects: 3, accept: "html", ...options };
  let current = raw;
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const url = deps.validateUrl(current);
    const res = await requestOnce(url, deps, opts);
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new WebError("The website sent me somewhere I could not follow.");
      current = new URL(res.location, url).toString();
      continue;
    }
    if (res.status >= 400) throw new WebError(res.status === 404 ? "That page was not found." : `The website refused or could not answer (status ${res.status}).`);
    const wanted = opts.accept === "html" ? /text\/html|application\/xhtml\+xml/ : /text\/plain/;
    if (!wanted.test(res.contentType)) throw new WebError("That address is not a web page I can read.");
    return { finalUrl: url.toString(), body: res.body, truncated: res.truncated };
  }
  throw new WebError("The website redirected too many times.");
}

// ---------- robots.txt ----------

/** Whether robots.txt lets our crawler read `path`. The longest matching rule wins, and allowing wins a tie. */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; prefix: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const line of robots.split(/\r?\n/)) {
    const text = line.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(text);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      current.rules.push({ allow: key === "allow", prefix: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const group = groups.find((g) => g.agents.some((a) => ROBOTS_AGENT.includes(a) && a !== "*" && a !== "")) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; length: number } | null = null;
  for (const r of group.rules) {
    if (r.prefix === "") continue; // "Disallow:" with nothing means everything is allowed
    if (path.startsWith(r.prefix) && (!best || r.prefix.length > best.length || (r.prefix.length === best.length && r.allow))) best = { allow: r.allow, length: r.prefix.length };
  }
  return best ? best.allow : true;
}

// ---------- reading the page ----------

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", middot: "·", eacute: "é", egrave: "è", aacute: "á", iacute: "í", oacute: "ó", uacute: "ú",
  // Arrows and other marks that often follow a link ("Visit our shop →"), and common accented letters.
  rarr: "→", larr: "←", uarr: "↑", darr: "↓", raquo: "»", laquo: "«", sbquo: "‚", bdquo: "„", times: "×", divide: "÷", deg: "°", plusmn: "±", frac12: "½",
  sect: "§", para: "¶", dagger: "†", check: "✓", hearts: "♥", agrave: "à", acirc: "â", auml: "ä", ccedil: "ç", ecirc: "ê", euml: "ë", icirc: "î", iuml: "ï",
  ntilde: "ñ", ocirc: "ô", ouml: "ö", szlig: "ß", ucirc: "û", uuml: "ü", oslash: "ø", aring: "å", aelig: "æ", iexcl: "¡", iquest: "¿", cent: "¢", yen: "¥",
};

function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export type PageFacts = { title: string; description: string; text: string; emails: string[]; phones: string[]; social: string[] };

const SOCIAL = /^https?:\/\/(?:www\.)?(?:facebook\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com)\//i;
const NOT_AN_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|@\d+x\./i;

/** Parts of a page that are not for reading: their contents are dropped whole. */
const SKIP = new Set(["script", "style", "noscript", "svg", "template", "iframe"]);
const BLOCK = new Set(["p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "section", "article", "header", "footer", "br", "table", "main", "nav", "form"]);
const MAX_TAG_TEXT = 2000;
const MAX_HTML = 1_500_000;

const attrOf = (tag: string, name: string) => {
  // No real tag has this much attribute text; refusing it keeps a crafted one from being scanned over and over.
  if (tag.length > MAX_TAG_TEXT) return null;
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeHtml(m[2] ?? m[3] ?? "") : null;
};

const unique = <T,>(xs: T[]) => Array.from(new Set(xs));
const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);

/**
 * The readable text of a page, with its title and description, and the contact details and social links it shows.
 * The contact details are found here by pattern, not by the AI, so none can be invented.
 *
 * A page comes from a website we do not control, so it is read in one pass and never with a pattern that can run to the
 * end of the page again for every tag: a page full of tags that never close costs no more than a normal one. A tag
 * that never ends, or a block that never closes, simply ends the reading.
 */
export function extractPage(html: string): PageFacts {
  const src = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  const lower = src.toLowerCase();
  const hrefs: string[] = [];
  let title = "";
  let description = "";
  let body = "";

  let pos = 0;
  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    if (lt === -1) {
      body += src.slice(pos);
      break;
    }
    body += src.slice(pos, lt);

    if (lower.startsWith("<!--", lt)) {
      const end = lower.indexOf("-->", lt + 4);
      pos = end === -1 ? src.length : end + 3;
      body += " ";
      continue;
    }

    const closing = src.charCodeAt(lt + 1) === 47;
    let nameEnd = lt + (closing ? 2 : 1);
    if (!isLetter(src.charCodeAt(nameEnd))) {
      body += "<"; // not a tag, just a less-than sign
      pos = lt + 1;
      continue;
    }
    while (nameEnd < src.length && /[a-z0-9]/i.test(src[nameEnd])) nameEnd++;
    const name = lower.slice(lt + (closing ? 2 : 1), nameEnd);

    const gt = src.indexOf(">", nameEnd);
    if (gt === -1) break; // a tag that never ends: nothing after it can be read
    const tag = src.slice(lt, gt + 1);

    if (!closing && SKIP.has(name)) {
      const end = lower.indexOf(`</${name}`, gt);
      if (end === -1) break; // a block that never closes swallows the rest of the page
      const endGt = lower.indexOf(">", end);
      pos = endGt === -1 ? src.length : endGt + 1;
      body += " ";
      continue;
    }

    if (!closing && name === "title") {
      const end = lower.indexOf("</title", gt);
      if (end === -1) break;
      if (!title) title = decodeHtml(src.slice(gt + 1, end)).replace(/\s+/g, " ").trim().slice(0, 200);
      const endGt = lower.indexOf(">", end);
      pos = endGt === -1 ? src.length : endGt + 1;
      continue;
    }

    if (!closing && name === "meta" && !description) {
      const label = (attrOf(tag, "name") ?? attrOf(tag, "property") ?? "").toLowerCase();
      if (label === "description" || label === "og:description") description = (attrOf(tag, "content") ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    }

    if (!closing && name === "a") {
      const href = attrOf(tag, "href");
      if (href) hrefs.push(href);
    }

    body += BLOCK.has(name) ? "\n" : " ";
    pos = gt + 1;
  }

  const text = decodeHtml(body)
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 8000);

  const emails = unique(
    [
      ...hrefs.filter((h) => /^mailto:/i.test(h)).map((h) => h.replace(/^mailto:/i, "").split("?")[0]),
      ...(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []),
    ]
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !NOT_AN_EMAIL.test(e))
  ).slice(0, 5);

  const digits = (v: string) => v.replace(/\D/g, "").length;
  const phones = unique(
    [
      ...hrefs.filter((h) => /^tel:/i.test(h)).map((h) => safeDecode(h.replace(/^tel:/i, "")).trim()),
      // In running text only numbers that start like a phone number (a + or a 0), so years and prices are not picked up.
      // The character before must not be a letter, digit or +, so the "0" inside "2026" does not start a number.
      ...Array.from(text.matchAll(/(^|[^\w+])((?:\+|00|\(?0)[\d\s().\-]{6,16}\d)/g)).map((m) => m[2]),
    ]
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => digits(p) >= 7 && digits(p) <= 15 && !/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(p))
  ).slice(0, 5);

  const social = unique(hrefs.filter((h) => SOCIAL.test(h)).map((h) => h.split("#")[0])).slice(0, 6);
  return { title, description, text, emails, phones, social };
}

/** decodeURIComponent, but a badly encoded address is kept as written instead of throwing. */
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
