import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, setDoc, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (sel) => document.querySelector(sel);
const root = $("#app");

const state = {
  user: null,
  rooms: [],
  payments: {},
  ym: currentYm(),
  denied: false,
  loaded: { rooms: false, payments: false },
  unsubs: [],
  loginError: ""
};

/* ---------- Dates and money ---------- */

function pad(n) { return String(n).padStart(2, "0"); }

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function shiftYm(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function ymLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// Due date for a month. If the month is shorter than the due day
// (for example day 30 in February), the last day of the month is used.
function dueDateFor(room, ym) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(Number(room.dueDay), daysInMonth));
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a, b) { return Math.round((a - b) / 86400000); }

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDate(d) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function fmtIso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return fmtDate(new Date(y, m - 1, d));
}

const rupee = (n) => "\u20B9" + new Intl.NumberFormat("en-IN").format(Number(n) || 0);

/* ---------- Bills and status ---------- */

function billFor(room, ym) {
  const p = state.payments[`${room.id}_${ym}`] || null;
  const rent = p && p.rent != null ? Number(p.rent) : Number(room.rent);
  const electricity = p && p.electricity != null ? Number(p.electricity) : 0;
  return { p, rent, electricity, total: rent + electricity, paid: !!(p && p.paid) };
}

function statusFor(room, ym) {
  const b = billFor(room, ym);
  if (b.paid) return { key: "paid", label: "Paid" };
  const diff = daysBetween(dueDateFor(room, ym), startOfToday());
  if (diff < 0) {
    const n = -diff;
    return { key: "overdue", label: `Overdue by ${n} ${n === 1 ? "day" : "days"}` };
  }
  if (diff === 0) return { key: "soon", label: "Due today" };
  if (diff <= 3) return { key: "soon", label: `Due in ${diff} ${diff === 1 ? "day" : "days"}` };
  return { key: "upcoming", label: "Upcoming" };
}

/* ---------- Small DOM helpers ---------- */

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let toastTimer;
function toast(message, isError) {
  const t = $("#toast");
  t.textContent = message;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 4000);
}

function friendlyError(err) {
  if (err && err.code === "permission-denied") return "This account is not allowed to change the data.";
  return "Could not save. Check your internet connection and try again.";
}

function newToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- Form dialog ---------- */

function openForm(cfg) {
  const dlg = $("#dialog");
  dlg.replaceChildren();
  const inputs = {};
  const errorLine = h("p", { class: "form-error", role: "alert" });
  const form = h("form", { class: "form", novalidate: true });

  form.append(h("h2", { id: "dialog-title" }, cfg.title));
  if (cfg.intro) form.append(h("p", { class: "muted small" }, cfg.intro));

  for (const f of cfg.fields) {
    let input;
    const id = "f-" + f.name;
    if (f.type === "select") {
      input = h("select", { id, name: f.name },
        f.options.map((o) => h("option", { value: o.value, selected: o.value === f.value }, o.label)));
    } else if (f.type === "textarea") {
      input = h("textarea", { id, name: f.name, rows: f.rows || 6, placeholder: f.placeholder || "" });
      input.value = f.value == null ? "" : f.value;
    } else {
      input = h("input", {
        id, name: f.name, type: f.type || "text", inputmode: f.inputmode,
        min: f.min, max: f.max, placeholder: f.placeholder || "", autocomplete: "off"
      });
      input.value = f.value == null ? "" : f.value;
    }
    inputs[f.name] = input;
    form.append(h("label", { class: "field", for: id },
      h("span", {}, f.label), input, f.hint ? h("small", { class: "muted" }, f.hint) : null));
  }

  const submitBtn = h("button", { class: "btn primary", type: "submit" }, cfg.submitLabel || "Save");
  const cancelBtn = h("button", { class: "btn", type: "button", onclick: () => dlg.close() }, "Cancel");
  form.append(errorLine, h("div", { class: "form-actions" }, cancelBtn, submitBtn));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorLine.textContent = "";
    const values = {};
    for (const f of cfg.fields) values[f.name] = inputs[f.name].value.trim();
    const problem = cfg.validate ? cfg.validate(values) : null;
    if (problem) { errorLine.textContent = problem; return; }
    submitBtn.disabled = true;
    try {
      await cfg.onSubmit(values);
      dlg.close();
    } catch (err) {
      console.error(err);
      errorLine.textContent = friendlyError(err);
      submitBtn.disabled = false;
    }
  });

  dlg.append(form);
  dlg.showModal();
}

