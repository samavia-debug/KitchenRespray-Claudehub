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
});
