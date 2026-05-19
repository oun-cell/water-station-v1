import { describe, expect, it } from "vitest";
import { buildLiveDailyClosing } from "./reportSync";
import type { Payment, Sale } from "./types";

const date = "2026-05-19";

function sale(overrides: Partial<Sale>): Sale {
  return {
    id: "s-1",
    createdAt: `${date}T09:00:00.000Z`,
    customerId: "c-1",
    customerName: "عميل",
    truckNumber: "1234",
    meters: 12,
    pricePerMeter: 1,
    totalAmount: 12,
    paymentType: "cash",
    cashReceived: 12,
    cliqReceived: 0,
    debtAdded: 0,
    notes: "",
    ...overrides,
  };
}

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: "p-1",
    customerId: "c-1",
    amount: 5,
    paymentType: "cash",
    createdAt: `${date}T10:00:00.000Z`,
    notes: "",
    ...overrides,
  };
}

describe("live report sync payload", () => {
  it("builds a current-day Google Sheets report from live sales and payments", () => {
    const closing = buildLiveDailyClosing(
      [
        sale({ id: "cash", meters: 12, totalAmount: 12, cashReceived: 12 }),
        sale({ id: "debt", meters: 16, totalAmount: 16, cashReceived: 0, paymentType: "debt", debtAdded: 16 }),
        sale({ id: "deleted", deleted: true, meters: 20, totalAmount: 20, cashReceived: 20 }),
      ],
      [payment({ amount: 5, paymentType: "cash" })],
      date,
    );

    expect(closing).toMatchObject({
      id: `live-${date}`,
      date,
      tankCount: 2,
      recordedMeters: 28,
      salesRevenue: 28,
      saleCash: 12,
      debtAdded: 16,
      debtCashCollected: 5,
      expectedCash: 17,
      notes: "تقرير تلقائي مباشر من التطبيق",
    });
  });

  it("returns no report when the device has no data for the day", () => {
    expect(buildLiveDailyClosing([], [], date)).toBeUndefined();
  });
});
