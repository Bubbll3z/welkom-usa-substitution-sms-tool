const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";

const dataStore = require("../src/data-store");
const { maskEmail, maskPhone, redactObject } = require("../src/safe-logger");

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
      async delete(key) {
        map.delete(key);
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

test("safe logger redacts secrets and masks customer contact data", () => {
  const redacted = redactObject({
    password: "super-secret",
    accessToken: "shpat_should_not_log",
    authorization: "Bearer abc123",
    nested: {
      twilioAuthToken: "twilio-secret",
      note: "Call +15551234567 or email sarah@example.com"
    }
  });
  const body = JSON.stringify(redacted);
  assert.doesNotMatch(body, /super-secret|shpat_should_not_log|Bearer abc123|twilio-secret|sarah@example.com|\+15551234567/);
  assert.match(body, /\[redacted\]/);
  assert.equal(maskPhone("+15551234567"), "+15*******67");
  assert.equal(maskEmail("sarah@example.com"), "sa***@ex***.com");
});

test("Blob keys do not expose phone numbers, emails, raw tokens or plain order numbers", async () => {
  const { maps } = makeMockStores();
  await dataStore.createMessageRecord(baseRecord({ idempotencyKey: "key-safety", orderName: "#1023" }));
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG"
  }));
  await dataStore.saveOptOutStatus({
    phone: "+15551234567",
    fromRedacted: "+15*******67",
    toRedacted: "+18*******00",
    messageSid: "SMabc123",
    keyword: "STOP"
  });

  const keys = Array.from(maps.values()).flatMap((map) => Array.from(map.keys())).join("\n");
  assert.equal(created.ok, true);
  assert.doesNotMatch(keys, /\+15551234567|sarah@example.com|abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG|#1023/);
  assert.match(keys, /records\/msg_|requests\/req_|tokens\/[a-f0-9]{64}|opt-outs\/[a-f0-9]{64}/);
});

test("cleanup removes old webhook dedupe records and archives old terminal requests", async () => {
  const { mapFor } = makeMockStores();
  const now = new Date("2026-07-27T00:00:00.000Z").getTime();
  mapFor("welkom-sms-history").set("twilio-message-sids/SMold123", JSON.stringify({
    messageSid: "SMold123",
    receivedAt: "2026-07-01T00:00:00.000Z"
  }));
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    requestId: "req_cleanup",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-06-03T00:00:00.000Z"
  }));
  assert.equal(created.ok, true);

  const cleanup = await dataStore.cleanupDataStoreRecords({ now, max: 10 });
  assert.equal(cleanup.removedWebhookDedupe, 1);
  assert.equal(cleanup.archivedExpiredRequests, 1);
  assert.equal(mapFor("welkom-sms-history").has("twilio-message-sids/SMold123"), false);
  const archived = JSON.parse(mapFor("welkom-sms-substitution-requests").get("requests/req_cleanup"));
  assert.ok(archived.archivedAt);
});

test("audit entries redact secrets and customer contact data", async () => {
  const { mapFor } = makeMockStores();
  await dataStore.createAuditRecord({
    type: "sms_failure",
    actor: "Staff",
    details: {
      phone: "+15551234567",
      email: "sarah@example.com",
      password: "never-store",
      token: "raw-token"
    }
  });
  const auditBody = Array.from(mapFor("welkom-sms-audit").values()).join("\n");
  assert.doesNotMatch(auditBody, /\+15551234567|sarah@example.com|never-store|raw-token/);
  assert.match(auditBody, /\+15\*{7}67|sa\*\*\*@ex\*\*\*\.com|\[redacted\]/);
});