/* ---------- Tenant page data ---------- */

// Each room has one small document that the private tenant page reads.
// It only holds what that tenant needs to see.
function viewData(room, months) {
  return {
    roomNo: Number(room.roomNo),
    name: room.name,
    rent: Number(room.rent),
    dueDay: Number(room.dueDay),
    months,
    updatedAt: serverTimestamp()
  };
}

function monthsFor(roomId) {
  const months = {};
  for (const p of Object.values(state.payments)) {
    if (p.roomId !== roomId) continue;
    months[p.month] = {
      rent: Number(p.rent),
      electricity: Number(p.electricity || 0),
      paid: !!p.paid,
      paidOn: p.paidOn || null,
      method: p.method || null
    };
  }
  return months;
}

async function syncView(room) {
  try {
    await setDoc(doc(db, "tenantViews", room.token), viewData(room, monthsFor(room.id)));
  } catch (err) {
    console.error(err);
    toast("Saved, but the tenant page could not be updated. Try again.", true);
  }
}

/* ---------- Saving ---------- */

async function writePayment(room, ym, patch) {
  const id = `${room.id}_${ym}`;
  const prev = state.payments[id] || {};
  const base = {
    roomId: room.id,
    month: ym,
    rent: prev.rent != null ? prev.rent : Number(room.rent),
    electricity: prev.electricity != null ? prev.electricity : 0,
    paid: !!prev.paid
  };
  await setDoc(doc(db, "payments", id), { ...base, ...patch, updatedAt: serverTimestamp() }, { merge: true });
  state.payments[id] = { ...prev, ...base, ...patch };
  render();
  await syncView(room);
}

/* ---------- Actions ---------- */

function markPaid(room) {
  const b = billFor(room, state.ym);
  openForm({
    title: `Mark room ${room.roomNo} as paid`,
    intro: `${room.name} paid ${rupee(b.total)} for ${ymLabel(state.ym)}.`,
    fields: [
      { name: "method", label: "How did they pay?", type: "select", value: "upi",
        options: [{ value: "upi", label: "UPI (QR or app)" }, { value: "cash", label: "Cash" }] },
      { name: "paidOn", label: "Date paid", type: "date", value: todayIso() }
    ],
    submitLabel: "Mark paid",
    validate: (v) => (v.paidOn ? null : "Choose the date paid."),
    onSubmit: async (v) => {
      await writePayment(room, state.ym, { paid: true, method: v.method, paidOn: v.paidOn });
      toast(`Room ${room.roomNo} marked as paid.`);
    }
  });
}

async function undoPaid(room) {
  if (!window.confirm(`Undo the payment for room ${room.roomNo} (${ymLabel(state.ym)})?`)) return;
  try {
    await writePayment(room, state.ym, { paid: false, method: null, paidOn: null });
    toast(`Payment for room ${room.roomNo} undone.`);
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), true);
  }
}

function editBill(room) {
  const b = billFor(room, state.ym);
  openForm({
    title: `Bill for room ${room.roomNo}, ${ymLabel(state.ym)}`,
    intro: "Type the final electricity amount you calculated (units x 10).",
    fields: [
      { name: "rent", label: "Rent (\u20B9)", type: "number", inputmode: "numeric", min: 0, value: b.rent },
      { name: "electricity", label: "Electricity (\u20B9)", type: "number", inputmode: "numeric", min: 0, value: b.electricity }
    ],
    submitLabel: "Save bill",
    validate: (v) => {
      const rent = Number(v.rent);
      const electricity = Number(v.electricity === "" ? 0 : v.electricity);
      if (v.rent === "" || !Number.isFinite(rent) || rent < 0) return "Enter the rent.";
      if (!Number.isFinite(electricity) || electricity < 0) return "Electricity must be 0 or more.";
      return null;
    },
    onSubmit: async (v) => {
      await writePayment(room, state.ym, {
        rent: Number(v.rent),
        electricity: Number(v.electricity === "" ? 0 : v.electricity)
      });
      toast("Bill saved.");
    }
  });
}

