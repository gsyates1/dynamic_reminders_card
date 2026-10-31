/**
 * Dynamic Reminders Card
 *
 * A Home Assistant Lovelace card for viewing, adding, editing and deleting
 * dynamic reminders. Reminders are read from the `reminders` attribute of the
 * Reminders integration's sensor (sensor.dynamic_reminders) and changed by
 * calling its reminders.add_dynamic, reminders.update_dynamic and
 * reminders.delete_dynamic actions.
 */

const CARD_VERSION = "2.0.1";

const DOMAIN = "reminders";
const ACTION_ADD = "add_dynamic";
const ACTION_UPDATE = "update_dynamic";
const ACTION_DELETE = "delete_dynamic";

// A new reminder is shown under a temporary ID until the integration
// returns the ID it generated.
const TEMP_ID_PREFIX = "pending-";

// How long an optimistic (not yet confirmed by the sensor) change is shown
// before falling back to whatever the sensor reports.
const PENDING_TIMEOUT_MS = 30000;

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );

const pad2 = (n) => String(n).padStart(2, "0");

/** RFC 4122 v4 GUID. crypto.randomUUID is only available in secure contexts. */
const generateGuid = () => {
  if (window.crypto?.randomUUID) {
    try {
      return window.crypto.randomUUID();
    } catch (_err) {
      // fall through to the manual implementation
    }
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const toBool = (value) => {
  if (typeof value === "string") {
    return ["true", "on", "yes", "1"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
};

const toRepeat = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// "2026-10-31 11:33:10.095534-04:00", "2026-12-01 09:00:00-05:00",
// "2026-10-20T08:57:25.000Z", ... (the integration stores the first two forms)
const TRIGGER_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parse a trigger time without relying on Date's lenient (and browser
 * dependent) parsing of non-ISO strings such as a space separator or six
 * fraction digits. A value with an offset or Z is an absolute time; one
 * without is read as browser local time.
 */
const parseTriggerTime = (value) => {
  if (!value) return null;
  const m = TRIGGER_TIME_RE.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = "0", frac = "0", offset] = m;
  const ms = Math.round(Number(`0.${frac}`) * 1000);
  let time;
  if (offset) {
    time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, ms);
    if (offset.toUpperCase() !== "Z") {
      const sign = offset[0] === "-" ? -1 : 1;
      const digits = offset.slice(1).replace(":", "");
      const minutes = +digits.slice(0, 2) * 60 + +digits.slice(2);
      time -= sign * minutes * 60000;
    }
  } else {
    time = new Date(+y, +mo - 1, +d, +h, +mi, +sec, ms).getTime();
  }
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** "8:30 AM" */
const formatTime12 = (date) => {
  const hours = date.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${pad2(date.getMinutes())} ${hours < 12 ? "AM" : "PM"}`;
};

/** "Today at 8:30 AM", "Tomorrow at 11:45 AM", "In 2 days at 5:00 PM" */
const formatRelative = (date, now = new Date()) => {
  // Math.round absorbs the 23/25 hour days around DST changes.
  const days = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  let day;
  if (days === 0) day = "Today";
  else if (days === 1) day = "Tomorrow";
  else if (days === -1) day = "Yesterday";
  else if (days > 1) day = `In ${days} days`;
  else day = `${-days} days ago`;
  return `${day} at ${formatTime12(date)}`;
};

/** Value for <input type="date"> in local time. */
const toDateInput = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** Value for <input type="time"> in local time. */
const toTimeInput = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/**
 * Combine local date + time input values into 'YYYY-MM-DD HH:MM:SS±HH:MM',
 * using the browser's UTC offset for that date. The offset makes it an
 * absolute time, so the integration stores the moment the user picked even
 * when Home Assistant's time zone differs from the browser's.
 */
const toTriggerTime = (dateValue, timeValue) => {
  const [y, mo, d] = dateValue.split("-").map(Number);
  const [h, mi] = timeValue.split(":").map(Number);
  const date = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  const offset = -date.getTimezoneOffset();
  const abs = Math.abs(offset);
  const sign = offset < 0 ? "-" : "+";
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:00` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
};

/** Dynamic reminder collections are {id: {...}}; plain ones are {id: "text"}. */
const isDynamicCollection = (raw) => {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch (_err) {
      return false;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return Object.values(raw).every((v) => v && typeof v === "object");
};

/**
 * Entities whose `reminders` attribute looks like a dynamic reminders
 * collection. This leaves out the integration's sensor.reminders once it
 * holds any (plain text) reminders. Entities with "dynamic" in their ID are
 * listed first so the card picker defaults to sensor.dynamic_reminders.
 */
const reminderEntities = (hass) =>
  Object.keys(hass?.states ?? {})
    .filter((id) => {
      const raw = hass.states[id]?.attributes?.reminders;
      return raw !== undefined && isDynamicCollection(raw);
    })
    .sort((a, b) => Number(!a.includes("dynamic")) - Number(!b.includes("dynamic")) || a.localeCompare(b));

const normalizeReminder = (id, raw) => ({
  unique_id: id,
  reminder: raw?.reminder == null ? "" : String(raw.reminder),
  next_trigger_time: raw?.next_trigger_time == null ? "" : String(raw.next_trigger_time),
  repeat_frequency: toRepeat(raw?.repeat_frequency),
  nag: toBool(raw?.nag),
});

/* ------------------------------------------------------------------------ */
/* Styles                                                                   */
/* ------------------------------------------------------------------------ */

const STYLES = `
  :host {
    display: block;
    height: 100%;
    --drc-list-max-height: 400px;
  }
  :host([grid]) {
    --drc-list-max-height: none;
  }
  ha-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    box-sizing: border-box;
    padding: 16px;
    gap: 12px;
    overflow: hidden;
  }
  .header {
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: var(--ha-font-weight-normal, 400);
    font-family: var(--ha-card-header-font-family, inherit);
    color: var(--ha-card-header-color, var(--primary-text-color));
    letter-spacing: -0.012em;
    line-height: var(--ha-line-height-expanded, 1.3);
    margin: -4px 0 0;
  }
  .list {
    flex: 1 1 auto;
    min-height: 96px;
    max-height: var(--drc-list-max-height);
    overflow: auto;
    border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
    border-radius: var(--ha-card-border-radius, 12px);
    box-sizing: border-box;
  }
  .rows {
    width: max-content;
    min-width: 100%;
    padding: 8px 0;
    box-sizing: border-box;
  }
  .row {
    display: flex;
    align-items: center;
    white-space: nowrap;
  }
  .text {
    flex: 1 0 auto;
    padding: 6px 8px 6px 16px;
  }
  .primary {
    font-size: var(--ha-font-size-l, 16px);
    color: var(--primary-text-color);
    line-height: 1.4;
  }
  .secondary {
    font-size: var(--ha-font-size-m, 14px);
    color: var(--secondary-text-color);
    line-height: 1.4;
  }
  .secondary.overdue {
    color: var(--warning-color, #ff9800);
  }
  .actions {
    position: sticky;
    right: 0;
    display: flex;
    flex: 0 0 auto;
    align-self: stretch;
    align-items: center;
    padding: 0 8px 0 4px;
    background-color: var(--ha-card-background, var(--card-background-color, #fff));
  }
  .icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    --mdc-icon-size: 24px;
  }
  .icon-button:hover,
  .icon-button:focus-visible {
    color: var(--primary-text-color);
    background-color: color-mix(in srgb, currentColor 12%, transparent);
    outline: none;
  }
  .empty {
    padding: 16px;
    color: var(--secondary-text-color);
    white-space: nowrap;
  }
  .empty.warning {
    color: var(--warning-color, #ff9800);
    white-space: normal;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
  }
  .card-error {
    flex: 1 1 auto;
    color: var(--error-color, #db4437);
    font-size: var(--ha-font-size-m, 14px);
  }
  .btn {
    font-family: inherit;
    font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-medium, 500);
    letter-spacing: 0.0892857em;
    min-width: 64px;
    height: 36px;
    padding: 0 16px;
    border-radius: 18px;
    border: none;
    cursor: pointer;
    background: none;
    color: var(--primary-color);
  }
  .btn:hover,
  .btn:focus-visible {
    background-color: color-mix(in srgb, currentColor 12%, transparent);
    outline: none;
  }
  .btn.filled {
    background-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
    padding: 0 20px;
  }
  .btn.filled:hover,
  .btn.filled:focus-visible {
    filter: brightness(1.1);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  .btn.danger {
    color: var(--error-color, #db4437);
  }
  .add-button {
    height: 40px;
    border-radius: 20px;
    padding: 0 20px 0 14px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    --mdc-icon-size: 20px;
  }

  /* Dialogs ------------------------------------------------------------ */
  dialog {
    box-sizing: border-box;
    width: min(440px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    padding: 24px;
    border: none;
    border-radius: var(--ha-dialog-border-radius, 28px);
    background: var(
      --ha-dialog-surface-background,
      var(--mdc-theme-surface, var(--card-background-color, #fff))
    );
    color: var(--primary-text-color);
    box-shadow: 0 11px 15px -7px rgba(0, 0, 0, 0.2), 0 24px 38px 3px rgba(0, 0, 0, 0.14),
      0 9px 46px 8px rgba(0, 0, 0, 0.12);
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
  }
  dialog::backdrop {
    background: var(--mdc-dialog-scrim-color, rgba(0, 0, 0, 0.32));
  }
  dialog h2 {
    margin: 0 0 16px;
    font-size: var(--ha-font-size-2xl, 24px);
    font-weight: var(--ha-font-weight-normal, 400);
    line-height: 1.3;
  }
  dialog p {
    margin: 0;
    color: var(--secondary-text-color);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 0;
  }
  .form-error {
    padding: 8px 12px;
    border-radius: 8px;
    color: var(--error-color, #db4437);
    background-color: color-mix(in srgb, var(--error-color, #db4437) 12%, transparent);
    font-size: var(--ha-font-size-m, 14px);
    line-height: 1.4;
  }
  .form-error ul {
    margin: 0;
    padding-left: 18px;
  }
  .form-error[hidden] {
    display: none;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .field > span,
  .group-label {
    font-size: var(--ha-font-size-s, 12px);
    color: var(--secondary-text-color);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .datetime {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 8px;
  }
  input[type="text"],
  input[type="date"],
  input[type="time"],
  input[type="number"] {
    box-sizing: border-box;
    width: 100%;
    height: 48px;
    padding: 0 12px;
    font: inherit;
    font-size: var(--ha-font-size-l, 16px);
    color: var(--input-ink-color, var(--primary-text-color));
    background-color: var(--input-fill-color, var(--secondary-background-color, rgba(127, 127, 127, 0.08)));
    border: none;
    border-bottom: 1px solid var(--input-idle-line-color, var(--secondary-text-color));
    border-radius: 4px 4px 0 0;
    outline: none;
  }
  input:focus {
    border-bottom: 2px solid var(--primary-color);
  }
  input[aria-invalid="true"] {
    border-bottom: 2px solid var(--error-color, #db4437);
  }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    color: var(--primary-text-color);
  }
  .toggle-row small {
    display: block;
    color: var(--secondary-text-color);
    font-size: var(--ha-font-size-s, 12px);
  }
  input.switch {
    appearance: none;
    -webkit-appearance: none;
    position: relative;
    flex: 0 0 auto;
    width: 36px;
    height: 14px;
    margin: 0 4px;
    border-radius: 7px;
    background-color: var(--switch-unchecked-track-color, var(--disabled-text-color, #9e9e9e));
    opacity: 0.6;
    cursor: pointer;
    transition: background-color 0.15s, opacity 0.15s;
  }
  input.switch::before {
    content: "";
    position: absolute;
    top: -3px;
    left: -4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: var(--switch-unchecked-button-color, #fafafa);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s, background-color 0.15s;
  }
  input.switch:checked::before {
    transform: translateX(24px);
    background-color: var(--switch-checked-button-color, var(--primary-color));
  }
  input.switch:checked {
    opacity: 1;
    background-color: color-mix(
      in srgb,
      var(--switch-checked-track-color, var(--primary-color)) 50%,
      transparent
    );
  }
  input.switch:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 6px;
  }
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
`;

/* ------------------------------------------------------------------------ */
/* Card                                                                     */
/* ------------------------------------------------------------------------ */

class DynamicRemindersCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._source = {};
    this._sourceKey = "";
    this._pending = new Map();
    this._listKey = null;
    this._editing = null;
    this._deleting = null;
    this._built = false;
    this._clockTimer = null;
    this._errorTimer = null;
  }

  /* ---- Lovelace API ---------------------------------------------------- */

  static getConfigElement() {
    return document.createElement("dynamic-reminders-card-editor");
  }

  static getStubConfig(hass) {
    return { entity: reminderEntities(hass)[0] ?? "" };
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...config };
    this._listKey = null;
    if (this._built) {
      this._applyConfig();
      this._readSource(true);
      this._renderList();
    }
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) this._build();
    this.style.colorScheme = hass?.themes?.darkMode ? "dark" : "light";
    this._readSource();
    this._renderList();
  }

  get hass() {
    return this._hass;
  }

  /** Set by Home Assistant when the card is placed in a sections (grid) view. */
  set layout(value) {
    this._layout = value;
    this.toggleAttribute("grid", value === "grid");
  }

  get layout() {
    return this._layout;
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: 6, min_columns: 6, min_rows: 4 };
  }

  getLayoutOptions() {
    return { grid_columns: 4, grid_rows: 6, grid_min_columns: 2, grid_min_rows: 4 };
  }

  connectedCallback() {
    // Re-render every minute so "Today"/"Tomorrow" stay correct across midnight.
    this._clockTimer = window.setInterval(() => {
      this._listKey = null;
      this._renderList();
    }, 60000);
  }

  disconnectedCallback() {
    window.clearInterval(this._clockTimer);
    this._clockTimer = null;
  }

  /* ---- DOM construction ------------------------------------------------ */

  _build() {
    this._built = true;
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="header" hidden></div>
        <div class="list" role="list"><div class="rows"></div></div>
        <div class="footer">
          <div class="card-error" role="alert" hidden></div>
          <button type="button" class="btn filled add-button">
            <ha-icon icon="mdi:plus"></ha-icon><span>Add</span>
          </button>
        </div>
      </ha-card>

      <dialog class="edit-dialog" aria-labelledby="edit-title">
        <form novalidate>
          <h2 id="edit-title">Add reminder</h2>
          <div class="form-error" role="alert" hidden></div>
          <label class="field">
            <span>Reminder *</span>
            <input type="text" name="reminder" autocomplete="off" />
          </label>
          <div class="group" role="group" aria-labelledby="when-label">
            <span class="group-label" id="when-label">Next reminder *</span>
            <div class="datetime">
              <label class="field">
                <span>Reminder date</span>
                <input type="date" name="date" />
              </label>
              <label class="field">
                <span>Reminder time</span>
                <input type="time" name="time" />
              </label>
            </div>
          </div>
          <label class="field">
            <span>Repeat every (days)</span>
            <input type="number" name="repeat" min="1" step="1" inputmode="numeric"
              placeholder="Does not repeat" />
          </label>
          <label class="toggle-row">
            <span>Nag<small>Repeat the announcement until acknowledged</small></span>
            <input type="checkbox" class="switch" name="nag" role="switch" />
          </label>
          <div class="dialog-actions">
            <button type="button" class="btn cancel">Cancel</button>
            <button type="submit" class="btn filled submit">Add</button>
          </div>
        </form>
      </dialog>

      <dialog class="delete-dialog" aria-labelledby="delete-title">
        <h2 id="delete-title">Delete reminder</h2>
        <p class="delete-message"></p>
        <div class="dialog-actions">
          <button type="button" class="btn no">No</button>
          <button type="button" class="btn danger yes">Yes</button>
        </div>
      </dialog>
    `;

    const root = this.shadowRoot;
    this._els = {
      header: root.querySelector(".header"),
      rows: root.querySelector(".rows"),
      cardError: root.querySelector(".card-error"),
      addButton: root.querySelector(".add-button"),
      editDialog: root.querySelector(".edit-dialog"),
      form: root.querySelector("form"),
      formTitle: root.querySelector("#edit-title"),
      formError: root.querySelector(".form-error"),
      submit: root.querySelector(".submit"),
      reminder: root.querySelector('input[name="reminder"]'),
      date: root.querySelector('input[name="date"]'),
      time: root.querySelector('input[name="time"]'),
      repeat: root.querySelector('input[name="repeat"]'),
      nag: root.querySelector('input[name="nag"]'),
      deleteDialog: root.querySelector(".delete-dialog"),
      deleteMessage: root.querySelector(".delete-message"),
    };

    const els = this._els;
    els.addButton.addEventListener("click", () => this._openEditor(null));
    els.rows.addEventListener("click", (ev) => this._onRowClick(ev));
    els.form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      this._submitEditor();
    });
    root.querySelector(".cancel").addEventListener("click", () => els.editDialog.close());
    els.editDialog.addEventListener("close", () => {
      this._editing = null;
    });
    // Only allow whole, non-negative numbers in the repeat field.
    els.repeat.addEventListener("keydown", (ev) => {
      if (["-", "+", ".", ",", "e", "E"].includes(ev.key)) ev.preventDefault();
    });
    els.repeat.addEventListener("input", () => {
      const digits = els.repeat.value.replace(/\D/g, "");
      if (digits !== els.repeat.value) els.repeat.value = digits;
    });
    for (const input of [els.reminder, els.date, els.time, els.repeat]) {
      input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
    }

    root.querySelector(".no").addEventListener("click", () => els.deleteDialog.close());
    root.querySelector(".yes").addEventListener("click", () => this._confirmDelete());
    els.deleteDialog.addEventListener("close", () => {
      this._deleting = null;
    });

    this._applyConfig();
  }

  _applyConfig() {
    const title = this._config?.title;
    this._els.header.hidden = !title;
    this._els.header.textContent = title ?? "";
  }

  /* ---- Data ------------------------------------------------------------ */

  _readSource(force = false) {
    const entityId = this._config?.entity;
    const stateObj = entityId ? this._hass?.states?.[entityId] : undefined;
    let raw = stateObj?.attributes?.reminders;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (_err) {
        raw = {};
      }
    }
    if (!raw || typeof raw !== "object") raw = {};
    const key = JSON.stringify(raw);
    if (!force && key === this._sourceKey) return;
    this._sourceKey = key;
    this._source = raw;
    this._resolvePending();
  }

  /** Drop optimistic changes once the sensor reflects them (or they time out). */
  _resolvePending() {
    const now = Date.now();
    for (const [id, change] of this._pending) {
      const current = this._source[id];
      const done =
        change.op === "delete"
          ? current === undefined
          : current !== undefined && JSON.stringify(current) !== change.baseline;
      if (done || now - change.at > PENDING_TIMEOUT_MS) this._pending.delete(id);
    }
  }

  _setPending(id, change) {
    this._pending.set(id, {
      ...change,
      at: Date.now(),
      baseline: JSON.stringify(this._source[id]),
    });
    window.setTimeout(() => {
      this._resolvePending();
      this._renderList();
    }, PENDING_TIMEOUT_MS + 100);
  }

  _reminders() {
    const map = new Map();
    for (const [id, raw] of Object.entries(this._source)) {
      map.set(id, normalizeReminder(id, raw));
    }
    for (const [id, change] of this._pending) {
      if (change.op === "delete") map.delete(id);
      else map.set(id, normalizeReminder(id, change.data));
    }
    return [...map.values()].sort((a, b) => {
      const ta = parseTriggerTime(a.next_trigger_time)?.getTime() ?? Infinity;
      const tb = parseTriggerTime(b.next_trigger_time)?.getTime() ?? Infinity;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.reminder.localeCompare(b.reminder);
    });
  }

  /* ---- Rendering ------------------------------------------------------- */

  _renderList() {
    if (!this._built) return;
    const entityId = this._config?.entity;
    const stateObj = entityId ? this._hass?.states?.[entityId] : undefined;

    let html;
    if (!entityId) {
      html = `<div class="empty">Select a reminders entity in the card configuration.</div>`;
    } else if (this._hass && !stateObj) {
      html = `<div class="empty">Entity not available: ${escapeHtml(entityId)}</div>`;
    } else {
      const reminders = this._reminders();
      const problem = this._sourceProblem(entityId, stateObj);
      html = reminders.map((r) => this._rowHtml(r)).join("");
      if (problem) html += `<div class="empty warning">${escapeHtml(problem)}</div>`;
      else if (!reminders.length) html = `<div class="empty">No reminders</div>`;
    }

    if (html === this._listKey) return;
    this._listKey = html;
    this._els.rows.innerHTML = html;
  }

  /**
   * Explain why the configured entity can't supply dynamic reminders, e.g.
   * the card still points at the old template sensor (now "unavailable")
   * while the integration created sensor.dynamic_reminders_2.
   */
  _sourceProblem(entityId, stateObj) {
    if (!stateObj) return null;
    const raw = stateObj.attributes?.reminders;
    let problem = null;
    if (raw === undefined) {
      problem = `${entityId} (state: ${stateObj.state}) has no 'reminders' attribute, so no reminders can be shown.`;
    } else if (!isDynamicCollection(raw)) {
      problem = `${entityId} holds plain reminders, not dynamic reminders.`;
    }
    if (!problem) return null;
    const candidates = reminderEntities(this._hass).filter((id) => id !== entityId);
    const fromIntegration = candidates.filter(
      (id) => this._hass?.entities?.[id]?.platform === DOMAIN
    );
    const suggestion = fromIntegration[0] ?? candidates[0];
    return suggestion
      ? `${problem} Change the card's entity to ${suggestion}.`
      : `${problem} Change the card's entity to the Reminders integration's Dynamic Reminders sensor.`;
  }

  _rowHtml(r) {
    const when = parseTriggerTime(r.next_trigger_time);
    const parts = [when ? formatRelative(when) : "No date set"];
    if (r.repeat_frequency > 0) {
      parts.push(`repeat every ${r.repeat_frequency} ${r.repeat_frequency === 1 ? "day" : "days"}`);
    }
    if (r.nag) parts.push("nag");
    const overdue = when && when.getTime() < Date.now();
    const id = escapeHtml(r.unique_id);
    const text = escapeHtml(r.reminder);
    return `
      <div class="row" role="listitem" data-id="${id}">
        <div class="text">
          <div class="primary">${text}</div>
          <div class="secondary${overdue ? " overdue" : ""}">${escapeHtml(parts.join(", "))}</div>
        </div>
        <div class="actions">
          <button type="button" class="icon-button" data-action="edit" title="Edit"
            aria-label="Edit ${text}"><ha-icon icon="mdi:pencil"></ha-icon></button>
          <button type="button" class="icon-button" data-action="delete" title="Delete"
            aria-label="Delete ${text}"><ha-icon icon="mdi:delete"></ha-icon></button>
        </div>
      </div>`;
  }

  _onRowClick(ev) {
    const button = ev.target.closest("button[data-action]");
    if (!button) return;
    const id = button.closest(".row")?.dataset.id;
    // A new reminder can't be edited or deleted until the integration has given it an ID.
    if (!id || id.startsWith(TEMP_ID_PREFIX)) return;
    const reminder = this._reminders().find((r) => r.unique_id === id);
    if (!reminder) return;
    if (button.dataset.action === "edit") this._openEditor(reminder);
    else this._openDelete(reminder);
  }

  /* ---- Add / edit dialog ---------------------------------------------- */

  _openEditor(reminder) {
    const els = this._els;
    this._editing = reminder ? { ...reminder } : null;
    this._showFormErrors([]);

    let when = reminder ? parseTriggerTime(reminder.next_trigger_time) : null;
    if (!reminder) {
      // Default a new reminder to the next whole hour.
      when = new Date();
      when.setHours(when.getHours() + 1, 0, 0, 0);
    }

    els.formTitle.textContent = reminder ? "Edit reminder" : "Add reminder";
    els.submit.textContent = reminder ? "Save" : "Add";
    els.reminder.value = reminder?.reminder ?? "";
    els.date.value = when ? toDateInput(when) : "";
    els.time.value = when ? toTimeInput(when) : "";
    els.repeat.value = reminder?.repeat_frequency > 0 ? String(reminder.repeat_frequency) : "";
    els.nag.checked = reminder?.nag ?? false;
    for (const input of [els.reminder, els.date, els.time, els.repeat]) {
      input.removeAttribute("aria-invalid");
    }
    this._initialWhen = { date: els.date.value, time: els.time.value };

    if (!els.editDialog.open) els.editDialog.showModal();
    els.reminder.focus();
  }

  _showFormErrors(errors) {
    const box = this._els.formError;
    box.hidden = errors.length === 0;
    box.innerHTML = errors.length
      ? errors.length === 1
        ? escapeHtml(errors[0])
        : `<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
      : "";
  }

  _submitEditor() {
    const els = this._els;
    const errors = [];
    const invalid = [];

    const text = els.reminder.value.trim();
    if (!text) {
      errors.push("Reminder is required.");
      invalid.push(els.reminder);
    }

    const dateValue = els.date.value;
    const timeValue = els.time.value;
    if (!dateValue || els.date.validity.badInput) {
      errors.push("Reminder date is required.");
      invalid.push(els.date);
    }
    if (!timeValue || els.time.validity.badInput) {
      errors.push("Reminder time is required.");
      invalid.push(els.time);
    }

    let triggerTime = null;
    if (dateValue && timeValue) {
      const unchanged =
        this._editing &&
        dateValue === this._initialWhen.date &&
        timeValue === this._initialWhen.time;
      // Pass the existing value through untouched when the user didn't change it.
      triggerTime = unchanged
        ? this._editing.next_trigger_time
        : toTriggerTime(dateValue, timeValue);
      if (!triggerTime) {
        errors.push("Reminder date and time are not valid.");
        invalid.push(els.date, els.time);
      }
    }

    const repeatRaw = els.repeat.value.trim();
    let repeat = 0;
    if (els.repeat.validity.badInput) {
      errors.push("Repeat every must be a whole number of days.");
      invalid.push(els.repeat);
    } else if (repeatRaw !== "") {
      if (!/^\d+$/.test(repeatRaw) || parseInt(repeatRaw, 10) < 1) {
        errors.push("Repeat every must be a positive whole number of days.");
        invalid.push(els.repeat);
      } else {
        repeat = parseInt(repeatRaw, 10);
      }
    }

    for (const input of [els.reminder, els.date, els.time, els.repeat]) {
      if (invalid.includes(input)) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    if (errors.length) {
      this._showFormErrors(errors);
      invalid[0]?.focus();
      return;
    }

    const fields = {
      reminder: text,
      next_trigger_time: triggerTime,
      repeat_frequency: repeat,
      nag: els.nag.checked,
    };
    els.editDialog.close();

    if (!this._editing) {
      this._call(ACTION_ADD, fields, `${TEMP_ID_PREFIX}${generateGuid()}`, {
        op: "upsert",
        data: fields,
      });
      return;
    }

    // update_dynamic changes only the fields it is given, so send just those
    // the user changed.
    const original = this._editing;
    const changes = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== original[key]) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) return;
    this._call(ACTION_UPDATE, { id: original.unique_id, ...changes }, original.unique_id, {
      op: "upsert",
      data: { ...original, ...changes },
    });
  }

  /* ---- Delete dialog --------------------------------------------------- */

  _openDelete(reminder) {
    this._deleting = reminder;
    this._els.deleteMessage.textContent = `Are you sure you want to delete "${reminder.reminder}"?`;
    this._els.deleteDialog.showModal();
    this.shadowRoot.querySelector(".no").focus();
  }

  _confirmDelete() {
    const reminder = this._deleting;
    this._els.deleteDialog.close();
    if (!reminder) return;
    this._call(ACTION_DELETE, { id: reminder.unique_id }, reminder.unique_id, {
      op: "delete",
    });
  }

  /* ---- Actions --------------------------------------------------------- */

  /**
   * Call a Reminders integration action. The change is shown straight away
   * (under `id`) and rolled back if the call fails. For add_dynamic, `id` is
   * a temporary ID that is swapped for the one the integration returns.
   */
  async _call(action, serviceData, id, pendingChange) {
    const previous = this._pending.get(id);
    this._setPending(id, pendingChange);
    this._listKey = null;
    this._renderList();
    try {
      if (!this._hass) throw new Error("Home Assistant connection not available");
      const isAdd = action === ACTION_ADD;
      // notifyOnError = false: the card shows its own error message.
      const result = await this._hass.callService(
        DOMAIN,
        action,
        serviceData,
        undefined,
        false,
        isAdd
      );
      if (isAdd) {
        this._pending.delete(id);
        const newId = result?.response?.id;
        if (newId && this._source[newId] === undefined) {
          this._setPending(String(newId), pendingChange);
        }
        this._listKey = null;
        this._renderList();
      }
    } catch (err) {
      if (previous) this._pending.set(id, previous);
      else this._pending.delete(id);
      this._listKey = null;
      this._renderList();
      this._showCardError(
        `Could not save the change: ${err?.message ?? err?.code ?? "unknown error"}`
      );
    }
  }

  _showCardError(message) {
    const el = this._els.cardError;
    el.textContent = message;
    el.hidden = false;
    window.clearTimeout(this._errorTimer);
    this._errorTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 10000);
  }
}

/* ------------------------------------------------------------------------ */
/* Card editor                                                              */
/* ------------------------------------------------------------------------ */

/** Limit the entity picker to reminder sensors when there are any. */
const editorSchema = (entities) => [
  {
    name: "entity",
    required: true,
    selector: {
      entity: entities.length ? { include_entities: entities } : { filter: { domain: "sensor" } },
    },
  },
  { name: "title", selector: { text: {} } },
];

const EDITOR_LABELS = {
  entity: "Reminders entity (sensor with a 'reminders' attribute)",
  title: "Title (optional)",
};

class DynamicRemindersCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] ?? schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...this._config, ...ev.detail.value };
        if (!config.title) delete config.title;
        this._config = config;
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    // Only rebuild the schema when the set of reminder entities changes.
    const entities = reminderEntities(this._hass);
    const key = entities.join(",");
    if (key !== this._entitiesKey || !this._form.schema) {
      this._entitiesKey = key;
      this._form.schema = editorSchema(entities);
    }
    this._form.hass = this._hass;
    this._form.data = this._config ?? {};
  }
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

if (!customElements.get("dynamic-reminders-card")) {
  customElements.define("dynamic-reminders-card", DynamicRemindersCard);
}
if (!customElements.get("dynamic-reminders-card-editor")) {
  customElements.define("dynamic-reminders-card-editor", DynamicRemindersCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "dynamic-reminders-card")) {
  window.customCards.push({
    type: "dynamic-reminders-card",
    name: "Dynamic Reminders Card",
    description: "View, add, edit and delete dynamic reminders.",
    preview: true,
    documentationURL: "https://github.com/gsyates1/dynamic_reminders_card",
  });
}

console.info(
  `%c DYNAMIC-REMINDERS-CARD %c v${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;"
);
