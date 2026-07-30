(() => {
  "use strict";

  const TEMPLATE = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";
  const MULTI_TEMPLATE = "Welkom USA: Hi [FIRST NAME], the following item(s) in order #[ORDER NUMBER] are unavailable:\n\n[REPLACEMENTS]\n\nReply with your choice or contact Welkom USA for assistance. Reply STOP to opt out.";
  const GSM_7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
  const GSM_7_EXTENDED = "^{}\\[~]|€";

  const els = {
    appStatus: document.getElementById("appStatus"),
    staffHeader: document.getElementById("staffHeader"),
    staffGreeting: document.getElementById("staffGreeting"),
    staffAvatar: document.getElementById("staffAvatar"),
    quickNav: document.getElementById("quickNav"),
    logoutButton: document.getElementById("logoutButton"),
    main: document.getElementById("main"),
    dialogLayer: document.getElementById("dialogLayer"),
    dialogTitle: document.getElementById("dialogTitle"),
    dialogBody: document.getElementById("dialogBody"),
    dialogCancel: document.getElementById("dialogCancel"),
    dialogConfirm: document.getElementById("dialogConfirm"),
    toastStack: document.getElementById("toastStack")
  };

  const state = {
    auth: null,
    csrfToken: "",
    route: "/login",
    busy: false,
    templates: [],
    replies: [],
    history: [],
    config: {},
    substitution: emptySubstitutionState(),
    custom: emptyCustomState()
  };

  const errorMessages = {
    AUTH_REQUIRED: "Your session has expired. Please log in again.",
    RATE_LIMITED: "Too many unsuccessful login attempts. Wait 15 minutes and try again.",
    SHOPIFY_ERROR: "Shopify could not be reached. Wait a moment and try the search again.",
    ORDER_NOT_FOUND: "No Shopify order was found for that order number. Check the number and try again.",
    PHONE_INVALID: "Enter a valid customer phone number, including the country code.",
    SMS_CONSENT_MISSING: "SMS consent is not recorded for this order. A message cannot be sent from the order workflow.",
    PHONE_MISSING: "This order does not contain a customer phone number. Enter an approved number manually.",
    RECIPIENT_OPTED_OUT: "This customer has opted out of SMS messages. No message can be sent.",
    DUPLICATE_MESSAGE: "A similar message was already sent for this order. Confirm an authorised resend to continue.",
    TWILIO_ERROR: "SMS sending has not been configured or Twilio could not send the message.",
    MESSAGE_EMPTY: "The message cannot be empty.",
    MESSAGE_TOO_LONG: "This message is too long to send. Shorten it and try again."
  };

  const routes = {
    "/login": { title: "Staff Login", access: "public", render: renderLogin },
    "/menu": { title: "Main Menu", access: "staff", render: renderStaffMenu },
    "/substitution": { title: "Send Substitution SMS", access: "staff", render: () => renderSubstitution("order") },
    "/substitution/order": { title: "Find Customer", access: "staff", render: () => renderSubstitution("order") },
    "/substitution/items": { title: "Choose Items", access: "staff", render: () => renderSubstitution("items") },
    "/substitution/message": { title: "Review Message", access: "staff", render: () => renderSubstitution("message") },
    "/replies": { title: "View Replies", access: "staff", render: renderReplies },
    "/history": { title: "Message History", access: "staff", render: renderHistory },
    "/custom-message": { title: "Custom Message", access: "staff", render: renderCustomMessage },
    "/respond": { title: "Customer Response", access: "public", render: renderCustomerResponse },
    "/admin/dashboard": { title: "Admin Overview", access: "admin", render: renderAdminDashboard },
    "/admin/templates": { title: "Templates", access: "admin", render: renderAdminTemplates },
    "/admin/settings": { title: "Settings", access: "admin", render: renderAdminSettings },
    "/admin/users": { title: "User Management", access: "admin", render: renderAdminUsers },
    "/admin/backup": { title: "Backup", access: "admin", render: renderAdminBackup },
    "/admin/diagnostics": { title: "Diagnostics", access: "admin", render: renderAdminSettings }
  };

  function emptySubstitutionState() {
    return {
      mode: "order",
      step: "order",
      orderQuery: "",
      order: null,
      manual: {
        phone: "",
        firstName: "",
        reference: "",
        consentConfirmed: false
      },
      replacements: [],
      message: "",
      includeStaffCopy: false,
      authorizedResend: false,
      lastSendResult: null
    };
  }

  function emptyCustomState() {
    return {
      mode: "manual",
      orderQuery: "",
      order: null,
      phone: "",
      firstName: "",
      reference: "",
      consentConfirmed: false,
      message: "",
      includeStaffCopy: false,
      authorizedResend: false
    };
  }

  function h(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === false || value === null || value === undefined) return;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "htmlFor") node.htmlFor = value;
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function appendSafe(parent, children) {
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child === null || child === undefined) return;
      parent.append(child);
    });
    return parent;
  }

  function icon(name, attrs = {}) {
    const paths = {
      package: [
        ["path", { d: "m7.5 4.3 4.5 2.6 4.5-2.6" }],
        ["path", { d: "M3.5 7.2 12 12l8.5-4.8" }],
        ["path", { d: "M12 22V12" }],
        ["path", { d: "M20.5 7.2v9.6L12 22l-8.5-5.2V7.2L12 2z" }]
      ],
      user: [
        ["path", { d: "M20 21a8 8 0 0 0-16 0" }],
        ["circle", { cx: "12", cy: "7", r: "4" }]
      ],
      lock: [
        ["rect", { x: "4", y: "11", width: "16", height: "10", rx: "2" }],
        ["path", { d: "M8 11V7a4 4 0 0 1 8 0v4" }]
      ],
      eye: [
        ["path", { d: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" }],
        ["circle", { cx: "12", cy: "12", r: "3" }]
      ],
      eyeOff: [
        ["path", { d: "M3 3l18 18" }],
        ["path", { d: "M10.6 10.6a3 3 0 0 0 4.2 4.2" }],
        ["path", { d: "M9.9 4.2A10.5 10.5 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.1 4.4" }],
        ["path", { d: "M6.6 6.6C3.7 8.5 2 12 2 12s3.5 8 10 8a10.8 10.8 0 0 0 4.4-.9" }]
      ],
      alert: [
        ["circle", { cx: "12", cy: "12", r: "10" }],
        ["path", { d: "M12 8v5" }],
        ["path", { d: "M12 16h.01" }]
      ],
      messageSquare: [
        ["path", { d: "M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" }]
      ],
      inbox: [
        ["path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }],
        ["path", { d: "M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z" }]
      ],
      history: [
        ["path", { d: "M3 12a9 9 0 1 0 3-6.7" }],
        ["path", { d: "M3 3v6h6" }],
        ["path", { d: "M12 7v5l3 2" }]
      ],
      penLine: [
        ["path", { d: "M12 20h9" }],
        ["path", { d: "M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" }]
      ],
      chevronRight: [
        ["path", { d: "m9 18 6-6-6-6" }]
      ]
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      ...attrs
    }).forEach(([key, value]) => svg.setAttribute(key, value));
    (paths[name] || []).forEach(([tag, shapeAttrs]) => {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(shapeAttrs).forEach(([key, value]) => node.setAttribute(key, value));
      svg.append(node);
    });
    return svg;
  }

  function page(title, intro, body, actions = null) {
    return h("section", { class: "page" }, [
      h("div", { class: "page-heading" }, [
        h("div", {}, [h("h1", { text: title }), intro ? h("p", { text: intro }) : null]),
        actions
      ]),
      ...(Array.isArray(body) ? body : [body])
    ]);
  }

  function card(title, body, attrs = {}) {
    return h("article", { class: `card ${attrs.class || ""}`.trim() }, [
      title ? h("div", { class: "card-title" }, [h("h2", { text: title }), attrs.meta ? h("span", { class: "muted", text: attrs.meta }) : null]) : null,
      ...(Array.isArray(body) ? body : [body])
    ]);
  }

  function field(label, input, message = "") {
    const id = input.getAttribute("id") || `field_${Math.random().toString(16).slice(2)}`;
    input.id = id;
    return h("div", { class: "field" }, [
      h("label", { htmlFor: id, text: label }),
      input,
      message ? h("p", { class: "field-error", text: message }) : null
    ]);
  }

  function button(label, className, onClick, attrs = {}) {
    return h("button", { type: "button", class: `btn ${className || "secondary"}`, onClick, ...attrs }, label);
  }

  function input(type, value, onInput, attrs = {}) {
    return h("input", {
      type,
      value: value || "",
      onInput: (event) => onInput?.(event.target.value, event),
      ...attrs
    });
  }

  function textarea(value, onInput, attrs = {}) {
    const node = h("textarea", { onInput: (event) => onInput?.(event.target.value, event), ...attrs });
    node.value = value || "";
    return node;
  }

  function select(value, options, onChange, attrs = {}) {
    const node = h("select", { onChange: (event) => onChange?.(event.target.value, event), ...attrs });
    options.forEach(([optionValue, label]) => {
      node.append(h("option", { value: optionValue, text: label }));
    });
    node.value = value || "";
    return node;
  }

  function toast(type, message) {
    const node = h("div", { class: `toast ${type}`, text: message });
    els.toastStack.append(node);
    setTimeout(() => node.remove(), 5000);
  }

  function messageFor(error) {
    if (!error) return "Request failed.";
    if (error.code && errorMessages[error.code]) return errorMessages[error.code];
    if (error.status === 401) return "Your session has expired. Please log in again.";
    if (error.message === "Failed to fetch") return "The app could not connect to the server. Check the connection and try again.";
    return error.message || "Request failed.";
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(state.csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method) ? { "X-CSRF-Token": state.csrfToken } : {}),
        ...(options.headers || {})
      }
    });
    const result = await response.json().catch(() => ({ success: false, error: "Invalid server response." }));
    if (!response.ok || result.success === false) {
      const error = new Error(result.error || "Request failed.");
      error.code = result.code;
      error.status = response.status;
      error.result = result;
      throw error;
    }
    return result;
  }

  function routeFromPath() {
    if (window.location.pathname.startsWith("/respond/")) return "/respond";
    return routes[window.location.pathname] ? window.location.pathname : (state.auth ? "/menu" : "/login");
  }

  function canAccess(route) {
    const config = routes[route] || routes["/menu"];
    if (config.access === "public") return true;
    if (!state.auth) return false;
    if (config.access === "admin") return state.auth.role === "admin";
    return ["staff", "admin"].includes(state.auth.role);
  }

  function go(route, push = true) {
    const target = routes[route] ? route : "/menu";
    if (!canAccess(target)) {
      route = state.auth ? "/menu" : "/login";
    } else {
      route = target;
    }
    state.route = route;
    if (push && window.location.pathname !== route && route !== "/respond") {
      window.history.pushState({ route }, "", route);
    }
    render();
  }

  function render() {
    const config = routes[state.route] || routes["/menu"];
    document.title = `${config.title} - Welkom USA SMS`;
    els.staffHeader.classList.toggle("hidden", !state.auth || state.route === "/login" || state.route === "/respond");
    const staffName = state.auth ? staffDisplayName() : "Staff";
    els.staffGreeting.textContent = state.auth ? staffName : "Staff workspace";
    if (els.staffAvatar) els.staffAvatar.textContent = initials(staffName);
    renderQuickNav();
    clear(els.main);
    els.main.append(config.render());
    els.main.focus({ preventScroll: true });
  }

  function renderQuickNav() {
    clear(els.quickNav);
  }

  async function checkSession() {
    try {
      const result = await api("/.netlify/functions/auth-me");
      state.auth = result.user;
      state.csrfToken = result.csrfToken || "";
      state.config = result.config || {};
      go(routeFromPath(), false);
    } catch (error) {
      state.auth = null;
      state.csrfToken = "";
      state.config = {};
      go(window.location.pathname.startsWith("/respond/") ? "/respond" : "/login", false);
    } finally {
      document.body.classList.remove("auth-pending");
      els.appStatus.classList.add("hidden");
    }
  }

  function renderLogin() {
    let username = "";
    let password = "";
    let rememberMe = false;
    let showPassword = false;
    let generalError = "";
    let usernameError = "";
    let passwordError = "";
    let loading = false;

    const form = h("form", { class: "login-card" });
    const draw = () => {
      clear(form);
      const usernameId = "loginUsername";
      const passwordId = "loginPassword";
      const passwordToggle = button("", "login-eye", () => { showPassword = !showPassword; draw(); }, {
        "aria-label": showPassword ? "Hide password" : "Show password"
      });
      passwordToggle.append(icon(showPassword ? "eyeOff" : "eye", { class: "login-eye-icon" }));
      appendSafe(form, [
        h("div", { class: "login-brand" }, [
          icon("package", { class: "login-brand-icon" }),
          h("strong", { text: "Welkom USA SMS" })
        ]),
        h("h1", { text: "Staff Login" }),
        h("p", { class: "login-subtitle", text: "Sign in to send substitution messages and review replies." }),
        generalError ? h("div", { class: "login-error-banner", role: "alert" }, [
          icon("alert", { class: "login-error-icon" }),
          h("span", { text: generalError })
        ]) : null,
        h("div", { class: "login-field" }, [
          h("label", { htmlFor: usernameId, text: "Username or Staff ID" }),
          h("div", { class: `login-input-wrap ${usernameError ? "invalid" : ""}` }, [
            icon("user", { class: "login-input-icon" }),
            input("text", username, (value) => {
              username = value;
              usernameError = "";
              generalError = "";
            }, {
              id: usernameId,
              autocomplete: "username",
              autofocus: "",
              placeholder: "Enter username",
              "aria-invalid": usernameError ? "true" : "false",
              "aria-describedby": usernameError ? "usernameError" : ""
            })
          ]),
          usernameError ? h("p", { id: "usernameError", class: "login-field-error", text: usernameError }) : null
        ]),
        h("div", { class: "login-field" }, [
          h("label", { htmlFor: passwordId, text: "Password" }),
          h("div", { class: `login-input-wrap ${passwordError ? "invalid" : ""}` }, [
            icon("lock", { class: "login-input-icon" }),
            input(showPassword ? "text" : "password", password, (value) => {
              password = value;
              passwordError = "";
              generalError = "";
            }, {
              id: passwordId,
              autocomplete: "current-password",
              placeholder: "Enter password",
              "aria-invalid": passwordError ? "true" : "false",
              "aria-describedby": passwordError ? "passwordError" : ""
            }),
            passwordToggle
          ]),
          passwordError ? h("p", { id: "passwordError", class: "login-field-error", text: passwordError }) : null
        ]),
        h("div", { class: "remember-panel" }, [
          h("div", { class: "remember-row" }, [
            h("span", { text: "Remember me on this device" }),
            button("", `remember-switch ${rememberMe ? "on" : ""}`, () => { rememberMe = !rememberMe; draw(); }, {
              role: "switch",
              "aria-checked": rememberMe ? "true" : "false",
              "aria-label": "Remember me on this device"
            })
          ]),
          h("p", { text: "Only use on authorised warehouse devices." })
        ]),
        button("", "login-submit", submit, { disabled: loading })
      ]);
      const submitButton = form.querySelector(".login-submit");
      if (submitButton) {
        clear(submitButton);
        if (loading) submitButton.append(h("span", { class: "login-spinner" }));
        submitButton.append(document.createTextNode(loading ? "Signing in..." : "Log In"));
      }
    };
    const submit = async (event) => {
      event?.preventDefault();
      generalError = "";
      usernameError = username.trim() ? "" : "Enter your username or staff ID.";
      passwordError = password ? "" : "Enter your password.";
      if (usernameError || passwordError) return draw();
      loading = true;
      draw();
      try {
        const result = await api("/.netlify/functions/auth-login", {
          method: "POST",
          body: JSON.stringify({ username, password, rememberMe })
        });
        password = "";
        state.auth = result.user;
        state.csrfToken = result.csrfToken || "";
        state.config = result.config || {};
        go(result.user.role === "admin" ? "/admin/dashboard" : "/menu");
      } catch (error) {
        generalError = error.code === "RATE_LIMITED" ? errorMessages.RATE_LIMITED : "The username or password is incorrect.";
        if (error.message === "Failed to fetch") generalError = errorMessages.FailedFetch || "The app could not connect to the server. Check the connection and try again.";
        loading = false;
        draw();
      }
    };
    form.addEventListener("submit", submit);
    draw();
    return h("section", { class: "login-screen" }, [form]);
  }

  function renderStaffMenu() {
    const staffName = staffDisplayName();
    const tiles = [
      ["/substitution/order", "Send Substitution SMS", "Find an order, choose unavailable items and send replacement options.", "message-square"],
      ["/replies", "View Replies", "Review customer SMS replies that need attention.", "inbox"],
      ["/history", "Message History", "View sent messages and copy or resend an approved message.", "history"],
      ["/custom-message", "Custom Message", "Find a customer or enter an approved number and write a custom message.", "edit"]
    ];
    const pendingValue = h("strong", { text: "..." });
    const sentValue = h("strong", { text: "..." });
    const modeValue = h("strong", { text: state.config?.dryRun ? "Dry run" : "Live" });
    const loadStats = async () => {
      try {
        const [dashboard, replies] = await Promise.all([
          api("/api/dashboard"),
          api("/api/replies?status=unread&limit=1")
        ]);
        const pending = Number(replies.total || 0);
        pendingValue.textContent = String(pending);
        sentValue.textContent = String(dashboard.stats?.sentToday || 0);
        pendingValue.closest(".menu-stat")?.classList.toggle("urgent", pending > 0);
        document.querySelector(".menu-unread-dot")?.classList.toggle("hidden", pending <= 0);
      } catch (error) {
        pendingValue.textContent = "-";
        sentValue.textContent = "-";
        document.querySelector(".menu-unread-dot")?.classList.add("hidden");
      }
    };
    setTimeout(loadStats, 0);
    return h("section", { class: "menu-page" }, [
      h("div", { class: "menu-heading" }, [
        h("h1", { text: "Main Menu" }),
        h("p", {}, [
          document.createTextNode("Choose what you need to do today. Signed in as "),
          h("strong", { text: staffName }),
          document.createTextNode(".")
        ])
      ]),
      h("div", { class: "menu-stats" }, [
        h("div", { class: "menu-stat" }, [h("span", { text: "Pending Replies" }), pendingValue]),
        h("div", { class: "menu-stat" }, [h("span", { text: "Messages Sent Today" }), sentValue]),
        h("div", { class: "menu-stat" }, [h("span", { text: "Sending Mode" }), modeValue])
      ]),
      h("div", { class: "menu-card-list" }, tiles.map(([path, title, copy, iconName]) => menuTile(path, title, copy, iconName))),
      state.auth?.role === "admin" ? card("Administrator tools", [
        h("p", { class: "muted", text: "You can also open the administrator area for settings, templates, backups and users." }),
        button("Open Admin Overview", "secondary", () => go("/admin/dashboard"))
      ]) : null
    ]);
  }

  function menuTile(path, title, copy, iconName) {
    const normalizedIcon = iconName === "edit" ? "penLine" : iconName === "message-square" ? "messageSquare" : iconName;
    return h("a", {
      href: path,
      class: "menu-tile",
      onClick: (event) => {
        event.preventDefault();
        go(path);
      }
    }, [
      h("span", { class: "menu-tile-icon" }, [
        icon(normalizedIcon, { class: "menu-icon" }),
        path === "/replies" ? h("span", { class: "menu-unread-dot hidden", "aria-hidden": "true" }) : null
      ]),
      h("span", { class: "menu-tile-copy" }, [
        h("strong", { text: title }),
        h("span", { text: copy })
      ]),
      icon("chevronRight", { class: "menu-chevron" })
    ]);
  }

  function staffDisplayName() {
    return state.auth?.displayName || state.auth?.username || "Staff";
  }

  function initials(value) {
    const parts = String(value || "Staff").trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) || "ST").toUpperCase();
  }

  function progress(current) {
    const steps = [["order", "Find Customer"], ["items", "Choose Items"], ["message", "Review Message"]];
    return h("ol", { class: "progress" }, steps.map(([key, label], index) => h("li", { class: key === current ? "current" : steps.findIndex(([step]) => step === current) > index ? "done" : "" }, [
      h("span", { text: String(index + 1) }),
      h("strong", { text: label })
    ])));
  }

  function renderSubstitution(step) {
    state.substitution.step = step;
    return page("Send Substitution SMS", "Work through the steps. Nothing sends until you confirm on the final screen.", [
      progress(step),
      step === "order" ? renderFindCustomer() : null,
      step === "items" ? renderChooseItems() : null,
      step === "message" ? renderReviewMessage() : null
    ], button("Back to Main Menu", "secondary", () => confirmDiscard("/menu")));
  }

  function renderFindCustomer() {
    const s = state.substitution;
    const modeToggle = h("label", { class: "check-row" }, [
      input("checkbox", "", (_, event) => {
        s.mode = event.target.checked ? "manual" : "order";
        render();
      }, { checked: s.mode === "manual" }),
      h("span", { text: "Enter a phone number manually" })
    ]);
    return h("div", { class: "stack" }, [
      card("Step 1: Find Customer", [
        modeToggle,
        s.mode === "order" ? renderOrderSearch() : renderManualRecipient(),
        s.order ? renderOrderSummary(s.order) : null,
        h("div", { class: "actions" }, [
          button("Start Over", "secondary", () => confirmStartOver()),
          button("Continue", "primary", () => continueFromCustomer(), { disabled: !customerStepValid() })
        ])
      ])
    ]);
  }

  function renderOrderSearch() {
    const s = state.substitution;
    let localError = "";
    const search = async () => {
      localError = "";
      if (!s.orderQuery.trim()) {
        localError = "Enter an order number before searching.";
        render();
        return;
      }
      state.busy = true;
      render();
      try {
        const result = await api("/api/order-search", {
          method: "POST",
          body: JSON.stringify({ query: normalizeOrder(s.orderQuery) })
        });
        s.order = result.order;
        s.replacements = [];
        autoSelectZeroStockItems();
      } catch (error) {
        localError = messageFor(error);
        s.order = null;
      } finally {
        state.busy = false;
        render();
      }
    };
    return h("div", { class: "stack" }, [
      field("Order number", input("text", s.orderQuery, (value) => { s.orderQuery = value; }, { placeholder: "1023 or #1023" }), localError),
      h("div", { class: "actions" }, [button(state.busy ? "Searching..." : "Search", "primary", search, { disabled: state.busy })])
    ]);
  }

  function renderManualRecipient() {
    const m = state.substitution.manual;
    return h("div", { class: "grid two" }, [
      field("Customer phone number", input("tel", m.phone, (value) => { m.phone = value; }, { placeholder: "+12125551234" })),
      field("First name optional", input("text", m.firstName, (value) => { m.firstName = value; }, { placeholder: "Customer" })),
      field("Reference or note", input("text", m.reference, (value) => { m.reference = value; }, { placeholder: "Till slip, receipt or staff note" })),
      h("label", { class: "check-row wide" }, [
        input("checkbox", "", (_, event) => { m.consentConfirmed = event.target.checked; render(); }, { checked: m.consentConfirmed }),
        h("span", { text: "I confirm that this customer gave permission to receive this SMS." })
      ]),
      !m.phone || isE164(m.phone) ? null : h("p", { class: "field-error wide", text: "Enter a valid customer phone number, including the country code." })
    ]);
  }

  function renderOrderSummary(order) {
    return h("div", { class: "summary-grid" }, [
      card("Customer Details", details([
        ["Name", fullName(order)],
        ["Phone", order.customer?.redactedPhone || "-"],
        ["Email", order.customer?.maskedEmail || "-"],
        ["SMS Consent", order.smsConsent?.granted ? "Recorded" : "Not recorded"]
      ]), { class: order.smsConsent?.granted ? "" : "danger" }),
      card("Order Details", details([
        ["Order", order.name],
        ["Date", formatDate(order.processedAt)],
        ["Payment", order.displayFinancialStatus || "-"],
        ["Fulfillment", order.displayFulfillmentStatus || "-"],
        ["Shipping", order.shippingAddressDisplay || formatAddress(order)]
      ])),
      card("Order Items", h("div", { class: "item-list" }, (order.lineItems || []).map((item) => productRow(item, null, { plain: true }))), { class: "wide" })
    ]);
  }

  function details(rows) {
    return h("dl", { class: "details" }, rows.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value || "-" })]));
  }

  function continueFromCustomer() {
    const s = state.substitution;
    if (s.mode === "order" && s.order && !s.order.smsConsent?.granted) return toast("error", "SMS consent is not recorded for this order. A message cannot be sent from the order workflow.");
    go("/substitution/items");
  }

  function customerStepValid() {
    const s = state.substitution;
    if (s.mode === "manual") return isE164(s.manual.phone) && s.manual.reference.trim() && s.manual.consentConfirmed;
    return Boolean(s.order?.id && s.order?.smsConsent?.granted);
  }

  function renderChooseItems() {
    const s = state.substitution;
    const orderMode = s.mode === "order";
    return page("Choose Items", "Select every unavailable item and choose what staff should offer.", [
      progress("items"),
      card("Unavailable Items", orderMode ? renderOrderItemChoices() : renderManualReplacementBuilder()),
      card("Selected replacements", [
        s.replacements.length ? h("div", { class: "replacement-list" }, s.replacements.map(renderReplacementCard)) : h("div", { class: "empty", text: "Select at least one item that needs a substitution." }),
        h("div", { class: "actions" }, [
          button("Back", "secondary", () => go("/substitution/order")),
          button("Start Over", "secondary", () => confirmStartOver()),
          button("Continue", "primary", () => {
            const problem = replacementProblem();
            if (problem) return toast("error", problem);
            generateMessage();
            go("/substitution/message");
          }, { disabled: Boolean(replacementProblem()) })
        ])
      ])
    ]);
  }

  function renderOrderItemChoices() {
    const items = state.substitution.order?.lineItems || [];
    return h("div", { class: "item-list" }, items.map((item) => {
      const selected = state.substitution.replacements.find((replacement) => replacement.lineItemId === item.id);
      return h("div", { class: `choice-row ${selected ? "selected" : ""}` }, [
        productRow(item, null, { plain: true }),
        h("label", { class: "check-row" }, [
          input("checkbox", "", (_, event) => {
            if (event.target.checked) addReplacementFromItem(item);
            else removeReplacement(item.id);
            render();
          }, { checked: Boolean(selected) }),
          h("span", { text: "Needs substitution" })
        ])
      ]);
    }));
  }

  function renderManualReplacementBuilder() {
    let unavailable = "";
    let substitute = "";
    return h("div", { class: "stack" }, [
      h("div", { class: "grid two" }, [
        field("Unavailable item", input("text", unavailable, (value) => { unavailable = value; }, { placeholder: "Requested item" })),
        field("Substitute item", input("text", substitute, (value) => { substitute = value; }, { placeholder: "Replacement item or no substitute" }))
      ]),
      button("Add Another Item", "secondary", () => {
        if (!unavailable.trim()) return toast("error", "Select at least one item that needs a substitution.");
        state.substitution.replacements.push({
          lineItemId: `manual_${Date.now()}`,
          unavailableTitle: unavailable.trim(),
          customSubstituteTitle: substitute.trim(),
          noSubstitutionAvailable: !substitute.trim(),
          includeProductLink: false
        });
        render();
      })
    ]);
  }

  function addReplacementFromItem(item) {
    if (state.substitution.replacements.some((replacement) => replacement.lineItemId === item.id)) return;
    state.substitution.replacements.push({
      lineItemId: item.id,
      unavailableTitle: item.title,
      quantity: item.quantity,
      originalVariantId: item.variantId,
      originalImageUrl: item.imageUrl,
      substituteVariantId: "",
      substituteTitle: "",
      customSubstituteTitle: "",
      noSubstitutionAvailable: false,
      includeProductLink: false,
      productUrl: "",
      searchResults: [],
      searchQuery: ""
    });
  }

  function autoSelectZeroStockItems() {
    const items = state.substitution.order?.lineItems || [];
    items.filter((item) => Number.isFinite(item.inventoryQuantity) && item.inventoryQuantity <= 0).forEach(addReplacementFromItem);
  }

  function removeReplacement(lineItemId) {
    state.substitution.replacements = state.substitution.replacements.filter((replacement) => replacement.lineItemId !== lineItemId);
  }

  function renderReplacementCard(replacement) {
    let itemError = "";
    const search = async () => {
      itemError = "";
      if (!replacement.searchQuery?.trim()) {
        itemError = "Enter a product name before searching.";
        render();
        return;
      }
      state.busy = true;
      render();
      try {
        const result = await api("/api/product-search", {
          method: "POST",
          body: JSON.stringify({ query: replacement.searchQuery, excludeVariantId: replacement.originalVariantId || "" })
        });
        replacement.searchResults = result.products || [];
        if (!replacement.searchResults.length) itemError = "No matching products were found. Try another search or enter the substitute manually.";
      } catch (error) {
        itemError = messageFor(error);
      } finally {
        state.busy = false;
        render();
      }
    };
    return h("article", { class: "replacement-card" }, [
      h("div", { class: "card-title" }, [h("h3", { text: replacement.unavailableTitle }), button("Remove", "ghost", () => { removeReplacement(replacement.lineItemId); render(); })]),
      h("div", { class: "grid two" }, [
        field("Search substitute", input("search", replacement.searchQuery, (value) => { replacement.searchQuery = value; }, { placeholder: "Title, SKU or barcode" })),
        h("div", { class: "field button-field" }, [button(state.busy ? "Searching..." : "Search", "secondary", search, { disabled: state.busy })])
      ]),
      itemError ? h("p", { class: "field-error", text: itemError }) : null,
      replacement.searchResults?.length ? h("div", { class: "product-grid" }, replacement.searchResults.map((product) => productRow(product, () => {
        replacement.substituteVariantId = product.id;
        replacement.substituteTitle = product.title;
        replacement.customSubstituteTitle = "";
        replacement.noSubstitutionAvailable = false;
        render();
      }, { selected: replacement.substituteVariantId === product.id }))) : null,
      h("div", { class: "grid two" }, [
        field("Custom substitute name", input("text", replacement.customSubstituteTitle, (value) => {
          replacement.customSubstituteTitle = value;
          if (value.trim()) {
            replacement.substituteVariantId = "";
            replacement.substituteTitle = "";
            replacement.noSubstitutionAvailable = false;
          }
        }, { placeholder: "Type approved substitute" })),
        h("label", { class: "check-row field-check" }, [
          input("checkbox", "", (_, event) => {
            replacement.noSubstitutionAvailable = event.target.checked;
            if (event.target.checked) {
              replacement.substituteVariantId = "";
              replacement.substituteTitle = "";
              replacement.customSubstituteTitle = "";
            }
            render();
          }, { checked: replacement.noSubstitutionAvailable }),
          h("span", { text: "No substitution available" })
        ])
      ]),
      h("label", { class: "check-row" }, [
        input("checkbox", "", (_, event) => {
          if (event.target.checked && !replacement.substituteVariantId) {
            toast("error", "Select a Shopify substitution product before adding a product link.");
            event.target.checked = false;
            return;
          }
          replacement.includeProductLink = event.target.checked;
          replacement.productUrl = event.target.checked ? publicProductUrl(replacement.substituteVariantId) : "";
          render();
        }, { checked: replacement.includeProductLink }),
        h("span", { text: "Add product link to message" })
      ])
    ]);
  }

  function productRow(product, onClick, options = {}) {
    const row = h(onClick ? "button" : "div", { type: onClick ? "button" : undefined, class: `product-row ${options.selected ? "selected" : ""}`, onClick }, [
      product.imageUrl ? h("img", { class: "thumb", src: product.imageUrl, alt: "" }) : h("div", { class: "thumb placeholder", text: "WE" }),
      h("div", {}, [
        h("strong", { text: product.title || product.productTitle || "Product" }),
        h("span", { text: [product.variantTitle, `Qty: ${product.quantity ?? product.inventoryQuantity ?? "-"}`, product.sku ? `SKU: ${product.sku}` : "", product.barcode ? `Barcode: ${product.barcode}` : ""].filter(Boolean).join(" - ") })
      ]),
      h("span", { class: badgeClass(product), text: stockText(product) })
    ]);
    if (!onClick) row.classList.add("plain");
    return row;
  }

  function badgeClass(product) {
    if (product.availableForSale === false || product.productStatus === "ARCHIVED") return "badge error";
    if (Number.isFinite(product.inventoryQuantity) && product.inventoryQuantity <= 0) return "badge error";
    return "badge";
  }

  function stockText(product) {
    if (product.availableForSale === false) return "Unavailable";
    if (Number.isFinite(product.inventoryQuantity)) return product.inventoryQuantity <= 0 ? "Out of stock" : `${product.inventoryQuantity} available`;
    return product.price || "Available";
  }

  function replacementProblem() {
    const replacements = state.substitution.replacements;
    if (!replacements.length) return "Select at least one item that needs a substitution.";
    const missing = replacements.find((replacement) => !replacement.noSubstitutionAvailable && !replacement.substituteVariantId && !replacement.customSubstituteTitle?.trim());
    if (missing) return "Choose a substitution or select No substitution available for every unavailable item.";
    return "";
  }

  function generateMessage() {
    const s = state.substitution;
    const firstName = s.mode === "order" ? s.order?.customer?.firstName || "there" : s.manual.firstName || "there";
    const orderNumber = s.mode === "order" ? cleanOrder(s.order?.name) : s.manual.reference || "manual";
    const replacementsText = s.replacements.map((replacement, index) => {
      const decision = replacement.noSubstitutionAvailable ? "no substitute available" : `substitute: ${replacement.substituteTitle || replacement.customSubstituteTitle}`;
      return `${index + 1}. ${replacement.unavailableTitle} - ${decision}`;
    }).join("\n");
    s.message = s.replacements.length === 1 && !s.replacements[0].noSubstitutionAvailable
      ? TEMPLATE
        .replace("[FIRST NAME]", firstName)
        .replace("[UNAVAILABLE ITEM]", s.replacements[0].unavailableTitle)
        .replace("[ORDER NUMBER]", orderNumber)
        .replace("[SUBSTITUTE ITEM]", s.replacements[0].substituteTitle || s.replacements[0].customSubstituteTitle)
      : MULTI_TEMPLATE
        .replace("[FIRST NAME]", firstName)
        .replace("[ORDER NUMBER]", orderNumber)
        .replace("[REPLACEMENTS]", replacementsText);
    const links = s.replacements.filter((replacement) => replacement.includeProductLink && replacement.productUrl).map((replacement) => replacement.productUrl);
    if (links.length) s.message += `\n\nProduct links:\n${Array.from(new Set(links)).join("\n")}`;
  }

  function renderReviewMessage() {
    const s = state.substitution;
    const estimate = smsEstimate(s.message);
    const copyDisabled = !window.navigator.clipboard;
    return page("Review Message", "Read the full message before sending. You can still edit it here.", [
      progress("message"),
      card("Message details", [
        details([
          ["Recipient", s.mode === "order" ? s.order?.customer?.redactedPhone : maskPhone(s.manual.phone)],
          ["Order/reference", s.mode === "order" ? s.order?.name : s.manual.reference],
          ["Items", String(s.replacements.length)],
          ["SMS estimate", `${estimate.encoding} - ${estimate.segments} segment${estimate.segments === 1 ? "" : "s"}`]
        ]),
        h("div", { class: estimate.length > 260 ? "alert warn" : "alert subtle", text: `${estimate.length} / 320 characters` })
      ]),
      card("Editable SMS message", [
        textarea(s.message, (value) => { s.message = value; render(); }, { maxlength: "640", rows: "9" }),
        h("div", { class: "preview" }, [h("strong", { text: "Preview" }), h("p", { text: s.message || "Message preview will appear here." })]),
        h("label", { class: "check-row" }, [
          input("checkbox", "", (_, event) => { s.includeStaffCopy = event.target.checked; render(); }, { checked: s.includeStaffCopy, disabled: !staffCopyConfigured() }),
          h("span", { text: staffCopyConfigured() ? "Send me a copy" : "An administrator copy number has not been configured." })
        ]),
        s.lastSendResult ? h("div", { class: s.lastSendResult.success ? "alert success" : "alert error", text: s.lastSendResult.message || messageFor(s.lastSendResult) }) : null,
        h("div", { class: "actions" }, [
          button("Back", "secondary", () => go("/substitution/items")),
          button("Copy Message", "secondary", () => copyText(s.message), { disabled: copyDisabled }),
          button("Start Over", "secondary", () => confirmStartOver()),
          button(state.busy ? "Sending..." : "Send SMS", "primary", () => confirmSend(), { disabled: state.busy || !s.message.trim() || s.message.length > 640 })
        ])
      ])
    ]);
  }

  function confirmSend() {
    const s = state.substitution;
    const estimate = smsEstimate(s.message);
    confirmDialog("Send SMS?", `Recipient: ${s.mode === "order" ? s.order?.customer?.redactedPhone : maskPhone(s.manual.phone)}. Items: ${s.replacements.length}. Segments: ${estimate.segments}. Staff copy: ${s.includeStaffCopy ? "yes" : "no"}.`, () => sendCurrentMessage());
  }

  async function sendCurrentMessage() {
    const s = state.substitution;
    state.busy = true;
    render();
    try {
      let result;
      if (s.mode === "manual") {
        const first = s.replacements[0] || {};
        result = await api("/api/send-manual-sms", {
          method: "POST",
          body: JSON.stringify({
            phone: s.manual.phone,
            firstName: s.manual.firstName,
            reference: s.manual.reference,
            unavailableItem: first.unavailableTitle || "requested item",
            substituteItem: first.noSubstitutionAvailable ? "no substitute available" : first.substituteTitle || first.customSubstituteTitle || "a substitute item",
            message: s.message,
            consentConfirmed: s.manual.consentConfirmed,
            sendConfirmed: true,
            authorizedResend: s.authorizedResend,
            idempotencyKey: `manual:${Date.now()}:${s.manual.phone}:${s.message}`
          })
        });
      } else {
        result = await api("/api/send-replacement-sms", {
          method: "POST",
          body: JSON.stringify({
            orderId: s.order.id,
            replacements: s.replacements.map((replacement) => ({
              lineItemId: replacement.lineItemId,
              substituteVariantId: replacement.substituteVariantId || "",
              customSubstituteTitle: replacement.customSubstituteTitle || "",
              noSubstitutionAvailable: replacement.noSubstitutionAvailable === true,
              includeProductLink: replacement.includeProductLink === true
            })),
            message: s.message,
            sendConfirmed: true,
            sendStaffCopy: s.includeStaffCopy === true,
            authorizedResend: s.authorizedResend,
            idempotencyKey: `sub:${Date.now()}:${s.order.id}:${s.message}`
          })
        });
      }
      s.lastSendResult = { success: true, message: result.message || "Message sent successfully." };
      toast("success", "Message sent successfully.");
      await loadHistoryData();
    } catch (error) {
      if (error.code === "DUPLICATE_MESSAGE") s.authorizedResend = true;
      s.lastSendResult = { success: false, message: messageFor(error) };
    } finally {
      state.busy = false;
      render();
    }
  }

  function renderReplies() {
    let search = "";
    let status = "";
    const list = h("div", { class: "stack" });
    const load = async () => {
      clear(list);
      list.append(h("div", { class: "empty", text: "Loading replies..." }));
      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        if (status) params.set("status", status);
        const result = await api(`/api/replies?${params.toString()}`);
        clear(list);
        const replies = result.replies || [];
        if (result.warning) list.append(h("div", { class: "alert warn", text: result.warning }));
        if (!replies.length) list.append(h("div", { class: "empty", text: search ? "No replies match your search." : "No customer replies have been received yet." }));
        replies.forEach((reply) => list.append(replyCard(reply)));
      } catch (error) {
        clear(list);
        list.append(h("div", { class: "alert error", text: "Replies could not be refreshed. Check the connection and try again." }));
      }
    };
    setTimeout(load, 0);
    return page("View Replies", "Review customer SMS replies that need attention.", [
      card("Replies", [
        h("div", { class: "toolbar" }, [
          field("Search", input("search", search, (value) => { search = value; window.clearTimeout(state.replyTimer); state.replyTimer = window.setTimeout(load, 250); }, { placeholder: "Order, number or reply text" })),
          field("Filter", select(status, [["", "All"], ["unread", "Unread"], ["reviewed", "Reviewed"], ["unmatched", "Unmatched"]], (value) => { status = value; load(); })),
          h("div", { class: "field button-field" }, [button("Refresh", "secondary", load)])
        ]),
        list
      ])
    ]);
  }

  function replyCard(reply) {
    return h("article", { class: `message-row ${reply.read ? "" : "unread"}` }, [
      h("div", {}, [
        h("strong", { text: reply.matchedOrderName || "Unmatched reply" }),
        h("p", { text: `${reply.fromRedacted} - ${formatDateTime(reply.receivedAt)} - ${reply.preview}` }),
        reply.classification !== "ordinary" ? h("span", { class: reply.classification === "stop" ? "badge error" : "badge warn", text: reply.classification.toUpperCase() }) : null
      ]),
      h("div", { class: "row-actions" }, [
        button("Open Reply", "secondary", () => openReply(reply.replyId)),
        button("Mark Reviewed", "primary", () => markReply(reply.replyId))
      ])
    ]);
  }

  async function openReply(id) {
    try {
      const result = await api(`/api/replies/${encodeURIComponent(id)}`);
      const reply = result.reply;
      confirmDialog("Customer reply", `${reply.body || reply.preview}\n\nOrder: ${reply.matchedOrderName || "Unmatched"}\nFrom: ${reply.fromRedacted}`, () => markReply(id), "Mark reviewed");
      await api(`/api/replies/${encodeURIComponent(id)}/read`, { method: "POST", body: "{}" }).catch(() => {});
    } catch (error) {
      toast("error", "Replies could not be refreshed. Check the connection and try again.");
    }
  }

  async function markReply(id) {
    try {
      await api(`/api/replies/${encodeURIComponent(id)}/review`, { method: "POST", body: "{}" });
      toast("success", "Reply marked reviewed.");
      render();
    } catch (error) {
      toast("error", "The reply could not be marked as reviewed.");
    }
  }

  function renderHistory() {
    const list = h("div", { class: "stack" }, [h("div", { class: "empty", text: "Loading message history..." })]);
    let search = "";
    let status = "";
    const load = async () => {
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (search) params.set("search", search);
        if (status) params.set("status", status);
        const result = await api(`/api/message-history?${params.toString()}`);
        clear(list);
        const records = result.records || [];
        if (!records.length) list.append(h("div", { class: "empty", text: "No sent messages match your search." }));
        records.forEach((record) => list.append(historyRow(record)));
      } catch (error) {
        clear(list);
        list.append(h("div", { class: "alert error", text: messageFor(error) }));
      }
    };
    setTimeout(load, 0);
    return page("Message History", "View sent messages and copy approved wording.", [
      card("Sent messages", [
        h("div", { class: "toolbar" }, [
          field("Search", input("search", search, (value) => { search = value; window.clearTimeout(state.historyTimer); state.historyTimer = window.setTimeout(load, 250); })),
          field("Status", select(status, [["", "All"], ["sent", "Sent"], ["delivered", "Delivered"], ["failed", "Failed"], ["not-sent", "Dry run"]], (value) => { status = value; load(); })),
          h("div", { class: "field button-field" }, [button("Refresh", "secondary", load)])
        ]),
        list
      ])
    ]);
  }

  async function loadHistoryData() {
    const result = await api("/api/message-history?limit=50").catch(() => ({ records: [] }));
    state.history = result.records || [];
  }

  function historyRow(record) {
    return h("article", { class: "message-row" }, [
      h("div", {}, [
        h("strong", { text: `${record.orderName || "Manual"} - ${record.latestTwilioStatus || record.initialTwilioStatus}` }),
        h("p", { text: `${formatDateTime(record.createdAt)} - ${record.customerPhoneRedacted || ""} - ${record.message || ""}` })
      ]),
      h("div", { class: "row-actions" }, [
        button("View", "secondary", () => confirmDialog("Message", record.message || "No message body.", null, "Close")),
        button("Copy", "secondary", () => copyText(record.message || "")),
        button("Resend", "primary", () => loadResend(record))
      ])
    ]);
  }

  function loadResend(record) {
    toast("error", "This message cannot be resent until the order is rechecked.");
    go("/substitution/order");
  }

  function renderCustomMessage() {
    const c = state.custom;
    const estimate = smsEstimate(c.message);
    return page("Custom Message", "Use only for approved customer service messages.", [
      card("Step 1: Select Recipient", [
        h("label", { class: "check-row" }, [
          input("checkbox", "", (_, event) => { c.mode = event.target.checked ? "manual" : "order"; render(); }, { checked: c.mode === "manual" }),
          h("span", { text: "Enter an approved phone number manually" })
        ]),
        c.mode === "order" ? renderCustomOrderSearch() : renderCustomManualFields()
      ]),
      card("Step 2: Write Message", [
        field("Template", select("", [["", "Choose optional template"], ["substitution", "Substitution helper"], ["custom", "Blank custom message"]], (value) => {
          if (value === "substitution") c.message = "Welkom USA: Hi [FIRST NAME], we need help with your order #[ORDER NUMBER]. Please reply when you can. Reply STOP to opt out.";
          if (value === "custom") c.message = "Welkom USA: ";
          render();
        })),
        h("div", { class: "token-bar" }, [
          button("Insert first name", "ghost", () => { c.message += c.mode === "order" ? c.order?.customer?.firstName || "" : c.firstName || ""; render(); }),
          button("Insert order number", "ghost", () => { c.message += c.mode === "order" ? c.order?.name || "" : c.reference || ""; render(); })
        ]),
        textarea(c.message, (value) => { c.message = value; render(); }, { rows: "7", maxlength: "640", placeholder: "Welkom USA: Write the approved customer message here. Reply STOP to opt out." }),
        h("div", { class: "alert subtle", text: `${estimate.length} / 320 characters - ${estimate.encoding} - ${estimate.segments} segment${estimate.segments === 1 ? "" : "s"}` }),
        h("div", { class: "actions" }, [
          button("Copy", "secondary", () => copyText(c.message)),
          button(state.busy ? "Sending..." : "Send", "primary", () => sendCustomMessage(), { disabled: state.busy || !customValid() })
        ])
      ])
    ]);
  }

  function renderCustomOrderSearch() {
    const c = state.custom;
    const search = async () => {
      if (!c.orderQuery.trim()) return toast("error", "Enter an order number before searching.");
      try {
        const result = await api("/api/order-search", { method: "POST", body: JSON.stringify({ query: normalizeOrder(c.orderQuery) }) });
        c.order = result.order;
        render();
      } catch (error) {
        toast("error", messageFor(error));
      }
    };
    return h("div", { class: "stack" }, [
      h("div", { class: "grid two" }, [
        field("Order number", input("text", c.orderQuery, (value) => { c.orderQuery = value; }, { placeholder: "1023 or #1023" })),
        h("div", { class: "field button-field" }, [button("Search", "secondary", search)])
      ]),
      c.order ? renderOrderSummary(c.order) : null
    ]);
  }

  function renderCustomManualFields() {
    const c = state.custom;
    return h("div", { class: "grid two" }, [
      field("Approved phone number", input("tel", c.phone, (value) => { c.phone = value; }, { placeholder: "+12125551234" })),
      field("First name optional", input("text", c.firstName, (value) => { c.firstName = value; })),
      field("Reference", input("text", c.reference, (value) => { c.reference = value; }, { placeholder: "Reason or receipt reference" })),
      h("label", { class: "check-row wide" }, [
        input("checkbox", "", (_, event) => { c.consentConfirmed = event.target.checked; render(); }, { checked: c.consentConfirmed }),
        h("span", { text: "Confirm that the customer gave permission to receive this SMS." })
      ])
    ]);
  }

  function customValid() {
    const c = state.custom;
    if (!c.message.trim()) return false;
    if (c.mode === "order") return Boolean(c.order?.id && c.order.smsConsent?.granted);
    return isE164(c.phone) && c.reference.trim() && c.consentConfirmed;
  }

  async function sendCustomMessage() {
    const c = state.custom;
    state.busy = true;
    render();
    try {
      if (c.mode === "order") {
        toast("error", "Custom order messages must be sent through the substitution workflow until the order is rechecked.");
      } else {
        await api("/api/send-manual-sms", {
          method: "POST",
          body: JSON.stringify({
            phone: c.phone,
            firstName: c.firstName,
            reference: c.reference,
            unavailableItem: "customer service message",
            substituteItem: "assistance",
            message: c.message,
            consentConfirmed: c.consentConfirmed,
            sendConfirmed: true,
            authorizedResend: c.authorizedResend,
            idempotencyKey: `custom:${Date.now()}:${c.phone}:${c.message}`
          })
        });
        toast("success", "Message sent successfully.");
        state.custom = emptyCustomState();
      }
    } catch (error) {
      toast("error", messageFor(error));
    } finally {
      state.busy = false;
      render();
    }
  }

  function renderAdminDashboard() {
    const content = h("div", { class: "stack" }, [h("div", { class: "empty", text: "Loading overview..." })]);
    setTimeout(async () => {
      try {
        const result = await api("/api/dashboard");
        clear(content);
        content.append(h("div", { class: "metric-grid" }, [
          metric("Total messages", result.stats?.total || 0),
          metric("Today", result.stats?.sentToday || 0),
          metric("Failed", result.stats?.failed || 0),
          metric("Dry run", result.status?.dryRun ? "On" : "Off")
        ]));
        content.append(card("Admin menu", adminTiles()));
      } catch (error) {
        clear(content);
        content.append(h("div", { class: "alert error", text: messageFor(error) }));
      }
    }, 0);
    return page("Admin Overview", "Configuration, templates, backups and user management.", [content], button("Staff Main Menu", "secondary", () => go("/menu")));
  }

  function adminTiles() {
    return h("div", { class: "tile-grid compact" }, [
      menuTile("/admin/templates", "Templates", "Manage approved wording.", "edit"),
      menuTile("/admin/settings", "Settings", "Check configuration and Blob storage.", "settings"),
      menuTile("/admin/users", "User Management", "Create and disable staff users.", "users"),
      menuTile("/admin/backup", "Backup", "Export safe audit history.", "history")
    ]);
  }

  function metric(label, value) {
    return h("div", { class: "metric" }, [h("span", { text: label }), h("strong", { text: value })]);
  }

  function renderAdminTemplates() {
    const box = h("div", { class: "stack" }, [h("div", { class: "empty", text: "Loading templates..." })]);
    let selected = null;
    const load = async () => {
      const result = await api("/api/templates");
      selected = result.templates?.[0] || null;
      draw(result.templates || []);
    };
    const draw = (templates) => {
      clear(box);
      box.append(h("div", { class: "grid two" }, [
        card("Templates", templates.length ? templates.map((template) => h("button", { type: "button", class: "template-row", onClick: () => { selected = template; draw(templates); } }, [h("strong", { text: template.name }), h("span", { text: template.body })])) : h("div", { class: "empty", text: "No templates yet." })),
        renderTemplateEditor(selected, load)
      ]));
    };
    setTimeout(load, 0);
    return page("Templates", "Maintain the approved substitution message wording.", [box]);
  }

  function renderTemplateEditor(template, reload) {
    let name = template?.name || "Default substitution";
    let body = template?.body || TEMPLATE;
    return card("Template editor", [
      field("Name", input("text", name, (value) => { name = value; })),
      field("Body", textarea(body, (value) => { body = value; }, { rows: "8", maxlength: "320" })),
      h("div", { class: "actions" }, [
        button("Save Template", "primary", async () => {
          try {
            await api("/api/templates", { method: "POST", body: JSON.stringify({ id: template?.id, name, body, isDefault: template?.isDefault }) });
            toast("success", "Template saved.");
            reload();
          } catch (error) {
            toast("error", messageFor(error));
          }
        }),
        template?.id && !template.isDefault ? button("Archive", "danger", async () => {
          await api(`/api/templates/${encodeURIComponent(template.id)}/archive`, { method: "POST", body: "{}" });
          toast("success", "Template archived.");
          reload();
        }) : null
      ])
    ]);
  }

  function renderAdminSettings() {
    const box = h("div", { class: "stack" }, [h("div", { class: "empty", text: "Loading settings..." })]);
    const load = async () => {
      try {
        const dashboard = await api("/api/dashboard");
        const diagnostics = await api("/api/config-diagnostics").catch(() => ({ diagnostics: { checks: [] } }));
        clear(box);
        box.append(
          card("Configuration status", h("div", { class: "settings-grid" }, Object.entries(dashboard.status || {}).map(([key, value]) => h("div", { class: "setting-row" }, [h("strong", { text: humanKey(key) }), h("span", { text: String(value) })])))),
          card("Diagnostics", h("div", { class: "stack" }, (diagnostics.diagnostics?.checks || []).map((check) => h("div", { class: check.ok ? "alert success" : "alert error" }, [h("strong", { text: check.name }), h("p", { text: check.ok ? "Looks configured." : check.guidance || "Needs attention." })])))),
          h("div", { class: "actions" }, [
            button("Initialize Blob Stores", "primary", async () => runAdminAction("/api/admin/init-blobs", "Blob stores checked.")),
            button("Restore Default Template", "secondary", async () => {
              await api("/api/templates", { method: "POST", body: JSON.stringify({ id: "default-substitution", name: "Default substitution", body: TEMPLATE, isDefault: true }) });
              toast("success", "Default template restored.");
            }),
            button("Run Cleanup", "secondary", async () => runAdminAction("/api/admin/cleanup", "Cleanup complete."))
          ])
        );
      } catch (error) {
        clear(box);
        box.append(h("div", { class: "alert error", text: messageFor(error) }));
      }
    };
    setTimeout(load, 0);
    return page("Settings", "Safe configuration status. Secret values are never displayed.", [box]);
  }

  async function runAdminAction(path, success) {
    try {
      await api(path, { method: "POST", body: "{}" });
      toast("success", success);
    } catch (error) {
      toast("error", messageFor(error));
    }
  }

  function renderAdminUsers() {
    const box = h("div", { class: "stack" }, [h("div", { class: "empty", text: "Loading users..." })]);
    let username = "";
    let displayName = "";
    let password = "";
    let role = "staff";
    const load = async () => {
      try {
        const result = await api("/.netlify/functions/admin-list-users");
        draw(result.users || []);
      } catch (error) {
        clear(box);
        box.append(h("div", { class: "alert error", text: messageFor(error) }));
      }
    };
    const draw = (users) => {
      clear(box);
      box.append(h("div", { class: "grid two" }, [
        card("Users", users.map((user) => h("div", { class: "message-row" }, [
          h("div", {}, [h("strong", { text: user.displayName || user.username }), h("p", { text: `${user.username} - ${user.isActive ? "Active" : "Disabled"}` })]),
          user.isActive ? button("Disable", "danger", async () => {
            await api("/.netlify/functions/admin-disable-user", { method: "POST", body: JSON.stringify({ userId: user.id }) });
            load();
          }) : h("span", { class: "badge error", text: "Disabled" })
        ]))),
        card("Create staff user", [
          field("Username", input("text", username, (value) => { username = value; })),
          field("Display name", input("text", displayName, (value) => { displayName = value; })),
          field("Temporary password", input("password", password, (value) => { password = value; })),
          field("Role", select(role, [["staff", "Staff"], ["admin", "Admin"]], (value) => { role = value; })),
          button("Create User", "primary", async () => {
            await api("/.netlify/functions/admin-create-user", { method: "POST", body: JSON.stringify({ username, displayName, password, role }) });
            username = ""; displayName = ""; password = ""; role = "staff";
            toast("success", "User created.");
            load();
          })
        ])
      ]));
    };
    setTimeout(load, 0);
    return page("User Management", "Create, disable and reset staff access.", [box]);
  }

  function renderAdminBackup() {
    return page("Backup", "Exports are admin-only and exclude secrets.", [
      card("Safe exports", [
        h("p", { class: "muted", text: "Exports include redacted message history, templates, audit records and non-secret settings." }),
        h("div", { class: "actions" }, [
          button("Download JSON", "secondary", () => download("/api/backup.json", "welkom-sms-backup.json")),
          button("Download Messages CSV", "primary", () => download("/api/backup/messages.csv", "welkom-sms-messages.csv"))
        ])
      ])
    ]);
  }

  async function download(path, fallbackName) {
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Export failed.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = h("a", { href: url, download: fallbackName });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast("error", "Export failed.");
    }
  }

  function renderCustomerResponse() {
    const token = window.location.pathname.split("/respond/")[1] || "";
    const box = h("div", { class: "customer-box" }, [h("div", { class: "empty", text: "Loading your request..." })]);
    const load = async () => {
      try {
        const result = await api(`/api/public/substitution-request?token=${encodeURIComponent(token)}`);
        clear(box);
        box.append(card("Choose what you would prefer", [
          h("p", { class: "muted", text: `For ${result.request.maskedOrderReference}.` }),
          h("div", { class: "stack" }, (result.request.items || []).map((item) => customerItem(token, item)))
        ]));
      } catch (error) {
        clear(box);
        box.append(card("This request is not available", h("p", { text: "Please contact Welkom USA for help." }), { class: "danger" }));
      }
    };
    setTimeout(load, 0);
    return h("section", { class: "customer-page" }, [
      h("div", { class: "brand-row" }, [h("div", { class: "brand-mark", text: "WE" }), h("strong", { text: "Welkom USA" })]),
      box
    ]);
  }

  function customerItem(token, item) {
    let choice = "";
    return h("div", { class: "customer-item" }, [
      h("h3", { text: item.originalTitle }),
      ...(item.substituteOptions || []).map((option) => h("label", { class: "choice-card" }, [
        input("radio", "", (_, event) => { if (event.target.checked) choice = option.optionId; }, { name: item.requestItemId, value: option.optionId }),
        option.imageUrl ? h("img", { class: "thumb", src: option.imageUrl, alt: "" }) : null,
        h("span", { text: `${option.productTitle} ${option.variantTitle || ""}` })
      ])),
      h("label", { class: "choice-card" }, [input("radio", "", (_, event) => { if (event.target.checked) choice = "refund"; }, { name: item.requestItemId }), h("span", { text: "Refund this item" })]),
      button("Submit choice", "primary", async () => {
        const type = choice === "refund" ? "refund" : "substitute";
        if (!choice) return toast("error", "Please choose one option for each item.");
        await api("/api/public/substitution-response", { method: "POST", body: JSON.stringify({ token, choices: [{ requestItemId: item.requestItemId, type, optionId: type === "substitute" ? choice : "" }] }) });
        toast("success", "Thank you. We received your choice.");
      })
    ]);
  }

  function confirmDialog(title, body, onConfirm, confirmLabel = "Confirm") {
    els.dialogTitle.textContent = title;
    els.dialogBody.textContent = body;
    els.dialogConfirm.textContent = confirmLabel;
    els.dialogLayer.classList.remove("hidden");
    els.dialogCancel.focus();
    const cleanup = () => {
      els.dialogLayer.classList.add("hidden");
      els.dialogConfirm.onclick = null;
      els.dialogCancel.onclick = null;
    };
    els.dialogCancel.onclick = cleanup;
    els.dialogConfirm.onclick = () => {
      cleanup();
      onConfirm?.();
    };
  }

  function confirmStartOver() {
    confirmDialog("Start over?", "This will clear the selected customer, items and message.", () => {
      state.substitution = emptySubstitutionState();
      go("/substitution/order");
    }, "Start over");
  }

  function confirmDiscard(route) {
    if (!state.substitution.order && !state.substitution.replacements.length && !state.substitution.message) return go(route);
    confirmDialog("Leave this workflow?", "Your entered substitution details will be cleared.", () => {
      state.substitution = emptySubstitutionState();
      go(route);
    }, "Leave");
  }

  async function logout() {
    try {
      await api("/.netlify/functions/auth-logout", { method: "POST", body: "{}" });
    } catch (error) {
      // Local session cleanup still happens even if the server already expired the cookie.
    }
    state.auth = null;
    state.csrfToken = "";
    state.substitution = emptySubstitutionState();
    state.custom = emptyCustomState();
    go("/login");
  }

  function normalizeOrder(value) {
    const clean = String(value || "").trim();
    return clean.startsWith("#") ? clean : `#${clean}`;
  }

  function cleanOrder(value) {
    return String(value || "").replace(/^#/, "");
  }

  function isE164(value) {
    return /^\+[1-9]\d{7,14}$/.test(String(value || "").trim().replace(/[\s().-]/g, ""));
  }

  function maskPhone(value) {
    const clean = String(value || "").trim();
    if (clean.length < 6) return "[redacted]";
    return `${clean.slice(0, 3)}${"*".repeat(Math.max(clean.length - 5, 3))}${clean.slice(-2)}`;
  }

  function fullName(order) {
    return [order?.customer?.firstName, order?.customer?.lastName].filter(Boolean).join(" ") || "-";
  }

  function formatAddress(order) {
    const address = order?.shippingAddress || {};
    return [address.name, address.address1, address.address2, address.city, address.province, address.zip, address.country].filter(Boolean).join(", ");
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString();
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
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

  function publicProductUrl(variantId) {
    const id = String(variantId || "").split("/").pop();
    return id ? `https://www.welkomusa.com/products/${encodeURIComponent(id)}` : "";
  }

  function staffCopyConfigured() {
    return Boolean(state.config?.staffCopyConfigured);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text || "");
      toast("success", "Copied.");
    } catch (error) {
      toast("error", "Copy failed.");
    }
  }

  function humanKey(key) {
    return String(key).replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
  }

  window.addEventListener("popstate", () => {
    state.route = routeFromPath();
    if (!canAccess(state.route)) state.route = state.auth ? "/menu" : "/login";
    render();
  });
  els.logoutButton.addEventListener("click", logout);
  els.dialogLayer.addEventListener("click", (event) => {
    if (event.target === els.dialogLayer) els.dialogCancel.click();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !els.dialogLayer.classList.contains("hidden")) els.dialogCancel.click();
  });

  checkSession();
})();
