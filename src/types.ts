export type PaymentType = "cash" | "cliq" | "debt" | "partial";
export type PaymentMethod = "cash" | "cliq";
export type CustomerStatus = "good" | "needs-payment" | "blocked";
export type CustomerPricePlan = "standard" | "loyal";
export type CustomTankPrices = Record<number, number>;

export type Sale = {
  id: string;
  createdAt: string;
  customerId: string;
  customerName: string;
  truckNumber: string;
  meters: number;
  pricePerMeter: number;
  pricePlan?: CustomerPricePlan;
  customPriceApplied?: boolean;
  totalAmount: number;
  paymentType: PaymentType;
  cashReceived: number;
  cliqReceived?: number;
  debtAdded: number;
  notes: string;
  employeeName?: string;
  editReason?: string;
  deleted?: boolean;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  truckNumbers: string[];
  debtBalance: number;
  creditLimit: number;
  pricePlan?: CustomerPricePlan;
  customTankPrices?: CustomTankPrices;
  createdAt: string;
  lastSaleAt?: string;
  lastPaymentAt?: string;
  status: CustomerStatus;
};

export type Payment = {
  id: string;
  customerId: string;
  amount: number;
  paymentType?: PaymentMethod;
  createdAt: string;
  notes: string;
};

export type DailyClosing = {
  id: string;
  date: string;
  pool1OpeningMeter: number;
  pool1ClosingMeter: number;
  pool2OpeningMeter: number;
  pool2ClosingMeter: number;
  pool1ActualMeters: number;
  pool2ActualMeters: number;
  actualMeters: number;
  recordedMeters: number;
  missingMeters: number;
  missingValue: number;
  expectedCash: number;
  cashCounted: number;
  cashDifference: number;
  saleCash?: number;
  saleCliq?: number;
  debtCollected?: number;
  debtCashCollected?: number;
  debtCliqCollected?: number;
  salesRevenue?: number;
  debtAdded?: number;
  tankCount?: number;
  pool1OpeningPhoto?: string;
  pool1ClosingPhoto?: string;
  pool2OpeningPhoto?: string;
  pool2ClosingPhoto?: string;
  notes: string;
};
