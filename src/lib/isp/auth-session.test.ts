import assert from "node:assert/strict";
import { test } from "node:test";
import { loginPageAction, sessionTokenFromAuthResponse } from "./auth-session.ts";

test("prefers the signed set-auth-token header over the body token", () => {
  const headers = new Headers({
    "set-auth-token": "rawToken.signedValue=",
  });
  assert.equal(
    sessionTokenFromAuthResponse({ data: { token: "rawToken" } }, headers),
    "rawToken.signedValue=",
  );
});

test("falls back to the JSON body token when the header is missing", () => {
  assert.equal(
    sessionTokenFromAuthResponse({ data: { token: "rawToken" } }, new Headers()),
    "rawToken",
  );
});

test("login stays on the form for a Grok gate session so ISP accounts can sign in", () => {
  assert.equal(
    loginPageAction({
      isPending: false,
      hasUser: true,
      hasOperatorBearer: false,
      hasGateSession: true,
    }),
    "form",
  );
});

test("login redirects once an ISP email session is remembered", () => {
  assert.equal(
    loginPageAction({
      isPending: false,
      hasUser: true,
      hasOperatorBearer: true,
      hasGateSession: true,
    }),
    "go_app",
  );
});

test("login redirects a normal cookie session that is not the gate", () => {
  assert.equal(
    loginPageAction({
      isPending: false,
      hasUser: true,
      hasOperatorBearer: false,
      hasGateSession: false,
    }),
    "go_app",
  );
});

test("signed-out visitors always see the form", () => {
  assert.equal(
    loginPageAction({
      isPending: false,
      hasUser: false,
      hasOperatorBearer: false,
      hasGateSession: false,
    }),
    "form",
  );
});
