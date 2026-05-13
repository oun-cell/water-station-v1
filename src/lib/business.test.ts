import { describe, expect, it } from "vitest";
import {
  calculateClosing,
  calculateDayTotals,
  calculateSalePayment,
  dayKeyFromDate,
  deriveCustomerStatus,
  findRecentDuplicateTruck,
  makeCustomerName,
  normalizeTruckNumber,
} from "./business";

describe("water station business rules", () => {
  it("calculates cash sale totals at fixed 1 JOD per meter", () => {
    expect(calculateSalePayment(12, "cash")).toEqual({
      pricePerMeter: 1,
      totalAmount: 12,
      cashReceived: 12,
      cliqReceived: 0,
      debtAdded: 0,
    });
  });

  it("calculates partial payments as debt for the unpaid amount", () => {
    expect(calculateSalePayment(12, "partial", 6)).toEqual({
      pricePerMeter: 1,
      totalAmount: 12,
      cashReceived: 6,
      cliqReceived: 0,
      debtAdded: 6,
    });
  });

  it("uses loyalty pricing for known loyal customer tank sizes", () => {
    expect(calculateSalePayment(16, "cash", undefined, "loyal")).toEqual({
      pricePerMeter: 0.875,
      totalAmount: 14,
      cashReceived: 14,
      cliqReceived: 0,
      debtAdded: 0,
    });

    expect(calculateSalePayment(12, "partial", 5, "loyal")).toEqual({
      pricePerMeter: 0.9166666666666666,
      totalAmount: 11,
      cashReceived: 5,
      cliqReceived: 0,
      debtAdded: 6,
    });
  });



  it("uses Oun's special pricing table for 1, 2, 9, 14, and 16 meters", () => {
    expect(calculateSalePayment(1, "cash", undefined, "loyal").totalAmount).toBe(1);
    expect(calculateSalePayment(2, "cash", undefined, "loyal").totalAmount).toBe(2);
    expect(calculateSalePayment(9, "cash", undefined, "loyal").totalAmount).toBe(8);
    expect(calculateSalePayment(14, "cash", undefined, "loyal").totalAmount).toBe(13);
    expect(calculateSalePayment(16, "cash", undefined, "loyal").totalAmount).toBe(14);
  });

  it("records CliQ as collected but not physical cash", () => {
    expect(calculateSalePayment(12, "cliq", undefined, "loyal")).toEqual({
      pricePerMeter: 11 / 12,
      totalAmount: 11,
      cashReceived: 0,
      cliqReceived: 11,
      debtAdded: 0,
    });
  });

  it("falls back to standard 1 JOD per meter when loyal size is not listed", () => {
    expect(calculateSalePayment(13, "cash", undefined, "loyal")).toEqual({
      pricePerMeter: 1,
      totalAmount: 13,
      cashReceived: 13,
      cliqReceived: 0,
      debtAdded: 0,
    });
  });

  it("combines two pool meters when closing the day", () => {
    const closing = calculateClosing({
      pool1OpeningMeter: 1000,
      pool1ClosingMeter: 1080,
      pool2OpeningMeter: 500,
      pool2ClosingMeter: 568,
      recordedMeters: 146,
      expectedCash: 112,
      cashCounted: 110,
    });

    expect(closing.actualMeters).toBe(148);
    expect(closing.missingMeters).toBe(2);
    expect(closing.missingValue).toBe(2);
    expect(closing.cashDifference).toBe(-2);
    expect(closing.status).toBe("warning");
    expect(closing.errors).toEqual([]);
  });

  it("returns closing errors instead of throwing for backwards meter readings", () => {
    const closing = calculateClosing({
      pool1OpeningMeter: 100,
      pool1ClosingMeter: 90,
      pool2OpeningMeter: 50,
      pool2ClosingMeter: 70,
      recordedMeters: 20,
      expectedCash: 20,
      cashCounted: 20,
    });

    expect(closing.status).toBe("error");
    expect(closing.errors).toContain("قراءة البركة 1 المسائية أقل من الصباحية");
    expect(closing.pool1ActualMeters).toBe(0);
  });

  it("includes debt collections in expected closing cash", () => {
    const totals = calculateDayTotals(
      [
        {
          id: "s1",
          createdAt: "2026-05-12T09:00:00.000Z",
          customerId: "c1",
          customerName: "أحمد",
          truckNumber: "12-1",
          meters: 12,
          pricePerMeter: 1,
          totalAmount: 12,
          paymentType: "partial",
          cashReceived: 5,
          cliqReceived: 3,
          debtAdded: 7,
          notes: "",
        },
      ],
      [{ id: "p1", customerId: "c1", amount: 20, createdAt: "2026-05-12T10:00:00.000Z", notes: "" }],
    );

    expect(totals.expectedCash).toBe(25);
    expect(totals.debtCollected).toBe(20);
    expect(totals.debtCashCollected).toBe(20);
    expect(totals.debtCliqCollected).toBe(0);
    expect(totals.saleCliq).toBe(3);
    expect(totals.totalCliq).toBe(3);
    expect(totals.totalCollected).toBe(28);
    expect(totals.debtAdded).toBe(7);
  });

  it("keeps CliQ debt payments out of the physical cash box", () => {
    const totals = calculateDayTotals(
      [],
      [
        {
          id: "p1",
          customerId: "c1",
          amount: 12,
          paymentType: "cliq",
          createdAt: "2026-05-12T10:00:00.000Z",
          notes: "paid by CliQ",
        },
      ],
    );

    expect(totals.debtCollected).toBe(12);
    expect(totals.debtCashCollected).toBe(0);
    expect(totals.debtCliqCollected).toBe(12);
    expect(totals.totalCliq).toBe(12);
    expect(totals.totalCollected).toBe(12);
    expect(totals.expectedCash).toBe(0);
  });

  it("rejects invalid numeric inputs before they can corrupt totals", () => {
    expect(() => calculateSalePayment(Number.NaN, "cash")).toThrow();
    expect(() => calculateSalePayment(12, "partial", Number.NaN)).toThrow();

    const closing = calculateClosing({
      pool1OpeningMeter: Number.NaN,
      pool1ClosingMeter: 100,
      pool2OpeningMeter: 50,
      pool2ClosingMeter: 60,
      recordedMeters: 10,
      expectedCash: 10,
      cashCounted: 10,
    });

    expect(closing.status).toBe("error");
    expect(closing.errors).toContain("قراءة البركة 1 الصباحية غير صحيحة");
  });

  it("detects duplicate truck sales within 20 minutes", () => {
    const duplicate = findRecentDuplicateTruck(
      [
        {
          id: "s1",
          createdAt: "2026-05-12T09:50:00.000Z",
          customerId: "c1",
          customerName: "أحمد",
          truckNumber: "12-1",
          meters: 12,
          pricePerMeter: 1,
          totalAmount: 12,
          paymentType: "cash",
          cashReceived: 12,
          cliqReceived: 0,
          debtAdded: 0,
          notes: "",
        },
      ],
      "12-1",
      new Date("2026-05-12T10:00:00.000Z"),
    );

    expect(duplicate?.customerName).toBe("أحمد");
  });

  it("uses local date keys instead of UTC slices", () => {
    expect(dayKeyFromDate(new Date(2026, 4, 12, 23, 30))).toBe("2026-05-12");
  });

  it("marks customers over credit limit as needing payment", () => {
    expect(deriveCustomerStatus(64, 50)).toBe("needs-payment");
  });

  it("normalizes truck numbers to digits for old-employee number-pad entry", () => {
    expect(normalizeTruckNumber(" تنك 12-34 ")).toBe("1234");
  });

  it("allows customer name to be optional by falling back to the truck number", () => {
    expect(makeCustomerName("", "1234")).toBe("تنك 1234");
    expect(makeCustomerName(" أبو أحمد ", "1234")).toBe("أبو أحمد");
  });
});
