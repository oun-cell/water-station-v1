const SHEET_NAME = 'Daily Reports';
const CUSTOMER_SHEET_NAME = 'Customer Balances';
const SALE_DETAIL_SHEET_NAME = 'Sales Details';
const PAYMENT_DETAIL_SHEET_NAME = 'Payment Details';

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

const CUSTOMER_HEADERS = [
  'Synced At',
  'Customer ID',
  'Customer Name',
  'Phone',
  'Truck Numbers',
  'Debt Balance',
  'Credit Limit',
  'Status',
  'Last Sale At',
  'Last Payment At'
];

const SALE_DETAIL_HEADERS = [
  'Synced At',
  'Sale ID',
  'Created At',
  'Customer ID',
  'Customer Name',
  'Truck Number',
  'Meters',
  'Total Amount',
  'Payment Type',
  'Cash Received',
  'CliQ Received',
  'Debt Added',
  'Deleted',
  'Edit Reason',
  'Notes'
];

const PAYMENT_DETAIL_HEADERS = [
  'Synced At',
  'Payment ID',
  'Created At',
  'Customer ID',
  'Amount',
  'Payment Type',
  'Notes'
];

function doGet() {
  // Opening the web app in a browser uses GET. Touch the spreadsheet here so
  // Google shows the one-time authorization prompt before tablets start POSTing.
  getSheet_(SHEET_NAME);
  getSheet_(CUSTOMER_SHEET_NAME);
  getSheet_(SALE_DETAIL_SHEET_NAME);
  getSheet_(PAYMENT_DETAIL_SHEET_NAME);
  return jsonResponse({ ok: true, service: 'water-station-sync', message: 'Webhook is ready. POST payload to sync reports.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payloadText = e && e.parameter && e.parameter.payload;
    if (!payloadText) {
      return jsonResponse({ ok: false, error: 'missing payload' });
    }

    const report = JSON.parse(payloadText);
    const sheet = getSheet_(SHEET_NAME);
    ensureHeaders_(sheet, HEADERS);

    const reportId = String(report.reportId || '');
    const row = buildReportRow_(report);
    const existingRow = reportId ? findRowByValue_(sheet, 2, reportId) : -1;
    if (existingRow > 0) {
      sheet.getRange(existingRow, 1, 1, HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }

    writeCustomers_(report);
    writeSales_(report);
    writePayments_(report);

    return jsonResponse({ ok: true, reportId, updated: existingRow > 0 });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function buildReportRow_(report) {
  return [
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
  ];
}

function writeCustomers_(report) {
  const customers = Array.isArray(report.customers) ? report.customers : [];
  const sheet = getSheet_(CUSTOMER_SHEET_NAME);
  ensureHeaders_(sheet, CUSTOMER_HEADERS);
  clearDataRows_(sheet);
  if (!customers.length) return;

  const syncedAt = report.syncedAt || new Date().toISOString();
  const rows = customers
    .slice()
    .sort((a, b) => num_(b.debtBalance) - num_(a.debtBalance))
    .map((customer) => [
      syncedAt,
      customer.id || '',
      customer.name || '',
      customer.phone || '',
      Array.isArray(customer.truckNumbers) ? customer.truckNumbers.join(', ') : '',
      num_(customer.debtBalance),
      num_(customer.creditLimit),
      customer.status || '',
      customer.lastSaleAt || '',
      customer.lastPaymentAt || ''
    ]);
  sheet.getRange(2, 1, rows.length, CUSTOMER_HEADERS.length).setValues(rows);
}

function writeSales_(report) {
  const sales = Array.isArray(report.sales) ? report.sales : [];
  const sheet = getSheet_(SALE_DETAIL_SHEET_NAME);
  ensureHeaders_(sheet, SALE_DETAIL_HEADERS);
  clearDataRows_(sheet);
  if (!sales.length) return;

  const syncedAt = report.syncedAt || new Date().toISOString();
  const rows = sales.map((sale) => [
    syncedAt,
    sale.id || '',
    sale.createdAt || '',
    sale.customerId || '',
    sale.customerName || '',
    sale.truckNumber || '',
    num_(sale.meters),
    num_(sale.totalAmount),
    sale.paymentType || '',
    num_(sale.cashReceived),
    num_(sale.cliqReceived),
    num_(sale.debtAdded),
    sale.deleted ? 'YES' : '',
    sale.editReason || '',
    sale.notes || ''
  ]);
  sheet.getRange(2, 1, rows.length, SALE_DETAIL_HEADERS.length).setValues(rows);
}

function writePayments_(report) {
  const payments = Array.isArray(report.payments) ? report.payments : [];
  const sheet = getSheet_(PAYMENT_DETAIL_SHEET_NAME);
  ensureHeaders_(sheet, PAYMENT_DETAIL_HEADERS);
  clearDataRows_(sheet);
  if (!payments.length) return;

  const syncedAt = report.syncedAt || new Date().toISOString();
  const rows = payments.map((payment) => [
    syncedAt,
    payment.id || '',
    payment.createdAt || '',
    payment.customerId || '',
    num_(payment.amount),
    payment.paymentType || 'cash',
    payment.notes || ''
  ]);
  sheet.getRange(2, 1, rows.length, PAYMENT_DETAIL_HEADERS.length).setValues(rows);
}

function getSheet_(name) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function ensureHeaders_(sheet, headers) {
  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (firstRow.join('') !== headers.join('')) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function clearDataRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
  }
}

function findRowByValue_(sheet, column, value) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  for (let index = 0; index < values.length; index += 1) {
    if (String(values[index][0]) === String(value)) return index + 2;
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
