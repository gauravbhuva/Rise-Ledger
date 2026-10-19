# RupeeLedger — offline-first PWA starter

This is the first working prototype for RupeeLedger, a personal finance tracker designed for Android and desktop browsers.

## Included in this prototype
- Responsive mobile-first interface with dashboard and bottom navigation
- Local IndexedDB storage (records stay in this browser profile)
- Income, expense, own-account transfer, cash repayment, work credit, and seller-payment entries
- Item-level obligations with independent personal-debt and seller-unpaid balances
- Automatic dashboard totals derived from records
- Transaction search and type filtering
- JSON backup export and restore
- Transaction CSV export
- PWA manifest and service worker for install/offline shell caching

## Important limitations in this first prototype
- No cloud sync yet.
- The initial available-money calculation is a simplified total cash-flow view. Account-specific balances and opening balances are not implemented yet.
- A transfer is recorded for history but account-by-account balances are not yet calculated.
- There is no edit/reversal workflow yet.
- Work credit reduces the selected item's personal debt. It does not change cash.
- A purchase item's initial `personalOwed` and `sellerUnpaid` amounts are independent starting balances. Repayments should be entered only against the corresponding balance.
- Use test data first. Export backups regularly. This is not yet a validated accounting product.

## Run locally on Windows
A PWA service worker and installation require `localhost` or HTTPS; opening `index.html` directly with `file://` will not enable them.

### Easiest route: VS Code + Live Server
1. Install Node.js LTS from https://nodejs.org/ if you want to use the command-line route, or install Visual Studio Code from https://code.visualstudio.com/.
2. Open this folder in VS Code.
3. Install the `Live Server` extension by Ritwick Dey.
4. Right-click `index.html` and choose **Open with Live Server**.
5. Open the shown localhost URL in Chrome.

### Alternative: Python built-in server
If Python is installed, open a terminal in this folder and run:
```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.

## Install on Android
For easiest testing, publish the project to an HTTPS static host (for example, a private GitHub repository with GitHub Pages or another static host), open its URL in Chrome on Android, then use the browser menu → **Install app** or **Add to Home screen**. A locally served `localhost` page on your PC is not directly accessible from the phone without network configuration.

## Data and privacy
Data is stored in IndexedDB for the origin (website URL) and browser profile where you use the app. Clearing site data can delete records. Export the JSON backup before moving to a different browser/device. The app does not transmit financial records to a server.
