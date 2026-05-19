import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  Droplets,
  FileText,
  Gauge,
  History,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Truck,
  Upload,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getReportWebhookUrl,
  getSyncState,
  queueLiveDailyReport,
  saveReportWebhookUrl,
  syncPendingReports,
} from "./reportSync";
import type { SyncState } from "./reportSync";
import {
  LOYAL_TANK_PRICES,
  PRICE_PER_METER,
  calculateClosing,
  calculateDayTotals,
  calculateSalePayment,
  dayKeyFromIso,
  deriveCustomerStatus,
  findRecentDuplicateTruck,
  getDayPayments,
  makeCustomerName,
  normalizeTruckNumber,
  recalculateExistingSalePayment,
  roundMoney,
  todayKey,
} from "./lib/business";
import { applyCustomerDebt, createId, getTodaySales } from "./data";
import type { AppData } from "./data";
import type { Customer, CustomerPricePlan, DailyClosing, PaymentMethod, PaymentType, Sale } from "./types";
import { usePersistentData } from "./usePersistentData";

type View = "sale" | "dashboard" | "closing" | "debts" | "history" | "report";

const navItems: Array<{ view: View; label: string; icon: typeof Plus; manager?: boolean }> = [
  { view: "sale", label: "بيع جديد", icon: Plus },
  { view: "dashboard", label: "لوحة اليوم", icon: BarChart3, manager: true },
  { view: "closing", label: "ملخص اليوم", icon: Gauge },
  { view: "debts", label: "ديون العملاء", icon: Users },
  { view: "history", label: "سجل المبيعات", icon: History },
  { view: "report", label: "التقرير", icon: FileText, manager: true },
];

const quickMeters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22];
const MANAGER_PIN_STORAGE_KEY = "water-station-manager-pin";

function readManagerPin() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(MANAGER_PIN_STORAGE_KEY) ?? "";
}

function saveManagerPin(pin: string) {
  window.localStorage.setItem(MANAGER_PIN_STORAGE_KEY, pin);
}

type BackupFile = {
  app: "jordan-water-station";
  version: 1;
  exportedAt: string;
  data: AppData;
};

function isAppData(value: unknown): value is AppData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Record<keyof AppData, unknown>>;
  return (
    Array.isArray(data.customers) &&
    Array.isArray(data.sales) &&
    Array.isArray(data.payments) &&
    Array.isArray(data.closings)
  );
}

function getBackupData(value: unknown): AppData | null {
  if (isAppData(value)) return value;
  if (value && typeof value === "object" && isAppData((value as { data?: unknown }).data)) {
    return (value as { data: AppData }).data;
  }
  return null;
}

function downloadTextFile(filename: string, text: string, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ar-JO");
}

function formatJod(value: number) {
  return `${roundMoney(value)} JOD`;
}

function formatMeters(value: number) {
  return `${roundMoney(value)} متر`;
}

function arabicPayment(type: PaymentType) {
  if (type === "cash") return "كاش";
  if (type === "cliq") return "CliQ";
  if (type === "debt") return "دين";
  return "جزئي";
}

function arabicPricePlan(plan: CustomerPricePlan = "standard") {
  return plan === "loyal" ? "سعر مميز" : "سعر عادي";
}

function getPlanPrice(
  meters: number,
  plan: CustomerPricePlan = "standard",
  customTankPrices: Record<number, number> = {},
) {
  if (customTankPrices[meters] !== undefined) {
    return customTankPrices[meters];
  }
  if (plan === "loyal" && LOYAL_TANK_PRICES[meters] !== undefined) {
    return LOYAL_TANK_PRICES[meters];
  }

  return roundMoney(meters * PRICE_PER_METER);
}

function formatCustomPrices(customTankPrices: Record<number, number> = {}) {
  const entries = Object.entries(customTankPrices)
    .map(([meters, price]) => [Number(meters), price] as const)
    .filter(([meters, price]) => Number.isFinite(meters) && Number.isFinite(Number(price)))
    .sort((a, b) => a[0] - b[0]);

  return entries.length
    ? entries.map(([meters, price]) => `${meters}م = ${formatJod(Number(price))}`).join("، ")
    : "لا يوجد سعر خاص";
}

