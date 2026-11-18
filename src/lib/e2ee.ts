/**
 * End-to-end encryption for PayTrack chat — the browser half.
 *
 * The rule this file exists to keep: the server, the database and anyone with
 * a copy of either can never read a chat message, a file name, a file's bytes
 * or a voice note. Only the devices in the conversation can.
 *
 * How:
 *  · Identity — each browser generates an ECDH P-256 keypair once. The private
 *    key is a NON-EXTRACTABLE CryptoKey parked in IndexedDB: the browser will
 *    use it to derive bits but will not hand the bytes back, not even to this
 *    code. Only the public half is uploaded (`ChatDevice.publicKey`).
 *  · Per message — a fresh AES-256-GCM content key encrypts the body, and the
 *    file bytes and file name when there's an attachment.
 *  · Delivery — the content key is wrapped once per recipient device with
 *    ephemeral-static ECDH + HKDF-SHA256. The server stores those envelopes
 *    and can unwrap none of them.
 *
 * The cost, accepted deliberately: a device that was not enrolled when a
 * message was sent has no envelope for it, so old messages do not appear on a
 * newly-added device. Keys never leave a device, so there is nothing to sync.
 *
 * Note on the IV: the per-envelope `iv` doubles as the HKDF salt. Safe here
 * because the ephemeral ECDH key is fresh per message, so each wrapping key is
 * used for exactly one encryption — IV reuse under one key cannot happen.
 */

const DB_NAME = "paytrack-e2ee";
const DB_STORE = "keys";
const INFO_PREFIX = "paytrack-chat-v1";

export interface DeviceIdentity {
  deviceId: string;
  publicKey: JsonWebKey;
}

/** A device's own keys. The private half is always non-extractable. */
export interface Identity {
  deviceId: string;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
}

interface StoredIdentity extends Identity {
  recordId: string;
}

/** A content key wrapped for one recipient device. */
export interface Envelope {
  deviceId: string;
  wrappedKey: string;
  iv: string;
  ephemeral: string;
}

/** What `encryptMessage` hands the API. All strings are base64 / JSON. */
export interface SealedMessage {
  body: string;
  iv: string;
  envelopes: Envelope[];
  /** Encrypted file bytes, ready to upload as an opaque blob. */
  mediaBlob?: Blob;
  /** Encrypted {name, mime, size, fileIv} — the file name is a secret too. */
  mediaMeta?: string;
  mediaIv?: string;
}

/** A recipient device, as listed by `GET /api/v1/chat/devices`. */
export interface PeerDevice {
  id: string;
  publicKey: string;
}

export interface MediaInfo {
  name: string;
  mime: string;
  size: number;
  fileIv: string;
}

export class CryptoUnavailableError extends Error {
  constructor() {
    super("This browser can't encrypt messages. Open PayTrack over HTTPS in a modern browser.");
    this.name = "CryptoUnavailableError";
  }
}

/* ── base64 ─────────────────────────────────────────────────────────── */
export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  // Chunked so a multi-MB voice note doesn't blow the argument limit.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new CryptoUnavailableError();
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ── IndexedDB (the private key's home) ─────────────────────────────── */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function dbGet(key: string): Promise<StoredIdentity | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result as StoredIdentity | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function dbPut(key: string, value: StoredIdentity): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function dbDelete(key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* ── identity ───────────────────────────────────────────────────────── */
// Scoped per user: two people signing in on the same browser get their own
// device identity, so neither can unwrap the other's envelopes.
const recordKey = (userId: string) => `self:${userId}`;

let cached: StoredIdentity | null = null;

/** A fresh ECDH P-256 keypair, private half non-extractable. */
export async function generateKeypair(): Promise<{ privateKey: CryptoKey; publicKey: JsonWebKey }> {
  const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  // extractable:false above applies to the private key; the public half is
  // always exportable, which is the only half we publish.
  const publicKey = await subtle().exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey };
}

/**
 * This device's identity, creating and registering it on first use.
 * `register` uploads the public key and returns the server-side device id.
 */
