const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "KitchenRespray-Monitoring/1.0 (+website health check)";
const MAX_PLUGINS_CHECKED = 15;

export type WordPressPlugin = {
  slug: string;
  version: string | null;
  latestVersion: string | null;
  isOutdated: boolean | null;
};

export type WordPressCheckResult = {
  isWordPress: boolean;
  coreVersion: string | null;
  themeSlug: string | null;
  plugins: WordPressPlugin[];
};

/**
 * Compares two dotted-numeric version strings. Returns -1/0/1 like a
 * normal comparator. Not a full semver parser (WordPress plugin versions
 * are dotted numbers in practice, not semver with pre-release tags), but
 * handles "1.2" vs "1.2.0" and different segment counts correctly.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

async function fetchLatestPluginVersion(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.wordpress.org/plugins/info/1.0/${slug}.json?fields=version`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Passive WordPress fingerprinting from the public homepage source only —
 * no WP admin credentials needed or used. Detects WordPress itself (the
 * <meta name="generator"> tag or wp-content/wp-json references), the
 * active theme, and any plugins whose front-end assets are enqueued with a
 * version query string (WordPress's own cache-busting convention), then
 * cross-checks each found plugin against the public WordPress.org Plugin
 * API to flag outdated ones.
 *
 * Real limits, stated plainly rather than glossed over: sites that hide
 * the generator tag (common security-plugin behavior) won't reveal a core
 * version; plugins with no front-end assets (admin-only/backend plugins)
 * are invisible to this method entirely; PHP version and "critical plugin
 * failures" genuinely need server-side access this technique can't provide.
 */
export async function checkWordPress(domain: string): Promise<WordPressCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html = "";
  try {
    const res = await fetch(`https://${domain}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    html = await res.text();
  } catch {
    return { isWordPress: false, coreVersion: null, themeSlug: null, plugins: [] };
  } finally {
    clearTimeout(timeout);
  }

  const generatorMatch = html.match(/<meta\s+name=["']generator["']\s+content=["']WordPress\s*([\d.]*)["']/i);
  const hasWpFootprint = /wp-content|wp-includes|wp-json/i.test(html);
  const isWordPress = !!generatorMatch || hasWpFootprint;

  if (!isWordPress) {
    return { isWordPress: false, coreVersion: null, themeSlug: null, plugins: [] };
  }

  const coreVersion = generatorMatch?.[1]?.trim() || null;
  const themeMatch = html.match(/wp-content\/themes\/([a-z0-9-]+)/i);
  const themeSlug = themeMatch?.[1] || null;

  const pluginVersions = new Map<string, string | null>();
  const pluginRegex = /wp-content\/plugins\/([a-z0-9-]+)\/[^"'\s]*?(?:\?ver=([\d.]+))?["'\s]/gi;
  let match: RegExpExecArray | null;
  while ((match = pluginRegex.exec(html)) && pluginVersions.size < MAX_PLUGINS_CHECKED) {
    const [, slug, version] = match;
    if (!pluginVersions.has(slug) || (!pluginVersions.get(slug) && version)) {
      pluginVersions.set(slug, version || null);
    }
  }

  const plugins: WordPressPlugin[] = [];
  for (const [slug, version] of Array.from(pluginVersions)) {
    const latestVersion = await fetchLatestPluginVersion(slug);
    const isOutdated = version && latestVersion ? compareVersions(version, latestVersion) < 0 : null;
    plugins.push({ slug, version, latestVersion, isOutdated });
  }

  return { isWordPress, coreVersion, themeSlug, plugins };
}
