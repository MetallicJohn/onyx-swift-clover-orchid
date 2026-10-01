import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteSavedView, listSavedViews, normalizeSavedViewInput, saveSavedView } from "./saved-views.ts";
import { openTestDb } from "./test-db.ts";

test("saved view input keeps filters, sort, columns, and density", () => {
  const view = normalizeSavedViewInput({
    name: "  Nanyuki customers ",
    resource: "customers",
    filters: { town: "Nanyuki", status: "active" },
    sort: { key: "name", dir: "asc" },
    columns: ["phone", "phone", "package"],
    density: "dense",
    is_shared: true,
  });
  assert.equal(view.name, "Nanyuki customers");
  assert.deepEqual(view.columns, ["phone", "package"]);
  assert.equal(view.density, "dense");
  assert.equal(view.is_shared, true);
  assert.equal(normalizeSavedViewInput({ name: "A", resource: "tickets", density: "huge" }).density, "comfortable");
  assert.throws(() => normalizeSavedViewInput({ name: " ", resource: "tickets" }), /Name the view/);
  assert.throws(() => normalizeSavedViewInput({ name: "A", resource: "Tickets Desk" }), /Unknown view/);
});

test("saved views are tenant scoped, personal or shared, and not capped at 20", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_sv', 'Views', 'views'), ('ten_sv2', 'Other', 'views-other')`;
    await asRole("ten_sv");

    const personal = await saveSavedView(sql, "ten_sv", "usr_a", "support", {
      name: "My overdue",
      resource: "customers",
      filters: { status: "overdue" },
      sort: { key: "name", dir: "asc" },
      columns: ["phone", "package"],
      density: "compact",
    });
    assert.equal(personal.mine, true);
    assert.equal(personal.is_shared, false);
    assert.deepEqual(personal.columns, ["phone", "package"]);
    assert.equal(personal.density, "compact");

    const edited = await saveSavedView(sql, "ten_sv", "usr_a", "support", {
      id: personal.id,
      name: "My overdue",
      resource: "customers",
      filters: { status: "overdue", town: "Nanyuki" },
      columns: ["phone"],
      density: "dense",
    });
    assert.equal(edited.id, personal.id);
    assert.equal(edited.filters.town, "Nanyuki");
    assert.equal(edited.density, "dense");

    await saveSavedView(sql, "ten_sv", "usr_a", "isp_admin", {
      name: "Unassigned tickets",
      resource: "tickets",
      filters: { assignedTo: "unassigned" },
      is_shared: true,
    });

    for (let i = 0; i < 21; i += 1) {
      await saveSavedView(sql, "ten_sv", "usr_a", "support", {
        name: `Extra ${i}`,
        resource: "customers",
        filters: { n: i },
      });
    }

    const mine = await listSavedViews(sql, "ten_sv", "usr_a", "customers");
    assert.equal(mine.rows.length, 22);
    assert.ok(mine.rows.every((row) => row.user_id === "usr_a" || row.is_shared));

    const teammate = await listSavedViews(sql, "ten_sv", "usr_b", "customers");
    assert.equal(teammate.rows.some((row) => row.name === "My overdue"), false);

    const shared = await listSavedViews(sql, "ten_sv", "usr_b", "tickets");
    assert.equal(shared.rows.length, 1);
    assert.equal(shared.rows[0]?.name, "Unassigned tickets");
    assert.equal(shared.rows[0]?.mine, false);

    await assert.rejects(
      () => deleteSavedView(sql, "ten_sv", "usr_b", "support", shared.rows[0]!.id),
      /own view/,
    );
    await deleteSavedView(sql, "ten_sv", "usr_admin", "isp_admin", shared.rows[0]!.id);
    const after = await listSavedViews(sql, "ten_sv", "usr_b", "tickets");
    assert.equal(after.rows.length, 0);

    await asRole("ten_sv2");
    const other = await listSavedViews(sql, "ten_sv2", "usr_a", "customers");
    assert.equal(other.rows.length, 0);
  } finally {
    await close();
  }
});
