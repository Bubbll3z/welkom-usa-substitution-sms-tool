    const els = {
      authLoading: document.getElementById("authLoading"),
      sidebar: document.getElementById("sidebar"),
      drawerBackdrop: document.getElementById("drawerBackdrop"),
      menuButton: document.getElementById("menuButton"),
      pageTitle: document.getElementById("pageTitle"),
      pageDescription: document.getElementById("pageDescription"),
      searchPage: document.getElementById("searchPage"),
      dashboardPage: document.getElementById("dashboardPage"),
      sentPage: document.getElementById("sentPage"),
      requestsPage: document.getElementById("requestsPage"),
      templatesPage: document.getElementById("templatesPage"),
      settingsPage: document.getElementById("settingsPage"),
      backupPage: document.getElementById("backupPage"),
      respondPage: document.getElementById("respondPage"),
      loginPasswordField: document.getElementById("loginPasswordField"),
      loginPasswordFieldPassword: document.getElementById("loginPasswordFieldPassword"),
      loginActions: document.getElementById("loginActions"),
      username: document.getElementById("username"),
      password: document.getElementById("password"),
      loginButton: document.getElementById("loginButton"),
      logoutButton: document.getElementById("logoutButton"),
      orderQuery: document.getElementById("orderQuery"),
      searchButton: document.getElementById("searchButton"),
      searchState: document.getElementById("searchState"),
      customerDetails: document.getElementById("customerDetails"),
      orderDetails: document.getElementById("orderDetails"),
      lineItems: document.getElementById("lineItems"),
      substitutions: document.getElementById("substitutions"),
      subSearch: document.getElementById("subSearch"),
      subSearchButton: document.getElementById("subSearchButton"),
      subSearchState: document.getElementById("subSearchState"),
      customSubButton: document.getElementById("customSubButton"),
      requestBuilderState: document.getElementById("requestBuilderState"),
      addRequestOptionButton: document.getElementById("addRequestOptionButton"),
      clearRequestButton: document.getElementById("clearRequestButton"),
      requestItemsList: document.getElementById("requestItemsList"),
      requestStaffNote: document.getElementById("requestStaffNote"),
      requestExpiry: document.getElementById("requestExpiry"),
      sendRequestButton: document.getElementById("sendRequestButton"),
      requestSmsPreview: document.getElementById("requestSmsPreview"),
      manualMode: document.getElementById("manualMode"),
      manualFields: document.getElementById("manualFields"),
      manualPhone: document.getElementById("manualPhone"),
      manualFirstName: document.getElementById("manualFirstName"),
      manualUnavailable: document.getElementById("manualUnavailable"),
      manualSubstitute: document.getElementById("manualSubstitute"),
      manualReference: document.getElementById("manualReference"),
      manualConsent: document.getElementById("manualConsent"),
      message: document.getElementById("message"),
      previewBubble: document.getElementById("previewBubble"),
      previewTime: document.getElementById("previewTime"),
      counter: document.getElementById("counter"),
      copyButton: document.getElementById("copyButton"),
      sendButton: document.getElementById("sendButton"),
      sendReadiness: document.getElementById("sendReadiness"),
      messageHelp: document.getElementById("messageHelp"),
      templateButton: document.getElementById("templateButton"),
      consentBadge: document.getElementById("consentBadge"),
      consentNotice: document.getElementById("consentNotice"),
      modalBackdrop: document.getElementById("modalBackdrop"),
      confirmBody: document.getElementById("confirmBody"),
      cancelSendButton: document.getElementById("cancelSendButton"),
      confirmSendButton: document.getElementById("confirmSendButton"),
      toastStack: document.getElementById("toastStack"),
      historyList: document.getElementById("historyList"),
      clearHistoryButton: document.getElementById("clearHistoryButton"),
      historyShortcut: document.getElementById("historyShortcut"),
      historyNav: document.getElementById("historyNav"),
      requestsNav: document.getElementById("requestsNav"),
      searchNav: document.getElementById("searchNav"),
      dashboardNav: document.getElementById("dashboardNav"),
      templatesNav: document.getElementById("templatesNav"),
      settingsNav: document.getElementById("settingsNav"),
      backupNav: document.getElementById("backupNav"),
      sidebarLogoutButton: document.getElementById("sidebarLogoutButton"),
      dashboardRefresh: document.getElementById("dashboardRefresh"),
      dashboardStats: document.getElementById("dashboardStats"),
      configStatus: document.getElementById("configStatus"),
      recentActivity: document.getElementById("recentActivity"),
      historySearch: document.getElementById("historySearch"),
      historyStatus: document.getElementById("historyStatus"),
      historyDryRun: document.getElementById("historyDryRun"),
      historyRefreshButton: document.getElementById("historyRefreshButton"),
      historyResetButton: document.getElementById("historyResetButton"),
      sentHistoryList: document.getElementById("sentHistoryList"),
      historyPager: document.getElementById("historyPager"),
      requestsRefreshButton: document.getElementById("requestsRefreshButton"),
      requestsResetButton: document.getElementById("requestsResetButton"),
      requestsSearch: document.getElementById("requestsSearch"),
      requestsStatus: document.getElementById("requestsStatus"),
      requestsList: document.getElementById("requestsList"),
      requestsPager: document.getElementById("requestsPager"),
      templateList: document.getElementById("templateList"),
      templateName: document.getElementById("templateName"),
      templateBody: document.getElementById("templateBody"),
      templateCounter: document.getElementById("templateCounter"),
      templatePreview: document.getElementById("templatePreview"),
      saveTemplateButton: document.getElementById("saveTemplateButton"),
      duplicateTemplateButton: document.getElementById("duplicateTemplateButton"),
      archiveTemplateButton: document.getElementById("archiveTemplateButton"),
      settingsStatus: document.getElementById("settingsStatus"),
      testConnectionsButton: document.getElementById("testConnectionsButton"),
      initializeBlobsButton: document.getElementById("initializeBlobsButton"),
      restoreTemplateButton: document.getElementById("restoreTemplateButton"),
      settingsActionsStatus: document.getElementById("settingsActionsStatus"),
      diagnosticsList: document.getElementById("diagnosticsList"),
      backupInfo: document.getElementById("backupInfo"),
      exportJsonButton: document.getElementById("exportJsonButton"),
      exportCsvButton: document.getElementById("exportCsvButton"),
      respondIntro: document.getElementById("respondIntro"),
      respondContent: document.getElementById("respondContent")
    };

    const TEMPLATE = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";
    const GSM_7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
    const GSM_7_EXTENDED = "^{}\\[~]|€";

    const state = {
      authenticated: false,
      staffName: "",
      role: "",
      csrfToken: "",
      order: null,
      unavailableItem: null,
      substituteItem: null,
      requestItems: [],
      customerRequest: null,
      manualMode: false,
      authRequired: true,
      authorizedResend: false,
      lastFocus: null,
      currentPage: "search",
      historyPage: 1,
      historyLimit: 25,
      requestsPage: 1,
      requestsLimit: 25,
      selectedTemplate: null,
      templates: []
    };

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    }

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    function appendDetails(container, rows) {
      clear(container);
      rows.forEach(([label, value, decorate]) => {
        container.append(el("dt", "", label));
        const dd = el("dd");
        if (decorate) {
          decorate(dd);
        } else {
          dd.textContent = value || "-";
        }
        container.append(dd);
      });
    }

    function toast(type, message) {
      const node = el("div", `toast ${type}`, message);
      els.toastStack.appendChild(node);
      setTimeout(() => node.remove(), 4500);
    }

    function statusBadge(value, goodLabel = "Configured", badLabel = "Missing") {
      const ok = Boolean(value);
      return el("span", ok ? "badge" : "badge error", ok ? goodLabel : badLabel);
    }

    function renderStatusGrid(container, rows) {
      clear(container);
      rows.forEach(([label, value, badge]) => {
        const row = el("div", "settings-row");
        row.append(el("span", "", label));
        if (badge) {
          row.append(badge);
        } else {
          row.append(document.createTextNode(value || "-"));
        }
        container.append(row);
      });
    }

    const pages = {
      search: {
        node: els.searchPage,
        nav: els.searchNav,
        title: "Substitution SMS",
        description: "Search an order to view customer details, order items and send a substitution message.",
        path: "/"
      },
      dashboard: {
        node: els.dashboardPage,
        nav: els.dashboardNav,
        title: "Dashboard",
        description: "View sending status, configuration health and recent activity.",
        path: "/dashboard"
      },
      sent: {
        node: els.sentPage,
        nav: els.historyNav,
        title: "Sent Messages",
        description: "Review dry-run and live SMS audit history.",
        path: "/sent"
      },
      requests: {
        node: els.requestsPage,
        nav: els.requestsNav,
        title: "Substitution Requests",
        description: "Review secure customer choice links and responses.",
        path: "/requests"
      },
      templates: {
        node: els.templatesPage,
        nav: els.templatesNav,
        title: "Templates",
        description: "Maintain the approved substitution SMS wording.",
        path: "/templates"
      },
      settings: {
        node: els.settingsPage,
        nav: els.settingsNav,
        title: "Settings",
        description: "Check safe configuration status without exposing secrets.",
        path: "/settings"
      },
      backup: {
        node: els.backupPage,
        nav: els.backupNav,
        title: "Backup",
        description: "Export local audit data for backup or review.",
        path: "/backup"
      },
      respond: {
        node: els.respondPage,
        nav: els.searchNav,
        title: "Customer Response",
        description: "Secure customer substitution choice page.",
        path: "/respond"
      }
    };

    function pageFromPath(pathname) {
      if (pathname.startsWith("/respond/")) return "respond";
      return Object.entries(pages).find(([, page]) => page.path === pathname)?.[0] || "search";
    }

    async function navigate(pageName, push = true) {
      const page = pages[pageName] || pages.search;
      state.currentPage = pages[pageName] ? pageName : "search";
      Object.values(pages).forEach((entry) => {
        entry.node.classList.add("hidden");
        entry.nav.classList.remove("active");
        entry.nav.removeAttribute("aria-current");
      });
      page.node.classList.remove("hidden");
      page.nav.classList.add("active");
      page.nav.setAttribute("aria-current", "page");
      els.pageTitle.textContent = page.title;
      els.pageDescription.textContent = page.description;
      toggleDrawer(false);
      if (push && window.location.pathname !== page.path) {
        window.history.pushState({ page: state.currentPage }, "", page.path);
      }
      document.querySelector(".content").scrollIntoView({ behavior: "smooth", block: "start" });
      if (state.currentPage !== "respond") {
        document.querySelector(".layout").style.display = "";
        document.querySelector(".sidebar").classList.remove("hidden");
        document.querySelector(".topbar").classList.remove("hidden");
      }

      if (state.currentPage === "dashboard") await loadDashboard();
      if (state.currentPage === "sent") await loadSentMessages();
      if (state.currentPage === "requests") await loadSubstitutionRequests();
      if (state.currentPage === "templates") await loadTemplates();
      if (state.currentPage === "settings") await loadSettings();
      if (state.currentPage === "respond") await loadCustomerResponse();
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(state.csrfToken && !["GET", "HEAD", "OPTIONS"].includes(String(options.method || "GET").toUpperCase()) ? { "X-CSRF-Token": state.csrfToken } : {}),
          ...(options.headers || {})
        }
      });
      const result = await response.json().catch(() => ({ success: false, error: "Invalid server response." }));
      if (!response.ok || !result.success) {
        const error = new Error(result.error || "Request failed.");
        error.code = result.code;
        error.result = result;
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function setAuth(authenticated, staffName = "", authRequired = true, role = "", csrfToken = "") {
      state.authenticated = authenticated;
      state.staffName = staffName;
      state.authRequired = authRequired;
      state.role = role || "";
      state.csrfToken = csrfToken || "";
      els.loginPasswordField.classList.toggle("hidden", !authRequired);
      els.loginPasswordFieldPassword.classList.toggle("hidden", !authRequired);
      els.loginActions.classList.toggle("hidden", !authRequired);
      els.username.disabled = authenticated || !authRequired;
      els.password.disabled = authenticated || !authRequired;
      els.loginButton.disabled = authenticated || !authRequired;
      els.logoutButton.disabled = !authenticated || !authRequired;
      els.sidebarLogoutButton.disabled = !authenticated || !authRequired;
      els.searchButton.disabled = !authenticated;
      els.subSearchButton.disabled = !authenticated;
      els.manualMode.disabled = !authenticated;
      [els.templatesNav, els.settingsNav, els.backupNav].forEach((node) => {
        node.classList.toggle("hidden", !authenticated || role !== "admin");
      });
      els.subSearchState.textContent = authenticated ? "Shopify suggestions" : "Log in first";
      updateSendState();
    }

    function finishAuthCheck() {
      document.body.classList.remove("auth-pending");
      els.authLoading?.classList.add("hidden");
    }

    async function checkSession() {
      try {
        const result = await api("/.netlify/functions/auth-me");
        setAuth(true, result.staffName, result.authRequired !== false, result.role, result.csrfToken);
        if (result.authRequired !== false) toast("success", `Logged in as ${result.staffName}.`);
        await loadHistory();
        await navigate(state.currentPage, false);
      } catch (error) {
        setAuth(false, "", true);
        renderHistory([]);
      } finally {
        finishAuthCheck();
      }
    }

    async function login() {
      if (!els.username.value) {
        toast("error", "Enter your staff username first.");
        return;
      }
      if (!els.password.value) {
        toast("error", "Enter the staff password first.");
        return;
      }
      try {
        const result = await api("/.netlify/functions/auth-login", {
          method: "POST",
          body: JSON.stringify({ username: els.username.value, password: els.password.value })
        });
        els.password.value = "";
        setAuth(true, result.staffName, result.authRequired !== false, result.role, result.csrfToken);
        toast("success", "Logged in.");
        await loadHistory();
        await navigate(state.currentPage, false);
      } catch (error) {
        toast("error", error.message);
      }
    }

    async function logout() {
      try {
        await api("/.netlify/functions/auth-logout", { method: "POST" });
      } catch (error) {
      } finally {
        setAuth(false, "", true, "", "");
        toast("success", "Logged out.");
      }
    }

    function safeImageUrl(src) {
      try {
        const url = new URL(src);
        return url.protocol === "https:" ? url.href : "";
      } catch (error) {
        return "";
      }
    }

    function productImage(src, title) {
      const safe = safeImageUrl(src);
      if (!safe) return el("div", "thumb thumb-placeholder", "WE");
      const img = el("img", "thumb");
      img.src = safe;
      img.alt = title || "";
      return img;
    }

    function formatAddress(order) {
      if (order?.shippingAddressDisplay) return order.shippingAddressDisplay;
      const address = order?.shippingAddress || {};
      return [address.name, address.address1, address.address2, address.city, address.province, address.zip, address.country].filter(Boolean).join(", ");
    }

    function formatDate(value) {
      if (!value) return "-";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
    }

    function orderNumberClean() {
      return String(state.order?.name || "").replace(/^#/, "");
    }

    function isManualMode() {
      return Boolean(state.manualMode);
    }

    function isE164(phone) {
      return /^\+[1-9]\d{7,14}$/.test(String(phone || "").trim());
    }

    function manualValue(input, fallback) {
      return String(input?.value || "").trim().replace(/\s+/g, " ") || fallback;
    }

    function isGsm7(text) {
      return Array.from(String(text || "")).every((char) => GSM_7_BASIC.includes(char) || GSM_7_EXTENDED.includes(char));
    }

    function smsEstimate(text) {
      const chars = Array.from(String(text || ""));
      if (!isGsm7(text)) {
        const length = chars.length;
        return { encoding: "UCS-2", length, segments: length ? (length <= 70 ? 1 : Math.ceil(length / 67)) : 0 };
      }
      const length = chars.reduce((total, char) => total + (GSM_7_EXTENDED.includes(char) ? 2 : 1), 0);
      return { encoding: "GSM-7", length, segments: length ? (length <= 160 ? 1 : Math.ceil(length / 153)) : 0 };
    }

    function fillTemplate() {
      let values;
      if (isManualMode()) {
        values = {
          "[FIRST NAME]": manualValue(els.manualFirstName, "there"),
          "[ORDER NUMBER]": manualValue(els.manualReference, "manual"),
          "[UNAVAILABLE ITEM]": manualValue(els.manualUnavailable, "your requested item"),
          "[SUBSTITUTE ITEM]": manualValue(els.manualSubstitute, "a substitute item")
        };
      } else {
        if (!state.order || !state.unavailableItem || !state.substituteItem) return;
        values = {
          "[FIRST NAME]": state.order.customer?.firstName || "there",
          "[ORDER NUMBER]": orderNumberClean(),
          "[UNAVAILABLE ITEM]": state.unavailableItem.title || "your item",
          "[SUBSTITUTE ITEM]": state.substituteItem.title || "a substitute item"
        };
      }
      els.message.value = TEMPLATE.replace(/\[FIRST NAME\]|\[ORDER NUMBER\]|\[UNAVAILABLE ITEM\]|\[SUBSTITUTE ITEM\]/g, (token) => values[token]);
      updateMessageState();
    }

    function updateConsentBadge() {
      const granted = Boolean(state.order?.smsConsent?.granted);
      const email = state.order?.customer?.maskedEmail || "";
      els.consentBadge.className = granted ? "badge" : "badge error";
      els.consentBadge.textContent = granted ? "SMS Opt-In" : "No SMS Consent";
      if (granted) {
        els.consentNotice.textContent = `Shopify recorded SMS consent: ${state.order.smsConsent.value}.`;
      } else if (email) {
        els.consentNotice.textContent = `No SMS consent is recorded for this order. Do not send SMS. Email the customer instead at ${email}.`;
      } else if (state.order) {
        els.consentNotice.textContent = "No SMS consent is recorded and no customer email was returned. Do not send SMS; contact the customer through the normal order support process.";
      } else {
        els.consentNotice.textContent = "SMS consent must come from Shopify. A phone number alone is not treated as SMS consent.";
      }
      updateSendState();
    }

    function missingSendRequirements() {
      const missing = [];
      if (!state.authenticated) missing.push("staff is logged in");
      if (isManualMode()) {
        if (!isE164(els.manualPhone.value)) missing.push("manual phone is in international format");
        if (!els.manualConsent.checked) missing.push("manual SMS permission is confirmed");
        if (!els.message.value.trim()) missing.push("the message is not empty");
        if (!els.message.value.trim().startsWith("Welkom USA:")) missing.push("message starts with Welkom USA:");
        if (/\[[A-Z ]+\]/.test(els.message.value)) missing.push("all placeholders are replaced");
        return missing;
      }
      if (!state.order) missing.push("an order is loaded");
      if (state.order?.cancelled) missing.push("order is not cancelled");
      if (!state.order?.customer?.redactedPhone) missing.push("a customer phone number exists");
      if (!state.order?.smsConsent?.granted) missing.push("SMS consent is recorded on Shopify");
      if (!state.unavailableItem) missing.push("an order item to replace is selected");
      if (!state.substituteItem) missing.push("a substitute item is selected");
      if (state.substituteItem && state.substituteItem.availableForSale === false) missing.push("substitute is available");
      if (Number.isFinite(state.substituteItem?.inventoryQuantity) && state.substituteItem.inventoryQuantity <= 0) missing.push("substitute has inventory");
      if (!els.message.value.trim()) missing.push("the message is not empty");
      if (/\[[A-Z ]+\]/.test(els.message.value)) missing.push("all placeholders are replaced");
      return missing;
    }

    function updateMessageState() {
      const estimate = smsEstimate(els.message.value);
      els.counter.textContent = `${estimate.length} / 320 · ${estimate.segments} segment${estimate.segments === 1 ? "" : "s"} · ${estimate.encoding}`;
      els.previewBubble.textContent = els.message.value || "Build a message by selecting an order and products.";
      els.previewTime.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      updateSendState();
    }

    function updateSendState() {
      const missing = missingSendRequirements();
      els.sendButton.disabled = missing.length > 0;
      els.copyButton.disabled = !els.message.value.trim();
      els.sendReadiness.className = missing.length ? "notice warn" : "notice";
      els.sendReadiness.textContent = missing.length ? `Before sending, confirm: ${missing.join(", ")}.` : "Ready to send after final confirmation.";
      els.messageHelp.textContent = isManualMode()
        ? `Manual mode: type the recipient phone number, confirm permission, apply the template, then review before sending.`
        : state.order?.customer?.redactedPhone ? `This message will be sent to ${state.order.customer.redactedPhone}` : "Select an order item to replace and a substitute item.";
    }

    function setEmptyOrder() {
      appendDetails(els.customerDetails, [["Name", "-"], ["Phone", "-"], ["Email", "-"], ["Order Date", "-"], ["Shipping Address", "-"]]);
      appendDetails(els.orderDetails, [["Order ID", "-"], ["Order Number", "-"], ["Total", "-"], ["Financial Status", "-"], ["Fulfillment Status", "-"], ["Items", "-"]]);
      clear(els.lineItems);
      els.lineItems.append(el("div", "empty", "Search an order first."));
      clear(els.substitutions);
      els.substitutions.append(el("div", "empty", "Select an order item to review substitution options."));
      state.requestItems = [];
      renderRequestBuilder();
      updateConsentBadge();
    }

    function renderOrder(order) {
      state.order = order;
      state.unavailableItem = null;
      state.substituteItem = null;
      state.requestItems = [];
      state.authorizedResend = false;
      els.message.value = "";

      appendDetails(els.customerDetails, [
        ["Name", `${order.customer?.firstName || ""} ${order.customer?.lastName || ""}`.trim()],
        ["Phone", order.customer?.redactedPhone || "-"],
        ["Email", order.customer?.maskedEmail || "-"],
        ["Order Date", formatDate(order.processedAt)],
        ["Shipping Address", formatAddress(order)]
      ]);
      appendDetails(els.orderDetails, [
        ["Order ID", order.id],
        ["Order Number", order.name],
        ["Total", order.totalPrice || "-"],
        ["Financial Status", order.displayFinancialStatus || "-"],
        ["Fulfillment Status", order.displayFulfillmentStatus || "-"],
        ["Cancellation", order.cancelled ? `Cancelled ${formatDate(order.cancelledAt)}` : "Not cancelled"],
        ["Items", `${order.lineItems.length} item${order.lineItems.length === 1 ? "" : "s"}`]
      ]);
      renderLineItems(order.lineItems || []);
      clear(els.substitutions);
      els.substitutions.append(el("div", "empty", "Select an order item to load Shopify substitution suggestions."));
      renderRequestBuilder();
      updateConsentBadge();
      updateMessageState();
      if (order.cancelled) toast("error", "This order is cancelled, so messaging is disabled.");
      if (!order.smsConsent?.granted && order.customer?.email) toast("error", "No SMS consent recorded. Please email this customer instead.");
      if (!order.smsConsent?.granted && !order.customer?.email) toast("error", "No SMS consent recorded.");
    }

    function renderLineItems(items) {
      clear(els.lineItems);
      if (!items.length) {
        els.lineItems.append(el("div", "empty", "No ordered items were returned by Shopify."));
        return;
      }
      items.forEach((item) => {
        const button = productRow(item, true);
        button.addEventListener("click", async () => {
          state.unavailableItem = item;
          state.substituteItem = null;
          state.authorizedResend = false;
          document.querySelectorAll("#lineItems .product-row").forEach((node) => node.classList.remove("selected"));
          button.classList.add("selected");
          els.message.value = "";
          updateMessageState();
          await loadSubstitutionsForLineItem(item);
        });
        els.lineItems.append(button);
      });
    }

    function productRow(product, orderedItem = false) {
      const button = el("button", "product-row");
      button.type = "button";
      button.append(el("span", "radio-dot"));
      button.append(productImage(product.imageUrl, product.title));
      const textWrap = el("span");
      textWrap.append(el("span", "product-title", product.title || "Untitled product"));
      const meta = [
        product.variantTitle || "Default",
        orderedItem ? `Quantity: ${product.quantity}` : product.sku ? `SKU: ${product.sku}` : "",
        product.barcode ? `Barcode: ${product.barcode}` : ""
      ].filter(Boolean).join(" · ");
      textWrap.append(el("span", "product-meta", meta));
      button.append(textWrap);
      const side = el("span", "product-side");
      side.append(el("span", "", product.price || ""));
      if (!orderedItem) {
        const inventory = Number.isFinite(product.inventoryQuantity) ? `${product.inventoryQuantity} in stock` : "Inventory unknown";
        const badge = el("span", product.availableForSale ? "badge" : "badge error", product.availableForSale ? inventory : "Unavailable");
        side.append(badge);
      }
      button.append(side);
      return button;
    }

    async function loadSubstitutionsForLineItem(item) {
      clear(els.substitutions);
      els.substitutions.append(el("div", "empty", "Loading Shopify suggestions for the selected item..."));
      els.subSearchState.textContent = "Searching selected item...";
      try {
        const result = await api("/api/line-item-substitutions", {
          method: "POST",
          body: JSON.stringify({ orderId: state.order.id, lineItemId: item.id })
        });
        renderSubstitutions(result.products || []);
        els.subSearchState.textContent = `${(result.products || []).length} suggestion${(result.products || []).length === 1 ? "" : "s"}`;
      } catch (error) {
        clear(els.substitutions);
        els.substitutions.append(el("div", "empty", error.message));
        els.subSearchState.textContent = "Search failed";
      }
    }

    function renderSubstitutions(products) {
      clear(els.substitutions);
      if (!products.length) {
        els.substitutions.append(el("div", "empty", "No available Shopify substitute variants found. Search by title, SKU, or barcode."));
        return;
      }
      products.forEach((product) => {
        const button = productRow(product);
        button.addEventListener("click", async () => {
          state.substituteItem = product;
          state.authorizedResend = false;
          document.querySelectorAll("#substitutions .product-row").forEach((node) => node.classList.remove("selected"));
          button.classList.add("selected");
          fillTemplate();
          await checkDuplicate();
        });
        els.substitutions.append(button);
      });
    }

    async function searchOrder() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      if (!els.orderQuery.value.trim()) return toast("error", "Order number is required.");
      els.searchButton.disabled = true;
      els.searchButton.textContent = "Searching...";
      els.searchState.textContent = "Loading...";
      try {
        const result = await api("/api/order-search", {
          method: "POST",
          body: JSON.stringify({ query: els.orderQuery.value.trim() })
        });
        renderOrder(result.order);
        els.searchState.textContent = "Order loaded";
        els.searchState.style.color = "var(--green)";
        toast("success", `${result.order.name} loaded from Shopify.`);
      } catch (error) {
        els.searchState.textContent = "Lookup failed";
        els.searchState.style.color = "var(--error)";
        toast("error", error.message);
      } finally {
        els.searchButton.disabled = false;
        els.searchButton.textContent = "Search";
      }
    }

    async function searchSubstitutions() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      const query = els.subSearch.value.trim();
      if (!query) return toast("error", "Enter a product title, SKU, or barcode to search.");
      els.subSearchButton.disabled = true;
      els.subSearchButton.textContent = "Searching...";
      els.subSearchState.textContent = "Searching Shopify...";
      try {
        const result = await api("/api/product-search", {
          method: "POST",
          body: JSON.stringify({ query, excludeVariantId: state.unavailableItem?.variantId || "" })
        });
        renderSubstitutions(result.products || []);
        els.subSearchState.textContent = `${(result.products || []).length} result${(result.products || []).length === 1 ? "" : "s"}`;
      } catch (error) {
        els.subSearchState.textContent = "Search failed";
        toast("error", error.message);
      } finally {
        els.subSearchButton.disabled = false;
        els.subSearchButton.textContent = "Search";
      }
    }

    function addCustomSubstitute() {
      if (!state.order || !state.unavailableItem) {
        toast("error", "Load an order and select the item to replace first.");
        return;
      }
      const typed = window.prompt("Type the substitute item name exactly as staff want it shown in the SMS:", els.subSearch.value.trim());
      const title = String(typed || "").trim().replace(/\s+/g, " ");
      if (!title) return;
      if (title.length < 2 || title.length > 120) {
        toast("error", "Custom substitute must be between 2 and 120 characters.");
        return;
      }
      if (/<\/?[a-z][\s\S]*>/i.test(title)) {
        toast("error", "Custom substitute cannot contain HTML.");
        return;
      }
      state.substituteItem = {
        id: `custom:${title.toLowerCase()}`,
        title,
        customSubstitute: true,
        availableForSale: true
      };
      state.authorizedResend = false;
      document.querySelectorAll("#substitutions .product-row").forEach((node) => node.classList.remove("selected"));
      const row = productRow({
        title,
        variantTitle: "Manual substitute",
        sku: "",
        barcode: "",
        price: "",
        imageUrl: "",
        availableForSale: true,
        inventoryQuantity: Number.NaN
      });
      row.classList.add("selected");
      row.addEventListener("click", () => {
        state.substituteItem = {
          id: `custom:${title.toLowerCase()}`,
          title,
          customSubstitute: true,
          availableForSale: true
        };
        fillTemplate();
        updateMessageState();
      });
      clear(els.substitutions);
      els.substitutions.append(row);
      els.subSearchState.textContent = "Manual substitute";
      fillTemplate();
      checkDuplicate();
      toast("success", "Custom substitute added. Please review the SMS before sending.");
    }

    function moneyNumber(value) {
      const match = String(value || "").match(/(-?\d+(?:\.\d+)?)/);
      return match ? Number(match[1]) : 0;
    }

    function priceDiffLabel(original, substitute) {
      const currency = String(substitute || original || "").match(/^([A-Z]{3})\s/)?.[1] || "";
      const diff = moneyNumber(substitute) - moneyNumber(original);
      if (Math.abs(diff) < 0.005) return "Same price";
      return `${currency ? `${currency} ` : ""}${Math.abs(diff).toFixed(2)} ${diff > 0 ? "more" : "less"}`;
    }

    function secureRequestSmsPreview() {
      if (!state.order || !state.requestItems.length) return "Secure-link SMS preview will appear after you add an approved option.";
      return `Welkom USA: An item in order #${orderNumberClean()} is unavailable. Choose a substitute or refund here: [secure link]. Reply HELP for help or STOP to opt out.`;
    }

    function renderRequestBuilder() {
      if (!els.requestItemsList) return;
      clear(els.requestItemsList);
      els.requestSmsPreview.textContent = secureRequestSmsPreview();
      els.requestBuilderState.textContent = state.requestItems.length ? `${state.requestItems.length} item${state.requestItems.length === 1 ? "" : "s"}` : "Secure link";
      if (!state.requestItems.length) {
        els.requestItemsList.append(el("div", "empty", "Select an unavailable item and a Shopify substitute, then click Add Approved Option."));
        return;
      }
      state.requestItems.forEach((item) => {
        const card = el("div", "request-item");
        card.append(el("strong", "", `${item.originalTitle} · quantity ${item.quantity}`));
        const options = el("div", "option-pill-list");
        item.substituteVariantIds.forEach((variantId) => {
          const option = item.options.find((entry) => entry.id === variantId);
          const pill = el("span", "option-pill");
          pill.append(el("span", "", `${option?.title || "Substitute"} · ${priceDiffLabel(item.originalPrice, option?.price)}`));
          const remove = el("button", "", "×");
          remove.type = "button";
          remove.addEventListener("click", () => {
            item.substituteVariantIds = item.substituteVariantIds.filter((id) => id !== variantId);
            item.options = item.options.filter((entry) => entry.id !== variantId);
            state.requestItems = state.requestItems.filter((entry) => entry.substituteVariantIds.length);
            renderRequestBuilder();
          });
          pill.append(remove);
          options.append(pill);
        });
        card.append(options);
        els.requestItemsList.append(card);
      });
    }

    function addApprovedRequestOption() {
      if (!state.order) return toast("error", "Search an order first.");
      if (!state.unavailableItem) return toast("error", "Select the unavailable item first.");
      if (!state.substituteItem || state.substituteItem.customSubstitute) return toast("error", "Select a Shopify substitute option first.");
      let item = state.requestItems.find((entry) => entry.lineItemId === state.unavailableItem.id);
      if (!item) {
        item = {
          lineItemId: state.unavailableItem.id,
          originalTitle: state.unavailableItem.title,
          originalPrice: state.unavailableItem.price,
          quantity: state.unavailableItem.quantity || 1,
          substituteVariantIds: [],
          options: []
        };
        state.requestItems.push(item);
      }
      if (item.substituteVariantIds.includes(state.substituteItem.id)) return toast("error", "That substitute is already added for this item.");
      if (item.substituteVariantIds.length >= 3) return toast("error", "Each item can have up to three approved substitutes.");
      item.substituteVariantIds.push(state.substituteItem.id);
      item.options.push({ ...state.substituteItem });
      renderRequestBuilder();
      toast("success", "Approved substitute added to the customer request.");
    }

    function clearRequestBuilder() {
      state.requestItems = [];
      els.requestStaffNote.value = "";
      renderRequestBuilder();
    }

    async function sendCustomerRequest() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      if (!state.order) return toast("error", "Search an order first.");
      if (!state.order.smsConsent?.granted) return toast("error", "This order does not have recorded SMS consent.");
      if (!state.requestItems.length) return toast("error", "Add at least one approved substitute option.");
      els.sendRequestButton.disabled = true;
      try {
        const result = await api("/api/substitution-requests", {
          method: "POST",
          body: JSON.stringify({
            orderId: state.order.id,
            expiryHours: Number(els.requestExpiry.value || 48),
            staffNote: els.requestStaffNote.value,
            items: state.requestItems.map((item) => ({
              lineItemId: item.lineItemId,
              quantity: item.quantity,
              substituteVariantIds: item.substituteVariantIds
            })),
            sendConfirmed: true,
            idempotencyKey: `customer-request|${state.order.id}|${Date.now()}`
          })
        });
        toast("success", result.dryRun ? "Dry-run secure link created. No real SMS was sent." : "Secure link SMS sent.");
        els.requestSmsPreview.textContent = result.publicUrl ? `Link created: ${result.publicUrl}` : result.message || "Request created.";
        await loadSubstitutionRequests();
      } catch (error) {
        toast("error", error.message);
      } finally {
        els.sendRequestButton.disabled = false;
      }
    }

    function insertToken(token) {
      const start = els.message.selectionStart || 0;
      const end = els.message.selectionEnd || 0;
      els.message.value = `${els.message.value.slice(0, start)}${token}${els.message.value.slice(end)}`;
      els.message.focus();
      els.message.setSelectionRange(start + token.length, start + token.length);
      updateMessageState();
    }

    function toggleManualMode() {
      state.manualMode = els.manualMode.checked;
      els.manualFields.classList.toggle("hidden", !state.manualMode);
      state.authorizedResend = false;
      if (state.manualMode && !els.message.value.trim()) fillTemplate();
      updateMessageState();
    }

    async function copyMessage() {
      if (!els.message.value.trim()) return toast("error", "Build a message first.");
      await navigator.clipboard.writeText(els.message.value);
      toast("success", "Message copied.");
    }

    async function checkDuplicate() {
      if (!state.order || !state.unavailableItem || !state.substituteItem) return;
      try {
        const result = await api("/api/duplicate-check", {
          method: "POST",
          body: JSON.stringify({
            orderId: state.order.id,
            lineItemId: state.unavailableItem.id,
            substituteVariantId: state.substituteItem.customSubstitute ? "" : state.substituteItem.id,
            customSubstituteTitle: state.substituteItem.customSubstitute ? state.substituteItem.title : ""
          })
        });
        if (result.duplicate) {
          state.authorizedResend = false;
          toast("error", "Duplicate warning: this substitution was already sent. The confirmation modal will require authorised resend.");
        }
      } catch (error) {
      }
    }

    function idempotencyKey() {
      if (isManualMode()) {
        return `manual|${els.manualPhone.value.trim()}|${els.manualUnavailable.value.trim()}|${els.manualSubstitute.value.trim()}|${els.message.value}`;
      }
      return `${state.order.id}|${state.unavailableItem.id}|${state.substituteItem.id}|${state.substituteItem.customSubstitute ? "custom" : "shopify"}|${els.message.value}`;
    }

    function openConfirmModal() {
      const missing = missingSendRequirements();
      if (missing.length) return toast("error", `Cannot send yet: ${missing.join(", ")}.`);
      const estimate = smsEstimate(els.message.value);
      els.confirmBody.textContent = isManualMode()
        ? `Manual recipient: ${manualValue(els.manualFirstName, "Customer")}\nPhone: ${els.manualPhone.value.trim()}\nReference: ${manualValue(els.manualReference, "manual")}\nPermission: confirmed by staff\nSegments: ${estimate.segments} (${estimate.encoding})\n\n${els.message.value}`
        : `Customer: ${state.order.customer.firstName || ""} ${state.order.customer.lastName || ""}\nPhone: ${state.order.customer.redactedPhone}\nOrder: ${state.order.name}\nUnavailable: ${state.unavailableItem.title}\nSubstitute: ${state.substituteItem.title}\nConsent: ${state.order.smsConsent.granted ? "SMS Opt-In" : "No SMS Consent"}\nSegments: ${estimate.segments} (${estimate.encoding})\n\n${els.message.value}`;
      state.lastFocus = document.activeElement;
      els.modalBackdrop.classList.add("open");
      els.confirmSendButton.focus();
    }

    function closeConfirmModal() {
      els.modalBackdrop.classList.remove("open");
      if (state.lastFocus) state.lastFocus.focus();
    }

    async function sendSms() {
      closeConfirmModal();
      els.sendButton.disabled = true;
      els.confirmSendButton.disabled = true;
      try {
        const manual = isManualMode();
        const response = await fetch(manual ? "/api/send-manual-sms" : "/api/send-substitution-sms", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", ...(state.csrfToken ? { "X-CSRF-Token": state.csrfToken } : {}) },
          body: JSON.stringify(manual ? {
            phone: els.manualPhone.value.trim(),
            firstName: els.manualFirstName.value,
            unavailableItem: els.manualUnavailable.value,
            substituteItem: els.manualSubstitute.value,
            reference: els.manualReference.value,
            consentConfirmed: els.manualConsent.checked,
            sendConfirmed: true,
            message: els.message.value,
            idempotencyKey: idempotencyKey(),
            authorizedResend: state.authorizedResend
          } : {
            orderId: state.order.id,
            lineItemId: state.unavailableItem.id,
            substituteVariantId: state.substituteItem.customSubstitute ? "" : state.substituteItem.id,
            customSubstituteTitle: state.substituteItem.customSubstitute ? state.substituteItem.title : "",
            message: els.message.value,
            sendConfirmed: true,
            idempotencyKey: idempotencyKey(),
            authorizedResend: state.authorizedResend
          })
        });
        const result = await response.json();
        if (response.status === 409 && result.code === "DUPLICATE_MESSAGE") {
          state.authorizedResend = true;
          toast("error", result.error);
          openConfirmModal();
          return;
        }
        if (!response.ok || !result.success) throw new Error(result.error || "SMS could not be sent.");
        toast("success", result.message || `SMS processed: ${result.providerStatus}.`);
        await loadHistory();
      } catch (error) {
        toast("error", error.message || "Could not reach the SMS service.");
      } finally {
        els.confirmSendButton.disabled = false;
        updateSendState();
      }
    }

    async function loadHistory() {
      if (!state.authenticated) return renderHistory([]);
      try {
        const result = await api("/api/message-history");
        renderHistory(result.records || []);
      } catch (error) {
        renderHistory([]);
      }
    }

    async function loadDashboard() {
      if (!state.authenticated) {
        renderDashboard(null);
        return;
      }
      try {
        const result = await api("/api/dashboard");
        renderDashboard(result);
      } catch (error) {
        clear(els.dashboardStats);
        els.dashboardStats.append(el("div", "notice error wide", error.message));
      }
    }

    function renderDashboard(result) {
      clear(els.dashboardStats);
      clear(els.recentActivity);
      if (!result) {
        els.dashboardStats.append(el("div", "notice warn wide", "Log in to view the dashboard."));
        renderStatusGrid(els.configStatus, [["Session", "Log in first", statusBadge(false, "Active", "Logged out")]]);
        els.recentActivity.append(el("div", "empty", "Recent messages will appear after login."));
        return;
      }
      const stats = result.stats || {};
      if (result.warning) {
        els.dashboardStats.append(el("div", "notice warn wide", result.warning));
      }
      [
        ["Total", stats.total || 0],
        ["Live Sent", stats.production || 0],
        ["Dry Runs", stats.dryRun || 0],
        ["Failures", stats.failed || 0],
        ["This Week", stats.sentLast7Days || 0],
        ["Today", stats.sentToday || 0]
      ].forEach(([label, value]) => {
        const card = el("div", "metric");
        card.append(el("span", "fine", label));
        card.append(el("strong", "", value));
        els.dashboardStats.append(card);
      });
      renderSafeStatus(els.configStatus, result.status || {});
      const records = result.recent || [];
      if (!records.length) {
        els.recentActivity.append(el("div", "empty", "No message activity yet."));
      } else {
        records.slice(0, 8).forEach((record) => els.recentActivity.append(messageRecordRow(record)));
      }
    }

    function renderSafeStatus(container, status) {
      renderStatusGrid(container, [
        ["Shopify store", status.shopifyDomain || "-", statusBadge(status.shopifyConfigured)],
        ["Shopify API version", status.shopifyApiVersion || "-"],
        ["Twilio sender", status.twilioSender || "-", statusBadge(status.twilioConfigured)],
        ["Dry run mode", status.dryRun ? "On" : "Off", statusBadge(!status.dryRun, "Live enabled", "Dry run")],
        ["Production sending", status.productionSendingEnabled ? "Enabled" : "Blocked", statusBadge(status.productionSendingEnabled, "Enabled", "Blocked")],
        ["Storage", `${status.storageProvider || "-"}${status.storagePersistent ? " persistent" : " memory"}`],
        ["Storage health", status.storageHealthy === false ? "Needs first write" : "Available", statusBadge(status.storageHealthy !== false, "Available", "Needs init")],
        ["Blob init action", status.blobInitEnabled ? "Enabled" : "Disabled", statusBadge(status.blobInitEnabled, "Enabled", "Disabled")],
        ["Staff login", status.authRequired ? "Required" : "Disabled for testing", statusBadge(!status.authRequired, "Disabled", "Required")],
        ["SMS consent required", status.consentEnforced ? "Yes" : "No", statusBadge(status.consentEnforced, "Required", "Disabled")],
        ["Cloudflare required", status.cloudflareRequired ? "Yes" : "No"]
      ]);
    }

    function messageRecordRow(item) {
      const row = el("div", "message-row");
      const main = el("div");
      const status = item.latestTwilioStatus || item.initialTwilioStatus || (item.dryRun ? "dry_run" : "sent");
      main.append(el("strong", "", `${item.orderName || item.orderId || "-"} - ${status}`));
      main.append(el("p", "", `${new Date(item.createdAt).toLocaleString()} - ${item.customerPhoneRedacted || ""} - ${item.staffIdentity || ""}`));
      if (item.message) main.append(el("p", "", item.message));
      row.append(main);
      row.append(el("span", item.dryRun ? "badge warn" : "badge", item.dryRun ? "Dry run" : "Live"));
      return row;
    }

    function requestRow(request) {
      const row = el("div", "message-row");
      const main = el("div");
      main.append(el("strong", "", `#${request.orderNumber || "-"} · ${request.status || "-"}`));
      main.append(el("p", "", `${request.customerFirstName || "Customer"} · ${request.items?.length || 0} item${request.items?.length === 1 ? "" : "s"} · expires ${formatDate(request.expiresAt)}`));
      if (request.submittedAt) main.append(el("p", "", `Responded ${formatDate(request.submittedAt)}`));
      if (request.publicUrl) main.append(el("p", "", request.publicUrl));
      row.append(main);
      const actions = el("div");
      actions.style.display = "grid";
      actions.style.gap = "6px";
      const badgeClass = request.status === "customer_responded" ? "badge" : request.status === "expired" || request.status === "revoked" ? "badge error" : "badge warn";
      actions.append(el("span", badgeClass, request.status || "-"));
      const copy = el("button", "btn-outline", "Copy Link");
      copy.type = "button";
      copy.disabled = !request.publicUrl;
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(request.publicUrl || "");
        toast("success", "Secure link copied.");
      });
      actions.append(copy);
      if (!["completed", "revoked", "expired"].includes(request.status)) {
        const complete = el("button", "btn-soft", "Complete");
        complete.type = "button";
        complete.addEventListener("click", () => requestAction(request.requestId, "complete"));
        actions.append(complete);
        const revoke = el("button", "btn-danger", "Revoke");
        revoke.type = "button";
        revoke.addEventListener("click", () => requestAction(request.requestId, "revoke"));
        actions.append(revoke);
      }
      row.append(actions);
      return row;
    }

    async function loadSubstitutionRequests() {
      if (!state.authenticated || !els.requestsList) return;
      const params = new URLSearchParams({ page: String(state.requestsPage), limit: String(state.requestsLimit) });
      if (els.requestsSearch.value.trim()) params.set("search", els.requestsSearch.value.trim());
      if (els.requestsStatus.value) params.set("status", els.requestsStatus.value);
      try {
        const result = await api(`/api/substitution-requests?${params.toString()}`);
        clear(els.requestsList);
        if (result.warning) els.requestsList.append(el("div", "notice warn", result.warning));
        const requests = result.requests || [];
        if (!requests.length) {
          els.requestsList.append(el("div", "empty", "No substitution requests matched this view."));
        } else {
          requests.forEach((request) => els.requestsList.append(requestRow(request)));
        }
        els.requestsPager.textContent = `Page ${result.page || 1} of ${result.totalPages || 1} - ${result.total || 0} request${result.total === 1 ? "" : "s"}`;
      } catch (error) {
        clear(els.requestsList);
        els.requestsList.append(el("div", "notice error", error.message));
      }
    }

    async function requestAction(requestId, action) {
      try {
        await api(`/api/substitution-requests/${encodeURIComponent(requestId)}/${action}`, { method: "POST", body: JSON.stringify({ sendConfirmed: action === "resend" }) });
        toast("success", "Request updated.");
        await loadSubstitutionRequests();
      } catch (error) {
        toast("error", error.message);
      }
    }

    function responseTokenFromPath() {
      const match = window.location.pathname.match(/^\/respond\/([^/]+)$/);
      return match ? decodeURIComponent(match[1]) : "";
    }

    function customerChoiceLabel(choice) {
      if (!choice) return "No choice selected";
      if (choice.type === "refund") return "Refund this item";
      if (choice.type === "store_choice") return "Let the store choose";
      if (choice.type === "contact") return "Please contact me";
      return `${choice.productTitle || "Selected substitute"}${choice.priceDifference ? ` · ${choice.priceDifference > 0 ? "more" : "less"}` : ""}`;
    }

    function renderSubmittedSummary(request) {
      clear(els.respondContent);
      els.respondIntro.textContent = `Thanks${request.customerFirstName ? `, ${request.customerFirstName}` : ""}. We received your choices for ${request.maskedOrderReference}.`;
      const card = el("article", "card");
      const pad = el("div", "card-pad");
      pad.append(el("h2", "", "Submitted Choices"));
      const summary = el("div", "review-summary");
      (request.items || []).forEach((item) => {
        summary.append(el("div", "", `${item.originalTitle}: ${customerChoiceLabel(item.customerChoice)}`));
      });
      pad.append(summary);
      pad.append(el("p", "notice", "Thank you - we've received your choices. Our team will review them before updating your order."));
      card.append(pad);
      els.respondContent.append(card);
    }

    function renderCustomerResponse(request) {
      clear(els.respondContent);
      els.respondIntro.textContent = `${request.customerFirstName ? `${request.customerFirstName}, please choose` : "Please choose"} for ${request.maskedOrderReference}.`;
      if (["expired", "revoked", "completed"].includes(request.status)) {
        els.respondContent.append(el("div", "notice error", request.status === "expired" ? "This request has expired." : request.status === "revoked" ? "This request is no longer active." : "This request has already been completed by our team."));
        return;
      }
      if (request.submittedAt) {
        renderSubmittedSummary(request);
        return;
      }
      (request.items || []).forEach((item, index) => {
        const card = el("article", "card");
        const pad = el("div", "card-pad customer-response-card");
        pad.append(el("h2", "", item.originalTitle));
        pad.append(el("p", "fine", `Ordered quantity: ${item.quantity}. ${item.staffNote || request.staffNote || ""}`));
        (item.substituteOptions || []).forEach((option) => {
          const label = el("label", "choice-card");
          label.append(Object.assign(el("input"), { type: "radio", name: `choice-${item.requestItemId}`, value: `substitute:${option.optionId}` }));
          label.append(productImage(option.imageUrl, option.productTitle));
          const text = el("span");
          text.append(el("strong", "", option.productTitle));
          text.append(el("span", "product-meta", `${option.variantTitle || "Default"} · ${option.price || ""} · ${priceDiffLabel(item.originalPrice, option.price)}`));
          label.append(text);
          pad.append(label);
        });
        [
          ["store_choice", "Let the store choose a similar substitute"],
          ["refund", "Refund this item"],
          ["contact", "Please contact me before making a change"]
        ].forEach(([value, text]) => {
          const label = el("label", "choice-card no-image");
          label.append(Object.assign(el("input"), { type: "radio", name: `choice-${item.requestItemId}`, value }));
          label.append(el("strong", "", text));
          pad.append(label);
        });
        card.append(pad);
        els.respondContent.append(card);
      });
      const review = el("div", "review-summary");
      review.id = "responseReview";
      review.textContent = "Choose one option for each item, then confirm.";
      els.respondContent.append(review);
      const notice = el("div", "notice", "Your choice will be reviewed by our team. Any price difference will be confirmed before your order is updated.");
      els.respondContent.append(notice);
      const confirm = el("button", "btn-primary", "Confirm My Choices");
      confirm.type = "button";
      confirm.addEventListener("click", () => submitCustomerResponse(request));
      els.respondContent.append(confirm);
      document.querySelectorAll("input[type='radio']").forEach((radio) => radio.addEventListener("change", () => updateResponseReview(request)));
    }

    function selectedCustomerChoices(request) {
      return (request.items || []).map((item) => {
        const selected = document.querySelector(`input[name="choice-${CSS.escape(item.requestItemId)}"]:checked`);
        if (!selected) return null;
        const value = selected.value;
        if (value.startsWith("substitute:")) return { requestItemId: item.requestItemId, type: "substitute", optionId: value.replace("substitute:", "") };
        return { requestItemId: item.requestItemId, type: value };
      });
    }

    function updateResponseReview(request) {
      const summary = document.getElementById("responseReview");
      if (!summary) return;
      const choices = selectedCustomerChoices(request);
      if (choices.some((choice) => !choice)) {
        summary.textContent = "Choose one option for each item, then confirm.";
        return;
      }
      clear(summary);
      choices.forEach((choice) => {
        const item = request.items.find((entry) => entry.requestItemId === choice.requestItemId);
        const option = item?.substituteOptions?.find((entry) => entry.optionId === choice.optionId);
        summary.append(el("div", "", `${item?.originalTitle || "Item"}: ${choice.type === "substitute" ? option?.productTitle : choice.type.replace("_", " ")}`));
      });
    }

    async function loadCustomerResponse() {
      const token = responseTokenFromPath();
      document.querySelector(".layout").style.display = "block";
      document.querySelector(".sidebar").classList.add("hidden");
      document.querySelector(".topbar").classList.add("hidden");
      if (!token) {
        els.respondIntro.textContent = "This link is invalid.";
        return;
      }
      try {
        const result = await api(`/api/public/substitution-request?token=${encodeURIComponent(token)}`);
        state.customerRequest = result.request;
        renderCustomerResponse(result.request);
      } catch (error) {
        clear(els.respondContent);
        els.respondIntro.textContent = "This request is not available.";
        els.respondContent.append(el("div", "notice error", error.message || "Please contact Welkom USA for help."));
      }
    }

    async function submitCustomerResponse(request) {
      const choices = selectedCustomerChoices(request);
      if (choices.some((choice) => !choice)) return toast("error", "Please choose one option for each item.");
      try {
        const result = await api("/api/public/substitution-response", {
          method: "POST",
          body: JSON.stringify({ token: responseTokenFromPath(), choices })
        });
        renderSubmittedSummary(result.request);
      } catch (error) {
        toast("error", error.message);
      }
    }

    async function loadSentMessages() {
      if (!state.authenticated) {
        clear(els.sentHistoryList);
        els.sentHistoryList.append(el("div", "notice warn", "Log in to view sent messages."));
        els.historyPager.textContent = "";
        return;
      }
      const params = new URLSearchParams({
        page: String(state.historyPage),
        limit: String(state.historyLimit)
      });
      if (els.historySearch.value.trim()) params.set("search", els.historySearch.value.trim());
      if (els.historyStatus.value) params.set("status", els.historyStatus.value);
      if (els.historyDryRun.value) params.set("dryRun", els.historyDryRun.value);
      try {
        const result = await api(`/api/message-history?${params.toString()}`);
        renderSentMessages(result);
      } catch (error) {
        clear(els.sentHistoryList);
        els.sentHistoryList.append(el("div", "notice error", error.message));
      }
    }

    function renderSentMessages(result) {
      clear(els.sentHistoryList);
      if (result.warning) {
        els.sentHistoryList.append(el("div", "notice warn", result.warning));
      }
      const records = result.records || [];
      if (!records.length) {
        els.sentHistoryList.append(el("div", "empty", result.warning ? "No sent messages are available yet." : "No messages matched this view."));
      } else {
        records.forEach((record) => els.sentHistoryList.append(messageRecordRow(record)));
      }
      els.historyPager.textContent = `Page ${result.page || 1} of ${result.totalPages || 1} - ${result.total || 0} record${result.total === 1 ? "" : "s"}`;
    }

    async function loadTemplates() {
      if (!state.authenticated) {
        clear(els.templateList);
        els.templateList.append(el("div", "notice warn", "Log in to manage templates."));
        return;
      }
      try {
        const result = await api("/api/templates");
        state.templates = result.templates || [];
        if (result.warning) toast("error", result.warning);
        renderTemplates();
        if (!state.selectedTemplate && state.templates[0]) selectTemplate(state.templates[0]);
      } catch (error) {
        clear(els.templateList);
        els.templateList.append(el("div", "notice error", `${error.message}${error.code ? ` (${error.code})` : ""}`));
        els.templateList.append(el("div", "notice warn", "Open Settings and use Initialize Blob Stores. If that says initialization is disabled, temporarily set BLOB_INIT_ENABLED=true in Netlify and redeploy."));
      }
    }

    function renderTemplates() {
      clear(els.templateList);
      if (!state.templates.length) {
        els.templateList.append(el("div", "empty", "No active templates. Save the approved wording to create one."));
        return;
      }
      state.templates.forEach((template) => {
        const row = el("button", "template-row");
        row.type = "button";
        const main = el("span");
        main.append(el("strong", "", template.name));
        main.append(el("p", "", template.body));
        row.append(main);
        row.append(el("span", "badge", "Active"));
        row.addEventListener("click", () => selectTemplate(template));
        els.templateList.append(row);
      });
    }

    function selectTemplate(template) {
      state.selectedTemplate = template;
      els.templateName.value = template.name || "";
      els.templateBody.value = template.body || TEMPLATE;
      updateTemplatePreview();
    }

    function updateTemplatePreview() {
      const text = els.templateBody.value || TEMPLATE;
      const estimate = smsEstimate(text);
      els.templateCounter.textContent = `${estimate.length} / 320 - ${estimate.segments} segment${estimate.segments === 1 ? "" : "s"} - ${estimate.encoding}`;
      els.templatePreview.textContent = text;
    }

    async function saveTemplate() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      try {
        const result = await api("/api/templates", {
          method: "POST",
          body: JSON.stringify({
            id: state.selectedTemplate?.id,
            name: els.templateName.value,
            body: els.templateBody.value
          })
        });
        state.selectedTemplate = result.template;
        toast("success", "Template saved.");
        await loadTemplates();
      } catch (error) {
        toast("error", error.message);
      }
    }

    function duplicateTemplate() {
      const source = state.selectedTemplate || { name: "Substitution approval", body: TEMPLATE };
      state.selectedTemplate = null;
      els.templateName.value = `${source.name} copy`;
      els.templateBody.value = source.body;
      updateTemplatePreview();
      toast("success", "Template copied into a new draft.");
    }

    async function archiveSelectedTemplate() {
      if (!state.selectedTemplate?.id) return toast("error", "Select a saved template first.");
      try {
        await api(`/api/templates/${encodeURIComponent(state.selectedTemplate.id)}/archive`, { method: "POST" });
        toast("success", "Template archived.");
        state.selectedTemplate = null;
        els.templateName.value = "";
        els.templateBody.value = TEMPLATE;
        updateTemplatePreview();
        await loadTemplates();
      } catch (error) {
        toast("error", error.message);
      }
    }

    async function loadSettings() {
      if (!state.authenticated) {
        renderStatusGrid(els.settingsStatus, [["Session", "Log in first", statusBadge(false, "Active", "Logged out")]]);
        clear(els.diagnosticsList);
        els.initializeBlobsButton.disabled = true;
        els.restoreTemplateButton.disabled = true;
        return;
      }
      els.initializeBlobsButton.disabled = false;
      els.restoreTemplateButton.disabled = false;
      try {
        const result = await api("/api/dashboard");
        renderSafeStatus(els.settingsStatus, result.status || {});
        if (result.warning) setSettingsActionStatus("warn", result.warning);
        await loadConfigDiagnostics();
      } catch (error) {
        clear(els.settingsStatus);
        els.settingsStatus.append(el("div", "notice error", `${error.message}${error.code ? ` (${error.code})` : ""}`));
        setSettingsActionStatus("error", "Status could not be loaded. Check that you are logged in, then try Initialize Blob Stores if storage is the failing area.");
      }
    }

    async function loadConfigDiagnostics() {
      clear(els.diagnosticsList);
      try {
        const result = await api("/api/config-diagnostics");
        const checks = result.diagnostics?.checks || [];
        if (!checks.length) return;
        checks.forEach((check) => {
          const row = el("div", "message-row");
          const main = el("div");
          main.append(el("strong", "", check.name));
          main.append(el("p", "", check.ok ? "Looks configured." : check.guidance || "Needs attention."));
          row.append(main);
          row.append(el("span", check.ok ? "badge" : "badge error", check.ok ? "OK" : "Fix"));
          els.diagnosticsList.append(row);
        });
      } catch (error) {
        els.diagnosticsList.append(el("div", "notice warn", `Diagnostics could not load: ${error.message}`));
      }
    }

    function setSettingsActionStatus(type, message) {
      els.settingsActionsStatus.className = `notice ${type === "error" ? "error" : type === "warn" ? "warn" : ""}`.trim();
      els.settingsActionsStatus.textContent = message;
      els.settingsActionsStatus.classList.remove("hidden");
    }

    async function initializeBlobStores() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      els.initializeBlobsButton.disabled = true;
      setSettingsActionStatus("warn", "Initializing Blob stores...");
      try {
        const result = await api("/api/admin/init-blobs", { method: "POST" });
        setSettingsActionStatus("success", `Blob stores checked: ${Object.values(result.stores || {}).join(", ")}.`);
        await loadSettings();
        await loadTemplates();
      } catch (error) {
        const guidance = error.code === "BLOB_INIT_DISABLED"
          ? "Blob initialization is disabled. Temporarily set BLOB_INIT_ENABLED=true in Netlify environment variables, redeploy, then click this button again. Set it back to false afterwards."
          : `${error.message}${error.code ? ` (${error.code})` : ""}`;
        setSettingsActionStatus("error", guidance);
      } finally {
        els.initializeBlobsButton.disabled = false;
      }
    }

    async function restoreDefaultTemplate() {
      if (!state.authenticated) return toast("error", "Please log in first.");
      els.restoreTemplateButton.disabled = true;
      setSettingsActionStatus("warn", "Restoring the default substitution template...");
      try {
        await api("/api/templates", {
          method: "POST",
          body: JSON.stringify({
            id: "default-substitution",
            name: "Default substitution",
            body: TEMPLATE,
            isDefault: true
          })
        });
        setSettingsActionStatus("success", "Default template is saved.");
        await loadTemplates();
      } catch (error) {
        setSettingsActionStatus("error", `${error.message}${error.code ? ` (${error.code})` : ""}`);
      } finally {
        els.restoreTemplateButton.disabled = false;
      }
    }

    async function exportBackup(kind) {
      if (!state.authenticated) return toast("error", "Please log in first.");
      const path = kind === "csv" ? "/api/backup/messages.csv" : "/api/backup.json";
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Export failed.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = el("a");
        link.href = url;
        link.download = kind === "csv" ? "welkom-sms-messages.csv" : "welkom-sms-backup.json";
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast("success", "Backup export downloaded.");
      } catch (error) {
        toast("error", error.message);
      }
    }

    function renderHistory(records) {
      clear(els.historyList);
      if (!records.length) {
        els.historyList.append(el("div", "empty", "Persistent sent and dry-run message history will appear here."));
        return;
      }
      records.forEach((item) => {
        const row = el("div", "history-item");
        row.append(el("strong", "", `${item.orderName} · ${item.latestTwilioStatus || item.initialTwilioStatus}`));
        row.append(el("span", "", `${new Date(item.createdAt).toLocaleString()} · ${item.customerPhoneRedacted || ""} · ${item.staffIdentity || ""}`));
        els.historyList.append(row);
      });
    }

    function scrollToHistory() {
      navigate("sent");
    }

    function toggleDrawer(open) {
      els.sidebar.classList.toggle("open", open);
      els.drawerBackdrop.classList.toggle("open", open);
    }

    els.loginButton.addEventListener("click", login);
    els.logoutButton.addEventListener("click", logout);
    els.username.addEventListener("keydown", (event) => {
      if (event.key === "Enter") login();
    });
    els.password.addEventListener("keydown", (event) => {
      if (event.key === "Enter") login();
    });
    els.searchButton.addEventListener("click", searchOrder);
    els.orderQuery.addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchOrder();
    });
    els.subSearchButton.addEventListener("click", searchSubstitutions);
    els.subSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchSubstitutions();
    });
    els.customSubButton.addEventListener("click", addCustomSubstitute);
    els.addRequestOptionButton.addEventListener("click", addApprovedRequestOption);
    els.clearRequestButton.addEventListener("click", clearRequestBuilder);
    els.sendRequestButton.addEventListener("click", sendCustomerRequest);
    els.requestStaffNote.addEventListener("input", renderRequestBuilder);
    els.requestExpiry.addEventListener("change", renderRequestBuilder);
    els.manualMode.addEventListener("change", toggleManualMode);
    [els.manualPhone, els.manualFirstName, els.manualUnavailable, els.manualSubstitute, els.manualReference, els.manualConsent].forEach((node) => {
      node.addEventListener("input", () => {
        state.authorizedResend = false;
        if (isManualMode()) updateMessageState();
      });
      node.addEventListener("change", () => {
        state.authorizedResend = false;
        if (isManualMode()) updateMessageState();
      });
    });
    els.message.addEventListener("input", () => {
      state.authorizedResend = false;
      updateMessageState();
    });
    els.copyButton.addEventListener("click", copyMessage);
    els.sendButton.addEventListener("click", openConfirmModal);
    els.cancelSendButton.addEventListener("click", closeConfirmModal);
    els.confirmSendButton.addEventListener("click", sendSms);
    els.modalBackdrop.addEventListener("click", (event) => {
      if (event.target === els.modalBackdrop) closeConfirmModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.modalBackdrop.classList.contains("open")) closeConfirmModal();
      if (event.key === "Tab" && els.modalBackdrop.classList.contains("open")) {
        const focusable = [els.cancelSendButton, els.confirmSendButton];
        const index = focusable.indexOf(document.activeElement);
        if (event.shiftKey && index === 0) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && index === focusable.length - 1) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    });
    els.templateButton.addEventListener("click", () => {
      if (isManualMode()) {
        fillTemplate();
        toast("success", "Manual template applied.");
        return;
      }
      const missing = [];
      if (!state.order) missing.push("load an order");
      if (!state.unavailableItem) missing.push("select the item to replace");
      if (!state.substituteItem) missing.push("select a substitute item");
      if (missing.length) {
        toast("error", `To use the template, first ${missing.join(", ")}.`);
        return;
      }
      fillTemplate();
      toast("success", "Template applied.");
    });
    els.clearHistoryButton.addEventListener("click", () => toast("success", "History is persistent. Use storage admin tools to remove records."));
    els.searchNav.addEventListener("click", () => navigate("search"));
    els.dashboardNav.addEventListener("click", () => navigate("dashboard"));
    els.historyShortcut.addEventListener("click", scrollToHistory);
    els.historyNav.addEventListener("click", () => navigate("sent"));
    els.requestsNav.addEventListener("click", () => navigate("requests"));
    els.templatesNav.addEventListener("click", () => navigate("templates"));
    els.settingsNav.addEventListener("click", () => navigate("settings"));
    els.backupNav.addEventListener("click", () => navigate("backup"));
    els.dashboardRefresh.addEventListener("click", loadDashboard);
    els.historyRefreshButton.addEventListener("click", loadSentMessages);
    els.historyResetButton.addEventListener("click", () => {
      els.historySearch.value = "";
      els.historyStatus.value = "";
      els.historyDryRun.value = "";
      state.historyPage = 1;
      loadSentMessages();
    });
    els.historySearch.addEventListener("input", () => {
      state.historyPage = 1;
      window.clearTimeout(state.historyTimer);
      state.historyTimer = window.setTimeout(loadSentMessages, 250);
    });
    els.historyStatus.addEventListener("change", () => {
      state.historyPage = 1;
      loadSentMessages();
    });
    els.historyDryRun.addEventListener("change", () => {
      state.historyPage = 1;
      loadSentMessages();
    });
    els.requestsRefreshButton.addEventListener("click", loadSubstitutionRequests);
    els.requestsResetButton.addEventListener("click", () => {
      els.requestsSearch.value = "";
      els.requestsStatus.value = "";
      state.requestsPage = 1;
      loadSubstitutionRequests();
    });
    els.requestsSearch.addEventListener("input", () => {
      state.requestsPage = 1;
      window.clearTimeout(state.requestsTimer);
      state.requestsTimer = window.setTimeout(loadSubstitutionRequests, 250);
    });
    els.requestsStatus.addEventListener("change", () => {
      state.requestsPage = 1;
      loadSubstitutionRequests();
    });
    els.templateBody.addEventListener("input", updateTemplatePreview);
    els.templateName.addEventListener("input", () => {
      if (!els.templateBody.value.trim()) {
        els.templateBody.value = TEMPLATE;
        updateTemplatePreview();
      }
    });
    els.saveTemplateButton.addEventListener("click", saveTemplate);
    els.duplicateTemplateButton.addEventListener("click", duplicateTemplate);
    els.archiveTemplateButton.addEventListener("click", archiveSelectedTemplate);
    els.testConnectionsButton.addEventListener("click", loadSettings);
    els.initializeBlobsButton.addEventListener("click", initializeBlobStores);
    els.restoreTemplateButton.addEventListener("click", restoreDefaultTemplate);
    els.exportJsonButton.addEventListener("click", () => exportBackup("json"));
    els.exportCsvButton.addEventListener("click", () => exportBackup("csv"));
    els.sidebarLogoutButton.addEventListener("click", () => {
      logout();
      toggleDrawer(false);
    });
    els.menuButton.addEventListener("click", () => toggleDrawer(true));
    els.drawerBackdrop.addEventListener("click", () => toggleDrawer(false));
    document.querySelectorAll(".token").forEach((button) => {
      button.addEventListener("click", () => insertToken(button.dataset.token));
    });

    setEmptyOrder();
    setAuth(false);
    updateMessageState();
    updateTemplatePreview();
    window.addEventListener("popstate", () => navigate(pageFromPath(window.location.pathname), false));
    navigate(pageFromPath(window.location.pathname), false);
    checkSession();
