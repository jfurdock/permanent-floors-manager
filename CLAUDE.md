# Permanent Floors Store Manager

Flooring retail management app (quotes, orders, inventory, purchasing, scheduling, invoicing, reports) for Permanent Floors Carpet One. Mobile-first React UI, Node server, SQLite.

## Commands
- `npm start`: run the server on :3000 (serves `dist/` and `/api`)
- `npm run dev`: API on :3000 plus Vite on :5173 with live reload
- `npm test`: node:test end-to-end checks in `test/` (in-memory DB)
- `npm run build`: rebuild `dist/` (commit the result; the server ships prebuilt)
- `npm run build:demo`: single-file browser demo in `dist-demo/`
- `DATA_DIR=./demo-data npm run seed`: sample data into an empty DB

## Architecture
- `core/api/index.js` exposes `createApi(db).handle({ method, path, query, body, token })`. The server (`server/index.js`) and the browser demo (`web/src/lib/demo-backend.js`, sql.js) both call it, so business rules live only in `core/`.
- `db` adapter interface: `all(sql, ...params)`, `get`, `run` (returns `{ changes, lastInsertRowid }`), `exec`. Use positional `?` params only, so SQL runs the same on node:sqlite and sql.js.
- Every non-GET request runs serially inside a transaction. Don't `await` between writes that must be atomic (only PIN hashing awaits).
- Routes register with `r.get/post/put/del(pattern, handler, { roles, public })`. Default roles are staff (admin, manager, sales, warehouse). Use `EVERYONE` or `MANAGERS` from `shared.js`.
- Throw `bad(message)` / `notFound()` / `forbidden()` from `core/util.js` for user-facing errors. Messages are shown to staff as-is, so write them as plain instructions.
- Quotes and orders share the `lines` and `rooms` tables (`doc_type` 'quote' or 'order'). Totals are recomputed by `recalcDoc`. Order stages move forward with `advanceStage` and `refreshMaterialStage`.
- Inventory is stored in stock units (feet for rolls, boxes for box goods). Prices and costs are per sale unit. Convert with `stockToSale` / `saleToStock` in `core/calc.js`.
- Detail endpoints return note lists as `note_items` (the `notes` field is the record's own text).

## UI conventions
- Screens live in `web/src/pages`. Wrap each in `<Screen title back actions>`. Edits happen in bottom sheets (`Sheet` in `ui/overlay.jsx`). Use `useAction()` for mutations (busy flag plus error toast) and `useData(path, params)` for reads.
- Every color is a CSS token in `web/src/styles.css`, with a dark theme. Body font is Barlow and headings use Barlow Semi Condensed. Inputs are 16px so iOS doesn't zoom.
- Copy is sentence case, written from the store's point of view, and buttons name the exact action.
- `__DEMO__` is true only in the browser demo build. It hides printing and downloads and uses in-memory routing.