function nextRoomNo() {
  return state.rooms.reduce((max, r) => Math.max(max, Number(r.roomNo) || 0), 0) + 1;
}

function normalizePhone(value) {
  return String(value || "").replace(/[\s+\-()]/g, "").replace(/^91(?=\d{10}$)/, "");
}

function editRoom(room) {
  const isNew = !room;
  const fields = [];
  if (isNew) {
    fields.push({ name: "roomNo", label: "Room number", type: "number", inputmode: "numeric", min: 1, value: nextRoomNo() });
  }
  fields.push(
    { name: "name", label: "Tenant name", value: room ? room.name : "" },
    { name: "phone", label: "Phone number", type: "tel", inputmode: "numeric", value: room ? room.phone || "" : "",
      hint: "10 digit mobile number. Used for the WhatsApp button." },
    { name: "rent", label: "Monthly rent (\u20B9)", type: "number", inputmode: "numeric", min: 0, value: room ? room.rent : "" },
    { name: "dueDay", label: "Due day of the month", type: "number", inputmode: "numeric", min: 1, max: 31,
      value: room ? room.dueDay : "", hint: "In shorter months the last day of the month is used." },
    { name: "advance", label: "Advance held (\u20B9)", type: "number", inputmode: "numeric", min: 0,
      value: room ? room.advance || 0 : 0, hint: "Only for a new tenant who paid an advance. Otherwise leave 0." }
  );

  openForm({
    title: isNew ? "Add room" : `Edit room ${room.roomNo}`,
    fields,
    submitLabel: "Save room",
    validate: (v) => {
      if (isNew) {
        const roomNo = Number(v.roomNo);
        if (!Number.isInteger(roomNo) || roomNo < 1) return "Enter a room number.";
        if (state.rooms.some((r) => Number(r.roomNo) === roomNo)) return "This room number already exists.";
      }
      if (!v.name) return "Enter the tenant name.";
      const phone = normalizePhone(v.phone);
      if (phone && !/^\d{10}$/.test(phone)) return "The phone number must have 10 digits.";
      const rent = Number(v.rent);
      if (v.rent === "" || !Number.isFinite(rent) || rent < 0) return "Enter the monthly rent.";
      const day = Number(v.dueDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) return "The due day must be between 1 and 31.";
      const advance = Number(v.advance === "" ? 0 : v.advance);
      if (!Number.isFinite(advance) || advance < 0) return "The advance must be 0 or more.";
      return null;
    },
    onSubmit: async (v) => {
      const roomNo = isNew ? Number(v.roomNo) : Number(room.roomNo);
      const id = isNew ? `room${roomNo}` : room.id;
      const data = {
        roomNo,
        name: v.name,
        phone: normalizePhone(v.phone),
        rent: Number(v.rent),
        dueDay: Number(v.dueDay),
        advance: Number(v.advance === "" ? 0 : v.advance),
        token: room && room.token ? room.token : newToken(),
        active: true
      };
      await setDoc(doc(db, "rooms", id), data, { merge: true });
      await syncView({ id, ...data });
      toast("Room saved.");
    }
  });
}

function importRooms() {
  openForm({
    title: "Import rooms",
    intro: "One-time setup. Paste the room list exactly as given.",
    fields: [{ name: "json", label: "Room list", type: "textarea", rows: 10 }],
    submitLabel: "Import rooms",
    validate: (v) => {
      let list;
      try { list = JSON.parse(v.json); } catch { return "This is not a valid list. Paste it exactly as given."; }
      if (!Array.isArray(list) || list.length === 0) return "The list is empty.";
      for (const r of list) {
        const ok = Number.isInteger(r.roomNo) && r.name && Number.isFinite(r.rent) &&
          Number.isInteger(r.dueDay) && r.dueDay >= 1 && r.dueDay <= 31;
        if (!ok) return `Check room ${r.roomNo == null ? "?" : r.roomNo}: room number, name, rent and due day are required.`;
      }
      return null;
    },
    onSubmit: async (v) => {
      const list = JSON.parse(v.json);
      const batch = writeBatch(db);
      for (const r of list) {
        const data = {
          roomNo: r.roomNo,
          name: String(r.name),
          phone: normalizePhone(r.phone),
          rent: r.rent,
          dueDay: r.dueDay,
          advance: Number(r.advance || 0),
          token: newToken(),
          active: true
        };
        batch.set(doc(db, "rooms", `room${r.roomNo}`), data);
        batch.set(doc(db, "tenantViews", data.token), viewData(data, {}));
      }
      await batch.commit();
      toast("Rooms imported.");
    }
  });
}

