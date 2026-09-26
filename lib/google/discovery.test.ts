import { describe, expect, it } from "vitest";
import { domainCore, matchGa4Property, matchSearchConsoleSite } from "./discovery";

describe("domainCore", () => {
  it("strips protocol, www, TLD and punctuation", () => {
    expect(domainCore("https://www.bathrespray.com/")).toBe("bathrespray");
    expect(domainCore("bathrespray.com")).toBe("bathrespray");
    expect(domainCore("bathrespray")).toBe("bathrespray");
    expect(domainCore("kitchenfacelift.ie")).toBe("kitchenfacelift");
  });

  it("strips sc-domain: prefix used by Search Console domain properties", () => {
    expect(domainCore("sc-domain:bathrespray.com")).toBe("bathrespray");
  });

  it("strips two-part TLDs like .co.uk", () => {
    expect(domainCore("https://example.co.uk/")).toBe("example");
  });
});

describe("matchGa4Property", () => {
  const properties = [
    { property: "properties/1", displayName: "bathrespray" },
    { property: "properties/2", displayName: "kitchenrespraykildare" },
  ];

  it("matches a property whose display name is the bare domain", () => {
    expect(matchGa4Property("bathrespray.com", properties)).toEqual(properties[0]);
  });

  it("returns null when nothing matches", () => {
    expect(matchGa4Property("unrelated-site.com", properties)).toBeNull();
  });

  it("resolves two real properties that differ only by TLD instead of collapsing them (regression: kitchenrespray.com vs .ie both silently matched the .ie property, leaving .com's real ad-driven traffic disconnected)", () => {
    const collidingProperties = [
      { property: "properties/com", displayName: "kitchenrespray.com" },
      { property: "properties/ie", displayName: "kitchenrespray.ie" },
    ];

    expect(matchGa4Property("kitchenrespray.com", collidingProperties)).toEqual(collidingProperties[0]);
    expect(matchGa4Property("kitchenrespray.ie", collidingProperties)).toEqual(collidingProperties[1]);
  });

  it("still falls back to a core (TLD-stripped) match when no exact-domain match exists", () => {
    expect(matchGa4Property("kitchenrespraykildare.com", properties)).toEqual(properties[1]);
  });
});

describe("matchSearchConsoleSite", () => {
  const sites = [
    { siteUrl: "https://bathrespray.com/", permissionLevel: "siteFullUser" },
    { siteUrl: "sc-domain:worktoprespray.com", permissionLevel: "siteOwner" },
  ];

  it("matches a URL-prefix property", () => {
    expect(matchSearchConsoleSite("bathrespray.com", sites)).toEqual(sites[0]);
  });

  it("matches a domain property (sc-domain: prefix)", () => {
    expect(matchSearchConsoleSite("worktoprespray.com", sites)).toEqual(sites[1]);
  });

  it("returns null when nothing matches", () => {
    expect(matchSearchConsoleSite("unrelated-site.com", sites)).toBeNull();
  });

  it("resolves two real sites that differ only by TLD instead of collapsing them", () => {
    const collidingSites = [
      { siteUrl: "https://kitchenrespray.com/", permissionLevel: "siteFullUser" },
      { siteUrl: "https://kitchenrespray.ie/", permissionLevel: "siteFullUser" },
    ];

    expect(matchSearchConsoleSite("kitchenrespray.com", collidingSites)).toEqual(collidingSites[0]);
    expect(matchSearchConsoleSite("kitchenrespray.ie", collidingSites)).toEqual(collidingSites[1]);
  });
});
