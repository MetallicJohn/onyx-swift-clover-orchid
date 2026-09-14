"use strict";

/**
 * GenieACS extension: look up per-ISP ACS secrets from ISP Solutions.
 * Mounted read-only. Talks only to the private web API (ACS_EDGE_TOKEN).
 */
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const INTERNAL = String(process.env.ISPSOLUTIONS_INTERNAL_URL || process.env.GRIDLINE_INTERNAL_URL || "http://web:3000").replace(/\/+$/, "");
const TOKEN = String(process.env.ACS_EDGE_TOKEN || "");

function postAuth(kind, username) {
  return new Promise((resolve, reject) => {
    if (!TOKEN || !username) {
      resolve({ ok: false });
      return;
    }
    const body = JSON.stringify({ username, kind });
    let u;
    try {
      u = new URL(`${INTERNAL}/api/internal/acs-auth`);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 2500,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false });
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("acs-auth timeout"));
    });
    req.write(body);
    req.end();
  });
}

function asCallback(fn) {
  return function (args, callback) {
    Promise.resolve()
      .then(() => fn(args))
      .then((value) => callback(null, value))
      .catch((err) => callback(err));
  };
}

exports.passwordFor = asCallback(async (args) => {
  const username = String((args && args[0]) || "");
  const body = await postAuth("password", username);
  return body && body.ok && body.password ? String(body.password) : "";
});

exports.acsUrlFor = asCallback(async (args) => {
  const username = String((args && args[0]) || "");
  const body = await postAuth("profile", username);
  return body && body.ok && body.url ? String(body.url) : "";
});

exports.connreqUserFor = asCallback(async (args) => {
  const username = String((args && args[0]) || "");
  const body = await postAuth("profile", username);
  return body && body.ok && body.connreq_user ? String(body.connreq_user) : "";
});

exports.connreqPasswordFor = asCallback(async (args) => {
  const username = String((args && args[0]) || "");
  const body = await postAuth("profile", username);
  return body && body.ok && body.connreq_password ? String(body.connreq_password) : "";
});

exports.profileFor = asCallback(async (args) => {
  const username = String((args && args[0]) || "");
  const body = await postAuth("profile", username);
  if (!body || !body.ok) return "{}";
  return JSON.stringify({
    url: body.url || "",
    connreq_user: body.connreq_user || "",
    connreq_password: body.connreq_password || "",
  });
});
