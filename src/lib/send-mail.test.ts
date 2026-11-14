import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { sendDeveloperMail } = await import("./send-mail");

const mail = { subject: "件名", text: "本文", replyTo: "t@example.com" };

describe("sendDeveloperMail", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("キーか宛先が無ければ送らない", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("INQUIRY_TO_EMAIL", "dev@example.com");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendDeveloperMail(mail)).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("宛先・件名・本文・返信先を Resend に渡す", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("INQUIRY_TO_EMAIL", "dev@example.com");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendDeveloperMail(mail)).toEqual({ sent: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: ["dev@example.com"],
      subject: "件名",
      text: "本文",
      reply_to: "t@example.com",
    });
  });

  it("Resend がエラーを返したら failed (例外は投げない)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("INQUIRY_TO_EMAIL", "dev@example.com");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 422 })));
    expect(await sendDeveloperMail(mail)).toEqual({ sent: false, reason: "failed" });
  });

  it("通信に失敗しても failed (例外は投げない)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("INQUIRY_TO_EMAIL", "dev@example.com");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await sendDeveloperMail(mail)).toEqual({ sent: false, reason: "failed" });
  });
});
