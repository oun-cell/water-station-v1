import type { DailyClosing } from "./types";

const WEBHOOK_KEY = "water-station-report-webhook-url";
const PENDING_KEY = "water-station-pending-reports-v1";
const LAST_SYNC_KEY = "water-station-last-sync-state-v1";
const STATION_ID_KEY = "water-station-device-id";

export type SyncStatus = "not-configured" | "idle" | "pending" | "syncing" | "synced" | "error";

export type DailyReportPayload = {
  reportId: string;
  stationId: string;
  date: string;
  createdAt: string;
  syncedAt?: string;
  tankCount: number;
  recordedMeters: number;
  actualMeters: number;
  missingMeters: number;
  missingValue: number;
  salesRevenue: number;
  saleCash: number;
  saleCliq: number;
  debtAdded: number;
  debtCollected: number;
  debtCashCollected: number;
  debtCliqCollected: number;
  totalCollected: number;
  expectedCash: number;
  cashCounted: number;
  cashDifference: number;
  pool1OpeningMeter: number;
  pool1ClosingMeter: number;
  pool1ActualMeters: number;
  pool2OpeningMeter: number;
  pool2ClosingMeter: number;
  pool2ActualMeters: number;
  notes: string;
};

export type SyncState = {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt?: string;
  lastError?: string;
};

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function writeSyncState(partial: Partial<SyncState>) {
  if (!canUseStorage()) return;
  const current = getSyncState();
  window.localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ ...current, ...partial }));
}

export function getStationId() {
  if (!canUseStorage()) return "station-browser";
  const existing = window.localStorage.getItem(STATION_ID_KEY);
  if (existing) return existing;
  const id = `station-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.localStorage.setItem(STATION_ID_KEY, id);
  return id;
}

export function getReportWebhookUrl() {
  if (!canUseStorage()) return "";
  return window.localStorage.getItem(WEBHOOK_KEY) ?? "";
}

export function saveReportWebhookUrl(url: string) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(WEBHOOK_KEY, url.trim());
  writeSyncState({ status: url.trim() ? "idle" : "not-configured", lastError: "" });
}

export function getPendingReports() {
  if (!canUseStorage()) return [] as DailyReportPayload[];
  return safeJsonParse<DailyReportPayload[]>(window.localStorage.getItem(PENDING_KEY), []);
}

function savePendingReports(reports: DailyReportPayload[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PENDING_KEY, JSON.stringify(reports));
}

export function getSyncState(): SyncState {
  if (!canUseStorage()) return { status: "not-configured", pendingCount: 0 };
  const saved = safeJsonParse<SyncState>(window.localStorage.getItem(LAST_SYNC_KEY), {
    status: getReportWebhookUrl() ? "idle" : "not-configured",
    pendingCount: 0,
  });
  return {
    ...saved,
    pendingCount: getPendingReports().length,
  };
}

export function buildDailyReportPayload(closing: DailyClosing): DailyReportPayload {
  return {
    reportId: closing.id,
    stationId: getStationId(),
    date: closing.date,
    createdAt: new Date().toISOString(),
    tankCount: closing.tankCount ?? 0,
    recordedMeters: closing.recordedMeters,
    actualMeters: closing.actualMeters,
    missingMeters: closing.missingMeters,
    missingValue: closing.missingValue,
    salesRevenue: closing.salesRevenue ?? 0,
    saleCash: closing.saleCash ?? 0,
    saleCliq: closing.saleCliq ?? 0,
    debtAdded: closing.debtAdded ?? 0,
    debtCollected: closing.debtCollected ?? 0,
    debtCashCollected: closing.debtCashCollected ?? 0,
    debtCliqCollected: closing.debtCliqCollected ?? 0,
    totalCollected: (closing.saleCash ?? 0) + (closing.saleCliq ?? 0) + (closing.debtCollected ?? 0),
    expectedCash: closing.expectedCash,
    cashCounted: closing.cashCounted,
    cashDifference: closing.cashDifference,
    pool1OpeningMeter: closing.pool1OpeningMeter,
    pool1ClosingMeter: closing.pool1ClosingMeter,
    pool1ActualMeters: closing.pool1ActualMeters,
    pool2OpeningMeter: closing.pool2OpeningMeter,
    pool2ClosingMeter: closing.pool2ClosingMeter,
    pool2ActualMeters: closing.pool2ActualMeters,
    notes: closing.notes,
  };
}

export function queueDailyReport(closing: DailyClosing) {
  const payload = buildDailyReportPayload(closing);
  const pending = getPendingReports().filter((report) => report.reportId !== payload.reportId && report.date !== payload.date);
  savePendingReports([...pending, payload]);
  writeSyncState({ status: getReportWebhookUrl() ? "pending" : "not-configured", pendingCount: pending.length + 1, lastError: "" });
  return payload;
}

export async function syncPendingReports() {
  const webhookUrl = getReportWebhookUrl();
  const pending = getPendingReports();

  if (!webhookUrl) {
    writeSyncState({ status: "not-configured", pendingCount: pending.length, lastError: "رابط Google Sheet غير مضبوط" });
    return getSyncState();
  }

  if (!pending.length) {
    writeSyncState({ status: "idle", pendingCount: 0, lastError: "" });
    return getSyncState();
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    writeSyncState({ status: "pending", pendingCount: pending.length, lastError: "بانتظار الإنترنت" });
    return getSyncState();
  }

  writeSyncState({ status: "syncing", pendingCount: pending.length, lastError: "" });

  const remaining: DailyReportPayload[] = [];
  let lastSyncedAt = "";

  for (const report of pending) {
    try {
      const syncedAt = new Date().toISOString();
      const body = new URLSearchParams({
        payload: JSON.stringify({ ...report, syncedAt }),
      });

      await fetch(webhookUrl, {
        method: "POST",
        mode: "no-cors",
        body,
      });
      lastSyncedAt = syncedAt;
    } catch (error) {
      remaining.push(report);
      writeSyncState({
        status: "error",
        pendingCount: remaining.length,
        lastError: error instanceof Error ? error.message : "فشل إرسال التقرير",
      });
    }
  }

  savePendingReports(remaining);
  writeSyncState({
    status: remaining.length ? "error" : "synced",
    pendingCount: remaining.length,
    lastSyncedAt: lastSyncedAt || getSyncState().lastSyncedAt,
    lastError: remaining.length ? "لم تتم مزامنة كل التقارير" : "",
  });

  return getSyncState();
}
