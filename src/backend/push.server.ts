// Server-only Web Push helper. Sends payload-encrypted push notifications
// to registered subscriptions using VAPID (RFC 8292) + aes128gcm (RFC 8291).
// Written with WebCrypto only so it runs on the Cloudflare Worker runtime.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const enc = new TextEncoder();

function b64uToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64u(b: ArrayBuffer | Uint8Array): string {
  const arr = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}

// Import raw uncompressed P-256 public key (65 bytes starting with 0x04)
async function importPubP256(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", raw as BufferSource, { name: "ECDH", namedCurve: "P-256" }, true, [],
  );
}

// Build a P-256 JWK from raw d + uncompressed public (0x04 || X || Y).
function p256Jwk(d: Uint8Array, pub: Uint8Array, usage: "sign" | "deriveBits") {
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  return {
    jwk: {
      kty: "EC",
      crv: "P-256",
      x: bytesToB64u(x),
      y: bytesToB64u(y),
      d: bytesToB64u(d),
      ext: true,
      key_ops: [usage] as KeyUsage[],
    } as JsonWebKey,
  };
}

async function importVapidSigningKey(): Promise<CryptoKey> {
  const priv = b64uToBytes(process.env.VAPID_PRIVATE_KEY!);
  const pub = b64uToBytes(process.env.VAPID_PUBLIC_KEY!);
  const { jwk } = p256Jwk(priv, pub, "sign");
  return crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
}

async function signVapidJwt(audience: string): Promise<string> {
  const header = { alg: "ES256", typ: "JWT" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 11,
    sub: process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  };
  const h = bytesToB64u(enc.encode(JSON.stringify(header)));
  const p = bytesToB64u(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(`${h}.${p}`);
  const key = await importVapidSigningKey();
  const sigDer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, signingInput as BufferSource,
  );
  return `${h}.${p}.${bytesToB64u(sigDer)}`;
}

async function encryptAes128Gcm(
  payload: Uint8Array,
  clientPub: Uint8Array,
  authSecret: Uint8Array,
): Promise<{ body: Uint8Array; serverPub: Uint8Array }> {
  // 1. Ephemeral server keypair
  const serverKp = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  ) as CryptoKeyPair;
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKp.publicKey));

  // 2. ECDH -> shared 32 bytes
  const clientPubKey = await importPubP256(clientPub);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPubKey }, serverKp.privateKey, 256,
  ));

  // 3. HKDF chain per RFC 8291
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prkKey = await hmac(authSecret, ecdh);
  const keyInfo = concat(enc.encode("WebPush: info\0"), clientPub, serverPubRaw, new Uint8Array([1]));
  const ikm = await hmac(prkKey, keyInfo);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, enc.encode("Content-Encoding: aes128gcm\0\x01"))).slice(0, 16);
  const nonce = (await hmac(prk, enc.encode("Content-Encoding: nonce\0\x01"))).slice(0, 12);

  // 4. Pad payload: append 0x02 delimiter (last record). No further padding.
  const plaintext = concat(payload, new Uint8Array([0x02]));

  // 5. Encrypt
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aesKey, plaintext as BufferSource));

  // 6. Header: salt(16) + rs(4) + idlen(1) + keyid(65)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = 65;
  header.set(serverPubRaw, 21);

  return { body: concat(header, ct), serverPub: serverPubRaw };
}

export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
  icon?: string;
}

async function sendOne(sub: {
  endpoint: string; p256dh: string; auth: string;
}, payload: PushPayload): Promise<{ ok: boolean; status: number }> {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await signVapidJwt(audience);
    const vapidPub = process.env.VAPID_PUBLIC_KEY!;

    const { body } = await encryptAes128Gcm(
      enc.encode(JSON.stringify(payload)),
      b64uToBytes(sub.p256dh),
      b64uToBytes(sub.auth),
    );

    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": "86400",
        "Urgency": "normal",
        "Authorization": `vapid t=${jwt}, k=${vapidPub}`,
      },
      body: body as BodyInit,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error("[push] send failed", err);
    return { ok: false, status: 0 };
  }
}

export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!userIds.length) return;
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.VAPID_PUBLIC_KEY) return;
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (!data?.length) return;

  const results = await Promise.all(data.map(async (row) => {
    const r = await sendOne({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }, payload);
    return { id: row.id, ...r };
  }));

  const dead = results.filter((r) => r.status === 404 || r.status === 410).map((r) => r.id);
  if (dead.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", dead);
  }
}