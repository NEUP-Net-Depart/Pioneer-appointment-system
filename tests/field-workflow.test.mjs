import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { config, wrangler } from "../scripts/cli.mjs";
import { hashPassword } from "../src/lib/passwords.js";
import { dateKey } from "../shared/time.js";
import { fieldSeed } from "./fixtures/field-seed.mjs";

let mf, db;
const tokens = {};
async function sql(text) {
  let buffer = "";
  const statements = [];
  for (const line of text.replace(/--[^\n]*/g, "").split("\n")) {
    buffer = `${buffer}\n${line}`.trim();
    if (
      buffer &&
      (buffer.startsWith("CREATE TRIGGER")
        ? line.trim() === "END;"
        : line.trim().endsWith(";"))
    ) {
      statements.push(buffer);
      buffer = "";
    }
  }
  assert.equal(buffer, "");
  // Fixtures can put more than one statement on a line; D1 exec accepts that.
  for (const statement of statements) {
    if (statement.startsWith("CREATE TRIGGER"))
      await db.prepare(statement).run();
    else
      for (const piece of statement
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(piece).run();
  }
}
async function request(path, account, body, method = body ? "POST" : "GET") {
  const response = await mf.dispatchFetch(`https://field.test${path}`, {
    method,
    headers: {
      ...(account ? { Authorization: `Bearer ${tokens[account]}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  const cfg = await config();
  wrangler([
    "pages",
    "functions",
    "build",
    "functions",
    "--outdir",
    ".wrangler/field-test-build",
    "--compatibility-date",
    cfg.compatibility_date,
    "--compatibility-flags",
    ...cfg.compatibility_flags,
  ]);
  mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "field-tests",
          compatibilityDate: cfg.compatibility_date,
          compatibilityFlags: cfg.compatibility_flags,
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: await readFile(
                  ".wrangler/field-test-build/index.js",
                  "utf8",
                ),
              },
            },
          },
          env: {
            DB: { type: "d1", id: "field-tests" },
            ATTACHMENTS: { type: "r2", name: "field-tests" },
            STAFF_WORKFLOW_ENABLED: { type: "text", value: "true" },
            JWT_SECRET: {
              type: "text",
              value: "field-test-secret-01234567890123456789",
            },
            PII_ENCRYPTION_KEY: {
              type: "text",
              value:
                "0123456789012345678901234567890101234567890123456789012345678901",
            },
          },
        },
      },
    ],
  });
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql(await readFile(`migrations/${file}`, "utf8"));
  await db
    .prepare(
      "INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','测试负责人','superadmin','南湖',1,?,'2026-01-01')",
    )
    .bind(hashPassword("StaffTest!2026"))
    .run();
  await db
    .prepare("INSERT INTO staff_campus_grants VALUES('root001','南湖')")
    .run();
  await sql(fieldSeed(dateKey()));
  for (const account of [
    "root001",
    "20261001",
    "20261002",
    "20261003",
    "20261004",
  ]) {
    const login = await request("/api/auth/login", null, {
      account,
      password: "StaffTest!2026",
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    tokens[account] = login.body.token;
  }
});
after(async () => mf?.dispose());

test("field day: reception, attendance, intake, transfer and completion share authoritative facts", async () => {
  const office = "20261001",
    tech = "20261002",
    next = "20261003",
    lead = "20261004";
  const home = await request("/api/field/home", tech);
  assert.equal(home.status, 200, JSON.stringify(home.body));
  assert.equal(home.body.state, "unsigned");
  assert.equal(
    (
      await request(
        "/api/presence/me",
        tech,
        { state: "available", revision: 0 },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal((await request("/api/field/board", tech)).status, 403);
  assert.equal(
    (await request("/api/field/board?campusId=campus-hunnan", office)).status,
    403,
  );
  const event = await request("/api/attendance/events", office, {
    campusId: "campus-nanhu",
    businessDate: dateKey(),
    requestId: "field-event-request",
  });
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const credential = await request(
    `/api/attendance/events/${event.body.id}/token`,
    office,
    { revision: event.body.revision },
  );
  assert.equal(credential.status, 200, JSON.stringify(credential.body));
  for (const account of [tech, next]) {
    const signed = await request("/api/attendance/check-ins", account, {
      token: credential.body.token,
      requestId: `field-check-${account}`,
    });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
  }
  const duplicate = await request("/api/attendance/check-ins", tech, {
    token: credential.body.token,
  });
  assert.equal(duplicate.body.isExisting, true);
  const board = await request("/api/field/board", office);
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.staffPresence.filter((p) => p.canReceive).length, 2);
  const signature = [
    Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
  ];
  const create = (number) =>
    request("/api/scan/onsite", office, {
      requestId: crypto.randomUUID(),
      registrationFlow: "frontdesk",
      campus: "南湖",
      name: "测试机主",
      studentId: `2030100${number}`,
      social: "test-contact",
      deviceType: "笔记本电脑",
      brand: "联想",
      deviceModel: `ThinkPad ${number}`,
      warranty: "否",
      faultType: "系统问题",
      signature,
    });
  const first = await create(1),
    second = await create(2);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(first.body.id, second.body.id);
  const id = first.body.id;
  const before = await request(`/api/field/appointments/${id}`, tech);
  assert.equal(before.body.social, undefined);
  assert.equal(before.body.canStart, true);
  assert.equal(
    (await request(`/api/field/appointments/${id}`, office)).body.social,
    "test-contact",
  );
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=";
  const photos = [];
  for (const side of ["front", "back"]) {
    const photo = await request(`/api/appointments/${id}/attachments`, tech, {
      filename: `${side}.png`,
      mimeType: "image/png",
      data: png,
      purpose: `intake_${side}`,
    });
    assert.equal(photo.status, 201, JSON.stringify(photo.body));
    photos.push(photo.body.id);
  }
  const claim = {
    status: "in_progress",
    revision: before.body.revision,
    frontPhotoId: photos[0],
    backPhotoId: photos[1],
    verification: {
      brand: "联想",
      model: "ThinkPad 实机",
      warranty: "expired",
      liquidMetal: "no",
      note: "外观已核验",
    },
    requestId: "field-start-request",
  };
  const started = await request(
    `/api/appointments/${id}/status`,
    tech,
    claim,
    "PATCH",
  );
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const replay = await request(
    `/api/appointments/${id}/status`,
    tech,
    claim,
    "PATCH",
  );
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM repair_intake_records WHERE appointment_id=?",
        )
        .bind(id)
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await request(
        "/api/presence/me",
        tech,
        { state: "away", revision: 0 },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/field/home", tech)).body.state,
    "repairing",
  );
  const active = await request(`/api/field/appointments/${id}`, lead);
  assert.equal(active.body.canTransfer, true);
  const transfer = {
    assignedTo: next,
    reason: "更换负责人员",
    revision: active.body.revision,
    requestId: "field-transfer-request",
  };
  assert.equal(
    (await request(`/api/appointments/${id}/transfer`, office, transfer))
      .status,
    403,
  );
  const moved = await request(
    `/api/appointments/${id}/transfer`,
    lead,
    transfer,
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(
    (await request("/api/field/home", tech)).body.currentRepair,
    null,
  );
  const current = (await request("/api/field/home", next)).body.currentRepair;
  assert.equal(current.id, id);
  assert.equal(current.intake.model, "ThinkPad 实机");
  const finish = {
    status: "completed",
    outcome: "repaired",
    repairNote: "重装驱动后测试正常",
    revision: current.revision,
    requestId: "field-finish-request",
  };
  assert.equal(
    (await request(`/api/appointments/${id}/status`, tech, finish, "PATCH"))
      .status,
    403,
  );
  const done = await request(
    `/api/appointments/${id}/status`,
    next,
    finish,
    "PATCH",
  );
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(
    (await request(`/api/appointments/${id}/status`, next, finish, "PATCH"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/field/home", next)).body.state,
    "available",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('repairs.started','repairs.transferred','repairs.completed') AND json_extract(source_ref,'$.id')=?",
        )
        .bind(id)
        .first()
    ).n,
    3,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_receipts WHERE json_extract(resource_ref,'$.id')=?",
        )
        .bind(id)
        .first()
    ).n,
    3,
  );
  // The original customer-provided model remains intact.
  assert.equal(
    (
      await db
        .prepare("SELECT device_model FROM appointments WHERE id=?")
        .bind(id)
        .first()
    ).device_model,
    "ThinkPad 1",
  );
});

test("failed audit rolls back intake and leaving races safely with taking a repair", async () => {
  const tech = "20261002";
  const { id } = await db
    .prepare(
      "SELECT id FROM appointments WHERE status='booked' ORDER BY id LIMIT 1",
    )
    .first();
  const photos = [];
  for (const side of ["front", "back"]) {
    const photo = await request(`/api/appointments/${id}/attachments`, tech, {
      filename: `${side}.png`,
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
      purpose: `intake_${side}`,
    });
    assert.equal(photo.status, 201);
    photos.push(photo.body.id);
  }
  const before = await request(`/api/field/appointments/${id}`, tech);
  const claim = {
    status: "in_progress",
    revision: before.body.revision,
    frontPhotoId: photos[0],
    backPhotoId: photos[1],
    verification: {
      brand: "联想",
      model: "现场验证",
      warranty: "expired",
      liquidMetal: "no",
      note: "",
    },
    requestId: "field-atomic-claim",
  };
  await db
    .prepare(
      "CREATE TRIGGER field_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='repairs.started' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;",
    )
    .run();
  assert.equal(
    (await request(`/api/appointments/${id}/status`, tech, claim, "PATCH"))
      .status,
    500,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM appointments WHERE id=?")
        .bind(id)
        .first()
    ).status,
    "booked",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM repair_intake_records WHERE appointment_id=?",
        )
        .bind(id)
        .first()
    ).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_receipts WHERE request_id=?",
        )
        .bind(claim.requestId)
        .first()
    ).n,
    0,
  );
  await db.prepare("DROP TRIGGER field_test_audit_failure").run();
  const home = (await request("/api/field/home", tech)).body;
  const [start, away] = await Promise.all([
    request(`/api/appointments/${id}/status`, tech, claim, "PATCH"),
    request(
      "/api/presence/me",
      tech,
      { state: "away", revision: home.presence.revision },
      "PATCH",
    ),
  ]);
  assert.equal(
    [start.status, away.status].filter((s) => s === 200).length,
    1,
    JSON.stringify({ start, away }),
  );
  const current = (await request("/api/field/home", tech)).body;
  assert.ok(current.state === "away" || current.state === "repairing");
  if (current.state === "repairing")
    assert.equal(current.presence.state, "available");
});

test("concurrent claims and transfers serialize; cross-day repairs survive and revoked sessions cannot read them", async () => {
  const office = "20261001",
    candidates = ["20261003", "20261004"];
  const home = (await request("/api/field/home", office)).body;
  const credential = await request(
    `/api/attendance/events/${home.event.id}/token`,
    office,
    { revision: home.event.revision },
  );
  for (const account of candidates)
    assert.equal(
      (
        await request("/api/attendance/check-ins", account, {
          token: credential.body.token,
          requestId: crypto.randomUUID(),
        })
      ).status,
      200,
    );
  const created = await request("/api/scan/onsite", office, {
    requestId: crypto.randomUUID(),
    registrationFlow: "frontdesk",
    campus: "南湖",
    name: "并发机主",
    studentId: "20301009",
    social: "private-concurrency-contact",
    deviceType: "笔记本电脑",
    brand: "联想",
    deviceModel: "并发验证设备",
    warranty: "否",
    faultType: "系统问题",
    signature: [
      Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const bodies = [];
  for (const account of candidates) {
    const photos = [];
    for (const side of ["front", "back"]) {
      const photo = await request(
        `/api/appointments/${id}/attachments`,
        account,
        {
          filename: `${side}.png`,
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
          purpose: `intake_${side}`,
        },
      );
      assert.equal(photo.status, 201, JSON.stringify(photo.body));
      photos.push(photo.body.id);
    }
    bodies.push({
      status: "in_progress",
      revision: created.body.revision,
      frontPhotoId: photos[0],
      backPhotoId: photos[1],
      verification: {
        brand: "联想",
        model: "并发验证设备",
        warranty: "expired",
        liquidMetal: "no",
        note: "",
      },
      requestId: crypto.randomUUID(),
    });
  }
  const claims = await Promise.all(
    candidates.map((account, i) =>
      request(`/api/appointments/${id}/status`, account, bodies[i], "PATCH"),
    ),
  );
  assert.equal(
    claims.filter((result) => result.status === 200).length,
    1,
    JSON.stringify(claims),
  );
  const winner = claims.findIndex((result) => result.status === 200),
    next = candidates[1 - winner];
  const transfer = {
    assignedTo: next,
    reason: "测试并发交接",
    revision: claims[winner].body.revision,
  };
  const transfers = await Promise.all(
    [1, 2].map(() =>
      request(`/api/appointments/${id}/transfer`, "20261004", {
        ...transfer,
        requestId: crypto.randomUUID(),
      }),
    ),
  );
  assert.equal(
    transfers.filter((result) => result.status === 200).length,
    1,
    JSON.stringify(transfers),
  );
  const previousDay = new Date(Date.now() - 86400000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Shanghai" },
  );
  await db
    .prepare("UPDATE appointments SET date=? WHERE id=?")
    .bind(previousDay, id)
    .run();
  const current = (await request("/api/field/home", next)).body.currentRepair;
  assert.equal(current.id, id);
  const officeList = await request("/api/appointments?status=all", office);
  assert.equal(officeList.status, 200);
  assert.equal(
    officeList.body.items.find((item) => item.id === id)?.social,
    undefined,
  );
  assert.equal(
    (await request(`/api/field/appointments/${id}`, office)).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/appointments/${id}/status`,
        next,
        {
          status: "completed",
          revision: current.revision,
          repairNote: "跨日维修完成",
          outcome: "repaired",
          requestId: crypto.randomUUID(),
        },
        "PATCH",
      )
    ).status,
    200,
  );
  await db
    .prepare(
      "UPDATE staff_accounts SET token_version=token_version+1 WHERE account=?",
    )
    .bind(next)
    .run();
  assert.equal(
    (await request(`/api/field/appointments/${id}`, next)).status,
    401,
  );
  await db
    .prepare("DELETE FROM member_roles WHERE member_id='member-20261001'")
    .run();
  await db
    .prepare(
      "UPDATE staff_accounts SET auth_version=auth_version+1 WHERE account='20261001'",
    )
    .run();
  assert.equal((await request("/api/field/board", office)).status, 403);
});
