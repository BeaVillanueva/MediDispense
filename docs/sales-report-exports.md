# Sales report exports

Inventory Reports also offers CSV, Excel, and PDF using the same compact, horizontal header styling. Excel includes Summary, Current Inventory, and Stock Movements worksheets; PDF includes all three sections. Stock figures use integer formatting, not currency. The medicine and current-stock-status filters apply to inventory; the date range applies only to movement history. Inventory exports refresh their backend snapshot and use the existing authenticated report-export audit gate. No inventory quantities are changed by exporting.

In Admin > Reports & Analytics > Sales, select the date range and medicine, then choose CSV, Excel, or PDF and click Export. All matching records are exported, including records beyond the on-screen page. The data is refreshed before preparation; a refresh or authorization failure prevents the download.

- CSV retains the existing raw-data columns and CSV formula protection.
- Excel provides five worksheets, merged branding and filter headers, native numeric/date cells, peso formats, alternating rows, frozen table headers, A4 print settings, and page-number footers. Open in Excel or LibreOffice and use Print Preview.
- PDF provides all five sections on A4 pages, embedded Roboto fonts (including the peso symbol), repeated table headers, and page-number footers. Open the downloaded PDF and print at actual size on A4.

Both formatted exports include Triple J Grocery Store and Pharmacy, Automated Medicine Vending System, the filters, generation time in Philippine time, and the reporting basis. Sales remain stored item subtotals for successful payment plus completed dispensing; excess payment is excluded. Medicine filtering counts only matching lines. Group transaction counts are distinct purchases within each group; medicine-group counts should not be added when a purchase contains multiple medicines.

No database migration is required. No payment, inventory, firmware, or dispensing services were changed. Downloads retain the existing reports.export permission and authenticated PHP activity endpoint. The activity metadata now records csv/xlsx/pdf; older callers default to CSV. The audit records report preparation, not proof that a user saved the file.

Libraries load on demand: [ExcelJS](https://github.com/exceljs/exceljs) for workbooks and [pdfmake](https://pdfmake.github.io/docs/0.3/getting-started/client-side/) for PDF generation. Fonts and report data stay local to the application; no external report service is used.

## Verification

1. Export all three formats with identical filters. Compare total sales, completed transactions, units, and average against the Sales screen. Sum detailed subtotals and compare with daily/monthly/medicine sales totals.
2. Repeat with one medicine and a one-day range, then a range with no sales. Confirm cancelled, failed, and incomplete purchases are excluded.
3. Inspect the Excel worksheets, dates, peso formats, frozen headers, and print preview. Inspect PDF table wrapping, repeated headings, and page numbers across multiple pages.
4. Check Activity Logs for the corresponding format and filters. Staff accounts must remain unable to export.

Automated checks: `npm test`, `npm run check`, `npm run build`, and `C:\xampp\php\php.exe -l backend/public/index.php`. Export tests reopen XLSX with ExcelJS and parse generated PDF with pdf-lib. Tests use fixtures and do not change live sales or inventory.