function baseSubstitutionRequest(overrides = {}) {
  return {
    shopifyOrderId: "gid://shopify/Order/1",
    orderNumber: "#1023",
    customerFirstName: "Sarah",
    customerPhoneHash: "phone-hash",
    customerPhoneRedacted: "+15*******67",
    createdBy: "Test Staff",
    items: [
      {
        originalLineItemId: "gid://shopify/LineItem/1",
        originalVariantId: "gid://shopify/ProductVariant/old",
        originalTitle: "Cadbury Crunchie 40g",
        originalImageUrl: "https://example.com/crunchie.jpg",
        originalPrice: "USD 3.99",
        quantity: 1,
        substituteOptions: [
          {
            variantId: "gid://shopify/ProductVariant/new",
            productTitle: "Cadbury Flake 32g",
            variantTitle: "Default",
            sku: "FLAKE32",
            imageUrl: "https://example.com/flake.jpg",
            price: "USD 3.99",
            availableQuantityAtCreation: 8
          }
        ]
      }
    ],
    ...overrides
  };
}

test("substitution requests use secure token hashes and public redaction", async () => {
  makeMockStores();
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG"
  }));
  assert.equal(created.ok, true);
  assert.ok(created.token.length >= 32);
  assert.equal(created.record.tokenHash, dataStore.hashResponseToken(created.token));
  assert.notEqual(created.record.tokenHash, created.token);
  assert.equal(created.record.publicUrl, undefined);
  assert.equal(created.record.customerPhoneHash, undefined);
  assert.equal(created.record.customerPhoneRedacted, undefined);
  assert.equal(created.record.customerFirstName, undefined);

  const publicView = dataStore.safeRequestForCustomer(created.record);
  const body = JSON.stringify(publicView);
  assert.match(body, /Cadbury Crunchie/);
  assert.doesNotMatch(body, /gid:\/\/shopify|phone-hash|15551234567|tokenHash|customerPhone|Sarah/i);

  const fetched = await dataStore.getSubstitutionRequestByToken(created.token);
  assert.equal(fetched.requestId, created.record.requestId);

  const guessed = await dataStore.getSubstitutionRequestByToken("abcdefghijklmnopqrstuvwxyz1234567890ABCDEFZ");
  assert.equal(guessed, null);
});

test("customer response supports substitutes, refund, store choice and contact without overwriting", async () => {
  makeMockStores();
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG",
    items: [
      ...baseSubstitutionRequest().items,
      {
        originalLineItemId: "gid://shopify/LineItem/2",
        originalTitle: "Marmite 250g",
        originalPrice: "USD 8.99",
        quantity: 1,
        substituteOptions: [
          {
            variantId: "gid://shopify/ProductVariant/marmite",
            productTitle: "Marmite 125g",
            variantTitle: "Default",
            sku: "MAR125",
            price: "USD 6.99",
            availableQuantityAtCreation: 4
          }
        ]
      }
    ]
  }));
  const [first, second] = created.record.items;
  const invalid = await dataStore.submitSubstitutionResponse(created.token, [
    { requestItemId: first.requestItemId, type: "substitute", optionId: "unapproved" },
    { requestItemId: second.requestItemId, type: "refund" }
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "INVALID_RESPONSE");

  const submitted = await dataStore.submitSubstitutionResponse(created.token, [
    { requestItemId: first.requestItemId, type: "substitute", optionId: first.substituteOptions[0].optionId },
    { requestItemId: second.requestItemId, type: "refund" }
  ]);
  assert.equal(submitted.ok, true);
  assert.equal(submitted.record.status, "customer_responded");

  const repeat = await dataStore.submitSubstitutionResponse(created.token, [
    { requestItemId: first.requestItemId, type: "store_choice" },
    { requestItemId: second.requestItemId, type: "contact" }
  ]);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.alreadySubmitted, true);
  assert.equal(repeat.record.submittedChoices[0].type, "substitute");
  assert.equal(repeat.record.submissionVersion, 1);
});

