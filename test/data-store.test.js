const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";

const dataStore = require("../src/data-store");

function makeMockStores({ failWrites = false, failStore = "", failKeyPattern = null } = {}) {
  const maps = new Map();
  function mapFor(name) {
    if (!maps.has(name)) maps.set(name, new Map());
    return maps.get(name);
  }
  dataStore.setStoreFactory((name) => {
    const map = mapFor(name);
    return {
      async get(key) {
        return map.has(key) ? map.get(key) : null;
      },
      async set(key, value, options = {}) {
        if (failStore === name && (!failKeyPattern || failKeyPattern.test(key))) {
          const error = new Error("safe simulated write failure");
          error.code = "SIMULATED_STORAGE_ERROR";
          throw error;
        }
        if (failWrites) throw new Error("mock storage unavailable");
        if (options.onlyIfNew && map.has(key)) {
          const error = new Error("already exists");
          error.code = "BLOB_ALREADY_EXISTS";
          throw error;
        }
        map.set(key, value);
      },
      async setJSON(key, value, options = {}) {
        await this.set(key, JSON.stringify(value), options);
      },
      async list(options = {}) {
        const prefix = options.prefix || "";
        return { blobs: Array.from(map.keys()).filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key })) };
      }
    };
  });
  return { maps, mapFor };
}

function baseRecord(overrides = {}) {
  return {
    orderId: "gid://shopify/Order/1",
    orderName: "#1023",
    customerPhoneRedacted: "+15*******67",
    customerFirstName: "Sarah",
    unavailableLineItemId: "gid://shopify/LineItem/1",
    unavailableTitle: "Unavailable Item",
    substituteVariantId: "gid://shopify/ProductVariant/2",
    substituteTitle: "Substitute Item",
    message: "Welkom USA: Hi Sarah, Unavailable Item in order #1023 is unavailable. We can substitute it with Substitute Item. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    staffIdentity: "Test Staff",
    initialTwilioStatus: "created",
    latestTwilioStatus: "created",
    idempotencyKey: `idem-${Math.random()}`,
    ...overrides
  };
}

test.afterEach(() => {
  dataStore.resetStoreFactory();
  dataStore.clearMemoryHistory();
});

test("Blob adapter creates expected site-wide stores on first writes", async () => {
  const { maps } = makeMockStores();
  const init = await dataStore.initializeDataStores();
  assert.equal(init.ok, true);
  assert.deepEqual(Object.keys(init.stores).sort(), Object.values(dataStore.STORE_NAMES).sort());
  assert.equal(init.stores["welkom-sms-history"], "initialized");
  assert.equal(init.stores["welkom-sms-templates"], "initialized");
  assert.equal(init.stores["welkom-sms-settings"], "initialized");
  assert.equal(init.stores["welkom-sms-audit"], "initialized");
  assert.equal(maps.has("welkom-sms-history"), true);
  assert.equal(maps.has("welkom-sms-templates"), true);
  assert.equal(maps.has("welkom-sms-settings"), true);
  assert.equal(maps.has("welkom-sms-audit"), true);
});

test("Blob initialization is idempotent and does not overwrite safe records", async () => {
  const { mapFor } = makeMockStores();
  const templates = mapFor("welkom-sms-templates");
  templates.set("templates/default-substitution", JSON.stringify({
    ...dataStore.defaultTemplate(),
    name: "Existing default"
  }));

  const first = await dataStore.initializeDataStores();
  const second = await dataStore.initializeDataStores();
  const template = JSON.parse(templates.get("templates/default-substitution"));
  assert.equal(first.stores["welkom-sms-templates"], "already-initialized");
  assert.equal(second.stores["welkom-sms-templates"], "already-initialized");
  assert.equal(template.name, "Existing default");

  const settings = JSON.parse(mapFor("welkom-sms-settings").get("settings/blob_initialization"));
  assert.deepEqual(Object.keys(settings).sort(), [
    "defaultTemplateId",
    "dryRun",
    "duplicateWindowMinutes",
    "initializedAt",
    "schemaVersion",
    "smsConsentRequired"
  ].sort());
  assert.doesNotMatch(JSON.stringify(settings), /token|secret|password|authorization|cookie|process\.env/i);
});

