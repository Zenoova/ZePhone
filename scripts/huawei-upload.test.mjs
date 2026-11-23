import assert from "node:assert/strict";
import { constants, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseServiceAccount, signJwt, uploadApk } from "./huawei-upload.mjs";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const keyFile = { project_id: "", key_id: "KEY-ID-1", private_key: privateKey, sub_account: "SUB-ACCOUNT-9", token_uri: "https://oauth-login.cloud.huawei.com/oauth2/v3/token" };
const account = parseServiceAccount(JSON.stringify(keyFile));

/** Checks a Bearer JWT the way Huawei would: the claims of the reference and a valid RSA-PSS SHA-256 signature. */
function checkJwt(authorization) {
  assert.match(authorization ?? "", /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const [h, p, s] = authorization.slice(7).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { kid: "KEY-ID-1", typ: "JWT", alg: "PS256" });
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  assert.equal(claims.iss, "SUB-ACCOUNT-9");
  assert.equal(claims.aud, "https://oauth-login.cloud.huawei.com/oauth2/v3/token");
  assert.equal(claims.exp, claims.iat + 3600);
  assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 60, "iat is the current time");
  const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_AUTO }, Buffer.from(s, "base64url"));
  assert.ok(ok, "the signature verifies with the public key");
}

/** A stand-in for the Connect API and the file server, on a local port. */
async function fakeHuawei({ fileInfoRefusesObject = false, refuseEverything = false } = {}) {
  const calls = [];
  let uploaded = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const reply = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      calls.push(`${req.method} ${url.pathname}`);
      if (refuseEverything) return reply(401, { ret: { code: 403, msg: "client token authorization fail" } });
      if (req.method === "GET" && url.pathname === "/api/publish/v2/upload-url/for-obs") {
        checkJwt(req.headers.authorization);
        assert.equal(req.headers.client_id, undefined, "a Service Account sends no client_id");
        assert.equal(url.searchParams.get("appId"), "42");
        assert.equal(url.searchParams.get("fileName"), "app.apk");
        return reply(200, {
          ret: { code: 0, msg: "success" },
          urlInfo: { method: "PUT", url: `http://${req.headers.host}/obs/object-1`, objectId: "object-1", headers: { "x-signed": "yes", "Content-Type": "application/octet-stream" } },
        });
      }
      if (req.method === "PUT" && url.pathname === "/obs/object-1") {
        assert.equal(req.headers["x-signed"], "yes");
        assert.equal(req.headers.authorization, undefined, "the file server gets no Huawei JWT");
        uploaded = raw.length;
        return reply(200, {});
      }
      if (req.method === "PUT" && url.pathname === "/api/publish/v2/app-file-info") {
        checkJwt(req.headers.authorization);
        const b = JSON.parse(raw.toString());
        assert.equal(b.fileType, 5);
        assert.equal(url.searchParams.get("appId"), "42");
        const list = Array.isArray(b.files);
        if (!list && fileInfoRefusesObject) return reply(200, { ret: { code: 204144645, msg: "wrong files" } });
        assert.deepEqual(list ? b.files[0] : b.files, { fileName: "app.apk", fileDestUrl: "object-1" });
        return reply(200, { ret: { code: 0, msg: "success" }, pkgVersion: [] });
      }
      reply(404, {});
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { host: `http://127.0.0.1:${server.address().port}`, calls, uploaded: () => uploaded, close: () => server.close() };
}

async function apkFile(size = 5000) {
  const dir = await mkdtemp(path.join(tmpdir(), "huawei-"));
  const file = path.join(dir, "app.apk");
  await writeFile(file, Buffer.alloc(size, 7));
  return file;
}

const run = async (hosts) => {
  const lines = [];
  await uploadApk({ apk: await apkFile(), account, appId: "42", hosts, log: (l) => lines.push(l) });
  return lines;
};

test("signs the JWT of the reference and a verifier accepts it", () => {
  checkJwt(`Bearer ${signJwt(account)}`);
  const fixed = signJwt(account, 1_700_000_000).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(fixed[1], "base64url")), { aud: keyFile.token_uri, iss: "SUB-ACCOUNT-9", iat: 1_700_000_000, exp: 1_700_003_600 });
});

test("refuses a key file that is not JSON or lacks a field", () => {
  assert.throws(() => parseServiceAccount("not json"), /not JSON/);
  assert.throws(() => parseServiceAccount(JSON.stringify({ key_id: "k", private_key: "p" })), /no sub_account/);
});

test("sends the file and attaches it to the draft, in order, and prints no secret", async () => {
  const fake = await fakeHuawei();
  try {
    const lines = await run([fake.host]);
    assert.deepEqual(fake.calls, ["GET /api/publish/v2/upload-url/for-obs", "PUT /obs/object-1", "PUT /api/publish/v2/app-file-info"]);
    assert.equal(fake.uploaded(), 5000);
    const out = lines.join("\n");
    for (const secret of ["BEGIN PRIVATE KEY", privateKey.split("\n")[1], "Bearer", "x-signed"]) assert.ok(!out.includes(secret), `${secret} must not be printed`);
    assert.match(out, /nothing was submitted for review/);
  } finally {
    fake.close();
  }
});

test("falls back to the list form of `files` when the single object is refused", async () => {
  const fake = await fakeHuawei({ fileInfoRefusesObject: true });
  try {
    await run([fake.host]);
    assert.equal(fake.calls.filter((c) => c === "PUT /api/publish/v2/app-file-info").length, 2);
  } finally {
    fake.close();
  }
});

test("uses the next host when the first one refuses, and keeps it for the rest", async () => {
  const bad = await fakeHuawei({ refuseEverything: true });
  const good = await fakeHuawei();
  try {
    await run([bad.host, good.host]);
    assert.deepEqual(bad.calls, ["GET /api/publish/v2/upload-url/for-obs"]);
    assert.equal(good.calls.at(-1), "PUT /api/publish/v2/app-file-info");
  } finally {
    bad.close();
    good.close();
  }
});

test("stops with the code and message of every host when all refuse", async () => {
  const bad = await fakeHuawei({ refuseEverything: true });
  try {
    await assert.rejects(run([bad.host]), /upload URL failed on every host .*code 403: client token authorization fail/);
    assert.deepEqual(bad.calls, ["GET /api/publish/v2/upload-url/for-obs"]);
  } finally {
    bad.close();
  }
});
