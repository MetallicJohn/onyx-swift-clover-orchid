import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateStkCallback, parseMpesaCallback } from "./callback-validate.ts";

const intent = { status: "pending", checkout_id: "ws_abc", amount_kes: 2500 };

test("success callback with matching amount confirms", () => {
  const d = evaluateStkCallback(intent, {
    checkout: "ws_abc",
    resultCode: 0,
    resultDesc: "Success",
    receipt: "QK7XYZ",
    amount: 2500,
  });
  assert.deepEqual(d, { action: "confirm", reference: "QK7XYZ" });
});

test("duplicate confirmed callback is idempotent", () => {
  const d = evaluateStkCallback({ ...intent, status: "confirmed" }, {
    checkout: "ws_abc",
    resultCode: 0,
    resultDesc: "Success",
    receipt: "QK7XYZ",
    amount: 2500,
  });
  assert.equal(d.action, "idempotent");
});

test("amount mismatch requires reconciliation", () => {
  const d = evaluateStkCallback(intent, {
    checkout: "ws_abc",
    resultCode: 0,
    resultDesc: "Success",
    receipt: "QK7XYZ",
    amount: 100,
  });
  assert.equal(d.action, "reconcile");
});

test("user cancel marks cancelled", () => {
  const d = evaluateStkCallback(intent, {
    checkout: "ws_abc",
    resultCode: 1032,
    resultDesc: "DS timeout user unable to finish input",
    receipt: "",
  });
  assert.equal(d.action, "fail");
  if (d.action === "fail") assert.equal(d.intentStatus, "cancelled");
});

test("other ResultCode marks failed", () => {
  const d = evaluateStkCallback(intent, {
    checkout: "ws_abc",
    resultCode: 1,
    resultDesc: "Insufficient funds",
    receipt: "",
  });
  assert.equal(d.action, "fail");
  if (d.action === "fail") assert.equal(d.intentStatus, "failed");
});

test("checkout mismatch is ignored", () => {
  const d = evaluateStkCallback(intent, {
    checkout: "other",
    resultCode: 0,
    resultDesc: "Success",
    receipt: "X",
    amount: 2500,
  });
  assert.equal(d.action, "ignore");
});

test("parses Daraja metadata amount and receipt", () => {
  const parsed = parseMpesaCallback({
    Body: {
      stkCallback: {
        CheckoutRequestID: "ws_abc",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 2500 },
            { Name: "MpesaReceiptNumber", Value: "QK7XYZ" },
            { Name: "PhoneNumber", Value: 254712000000 },
          ],
        },
      },
    },
  });
  assert.equal(parsed.amount, 2500);
  assert.equal(parsed.receipt, "QK7XYZ");
  assert.equal(parsed.checkout, "ws_abc");
});