function syncStatusText(state: SyncState) {
  if (state.status === "not-configured") return "غير مربوط — أضف رابط Google Sheet";
  if (state.status === "syncing") return "جاري إرسال التقرير...";
  if (state.status === "pending") return `بانتظار الإنترنت / تقارير معلقة: ${state.pendingCount}`;
  if (state.status === "synced") return `تمت المزامنة${state.lastSyncedAt ? `: ${formatDateTime(state.lastSyncedAt)}` : ""}`;
  if (state.status === "error") return `فشل المزامنة — ${state.lastError || "جرّب مرة أخرى"}`;
  return state.pendingCount ? `تقارير معلقة: ${state.pendingCount}` : "جاهز للمزامنة";
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone = "blue",
}: {
  title: string;
  value: string;
  icon: typeof Plus;
  tone?: "blue" | "green" | "yellow" | "red";
}) {
  return (
    <section className={`stat-card tone-${tone}`}>
      <span className="icon-pill">
        <Icon size={22} />
      </span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

function App() {
  const { data, setData, resetDemoData, clearData } = usePersistentData();
  const [view, setView] = useState<View>("sale");
  const [managerMode, setManagerMode] = useState(false);
  const [managerPin, setManagerPin] = useState(() => readManagerPin());
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [syncState, setSyncState] = useState<SyncState>(() => getSyncState());

  const refreshSyncState = () => setSyncState(getSyncState());

  useEffect(() => {
    const runSync = () => {
      syncPendingReports().then(setSyncState).catch(() => setSyncState(getSyncState()));
    };
    runSync();
    window.addEventListener("online", runSync);
    return () => window.removeEventListener("online", runSync);
  }, []);

  useEffect(() => {
    if (!getReportWebhookUrl()) {
      setSyncState(getSyncState());
      return;
    }

    const syncTimer = window.setTimeout(() => {
      const queued = queueLiveDailyReport(data.sales, data.payments);
      if (!queued) {
        setSyncState(getSyncState());
        return;
      }

      setSyncState(getSyncState());
      syncPendingReports().then(setSyncState).catch(() => setSyncState(getSyncState()));
    }, 1200);

    return () => window.clearTimeout(syncTimer);
  }, [data.sales, data.payments]);

  const todaySales = useMemo(() => getTodaySales(data.sales), [data.sales]);
  const latestClosing = data.closings.find((closing) => closing.date === todayKey());

  const openView = (next: View) => {
    const item = navItems.find((nav) => nav.view === next);
    if (item?.manager && !managerMode) return;
    setView(next);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Droplets size={28} />
          </span>
          <div>
            <strong>محطة المياه</strong>
            <small>نظام البيع وملخص اليوم</small>
          </div>
        </div>

        <nav className="nav-list" aria-label="التنقل الرئيسي">
          {navItems.map((item) => {
            const Icon = item.icon;
            const locked = item.manager && !managerMode;
            return (
              <button
                key={item.view}
                className={view === item.view ? "active" : ""}
                onClick={() => openView(item.view)}
                disabled={locked}
                title={locked ? "يتطلب وضع المدير" : item.label}
              >
                <Icon size={22} />
                <span>{item.label}</span>
                {locked && <Lock size={16} />}
              </button>
            );
          })}
        </nav>

        <div className="manager-box">
          <div className="manager-status">
            <Settings size={18} />
            <span>{managerMode ? "وضع المدير مفعل" : "وضع الموظف"}</span>
          </div>
          {!managerMode ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const cleanPin = pin.replace(/\D/g, "");
                if (cleanPin.length < 4) {
                  setPinError("أدخل 4 أرقام على الأقل");
                  return;
                }
                if (!managerPin) {
                  saveManagerPin(cleanPin);
                  setManagerPin(cleanPin);
                  setManagerMode(true);
                  setPin("");
                  setPinError("");
                  return;
                }
                if (cleanPin === managerPin) {
                  setManagerMode(true);
                  setPin("");
                  setPinError("");
                } else {
                  setPinError("PIN غير صحيح");
                }
              }}
            >
              <input
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, ""));
                  setPinError("");
                }}
                inputMode="numeric"
                type="password"
                placeholder={managerPin ? "PIN المدير" : "اختر PIN المدير"}
                aria-label={managerPin ? "PIN المدير" : "اختر PIN المدير"}
              />
              {pinError && <small className="pin-error">{pinError}</small>}
              <button type="submit">{managerPin ? "دخول" : "حفظ PIN"}</button>
            </form>
          ) : (
            <button
              className="ghost-button"
              onClick={() => {
                setManagerMode(false);
                setView("sale");
              }}
            >
              خروج المدير
            </button>
          )}
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar compact-topbar">
          <div>
            <h1>{navItems.find((item) => item.view === view)?.label}</h1>
          </div>
        </header>

        {view === "sale" && <SaleScreen data={data} setData={setData} />}
        {view === "dashboard" && managerMode && (
          <Dashboard customers={data.customers} todaySales={todaySales} />
        )}
        {view === "closing" && (
          <TodaySummaryScreen
            todaySales={todaySales}
            payments={data.payments}
            customers={data.customers}
            syncState={syncState}
          />
        )}
        {view === "debts" && (
          <DebtLedger data={data} setData={setData} />
        )}
        {view === "history" && (
          <SalesHistory sales={data.sales} closings={data.closings} managerMode={managerMode} setData={setData} />
        )}
        {view === "report" && managerMode && (
          <ManagerReport
            sales={todaySales}
            customers={data.customers}
            payments={data.payments}
            closing={latestClosing}
          />
        )}

        {managerMode && (
          <BackupTools
            data={data}
            setData={setData}
            resetDemoData={resetDemoData}
            clearData={clearData}
            syncState={syncState}
            onSyncStateChange={refreshSyncState}
          />
        )}
      </main>

      <nav className="bottom-nav" aria-label="التنقل السفلي">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          const locked = item.manager && !managerMode;
          return (
            <button
              key={item.view}
              className={view === item.view ? "active" : ""}
              onClick={() => openView(item.view)}
              disabled={locked}
            >
              <Icon size={21} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function BackupTools({
  data,
  setData,
  resetDemoData,
  clearData,
  syncState,
  onSyncStateChange,
}: {
  data: AppData;
  setData: ReturnType<typeof usePersistentData>["setData"];
  resetDemoData: () => void;
  clearData: () => void;
  syncState: SyncState;
  onSyncStateChange: () => void;
}) {
  const [status, setStatus] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(() => getReportWebhookUrl());

  const exportBackup = () => {
    const backup: BackupFile = {
      app: "jordan-water-station",
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const date = todayKey();
    downloadTextFile(
      `water-station-backup-${date}.json`,
      JSON.stringify(backup, null, 2),
      "application/json",
    );
    setStatus("تم تصدير النسخة الاحتياطية");
  };

  const importBackup = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = getBackupData(parsed);
        if (!imported) {
          setStatus("ملف النسخة الاحتياطية غير صحيح");
          return;
        }
        if (!window.confirm("استيراد النسخة سيستبدل البيانات الحالية. هل أنت متأكد؟")) return;
        setData(imported);
        setStatus("تم استيراد النسخة الاحتياطية بنجاح");
      } catch {
        setStatus("تعذر قراءة ملف النسخة الاحتياطية");
      }
    };
    reader.readAsText(file);
  };

  return (
    <section className="data-tools">
      <div className="sync-tools-card">
        <strong>مزامنة تقرير الإغلاق مع Google Sheets</strong>
        <span>{syncStatusText(syncState)}</span>
        <input
          value={webhookUrl}
          onChange={(event) => setWebhookUrl(event.target.value)}
          placeholder="رابط Google Apps Script Webhook"
          dir="ltr"
        />
        <div className="sync-actions">
          <button
            onClick={() => {
              saveReportWebhookUrl(webhookUrl);
              const queued = queueLiveDailyReport(data.sales, data.payments);
              onSyncStateChange();
              if (queued) {
                syncPendingReports().then(() => onSyncStateChange());
                setStatus("تم حفظ الرابط وإرسال بيانات اليوم");
              } else {
                setStatus("تم حفظ رابط المزامنة");
              }
            }}
          >
            حفظ رابط المزامنة
          </button>
          <button
            onClick={() => {
              queueLiveDailyReport(data.sales, data.payments);
              onSyncStateChange();
              syncPendingReports().then(() => {
                onSyncStateChange();
                setStatus("تمت محاولة المزامنة");
              });
            }}
          >
            مزامنة الآن
          </button>
        </div>
      </div>
      <button onClick={exportBackup}>
        <Download size={16} />
        تصدير نسخة احتياطية
      </button>
      <label className="file-tool-button">
        <Upload size={16} />
        استيراد نسخة احتياطية
        <input
          type="file"
          accept="application/json,.json"
          onChange={(event) => importBackup(event.target.files?.[0])}
        />
      </label>
      <button onClick={resetDemoData}>إرجاع بيانات تجريبية</button>
      <button onClick={clearData}>مسح البيانات</button>
      {status && <span>{status}</span>}
    </section>
  );
}

