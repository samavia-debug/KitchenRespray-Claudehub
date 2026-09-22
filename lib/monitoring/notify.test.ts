import { afterEach, describe, expect, it, vi } from "vitest";
import { formatIncidentOpenedMessage, formatIncidentResolvedMessage, notifySlack } from "./notify";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("formatIncidentOpenedMessage", () => {
  it("uses a red circle for offline", () => {
    expect(formatIncidentOpenedMessage("Kitchen Respray", "kitchenrespray.com", "offline")).toContain("🔴");
  });

  it("uses an orange circle for critical", () => {
    expect(formatIncidentOpenedMessage("Kitchen Respray", "kitchenrespray.com", "critical")).toContain("🟠");
  });

  it("includes the site name, domain, and severity", () => {
    const msg = formatIncidentOpenedMessage("Kitchen Respray", "kitchenrespray.com", "offline");
    expect(msg).toContain("Kitchen Respray");
    expect(msg).toContain("kitchenrespray.com");
    expect(msg).toContain("offline");
  });
});

describe("formatIncidentResolvedMessage", () => {
  it("includes a recovered marker and the duration", () => {
    const msg = formatIncidentResolvedMessage("Kitchen Respray", "kitchenrespray.com", "2h 15m");
    expect(msg).toContain("✅");
    expect(msg).toContain("recovered");
    expect(msg).toContain("2h 15m");
  });
});

describe("notifySlack", () => {
  it("does nothing (no fetch call) when SLACK_WEBHOOK_URL is not set", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await notifySlack("test message");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the message text to the configured webhook", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await notifySlack("test message");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/test",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.text).toBe("test message");
  });

  it("never throws when the webhook request fails", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    await expect(notifySlack("test message")).resolves.toBeUndefined();
  });

  it("never throws when the webhook responds with a non-2xx status", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 }) as Response));

    await expect(notifySlack("test message")).resolves.toBeUndefined();
  });
});
