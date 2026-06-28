# Deploying Store Selector (Vercel + Neon)

The app runs as a serverless Remix app on **Vercel**, with a **Neon**
Postgres database. Both have free tiers.

All commands run from the `store-selector/` directory.

---

## 1. Create the Neon database

1. Sign up at https://neon.tech and create a project (free tier).
2. In the project dashboard, open **Connection details** and copy:
   - the **Pooled** connection string (host contains `-pooler`) → this is `DATABASE_URL`
   - the **Direct** connection string (no `-pooler`) → this is `DIRECT_URL`
3. Put both in your local `.env` (replace the placeholders already there).

## 2. Push the schema to Neon

```bash
npx prisma db push
```

This creates the `Session`, `LocationSetting`, and `SyncState` tables.

## 3. Push the code to a Git repo

Vercel deploys from Git. Create a repo (GitHub/GitLab) and push this folder.

```bash
git init && git add -A && git commit -m "Store Selector app"
git remote add origin <your-repo-url> && git push -u origin main
```

## 4. Create the Vercel project

1. Sign up at https://vercel.com and **Import** your repo.
2. **Root directory:** set it to `store-selector` if the repo root is one
   level up; otherwise leave as is.
3. **Build command:** `npm run vercel-build` (already in package.json).
4. **Install command:** `npm install --legacy-peer-deps`
   (needed because `@vercel/remix` lags Remix by a minor version).
5. Add **Environment Variables** (Production):

   | Name | Value |
   |------|-------|
   | `SHOPIFY_API_KEY` | `bb1131e9b0f45483a696829d30b15cc5` |
   | `SHOPIFY_API_SECRET` | *(Partner dashboard → your app → API credentials → Client secret)* |
   | `SCOPES` | `read_products,read_locations,read_inventory` |
   | `SHOPIFY_APP_URL` | `https://<your-project>.vercel.app` |
   | `DATABASE_URL` | *(Neon pooled string)* |
   | `DIRECT_URL` | *(Neon direct string)* |

6. **Deploy.** Note the final URL, e.g. `https://store-selector.vercel.app`.
   (If you set `SHOPIFY_APP_URL` before knowing the URL, update it after the
   first deploy and redeploy.)

## 5. Point Shopify at the hosted URL

Edit `shopify.app.toml`:

```toml
application_url = "https://<your-project>.vercel.app"

[auth]
redirect_urls = [
  "https://<your-project>.vercel.app/auth/callback",
  "https://<your-project>.vercel.app/auth/shopify/callback",
  "https://<your-project>.vercel.app/api/auth/callback"
]
```

Then register the config (and the new inventory webhook) with Shopify:

```bash
npx shopify app deploy
```

Now the app icon in admin loads the hosted app — no `shopify app dev` needed.

---

## Installing on a client's store

1. **Partner dashboard → Distribution → Custom distribution** → generate an
   install link for the client's store (no App Store review). Send it.
2. Client approves permissions → app installs.
3. Client's **theme editor → App embeds → enable "Store Selector"**.
4. Add `data-product-id="{{ card_product.id }}"` and `data-store-locator-item`
   to the product-card snippet of **their** theme (for Dawn:
   `snippets/card-product.liquid`).
5. Open the app in their admin → **Store Locations → Sync to storefront**.

## How auto-sync works on serverless

The `inventory_levels/update` webhook runs a **throttled** re-sync (at most
once per 20s per shop, tracked in the `SyncState` table). Because each sync
reads the full current inventory, the storefront converges to the correct
state. Any change landing inside a throttle window is picked up by the next
event — or click **Sync to storefront** to force it immediately.

## Notes / limitations

- **Cold starts:** on the free tier the first admin load after idle is slower.
- **Function timeout:** the sync runs inside the webhook; for very large
  catalogs it could approach Vercel's function limit. The catalog here is
  small, so it's fine. If it ever grows large, move the sync to a queue.
