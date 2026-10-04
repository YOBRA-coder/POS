# Security notes

## What is in place
- PINs hashed with scrypt + salt, compared in constant time. Lock-out after 5 wrong PINs per user (15 min) and 40 per IP. Weak/default PINs must be changed at first login in production; managers and owners need 6+ digits. Changing or resetting a PIN ends that user's other sessions.
- Sessions: random 192-bit tokens, 12 h expiry, server-side logout.
- Role checks on every API route; managers are limited to their own branch for refunds/returns. Discount approval PINs are throttled (5 wrong tries, then 10 min block).
- Prices, costs, VAT, stock and payment verification are always computed on the server. M-Pesa payments are confirmed from the server-side callback, never from the browser. Reused M-Pesa codes are rejected. Sales are idempotent.
- Ledger, audit log, sales and payments cannot be edited or deleted through the app (database triggers).
- All SQL is parameterised. Text sent by clients has markup characters stripped before it is stored. Security headers and a Content-Security-Policy are set.
- Public shop: rate limits, honeypot, quantity caps, age confirmation, stock holds expire after 2 hours; the public catalogue exposes no costs or stock counts.
- Error responses for unexpected failures are generic; details go to the server log only.

## Residual risks and recommendations
- The staff app shows staff names on its login screen. Keep it on the shop LAN/VPN (see `deploy/Caddyfile`).
- Session tokens live in the browser's local storage; use dedicated till PCs, lock the OS, and sign out at shift end.
- The CSP still allows inline scripts because the UI uses inline handlers. A future refactor to escape output everywhere would remove that need.
- The eTIMS adapter is a stub. SMS and live M-Pesa/SMS provider calls could not be tested against the real services here.
- This has not had an independent penetration test. Commission one before handling large volumes.
- Keep Node.js and dependencies updated (`npm audit`, `npm update`) and test backups regularly.
