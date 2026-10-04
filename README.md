# CellarPOS — wines & spirits POS (Node + SQLite, desktop-first web UI)

## Run
    npm install
    npm start            # http://localhost:3000  (open in Chrome/Edge on the till PC; also works on tablets/phones)
    npm test             # API test suite

Demo sign-in: type the name **Owner** (PIN 1234), **Manager** (2222) or **Cashier** (1111), then the PIN. Change them in Settings → Staff & branches.

## Design
- **Stock is an append-only ledger in ml** (`ledger`). Bottle, quarter, shot, case all resolve to ml. SQLite triggers block edits/deletes of ledger, audit, sales and payments.
- Server recomputes prices, cost (weighted-average), VAT and stock on every sale. The browser is never trusted.
- Sales carry an idempotency key, so offline queue retries and double-clicks cannot create duplicates.
- Roles: cashier sells and runs own till; manager adds stock, adjusts, refunds, reports; owner manages staff and settings. Discounts by cashiers need a manager PIN.
- Audit log for logins, discounts, price/cost edits, adjustments, refunds, shifts, cash movements, drawer opens.

## Hardware
- **Barcode scanner:** any USB/Bluetooth scanner in keyboard mode. Scans anywhere on the Sell screen. Case barcodes (code + `C` in seed data) add 12 bottles.
- **Receipt printer + cash drawer:** set `PRINTER_HOST` (and `PRINTER_PORT`, default 9100) for a network ESC/POS printer. "Thermal" prints and kicks the drawer on cash sales. Without it, the browser Print button uses an 80mm layout.
- USB-only printers/scanners in non-keyboard mode need a small local agent or WebUSB; not included yet.

## M-Pesa (Daraja STK Push)
Without credentials it runs in MOCK mode (auto-success after 4s). For live: set
`MPESA_KEY MPESA_SECRET MPESA_SHORTCODE MPESA_PASSKEY MPESA_ENV=production MPESA_CB_SECRET=<random> PUBLIC_URL=https://your-domain` (HTTPS required for the callback; add `MPESA_TILL` and `MPESA_TYPE=CustomerBuyGoodsOnline` for till numbers).
The server, not the browser, marks payments successful. Duplicate callbacks are ignored, wrong amounts are checked, reused codes are rejected. Manual code entry is allowed by default (audited as unverified); set setting `mpesa_manual=0` to require STK-verified codes.

## eTIMS
Every sale queues a fiscal document; a worker retries failures (max 5, then manual Retry in More). Refunds queue a credit note. `FISCAL=mock` by default. `lib/fiscal.js` has an `etims` adapter stub pointing at `ETIMS_URL`: **map the payload to KRA's certified VSCU/OSCU spec before relying on it for compliance.**

## Offline
If the server is unreachable, the till saves sales locally (cash sales; no discounts), shows an "Offline" badge, and syncs automatically via `/api/sync`. Oversold stock is recorded and audited on sync. Run the server on the shop LAN so the till keeps working without internet.

## Deploy
Run behind Caddy/Nginx with HTTPS on your VPS (`pm2 start server.js`). Back up `pos.db` nightly (`sqlite3 pos.db ".backup b.db"`).

## Business modules (v2)
- **Customers & credit:** retail / wholesale / VIP tiers, credit limits enforced server-side, debtor payments (cash payments post to the open till), receivables ageing (0-30, 31-60, 61-90, 90+).
- **Pricing:** per-unit wholesale and VIP prices (Stock → Edit prices) plus time-window % promotions such as happy hour (More → Promotions). Server applies the right price; the till shows it.
- **Purchasing:** suppliers with payment terms, purchase orders (draft, sent, partial, received), goods receipt that adds stock and updates weighted-average cost, supplier invoices and payables with overdue flags.
- **Age check:** every sale records "visual" or "ID checked" (no personal data stored). Owner can switch it off in More.
- Fixed in this version: endpoints that return nothing (cash in/out, staff removal, PO send) now respond properly. Previously they could leave the request hanging.

