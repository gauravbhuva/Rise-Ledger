(() => {
  "use strict";
  const DB_NAME = "RupeeLedgerDB";
  const DB_VERSION = 1;
  const STORE = "records";
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  let db;
  let deferredInstallPrompt = null;
  let toastTimer;

  const today = () => new Date().toLocaleDateString("en-CA");
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const paise = value => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid non-negative amount.");
    return Math.round((n + Number.EPSILON) * 100);
  };
  const rupees = value => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(value) || 0) / 100);
  const dateLabel = date => {
    if (!date) return "";
    const d = new Date(`${date}T12:00:00`);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };
  const monthKey = date => (date || "").slice(0, 7);
  const currentMonth = () => today().slice(0, 7);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
  const typeMeta = {
    income: { label: "Income", icon: "↙", sign: "+", cls: "positive" },
    expense: { label: "Expense", icon: "↗", sign: "−", cls: "negative" },
    transfer: { label: "Transfer", icon: "⇄", sign: "", cls: "" },
    repayment: { label: "Cash repayment", icon: "↗", sign: "−", cls: "negative" },
    work: { label: "Work credit", icon: "✓", sign: "", cls: "positive" },
    purchase_payment: { label: "Seller payment", icon: "↗", sign: "−", cls: "negative" }
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function allRecords() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function writeRecord(record) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Could not save record."));
    });
  }
  function replaceAll(records) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      records.forEach(record => store.put(record));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Could not restore backup."));
    });
  }
  async function getState() {
    const records = await allRecords();
    return {
      transactions: records.filter(r => r.kind === "transaction").sort((a,b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)),
      obligations: records.filter(r => r.kind === "obligation").sort((a,b) => (a.createdAt || 0) - (b.createdAt || 0)),
      records
    };
  }
  function balances(obligation, transactions) {
    const related = transactions.filter(t => t.obligationId === obligation.id);
    const cashPaid = related.filter(t => t.type === "repayment").reduce((s,t) => s + t.amount, 0);
    const workCredited = related.filter(t => t.type === "work").reduce((s,t) => s + t.amount, 0);
    const sellerPaid = related.filter(t => t.type === "purchase_payment").reduce((s,t) => s + t.amount, 0);
    return {
      personal: Math.max(0, obligation.personalOwed - cashPaid - workCredited),
      seller: Math.max(0, obligation.sellerUnpaid - sellerPaid),
      cashPaid, workCredited, sellerPaid
    };
  }
  function totalPersonal(state) { return state.obligations.reduce((sum,o) => sum + balances(o,state.transactions).personal,0); }
  function totalSeller(state) { return state.obligations.reduce((sum,o) => sum + balances(o,state.transactions).seller,0); }
  function cashBalance(state) {
    // Initial version: only tracked account cash flows after the app's start. Opening balances can be added in a later step.
    return state.transactions.reduce((sum,t) => {
      if (t.type === "income") return sum + t.amount;
      if (t.type === "expense" || t.type === "repayment" || t.type === "purchase_payment") return sum - t.amount;
      if (t.type === "transfer") return sum;
      return sum;
    }, 0);
  }
  function monthlyTotals(state, month) {
    const txs = state.transactions.filter(t => monthKey(t.date) === month);
    return {
      income: txs.filter(t => t.type === "income").reduce((s,t) => s+t.amount,0),
      expenses: txs.filter(t => t.type === "expense").reduce((s,t) => s+t.amount,0),
      repayments: txs.filter(t => t.type === "repayment").reduce((s,t) => s+t.amount,0),
      work: txs.filter(t => t.type === "work").reduce((s,t) => s+t.amount,0)
    };
  }
  function toast(message) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function emptyState(title, detail) {
    return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(detail)}</div>`;
  }
  function transactionHtml(t) {
    const meta = typeMeta[t.type] || typeMeta.expense;
    const amountPrefix = meta.sign;
    return `<div class="transaction-row">
      <div class="row-icon">${meta.icon}</div>
      <div class="row-main"><div class="row-title">${escapeHtml(t.description)}</div><div class="row-sub">${escapeHtml(meta.label)} · ${escapeHtml(t.category || "General")} · ${escapeHtml(dateLabel(t.date))}${t.account ? " · " + escapeHtml(t.account) : ""}</div></div>
      <div class="row-amount ${meta.cls}">${amountPrefix}${rupees(t.amount)}${t.type === "work" ? '<small>non-cash</small>' : ""}</div>
    </div>`;
  }
  function obligationHtml(o, state) {
    const b = balances(o, state.transactions);
    const settled = b.personal === 0 && b.seller === 0;
    const progressBase = Math.max(o.personalOwed, 1);
    const progress = Math.max(0, Math.min(100, ((o.personalOwed - b.personal) / progressBase) * 100));
    return `<article class="obligation-card">
      <div class="obligation-card-head"><div><div class="item-name">${escapeHtml(o.item)}</div><div class="person-name">${escapeHtml(o.person)}</div></div><span class="method-pill">${escapeHtml((o.method || "cash").replace("_"," ").toUpperCase())}</span></div>
      <div class="balance-pair">
        <div class="balance-cell"><span>Personal debt left</span><strong>${rupees(b.personal)}</strong></div>
        <div class="balance-cell"><span>Unpaid to seller</span><strong>${rupees(b.seller)}</strong></div>
      </div>
      <div class="obligation-progress"><span style="width:${progress}%"></span></div>
      <div class="card-foot"><span>Original cost ${rupees(o.cost)}</span><span>${settled ? "Settled" : `${Math.round(progress)}% personal debt cleared`}</span></div>
      ${o.notes ? `<p class="row-sub">${escapeHtml(o.notes)}</p>` : ""}
    </article>`;
  }
  function renderDashboard(state) {
    $("#personalDebt").textContent = rupees(totalPersonal(state));
    $("#setupUnpaid").textContent = rupees(totalSeller(state));
    $("#availableMoney").textContent = rupees(cashBalance(state));
    const m = monthlyTotals(state, currentMonth());
    $("#monthIncome").textContent = rupees(m.income);
    $("#monthExpenses").textContent = rupees(m.expenses);
    $("#recentTransactions").innerHTML = state.transactions.slice(0,5).map(transactionHtml).join("") || emptyState("No entries yet", "Add your first transaction when you're ready.");
    $("#dashboardObligations").innerHTML = state.obligations.slice(0,4).map(o => {
      const b = balances(o,state.transactions);
      return `<div class="obligation-row"><div class="row-icon">◎</div><div class="row-main"><div class="row-title">${escapeHtml(o.item)}</div><div class="row-sub">${escapeHtml(o.person)}</div></div><div class="row-amount">${rupees(b.personal)}<small>personal debt</small></div></div>`;
    }).join("") || emptyState("No obligations recorded", "Add a purchase item to start tracking balances.");
  }
  function renderTransactions(state) {
    const query = ($("#transactionSearch").value || "").trim().toLowerCase();
    const filter = $("#transactionFilter").value;
    const txs = state.transactions.filter(t => (filter === "all" || t.type === filter) && [t.description,t.category,t.account,t.date].join(" ").toLowerCase().includes(query));
    $("#allTransactions").innerHTML = txs.map(transactionHtml).join("") || emptyState("Nothing found", "Try another search or add a transaction.");
  }
  function renderObligations(state) {
    $("#obligationSummary").innerHTML = `<div class="summary-box"><span>Personal debt remaining</span><strong>${rupees(totalPersonal(state))}</strong></div><div class="summary-box"><span>Setup unpaid to sellers</span><strong>${rupees(totalSeller(state))}</strong></div>`;
    $("#allObligations").innerHTML = state.obligations.map(o => obligationHtml(o,state)).join("") || emptyState("No purchase items yet", "Add each item separately so repayments can be allocated accurately.");
  }
  function renderReports(state) {
    const m = monthlyTotals(state,currentMonth());
    $("#reportIncome").textContent = rupees(m.income);
    $("#reportExpenses").textContent = rupees(m.expenses);
    $("#reportNet").textContent = rupees(m.income - m.expenses);
    $("#reportRepayments").textContent = rupees(m.repayments);
    const months = [];
    const now = new Date();
    for(let i=0;i<6;i++){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`);}
    $("#monthlyReport").innerHTML = months.map(month => {
      const v=monthlyTotals(state,month);
      const label=new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN",{month:"long",year:"numeric"});
      return `<div class="transaction-row"><div class="row-icon">▥</div><div class="row-main"><div class="row-title">${escapeHtml(label)}</div><div class="row-sub">Income ${rupees(v.income)} · Expenses ${rupees(v.expenses)}</div></div><div class="row-amount ${(v.income-v.expenses)>=0?"positive":"negative"}">${rupees(v.income-v.expenses)}<small>net cash flow</small></div></div>`;
    }).join("");
  }
  async function renderAll() {
    const state = await getState();
    renderDashboard(state);
    renderTransactions(state);
    renderObligations(state);
    renderReports(state);
    $("#storageStatus").textContent = `Local browser database active · ${state.records.length} records · Last refreshed ${new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}`;
    populateObligationSelect(state);
  }
  function populateObligationSelect(state) {
    const select = $("#txObligation");
    const previous = select.value;
    select.innerHTML = '<option value="">Choose an item…</option>' + state.obligations.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.item)} — ${escapeHtml(o.person)}</option>`).join("");
    if (state.obligations.some(o => o.id === previous)) select.value = previous;
  }
  function showView(name) {
    $$(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
    window.scrollTo({top:0,behavior:"smooth"});
  }
  function openModal(id) {
    const dialog = document.getElementById(id);
    if (id === "transactionModal") {
      $("#transactionForm").reset();
      $("#transactionForm").elements.date.value = today();
      updateTransactionFields();
    }
    if (id === "obligationModal") $("#obligationForm").reset();
    dialog.showModal();
  }
  function updateTransactionFields() {
    const type = $("#txType").value;
    $("#transferFields").classList.toggle("hidden", type !== "transfer");
    $("#obligationFields").classList.toggle("hidden", !["repayment","work","purchase_payment"].includes(type));
    const obligationSelect = $("#txObligation");
    obligationSelect.required = ["repayment","work","purchase_payment"].includes(type);
    const help = $("#obligationFields .field-help");
    if (type === "repayment") help.textContent = "Reduces the selected personal debt and available cash.";
    else if (type === "work") help.textContent = "Reduces the selected personal debt without changing cash.";
    else help.textContent = "Reduces the selected item's unpaid seller/provider balance and available cash.";
  }
  async function saveTransaction(form) {
    const data = new FormData(form);
    const type = String(data.get("type"));
    const amount = paise(data.get("amount"));
    const state = await getState();
    const obligationId = String(data.get("obligationId") || "");
    if (["repayment","work","purchase_payment"].includes(type)) {
      const obligation = state.obligations.find(o => o.id === obligationId);
      if (!obligation) throw new Error("Choose a valid purchase item.");
      const b = balances(obligation,state.transactions);
      const max = type === "purchase_payment" ? b.seller : b.personal;
      if (amount > max) throw new Error(`This entry exceeds the remaining balance of ${rupees(max)}.`);
    }
    if (type === "transfer" && data.get("account") === data.get("toAccount")) throw new Error("Choose two different accounts for a transfer.");
    const record = {
      id:id(), kind:"transaction", type, amount,
      description:String(data.get("description")).trim(),
      date:String(data.get("date") || today()),
      category:String(data.get("category") || "General"),
      account:String(data.get("account") || "Cash"),
      toAccount:type === "transfer" ? String(data.get("toAccount")) : null,
      obligationId:obligationId || null,
      createdAt:Date.now()
    };
    if (!record.description) throw new Error("Enter a description.");
    await writeRecord(record);
    form.closest("dialog").close();
    await renderAll();
    toast("Entry saved. Balances updated.");
  }
  async function saveObligation(form) {
    const data = new FormData(form);
    const cost = paise(data.get("cost"));
    const personalOwed = paise(data.get("personalOwed"));
    const sellerUnpaid = paise(data.get("sellerUnpaid"));
    if (personalOwed > cost || sellerUnpaid > cost) throw new Error("Personal debt and seller unpaid amounts cannot exceed the original item cost.");
    const item = String(data.get("item")).trim();
    const person = String(data.get("person")).trim();
    if (!item || !person) throw new Error("Enter an item and a person or organization.");
    const record = {
      id:id(), kind:"obligation", item, person, cost, personalOwed, sellerUnpaid,
      method:String(data.get("method") || "cash"),
      notes:String(data.get("notes") || "").trim(),
      createdAt:Date.now()
    };
    await writeRecord(record);
    form.closest("dialog").close();
    await renderAll();
    toast("Purchase item added.");
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=filename; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportBackup() {
    const state = await getState();
    const backup = { app:"RupeeLedger", formatVersion:1, exportedAt:new Date().toISOString(), currency:"INR", records:state.records };
    downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}),`rupeeledger-backup-${today()}.json`);
    toast("Backup exported. Store it somewhere safe.");
  }
  async function importBackup(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.app !== "RupeeLedger" || parsed.formatVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("This doesn't look like a supported RupeeLedger backup.");
    if (!confirm(`Restore ${parsed.records.length} records? This replaces all current local data. Export a backup first if needed.`)) return;
    const valid = parsed.records.every(r => r && typeof r.id === "string" && ["transaction","obligation"].includes(r.kind));
    if (!valid) throw new Error("Backup validation failed. No data was changed.");
    await replaceAll(parsed.records);
    await renderAll();
    toast("Backup restored.");
  }
  async function exportCsv() {
    const state = await getState();
    const headers = ["date","type","description","category","amount_INR","account","destination_account","item_id","item_name","person"];
    const lines = [headers.join(",")];
    for (const t of state.transactions) {
      const o = state.obligations.find(x=>x.id===t.obligationId);
      const cells = [t.date,t.type,t.description,t.category,(t.amount/100).toFixed(2),t.account||"",t.toAccount||"",t.obligationId||"",o?.item||"",o?.person||""];
      lines.push(cells.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(","));
    }
    downloadBlob(new Blob(["\ufeff"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"}),`rupeeledger-transactions-${today()}.csv`);
    toast("Transaction CSV exported.");
  }
  async function clearData() {
    if (!confirm("Permanently delete all RupeeLedger data from this browser? This cannot be undone. Export a backup first.")) return;
    await replaceAll([]);
    await renderAll();
    toast("Local data deleted.");
  }
  function attachEvents() {
    $$("[data-nav]").forEach(b => b.addEventListener("click",()=>showView(b.dataset.nav)));
    $$("[data-open-modal]").forEach(b => b.addEventListener("click",()=>openModal(b.dataset.openModal)));
    $$("[data-close-modal]").forEach(b => b.addEventListener("click",()=>b.closest("dialog").close()));
    $("#txType").addEventListener("change",updateTransactionFields);
    $("#transactionForm").addEventListener("submit",async e=>{e.preventDefault();try{await saveTransaction(e.currentTarget);}catch(err){toast(err.message||"Could not save entry.");}});
    $("#obligationForm").addEventListener("submit",async e=>{e.preventDefault();try{await saveObligation(e.currentTarget);}catch(err){toast(err.message||"Could not save item.");}});
    $("#transactionSearch").addEventListener("input",async()=>renderTransactions(await getState()));
    $("#transactionFilter").addEventListener("change",async()=>renderTransactions(await getState()));
    $("#exportBtn").addEventListener("click",()=>exportBackup().catch(e=>toast(e.message)));
    $("#csvBtn").addEventListener("click",()=>exportCsv().catch(e=>toast(e.message)));
    $("#importFile").addEventListener("change",async e=>{const file=e.target.files?.[0];if(file){try{await importBackup(file);}catch(err){toast(err.message||"Could not restore backup.");}finally{e.target.value="";}}});
    $("#clearBtn").addEventListener("click",()=>clearData().catch(e=>toast(e.message)));
    window.addEventListener("beforeinstallprompt", e=>{e.preventDefault();deferredInstallPrompt=e;$("#installBtn").classList.remove("hidden");});
    $("#installBtn").addEventListener("click",async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$("#installBtn").classList.add("hidden");});
  }
  async function init() {
    if (!("indexedDB" in window)) { toast("This browser doesn't support local database storage."); return; }
    try {
      db = await openDb();
      attachEvents();
      $("#transactionForm").elements.date.value = today();
      await renderAll();
      if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
        navigator.serviceWorker.register("./sw.js").catch(()=>{});
      }
    } catch (e) {
      console.error(e);
      toast("Could not open local database. Try a modern browser.");
    }
  }
  init();
})();
