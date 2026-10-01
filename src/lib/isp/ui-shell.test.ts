import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketListChips, normalizeTicketListQuery } from "./ticket-list-format.ts";
import { confirmButtonLabel, confirmCanDismiss, confirmLabels, crumbsForPath, parseSavedViews, phraseAccepted, pushToast, searchNeedle, upsertSavedView, type SavedView } from "./ui-shell.ts";

test("toasts dedupe and cap the stack", () => {
  const first = pushToast([], { kind: "success", title: "Settings saved" }, "a");
  const again = pushToast(first, { kind: "success", title: "Settings saved" }, "b");
  assert.equal(again.length, 1);
  assert.equal(again[0]?.id, "b");
  let stack = again;
  for (const id of ["c", "d", "e", "f"]) {
    stack = pushToast(stack, { kind: "error", title: id }, id);
  }
  assert.equal(stack.length, 4);
  assert.equal(stack[0]?.id, "c");
  assert.equal(stack.at(-1)?.id, "f");
});

test("confirm labels name the destructive action", () => {
  const danger = confirmLabels({ title: "Delete customer?", variant: "danger", confirmLabel: "Delete customer" });
  assert.equal(danger.confirmLabel, "Delete customer");
  assert.equal(danger.cancelLabel, "Cancel");
  assert.equal(danger.variant, "danger");
  const implied = confirmLabels({ title: "Delete router?" });
  assert.equal(implied.variant, "danger");
  assert.equal(implied.confirmLabel, "Confirm");
});

test("breadcrumbs follow app routes", () => {
  assert.deepEqual(crumbsForPath("/app"), [{ label: "Dashboard" }]);
  const crumbs = crumbsForPath("/app/settings/payments");
  assert.equal(crumbs[0]?.label, "Overview");
  assert.equal(crumbs[0]?.to, "/app");
  assert.equal(crumbs[1]?.label, "Settings");
  assert.equal(crumbs[1]?.to, "/app/settings");
  assert.equal(crumbs[2]?.label, "Payments");
  assert.equal(crumbs[2]?.to, undefined);
  assert.equal(crumbsForPath("/login").length, 0);
});

test("confirm stays open while an action runs and offers retry after failure", () => {
  assert.equal(confirmButtonLabel("Close", "idle"), "Close");
  assert.equal(confirmButtonLabel("Close", "loading", "Closing..."), "Closing...");
  assert.equal(confirmButtonLabel("Close", "loading"), "Working...");
  assert.equal(confirmButtonLabel("Close", "error"), "Try again");
  assert.equal(confirmCanDismiss("idle"), true);
  assert.equal(confirmCanDismiss("error"), true);
  assert.equal(confirmCanDismiss("loading"), false);
  assert.equal(phraseAccepted("RESET", " reset "), true);
  assert.equal(phraseAccepted("RESET", "NO"), false);
  assert.equal(phraseAccepted("", "anything"), true);
});

test("saved views keep filters, columns, density, and team scope", () => {
  assert.deepEqual(parseSavedViews("nope"), []);
  assert.deepEqual(
    parseSavedViews(
      JSON.stringify([
        {
          id: "1",
          name: "Overdue",
          filters: { status: "overdue" },
          scope: "team",
          columns: ["phone"],
          density: "compact",
          sort: { key: "name", dir: "asc" },
        },
      ]),
    ),
    [
      {
        id: "1",
        name: "Overdue",
        filters: { status: "overdue" },
        scope: "team",
        columns: ["phone"],
        density: "compact",
        sort: { key: "name", dir: "asc" },
      },
    ],
  );
  const many: SavedView[] = Array.from({ length: 25 }, (_, i) => ({
    id: String(i),
    name: `View ${i}`,
    filters: { n: i },
    scope: "personal",
  }));
  const stored = many.reduce<SavedView[]>((views, view) => upsertSavedView(views, view), []);
  assert.equal(stored.length, 25);
  const replaced = upsertSavedView(stored, { id: "new", name: "view 3", filters: { n: 99 }, scope: "personal" });
  assert.equal(replaced.length, 25);
  assert.equal(replaced.find((view) => view.name === "view 3")?.id, "new");
});

test("command search ignores short and wildcard input", () => {
  assert.equal(searchNeedle("a"), "");
  assert.equal(searchNeedle("  ka "), "ka");
  assert.equal(searchNeedle("100%_\\"), "100");
});

test("ticket chips omit the default open queue", () => {
  const open = normalizeTicketListQuery({});
  assert.deepEqual(ticketListChips(open), []);
  const chips = ticketListChips(
    normalizeTicketListQuery({ status: "waiting", priority: "high", category: "network", assignedTo: "unassigned", q: "fibre" }),
  );
  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Status: waiting", "Priority: high", "Category: network", "Assigned: Unassigned", "Search: fibre"],
  );
});
