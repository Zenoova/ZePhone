// Sends the APK of a release to Huawei AppGallery Connect, as a draft: it uploads the file and attaches it to the app's version,
// and never submits anything for review (do that in the console once the listing is complete).
//
//   node scripts/huawei-upload.mjs ZePhone_1.0.0_android.apk [--dry-run]
//
// Environment:
//   HUAWEI_SERVICE_ACCOUNT_JSON  the whole key file of a Service Account (Users and permissions → Connect API → Service Account,
//                                developer level), the `…private.json` that Huawei downloads when it is created
//   HUAWEI_APP_ID                the "App ID" shown on the app's page in AppGallery Connect
//   HUAWEI_API_HOST              optional: one Connect API host. Without it the Germany host is tried, then the global one
//                                (the reference gives connect-api-dre.cloud.huawei.com for Germany, connect-api-dra.cloud.huawei.com
//                                for Singapore, connect-api-drru.cloud.huawei.com for Russia, connect-api.cloud.huawei.com for China)
// --dry-run checks the file and prints the plan, with no network and no credentials.
//
// A Service Account has no token endpoint: the script signs a JWT with the key (PS256, valid for an hour) and sends it as the
// Bearer token. The calls then follow Huawei's Connect API reference (upload URL "for-obs", upload, app file information).
// The key, the JWT and the signed headers of the upload are never printed.
import { constants, createHash, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_HOSTS = ["https://connect-api-dre.cloud.huawei.com", "https://connect-api.cloud.huawei.com"];
const FILE_TYPE_APK = 5;
const b64url = (data) => Buffer.from(data).toString("base64url");

/** Reads the key file of a Service Account and keeps what the signature needs. */
export function parseServiceAccount(text) {
  let key;
  try {
    key = JSON.parse(text);
  } catch {
    throw new Error("HUAWEI_SERVICE_ACCOUNT_JSON is not JSON: it must hold the whole key file");
  }
  for (const field of ["key_id", "private_key", "sub_account"]) if (!key[field]) throw new Error(`the Service Account key has no ${field}`);
  return { keyId: key.key_id, privateKey: key.private_key, subAccount: key.sub_account, audience: key.token_uri || "https://oauth-login.cloud.huawei.com/oauth2/v3/token" };
}

/** The JWT of the reference: header {kid, typ: JWT, alg: PS256}, payload {aud, iss, iat, exp = iat + 3600}, signed with RSA-PSS and SHA-256. */
export function signJwt(account, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ kid: account.keyId, typ: "JWT", alg: "PS256" }));
  const payload = b64url(JSON.stringify({ aud: account.audience, iss: account.subAccount, iat: now, exp: now + 3600 }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: account.privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${header}.${payload}.${b64url(signature)}`;
}

/** A JSON call. Returns the status and the parsed body (an empty object when it is not JSON). */
async function json(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url, { method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON: kept as text for the error message
  }
  return { status: res.status, data, text };
}

/** Huawei answers HTTP 200 with a `ret` object; code 0 is success. Returns the reason of a failure, or null. */
function failure({ status, data, text }) {
  const code = data?.ret?.code;
  if (status >= 400 || (code !== undefined && code !== 0)) return `HTTP ${status}, ${code !== undefined ? `code ${code}: ${data.ret.msg ?? ""}` : text.slice(0, 300)}`;
  return null;
}

/** The upload itself: a raw PUT of the file, with the headers Huawei signed for it (they include Host and user-agent, which fetch may drop). */
function putFile(url, headers, buffer) {
  const target = new URL(url);
  const lib = target.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, { method: "PUT", headers: { ...headers, "Content-Length": buffer.length } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8").slice(0, 300) }));
    });
    req.on("error", reject);
    req.end(buffer);
  });
}

/**
 * Upload URL, upload, then the app file information (the file's object id is attached to the app's draft version).
 * The host that answers the upload URL call is used for the rest. The documented example shows `files` as one object while the
 * field table says a list: the object is tried first, then the list.
 */
export async function uploadApk({ apk, account, appId, hosts = DEFAULT_HOSTS, log = console.log, now }) {
  const buffer = await readFile(apk);
  const fileName = path.basename(apk);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  log(`${fileName}: ${buffer.length} bytes, sha256 ${sha256.slice(0, 12)}…`);
  const auth = () => ({ Authorization: `Bearer ${signJwt(account, now)}` });

  const query = new URLSearchParams({ appId, fileName, contentLength: String(buffer.length), sha256 });
  let host;
  let info;
  const refusals = [];
  for (const candidate of hosts) {
    const answer = await json("GET", `${candidate}/api/publish/v2/upload-url/for-obs?${query}`, { headers: auth() });
    const why = failure(answer) ?? (answer.data.urlInfo?.url && answer.data.urlInfo?.objectId ? null : `no urlInfo.url and urlInfo.objectId in the answer (fields: ${Object.keys(answer.data).join(", ")})`);
    if (!why) {
      host = candidate;
      info = answer.data.urlInfo;
      break;
    }
    refusals.push(`${new URL(candidate).host}: ${why}`);
    log(`upload URL refused by ${new URL(candidate).host} (${why})`);
  }
  if (!info) throw new Error(`upload URL failed on every host (${refusals.join("; ")})`);
  log(`upload URL obtained from ${new URL(host).host} (${new URL(info.url).host}, ${Object.keys(info.headers ?? {}).length} signed headers)`);

  const put = await putFile(info.url, info.headers ?? {}, buffer);
  if (put.status !== 200) throw new Error(`upload failed (HTTP ${put.status} ${put.text})`);
  log("file uploaded");

  const attach = (files) =>
    json("PUT", `${host}/api/publish/v2/app-file-info?${new URLSearchParams({ appId, releaseType: "1" })}`, {
      headers: auth(),
      body: { fileType: FILE_TYPE_APK, files },
    });
  const file = { fileName, fileDestUrl: info.objectId };
  let attached = await attach(file);
  if (attached.status < 400 && attached.data?.ret?.code !== 0) {
    log(`file information refused with the single-object form (code ${attached.data?.ret?.code}), trying the list form`);
    attached = await attach([file]);
  }
  const why = failure(attached);
  if (why) throw new Error(`app file information failed (${why})`);
  log("file attached to the draft version; nothing was submitted for review");
}

async function cli(argv, env) {
  const apk = argv.find((a) => !a.startsWith("--"));
  const dry = argv.includes("--dry-run");
  if (!apk) throw new Error("usage: node scripts/huawei-upload.mjs <file.apk> [--dry-run]");
  const hosts = env.HUAWEI_API_HOST ? [env.HUAWEI_API_HOST.replace(/\/+$/, "")] : DEFAULT_HOSTS;
  if (dry) {
    const buffer = await readFile(apk);
    console.log(`dry run: would send ${path.basename(apk)} (${buffer.length} bytes) to ${hosts.join(" then ")} for app ${env.HUAWEI_APP_ID || "(HUAWEI_APP_ID is not set)"}, as a draft`);
    return;
  }
  for (const name of ["HUAWEI_SERVICE_ACCOUNT_JSON", "HUAWEI_APP_ID"]) if (!env[name]) throw new Error(`${name} is not set`);
  await uploadApk({ apk, account: parseServiceAccount(env.HUAWEI_SERVICE_ACCOUNT_JSON), appId: env.HUAWEI_APP_ID, hosts });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli(process.argv.slice(2), process.env).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
