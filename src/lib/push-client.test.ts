import { describe, expect, it } from "vitest";
import { detectPushSupport, urlBase64ToUint8Array } from "@/lib/push-client";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

const full = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

describe("detectPushSupport", () => {
  it("iPhone の Safari (ホーム画面に追加していない) は追加の案内", () => {
    expect(
      detectPushSupport({
        userAgent: IPHONE,
        standalone: false,
        hasServiceWorker: true,
        hasPushManager: false,
        hasNotification: false,
      }),
    ).toBe("ios-browser");
  });

  it("iPhone でもホーム画面から開けば使える", () => {
    expect(
      detectPushSupport({ userAgent: IPHONE, standalone: true, ...full }),
    ).toBe("supported");
  });

  it("ホーム画面から開いても古い iOS (PushManager 無し) は使えない", () => {
    expect(
      detectPushSupport({
        userAgent: IPHONE,
        standalone: true,
        hasServiceWorker: true,
        hasPushManager: false,
        hasNotification: false,
      }),
    ).toBe("unsupported");
  });

  it("Android の Chrome はブラウザのままで使える", () => {
    expect(
      detectPushSupport({ userAgent: ANDROID, standalone: false, ...full }),
    ).toBe("supported");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("base64url (パディング無し・-_) を復号する", () => {
    // 0xfb 0xff 0xfe → base64 "+//+" → base64url "-__-"
    expect([...urlBase64ToUint8Array("-__-")]).toEqual([0xfb, 0xff, 0xfe]);
    // 1 バイト (パディング 2 つ分を補う)
    expect([...urlBase64ToUint8Array("AQ")]).toEqual([1]);
  });
});
