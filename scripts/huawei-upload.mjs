// Sends the APK of a release to Huawei AppGallery Connect, as a draft: it uploads the file and attaches it to the app's version,
// and never submits anything for review (do that in the console once the listing is complete).
//
//   node scripts/huawei-upload.mjs ZePhone_1.0.0_android.apk [--dry-run]
//
// Environment: HUAWEI_CLIENT_ID and HUAWEI_CLIENT_SECRET (an API client of AppGallery Connect: Users and permissions →
// Connect API → API client), HUAWEI_APP_ID (the "App ID" of the app's page), and HUAWEI_API_HOST, the Connect API host of
// the project's data processing location (the default is Germany; China is connect-api.cloud.huawei.com, Singapore
// connect-api-dra.cloud.huawei.com, Russia connect-api-drru.cloud.huawei.com). --dry-run checks the file and prints the plan,
// with no network and no credentials.
//
// The calls follow Huawei's Connect API reference (token, upload URL "for-obs", upload, app file information). Tokens, secrets
// and the signed headers of the upload are never printed.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "https://connect-api-dre.cloud.huawei.com";
const FILE_TYPE_APK = 5;

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

/** Huawei answers HTTP 200 with a `ret` object; code 0 is success. */
function check(step, { status, data, text }) {
  const code = data?.ret?.code;
  if (status >= 400 || (code !== undefined && code !== 0)) {
    const detail = code !== undefined ? `code ${code}: ${data.ret.msg ?? ""}` : text.slice(0, 300);
    throw new Error(`${step} failed (HTTP ${status}, ${detail})`);
  }
  return data;
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
 * Token, upload URL, upload, then the app file information (the file's object id is attached to the app's draft version).
 * The documented example shows `files` as one object while the field table says a list: the object is tried first, then the list.
 */
export async function uploadApk({ apk, clientId, clientSecret, appId, host = DEFAULT_HOST, log = console.log }) {
  const buffer = await readFile(apk);
  const fileName = path.basename(apk);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  log(`${fileName}: ${buffer.length} bytes, sha256 ${sha256.slice(0, 12)}…`);

  // The reference gives the token URL with and without "/api": try the documented one, then the other.
  const credentials = { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret };
  let token = await json("POST", `${host}/api/oauth2/v1/token`, { body: credentials });
  if (token.status === 404) token = await json("POST", `${host}/oauth2/v1/token`, { body: credentials });
  const accessToken = check("token", token).access_token;
  if (!accessToken) throw new Error("token failed: no access_token in the answer");
  log("token obtained");

  const auth = { client_id: clientId, Authorization: `Bearer ${accessToken}` };
  const query = new URLSearchParams({ appId, fileName, contentLength: String(buffer.length), sha256 });
  const upload = check("upload URL", await json("GET", `${host}/api/publish/v2/upload-url/for-obs?${query}`, { headers: auth }));
  const info = upload.urlInfo;
  if (!info?.url || !info?.objectId) throw new Error(`upload URL failed: the answer has no urlInfo.url and urlInfo.objectId (fields: ${Object.keys(upload).join(", ")})`);
  log(`upload URL obtained (${new URL(info.url).host}, ${Object.keys(info.headers ?? {}).length} signed headers)`);

  const put = await putFile(info.url, info.headers ?? {}, buffer);
  if (put.status !== 200) throw new Error(`upload failed (HTTP ${put.status} ${put.text})`);
  log("file uploaded");

  const attach = (files) =>
    json("PUT", `${host}/api/publish/v2/app-file-info?${new URLSearchParams({ appId, releaseType: "1" })}`, {
      headers: auth,
      body: { fileType: FILE_TYPE_APK, files },
    });
  const file = { fileName, fileDestUrl: info.objectId };
  let attached = await attach(file);
  if (attached.status < 400 && attached.data?.ret?.code !== 0) {
    log(`file information refused with the single-object form (code ${attached.data?.ret?.code}), trying the list form`);
    attached = await attach([file]);
  }
  check("app file information", attached);
  log("file attached to the draft version; nothing was submitted for review");
}

async function cli(argv, env) {
  const apk = argv.find((a) => !a.startsWith("--"));
  const dry = argv.includes("--dry-run");
  if (!apk) throw new Error("usage: node scripts/huawei-upload.mjs <file.apk> [--dry-run]");
  const host = (env.HUAWEI_API_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  if (dry) {
    const buffer = await readFile(apk);
    console.log(`dry run: would send ${path.basename(apk)} (${buffer.length} bytes) to ${host} for app ${env.HUAWEI_APP_ID || "(HUAWEI_APP_ID is not set)"}, as a draft`);
    return;
  }
  for (const name of ["HUAWEI_CLIENT_ID", "HUAWEI_CLIENT_SECRET", "HUAWEI_APP_ID"]) if (!env[name]) throw new Error(`${name} is not set`);
  await uploadApk({ apk, clientId: env.HUAWEI_CLIENT_ID, clientSecret: env.HUAWEI_CLIENT_SECRET, appId: env.HUAWEI_APP_ID, host });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  cli(process.argv.slice(2), process.env).catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