export async function ensureDevice(
  userId: string,
  register: (publicKey: JsonWebKey, knownDeviceId: string | null) => Promise<string>,
): Promise<DeviceIdentity> {
  if (cached && cached.recordId === recordKey(userId)) {
    // Keep the server's lastSeenAt fresh, but never block sending on it.
    void register(cached.publicKey, cached.deviceId).catch(() => {});
    return { deviceId: cached.deviceId, publicKey: cached.publicKey };
  }

  const key = recordKey(userId);
  const existing = await dbGet(key).catch(() => undefined);
  if (existing?.privateKey && existing.deviceId) {
    // The server may have been reset or the row deactivated; re-registering
    // with the same public key either confirms it or mints a fresh row.
    const deviceId = await register(existing.publicKey, existing.deviceId);
    const rec: StoredIdentity = { ...existing, deviceId, recordId: key };
    if (deviceId !== existing.deviceId) await dbPut(key, rec);
    cached = rec;
    return { deviceId, publicKey: rec.publicKey };
  }

  const fresh = await generateKeypair();
  const deviceId = await register(fresh.publicKey, null);
  const rec: StoredIdentity = { recordId: key, deviceId, ...fresh };
  await dbPut(key, rec);
  cached = rec;
  return { deviceId, publicKey: rec.publicKey };
}

/** Forget this device's key — used on sign-out so the next user starts clean. */
export async function forgetDevice(userId: string): Promise<void> {
  cached = null;
  await dbDelete(recordKey(userId)).catch(() => {});
}

/* ── key agreement ──────────────────────────────────────────────────── */
async function importPeerPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

/**
 * The AES-GCM key that wraps a content key for one device.
 * `info` binds the derivation to the exact sender→recipient device pair, so an
 * envelope copied onto another device's row simply fails to open.
 */
async function wrappingKey(
  privateKey: CryptoKey,
  peerPublic: CryptoKey,
  salt: Uint8Array,
  senderDeviceId: string,
  recipientDeviceId: string,
): Promise<CryptoKey> {
  const shared = await subtle().deriveBits({ name: "ECDH", public: peerPublic }, privateKey, 256);
  const hkdfKey = await subtle().importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as unknown as BufferSource,
      info: enc.encode(`${INFO_PREFIX}:${senderDeviceId}->${recipientDeviceId}`),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ── sending ────────────────────────────────────────────────────────── */
async function newContentKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function aesEncrypt(key: CryptoKey, data: BufferSource): Promise<{ data: Uint8Array; iv: Uint8Array }> {
  const iv = randomBytes(12);
  const out = await subtle().encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data);
  return { data: new Uint8Array(out), iv };
}

async function aesDecrypt(key: CryptoKey, iv: Uint8Array, data: BufferSource): Promise<Uint8Array> {
  const out = await subtle().decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, data);
  return new Uint8Array(out);
}

/** Wrap one content key for every recipient device. */
async function sealEnvelopes(
  contentKey: CryptoKey,
  devices: PeerDevice[],
  self: Identity,
): Promise<Envelope[]> {
  const raw = await subtle().exportKey("raw", contentKey);
  // One ephemeral keypair per message: each recipient gets a different shared
  // secret from it, and the private half is discarded when this returns.
  const eph = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const ephPub = JSON.stringify(await subtle().exportKey("jwk", eph.publicKey));

  const envelopes: Envelope[] = [];
  for (const d of devices) {
    try {
      const peer = await importPeerPublic(JSON.parse(d.publicKey) as JsonWebKey);
      const iv = randomBytes(12);
      const wk = await wrappingKey(eph.privateKey, peer, iv, self.deviceId, d.id);
      const wrapped = await subtle().encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, wk, raw);
      envelopes.push({
        deviceId: d.id,
        wrappedKey: toB64(wrapped),
        iv: toB64(iv),
        ephemeral: ephPub,
      });
    } catch {
      // A single unreadable public key must not stop the message reaching
      // everyone else's devices.
    }
  }
  return envelopes;
}

function requireIdentity(userId: string): StoredIdentity {
  if (!cached || cached.recordId !== recordKey(userId)) {
    throw new Error("This device isn't set up for encrypted chat yet. Reload the page.");
  }
  return cached;
}

/**
 * Encrypt a message for every device in `devices` (which must include the
 * sender's own, or they could not read back their own history).
 */
