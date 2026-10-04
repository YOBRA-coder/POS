# Go-live checklist

## Before opening day
- [ ] Server installed with `deploy/install.sh`; service running; HTTPS working on both hostnames.
- [ ] `/etc/cellarpos.env` filled in (`NODE_ENV=production`, `TRUST_PROXY=1`, `PUBLIC_URL`).
- [ ] **Default PINs replaced** (the app forces this in production). Managers/owner use 6+ digits. Remove or rename the demo users.
- [ ] Settings → General: business name, KRA PIN, VAT %, age check on.
- [ ] Products entered with correct bottle size, cost, sell units (bottle/quarter/shot), reorder level. Barcodes scanned or generated; labels printed.
- [ ] Opening stock entered (as opening stock or a purchase), then a **full stocktake** to confirm.
- [ ] Staff accounts created, one per person.
- [ ] Hardware tested: scanner (scan into the search box), receipt printer, cash drawer opens on a cash sale, label sheet prints.
- [ ] **M-Pesa**: enter credentials in Settings → Payments (sandbox first, use Test connection, then production and switch the mode); set the public HTTPS URL. Then: run sandbox/small real payments end to end (STK success, cancelled, wrong PIN, timeout). Confirm the callback reaches the server.
- [ ] Backups: confirm a file appears in `/var/lib/cellarpos/backups`, copy one off-site (`deploy/offsite-backup.sh`), and **practise a restore** on another machine.
- [ ] Power/network: till PC and printer on a UPS if possible.

## Tax compliance (do not skip)
- [ ] The eTIMS adapter is **not certified**. While the system shows "eTIMS is not connected", receipts from it are not KRA fiscal invoices. Keep using your KRA-registered system/device for tax receipts, or complete the certified integration first, and confirm requirements with KRA or your accountant.

## First week
- Day 1: manager watches the first shifts. Check every shift report and variance.
- Daily: close every shift, glance at the Audit log for discounts, refunds and adjustments.
- Day 3 and 7: spot-count 5 fast-moving products against the system.
- End of week 1: full stocktake, review variances and low-stock list, adjust reorder levels.
- Keep the owner PIN private; review staff list monthly.

- [ ] Back up the `uploads/` folder (product photos) and the `settings.key` file (or note the `SETTINGS_KEY`), without it saved M-Pesa credentials cannot be decrypted.
