# Clearance finder

A shopping-style page for browsing BuyFromAuction’s in-stock listings, with filters, market checks, saved items and a **Sync** button that pulls new products straight from the shop.

## Files

| File | What it is |
|---|---|
| `index.html` | The page. It includes the 23 October 2026 export as its starting list. |
| `bfa-sync.js` | The sync engine. The page uses it for the Sync button, and the “BFA Sync” bookmark loads it on the shop’s tab. Keep it in the same folder as `index.html`. |
| `flash-sale-capture.js` | The deal watcher userscript. Checks newest listings every 10 seconds from noon until 7 PM in your computer's local time; full category/search checks run every 10 minutes. |

Keep a buyfromauction.in tab open for the deal watcher to run. Checks do not overlap, so a slow scan can take longer than 10 seconds; blocked requests retain the existing retry backoff. Update or reinstall the userscript to apply schedule changes.

## Put it on GitHub Pages

1. Create a new repository on GitHub, for example `clearance-finder`. On a free GitHub account it must be **public** for Pages to work; the page only contains public product data.
2. Upload `index.html`, `bfa-sync.js` and this `README.md` to the repository (Add file → Upload files → Commit).
3. Go to **Settings → Pages**. Under “Build and deployment”, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute or two, the page is live at `https://<your-username>.github.io/clearance-finder/`.

To update the page later, upload a new `index.html` or `bfa-sync.js` over the old one.

## Syncing

Click **Sync** in the header.

- **Full refresh** reads every in-stock product in the shop filter (₹50 to ₹1,59,300), replaces the list, and drops sold-out items. Do this the first time. It takes a few minutes.
- **Sync new items** adds products published since your last sync. Run it after about 6 PM IST, Monday to Saturday, when the day’s batch has finished.

After a sync, the page shows only what changed. Clear the “Added in the last update” filter to see everything.

### If your browser blocks the direct sync

Browsers stop one website from reading another website’s data unless that site allows it. If BuyFromAuction doesn’t allow it, the Sync panel switches to the bookmark method automatically:

1. **One time only:** drag the yellow **BFA Sync** button from the Sync panel to your bookmarks bar.
2. Click **Open the shop tab**.
3. On the shop tab, click the **BFA Sync** bookmark. A small panel shows progress, then the products are sent back to Clearance finder and the list updates.

If the shop blocks the bookmark too, use **copy the console version** in the Sync panel, open DevTools on the shop tab (F12 → Console), paste and press Enter. Chrome may ask you to type `allow pasting` first.

If the shop tab wasn’t opened from Clearance finder, it offers a CSV download instead. Upload that through **Update data → Add new products only**.

## Where your data lives

Everything stays in your browser: the synced list in IndexedDB, saved items and sync times in local storage. Nothing is sent anywhere except the read-only requests to buyfromauction.in. Another browser or device starts from the built-in list.

## Notes

- The sync reads the same public endpoints as the console scraper: the WooCommerce Store API for products and prices, and the WordPress REST API for publish dates. It never logs in or changes anything on the shop.
- Market-check verdicts are fixed from searches done on 19–20 October 2026 and are not refreshed by syncing.
- When a new `index.html` with a newer built-in list is uploaded, earlier synced data in the browser is cleared so the new list takes over. Run a sync afterwards.
