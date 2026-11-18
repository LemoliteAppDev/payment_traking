/**
 * The encryption promise, tested against the real Web Crypto path.
 *
 * These are the claims the chat is sold on, so they are checked rather than
 * assumed: a recipient can read it, the stored form reveals nothing, and
 * nobody outside the conversation — the server included — can open it.
 */
import { describe, it, expect } from "vitest";
import {
  generateKeypair, sealMessage, openMessage, decryptMedia, toB64, fromB64,
  type Identity, type PeerDevice, type SealedMessage, type Envelope,
} from "../src/lib/e2ee";

async function device(id: string): Promise<Identity> {
  const { privateKey, publicKey } = await generateKeypair();
  return { deviceId: id, privateKey, publicKey };
}

const peer = (d: Identity): PeerDevice => ({ id: d.deviceId, publicKey: JSON.stringify(d.publicKey) });

const envelopeFor = (sealed: SealedMessage, id: string): Envelope =>
  sealed.envelopes.find((e) => e.deviceId === id)!;

describe("e2ee — a message reaches the people it was sealed for", () => {
  it("round-trips text to the recipient", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "OTP is 449120");
    const opened = await openMessage(priya, { senderDeviceId: amit.deviceId, ...sealed }, envelopeFor(sealed, priya.deviceId));

    expect(opened.text).toBe("OTP is 449120");
  });

  it("lets the sender read back their own message on the same device", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "paid it just now");
    const opened = await openMessage(amit, { senderDeviceId: amit.deviceId, ...sealed }, envelopeFor(sealed, amit.deviceId));

    expect(opened.text).toBe("paid it just now");
  });

  it("gives every enrolled device of a person its own envelope", async () => {
    const amit = await device("dev-amit");
    const phone = await device("dev-priya-phone");
    const laptop = await device("dev-priya-laptop");

    const sealed = await sealMessage(amit, [peer(amit), peer(phone), peer(laptop)], "both your devices");

    expect(sealed.envelopes.map((e) => e.deviceId).sort()).toEqual(
      ["dev-amit", "dev-priya-laptop", "dev-priya-phone"],
    );
    for (const d of [phone, laptop]) {
      const opened = await openMessage(d, { senderDeviceId: amit.deviceId, ...sealed }, envelopeFor(sealed, d.deviceId));
      expect(opened.text).toBe("both your devices");
    }
  });
});

describe("e2ee — what the server stores is unreadable", () => {
  it("never puts the plaintext in the stored fields", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");
    const secret = "account 50100412345678";

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], secret);

    // Everything the API receives, concatenated: the secret must not be in it.
    const onTheWire = JSON.stringify(sealed);
    expect(onTheWire).not.toContain(secret);
    expect(onTheWire).not.toContain("50100412345678");
    // And the body really is ciphertext, not an encoding of the text.
    expect(new TextDecoder().decode(fromB64(sealed.body))).not.toContain("account");
  });

  it("hides the file's name and type inside the encrypted metadata", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "", {
      blob: new Blob([bytes], { type: "image/png" }),
      name: "bank-statement-october.png",
      mime: "image/png",
    });

    expect(JSON.stringify(sealed.mediaMeta)).not.toContain("bank-statement");
    expect(sealed.mediaBlob!.type).toBe("application/octet-stream");

    const opened = await openMessage(priya, { senderDeviceId: amit.deviceId, ...sealed }, envelopeFor(sealed, priya.deviceId));
    expect(opened.media!.name).toBe("bank-statement-october.png");
    expect(opened.media!.mime).toBe("image/png");
  });

  it("round-trips the file's bytes through the stored ciphertext", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "", {
      blob: new Blob([bytes], { type: "audio/webm" }),
      name: "voice.webm",
      mime: "audio/webm",
      durationMs: 2400,
    });

    // What the server has on disk is not the file.
    const stored = new Uint8Array(await sealed.mediaBlob!.arrayBuffer());
    expect(Array.from(stored)).not.toEqual(Array.from(bytes));

    const opened = await openMessage(priya, { senderDeviceId: amit.deviceId, ...sealed }, envelopeFor(sealed, priya.deviceId));
    const back = await decryptMedia(opened.contentKey, opened.media!, stored.buffer as ArrayBuffer);
    expect(Array.from(new Uint8Array(await back.arrayBuffer()))).toEqual(Array.from(bytes));
  });
});

describe("e2ee — outsiders stay out", () => {
  it("refuses a device that was never given an envelope", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");
    const outsider = await device("dev-outsider");

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "private");
    expect(sealed.envelopes.some((e) => e.deviceId === outsider.deviceId)).toBe(false);
  });

  it("won't open someone else's envelope with the wrong key", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");
    const outsider = await device("dev-outsider");

    // The outsider steals Priya's envelope wholesale and tries it.
    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "private");
    const stolen = envelopeFor(sealed, priya.deviceId);

    await expect(
      openMessage(outsider, { senderDeviceId: amit.deviceId, ...sealed }, stolen),
    ).rejects.toThrow();
  });

  it("won't open an envelope relabelled for another device", async () => {
    // The derivation is bound to the sender→recipient device pair, so moving an
    // envelope onto a different device's row breaks it even for its real owner.
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "private");
    const relabelled = { ...envelopeFor(sealed, priya.deviceId), deviceId: "dev-someone-else" };

    await expect(
      openMessage(priya, { senderDeviceId: amit.deviceId, ...sealed }, relabelled),
    ).rejects.toThrow();
  });

  it("detects a tampered body", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");

    const sealed = await sealMessage(amit, [peer(amit), peer(priya)], "pay 45,000");
    // Flip a byte in the ciphertext — AES-GCM's tag should catch it.
    const bytes = fromB64(sealed.body);
    bytes[0] ^= 0xff;

    await expect(
      openMessage(
        priya,
        { senderDeviceId: amit.deviceId, body: toB64(bytes), iv: sealed.iv },
        envelopeFor(sealed, priya.deviceId),
      ),
    ).rejects.toThrow();
  });

  it("uses a fresh content key per message", async () => {
    const amit = await device("dev-amit");
    const priya = await device("dev-priya");

    const a = await sealMessage(amit, [peer(amit), peer(priya)], "same text");
    const b = await sealMessage(amit, [peer(amit), peer(priya)], "same text");

    // Identical plaintext, different ciphertext and different wrapped keys.
    expect(a.body).not.toBe(b.body);
    expect(a.iv).not.toBe(b.iv);
    expect(envelopeFor(a, priya.deviceId).wrappedKey).not.toBe(envelopeFor(b, priya.deviceId).wrappedKey);
  });
});

describe("e2ee — base64 helpers", () => {
  it("round-trips bytes, including a payload past the chunk boundary", async () => {
    const big = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    expect(Array.from(fromB64(toB64(big)))).toEqual(Array.from(big));
  });
});
