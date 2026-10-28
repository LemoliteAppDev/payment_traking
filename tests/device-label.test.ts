// The device label is what the notification check shows instead of an opaque
// endpoint, so it has to tell one of someone's phones from the other.
import { describe, it, expect } from "vitest";
import { deviceLabel } from "@/lib/device-label";

describe("deviceLabel", () => {
  it("names the phone and the browser", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"))
      .toBe("Android · Chrome");
  });

  it("recognises an iPhone", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"))
      .toBe("iPhone · Safari");
  });

  it("does not call Edge or Samsung Internet 'Chrome', though their UA claims it", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0"))
      .toBe("Windows · Edge");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36"))
      .toBe("Android · Samsung Internet");
  });

  it("does not call Chrome 'Safari', though its UA claims it", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0 Safari/537.36"))
      .toBe("Mac · Chrome");
  });

  it("handles Firefox on desktop and iOS", () => {
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Linux · Firefox");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) FxiOS/127.0 Mobile/15E148 Safari/605.1.15")).toBe("iPhone · Firefox");
  });

  it("returns null rather than a junk label when the UA says nothing", () => {
    expect(deviceLabel("")).toBeNull();
    expect(deviceLabel(null)).toBeNull();
    expect(deviceLabel(undefined)).toBeNull();
    expect(deviceLabel("curl/8.4.0")).toBeNull();
  });

  it("stays short enough for the column it's stored in", () => {
    expect((deviceLabel("Mozilla/5.0 (Android) Chrome/1") ?? "").length).toBeLessThanOrEqual(120);
  });
});
