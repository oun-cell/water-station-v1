import type { Customer, DailyClosing, Payment, Sale } from "./types";
import { deriveCustomerStatus, getDaySales as getSalesForDay, todayKey } from "./lib/business";

export type AppData = {
  customers: Customer[];
  sales: Sale[];
  payments: Payment[];
  closings: DailyClosing[];
};

const now = new Date();
const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

export const seedData: AppData = {
  customers: [
    {
      id: "c-ahmad",
      name: "أحمد محمود",
      phone: "0795551234",
      truckNumbers: ["12-34567"],
      debtBalance: 6,
      creditLimit: 50,
      pricePlan: "loyal",
      createdAt: now.toISOString(),
      lastSaleAt: hourAgo,
      status: "good",
    },
    {
      id: "c-nada",
      name: "مؤسسة الندى",
      phone: "0782227788",
      truckNumbers: ["18-90210", "18-90211"],
      debtBalance: 64,
      creditLimit: 50,
      pricePlan: "standard",
      createdAt: now.toISOString(),
      lastSaleAt: twoHoursAgo,
      status: "needs-payment",
    },
    {
      id: "c-suleiman",
      name: "سليمان الخطيب",
      phone: "0774013333",
      truckNumbers: ["11-77889"],
      debtBalance: 0,
      creditLimit: 40,
      pricePlan: "loyal",
      createdAt: now.toISOString(),
      lastPaymentAt: twoHoursAgo,
      status: "good",
    },
    {
      id: "c-khaled",
      name: "خالد الزعبي",
      phone: "0794410099",
      truckNumbers: ["13-22440"],
      debtBalance: 18,
      creditLimit: 60,
      pricePlan: "standard",
      createdAt: now.toISOString(),
      status: "good",
    },
    {
      id: "c-mazen",
      name: "مازن أبو زيد",
      phone: "0781133557",
      truckNumbers: ["19-77331"],
      debtBalance: 42,
      creditLimit: 40,
      pricePlan: "loyal",
      createdAt: now.toISOString(),
      status: "needs-payment",
    },
    {
      id: "c-safa",
      name: "مزارع الصفا",
      phone: "0778844201",
      truckNumbers: ["15-60021", "15-60022"],
      debtBalance: 0,
      creditLimit: 100,
      pricePlan: "standard",
      createdAt: now.toISOString(),
      status: "good",
    },
    {
      id: "c-omar",
      name: "عمر الحمود",
      phone: "0797788112",
      truckNumbers: ["10-43118"],
      debtBalance: 9,
      creditLimit: 50,
      pricePlan: "standard",
      createdAt: now.toISOString(),
      status: "good",
    },
    {
      id: "c-bilal",
      name: "بلال الرواشدة",
      phone: "0773321098",
      truckNumbers: ["16-11904"],
      debtBalance: 0,
      creditLimit: 50,
      pricePlan: "loyal",
      createdAt: now.toISOString(),
      status: "good",
    },
    {
      id: "c-faisal",
      name: "فيصل الشوابكة",
      phone: "0789901200",
      truckNumbers: ["20-50119"],
      debtBalance: 75,
      creditLimit: 70,
      pricePlan: "standard",
      createdAt: now.toISOString(),
      status: "needs-payment",
    },
  ],
  sales: [
    {
      id: "s-1",
      createdAt: twoHoursAgo,
      customerId: "c-nada",
      customerName: "مؤسسة الندى",
      truckNumber: "18-90210",
      meters: 16,
      pricePerMeter: 1,
      totalAmount: 16,
      paymentType: "partial",
      cashReceived: 8,
      debtAdded: 8,
      notes: "دفع نصف المبلغ",
    },
    {
      id: "s-2",
      createdAt: hourAgo,
      customerId: "c-ahmad",
      customerName: "أحمد محمود",
      truckNumber: "12-34567",
      meters: 12,
      pricePerMeter: 11 / 12,
      pricePlan: "loyal",
      totalAmount: 11,
      paymentType: "cash",
      cashReceived: 11,
      debtAdded: 0,
      notes: "",
    },
  ],
  payments: [
    {
      id: "p-1",
      customerId: "c-suleiman",
      amount: 20,
      paymentType: "cash",
      createdAt: twoHoursAgo,
      notes: "تسديد سابق",
    },
  ],
  closings: [],
};

export function applyCustomerDebt(
  customers: Customer[],
  customerId: string,
  amount: number,
  kind: "sale" | "payment" | "adjustment",
): Customer[] {
  const timestamp = new Date().toISOString();

  return customers.map((customer) => {
    if (customer.id !== customerId) return customer;

    const nextDebt =
      kind === "payment"
        ? Math.max(0, customer.debtBalance - amount)
        : Math.max(0, customer.debtBalance + amount);

    return {
      ...customer,
      debtBalance: nextDebt,
      lastSaleAt: kind === "sale" ? timestamp : customer.lastSaleAt,
      lastPaymentAt: kind === "payment" ? timestamp : customer.lastPaymentAt,
      status: deriveCustomerStatus(nextDebt, customer.creditLimit),
    };
  });
}

export function getTodaySales(sales: Sale[]) {
  return getSalesForDay(sales, todayKey());
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
