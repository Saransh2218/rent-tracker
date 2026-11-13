import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { firebaseConfig, UPI } from "./firebase-config.js";
import { computeDues, buildUpiLink } from "./tenant-logic.js";
import { pushPossible, pushSupported, getPushToken, dropPushToken, onForegroundMessage, deviceId } from "./push.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const root = document.getElementById("app");
const token = new URLSearchParams(location.search).get("t") || "";

const state = { view: null, status: "loading", lang: loadLang(), push: initialPush(), watching: false, refreshed: false };

/* ---------- Text in both languages ---------- */

const T = {
  hi: {
    pageTitle: "किराया विवरण",
    room: (n) => `कमरा ${n}`,
    switchTo: "English",
    toPay: "भुगतान की राशि",
    allPaid: "सब चुकता है",
    paidPill: "चुकता",
    overdue: (n) => `${n} दिन की देरी`,
    today: "आज अंतिम तिथि है",
    soon: (n) => `${n} दिन में देय`,
    upcoming: "आगामी",
    dueOn: (d) => `अंतिम तिथि: ${d}`,
    rent: "किराया",
    electricity: "बिजली",
    nextRent: (a, d) => `अगला किराया ${a}, अंतिम तिथि ${d}`,
    payTitle: "UPI से भुगतान करें",
    scanHelp: "किसी भी UPI ऐप से यह QR कोड स्कैन करें। राशि पहले से भरी होगी।",
    openApp: "UPI ऐप खोलें",
    upiId: "UPI आईडी",
    copy: "कॉपी करें",
    copied: "कॉपी हो गया",
    copyFail: "कॉपी नहीं हुआ। आईडी दबाकर कॉपी करें।",
    afterPay: "भुगतान के बाद मालिक इसे यहाँ चुकता दर्ज करेंगे। इसमें थोड़ा समय लग सकता है।",
    cash: "नकद देना हो तो मालिक को दें, वे इसे चुकता दर्ज करेंगे।",
    history: "भुगतान का इतिहास",
    noHistory: "अभी कोई भुगतान दर्ज नहीं है।",
    paidOn: (d, m) => (d ? `${d} को ${m} से चुकाया` : `${m} से चुकाया`),
    upi: "UPI",
    cashWord: "नकद",
    invalid: "यह लिंक सही नहीं है। मालिक से नया लिंक माँगें।",
    loading: "लोड हो रहा है...",
    loadError: "पेज लोड नहीं हुआ। इंटरनेट जाँचें और दोबारा खोलें।",
    firstRent: (d) => `आपका पहला किराया ${d} को देय है`,
    remindTitle: "इस फ़ोन पर याद दिलाना",
    remindHelp: "अंतिम तिथि से 3 दिन पहले, अंतिम तिथि पर, और उसके बाद हर दिन किराया चुकता होने तक सूचना पाएँ।",
    turnOn: "याद दिलाना चालू करें",
    turnOff: "बंद करें",
    remindOn: "इस फ़ोन पर याद दिलाना चालू है।",
    working: "चालू हो रहा है...",
    unsupported: "इस फ़ोन के ब्राउज़र में सूचना नहीं चल सकती। iPhone पर पहले इस पेज को होम स्क्रीन में जोड़ें। मालिक WhatsApp पर भी याद दिला सकते हैं।",
    denied: "सूचना की अनुमति बंद है। ब्राउज़र की साइट सेटिंग में सूचना की अनुमति दें और पेज दोबारा खोलें।",
    pushError: "चालू नहीं हो सका। इंटरनेट जाँचकर दोबारा कोशिश करें।",
    pushOnToast: "याद दिलाना चालू हो गया",
    pushOffToast: "याद दिलाना बंद हो गया"
  },
  en: {
    pageTitle: "Rent details",
    room: (n) => `Room ${n}`,
    switchTo: "हिंदी",
    toPay: "Amount to pay",
    allPaid: "All paid",
    paidPill: "Paid",
    overdue: (n) => `Overdue by ${n} ${n === 1 ? "day" : "days"}`,
    today: "Due today",
    soon: (n) => `Due in ${n} ${n === 1 ? "day" : "days"}`,
    upcoming: "Upcoming",
    dueOn: (d) => `Due on ${d}`,
    rent: "Rent",
    electricity: "Electricity",
    nextRent: (a, d) => `Next rent ${a}, due on ${d}`,
    payTitle: "Pay with UPI",
    scanHelp: "Scan this QR code with any UPI app. The amount is filled in for you.",
    openApp: "Open UPI app",
    upiId: "UPI ID",
    copy: "Copy",
    copied: "Copied",
    copyFail: "Could not copy. Press and hold the ID to copy it.",
    afterPay: "After you pay, the owner marks it as paid here. This can take some time.",
    cash: "Paying cash? Give it to the owner and they will mark it as paid.",
    history: "Payment history",
    noHistory: "No payments recorded yet.",
    paidOn: (d, m) => (d ? `Paid on ${d} by ${m}` : `Paid by ${m}`),
    upi: "UPI",
    cashWord: "cash",
    invalid: "This link is not valid. Ask the owner for a new link.",
    loading: "Loading...",
    loadError: "Could not load the page. Check your internet connection and reload.",
    firstRent: (d) => `Your first rent is due on ${d}`,
    remindTitle: "Reminders on this phone",
    remindHelp: "Get a notification 3 days before the due date, on the due date, and every day after it until the rent is paid.",
    turnOn: "Turn on reminders",
    turnOff: "Turn off",
    remindOn: "Reminders are on for this phone.",
    working: "Turning on...",
    unsupported: "This phone's browser cannot show notifications. On iPhone, first add this page to the Home Screen. The owner can also remind you on WhatsApp.",
    denied: "Notifications are blocked. Allow notifications for this site in your browser settings and reopen the page.",
    pushError: "Could not turn on reminders. Check your internet connection and try again.",
    pushOnToast: "Reminders are on",
    pushOffToast: "Reminders are off"
  }
};