test("customer response links can be rotated without storing raw tokens", async () => {
  makeMockStores();
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG",
    baseUrl: "https://sms.example.com"
  }));
  const rotated = await dataStore.rotateSubstitutionRequestToken(created.record.requestId, "https://sms.example.com", "Manager");
  assert.equal(rotated.ok, true);
  assert.match(rotated.publicUrl, /^https:\/\/sms\.example\.com\/respond\//);
  assert.equal(rotated.record.publicUrl, undefined);
  assert.equal(await dataStore.getSubstitutionRequestByToken(created.token), null);
  assert.equal((await dataStore.getSubstitutionRequestByToken(rotated.token)).requestId, created.record.requestId);
});

test("concurrent duplicate submissions preserve the first saved response", async () => {
  makeMockStores();
  const created = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "concurrentabcdefghijklmnopqrstuvwxyz1234567890"
  }));
  const [item] = created.record.items;
  const firstChoice = [{ requestItemId: item.requestItemId, type: "substitute", optionId: item.substituteOptions[0].optionId }];
  const secondChoice = [{ requestItemId: item.requestItemId, type: "refund" }];
  const results = await Promise.all([
    dataStore.submitSubstitutionResponse(created.token, firstChoice),
    dataStore.submitSubstitutionResponse(created.token, secondChoice)
  ]);
  assert.equal(results.every((result) => result.ok), true);
  const latest = await dataStore.getSubstitutionRequest(created.record.requestId);
  assert.equal(latest.submissionVersion, 1);
  assert.equal(latest.submittedChoices.length, 1);
  assert.equal(latest.submittedChoices[0].type, "substitute");
});

test("expired, revoked and completed substitution requests are protected", async () => {
  makeMockStores();
  const expired = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "expiredabcdefghijklmnopqrstuvwxyz1234567890",
    expiresAt: "2020-01-01T00:00:00.000Z"
  }));
  const expiredSubmit = await dataStore.submitSubstitutionResponse(expired.token, []);
  assert.equal(expiredSubmit.code, "REQUEST_EXPIRED");

  const active = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "activeabcdefghijklmnopqrstuvwxyz1234567890"
  }));
  const revoked = await dataStore.updateSubstitutionRequestStatus(active.record.requestId, "revoked", "Manager");
  assert.equal(revoked.ok, true);
  const revokedSubmit = await dataStore.submitSubstitutionResponse(active.token, []);
  assert.equal(revokedSubmit.code, "REQUEST_REVOKED");
});

test("customer link open states are generic and read-only where needed", async () => {
  makeMockStores();
  const valid = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "validlinkabcdefghijklmnopqrstuvwxyz1234567890"
  }));
  const opened = await dataStore.markSubstitutionRequestOpened(valid.token);
  assert.equal(opened.ok, true);
  assert.equal(opened.record.status, "opened");

  const [item] = opened.record.items;
  const submitted = await dataStore.submitSubstitutionResponse(valid.token, [
    { requestItemId: item.requestItemId, type: "refund" }
  ]);
  assert.equal(submitted.ok, true);
  const readOnly = await dataStore.markSubstitutionRequestOpened(valid.token);
  assert.equal(readOnly.ok, true);
  assert.equal(readOnly.record.status, "customer_responded");

  const expired = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "openexpiredabcdefghijklmnopqrstuvwxyz1234567890",
    expiresAt: "2020-01-01T00:00:00.000Z"
  }));
  const expiredOpen = await dataStore.markSubstitutionRequestOpened(expired.token);
  assert.equal(expiredOpen.ok, false);
  assert.equal(expiredOpen.code, "REQUEST_UNAVAILABLE");

  const revoked = await dataStore.createSubstitutionRequest(baseSubstitutionRequest({
    token: "openrevokedabcdefghijklmnopqrstuvwxyz1234567890"
  }));
  await dataStore.updateSubstitutionRequestStatus(revoked.record.requestId, "revoked", "Manager");
  const revokedOpen = await dataStore.markSubstitutionRequestOpened(revoked.token);
  assert.equal(revokedOpen.ok, false);
  assert.equal(revokedOpen.code, "REQUEST_UNAVAILABLE");
});