function SaleScreen({
  data,
  setData,
}: {
  data: ReturnType<typeof usePersistentData>["data"];
  setData: ReturnType<typeof usePersistentData>["setData"];
}) {
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerMode, setCustomerMode] = useState<"saved" | "new">("saved");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [truckNumber, setTruckNumber] = useState("");
  const [meters, setMeters] = useState("12");
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [cashReceived, setCashReceived] = useState("12");
  const [oldDebtPayment, setOldDebtPayment] = useState("");
  const [oldDebtPaymentType, setOldDebtPaymentType] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [customMeters, setCustomMeters] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [isPriceEditorOpen, setIsPriceEditorOpen] = useState(false);
  const salePanelTopRef = useRef<HTMLDivElement | null>(null);
  const [newCustomerPricePlan, setNewCustomerPricePlan] =
    useState<CustomerPricePlan>("standard");
  const [success, setSuccess] = useState<Sale | null>(null);
  const [lastReceipt, setLastReceipt] = useState("");
  const [error, setError] = useState("");

  const selectedCustomer = data.customers.find(
    (customer) => customer.id === selectedCustomerId,
  );
  const searchedCustomers = data.customers
    .filter((customer) => {
      const numericHaystack = normalizeTruckNumber(`${customer.truckNumbers.join(" ")} ${customer.phone}`);
      return numericHaystack.includes(query);
    })
    .slice(0, 30);
  const frequentCustomers = [...data.customers]
    .sort((a, b) => (b.lastSaleAt ?? "").localeCompare(a.lastSaleAt ?? ""))
    .slice(0, 8);
  const numericMeters = Number(meters);
  const activePricePlan: CustomerPricePlan =
    selectedCustomer?.pricePlan ?? (customerMode === "new" ? newCustomerPricePlan : "standard");
  const activeCustomPrices = selectedCustomer?.customTankPrices ?? {};
  const lastSale = selectedCustomer
    ? data.sales
        .filter((sale) => sale.customerId === selectedCustomer.id && !sale.deleted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const lastPayment = selectedCustomer
    ? data.payments
        .filter((payment) => payment.customerId === selectedCustomer.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;
  const todaySales = getTodaySales(data.sales);
  const todayPayments = getDayPayments(data.payments);
  const todayTotals = calculateDayTotals(todaySales, todayPayments);
  const preview = useMemo(() => {
    if (numericMeters <= 0) return null;
    try {
      return calculateSalePayment(
        numericMeters,
        paymentType,
        paymentType === "partial" ? Number(cashReceived || 0) : undefined,
        activePricePlan,
        activeCustomPrices,
      );
    } catch {
      return null;
    }
  }, [activeCustomPrices, activePricePlan, cashReceived, numericMeters, paymentType]);

  useEffect(() => {
    if ((paymentType === "cash" || paymentType === "cliq") && numericMeters > 0) {
      setCashReceived(String(getPlanPrice(numericMeters, activePricePlan, activeCustomPrices)));
    }
  }, [activeCustomPrices, activePricePlan, numericMeters, paymentType]);

  const chooseCustomer = (customer: Customer) => {
    const primaryTruck = normalizeTruckNumber(customer.truckNumbers[0] ?? "");
    setCustomerMode("saved");
    setSelectedCustomerId(customer.id);
    setQuery(primaryTruck);
    setNewCustomerName(customer.name);
    setTruckNumber(primaryTruck);
    setPhone(customer.phone);
    setNewCustomerPricePlan(customer.pricePlan ?? "standard");
    setCustomMeters("");
    setCustomPrice("");
    setIsPriceEditorOpen(false);
  };

  const startNewCustomer = () => {
    setCustomerMode("new");
    setSelectedCustomerId("");
    setQuery("");
    setNewCustomerName("");
    setTruckNumber("");
    setPhone("");
    setNewCustomerPricePlan("standard");
    setCustomMeters("");
    setCustomPrice("");
    setIsPriceEditorOpen(false);
    setSuccess(null);
    setLastReceipt("");
    setError("");
  };

  const startSavedCustomer = () => {
    setCustomerMode("saved");
    setSelectedCustomerId("");
    setQuery("");
    setNewCustomerName("");
    setTruckNumber("");
    setPhone("");
    setNewCustomerPricePlan("standard");
    setCustomMeters("");
    setCustomPrice("");
    setIsPriceEditorOpen(false);
    setSuccess(null);
    setLastReceipt("");
    setError("");
  };

  const updatePaymentType = (type: PaymentType) => {
    setPaymentType(type);
    const amount = getPlanPrice(Number(meters || 0), activePricePlan, activeCustomPrices);
    setCashReceived(type === "cash" || type === "cliq" ? String(amount) : type === "debt" ? "0" : "");
    if (type === "cliq") setOldDebtPaymentType("cliq");
    if (type === "cash") setOldDebtPaymentType("cash");
  };

  const setSelectedCustomerPricePlan = (pricePlan: CustomerPricePlan) => {
    if (!selectedCustomer) return;
    setData({
      ...data,
      customers: data.customers.map((customer) =>
        customer.id === selectedCustomer.id ? { ...customer, pricePlan } : customer,
      ),
    });
  };

  const saveSelectedCustomerCustomPrice = () => {
    if (!selectedCustomer) return;
    setError("");
    const metersKey = Number(customMeters);
    const priceValue = Number(customPrice);
    if (!Number.isFinite(metersKey) || metersKey <= 0 || !Number.isInteger(metersKey)) {
      setError("أدخل عدد أمتار صحيح للسعر الخاص");
      return;
    }
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      setError("أدخل سعر خاص صحيح");
      return;
    }

    const nextPrices = {
      ...(selectedCustomer.customTankPrices ?? {}),
      [metersKey]: roundMoney(priceValue),
    };
    setData({
      ...data,
      customers: data.customers.map((customer) =>
        customer.id === selectedCustomer.id ? { ...customer, customTankPrices: nextPrices } : customer,
      ),
    });
    setCustomMeters("");
    setCustomPrice("");
    setIsPriceEditorOpen(false);
  };

  const removeSelectedCustomerCustomPrice = (metersKey: number) => {
    if (!selectedCustomer) return;
    const nextPrices = { ...(selectedCustomer.customTankPrices ?? {}) };
    delete nextPrices[metersKey];
    setData({
      ...data,
      customers: data.customers.map((customer) =>
        customer.id === selectedCustomer.id ? { ...customer, customTankPrices: nextPrices } : customer,
      ),
    });
  };

  const buildReceipt = (sale: Sale, debtPaymentAmount: number, debtPaymentMethod: PaymentMethod, remainingDebt: number) =>
    [
      "إيصال محطة المياه",
      `الوقت: ${formatDateTime(sale.createdAt)}`,
      `العميل: ${sale.customerName}`,
      `رقم التنك: ${sale.truckNumber}`,
      `الأمتار: ${formatMeters(sale.meters)}`,
      `نوع السعر: ${arabicPricePlan(sale.pricePlan)}`,
      `إجمالي البيع: ${formatJod(sale.totalAmount)}`,
      `طريقة دفع البيع: ${arabicPayment(sale.paymentType)}`,
      `كاش البيع: ${formatJod(sale.cashReceived)}`,
      `CliQ البيع: ${formatJod(sale.cliqReceived ?? 0)}`,
      `دين جديد: ${formatJod(sale.debtAdded)}`,
      `دفعة دين سابق: ${formatJod(debtPaymentAmount)} ${debtPaymentAmount > 0 ? `(${arabicPayment(debtPaymentMethod)})` : ""}`,
      `الدين المتبقي على العميل: ${formatJod(remainingDebt)}`,
      sale.notes ? `ملاحظات: ${sale.notes}` : "ملاحظات: لا يوجد",
    ].join("\n");

  const recordSale = () => {
    setError("");
    const cleanTruckNumber = normalizeTruckNumber(truckNumber);
    const customerName = makeCustomerName(customerMode === "new" ? newCustomerName : (selectedCustomer?.name ?? newCustomerName), cleanTruckNumber);
    const amountMeters = Number(meters);

    if (customerMode === "saved" && !selectedCustomerId) {
      setError("اختَر عميل محفوظ أو اضغط عميل جديد");
      return;
    }

    if (!amountMeters || amountMeters <= 0) {
      setError("عدد الأمتار مطلوب ويجب أن يكون أكبر من صفر");
      return;
    }
    if (!cleanTruckNumber) {
      setError("رقم السيارة / التنك مطلوب");
      return;
    }
    const oldDebtPaymentAmount = roundMoney(Number(oldDebtPayment || 0));
    if (oldDebtPayment.trim() && !Number.isFinite(Number(oldDebtPayment))) {
      setError("دفعة الدين السابق يجب أن تكون رقماً صحيحاً");
      return;
    }
    if (oldDebtPaymentAmount < 0) {
      setError("دفعة الدين السابق لا يمكن أن تكون سالبة");
      return;
    }
    if (oldDebtPaymentAmount > 0 && !selectedCustomer) {
      setError("اختر العميل قبل تسجيل دفعة دين سابق");
      return;
    }
    if (selectedCustomer && oldDebtPaymentAmount > selectedCustomer.debtBalance) {
      setError("دفعة الدين السابق أكبر من الدين الموجود على العميل");
      return;
    }

    const duplicate = findRecentDuplicateTruck(data.sales, cleanTruckNumber);
    if (duplicate && !window.confirm(`هذا التنك مسجل قبل قليل باسم ${duplicate.customerName}. هل أنت متأكد أنه بيع جديد؟`)) {
      return;
    }

    try {
      const calculation = calculateSalePayment(
        amountMeters,
        paymentType,
        paymentType === "partial" ? Number(cashReceived || 0) : undefined,
        activePricePlan,
        activeCustomPrices,
      );

      let customerId = selectedCustomerId;
      let customers = data.customers;
      const now = new Date().toISOString();

      if (!customerId) {
        customerId = createId("c");
        customers = [
          {
            id: customerId,
            name: customerName,
            phone,
            truckNumbers: [cleanTruckNumber],
            debtBalance: 0,
            creditLimit: 50,
            pricePlan: newCustomerPricePlan,
            customTankPrices: {},
            createdAt: now,
            status: "good",
          },
          ...customers,
        ];
      } else {
        customers = customers.map((customer) =>
          customer.id === customerId
            ? {
                ...customer,
                name: customer.name.trim() || customerName,
                phone,
                pricePlan: customer.pricePlan ?? "standard",
                truckNumbers: Array.from(
                  new Set([
                    cleanTruckNumber,
                    ...customer.truckNumbers.map(normalizeTruckNumber).filter(Boolean),
                  ]),
                ),
              }
            : customer,
        );
      }

      const sale: Sale = {
        id: createId("s"),
        createdAt: now,
        customerId,
        customerName,
        truckNumber: cleanTruckNumber,
        meters: amountMeters,
        pricePerMeter: calculation.pricePerMeter,
        pricePlan: activePricePlan,
        customPriceApplied: activeCustomPrices[amountMeters] !== undefined,
        totalAmount: calculation.totalAmount,
        paymentType,
        cashReceived: calculation.cashReceived,
        cliqReceived: calculation.cliqReceived,
        debtAdded: calculation.debtAdded,
        notes,
      };

      customers = applyCustomerDebt(customers, customerId, calculation.debtAdded, "sale");
      if (oldDebtPaymentAmount > 0) {
        customers = applyCustomerDebt(customers, customerId, oldDebtPaymentAmount, "payment");
      }

      setData({
        ...data,
        customers,
        sales: [sale, ...data.sales],
        payments:
          oldDebtPaymentAmount > 0
            ? [
                {
                  id: createId("p"),
                  customerId,
                  amount: oldDebtPaymentAmount,
                  paymentType: oldDebtPaymentType,
                  createdAt: now,
                  notes: `تسديد دين سابق مع بيع جديد (${arabicPayment(oldDebtPaymentType)})`,
                },
                ...data.payments,
              ]
            : data.payments,
      });
      const updatedCustomer = customers.find((customer) => customer.id === customerId);
      setSuccess(sale);
      setLastReceipt(buildReceipt(sale, oldDebtPaymentAmount, oldDebtPaymentType, updatedCustomer?.debtBalance ?? 0));
      setSelectedCustomerId("");
      setQuery("");
      setNewCustomerName("");
      setTruckNumber("");
      setPhone("");
      setCustomMeters("");
      setCustomPrice("");
      setIsPriceEditorOpen(false);
      setMeters("12");
      setPaymentType("cash");
      setCashReceived("12");
      setOldDebtPayment("");
      setOldDebtPaymentType("cash");
      setNotes("");
      window.setTimeout(() => {
        salePanelTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تسجيل البيع");
    }
  };

  return (
    <div className="sale-grid">
      <aside className="panel customer-directory-panel">
        <div className="section-heading sale-title">
          <span className="title-icon">
            <Users size={30} />
          </span>
          <div>
            <h2>اختيار السيارة</h2>
            <p>ابحث برقم السيارة / التنك فقط — لوحة أرقام أسهل للموظف.</p>
          </div>
        </div>

        <div className="customer-mode-grid" role="group" aria-label="نوع العميل">
          <button
            className={customerMode === "saved" ? "active" : ""}
            onClick={startSavedCustomer}
          >
            <Users size={28} />
            <strong>سيارة محفوظة</strong>
            <span>اختيار برقم السيارة / التنك</span>
          </button>
          <button className={customerMode === "new" ? "active" : ""} onClick={startNewCustomer}>
            <UserPlus size={28} />
            <strong>سيارة جديدة</strong>
            <span>رقم السيارة مطلوب، الاسم اختياري</span>
          </button>
        </div>

        {customerMode === "saved" ? (
          <section className="customer-picker">
            <label>
              بحث برقم السيارة / التنك
              <div className="search-input">
                <Search size={20} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(normalizeTruckNumber(event.target.value));
                    setSelectedCustomerId("");
                  }}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="اكتب رقم السيارة فقط"
                />
              </div>
            </label>

            <div className="frequent-strip" aria-label="العملاء المتكررون">
              <span>السيارات المتكررة</span>
              {frequentCustomers.slice(0, 5).map((customer) => (
                <button key={customer.id} onClick={() => chooseCustomer(customer)}>
                  {customer.truckNumbers[0] || customer.name}
                </button>
              ))}
            </div>

            <div className="saved-customer-grid">
              {(query ? searchedCustomers : frequentCustomers).map((customer) => (
                <button
                  key={customer.id}
                  className={selectedCustomerId === customer.id ? "active" : ""}
                  onClick={() => chooseCustomer(customer)}
                >
                  <span className="customer-row-main">
                    <strong>{customer.truckNumbers[0] || "بدون رقم"}</strong>
                    <b>{formatJod(customer.debtBalance)}</b>
                  </span>
                  <span>{customer.name}</span>
                  <span>{customer.phone || "لا يوجد هاتف"}</span>
                  <span className="customer-badges">
                    <em>{arabicPricePlan(customer.pricePlan)}</em>
                    <em>
                      {customer.status === "good"
                        ? "جيد"
                        : customer.status === "blocked"
                          ? "محظور"
                          : "يحتاج دفعة"}
                    </em>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className="new-customer-card">
            <label>
              رقم السيارة / التنك (مطلوب)
              <input
                value={truckNumber}
                onChange={(event) => setTruckNumber(normalizeTruckNumber(event.target.value))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="مثال: 1234567"
                autoFocus
              />
            </label>
            <div className="field-row">
              <label>
                اسم العميل (اختياري)
                <input
                  value={newCustomerName}
                  onChange={(event) => setNewCustomerName(event.target.value)}
                  placeholder="اختياري"
                />
              </label>
              <label>
                الهاتف (اختياري)
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  inputMode="tel"
                  placeholder="اختياري"
                />
              </label>
            </div>
            <div className="price-plan-toggle" role="group" aria-label="نوع السعر">
              <button
                className={newCustomerPricePlan === "standard" ? "active" : ""}
                onClick={() => setNewCustomerPricePlan("standard")}
              >
                سعر عادي
              </button>
              <button
                className={newCustomerPricePlan === "loyal" ? "active" : ""}
                onClick={() => setNewCustomerPricePlan("loyal")}
              >
                سعر مميز
              </button>
            </div>
          </div>
        )}
      </aside>

      <section className="panel sale-panel">
        <div ref={salePanelTopRef} className="section-heading sale-title">
          <span className="title-icon">
            <Truck size={30} />
          </span>
          <div>
            <h2>تفاصيل التعبئة</h2>
            <p>أدخل عدد الأمتار يدوياً ثم اختر طريقة الدفع.</p>
          </div>
        </div>

        {success && (
          <section className="success-card success-card-top">
            <CheckCircle2 size={34} />
            <h3>تم تسجيل البيع</h3>
            <p>{success.customerName}</p>
            <strong>
              {formatMeters(success.meters)} · {formatJod(success.totalAmount)}
            </strong>
            <span>
              كاش {formatJod(success.cashReceived)} | CliQ {formatJod(success.cliqReceived ?? 0)} | دين {formatJod(success.debtAdded)}
            </span>
            {lastReceipt && (
              <div className="receipt-box">
                <div className="receipt-actions">
                  <strong>إيصال البيع</strong>
                  <button className="primary-lite" onClick={() => navigator.clipboard.writeText(lastReceipt)}>
                    <Copy size={16} />
                    نسخ الإيصال
                  </button>
                </div>
                <pre>{lastReceipt}</pre>
              </div>
            )}
          </section>
        )}

        {selectedCustomer ? (
          <section
            className={`customer-health ${
              selectedCustomer.debtBalance > selectedCustomer.creditLimit ? "danger" : ""
            }`}
          >
            <div className="customer-health-head">
              <div>
                <strong>{selectedCustomer.name}</strong>
                <span>{truckNumber || "بدون رقم تنك"}</span>
              </div>
              <div className="health-plan-actions">
                <b>{arabicPricePlan(selectedCustomer.pricePlan)}</b>
                <button
                  onClick={() =>
                    setSelectedCustomerPricePlan(
                      (selectedCustomer.pricePlan ?? "standard") === "loyal"
                        ? "standard"
                        : "loyal",
                    )
                  }
                >
                  تغيير السعر
                </button>
              </div>
            </div>
            <div className="health-grid">
              <span>
                الدين الحالي
                <strong>{formatJod(selectedCustomer.debtBalance)}</strong>
              </span>
              <span>
                حد الائتمان
                <strong>{formatJod(selectedCustomer.creditLimit)}</strong>
              </span>
              <span>
                آخر تعبئة
                <strong>{lastSale ? formatMeters(lastSale.meters) : "لا يوجد"}</strong>
              </span>
              <span>
                آخر دفعة
                <strong>{lastPayment ? formatJod(lastPayment.amount) : "لا يوجد"}</strong>
              </span>
            </div>
            <section className={`custom-price-compact ${isPriceEditorOpen ? "open" : ""}`}>
              <div className="custom-price-summary">
                <div>
                  <strong>السعر الخاص</strong>
                  <span>{formatCustomPrices(selectedCustomer.customTankPrices)}</span>
                </div>
                <button onClick={() => setIsPriceEditorOpen((open) => !open)}>
                  {isPriceEditorOpen ? "إغلاق" : "إدارة"}
                </button>
              </div>
              {isPriceEditorOpen && (
                <div className="custom-price-editor">
                  <div className="field-row">
                    <label>
                      الأمتار
                      <input
                        value={customMeters}
                        onChange={(event) => setCustomMeters(event.target.value.replace(/\D/g, ""))}
                        inputMode="numeric"
                        placeholder="8"
                      />
                    </label>
                    <label>
                      السعر JOD
                      <input
                        value={customPrice}
                        onChange={(event) => setCustomPrice(event.target.value)}
                        inputMode="decimal"
                        placeholder="4"
                      />
                    </label>
                  </div>
                  <div className="custom-price-actions">
                    <button className="primary-lite" onClick={saveSelectedCustomerCustomPrice}>حفظ</button>
                    {Object.keys(selectedCustomer.customTankPrices ?? {}).map((metersKey) => (
                      <button key={metersKey} onClick={() => removeSelectedCustomerCustomPrice(Number(metersKey))}>
                        حذف {metersKey}م
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
            {selectedCustomer.debtBalance > selectedCustomer.creditLimit && (
              <div className="health-warning">العميل فوق حد الائتمان</div>
            )}
          </section>
        ) : customerMode === "new" && truckNumber ? (
          <div className="customer-strip">
            <strong>{truckNumber}</strong>
            <span>{newCustomerName.trim() || "بدون اسم"}</span>
            <span>{arabicPricePlan(newCustomerPricePlan)}</span>
            <span>سيارة جديدة</span>
          </div>
        ) : (
          <div className="empty-customer-choice">اختر عميل محفوظ أو أضف عميل جديد أولاً</div>
        )}

        <label className="meter-section-label">
          عدد الأمتار
          <input
            className="meters-input"
            value={meters}
            onChange={(event) => {
              setMeters(event.target.value);
              if (paymentType === "cash" || paymentType === "cliq") {
                setCashReceived(
                  String(getPlanPrice(Number(event.target.value || 0), activePricePlan, activeCustomPrices)),
                );
              }
            }}
            inputMode="decimal"
            placeholder="أدخل العدد يدوياً"
          />
        </label>

        <div className="quick-grid secondary">
          {quickMeters.map((value) => (
            <button
              key={value}
              className={Number(meters) === value ? "active" : ""}
              onClick={() => {
                setMeters(String(value));
                if (paymentType === "cash" || paymentType === "cliq") {
                  setCashReceived(String(getPlanPrice(value, activePricePlan, activeCustomPrices)));
                }
              }}
            >
              {value} متر
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="طريقة الدفع">
          {(["cash", "cliq", "debt", "partial"] as PaymentType[]).map((type) => (
            <button
              key={type}
              className={paymentType === type ? "active" : ""}
              onClick={() => updatePaymentType(type)}
            >
              {arabicPayment(type)}
            </button>
          ))}
        </div>

        <label>
          {paymentType === "cliq" ? "المبلغ المقبوض CliQ" : "المبلغ المقبوض كاش"}
          <input
            value={cashReceived}
            onChange={(event) => setCashReceived(event.target.value)}
            inputMode="decimal"
            disabled={paymentType !== "partial"}
          />
        </label>

        {selectedCustomer && selectedCustomer.debtBalance > 0 && (
          <section className="debt-payment-box">
            <div>
              <strong>على العميل دين سابق: {formatJod(selectedCustomer.debtBalance)}</strong>
              <span>إذا دفع القديم مع التعبئة الجديدة، سجله هنا بنفس عملية البيع.</span>
            </div>
            <div className="field-row">
              <label>
                دفعة من الدين السابق
                <input
                  value={oldDebtPayment}
                  onChange={(event) => setOldDebtPayment(event.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
              <label>
                طريقة دفعة الدين
                <div className="segmented mini" role="group" aria-label="طريقة دفعة الدين السابق">
                  {(["cash", "cliq"] as PaymentMethod[]).map((type) => (
                    <button
                      key={type}
                      className={oldDebtPaymentType === type ? "active" : ""}
                      onClick={() => setOldDebtPaymentType(type)}
                    >
                      {arabicPayment(type)}
                    </button>
                  ))}
                </div>
              </label>
            </div>
            <div className="quick-grid secondary">
              <button onClick={() => setOldDebtPayment("0")}>بدون تسديد</button>
              <button onClick={() => setOldDebtPayment(String(selectedCustomer.debtBalance))}>
                تسديد كامل الدين
              </button>
            </div>
          </section>
        )}

        <label>
          ملاحظات
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="اختياري"
          />
        </label>

        {error && <div className="alert danger">{error}</div>}
        <button className="primary-action" onClick={recordSale}>
          تسجيل البيع
        </button>

        <section className="preview-card inline-summary">
          <h3>ملخص البيع</h3>
          <div className="preview-number">{preview ? formatMeters(numericMeters) : "0 متر"}</div>
          <p className="price-plan-note">
            {activeCustomPrices[numericMeters] !== undefined
              ? `سعر خاص · ${formatJod(activeCustomPrices[numericMeters])}`
              : activePricePlan === "loyal" && LOYAL_TANK_PRICES[numericMeters] !== undefined
                ? `${arabicPricePlan(activePricePlan)} · السعر ${formatJod(LOYAL_TANK_PRICES[numericMeters])}`
                : arabicPricePlan(activePricePlan)}
          </p>
          <dl>
            <div>
              <dt>الإجمالي</dt>
              <dd>{preview ? formatJod(preview.totalAmount) : "0 JOD"}</dd>
            </div>
            <div>
              <dt>الكاش</dt>
              <dd>{preview ? formatJod(preview.cashReceived) : "0 JOD"}</dd>
            </div>
            <div>
              <dt>CliQ</dt>
              <dd>{preview ? formatJod(preview.cliqReceived) : "0 JOD"}</dd>
            </div>
            <div>
              <dt>الدين الجديد</dt>
              <dd>{preview ? formatJod(preview.debtAdded) : "0 JOD"}</dd>
            </div>
          </dl>
        </section>

        <section className="today-mini-control">
          <h3>سيطرة اليوم</h3>
          <div>
            <span>
              الأمتار
              <strong>{formatMeters(todayTotals.recordedMeters)}</strong>
            </span>
            <span>
              الكاش المتوقع
              <strong>{formatJod(todayTotals.expectedCash)}</strong>
            </span>
            <span>
              CliQ الكلي
              <strong>{formatJod(todayTotals.totalCliq)}</strong>
            </span>
            <span>
              دين اليوم
              <strong>{formatJod(todayTotals.debtAdded)}</strong>
            </span>
            <span>
              التنكات
              <strong>{todayTotals.tankCount}</strong>
            </span>
          </div>
        </section>
      </section>
    </div>
  );
}

function Dashboard({
  customers,
  todaySales,
}: {
  customers: Customer[];
  todaySales: Sale[];
}) {
  const totalMeters = todaySales.reduce((sum, sale) => sum + sale.meters, 0);
  const totalRevenue = todaySales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const cash = todaySales.reduce((sum, sale) => sum + sale.cashReceived, 0);
  const cliq = todaySales.reduce((sum, sale) => sum + (sale.cliqReceived ?? 0), 0);
  const debt = todaySales.reduce((sum, sale) => sum + sale.debtAdded, 0);
  const average = todaySales.length ? totalMeters / todaySales.length : 0;
  const topCustomers = [...customers]
    .map((customer) => ({
      customer,
      meters: todaySales
        .filter((sale) => sale.customerId === customer.id)
        .reduce((sum, sale) => sum + sale.meters, 0),
    }))
    .filter((item) => item.meters > 0)
    .sort((a, b) => b.meters - a.meters)
    .slice(0, 5);

  return (
    <div className="screen-stack">
      <div className="stats-grid">
        <StatCard title="إجمالي الأمتار" value={formatMeters(totalMeters)} icon={Droplets} />
        <StatCard title="قيمة المبيعات" value={formatJod(totalRevenue)} icon={Wallet} />
        <StatCard title="الكاش المحصل" value={formatJod(cash)} icon={Wallet} tone="green" />
        <StatCard title="CliQ" value={formatJod(cliq)} icon={Wallet} tone="green" />
        <StatCard title="ديون اليوم" value={formatJod(debt)} icon={AlertTriangle} tone="yellow" />
        <StatCard title="عدد التنكات" value={String(todaySales.length)} icon={Truck} />
        <StatCard title="متوسط البيع" value={formatMeters(average)} icon={Gauge} />
      </div>

      <div className="two-column">
        <section className="panel">
          <h2>أفضل العملاء اليوم</h2>
          {topCustomers.length ? (
            <div className="rank-list">
              {topCustomers.map((item, index) => (
                <div key={item.customer.id}>
                  <span>{index + 1}</span>
                  <strong>{item.customer.name}</strong>
                  <b>{formatMeters(item.meters)}</b>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
        <RecentSales sales={todaySales} />
      </div>
    </div>
  );
}

function TodaySummaryScreen({
  todaySales,
  payments,
  customers,
  syncState,
}: {
  todaySales: Sale[];
  payments: ReturnType<typeof usePersistentData>["data"]["payments"];
  customers: Customer[];
  syncState: SyncState;
}) {
  const today = todayKey();
  const todayPayments = getDayPayments(payments, today);
  const dayTotals = calculateDayTotals(todaySales, todayPayments);
  const totalDebtBalance = roundMoney(customers.reduce((sum, customer) => sum + customer.debtBalance, 0));
  const customersWithDebt = customers
    .filter((customer) => customer.debtBalance > 0)
    .sort((a, b) => b.debtBalance - a.debtBalance)
    .slice(0, 6);
  const topSales = [...todaySales]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 6);

  const summaryText = [
    `ملخص محطة المياه - ${today}`,
    `عدد التنكات: ${dayTotals.tankCount}`,
    `إجمالي الأمتار: ${formatMeters(dayTotals.recordedMeters)}`,
    `قيمة مبيعات اليوم: ${formatJod(dayTotals.salesRevenue)}`,
    `كاش البيع: ${formatJod(dayTotals.saleCash)}`,
    `CliQ البيع: ${formatJod(dayTotals.saleCliq)}`,
    `ديون جديدة اليوم: ${formatJod(dayTotals.debtAdded)}`,
    `دفعات ديون كاش: ${formatJod(dayTotals.debtCashCollected)}`,
    `دفعات ديون CliQ: ${formatJod(dayTotals.debtCliqCollected)}`,
    `إجمالي المقبوض اليوم: ${formatJod(dayTotals.totalCollected)}`,
    `الكاش المتوقع بالصندوق: ${formatJod(dayTotals.expectedCash)}`,
    `إجمالي الديون المفتوحة: ${formatJod(totalDebtBalance)}`,
  ].join("\n");

  return (
    <div className="screen-stack closing-screen">
      <section className="panel closing-summary-panel">
        <div className="section-heading spread">
          <div>
            <h2>ملخص اليوم</h2>
            <p>بدون عدادات صباح ومساء — هذه شاشة متابعة مبيعات اليوم والديون والتحصيل فقط.</p>
          </div>
          <button className="primary-lite" onClick={() => navigator.clipboard.writeText(summaryText)}>
            <Copy size={18} />
            نسخ الملخص
          </button>
        </div>
        <div className="stats-grid closing-daily-stats">
          <StatCard title="عدد التنكات" value={String(dayTotals.tankCount)} icon={Truck} />
          <StatCard title="إجمالي الأمتار" value={formatMeters(dayTotals.recordedMeters)} icon={Droplets} />
          <StatCard title="قيمة المبيعات" value={formatJod(dayTotals.salesRevenue)} icon={Wallet} />
          <StatCard title="كاش البيع" value={formatJod(dayTotals.saleCash)} icon={Wallet} tone="green" />
          <StatCard title="CliQ البيع" value={formatJod(dayTotals.saleCliq)} icon={Wallet} tone="green" />
          <StatCard title="ديون جديدة" value={formatJod(dayTotals.debtAdded)} icon={AlertTriangle} tone="yellow" />
          <StatCard title="دفعات ديون كاش" value={formatJod(dayTotals.debtCashCollected)} icon={CheckCircle2} tone="green" />
          <StatCard title="دفعات ديون CliQ" value={formatJod(dayTotals.debtCliqCollected)} icon={CheckCircle2} tone="green" />
          <StatCard title="إجمالي المقبوض" value={formatJod(dayTotals.totalCollected)} icon={Wallet} tone="green" />
          <StatCard title="الكاش المتوقع" value={formatJod(dayTotals.expectedCash)} icon={Gauge} />
          <StatCard title="إجمالي الديون المفتوحة" value={formatJod(totalDebtBalance)} icon={AlertTriangle} tone="red" />
        </div>
      </section>

      <div className="two-column">
        <section className="panel result-panel">
          <div className="section-heading spread">
            <div>
              <h2>مبيعات اليوم</h2>
              <p>آخر وأكبر العمليات المسجلة اليوم.</p>
            </div>
            <strong>{todaySales.length} عملية</strong>
          </div>
          {topSales.length ? (
            <div className="recent-list">
              {topSales.map((sale) => (
                <div key={sale.id}>
                  <strong>{sale.truckNumber} · {sale.customerName}</strong>
                  <span>{formatDateTime(sale.createdAt)}</span>
                  <b>
                    {formatMeters(sale.meters)} · إجمالي {formatJod(sale.totalAmount)} · كاش {formatJod(sale.cashReceived)} · CliQ {formatJod(sale.cliqReceived ?? 0)} · دين {formatJod(sale.debtAdded)}
                  </b>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </section>

        <section className="panel result-panel">
          <div className="section-heading spread">
            <div>
              <h2>الديون والتحصيل</h2>
              <p>دفعات اليوم وأعلى أرصدة مفتوحة.</p>
            </div>
            <strong>{formatJod(dayTotals.debtCollected)} دفعات اليوم</strong>
          </div>

          <div className="status-list">
            {todayPayments.length ? todayPayments.map((payment) => {
              const customer = customers.find((item) => item.id === payment.customerId);
              return (
                <div className="alert success" key={payment.id}>
                  دفعة {formatJod(payment.amount)} · {arabicPayment(payment.paymentType ?? "cash")} · {customer?.name ?? "عميل"}
                </div>
              );
            }) : <div className="alert warning">لا توجد دفعات ديون اليوم.</div>}
          </div>

          <h3>أعلى ديون مفتوحة</h3>
          {customersWithDebt.length ? (
            <div className="rank-list">
              {customersWithDebt.map((customer, index) => (
                <div key={customer.id}>
                  <span>{index + 1}</span>
                  <strong>{customer.truckNumbers[0] || customer.name}</strong>
                  <b>{formatJod(customer.debtBalance)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="alert success">لا توجد ديون مفتوحة حالياً.</div>
          )}
        </section>
      </div>

      <section className="panel report-panel">
        <div className="section-heading spread">
          <div>
            <h2>نسخة واتساب سريعة</h2>
            <p>انسخها وارسلها لأي شخص يحتاج ملخص اليوم.</p>
          </div>
          <span className={`sync-status-bar sync-${syncState.status}`}>{syncStatusText(syncState)}</span>
        </div>
        <pre>{summaryText}</pre>
      </section>
    </div>
  );
}

function MeterCard({
  title,
  opening,
  closing,
  usage,
  onOpening,
  onClosing,
  onOpeningPhoto,
  onClosingPhoto,
  openingPhoto,
  closingPhoto,
}: {
  title: string;
  opening: string;
  closing: string;
  usage: number;
  onOpening: (value: string) => void;
  onClosing: (value: string) => void;
  onOpeningPhoto: (file?: File) => void;
  onClosingPhoto: (file?: File) => void;
  openingPhoto: string;
  closingPhoto: string;
}) {
  return (
    <section className="panel meter-card">
      <h2>{title}</h2>
      <div className="meter-input-row">
        <label>
          قراءة الصباح
          <input value={opening} onChange={(event) => onOpening(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          قراءة المساء
          <input value={closing} onChange={(event) => onClosing(event.target.value)} inputMode="decimal" />
        </label>
      </div>
      <strong className="meter-total">{formatMeters(usage)}</strong>
      <div className="photo-row">
        <PhotoInput label="صورة صباحية" image={openingPhoto} onChange={onOpeningPhoto} />
        <PhotoInput label="صورة مسائية" image={closingPhoto} onChange={onClosingPhoto} />
      </div>
    </section>
  );
}

function PhotoInput({
  label,
  image,
  onChange,
}: {
  label: string;
  image: string;
  onChange: (file?: File) => void;
}) {
  return (
    <label className="photo-input">
      {image ? <img src={image} alt={label} /> : <span>{label}</span>}
      <input type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0])} />
    </label>
  );
}

function buildCustomerStatement(customer: Customer, sales: Sale[], payments: AppData["payments"]) {
  const saleRows = sales
    .filter((sale) => sale.customerId === customer.id && !sale.deleted)
    .map((sale) => ({
      createdAt: sale.createdAt,
      text: `${formatDateTime(sale.createdAt)} | بيع ${formatMeters(sale.meters)} | ${formatJod(sale.totalAmount)} | ${arabicPayment(sale.paymentType)} | دين جديد ${formatJod(sale.debtAdded)}`,
    }));
  const paymentRows = payments
    .filter((payment) => payment.customerId === customer.id)
    .map((payment) => ({
      createdAt: payment.createdAt,
      text: `${formatDateTime(payment.createdAt)} | دفعة ${formatJod(payment.amount)} | ${arabicPayment(payment.paymentType ?? "cash")} | ${payment.notes || "بدون ملاحظة"}`,
    }));
  const rows = [...saleRows, ...paymentRows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return [
    `كشف حساب العميل: ${customer.name}`,
    `الهاتف: ${customer.phone || "لا يوجد"}`,
    `أرقام التنكات: ${customer.truckNumbers.join("، ") || "لا يوجد"}`,
    `نوع السعر: ${arabicPricePlan(customer.pricePlan)}`,
    `أسعار خاصة: ${formatCustomPrices(customer.customTankPrices)}`,
    `حد الائتمان: ${formatJod(customer.creditLimit)}`,
    `الرصيد الحالي: ${formatJod(customer.debtBalance)}`,
    "------------------------------",
    rows.length ? rows.map((row, index) => `${index + 1}. ${row.text}`) : ["لا توجد حركات بعد"],
  ].flat().join("\n");
}

function DebtLedger({
  data,
  setData,
}: {
  data: ReturnType<typeof usePersistentData>["data"];
  setData: ReturnType<typeof usePersistentData>["setData"];
}) {
  const [selectedId, setSelectedId] = useState(data.customers[0]?.id ?? "");
  const [payment, setPayment] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const selected = data.customers.find((customer) => customer.id === selectedId);
  const customerStatement = selected
    ? buildCustomerStatement(selected, data.sales, data.payments)
    : "";

  const recordPayment = () => {
    setError("");
    if (!selected) return;
    const amount = Number(payment);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("أدخل مبلغ دفعة صحيح أكبر من صفر");
      return;
    }
    if (amount > selected.debtBalance) {
      setError("مبلغ الدفعة أكبر من دين العميل الحالي");
      return;
    }
    const createdAt = new Date().toISOString();
    setData({
      ...data,
      customers: applyCustomerDebt(data.customers, selected.id, amount, "payment"),
      payments: [
        {
          id: createId("p"),
          customerId: selected.id,
          amount,
          paymentType,
          createdAt,
          notes: note,
        },
        ...data.payments,
      ],
    });
    setPayment("");
    setPaymentType("cash");
    setNote("");
  };

  return (
    <div className="two-column">
      <section className="panel">
        <h2>قائمة العملاء</h2>
        <div className="customer-list">
          {data.customers.map((customer) => (
            <button
              key={customer.id}
              className={selectedId === customer.id ? "active" : ""}
              onClick={() => setSelectedId(customer.id)}
            >
              <strong>{customer.name}</strong>
              <span>{customer.truckNumbers.join("، ")}</span>
              <b>{formatJod(customer.debtBalance)}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        {selected ? (
          <>
            <div className="section-heading">
              <Users size={26} />
              <div>
                <h2>{selected.name}</h2>
                <p>{selected.phone || "لا يوجد هاتف"}</p>
              </div>
            </div>
            <div className="stats-grid compact">
              <StatCard title="إجمالي الدين" value={formatJod(selected.debtBalance)} icon={AlertTriangle} tone={selected.debtBalance > selected.creditLimit ? "red" : "yellow"} />
              <StatCard title="حد الائتمان" value={formatJod(selected.creditLimit)} icon={Gauge} />
              <StatCard title="الحالة" value={selected.status === "good" ? "جيد" : "يحتاج دفعة"} icon={CheckCircle2} />
            </div>
            <div className="statement-box">
              <div className="receipt-actions">
                <strong>كشف حساب العميل</strong>
                <button className="primary-lite" onClick={() => navigator.clipboard.writeText(customerStatement)}>
                  <Copy size={16} />
                  نسخ الكشف
                </button>
              </div>
              <pre>{customerStatement}</pre>
            </div>
            <label>
              تسجيل دفعة
              <input value={payment} onChange={(event) => setPayment(event.target.value)} inputMode="decimal" />
            </label>
            <div className="segmented mini" role="group" aria-label="طريقة دفع الدين">
              {(["cash", "cliq"] as PaymentMethod[]).map((type) => (
                <button
                  key={type}
                  className={paymentType === type ? "active" : ""}
                  onClick={() => setPaymentType(type)}
                >
                  {arabicPayment(type)}
                </button>
              ))}
            </div>
            <label>
              ملاحظة الدفعة
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            {error && <div className="alert danger">{error}</div>}
            <button className="primary-action" onClick={recordPayment}>
              تسجيل دفعة
            </button>
            <h3>سجل العميل</h3>
            <div className="timeline">
              {data.sales
                .filter((sale) => sale.customerId === selected.id && !sale.deleted)
                .map((sale) => (
                  <div key={sale.id}>
                    <strong>بيع {formatMeters(sale.meters)}</strong>
                    <span>دين مضاف {formatJod(sale.debtAdded)}</span>
                  </div>
                ))}
              {data.payments
                .filter((item) => item.customerId === selected.id)
                .map((item) => (
                  <div key={item.id}>
                    <strong>دفعة {formatJod(item.amount)}</strong>
                    <span>{arabicPayment(item.paymentType ?? "cash")} · {item.notes || "بدون ملاحظة"}</span>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

function SalesHistory({
  sales,
  closings,
  managerMode,
  setData,
}: {
  sales: Sale[];
  closings: DailyClosing[];
  managerMode: boolean;
  setData: ReturnType<typeof usePersistentData>["setData"];
}) {
  const [filter, setFilter] = useState("");

  const visible = sales.filter((sale) =>
    `${sale.customerName} ${sale.truckNumber} ${sale.paymentType}`.includes(filter),
  );

  const applyDebtDelta = (customers: Customer[], customerId: string, delta: number) => {
    if (delta > 0) return applyCustomerDebt(customers, customerId, delta, "sale");
    if (delta < 0) return applyCustomerDebt(customers, customerId, Math.abs(delta), "payment");
    return customers;
  };

  const deleteSale = (saleId: string) => {
    const sale = sales.find((item) => item.id === saleId);
    if (!sale) return;
    if (closings.some((closing) => closing.date === dayKeyFromIso(sale.createdAt))) {
      window.alert("هذا اليوم مغلق. لا يمكن حذف بيع بعد الإغلاق حتى لا تتغير الأرقام بصمت.");
      return;
    }
    const reason = window.prompt("سبب حذف البيع؟ مثال: تم إدخال الطلب بالغلط");
    if (!reason) return;
    if (!window.confirm("تأكيد حذف هذا البيع من أرقام اليوم؟")) return;
    setData((current) => ({
      ...current,
      customers: applyDebtDelta(current.customers, sale.customerId, -sale.debtAdded),
      sales: current.sales.map((item) =>
        item.id === saleId ? { ...item, deleted: true, editReason: reason } : item,
      ),
    }));
  };

  const correctSalePayment = (saleId: string, nextPaymentType: PaymentType) => {
    const sale = sales.find((item) => item.id === saleId);
    if (!sale || sale.deleted) return;
    if (closings.some((closing) => closing.date === dayKeyFromIso(sale.createdAt))) {
      window.alert("هذا اليوم مغلق. لا يمكن تعديل بيع بعد الإغلاق حتى لا تتغير الأرقام بصمت.");
      return;
    }
    const reason = window.prompt(`سبب تعديل الدفع إلى ${arabicPayment(nextPaymentType)}؟`, "تصحيح طريقة الدفع");
    if (!reason) return;
    const partialCash = nextPaymentType === "partial" ? Number(window.prompt("كم قبض كاش؟", String(sale.cashReceived || 0)) || 0) : undefined;
    try {
      const corrected = recalculateExistingSalePayment(sale, nextPaymentType, reason, partialCash);
      const debtDelta = corrected.debtAdded - sale.debtAdded;
      setData((current) => ({
        ...current,
        customers: applyDebtDelta(current.customers, sale.customerId, debtDelta),
        sales: current.sales.map((item) => (item.id === saleId ? corrected : item)),
      }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "تعذر تعديل طريقة الدفع");
    }
  };

  return (
    <section className="panel">
      <div className="section-heading spread">
        <div>
          <h2>سجل المبيعات</h2>
          <p>البحث بالعميل أو التنك أو طريقة الدفع. الموظف يستطيع تصحيح طريقة الدفع أو حذف عملية غلط مع تسجيل السبب.</p>
        </div>
        <input
          className="small-search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="بحث"
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>الوقت</th>
              <th>العميل</th>
              <th>التنك</th>
              <th>الأمتار</th>
              <th>الإجمالي</th>
              <th>الكاش</th>
              <th>CliQ</th>
              <th>الدين</th>
              <th>إجراء</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((sale) => (
              <tr key={sale.id} className={sale.deleted ? "deleted" : ""}>
                <td>{formatDateTime(sale.createdAt)}</td>
                <td>{sale.customerName}</td>
                <td>{sale.truckNumber}</td>
                <td>{formatMeters(sale.meters)}</td>
                <td>{formatJod(sale.totalAmount)}</td>
                <td>{formatJod(sale.cashReceived)}</td>
                <td>{formatJod(sale.cliqReceived ?? 0)}</td>
                <td>{formatJod(sale.debtAdded)}</td>
                <td>
                  {!sale.deleted ? (
                    <div className="history-actions">
                      {sale.paymentType !== "debt" && (
                        <button className="icon-button correction-button" onClick={() => correctSalePayment(sale.id, "debt")} title="تصحيح إلى دين">
                          <RotateCcw size={18} />
                          كاش→دين
                        </button>
                      )}
                      {sale.paymentType !== "cash" && (
                        <button className="icon-button correction-button" onClick={() => correctSalePayment(sale.id, "cash")} title="تصحيح إلى كاش">
                          كاش
                        </button>
                      )}
                      {sale.paymentType !== "cliq" && (
                        <button className="icon-button correction-button" onClick={() => correctSalePayment(sale.id, "cliq")} title="تصحيح إلى CliQ">
                          CliQ
                        </button>
                      )}
                      <button className="icon-button danger-text" onClick={() => deleteSale(sale.id)} title="حذف البيع">
                        <Trash2 size={18} />
                        حذف
                      </button>
                    </div>
                  ) : (
                    <span className="muted-text">محذوف: {sale.editReason || "بدون سبب"}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ManagerReport({
  sales,
  customers,
  payments,
  closing,
}: {
  sales: Sale[];
  customers: Customer[];
  payments: ReturnType<typeof usePersistentData>["data"]["payments"];
  closing?: DailyClosing;
}) {
  const dayPayments = getDayPayments(payments);
  const totals = calculateDayTotals(sales, dayPayments);
  const topCustomers = [...customers]
    .sort((a, b) => b.debtBalance - a.debtBalance)
    .slice(0, 5);
  const report = [
    `تقرير محطة المياه - ${todayKey()}`,
    `المبيعات المسجلة: ${formatMeters(totals.recordedMeters)}`,
    `قيمة المبيعات: ${formatJod(totals.salesRevenue)}`,
    `كاش من البيع: ${formatJod(totals.saleCash)}`,
    `CliQ من البيع: ${formatJod(totals.saleCliq)}`,
    `دفعات ديون كاش: ${formatJod(totals.debtCashCollected)}`,
    `دفعات ديون CliQ: ${formatJod(totals.debtCliqCollected)}`,
    `إجمالي CliQ: ${formatJod(totals.totalCliq)}`,
    `إجمالي المقبوض كاش + CliQ: ${formatJod(totals.totalCollected)}`,
    `إجمالي دفعات الديون: ${formatJod(totals.debtCollected)}`,
    `الكاش المتوقع بالصندوق: ${formatJod(totals.expectedCash)}`,
    `ديون اليوم: ${formatJod(totals.debtAdded)}`,
    "أعلى ديون:",
    ...topCustomers.map((customer, index) => `${index + 1}. ${customer.name}: ${formatJod(customer.debtBalance)}`),
    "ملاحظات: لا يوجد",
    "توصية المدير: متابعة التسجيل اليومي والديون أولاً، والعدادات لاحقاً إذا احتجناها.",
  ].join("\n");

  return (
    <section className="panel report-panel">
      <div className="section-heading spread">
        <div>
          <h2>تقرير المدير اليومي</h2>
          <p>جاهز للنسخ إلى واتساب.</p>
        </div>
        <button className="primary-lite" onClick={() => navigator.clipboard.writeText(report)}>
          <Copy size={18} />
          نسخ تقرير واتساب
        </button>
      </div>
      <pre>{report}</pre>
    </section>
  );
}

function RecentSales({ sales }: { sales: Sale[] }) {
  return (
    <section className="panel">
      <h2>آخر المبيعات</h2>
      {sales.length ? (
        <div className="recent-list">
          {sales.slice(0, 8).map((sale) => (
            <div key={sale.id}>
              <strong>{sale.customerName}</strong>
              <span>{sale.truckNumber}</span>
              <b>
                {formatMeters(sale.meters)} · كاش {formatJod(sale.cashReceived)} · CliQ {formatJod(sale.cliqReceived ?? 0)}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <img src="/generated/app-concept.png" alt="واجهة نظام محطة المياه" />
      <strong>لا توجد مبيعات بعد</strong>
      <span>ابدأ من شاشة بيع جديد.</span>
    </div>
  );
}

export default App;