test("Blob initialization failures include safe stage and store diagnostics", async () => {
  makeMockStores({ failStore: "welkom-sms-settings", failKeyPattern: /^settings\// });
  await assert.rejects(
    () => dataStore.initializeDataStores(),
    (error) => {
      assert.equal(error.name, "StoreInitializationError");
      assert.equal(error.stage, "settings-first-write");
      assert.equal(error.storeName, "welkom-sms-settings");
      assert.equal(error.recordType, "settings");
      assert.equal(error.code, "SIMULATED_STORAGE_ERROR");
      assert.doesNotMatch(JSON.stringify(error), /secret|password|authorization|cookie/i);
      return true;
    }
  );
});

test("message history supports first write, strong read, update, pagination and empty stores", async () => {
  makeMockStores();
  assert.deepEqual(await dataStore.listMessageRecords(process.env, 10), []);

  for (let index = 0; index < 3; index += 1) {
    const created = await dataStore.createMessageRecord(baseRecord({
      orderName: `#102${index}`,
      substituteVariantId: `gid://shopify/ProductVariant/${index}`,
      idempotencyKey: `page-${index}`,
      createdAt: `2026-07-21T00:00:0${index}.000Z`
    }));
    assert.equal(created.ok, true);
  }

  const page1 = await dataStore.queryMessageRecords(process.env, { page: 1, limit: 2 });
  assert.equal(page1.records.length, 2);
  assert.equal(page1.total, 3);
  assert.equal(page1.totalPages, 2);

  const record = page1.records[0];
  const fetched = await dataStore.getMessageRecord(record.id);
  assert.equal(fetched.id, record.id);
  const updated = await dataStore.updateMessageStatus(record.id, "delivered");
  assert.equal(updated.latestTwilioStatus, "delivered");
});

test("templates support create, update, archive and malformed data is ignored", async () => {
  const { mapFor } = makeMockStores();
  mapFor("welkom-sms-templates").set("templates/bad", "{not-json");

  const empty = await dataStore.listTemplates();
  assert.equal(empty[0].id, "default-substitution");

  const created = await dataStore.createTemplate({
    name: "Substitution",
    body: dataStore.DEFAULT_TEMPLATE_BODY
  });
  assert.equal(created.ok, true);
  const updated = await dataStore.updateTemplate({ ...created.template, name: "Updated substitution", body: dataStore.DEFAULT_TEMPLATE_BODY });
  assert.equal(updated.template.name, "Updated substitution");

  const archived = await dataStore.archiveTemplate(created.template.id);
  assert.equal(archived.ok, true);
  const templates = await dataStore.listTemplates();
  assert.equal(templates.some((template) => template.id === created.template.id), false);
});

test("duplicate SMS detection works across concurrent attempts", async () => {
  makeMockStores();
  const first = baseRecord({ idempotencyKey: "concurrent-a" });
  const second = baseRecord({ idempotencyKey: "concurrent-b" });
  const results = await Promise.all([
    dataStore.createMessageRecord(first),
    dataStore.createMessageRecord(second)
  ]);
  assert.equal(results.filter((result) => result.ok).length, 2);
  assert.equal(results.filter((result) => result.idempotent).length, 1);
  const duplicate = await dataStore.checkDuplicateMessage(second);
  assert.equal(Boolean(duplicate), true);
});

test("adapter errors return safe messages", async () => {
  makeMockStores({ failWrites: true });
  const result = await dataStore.createMessageRecord(baseRecord({ idempotencyKey: "fail" }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "STORAGE_ERROR");
  assert.doesNotMatch(result.error, /mock storage unavailable/);
});

test("redaction validation and backup prevent secret leakage", async () => {
  makeMockStores();
  const unsafe = await dataStore.createMessageRecord(baseRecord({ customerPhoneRedacted: "+15551234567", idempotencyKey: "unsafe" }));
  assert.equal(unsafe.ok, false);

  await dataStore.createMessageRecord(baseRecord({
    customerPhoneRedacted: "+15*******67",
    idempotencyKey: "safe",
    staffIdentity: "Staff shpat_test TWILIO_AUTH_TOKEN"
  }));
  await dataStore.initializeDataStores();
  const backup = await dataStore.exportSafeBackup();
  const body = JSON.stringify(backup);
  assert.match(body, /\+15\*{7}67/);
  assert.doesNotMatch(body, /\+15551234567/);
  assert.doesNotMatch(body, /shpat_test|TWILIO_AUTH_TOKEN|authorization:|Bearer /i);
});
