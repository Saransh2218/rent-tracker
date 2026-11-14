// Arranges the rent records into sheets for the Excel file.
// No browser or Firebase code here, so it can be tested on its own.

const pad = (n) => String(n).padStart(2, "0");

const bold = (value) => ({ value, fontWeight: "bold" });
const text = (value) => (value === null || value === undefined || value === "" ? null : { value: String(value), type: String });
const money = (value) => ({ value: Number(value) || 0, type: Number, format: "#,##0" });
const boldMoney = (value) => ({ ...money(value), fontWeight: "bold" });

function sheet(name, headers, rows, widths) {
  return {
    sheet: name,
    data: [headers.map(bold), ...rows],
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1
  };
}

function methodLabel(method) {
  if (method === "cash") return "Cash";
  if (method === "upi") return "UPI";
  return "";
}

// Due date for a month. Short months use their last day.
function dueDateIso(dueDay, ym) {
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return `${ym}-${pad(Math.min(Number(dueDay), daysInMonth))}`;
}

const byRoomNo = (a, b) => Number(a.roomNo) - Number(b.roomNo);

// rooms: list of rooms. payments: object keyed by "roomId_YYYY-MM", or a list.
// past: list of past tenant records. ym: the month for the month report.
export function buildSheets({ rooms, payments, past, ym }) {
  const roomList = [...rooms].sort(byRoomNo);
  const paymentList = Array.isArray(payments) ? payments : Object.values(payments);
  const paymentById = {};
  for (const p of paymentList) paymentById[`${p.roomId}_${p.month}`] = p;
  const roomById = Object.fromEntries(roomList.map((r) => [r.id, r]));

  // 1. Month report: every room that is paying rent in the chosen month.
  const tracked = roomList.filter((r) => !r.vacant && !(r.since && ym < r.since));
  let billed = 0;
  let collected = 0;
  const monthRows = tracked.map((r) => {
    const p = paymentById[`${r.id}_${ym}`];
    const rent = p && p.rent != null ? Number(p.rent) : Number(r.rent);
    const electricity = p && p.electricity != null ? Number(p.electricity) : 0;
    const total = rent + electricity;
    const paid = !!(p && p.paid);
    billed += total;
    if (paid) collected += total;
    return [
      money(r.roomNo), text(r.name), text(r.phone), text(dueDateIso(r.dueDay, ym)),
      money(rent), money(electricity), money(total),
      text(paid ? "Paid" : "Unpaid"), text(paid ? p.paidOn : ""), text(paid ? methodLabel(p.method) : "")
    ];
  });
  const blank = [null, null, null, null, null, null, null, null, null, null];
  const sumRow = (label, value) => [null, bold(label), null, null, null, null, boldMoney(value), null, null, null];
  monthRows.push(blank, sumRow("Billed", billed), sumRow("Collected", collected), sumRow("Pending", billed - collected));

  const monthSheet = sheet(`Report ${ym}`,
    ["Room", "Tenant", "Phone", "Due date", "Rent", "Electricity", "Total", "Status", "Paid on", "Method"],
    monthRows, [7, 26, 14, 12, 10, 12, 10, 10, 12, 10]);

  // 2. All recorded payments of current tenants, newest month first.
  const paymentRows = paymentList
    .filter((p) => roomById[p.roomId])
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : byRoomNo(roomById[a.roomId], roomById[b.roomId])))
    .map((p) => {
      const r = roomById[p.roomId];
      const rent = Number(p.rent) || 0;
      const electricity = Number(p.electricity) || 0;
      return [
        money(r.roomNo), text(r.name), text(p.month), money(rent), money(electricity), money(rent + electricity),
        text(p.paid ? "Paid" : "Unpaid"), text(p.paid ? p.paidOn : ""), text(p.paid ? methodLabel(p.method) : "")
      ];
    });
  const paymentsSheet = sheet("All payments",
    ["Room", "Tenant", "Month", "Rent", "Electricity", "Total", "Status", "Paid on", "Method"],
    paymentRows, [7, 26, 10, 10, 12, 10, 10, 12, 10]);

  // 3. Current tenants and rooms.
  const tenantRows = roomList.map((r) => {
    let status = "Occupied";
    if (r.vacant) status = "Vacant";
    else if (r.since && ym < r.since) status = `Rent starts ${r.since}`;
    return [
      money(r.roomNo), text(r.vacant ? "" : r.name), text(r.phone), money(r.rent), money(r.dueDay),
      money(r.vacant ? 0 : r.advance || 0), text(r.since), text(status)
    ];
  });
  const tenantsSheet = sheet("Tenants",
    ["Room", "Tenant", "Phone", "Rent", "Due day", "Advance held", "First rent month", "Status"],
    tenantRows, [7, 26, 14, 10, 9, 14, 17, 18]);

  // 4. Tenants who moved out, most recent first.
  const pastList = [...past].sort((a, b) => String(b.movedOut || "").localeCompare(String(a.movedOut || "")));
  const pastRows = pastList.map((p) => [
    money(p.roomNo), text(p.name), text(p.phone), money(p.rent), money(p.dueDay), text(p.since), text(p.movedOut),
    money(p.advance), money(p.advanceReturned), text(p.note), money(p.outstanding)
  ]);
  const pastSheet = sheet("Past tenants",
    ["Room", "Tenant", "Phone", "Rent", "Due day", "First rent month", "Moved out", "Advance", "Advance returned", "Note", "Unpaid at move-out"],
    pastRows, [7, 26, 14, 10, 9, 17, 12, 10, 17, 30, 18]);

  // 5. Payment history of tenants who moved out.
  const pastPaymentRows = [];
  for (const p of pastList) {
    const months = Object.entries(p.months || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
    for (const [month, m] of months) {
      const rent = Number(m.rent) || 0;
      const electricity = Number(m.electricity) || 0;
      pastPaymentRows.push([
        text(p.name), money(p.roomNo), text(month), money(rent), money(electricity), money(rent + electricity),
        text(m.paid ? "Paid" : "Unpaid"), text(m.paid ? m.paidOn : ""), text(m.paid ? methodLabel(m.method) : "")
      ]);
    }
  }
  const pastPaymentsSheet = sheet("Past payments",
    ["Tenant", "Room", "Month", "Rent", "Electricity", "Total", "Status", "Paid on", "Method"],
    pastPaymentRows, [26, 7, 10, 10, 12, 10, 10, 12, 10]);

  return [monthSheet, paymentsSheet, tenantsSheet, pastSheet, pastPaymentsSheet];
}