const t = () => T[state.lang];
const locale = () => (state.lang === "hi" ? "hi-IN" : "en-IN");

function loadLang() {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "hi" || saved === "en") return saved;
  } catch (e) { /* storage can be blocked, Hindi is the default */ }
  return "hi";
}

function saveLang(lang) {
  try { localStorage.setItem("lang", lang); } catch (e) { /* ignore */ }
}

/* ---------- Formatting ---------- */

const rupee = (n) => "\u20B9" + new Intl.NumberFormat("en-IN").format(Number(n) || 0);
const fmtDay = (d) => d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
const ymDate = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(y, m - 1, 1); };
const fmtMonth = (ym) => ymDate(ym).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const fmtMonthAscii = (ym) => ymDate(ym).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
const fmtIso = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return fmtDay(new Date(y, m - 1, d));
};

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
function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = "toast show";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3000);
}

/* ---------- Reminders ---------- */

function initialPush() {
  if (!pushPossible()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  let saved = false;
  try { saved = localStorage.getItem("push") === "1"; } catch (e) { /* ignore */ }
  return saved && Notification.permission === "granted" ? "on" : "off";
}

// Saves this phone's notification code against this tenant page.
async function saveDevice() {
  const code = await getPushToken(app);
  if (!code) throw new Error("No notification code received");
  const id = await deviceId(code);
  await setDoc(doc(db, "devices", id), {
    viewToken: token,
    fcmToken: code,
    lang: state.lang,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function watchForeground() {
  if (state.watching) return;
  state.watching = true;
  onForegroundMessage(app, (n) => toast([n.title, n.body].filter(Boolean).join(": ")));
}

async function turnOnReminders() {
  state.push = "working";
  render();
  try {
    if (!(await pushSupported())) { state.push = "unsupported"; render(); return; }
    const permission = await Notification.requestPermission();
    if (permission === "denied") { state.push = "denied"; render(); return; }
    if (permission !== "granted") { state.push = "off"; render(); return; }
    await saveDevice();
    try { localStorage.setItem("push", "1"); } catch (e) { /* ignore */ }
    state.push = "on";
    watchForeground();
    toast(t().pushOnToast);
  } catch (err) {
    console.error(err);
    state.push = "error";
  }
  render();
}

async function turnOffReminders() {
  await dropPushToken(app);
  try { localStorage.removeItem("push"); } catch (e) { /* ignore */ }
  state.push = "off";
  toast(t().pushOffToast);
  render();
}

/* ---------- Views ---------- */

function statusLabel(status) {
  switch (status.key) {
    case "paid": return t().paidPill;
    case "overdue": return t().overdue(status.days);
    case "today": return t().today;
    case "soon": return t().soon(status.days);
    default: return t().upcoming;
  }
}

function pillClass(key) {
  if (key === "paid") return "paid";
  if (key === "overdue") return "overdue";
  if (key === "today" || key === "soon") return "soon";
  return "upcoming";
}

function langButton() {
  return h("button", {
    class: "btn",
    lang: state.lang === "hi" ? "en" : "hi",
    onclick: () => {
      state.lang = state.lang === "hi" ? "en" : "hi";
      saveLang(state.lang);
      render();
      if (state.push === "on") saveDevice().catch((err) => console.error(err));
    }
  }, t().switchTo);
}

function qrNode(text) {
  const box = h("div", { class: "qr-box", role: "img", "aria-label": "UPI QR" });
  try {
    const qr = window.qrcode(0, "M");
    qr.addData(text);
    qr.make();
    // The QR library builds this markup from the payment text only.
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (err) {
    console.error(err);
    return null;
  }
  return box;
}

async function copyUpiId() {
  try {
    await navigator.clipboard.writeText(UPI.id);
    toast(t().copied);
  } catch (err) {
    toast(t().copyFail);
  }
}

function paySection(info, view) {
  const label = info.dues.length === 1
    ? fmtMonthAscii(info.dues[0].ym)
    : `${fmtMonthAscii(info.dues[0].ym)} - ${fmtMonthAscii(info.dues[info.dues.length - 1].ym)}`;
  const link = buildUpiLink({
    id: UPI.id,
    name: UPI.name,
    amount: info.totalDue,
    note: `Room ${view.roomNo} rent ${label}`
  });
  const qr = qrNode(link);

  return h("section", { class: "section" },
    h("h2", {}, t().payTitle),
    h("p", { class: "muted small" }, t().scanHelp),
    qr,
    h("div", { class: "pay-actions" },
      h("a", { class: "btn primary", href: link }, `${t().openApp} (${rupee(info.totalDue)})`)),
    h("div", { class: "upi-row" },
      h("div", {}, h("span", { class: "muted small" }, t().upiId), h("br"), h("code", {}, UPI.id)),
      h("button", { class: "btn", onclick: copyUpiId }, t().copy)),
    h("p", { class: "muted small" }, t().afterPay),
    h("p", { class: "muted small" }, t().cash)
  );
}

function remindSection() {
  const s = state.push;
  const box = h("section", { class: "section" }, h("h2", {}, t().remindTitle));
  if (s === "on") {
    box.append(
      h("p", { class: "muted small" }, t().remindOn),
      h("button", { class: "btn", onclick: turnOffReminders }, t().turnOff));
  } else if (s === "unsupported") {
    box.append(h("p", { class: "muted small" }, t().unsupported));
  } else if (s === "denied") {
    box.append(h("p", { class: "muted small" }, t().denied));
  } else {
    box.append(h("p", { class: "muted small" }, t().remindHelp));
    if (s === "error") box.append(h("p", { class: "error-text", role: "alert" }, t().pushError));
    box.append(h("button", { class: "btn primary", disabled: s === "working", onclick: turnOnReminders },
      s === "working" ? t().working : t().turnOn));
  }
  return box;
}

function historySection(info) {
  const items = info.history.slice(0, 6);
  return h("section", { class: "section" },
    h("h2", {}, t().history),
    items.length
      ? h("ul", { class: "history" }, items.map((p) => {
          const how = p.method === "cash" ? t().cashWord : t().upi;
          return h("li", {},
            h("div", { class: "row" }, h("span", {}, fmtMonth(p.ym)), h("span", {}, rupee(p.total))),
            h("span", { class: "muted small" }, t().paidOn(p.paidOn ? fmtIso(p.paidOn) : "", how)));
        }))
      : h("p", { class: "muted" }, t().noHistory));
}

function tenantView(view) {
  const info = computeDues(view, new Date());
  const frag = document.createDocumentFragment();

  frag.append(h("header", { class: "t-top" },
    h("div", {}, h("h1", {}, t().room(view.roomNo)), h("p", { class: "tenant muted" }, view.name)),
    langButton()));

  const key = pillClass(info.status.key);
  const card = h("section", { class: "due-card " + key });

  if (info.notStarted) {
    card.append(
      h("p", { class: "muted small" }, t().firstRent(fmtDay(info.next.due))),
      h("p", { class: "amount" }, rupee(info.next.amount)),
      h("span", { class: "pill upcoming" }, t().upcoming));
  } else if (info.dues.length === 0) {
    card.append(
      h("p", { class: "muted small" }, t().allPaid),
      h("p", { class: "amount" }, rupee(0)),
      h("span", { class: "pill paid" }, t().paidPill),
      h("p", { class: "muted small" }, t().nextRent(rupee(info.next.amount), fmtDay(info.next.due))));
  } else {
    card.append(
      h("p", { class: "muted small" }, t().toPay),
      h("p", { class: "amount" }, rupee(info.totalDue)),
      h("span", { class: "pill " + key }, statusLabel(info.status)),
      h("p", { class: "muted small" }, t().dueOn(fmtDay(info.dues[0].due))),
      h("ul", { class: "breakdown" }, info.dues.map((d) =>
        h("li", {},
          h("div", {},
            h("div", {}, fmtMonth(d.ym)),
            h("div", { class: "sub" }, `${t().rent} ${rupee(d.rent)} + ${t().electricity} ${rupee(d.electricity)}`)),
          h("strong", {}, rupee(d.total))))));
  }
  frag.append(card);

  if (info.dues.length > 0) frag.append(paySection(info, view));
  frag.append(remindSection());
  frag.append(historySection(info));
  return frag;
}

function message(text) {
  return h("section", { class: "panel" }, h("h1", {}, text), h("div", { class: "actions" }, langButton()));
}

function render() {
  document.documentElement.lang = state.lang;
  document.title = t().pageTitle;
  root.replaceChildren();
  if (state.status === "loading") root.append(h("p", { class: "muted" }, t().loading));
  else if (state.status === "invalid") root.append(message(t().invalid));
  else if (state.status === "error") root.append(message(t().loadError));
  else root.append(tenantView(state.view));
}

/* ---------- Live data ---------- */

if (!/^[0-9a-f]{32}$/.test(token)) {
  state.status = "invalid";
  render();
} else {
  render();
  onSnapshot(doc(db, "tenantViews", token), (snap) => {
    if (!snap.exists()) { state.status = "invalid"; state.view = null; }
    else {
      state.status = "ready";
      state.view = snap.data();
      if (state.push === "on" && !state.refreshed) {
        state.refreshed = true;
        watchForeground();
        saveDevice().catch((err) => console.error(err));
      }
    }
    render();
  }, (err) => {
    console.error(err);
    state.status = "error";
    render();
  });
}
