import type { CustomerPricePlan, CustomerStatus, Payment, PaymentType, Sale } from "../types";

export const PRICE_PER_METER = 1;
export const PRODUCTION_RATE_PER_HOUR = 20;
export const DAILY_MAX_PRODUCTION = 480;
export const STORAGE_POOL_CAPACITY = 25000;
export const OPENING_HOURS_LABEL = "السبت–الخميس 7 صباحاً–7 مساءً";
export const LOYAL_TANK_PRICES: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 6,
  8: 7,
  9: 8,
  10: 9,
  11: 10,
  12: 11,
  14: 13,
  16: 14,
};

export type SalePaymentCalculation = {
  pricePerMeter: number;
  totalAmount: number;
  cashReceived: number;
  cliqReceived: number;
  debtAdded: number;
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isValidNumber(value: number): boolean {
  return Number.isFinite(value) && !Number.isNaN(value);
}

export function calculateSalePayment(
  meters: number,
  paymentType: PaymentType,
  enteredCash?: number,
  pricePlan: CustomerPricePlan = "standard",
): SalePaymentCalculation {
  if (!isValidNumber(meters) || meters <= 0) {
    throw new Error("Requested meters must be greater than zero.");
  }

  const loyalPrice = LOYAL_TANK_PRICES[meters];
  const totalAmount = roundMoney(
    pricePlan === "loyal" && loyalPrice !== undefined
      ? loyalPrice
      : meters * PRICE_PER_METER,
  );
  const cashReceived =
    paymentType === "cash"
      ? totalAmount
      : paymentType === "partial"
        ? roundMoney(enteredCash ?? 0)
        : 0;
  const cliqReceived = paymentType === "cliq" ? totalAmount : 0;

  if (!isValidNumber(cashReceived)) {
    throw new Error("Cash received must be a valid number.");
  }

  if (cashReceived < 0) {
    throw new Error("Cash received cannot be negative.");
  }

  if (cashReceived > totalAmount) {
    throw new Error("Cash received cannot exceed sale total.");
  }

  if (cashReceived + cliqReceived > totalAmount) {
    throw new Error("Collected amount cannot exceed sale total.");
  }

  return {
    pricePerMeter: totalAmount / meters,
    totalAmount,
    cashReceived,
    cliqReceived,
    debtAdded: roundMoney(totalAmount - cashReceived - cliqReceived),
  };
}

export type ClosingInput = {
  pool1OpeningMeter: number;
  pool1ClosingMeter: number;
  pool2OpeningMeter: number;
  pool2ClosingMeter: number;
  recordedMeters: number;
  expectedCash: number;
  cashCounted: number;
};

export function calculateClosing(input: ClosingInput) {
  const errors: string[] = [];
  const requiredNumbers: Array<[keyof ClosingInput, string]> = [
    ["pool1OpeningMeter", "قراءة البركة 1 الصباحية غير صحيحة"],
    ["pool1ClosingMeter", "قراءة البركة 1 المسائية غير صحيحة"],
    ["pool2OpeningMeter", "قراءة البركة 2 الصباحية غير صحيحة"],
    ["pool2ClosingMeter", "قراءة البركة 2 المسائية غير صحيحة"],
    ["recordedMeters", "المبيعات المسجلة غير صحيحة"],
    ["expectedCash", "الكاش المتوقع غير صحيح"],
    ["cashCounted", "الكاش الموجود غير صحيح"],
  ];

  requiredNumbers.forEach(([key, message]) => {
    if (!isValidNumber(input[key])) errors.push(message);
  });

  if (errors.length) {
    return {
      pool1ActualMeters: 0,
      pool2ActualMeters: 0,
      actualMeters: 0,
      recordedMeters: 0,
      missingMeters: 0,
      missingValue: 0,
      expectedCash: 0,
      cashCounted: 0,
      cashDifference: 0,
      errors,
      warnings: [],
      status: "error",
    };
  }

  if (input.pool1ClosingMeter < input.pool1OpeningMeter) {
    errors.push("قراءة البركة 1 المسائية أقل من الصباحية");
  }

  if (input.pool2ClosingMeter < input.pool2OpeningMeter) {
    errors.push("قراءة البركة 2 المسائية أقل من الصباحية");
  }

  if (input.recordedMeters < 0) errors.push("المبيعات المسجلة لا يمكن أن تكون سالبة");
  if (input.expectedCash < 0) errors.push("الكاش المتوقع لا يمكن أن يكون سالباً");
  if (input.cashCounted < 0) errors.push("الكاش الموجود لا يمكن أن يكون سالباً");

  const pool1ActualMeters = roundMoney(Math.max(input.pool1ClosingMeter - input.pool1OpeningMeter, 0));
  const pool2ActualMeters = roundMoney(Math.max(input.pool2ClosingMeter - input.pool2OpeningMeter, 0));
  const actualMeters = roundMoney(pool1ActualMeters + pool2ActualMeters);
  const missingMeters = roundMoney(actualMeters - input.recordedMeters);
  const cashDifference = roundMoney(input.cashCounted - input.expectedCash);
  const warnings: string[] = [];

  if (missingMeters > 0) warnings.push(`يوجد ${missingMeters} متر ماء خارج السجل`);
  if (missingMeters < 0) warnings.push(`المبيعات المسجلة أعلى من العداد بـ ${Math.abs(missingMeters)} متر`);
  if (cashDifference < 0) warnings.push(`نقص كاش ${Math.abs(cashDifference)} JOD`);
  if (cashDifference > 0) warnings.push(`كاش زائد ${cashDifference} JOD يحتاج تفسير`);

  return {
    pool1ActualMeters,
    pool2ActualMeters,
    actualMeters,
    recordedMeters: roundMoney(input.recordedMeters),
    missingMeters,
    missingValue: roundMoney(missingMeters * PRICE_PER_METER),
    expectedCash: roundMoney(input.expectedCash),
    cashCounted: roundMoney(input.cashCounted),
    cashDifference,
    errors,
    warnings,
    status: errors.length ? "error" : warnings.length ? "warning" : "balanced",
  };
}

export function dayKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dayKeyFromIso(isoDate: string): string {
  return dayKeyFromDate(new Date(isoDate));
}

export function getDaySales(sales: Sale[], day = todayKey()): Sale[] {
  return sales.filter((sale) => !sale.deleted && dayKeyFromIso(sale.createdAt) === day);
}

export function getDayPayments(payments: Payment[], day = todayKey()): Payment[] {
  return payments.filter((payment) => dayKeyFromIso(payment.createdAt) === day);
}

export function calculateDayTotals(sales: Sale[], payments: Payment[] = []) {
  const recordedMeters = roundMoney(sales.reduce((sum, sale) => sum + sale.meters, 0));
  const salesRevenue = roundMoney(sales.reduce((sum, sale) => sum + sale.totalAmount, 0));
  const saleCash = roundMoney(sales.reduce((sum, sale) => sum + sale.cashReceived, 0));
  const saleCliq = roundMoney(sales.reduce((sum, sale) => sum + (sale.cliqReceived ?? 0), 0));
  const debtAdded = roundMoney(sales.reduce((sum, sale) => sum + sale.debtAdded, 0));
  const debtCollected = roundMoney(payments.reduce((sum, payment) => sum + payment.amount, 0));
  const debtCashCollected = roundMoney(
    payments.reduce((sum, payment) => sum + ((payment.paymentType ?? "cash") === "cash" ? payment.amount : 0), 0),
  );
  const debtCliqCollected = roundMoney(
    payments.reduce((sum, payment) => sum + (payment.paymentType === "cliq" ? payment.amount : 0), 0),
  );
  const totalCliq = roundMoney(saleCliq + debtCliqCollected);
  const totalCollected = roundMoney(saleCash + saleCliq + debtCashCollected + debtCliqCollected);
  return {
    recordedMeters,
    salesRevenue,
    saleCash,
    saleCliq,
    debtAdded,
    debtCollected,
    debtCashCollected,
    debtCliqCollected,
    totalCliq,
    totalCollected,
    expectedCash: roundMoney(saleCash + debtCashCollected),
    tankCount: sales.length,
  };
}

export function findRecentDuplicateTruck(
  sales: Sale[],
  truckNumber: string,
  now = new Date(),
  minutes = 20,
): Sale | undefined {
  const cleanTruck = truckNumber.trim();
  if (!cleanTruck) return undefined;

  return sales.find((sale) => {
    if (sale.deleted || sale.truckNumber.trim() !== cleanTruck) return false;
    const ageMinutes = (now.getTime() - new Date(sale.createdAt).getTime()) / 60000;
    return ageMinutes >= 0 && ageMinutes <= minutes;
  });
}

export function deriveCustomerStatus(
  debtBalance: number,
  creditLimit: number,
): CustomerStatus {
  if (debtBalance <= 0) return "good";
  if (creditLimit > 0 && debtBalance > creditLimit) return "needs-payment";
  return debtBalance >= creditLimit * 0.75 ? "needs-payment" : "good";
}

export function todayKey(date = new Date()): string {
  return dayKeyFromDate(date);
}

export function isSameDay(isoDate: string, day = todayKey()): boolean {
  return dayKeyFromIso(isoDate) === day;
}
