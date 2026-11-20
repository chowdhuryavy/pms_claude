# Report definitions

These definitions match the code in `apps-script/src/12_reports.js`.

- **Available room nights**: count of rooms with status `ACTIVE` multiplied by the
  nights in the period. Rooms added or removed mid-period are counted at today's
  room count. Historical accuracy needs room-status history, which is not built.
- **Sold room nights**: nights in `IN_HOUSE` or `CHECKED_OUT` stays that cover the
  night in question. A night counts once per stay.
- **Occupancy**: sold room nights divided by available room nights, as a percentage.
- **ADR (average daily rate)**: room revenue divided by sold room nights. Room revenue
  is the sum of `ROOM` charges and reversals posted for the period.
- **RevPAR**: room revenue divided by available room nights. Equal to occupancy
  multiplied by ADR.
- **Total revenue**: sum of all `CHARGE`, `ADJUSTMENT` and `REBATE` postings for the
  day, signed by the transaction kind. Payments and transfers are not revenue.
- **Guest ledger**: every open folio with a non-zero balance.

All money is in minor units. Percentages are shown to one decimal place. A zero
denominator returns 0, not an error.
