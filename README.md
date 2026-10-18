# Permanent Floors Store Manager

Store management software for Permanent Floors Carpet One, built around how a flooring store actually works: measure, quote, sell, order material, cut it, install it, invoice it, get paid. It runs in any browser and is designed for phones first, so salespeople can quote in the customer's living room and installers can see their jobs from the truck.

## What it does

| Area | Features |
|---|---|
| **Quotes** | Room-by-room measuring in feet and inches, a roll-layout calculator that draws each drop and seam to scale, box rounding for hard surfaces, one-tap pad, labor, tear-out and trim add-ons, discounts, per-item sales tax, on-screen customer signature, printable quote. |
| **Orders** | One-tap conversion from a signed quote. A progress bar (New, Material ordered, Ready to schedule, Scheduled, Installed, Invoiced, Paid) that moves on its own. A "next step" box on every order tells staff what to do. Deposits, payments and refunds, invoices, a work order for installers, order history. |
| **Inventory** | Roll goods tracked by roll tag, dye lot, width and remaining length. Box goods by lot and box count. Cutting a roll for a job, returning material to stock, automatic remnant flagging, count corrections with history, low-stock alerts. |
| **Purchasing** | "Order material" groups everything a job needs onto draft purchase orders by vendor, with cut sizes noted. Mark as sent, email a summary, receive by roll or box. Special-order material is pulled for its job automatically when it arrives. Vendor list. |
| **Scheduling** | Rolling 7-day calendar of measures, installs, service calls and deliveries, color-coded by crew, with multi-day installs, double-booking warnings, and a list of jobs waiting for a date. |
| **Installers** | Their own sign-in that shows only their jobs: address with directions, tap to call or text, rooms, materials with roll tags and warehouse locations, notes, start and complete the job, and send notes to the office. |
| **Customers** | Homeowners, commercial accounts and builders, with full history of quotes, orders, appointments, payments and notes. |
| **Products** | Catalog for carpet, pad, LVP, laminate, hardwood, tile, sheet vinyl, trim, supplies, rugs, labor and fees. Cost and price with margin helper, roll width or square feet per box, vendor, and reorder point. |
| **Reports** | Sales and gross margin by month, salesperson, category and customer type. Money owed with aging. Deposits held. Quote close rate. Inventory value. Crew workload. Daily payments by method for closing out. CSV export. |
| **Team** | Sign in by tapping your name and entering a PIN. Roles: owner, manager, sales, warehouse, installer. Online, a store code keeps everyone else out, and repeated wrong PINs lock that person out for a while. |
| **Data** | Everything lives in one SQLite file. One-click backup download and full JSON export. |

Integrations (card processing, QuickBooks, email and text sending, vendor ordering systems, Measure Square) are not included yet. The code is set up so each can be added later as its own module.

## Run it

