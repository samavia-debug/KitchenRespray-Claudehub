import { afterEach, describe, expect, it, vi } from "vitest";
import { formatIncidentOpenedMessage, formatIncidentResolvedMessage, notifySlack, notifyWhatsApp } from "./notify";

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

function stubTwilioEnv(overrides: Partial<{ sid: string; token: string; from: string; to: string }> = {}) {
  vi.stubEnv("TWILIO_ACCOUNT_SID", overrides.sid ?? "AC_test_sid");
  vi.stubEnv("TWILIO_AUTH_TOKEN", overrides.token ?? "test_token");
  vi.stubEnv("TWILIO_WHATSAPP_FROM", overrides.from ?? "whatsapp:+14155238886");
  vi.stubEnv("TWILIO_WHATSAPP_TO", overrides.to ?? "whatsapp:+353871234567");
}

describe("notifyWhatsApp", () => {
  it("does nothing when Twilio env vars are not fully configured", async () => {
    stubTwilioEnv({ token: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await notifyWhatsApp("test message");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when TWILIO_WHATSAPP_TO is empty", async () => {
    stubTwilioEnv({ to: "" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await notifyWhatsApp("test message");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the Twilio Messages API with Basic auth and the message body", async () => {
    stubTwilioEnv();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 201 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await notifyWhatsApp("Site is down");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    const body = new URLSearchParams(init.body as string);
    expect(body.get("Body")).toBe("Site is down");
    expect(body.get("From")).toBe("whatsapp:+14155238886");
    expect(body.get("To")).toBe("whatsapp:+353871234567");
  });

  it("sends to every number in a comma-separated TWILIO_WHATSAPP_TO list", async () => {
    stubTwilioEnv({ to: "whatsapp:+353871111111, whatsapp:+353872222222" });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 201 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await notifyWhatsApp("test message");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recipients = fetchMock.mock.calls.map((call) => new URLSearchParams((call[1] as RequestInit).body as string).get("To"));
    expect(recipients.sort()).toEqual(["whatsapp:+353871111111", "whatsapp:+353872222222"]);
  });

  it("never throws when the Twilio request fails", async () => {
    stubTwilioEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    await expect(notifyWhatsApp("test message")).resolves.toBeUndefined();
  });

  it("never throws when Twilio responds with a non-2xx status", async () => {
    stubTwilioEnv();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: "Invalid number" }) }) as Response)
    );

    await expect(notifyWhatsApp("test message")).resolves.toBeUndefined();
  });
});