export async function sealMessage(
  self: Identity,
  devices: PeerDevice[],
  text: string,
  file?: { blob: Blob; name: string; mime: string; durationMs?: number },
): Promise<SealedMessage> {
  const contentKey = await newContentKey();

  const bodyEnc = await aesEncrypt(contentKey, enc.encode(text));
  const sealed: SealedMessage = {
    body: toB64(bodyEnc.data),
    iv: toB64(bodyEnc.iv),
    envelopes: await sealEnvelopes(contentKey, devices, self),
  };

  if (file) {
    const bytes = new Uint8Array(await file.blob.arrayBuffer());
    const fileEnc = await aesEncrypt(contentKey, bytes as unknown as BufferSource);
    // The file's own IV rides inside the encrypted metadata, so the server
    // can't even tell two uploads apart by their IVs.
    const info: MediaInfo = {
      name: file.name,
      mime: file.mime,
      size: bytes.byteLength,
      fileIv: toB64(fileEnc.iv),
    };
    const metaEnc = await aesEncrypt(contentKey, enc.encode(JSON.stringify(info)));
    sealed.mediaBlob = new Blob([fileEnc.data as unknown as BlobPart], { type: "application/octet-stream" });
    sealed.mediaMeta = toB64(metaEnc.data);
    sealed.mediaIv = toB64(metaEnc.iv);
  }

  return sealed;
}

/** As `sealMessage`, using the identity enrolled for `userId` on this device. */
export async function encryptMessage(
  userId: string,
  devices: PeerDevice[],
  text: string,
  file?: { blob: Blob; name: string; mime: string; durationMs?: number },
): Promise<SealedMessage> {
  return sealMessage(requireIdentity(userId), devices, text, file);
}

/* ── receiving ──────────────────────────────────────────────────────── */
/** Unwrap the content key from the envelope addressed to this device. */
async function openEnvelope(
  self: Identity,
  senderDeviceId: string,
  envelope: Envelope,
): Promise<CryptoKey> {
  const ephPub = await importPeerPublic(JSON.parse(envelope.ephemeral) as JsonWebKey);
  const iv = fromB64(envelope.iv);
  const wk = await wrappingKey(self.privateKey, ephPub, iv, senderDeviceId, envelope.deviceId);
  const raw = await aesDecrypt(wk, iv, fromB64(envelope.wrappedKey) as unknown as BufferSource);
  return subtle().importKey("raw", raw as unknown as BufferSource, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export interface OpenedMessage {
  text: string;
  media?: MediaInfo;
  /** Kept so the attachment's bytes can be decrypted on demand. */
  contentKey: CryptoKey;
}

export interface SealedBody {
  senderDeviceId: string;
  body: string;
  iv: string;
  mediaMeta?: string | null;
  mediaIv?: string | null;
}

/** Decrypt a message's body (and its media metadata) with `self`'s envelope. */
export async function openMessage(
  self: Identity,
  msg: SealedBody,
  envelope: Envelope,
): Promise<OpenedMessage> {
  const contentKey = await openEnvelope(self, msg.senderDeviceId, envelope);
  const text = msg.body
    ? dec.decode(await aesDecrypt(contentKey, fromB64(msg.iv), fromB64(msg.body) as unknown as BufferSource))
    : "";

  let media: MediaInfo | undefined;
  if (msg.mediaMeta && msg.mediaIv) {
    const plain = await aesDecrypt(
      contentKey,
      fromB64(msg.mediaIv),
      fromB64(msg.mediaMeta) as unknown as BufferSource,
    );
    media = JSON.parse(dec.decode(plain)) as MediaInfo;
  }

  return { text, media, contentKey };
}

/** As `openMessage`, using the identity enrolled for `userId` on this device. */
export async function decryptMessage(
  userId: string,
  msg: SealedBody,
  envelope: Envelope,
): Promise<OpenedMessage> {
  return openMessage(requireIdentity(userId), msg, envelope);
}

/** Decrypt downloaded attachment bytes into a usable Blob. */
export async function decryptMedia(
  contentKey: CryptoKey,
  media: MediaInfo,
  ciphertext: ArrayBuffer,
): Promise<Blob> {
  const plain = await aesDecrypt(contentKey, fromB64(media.fileIv), ciphertext);
  return new Blob([plain as unknown as BlobPart], { type: media.mime || "application/octet-stream" });
}
