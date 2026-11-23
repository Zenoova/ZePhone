import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { uploadApk } from "./huawei-upload.mjs";

/** A stand-in for the Connect API and the file server, on a local port. `fileInfoRefusesObject` makes it refuse the single-object form. */
async function fakeHuawei({ fileInfoRefusesObject = false, tokenAt = "/api/oauth2/v1/token" } = {}) {
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
      if (req.method === "POST" && url.pathname === tokenAt) {
        const b = JSON.parse(raw.toString());
        return b.grant_type === "client_credentials" && b.client_id === "id" && b.client_secret === "s3cr3t-7c1d"
          ? reply(200, { access_token: "T0KEN-9f3a", expires_in: 172800 })
          : reply(200, { ret: { code: 1, msg: "bad credentials" } });
      }
      if (req.method === "POST") return reply(404, {});
      if (req.method === "GET" && url.pathname === "/api/publish/v2/upload-url/for-obs") {
        assert.equal(req.headers.authorization, "Bearer T0KEN-9f3a");
        assert.equal(req.headers.client_id, "id");
        assert.equal(url.searchParams.get("appId"), "42");
        assert.equal(url.searchParams.get("fileName"), "app.apk");
        return reply(200, {
          ret: { code: 0, msg: "success" },
          urlInfo: { method: "PUT", url: `http://${req.headers.host}/obs/object-1`, objectId: "object-1", headers: { "x-signed": "yes", "Content-Type": "application/octet-stream" } },
        });
      }
      if (req.method === "PUT" && url.pathname === "/obs/object-1") {
        assert.equal(req.headers["x-signed"], "yes");
        uploaded = raw.length;
        return reply(200, {});
      }
      if (req.method === "PUT" && url.pathname === "/api/publish/v2/app-file-info") {
        const b = JSON.parse(raw.toString());
        assert.equal(b.fileType, 5);
        assert.equal(url.searchParams.get("appId"), "42");
        const list = Array.isArray(b.files);
        if (!list && fileInfoRefusesObject) return reply(200, { ret: { code: 204144645, msg: "wrong files" } });
        const f = list ? b.files[0] : b.files;
        assert.deepEqual(f, { fileName: "app.apk", fileDestUrl: "object-1" });
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

const run = (fake, over = {}) => {
  const lines = [];
  return apkFile().then((apk) => uploadApk({ apk, clientId: "id", clientSecret: "s3cr3t-7c1d", appId: "42", host: fake.host, log: (l) => lines.push(l), ...over }).then(() => lines));
};

test("sends the file and attaches it to the draft, in order, and prints no secret", async () => {
  const fake = await fakeHuawei();
  try {
    const lines = await run(fake);
    assert.deepEqual(fake.calls, ["POST /api/oauth2/v1/token", "GET /api/publish/v2/upload-url/for-obs", "PUT /obs/object-1", "PUT /api/publish/v2/app-file-info"]);
    assert.equal(fake.uploaded(), 5000);
    const out = lines.join("\n");
    for (const secret of ["T0KEN-9f3a", "s3cr3t-7c1d", "x-signed"]) assert.ok(!out.includes(secret), `${secret} must not be printed`);
    assert.match(out, /nothing was submitted for review/);
  } finally {
    fake.close();
  }
});

test("falls back to the list form of `files` when the single object is refused", async () => {
  const fake = await fakeHuawei({ fileInfoRefusesObject: true });
  try {
    await run(fake);
    assert.equal(fake.calls.filter((c) => c === "PUT /api/publish/v2/app-file-info").length, 2);
  } finally {
    fake.close();
  }
});

test("tries the token URL without /api when the first answers 404", async () => {
  const fake = await fakeHuawei({ tokenAt: "/oauth2/v1/token" });
  try {
    await run(fake);
    assert.deepEqual(fake.calls.slice(0, 2), ["POST /api/oauth2/v1/token", "POST /oauth2/v1/token"]);
  } finally {
    fake.close();
  }
});

test("stops with the code and message when the credentials are refused", async () => {
  const fake = await fakeHuawei();
  try {
    await assert.rejects(run(fake, { clientSecret: "wrong" }), /token failed .*code 1: bad credentials/);
    assert.deepEqual(fake.calls, ["POST /api/oauth2/v1/token"]);
  } finally {
    fake.close();
  }
});