## Operations (v3)
- **Partial returns:** pick items and quantities; refund is pro-rated for discounts, split across the original payment methods (cash portion leaves the till, account portion reduces the customer's balance), stock is restored and a credit note is queued. Whole-sale refund still available when nothing has been returned.
- **Shift report (Z-report):** shown at shift close and from Till → past shifts; printable.
- **Backups:** automatic daily SQLite backup (last 14 kept in `backups/`, or `BACKUP_DIR`). Owner can download one from More. Restore: stop the server, replace `pos.db` with the backup, start again.
- **USB / shared printers:** set `PRINTER_DEVICE` (e.g. `/dev/usb/lp0` on Linux, or a shared-printer path like `\\localhost\POS80` on Windows) instead of `PRINTER_HOST`. The user running the server needs write access to that device.
- **Desktop app (untested here):** `npm install`, `npm run rebuild` (rebuilds better-sqlite3 for Electron), then `npm run desktop`. `npm run dist` builds a Windows installer / Linux AppImage. The Print button prints silently to `PRINTER_NAME` (or the default printer) inside the app.

## Multi-branch (v4)
- Stock is tracked per branch in the ledger. Each user belongs to a branch and only sells, adjusts and counts stock there. Sales, shifts, purchase orders and reports are branch-scoped.
- **Owner** adds branches and assigns staff (More), switches the active branch from the header (close your shift first), and can view reports for "All branches".
- **Transfers** (Stock tab): the receiving branch's manager requests, the *sending* branch approves and dispatches (stock leaves its ledger, checked against its stock), the receiving branch confirms quantities (stock enters its ledger). Shortfalls are audited. Stock in transit belongs to neither branch.
- Refunds and returns put stock back into the branch where the sale happened.
- Existing databases upgrade automatically on start (new columns/tables are added in place). Back up first anyway.

## Delivery & phone orders (v5)
- **Orders tab:** create orders from phone/WhatsApp/web (customer, address, items, delivery fee). Flow: New → Picking → Packed → Dispatched (driver name) → Delivered.
- **Stock reservation:** open unpaid orders hold stock. Neither the POS nor new orders can use it, and cancelling releases it.
- **Payment:** take payment up front (cash, M-Pesa STK, card, account) or on delivery. Paying creates the normal sale (stock deduction, VAT, fiscal queue, shift cash). The delivery fee appears as its own receipt line. A paid order is cancelled by refunding the sale, not by cancelling the order.
- **Age check:** delivered requires "ID checked" at handover. Order prices are re-quoted at payment time, so a promotion ending in between changes the total.

## Online shop (v6)
- Customers order at **`/shop`** (phone-friendly, no login). Owner switches it on in More → Business ("Online ordering") and sets the delivery fee. It sells from branch 1 by default (setting `shop_branch`).
- Checkout: name, Safaricom phone, address, legal-age confirmation, then **Pay now with M-Pesa (STK push)** or **Pay on delivery**. The customer gets a tracking page (Received → Preparing → Packed → On the way → Delivered) that refreshes itself.
- Staff see web orders in the Orders tab (header badge + toast when a new one arrives). If the customer paid by STK, the order shows the M-Pesa code, and **Take payment** is pre-filled; recording it creates the normal sale with the payment verified against the server-side STK record. Orders paid by M-Pesa cannot be cancelled until recorded.
- Abuse protection: per-IP and per-order rate limits, honeypot field, quantity caps, input sanitising, and unpaid web orders stop holding stock after 2 hours (then auto-cancel). The public catalogue never exposes cost or stock counts.
- **Exposure:** the staff app lists staff names on its login screen, so don't put it on the open internet. Behind your reverse proxy, publish only `/shop`, `/shop.html`, `/api/public/*` and `/api/mpesa/callback/*`; keep everything else on the shop LAN/VPN. Set `TRUST_PROXY=1` so rate limits see real client IPs.

## SMS & labels (v7)
- **SMS order updates** (More → Business → "SMS order updates"): web orders get "received" (with a tracking link when `PUBLIC_URL` is set); any order with a phone number gets "on the way" (names the rider and reminds about ID), "delivered" and "cancelled". One SMS per order event, queued in an SMS log and sent by a worker with up to 3 tries. Default is MOCK (marks messages sent, sends nothing). For real sending set `SMS_PROVIDER=africastalking AT_USER AT_KEY` (`AT_ENV=production`, optional `SMS_SENDER`) and check it against the provider's current API before launch. Kenyan numbers only.
- **Shelf labels** (Stock → Labels): prints a sheet of labels (name, prices, scannable barcode). "Generate store barcodes" gives every product without one a valid in-store EAN-13 (prefix 2). Supplier codes print as EAN-13, UPC-A or EAN-8 when valid, otherwise Code 39. The encoder was checked against an independent barcode decoder.

## Deploying and going live (v8)
- `deploy/install.sh` (systemd service, Node 20+), `deploy/Caddyfile` (public shop + LAN-only staff site), `deploy/.env.example`, `deploy/offsite-backup.sh`. Set `NODE_ENV=production` to enforce PIN rules.
- Read `docs/GO-LIVE-CHECKLIST.md`, `docs/STAFF-GUIDE.md` and `docs/SECURITY.md`.
- **Compliance:** eTIMS is not certified. While it shows as not connected, receipts are not KRA fiscal invoices and mock fiscal numbers are never printed.

## v9: settings, photos, scanning, shifts, reports
- **Settings (owner):** General, **Payments**, **Photos**, Staff & branches, Promotions, Logs & backup, My account (every user: PIN, theme, scan beep).
- **M-Pesa in Settings → Payments:** separate Sandbox and Production credential sets (consumer key, secret, passkey, Paybill or Till shortcode, till number), a mode switch (Test / Sandbox / Production), public HTTPS URL and a **Test connection** button. Secrets are AES-256-GCM encrypted in the database with a key kept outside it (`SETTINGS_KEY` env var, or `settings.key` next to `pos.db`: back that file up separately) and are never sent back to the browser. The till shows a badge whenever it is not in production. Environment variables still work as a fallback.
- **Product photos:** up to 6 per product, shrunk in the browser. Store them **on the POS computer** (`uploads/`, free, works offline, include in backups) or in **Cloudinary** (CDN, survives hardware loss, good for the online shop). Chosen in Settings → Photos. Photos show on the till grid, stock list, shop and scanning screens.
- **Branches:** cashiers are locked to the branch the owner assigned (shown with a lock). Owners and managers can switch branch from the top bar (shift must be closed first); every switch is audited.
- **Scanning:** USB/Bluetooth scanners work anywhere on Sell; camera scanning (📷) works on phones/tablets/laptops over HTTPS or localhost (built-in BarcodeDetector, ZXing fallback bundled, no internet needed). Type `6*` before a code (or use the × box) to add several. Unknown codes offer **Link to a product** or **Create product** on the spot. **Stock → Receive (scan)** books a whole delivery in one go (case codes add a case); **Stocktake** counts by scanning each bottle.
- **Part sizes:** any size per product: half, quarter, **half of a quarter (⅛)**, tot, shot, glass. Quick-add buttons price them from the bottle rate; "½ Add half of this size" halves any size. Stock is deducted in ml, so mixed sales stay exact.
- **Shift start/close:** closing records cash counted, variance and an optional amount taken to the bank/safe; the rest is "left in the drawer". The next opener sees it, must count the drawer and either matches it or gives a reason; differences are audited and printed on the shift report.
- **Reports:** today / yesterday / 7 / 30 days / all time; most sold, top revenue, **most profitable**, best/lowest margin (net of returns and discounts), sales by day, busy hours, cash tied up in products that did not sell.
- **Stock alerts:** ⚠ badge in the header (out / low), alert list with reorder suggestions, a printable/copyable reorder list that can start a purchase order, and a toast when a sale drops a product below its reorder level.
- **Sign-in:** the staff list is no longer public. Staff type their name, then PIN; a device remembers the last 3 people. The owner can show name tiles instead (Settings → General).

## Not built yet
Batch/expiry tracking, per-branch receipt numbering and tax settings, direct label-printer drivers (labels print through the normal browser print dialog), a real eTIMS adapter (needs KRA's certified spec), WhatsApp bot ordering, a driver app or route planning, WhatsApp notifications. The Electron desktop wrapper is written but not built or run on a real machine.
# POS
