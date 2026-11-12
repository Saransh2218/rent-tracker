// Works out who gets which notification today. No network code here,
// so it can be tested on its own.
import { computeDues } from "../tenant-logic.js";

const rupee = (n) => "\u20B9" + new Intl.NumberFormat("en-IN").format(Number(n) || 0);

// Today's date in India, as a local date at midnight, whatever the
// time zone of the computer running this is.
export function istToday(now = new Date()) {
  const iso = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [y, m, d] = iso.split("-").map(Number);
  return { iso, date: new Date(y, m - 1, d) };
}

// Which reminder fits today, or null for none:
// 3 days before the due date, on the due date, and every day after it.
export function reminderKind(status) {
  if (status.key === "overdue") return "overdue";
  if (status.key === "today") return "today";
  if (status.key === "soon" && status.days === 3) return "before";
  return null;
}

function monthsFor(payments, roomId) {
  const months = {};
  for (const p of payments) {
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

const fmtDay = (d, locale) => d.toLocaleDateString(locale, { day: "numeric", month: "short" });

export function tenantMessage({ room, info, kind, lang, siteUrl }) {
  const n = room.roomNo;
  const amount = rupee(info.totalDue);
  const due = fmtDay(info.dues[0].due, lang === "hi" ? "hi-IN" : "en-IN");
  const days = info.status.days;
  const link = `${siteUrl}tenant.html?t=${room.token}`;

  if (lang === "hi") {
    if (kind === "before") return { title: "किराया याद दिलाना", body: `कमरा ${n}: ${amount} का किराया ${due} को देय है (3 दिन बाकी)।`, link };
    if (kind === "today") return { title: "आज किराया देय है", body: `कमरा ${n}: ${amount} आज देय है। भुगतान के लिए दबाएँ।`, link };
    return { title: "किराया बकाया है", body: `कमरा ${n}: ${amount} बकाया है, ${days} दिन की देरी। भुगतान के लिए दबाएँ।`, link };
  }
  if (kind === "before") return { title: "Rent reminder", body: `Room ${n}: ${amount} rent is due on ${due} (3 days left).`, link };
  if (kind === "today") return { title: "Rent is due today", body: `Room ${n}: ${amount} is due today. Tap to pay.`, link };
  return { title: "Rent is overdue", body: `Room ${n}: ${amount} is overdue by ${days} ${days === 1 ? "day" : "days"}. Tap to pay.`, link };
}

export function summaryMessage({ rows, today, siteUrl }) {
  const total = rows.length;
  const paid = rows.filter((r) => r.info.dues.length === 0).length;
  const pending = rows.reduce((sum, r) => sum + r.info.totalDue, 0);
  const overdue = rows.filter((r) => r.info.status.key === "overdue")
    .map((r) => `Room ${r.room.roomNo} (${r.info.status.days} ${r.info.status.days === 1 ? "day" : "days"})`);
  const dueToday = rows.filter((r) => r.info.status.key === "today").map((r) => `Room ${r.room.roomNo}`);
  const soon = rows.filter((r) => r.info.status.key === "soon" && r.info.status.days >= 1)
    .map((r) => `Room ${r.room.roomNo} (in ${r.info.status.days} ${r.info.status.days === 1 ? "day" : "days"})`);

  const lines = [paid === total
    ? `All ${total} rooms are paid.`
    : `Paid ${paid} of ${total}. Pending ${rupee(pending)}.`];
  if (overdue.length) lines.push(`Overdue: ${overdue.join(", ")}.`);
  if (dueToday.length) lines.push(`Due today: ${dueToday.join(", ")}.`);
  if (soon.length) lines.push(`Due soon: ${soon.join(", ")}.`);

  return {
    title: `Rent summary, ${fmtDay(today.date, "en-IN")}`,
    body: lines.join(" "),
    link: siteUrl
  };
}

// Everything the sender needs, built from the database contents.
export function buildPlan({ rooms, payments, devices, familyDevices, now, siteUrl }) {
  const today = istToday(now);
  const sorted = [...rooms].filter((r) => r.active !== false)
    .sort((a, b) => Number(a.roomNo) - Number(b.roomNo));

  const rows = sorted.map((room) => ({
    room,
    info: computeDues({ rent: room.rent, dueDay: room.dueDay, months: monthsFor(payments, room.id) }, today.date)
  }));

  const tenantSends = [];
  for (const { room, info } of rows) {
    const kind = info.dues.length ? reminderKind(info.status) : null;
    if (!kind) continue;
    for (const device of devices.filter((d) => d.viewToken === room.token)) {
      const lang = device.lang === "en" ? "en" : "hi";
      tenantSends.push({
        collection: "devices",
        deviceId: device.id,
        token: device.fcmToken,
        roomNo: room.roomNo,
        kind,
        message: tenantMessage({ room, info, kind, lang, siteUrl })
      });
    }
  }

  const summary = summaryMessage({ rows, today, siteUrl });
  const familySends = familyDevices.map((d) => ({
    collection: "familyDevices",
    deviceId: d.id,
    token: d.fcmToken,
    message: summary
  }));

  return { today: today.iso, tenantSends, familySends, summary };
}
