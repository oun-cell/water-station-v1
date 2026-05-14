const SHEET_NAME = 'Daily Reports';

const HEADERS = [
  'Synced At',
  'Report ID',
  'Station ID',
  'Date',
  'Created At',
  'Tank Count',
  'Recorded Meters',
  'Actual Meters',
  'Missing Meters',
  'Missing Value',
  'Sales Revenue',
  'Sale Cash',
  'Sale CliQ',
  'Debt Added',
  'Debt Collected',
  'Debt Cash Collected',
  'Debt CliQ Collected',
  'Total Collected',
  'Expected Cash',
  'Cash Counted',
  'Cash Difference',
  'Pool 1 Opening',
  'Pool 1 Closing',
  'Pool 1 Actual',
  'Pool 2 Opening',
  'Pool 2 Closing',
  'Pool 2 Actual',
  'Notes'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payloadText = e && e.parameter && e.parameter.payload;
    if (!payloadText) {
      return jsonResponse({ ok: false, error: 'missing payload' });
    }

    const report = JSON.parse(payloadText);
    const sheet = getReportSheet_();
    ensureHeaders_(sheet);

    const reportId = String(report.reportId || '');
    if (reportId && findReportRow_(sheet, reportId) > 0) {
      return jsonResponse({ ok: true, duplicate: true, reportId });
    }

    sheet.appendRow([
      report.syncedAt || new Date().toISOString(),
      report.reportId || '',
      report.stationId || '',
      report.date || '',
      report.createdAt || '',
      num_(report.tankCount),
      num_(report.recordedMeters),
      num_(report.actualMeters),
      num_(report.missingMeters),
      num_(report.missingValue),
      num_(report.salesRevenue),
      num_(report.saleCash),
      num_(report.saleCliq),
      num_(report.debtAdded),
      num_(report.debtCollected),
      num_(report.debtCashCollected),
      num_(report.debtCliqCollected),
      num_(report.totalCollected),
      num_(report.expectedCash),
      num_(report.cashCounted),
      num_(report.cashDifference),
      num_(report.pool1OpeningMeter),
      num_(report.pool1ClosingMeter),
      num_(report.pool1ActualMeters),
      num_(report.pool2OpeningMeter),
      num_(report.pool2ClosingMeter),
      num_(report.pool2ActualMeters),
      report.notes || ''
    ]);

    return jsonResponse({ ok: true, reportId });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function getReportSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
}

function ensureHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (firstRow.join('') !== HEADERS.join('')) {
    sheet.clear();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function findReportRow_(sheet, reportId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0]) === reportId) return index + 2;
  }
  return -1;
}

function num_(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