function tenantLink(room) {
  const page = new URL("tenant.html", location.href);
  page.search = "t=" + room.token;
  return page.toString();
}

async function copyTenantLink(room) {
  const link = tenantLink(room);
  try {
    await navigator.clipboard.writeText(link);
    toast(`Link for room ${room.roomNo} copied.`);
  } catch (err) {
    window.prompt("Copy this link:", link);
  }
}

function whatsappLink(room, ym) {
  const digits = normalizePhone(room.phone);
  const number = digits.length === 10 ? "91" + digits : digits;
  const b = billFor(room, ym);
  const due = fmtDate(dueDateFor(room, ym));
  const page = tenantLink(room);
  const text =
    `\u0928\u092E\u0938\u094D\u0924\u0947 ${room.name}, \u0915\u092E\u0930\u093E ${room.roomNo} \u0915\u093E \u0915\u093F\u0930\u093E\u092F\u093E ${rupee(b.total)} \u0939\u0948\u0964 \u0905\u0902\u0924\u093F\u092E \u0924\u093F\u0925\u093F: ${due}\u0964\n` +
    `\u092D\u0941\u0917\u0924\u093E\u0928 \u0914\u0930 \u0935\u093F\u0935\u0930\u0923: ${page}\n\n` +
    `Hello ${room.name}, rent for room ${room.roomNo} is ${rupee(b.total)}, due on ${due}.\n` +
    `Pay and view details: ${page}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/* ---------- Views ---------- */

function loginView() {
  return h("section", { class: "panel" },
    h("h1", {}, "Rent Tracker"),
    h("p", { class: "muted" }, "For family use only. Sign in with your Google account."),
    state.loginError ? h("p", { class: "error-text", role: "alert" }, state.loginError) : null,
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: login }, "Sign in with Google"))
  );
}

function deniedView() {
  return h("section", { class: "panel" },
    h("h1", {}, "This account is not allowed"),
    h("p", {}, `You are signed in as ${state.user.email}. Only the family accounts can open this page.`),
    h("div", { class: "actions" }, h("button", { class: "btn primary", onclick: () => signOut(auth) }, "Sign out and use another account"))
  );
}

function roomCard(room) {
  const ym = state.ym;
  const b = billFor(room, ym);
  const st = statusFor(room, ym);
  const due = dueDateFor(room, ym);
  let meta = `Due ${fmtDate(due)}`;
  if (b.paid) {
    const how = b.p.method === "cash" ? "cash" : "UPI";
    meta = b.p.paidOn ? `Paid on ${fmtIso(b.p.paidOn)} by ${how}` : `Paid by ${how}`;
  }

  const buttons = [];
  if (b.paid) {
    buttons.push(h("button", { class: "btn", onclick: () => undoPaid(room) }, "Undo payment"));
  } else {
    buttons.push(h("button", { class: "btn primary", onclick: () => markPaid(room) }, "Mark paid"));
    if (normalizePhone(room.phone)) {
      buttons.push(h("a", { class: "btn", href: whatsappLink(room, ym), target: "_blank", rel: "noopener" }, "Send on WhatsApp"));
    } else {
      buttons.push(h("button", { class: "btn", onclick: () => editRoom(room) }, "Add phone number"));
    }
  }
  buttons.push(h("button", { class: "btn", onclick: () => editBill(room) }, "Edit bill"));
  buttons.push(h("button", { class: "btn", onclick: () => copyTenantLink(room) }, "Copy tenant link"));
  buttons.push(h("button", { class: "btn", onclick: () => editRoom(room) }, "Edit tenant"));

  return h("li", { class: "room " + st.key },
    h("div", { class: "room-head" },
      h("div", {}, h("h2", {}, `Room ${room.roomNo}`), h("p", { class: "tenant" }, room.name)),
      h("span", { class: "pill " + st.key }, st.label)),
    h("p", { class: "amount" }, rupee(b.total)),
    h("p", { class: "muted small" }, `Rent ${rupee(b.rent)} + Electricity ${rupee(b.electricity)}`),
    h("p", { class: "muted small" }, meta),
    Number(room.advance) > 0 ? h("p", { class: "muted small" }, `Advance held: ${rupee(room.advance)}`) : null,
    h("div", { class: "actions" }, buttons)
  );
}

function dashboardView() {
  const frag = document.createDocumentFragment();

  frag.append(h("header", { class: "top" },
    h("div", {}, h("h1", {}, "Rent Tracker"), h("p", { class: "muted small" }, state.user.email)),
    h("button", { class: "btn ghost", onclick: () => signOut(auth) }, "Sign out")));

  frag.append(h("div", { class: "month" },
    h("button", { class: "btn", "aria-label": "Previous month", onclick: () => { state.ym = shiftYm(state.ym, -1); render(); } }, "<"),
    h("strong", {}, ymLabel(state.ym)),
    h("button", { class: "btn", "aria-label": "Next month", onclick: () => { state.ym = shiftYm(state.ym, 1); render(); } }, ">")));

  if (!state.loaded.rooms || !state.loaded.payments) {
    frag.append(h("p", { class: "muted", style: "margin-top:16px" }, "Loading..."));
    return frag;
  }

  const rooms = [...state.rooms].sort((a, b) => Number(a.roomNo) - Number(b.roomNo));

  if (rooms.length === 0) {
    frag.append(h("section", { class: "panel" },
      h("h2", {}, "No rooms yet"),
      h("p", { class: "muted" }, "Import the room list once, or add rooms one by one."),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: importRooms }, "Import rooms"),
        h("button", { class: "btn", onclick: () => editRoom(null) }, "Add a room"))));
    return frag;
  }

  let collected = 0, pending = 0, paidCount = 0;
  for (const room of rooms) {
    const b = billFor(room, state.ym);
    if (b.paid) { collected += b.total; paidCount += 1; } else { pending += b.total; }
  }

  frag.append(h("div", { class: "summary" },
    h("div", {}, h("span", { class: "muted small" }, "Collected"), h("strong", {}, rupee(collected))),
    h("div", {}, h("span", { class: "muted small" }, "Pending"), h("strong", {}, rupee(pending))),
    h("div", {}, h("span", { class: "muted small" }, "Rooms paid"), h("strong", {}, `${paidCount} of ${rooms.length}`))));

  frag.append(h("ul", { class: "rooms" }, rooms.map(roomCard)));

  frag.append(h("div", { class: "actions", style: "margin-top:16px" },
    h("button", { class: "btn", onclick: () => editRoom(null) }, "Add room")));

  return frag;
}

function render() {
  root.replaceChildren();
  if (!state.user) { root.append(loginView()); return; }
  if (state.denied) { root.append(deniedView()); return; }
  root.append(dashboardView());
}

/* ---------- Sign in and live data ---------- */

async function login() {
  state.loginError = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error(err);
    if (err.code !== "auth/popup-closed-by-user" && err.code !== "auth/cancelled-popup-request") {
      state.loginError = err.code === "auth/unauthorized-domain"
        ? "This web address is not added in Firebase yet. Add it under Authentication, Settings, Authorized domains."
        : "Could not sign in. Allow pop-ups for this page and try again.";
    }
    render();
  }
}

function stopListening() {
  state.unsubs.forEach((u) => u());
  state.unsubs = [];
}

function onListenError(err) {
  console.error(err);
  if (err.code === "permission-denied") state.denied = true;
  else toast("Could not load the data. Check your internet connection.", true);
  render();
}

function startListening() {
  state.unsubs.push(onSnapshot(collection(db, "rooms"), (snap) => {
    state.rooms = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded.rooms = true;
    render();
  }, onListenError));

  state.unsubs.push(onSnapshot(collection(db, "payments"), (snap) => {
    state.payments = {};
    snap.docs.forEach((d) => { state.payments[d.id] = d.data(); });
    state.loaded.payments = true;
    render();
  }, onListenError));
}

onAuthStateChanged(auth, (user) => {
  stopListening();
  state.user = user;
  state.denied = false;
  state.rooms = [];
  state.payments = {};
  state.loaded = { rooms: false, payments: false };
  if (user) startListening();
  render();
});

render();
