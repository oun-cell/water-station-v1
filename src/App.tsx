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
  Search,
  Settings,
  Trash2,
  Truck,
  Upload,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DAILY_MAX_PRODUCTION,
  LOYAL_TANK_PRICES,
  OPENING_HOURS_LABEL,
  PRICE_PER_METER,
  PRODUCTION_RATE_PER_HOUR,
  STORAGE_POOL_CAPACITY,
  calculateClosing,
  calculateDayTotals,
  calculateSalePayment,
  dayKeyFromIso,
  deriveCustomerStatus,
  findRecentDuplicateTruck,
  getDayPayments,
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
  { view: "closing", label: "الإغلاق والعدادات", icon: Gauge },
  { view: "debts", label: "ديون العملاء", icon: Users },
  { view: "history", label: "سجل المبيعات", icon: History },
  { view: "report", label: "التقرير", icon: FileText, manager: true },
];

const quickMeters = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22];
const MANAGER_PIN = "REMOVED_PIN";

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

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
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

function getPlanPrice(meters: number, plan: CustomerPricePlan = "standard") {
  if (plan === "loyal" && LOYAL_TANK_PRICES[meters] !== undefined) {
    return LOYAL_TANK_PRICES[meters];
  }

  return roundMoney(meters * PRICE_PER_METER);
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
  const [pin, setPin] = useState("");

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
            <small>نظام البيع والإغلاق</small>
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
                if (pin === MANAGER_PIN) {
                  setManagerMode(true);
                  setPin("");
                }
              }}
            >
              <input
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                inputMode="numeric"
                placeholder="PIN المدير"
                aria-label="PIN المدير"
              />
              <button type="submit">دخول</button>
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
        <header className="topbar">
          <div>
            <p>السعر ثابت: {PRICE_PER_METER} JOD لكل متر</p>
            <h1>{navItems.find((item) => item.view === view)?.label}</h1>
          </div>
          <div className="business-chips">
            <span>الإنتاج {PRODUCTION_RATE_PER_HOUR} متر/ساعة</span>
            <span>اليومي {DAILY_MAX_PRODUCTION} متر</span>
            <span>{OPENING_HOURS_LABEL}</span>
            <span>السعة {STORAGE_POOL_CAPACITY.toLocaleString()} متر</span>
          </div>
        </header>

        {view === "sale" && <SaleScreen data={data} setData={setData} todayClosing={latestClosing} />}
        {view === "dashboard" && managerMode && (
          <Dashboard customers={data.customers} todaySales={todaySales} />
        )}
        {view === "closing" && (
          <ClosingScreen
            todaySales={todaySales}
            payments={data.payments}
            closings={data.closings}
            setData={setData}
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
}: {
  data: AppData;
  setData: ReturnType<typeof usePersistentData>["setData"];
  resetDemoData: () => void;
  clearData: () => void;
}) {
  const [status, setStatus] = useState("");

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
  todayClosing,
}: {
  data: ReturnType<typeof usePersistentData>["data"];
  setData: ReturnType<typeof usePersistentData>["setData"];
  todayClosing?: DailyClosing;
}) {
  const [query, setQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerMode, setCustomerMode] = useState<"saved" | "new">("saved");
  const [truckNumber, setTruckNumber] = useState("");
  const [meters, setMeters] = useState("12");
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [cashReceived, setCashReceived] = useState("12");
  const [oldDebtPayment, setOldDebtPayment] = useState("");
  const [oldDebtPaymentType, setOldDebtPaymentType] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [phone, setPhone] = useState("");
  const [newCustomerPricePlan, setNewCustomerPricePlan] =
    useState<CustomerPricePlan>("standard");
  const [success, setSuccess] = useState<Sale | null>(null);
  const [lastReceipt, setLastReceipt] = useState("");
  const [error, setError] = useState("");

  const selectedCustomer = data.customers.find(
    (customer) => customer.id === selectedCustomerId,
  );
  const searchedCustomers = data.customers
    .filter((customer) =>
      `${customer.name} ${customer.truckNumbers.join(" ")} ${customer.phone}`.includes(query),
    )
    .slice(0, 30);
  const frequentCustomers = [...data.customers]
    .sort((a, b) => (b.lastSaleAt ?? "").localeCompare(a.lastSaleAt ?? ""))
    .slice(0, 8);
  const numericMeters = Number(meters);
  const activePricePlan: CustomerPricePlan =
    selectedCustomer?.pricePlan ?? (customerMode === "new" ? newCustomerPricePlan : "standard");
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
      );
    } catch {
      return null;
    }
  }, [activePricePlan, cashReceived, numericMeters, paymentType]);

  useEffect(() => {
    if ((paymentType === "cash" || paymentType === "cliq") && numericMeters > 0) {
      setCashReceived(String(getPlanPrice(numericMeters, activePricePlan)));
    }
  }, [activePricePlan, numericMeters, paymentType]);

  const chooseCustomer = (customer: Customer) => {
    setCustomerMode("saved");
    setSelectedCustomerId(customer.id);
    setQuery(customer.name);
    setTruckNumber(digitsOnly(customer.truckNumbers[0] ?? ""));
    setPhone(customer.phone);
    setNewCustomerPricePlan(customer.pricePlan ?? "standard");
  };

  const startNewCustomer = () => {
    setCustomerMode("new");
    setSelectedCustomerId("");
    setQuery("");
    setTruckNumber("");
    setPhone("");
    setNewCustomerPricePlan("standard");
    setSuccess(null);
    setLastReceipt("");
    setError("");
  };

  const startSavedCustomer = () => {
    setCustomerMode("saved");
    setSelectedCustomerId("");
    setQuery("");
    setTruckNumber("");
    setPhone("");
    setNewCustomerPricePlan("standard");
    setSuccess(null);
    setLastReceipt("");
    setError("");
  };

  const updatePaymentType = (type: PaymentType) => {
    setPaymentType(type);
    const amount = getPlanPrice(Number(meters || 0), activePricePlan);
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
    const customerName = query.trim();
    const amountMeters = Number(meters);

    if (customerMode === "saved" && !selectedCustomerId) {
      setError("اختَر عميل محفوظ أو اضغط عميل جديد");
      return;
    }

    if (!customerName) {
      setError("اسم العميل مطلوب");
      return;
    }
    if (!amountMeters || amountMeters <= 0) {
      setError("عدد الأمتار مطلوب ويجب أن يكون أكبر من صفر");
      return;
    }
    if (!truckNumber.trim()) {
      setError("رقم التنك مطلوب حتى لا تضيع المبيعات بين العملاء");
      return;
    }
    if (todayClosing) {
      setError("تم إغلاق اليوم. لا يمكن تسجيل بيع جديد بعد الإغلاق.");
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

    const duplicate = findRecentDuplicateTruck(data.sales, truckNumber);
    if (duplicate && !window.confirm(`هذا التنك مسجل قبل قليل باسم ${duplicate.customerName}. هل أنت متأكد أنه بيع جديد؟`)) {
      return;
    }

    try {
      const calculation = calculateSalePayment(
        amountMeters,
        paymentType,
        paymentType === "partial" ? Number(cashReceived || 0) : undefined,
        activePricePlan,
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
            truckNumbers: truckNumber ? [truckNumber] : [],
            debtBalance: 0,
            creditLimit: 50,
            pricePlan: newCustomerPricePlan,
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
                name: customerName,
                phone,
                pricePlan: customer.pricePlan ?? "standard",
                truckNumbers: Array.from(
                  new Set([
                    ...(truckNumber ? [truckNumber] : []),
                    ...customer.truckNumbers,
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
        truckNumber: digitsOnly(truckNumber),
        meters: amountMeters,
        pricePerMeter: calculation.pricePerMeter,
        pricePlan: activePricePlan,
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
      setMeters("12");
      setPaymentType("cash");
      setCashReceived("12");
      setOldDebtPayment("");
      setOldDebtPaymentType("cash");
      setNotes("");
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
            <h2>اختيار العميل</h2>
            <p>ابحث بالاسم أو رقم التنك أو الهاتف.</p>
          </div>
        </div>

        <div className="customer-mode-grid" role="group" aria-label="نوع العميل">
          <button
            className={customerMode === "saved" ? "active" : ""}
            onClick={startSavedCustomer}
          >
            <Users size={28} />
            <strong>عميل محفوظ</strong>
            <span>اختيار من العملاء المعروفين</span>
          </button>
          <button className={customerMode === "new" ? "active" : ""} onClick={startNewCustomer}>
            <UserPlus size={28} />
            <strong>عميل جديد</strong>
            <span>إضافة الاسم والتنك مرة واحدة</span>
          </button>
        </div>

        {customerMode === "saved" ? (
          <section className="customer-picker">
            <label>
              بحث العملاء
              <div className="search-input">
                <Search size={20} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedCustomerId("");
                  }}
                  placeholder="ابحث بالاسم أو رقم التنك أو الهاتف"
                />
              </div>
            </label>

            <div className="frequent-strip" aria-label="العملاء المتكررون">
              <span>العملاء المتكررون</span>
              {frequentCustomers.slice(0, 5).map((customer) => (
                <button key={customer.id} onClick={() => chooseCustomer(customer)}>
                  {customer.name}
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
                    <strong>{customer.name}</strong>
                    <b>{formatJod(customer.debtBalance)}</b>
                  </span>
                  <span>{customer.truckNumbers.join("، ") || "بدون رقم تنك"}</span>
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
              اسم العميل الجديد
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="مثال: محمد العجارمة"
              />
            </label>
            <div className="field-row">
              <label>
                رقم التنك
                <input
                  value={truckNumber}
                  onChange={(event) => setTruckNumber(digitsOnly(event.target.value))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="مثال: 1234567"
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
        <div className="section-heading sale-title">
          <span className="title-icon">
            <Truck size={30} />
          </span>
          <div>
            <h2>تفاصيل التعبئة</h2>
            <p>أدخل عدد الأمتار يدوياً ثم اختر طريقة الدفع.</p>
          </div>
        </div>

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
            {selectedCustomer.debtBalance > selectedCustomer.creditLimit && (
              <div className="health-warning">العميل فوق حد الائتمان</div>
            )}
          </section>
        ) : customerMode === "new" && query ? (
          <div className="customer-strip">
            <strong>{query}</strong>
            <span>عميل جديد</span>
            <span>{arabicPricePlan(newCustomerPricePlan)}</span>
            {truckNumber && <span>رقم التنك: {truckNumber}</span>}
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
                  String(getPlanPrice(Number(event.target.value || 0), activePricePlan)),
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
                  setCashReceived(String(getPlanPrice(value, activePricePlan)));
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
            {arabicPricePlan(activePricePlan)}
            {activePricePlan === "loyal" && LOYAL_TANK_PRICES[numericMeters] !== undefined
              ? ` · السعر ${formatJod(LOYAL_TANK_PRICES[numericMeters])}`
              : ""}
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

        {success && (
          <section className="success-card">
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

function ClosingScreen({
  todaySales,
  payments,
  closings,
  setData,
}: {
  todaySales: Sale[];
  payments: ReturnType<typeof usePersistentData>["data"]["payments"];
  closings: DailyClosing[];
  setData: ReturnType<typeof usePersistentData>["setData"];
}) {
  const today = todayKey();
  const todayPayments = getDayPayments(payments, today);
  const dayTotals = calculateDayTotals(todaySales, todayPayments);
  const savedToday = closings.find((closing) => closing.date === today);
  const previousClosing = [...closings]
    .filter((closing) => closing.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const [form, setForm] = useState(() => ({
    pool1OpeningMeter: String(savedToday?.pool1OpeningMeter ?? previousClosing?.pool1ClosingMeter ?? ""),
    pool1ClosingMeter: String(savedToday?.pool1ClosingMeter ?? ""),
    pool2OpeningMeter: String(savedToday?.pool2OpeningMeter ?? previousClosing?.pool2ClosingMeter ?? ""),
    pool2ClosingMeter: String(savedToday?.pool2ClosingMeter ?? ""),
    cashCounted: String(savedToday?.cashCounted ?? ""),
    notes: savedToday?.notes ?? "",
    pool1OpeningPhoto: savedToday?.pool1OpeningPhoto ?? "",
    pool1ClosingPhoto: savedToday?.pool1ClosingPhoto ?? "",
    pool2OpeningPhoto: savedToday?.pool2OpeningPhoto ?? "",
    pool2ClosingPhoto: savedToday?.pool2ClosingPhoto ?? "",
  }));

  const hasRequiredClosingInputs =
    form.pool1OpeningMeter !== "" &&
    form.pool1ClosingMeter !== "" &&
    form.pool2OpeningMeter !== "" &&
    form.pool2ClosingMeter !== "" &&
    form.cashCounted !== "";

  const calculated = calculateClosing({
    pool1OpeningMeter: Number(form.pool1OpeningMeter || 0),
    pool1ClosingMeter: Number(form.pool1ClosingMeter || 0),
    pool2OpeningMeter: Number(form.pool2OpeningMeter || 0),
    pool2ClosingMeter: Number(form.pool2ClosingMeter || 0),
    recordedMeters: dayTotals.recordedMeters,
    expectedCash: dayTotals.expectedCash,
    cashCounted: Number(form.cashCounted || 0),
  });

  const canSave = hasRequiredClosingInputs && calculated.errors.length === 0;

  const setPhoto = (key: keyof typeof form, file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((current) => ({ ...current, [key]: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const saveClosing = () => {
    if (!canSave) return;
    const closing: DailyClosing = {
      id: savedToday?.id ?? createId("d"),
      date: today,
      pool1OpeningMeter: Number(form.pool1OpeningMeter),
      pool1ClosingMeter: Number(form.pool1ClosingMeter),
      pool2OpeningMeter: Number(form.pool2OpeningMeter),
      pool2ClosingMeter: Number(form.pool2ClosingMeter),
      pool1ActualMeters: calculated.pool1ActualMeters,
      pool2ActualMeters: calculated.pool2ActualMeters,
      actualMeters: calculated.actualMeters,
      recordedMeters: calculated.recordedMeters,
      missingMeters: calculated.missingMeters,
      missingValue: calculated.missingValue,
      expectedCash: calculated.expectedCash,
      cashCounted: calculated.cashCounted,
      cashDifference: calculated.cashDifference,
      saleCash: dayTotals.saleCash,
      saleCliq: dayTotals.saleCliq,
      debtCollected: dayTotals.debtCollected,
      debtCashCollected: dayTotals.debtCashCollected,
      debtCliqCollected: dayTotals.debtCliqCollected,
      salesRevenue: dayTotals.salesRevenue,
      debtAdded: dayTotals.debtAdded,
      tankCount: dayTotals.tankCount,
      pool1OpeningPhoto: form.pool1OpeningPhoto,
      pool1ClosingPhoto: form.pool1ClosingPhoto,
      pool2OpeningPhoto: form.pool2OpeningPhoto,
      pool2ClosingPhoto: form.pool2ClosingPhoto,
      notes: form.notes,
    };

    setData((current) => ({
      ...current,
      closings: [closing, ...current.closings.filter((item) => item.date !== today)],
    }));
  };

  return (
    <div className="screen-stack">
      <section className="panel">
        <div className="section-heading spread">
          <div>
            <h2>قفل أرقام اليوم</h2>
            <p>ادخل قراءات الصباح والمساء والكاش الموجود. النظام يقارنها مع كل المبيعات والدفعات.</p>
          </div>
          <strong className={`closing-badge ${calculated.status}`}>
            {calculated.status === "balanced" ? "مطابق" : calculated.status === "warning" ? "يوجد فرق" : "يوجد خطأ"}
          </strong>
        </div>
        <div className="stats-grid">
          <StatCard title="مبيعات اليوم" value={formatJod(dayTotals.salesRevenue)} icon={Wallet} />
          <StatCard title="كاش البيع" value={formatJod(dayTotals.saleCash)} icon={Wallet} tone="green" />
          <StatCard title="CliQ" value={formatJod(dayTotals.saleCliq)} icon={Wallet} tone="green" />
          <StatCard title="دفعات ديون كاش" value={formatJod(dayTotals.debtCashCollected)} icon={CheckCircle2} tone="green" />
          <StatCard title="دفعات ديون CliQ" value={formatJod(dayTotals.debtCliqCollected)} icon={CheckCircle2} tone="green" />
          <StatCard title="الكاش المتوقع" value={formatJod(dayTotals.expectedCash)} icon={Gauge} />
          <StatCard title="ديون جديدة" value={formatJod(dayTotals.debtAdded)} icon={AlertTriangle} tone="yellow" />
          <StatCard title="عدد التنكات" value={String(dayTotals.tankCount)} icon={Truck} />
        </div>
      </section>

      <div className="closing-grid">
        <MeterCard
          title="عداد البركة 1"
          opening={form.pool1OpeningMeter}
          closing={form.pool1ClosingMeter}
          usage={calculated.pool1ActualMeters}
          onOpening={(value) => setForm({ ...form, pool1OpeningMeter: value })}
          onClosing={(value) => setForm({ ...form, pool1ClosingMeter: value })}
          onOpeningPhoto={(file) => setPhoto("pool1OpeningPhoto", file)}
          onClosingPhoto={(file) => setPhoto("pool1ClosingPhoto", file)}
          openingPhoto={form.pool1OpeningPhoto}
          closingPhoto={form.pool1ClosingPhoto}
        />
        <MeterCard
          title="عداد البركة 2"
          opening={form.pool2OpeningMeter}
          closing={form.pool2ClosingMeter}
          usage={calculated.pool2ActualMeters}
          onOpening={(value) => setForm({ ...form, pool2OpeningMeter: value })}
          onClosing={(value) => setForm({ ...form, pool2ClosingMeter: value })}
          onOpeningPhoto={(file) => setPhoto("pool2OpeningPhoto", file)}
          onClosingPhoto={(file) => setPhoto("pool2ClosingPhoto", file)}
          openingPhoto={form.pool2OpeningPhoto}
          closingPhoto={form.pool2ClosingPhoto}
        />
      </div>

      <section className="panel result-panel">
        <h2>نتيجة الإغلاق</h2>
        <div className="stats-grid">
          <StatCard title="إجمالي العدادين" value={formatMeters(calculated.actualMeters)} icon={Gauge} />
          <StatCard title="المبيعات المسجلة" value={formatMeters(dayTotals.recordedMeters)} icon={ClipboardList} />
          <StatCard
            title="فرق المياه"
            value={formatMeters(calculated.missingMeters)}
            icon={AlertTriangle}
            tone={calculated.missingMeters === 0 ? "green" : "red"}
          />
          <StatCard
            title="فرق الكاش"
            value={formatJod(calculated.cashDifference)}
            icon={Wallet}
            tone={calculated.cashDifference === 0 ? "green" : calculated.cashDifference < 0 ? "red" : "yellow"}
          />
        </div>

        <div className="status-list">
          {!hasRequiredClosingInputs && <div className="alert warning">أكمل قراءات العدادين والكاش الموجود قبل الحفظ.</div>}
          {calculated.errors.map((item) => (
            <div className="alert danger" key={item}>{item}</div>
          ))}
          {hasRequiredClosingInputs && calculated.warnings.map((item) => (
            <div className="alert warning" key={item}>{item}</div>
          ))}
          {hasRequiredClosingInputs && calculated.status === "balanced" && (
            <div className="alert success">يوم مطابق: العداد والكاش متطابقان مع السجل</div>
          )}
        </div>

        <label>
          الكاش الموجود فعلياً بالصندوق
          <input
            value={form.cashCounted}
            onChange={(event) => setForm({ ...form, cashCounted: event.target.value })}
            inputMode="decimal"
            placeholder={`المفروض: ${formatJod(dayTotals.expectedCash)}`}
          />
        </label>
        <label>
          ملاحظات / تفسير أي فرق
          <textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="مثال: تنك نسي الموظف يسجله / كاش تم تحويله CliQ / خطأ قراءة"
          />
        </label>
        <button className="primary-action" onClick={saveClosing} disabled={!canSave}>
          حفظ وقفل إغلاق اليوم
        </button>
        {savedToday && <p className="saved-note">تم حفظ إغلاق لهذا اليوم. الحفظ الجديد يستبدله.</p>}
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
      <label>
        قراءة العداد الصباحية
        <input value={opening} onChange={(event) => onOpening(event.target.value)} inputMode="decimal" />
      </label>
      <label>
        قراءة العداد المسائية
        <input value={closing} onChange={(event) => onClosing(event.target.value)} inputMode="decimal" />
      </label>
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

  const deleteSale = (saleId: string) => {
    const sale = sales.find((item) => item.id === saleId);
    if (!sale) return;
    if (closings.some((closing) => closing.date === dayKeyFromIso(sale.createdAt))) {
      window.alert("هذا اليوم مغلق. لا يمكن حذف بيع بعد الإغلاق حتى لا تتغير الأرقام بصمت.");
      return;
    }
    const reason = window.prompt("سبب حذف البيع؟");
    if (!reason) return;
    setData((current) => ({
      ...current,
      customers: sale.debtAdded > 0
        ? applyCustomerDebt(current.customers, sale.customerId, sale.debtAdded, "payment")
        : current.customers,
      sales: current.sales.map((item) =>
        item.id === saleId ? { ...item, deleted: true, editReason: reason } : item,
      ),
    }));
  };

  return (
    <section className="panel">
      <div className="section-heading spread">
        <div>
          <h2>سجل المبيعات</h2>
          <p>البحث بالعميل أو التنك أو طريقة الدفع. الحذف يحتاج دخول المدير.</p>
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
                  {!sale.deleted && managerMode && (
                    <button className="icon-button danger-text" onClick={() => deleteSale(sale.id)}>
                      <Trash2 size={18} />
                    </button>
                  )}
                  {!sale.deleted && !managerMode && <span className="muted-text">عرض فقط</span>}
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
    closing
      ? `العداد: فعلي ${formatMeters(closing.actualMeters)} / فرق مياه ${formatMeters(closing.missingMeters)} / فرق كاش ${formatJod(closing.cashDifference)}`
      : "لم يتم حفظ إغلاق اليوم بعد",
    "أعلى ديون:",
    ...topCustomers.map((customer, index) => `${index + 1}. ${customer.name}: ${formatJod(customer.debtBalance)}`),
    closing?.notes ? `ملاحظات: ${closing.notes}` : "ملاحظات: لا يوجد",
    closing && closing.missingMeters > 0
      ? "توصية المدير: مراجعة المبيعات غير المسجلة مع الموظف."
      : "توصية المدير: متابعة التسجيل اليومي بنفس الطريقة.",
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
