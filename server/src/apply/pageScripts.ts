// Code that runs INSIDE the browser page. It lives in plain strings (not TS functions) on purpose:
// tsx/esbuild can inject helpers like __name() into function bodies, and those don't exist in the page.
// Each script is an expression evaluating to a function; call it with `(${SCRIPT})(arg)`.

// Reads every form control into { name, label, type, required, options, menuId }.
// platform: "greenhouse" | "lever" | "ashby"
export const EXTRACT_FIELDS_SCRIPT = String.raw`(platform) => {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const textOf = (el) => norm(el ? el.textContent : "");
  const STAR = /[*✱]/;
  const stripLabel = (s) => norm(s.replace(/[*✱]/g, "").replace(/\(required\)/i, ""));
  const hasStar = (el) => !!el && STAR.test(textOf(el));
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  const fields = [];
  const seen = new Set();

  const skipControl = (el) => {
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "search", "password"].includes(type)) return true;
    if (el.getAttribute("aria-hidden") === "true") return true; // react-select's shadow "required" input
    if (/iti__|iti-\d/.test((el.className || "") + " " + (el.id || ""))) return true; // phone-country widget internals
    if (/g-recaptcha-response|h-captcha-response/.test(el.name || "")) return true;
    return false;
  };

  const optionTexts = (name, scope) =>
    Array.from(scope.querySelectorAll('input[name="' + (window.CSS && CSS.escape ? CSS.escape(name) : name) + '"]'))
      .map((i) => {
        const lab = i.closest("label");
        return norm(lab ? lab.textContent : i.value);
      })
      .filter(Boolean);

  const push = (f) => {
    const key = f.type + ":" + f.name;
    if (!f.name || seen.has(key)) return;
    seen.add(key);
    fields.push(f);
  };

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (type === "file") return "file";
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
    if (el.getAttribute("role") === "combobox") return "combobox";
    return "text";
  };

  const describe = (el, label, required, scope) => {
    const kind = kindOf(el);
    const name = el.name || el.id;
    let options = [];
    let type = kind;
    let menuId = null;
    if (kind === "select") options = Array.from(el.options).map((o) => norm(o.textContent)).filter((t) => t && !/^select\.{0,3}$/i.test(t));
    if (kind === "radio" || kind === "checkbox") {
      options = el.name ? optionTexts(el.name, scope) : [];
      if (kind === "checkbox" && options.length <= 1) options = []; // single consent box: yes/no, no options
    }
    if (kind === "combobox") { type = "select"; menuId = el.id || null; }
    return { name, label, type, required, options, menuId };
  };

  if (platform === "greenhouse") {
    const root = document.querySelector("#application-form, #application_form, form") || document;
    root.querySelectorAll("input, textarea, select").forEach((el) => {
      if (skipControl(el)) return;
      const id = el.id;
      const kind = kindOf(el);
      let labelEl = id ? root.querySelector('label[for="' + esc(id) + '"]') || document.querySelector('label[for="' + esc(id) + '"]') : null;
      let label = labelEl ? textOf(labelEl) : "";
      let required = el.required || el.getAttribute("aria-required") === "true" || hasStar(labelEl);
      if (kind === "file") {
        // the <label for> of a file input just says "Attach"; the real name is the group heading
        const group = el.closest('[role="group"]');
        const ref = group && group.getAttribute("aria-labelledby");
        const head = ref ? document.getElementById(ref) : null;
        if (head) { label = textOf(head); required = required || hasStar(head) || group.getAttribute("aria-required") === "true"; }
        if (/^enter manually$/i.test(label)) return;
      }
      if (!label) label = el.getAttribute("aria-label") || "";
      const fieldset = el.closest("fieldset");
      if ((kind === "radio" || kind === "checkbox") && fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend && textOf(legend)) { label = textOf(legend); required = required || hasStar(legend); }
      }
      if (/_text$/.test(id) && el.tagName === "TEXTAREA") return; // "enter resume as text" alternative
      push(describe(el, stripLabel(label), required, fieldset || root));
    });
  } else if (platform === "lever") {
    const root = document.querySelector("#application-form, form") || document;
    root.querySelectorAll("li.application-question").forEach((li) => {
      if (li.classList.contains("awli-application-row")) return; // LinkedIn auto-fill widget, not a question
      const head = li.querySelector(".application-label");
      const textEl = head && head.querySelector(".text");
      const label = textOf(textEl || head);
      const required = hasStar(head) || !!li.querySelector(".required-field, input[required], textarea[required], select[required]");
      li.querySelectorAll("input, textarea, select").forEach((el) => {
        if (skipControl(el)) return;
        if (el.name === "selectedLocation") return;
        push(describe(el, stripLabel(label), required, li));
      });
    });
  } else if (platform === "ashby") {
    const entries = document.querySelectorAll(".ashby-application-form-field-entry");
    entries.forEach((entry) => {
      const labelEl = entry.querySelector("label.ashby-application-form-question-title, label, legend");
      const label = textOf(labelEl);
      const labelRequired = !!labelEl && /_required_|required/.test(labelEl.className || "") || hasStar(labelEl);
      const yesno = entry.querySelectorAll(".ashby-application-form-input-yesno-option");
      if (yesno.length) {
        const box = entry.querySelector('input[type="checkbox"]');
        const name = (box && box.name) || entry.getAttribute("data-field-path");
        push({ name, label: stripLabel(label), type: "radio", required: labelRequired, options: Array.from(yesno).map((b) => textOf(b)), menuId: null });
        return;
      }
      entry.querySelectorAll("input, textarea, select").forEach((el) => {
        if (skipControl(el)) return;
        const required = labelRequired || el.required || el.getAttribute("aria-required") === "true";
        const f = describe(el, stripLabel(label), required, entry);
        if (!f.name) f.name = entry.getAttribute("data-field-path");
        push(f);
      });
    });
  }
  return fields;
}`;

// Finds a CAPTCHA the human would have to solve (a visible widget). Returns a short description or null.
// Invisible ones don't count: Greenhouse and Ashby load reCAPTCHA Enterprise on EVERY form as an invisible
// score check (a fixed badge, 60px, mostly off-screen), and Lever keeps a hidden hCaptcha for submit time.
// If a challenge does appear at submit time, the fill step catches it (see filler.ts).
export const FIND_CAPTCHA_SCRIPT = String.raw`() => {
  const sel = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest(".grecaptcha-badge")) continue; // reCAPTCHA v3 badge
    const size = (el.getAttribute("data-size") || "").toLowerCase();
    if (size === "invisible") continue;
    if (el.tagName === "IFRAME") {
      const title = (el.getAttribute("title") || "").toLowerCase();
      if (title.includes("challenge expires")) { /* the pop-up challenge frame: visible only when triggered */ }
    }
    const visible = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true;
    if (!visible) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 30 || r.height < 30) continue;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth) continue; // parked off-screen
    return (el.tagName.toLowerCase() + " " + (el.getAttribute("src") || el.className || "")).slice(0, 120);
  }
  return null;
}`;

// True when the page is asking me to log in rather than showing a form.
export const FIND_LOGIN_WALL_SCRIPT = String.raw`() => {
  const pw = document.querySelector('input[type="password"]');
  if (pw) return true;
  return /\/(login|sign[_-]?in|users\/sign_in)\b/i.test(location.pathname);
}`;
