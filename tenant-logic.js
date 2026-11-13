// Pure helper functions for the tenant page. No Firebase code here,
// so they can be tested on their own.

export function pad(n) { return String(n).padStart(2, "0"); }

export function ymOf(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function shiftYm(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}

// Due date for a month. Short months use their last day
// (for example day 30 becomes 28 or 29 in February).
export function dueDateFor(dueDay, ym) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return new Date(y, m - 1, Math.min(Number(dueDay), daysInMonth));
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function daysBetween(a, b) { return Math.round((a - b) / 86400000); }

// What the tenant owes: the current month plus any earlier month that
// the owner has recorded as unpaid. Months with no record before the
// current one are treated as settled. If "since" is set, it is the first
// month this tenant pays rent, and earlier months never count.
export function computeDues(view, now) {
  const today = startOfDay(now);
  const cur = ymOf(today);
  const months = view.months || {};
  const since = view.since || null;
  const notStarted = !!since && cur < since;
  const keys = new Set(Object.keys(months).filter((k) => k <= cur && (!since || k >= since)));
  if (!notStarted) keys.add(cur);

  const dues = [];
  const history = [];
  for (const ym of [...keys].sort()) {
    const m = months[ym];
    const rent = m && m.rent != null ? Number(m.rent) : Number(view.rent);
    const electricity = m && m.electricity != null ? Number(m.electricity) : 0;
    const paid = !!(m && m.paid);
    const total = rent + electricity;
    if (paid) {
      history.push({ ym, total, paidOn: m.paidOn || null, method: m.method || null });
    } else {
      dues.push({ ym, rent, electricity, total, due: dueDateFor(view.dueDay, ym) });
    }
  }
  history.sort((a, b) => (a.ym < b.ym ? 1 : -1));

  const totalDue = dues.reduce((sum, d) => sum + d.total, 0);
  let status = { key: "paid" };
  if (dues.length) {
    const earliest = dues[0].due;
    const diff = daysBetween(earliest, today);
    if (diff < 0) status = { key: "overdue", days: -diff };
    else if (diff === 0) status = { key: "today" };
    else if (diff <= 3) status = { key: "soon", days: diff };
    else status = { key: "upcoming", days: diff };
  }

  const nextYm = notStarted ? since : shiftYm(cur, 1);
  const next = {
    ym: nextYm,
    amount: months[nextYm] && months[nextYm].rent != null ? Number(months[nextYm].rent) : Number(view.rent),
    due: dueDateFor(view.dueDay, nextYm)
  };

  return { dues, history, totalDue, status, next, cur, notStarted };
}

// Standard UPI payment link. The same text goes into the QR code.
export function buildUpiLink({ id, name, amount, note }) {
  const params = [
    ["pa", id],
    ["pn", name],
    ["am", Number(amount).toFixed(2)],
    ["cu", "INR"],
    ["tn", note]
  ];
  // The "@" in a UPI ID is kept as it is, because some UPI apps do not
  // read it when it is written as %40.
  return "upi://pay?" + params
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, "@")}`)
    .join("&");
}