You need **Node.js 22.13 or newer** (the current LTS, Node 24, is recommended) from [nodejs.org](https://nodejs.org). Nothing else needs to be installed to run the app: the web app is already built into `dist/`, and the database is built into Node.

**Windows:** double-click `Start Store Manager.bat`.

**Mac or Linux:** open a terminal in this folder and run:

```bash
npm start
```

Then open **http://localhost:3000**. The first time, it asks you to create the owner account. Add the rest of your team, crews, vendors and products in **Settings** and **Products**.

To try it with sample data first, keep it separate from your real store data:

```bash
DATA_DIR=./demo-data npm run seed
DATA_DIR=./demo-data npm start
```

Sample PINs: Ryan 1234 (owner), Marcus 2222 and Priya 3333 (sales), Tom 4444 (warehouse), Luis 5555 (installer).

## Use it on phones and tablets

Run the app on a computer at the store that stays on. When it starts, it prints an address like `http://192.168.1.20:3000`. Any phone on the store Wi-Fi can open that address. On the phone, use **Add to Home Screen** so it opens like an app.

To use it away from the store, put it online (next section).

## Free online demo (GitHub Pages)

The `docs/` folder holds a version that runs entirely in the browser, loaded with the sample store. GitHub Pages can host it for free. It's good for showing the app to someone and letting them try it. Each person's changes are saved in their own browser on that device, and **Reload sample data** in Settings starts it over.

1. In the GitHub repository, go to **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, set the branch to `main` and the folder to `/docs`, and click **Save**.
3. After a minute or two, it's live at `https://<your-github-name>.github.io/permanent-floors-manager/`.

Free GitHub Pages needs the repository to be public. The demo contains only sample data. After changing the web app, run `npm run build:pages` and push to update it.

## Put it online (Render)

Hosting it online lets people use it from anywhere: salespeople at a customer's house, installers on a job, the owner at home. The repository includes a `render.yaml` that sets everything up on [Render](https://render.com): HTTPS, a 1 GB persistent disk for the database, health checks, and redeploys whenever you push to GitHub. It runs on Render's smallest paid server ($7/month) plus the disk ($0.25 per GB per month).

1. Push this folder to a **private** GitHub repository.
2. Sign up at render.com with that GitHub account and add a payment method.
3. In Render, choose **New**, then **Blueprint**, and pick the repository.
4. Render asks for **ACCESS_CODE**. Type a store code that's easy to say out loud, like `floors2026`. Every phone and computer enters it once before anyone can sign in.
5. Click **Apply**. The first deploy takes a few minutes. Your address looks like `https://permanent-floors.onrender.com`.

The first time it starts, it loads the **sample store** so there's something to try right away (owner Ryan Mackey, PIN 1234). When you're ready to use it for real, the owner goes to **Settings, Sample data, Start fresh with no data**. That erases everything and goes back to the "create the owner account" screen. To skip the sample store entirely, set `SEED_SAMPLE_DATA` to `false` before the first deploy.

To change the store code later, edit `ACCESS_CODE` under the service's **Environment** tab in Render. Every device has to enter the new code.

The same `Dockerfile` also works on any other host with Docker and a persistent disk (Fly.io, Railway, a VPS):

```bash
docker build -t store-manager .
docker run -d -p 3000:3000 -v store-data:/data -e ACCESS_CODE=floors2026 --name store-manager store-manager
```

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on (all network interfaces) |
| `DATA_DIR` | `./data` | Folder for `store.db` and daily backups |
| `ACCESS_CODE` | none | Store code each device must enter once. Always set this when the app is on the internet. |
| `SEED_SAMPLE_DATA` | `false` | Load the sample store the first time the database is empty |
| `TRUST_PROXY` | `false` | Set to `true` behind a hosting proxy (Render sets this through `render.yaml`) |

## Backups

The server saves a copy of the database every day in `DATA_DIR/backups` and keeps the last 14. Owners and managers can also download a copy any time from **Settings, Backups**. Keep a copy somewhere off the server now and then. To restore one, stop the app, replace `store.db` with the backup file, and start the app again.

## How the numbers work

- **Carpet and sheet vinyl** are sold by the square yard. With "Lay out the roll", each room is covered with drops of the roll width (12', 13' 6", or 15'). Each drop gets 3" of trim at each end, and the calculator picks the direction that uses the least material. The diagram shows each drop, the seams, and what hangs past the wall. "Area plus waste" is there for estimators who plan on fill pieces.
- **Box goods** (LVP, laminate, hardwood, tile) are sold by the square foot and always rounded up to full boxes. The waste percentage defaults by category.
- **Inventory** counts rolls in linear feet and box goods in boxes. Prices and costs are always per selling unit (per square yard or square foot).
- **Sales tax** applies only to items marked taxable. Labor and services default to not taxable. An order-level discount is spread across items before tax.
- **Remnants:** any roll piece at or under the remnant cutoff (20 ft by default, in Settings) is flagged as a remnant automatically.
- **Order stages** only move forward on their own: ordering material, receiving it, scheduling, completing the install, invoicing, and collecting the balance. Staff can change the stage by hand from the order's menu.

## Roles

| | Owner | Manager | Sales | Warehouse | Installer |
|---|:-:|:-:|:-:|:-:|:-:|
| Quotes, orders, customers, schedule, inventory, purchasing | ✓ | ✓ | ✓ | ✓ | |
| Store settings, team, PIN resets, backups | ✓ | ✓ | | | |
| Reopen an invoice, delete a payment | ✓ | ✓ | | | |
| Add or change owner accounts | ✓ | | | | |
| Own jobs only: work order, start and complete, notes | | | | | ✓ |

## For developers

```bash
npm install          # build tools (Vite, React). Not needed just to run the app
npm run dev          # API on :3000 and the web app with live reload on :5173
npm test             # end-to-end checks of the business rules
npm run build        # rebuild dist/ after changing the web app
npm run build:demo   # dist-demo/index.html: one file that runs entirely in the browser with sample data
npm run build:pages  # the same browser version into docs/, for GitHub Pages
```

```
core/           Business rules, shared by the server and the browser demo
  api/          One module per area: quotes and lines (docs.js), orders, purchasing, inventory, schedule, reports...
  calc.js       Flooring math: feet and inches, roll layout, box rounding, stock unit conversions
  schema.js     SQLite tables and default settings
  seed.js       Sample store data
server/         Small Node server (no packages needed): web app and API, using Node's built-in SQLite
web/src/        React app
  pages/        One file per screen
  ui/           Shared components: sheets, pickers, room diagram, signature pad, charts
test/           API tests
```

The whole API is one function, `handle({ method, path, query, body, token })` in `core/api/index.js`. The Node server and the browser demo both call it, so the business rules exist in exactly one place. Every change runs inside a database transaction, so a failed request saves nothing.
