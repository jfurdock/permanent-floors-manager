// Flooring math and catalog vocabulary shared by the server and the UI.

export const CATEGORIES = [
  { id: 'carpet', label: 'Carpet', unit: 'SY', stock: 'roll', waste: 10, width: 12 },
  { id: 'pad', label: 'Carpet pad', unit: 'SY', stock: 'roll', waste: 5, width: 6 },
  { id: 'lvp', label: 'Luxury vinyl', unit: 'SF', stock: 'box', waste: 10 },
  { id: 'laminate', label: 'Laminate', unit: 'SF', stock: 'box', waste: 10 },
  { id: 'hardwood', label: 'Hardwood', unit: 'SF', stock: 'box', waste: 10 },
  { id: 'tile', label: 'Tile & stone', unit: 'SF', stock: 'box', waste: 15 },
  { id: 'sheet_vinyl', label: 'Sheet vinyl', unit: 'SY', stock: 'roll', waste: 10, width: 12 },
  { id: 'trim', label: 'Trim & transitions', unit: 'EA', stock: 'unit', waste: 0 },
  { id: 'sundry', label: 'Supplies', unit: 'EA', stock: 'unit', waste: 0 },
  { id: 'rug', label: 'Area rugs', unit: 'EA', stock: 'unit', waste: 0 },
  { id: 'labor', label: 'Installation labor', unit: 'SY', stock: 'none', waste: 0 },
  { id: 'service', label: 'Services & fees', unit: 'EA', stock: 'none', waste: 0 },
];

export const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
export const categoryLabel = (id) => CATEGORY[id]?.label || id || 'Other';

export const UNITS = ['SY', 'SF', 'LF', 'EA', 'BOX', 'HR'];
export const UNIT_LABEL = { SY: 'sq yd', SF: 'sq ft', LF: 'lin ft', EA: 'each', BOX: 'box', HR: 'hour' };

export const STOCK_TYPES = [
  { id: 'roll', label: 'Rolls (cut to length)' },
  { id: 'box', label: 'Boxes / cartons' },
  { id: 'unit', label: 'Individual units' },
  { id: 'none', label: 'Not stocked (labor, services, special order only)' },
];

export const QUOTE_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Lost' },
];

// Order stages in the order they normally happen.
export const ORDER_STAGES = [
  { id: 'new', label: 'New', hint: 'Order material' },
  { id: 'ordered', label: 'Material ordered', hint: 'Waiting on vendor' },
  { id: 'ready', label: 'Ready to schedule', hint: 'Material is in' },
  { id: 'scheduled', label: 'Scheduled', hint: 'Install on the calendar' },
  { id: 'installed', label: 'Installed', hint: 'Send the invoice' },
  { id: 'invoiced', label: 'Invoiced', hint: 'Collect the balance' },
  { id: 'paid', label: 'Paid', hint: 'Complete' },
];
export const ORDER_STAGE_INDEX = Object.fromEntries(ORDER_STAGES.map((s, i) => [s.id, i]));

export const PO_STATUSES = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent to vendor' },
  { id: 'partial', label: 'Partly received' },
  { id: 'received', label: 'Received' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const APPOINTMENT_TYPES = [
  { id: 'measure', label: 'Measure' },
  { id: 'install', label: 'Install' },
  { id: 'service', label: 'Service call' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'other', label: 'Other' },
];

export const PAYMENT_METHODS = [
  { id: 'card', label: 'Card' },
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'financing', label: 'Financing' },
  { id: 'other', label: 'Other' },
];

export const ROLES = [
  { id: 'admin', label: 'Owner / admin' },
  { id: 'manager', label: 'Manager' },
  { id: 'sales', label: 'Sales' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'installer', label: 'Installer' },
];

// ---------- feet & inches ----------

// Accepts 12, 12.5, 12'6, 12' 6", 12-6, "12 6", 150" and returns decimal feet.
export function parseFeet(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : null;
  const s = String(input).trim().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (s === '') return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/i);
  if (m) return Number(m[1]) / 12;
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:[-\s]\s*)?(\d+(?:\.\d+)?)?\s*(?:"|in)?$/i);
  if (m) {
    const ft = Number(m[1]);
    const inch = m[2] ? Number(m[2]) : 0;
    if (m[2] && inch >= 12) return null;
    return ft + inch / 12;
  }
  return null;
}

export function formatFeet(value) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  if (n < 0) return `-${formatFeet(-n)}`;
  const ft = n;
  let whole = Math.floor(ft + 1e-9);
  let inches = Math.round((ft - whole) * 12);
  if (inches === 12) { whole += 1; inches = 0; }
  return inches ? `${whole}' ${inches}"` : `${whole}'`;
}

const ceilTo = (n, step) => Math.ceil(n / step - 1e-9) * step;

// ---------- estimating ----------

export const roomArea = (r) => Math.max(0, Number(r.length_ft) || 0) * Math.max(0, Number(r.width_ft) || 0);

// Lay a roll across each room. Picks the direction that uses the least material.
// trimFt is added to every drop for squaring the ends (3" each end by default).
export function rollLayout(rooms, rollWidth = 12, trimFt = 0.5) {
  const w = Number(rollWidth) || 12;
  const out = rooms.map((r) => {
    const L = Number(r.length_ft) || 0;
    const W = Number(r.width_ft) || 0;
    if (!L || !W) return { room: r, drops: 0, cutLength: 0, linearFt: 0, seams: 0, runsAlong: 'length', usedSf: 0, areaSf: 0 };
    const a = { runsAlong: 'length', drops: Math.ceil(W / w - 1e-9), cutLength: L + trimFt };
    const b = { runsAlong: 'width', drops: Math.ceil(L / w - 1e-9), cutLength: W + trimFt };
    a.linearFt = a.drops * a.cutLength;
    b.linearFt = b.drops * b.cutLength;
    const pick = b.linearFt < a.linearFt - 1e-9 || (Math.abs(b.linearFt - a.linearFt) < 1e-9 && b.drops < a.drops) ? b : a;
    const areaSf = L * W;
    return {
      room: r,
      ...pick,
      seams: Math.max(0, pick.drops - 1),
      usedSf: pick.linearFt * w,
      areaSf,
    };
  });
  const linearFt = out.reduce((s, x) => s + x.linearFt, 0);
  const areaSf = out.reduce((s, x) => s + x.areaSf, 0);
  const usedSf = linearFt * w;
  return {
    rooms: out,
    rollWidth: w,
    linearFt,
    areaSf,
    usedSf,
    sy: ceilTo(usedSf / 9, 0.01),
    seams: out.reduce((s, x) => s + x.seams, 0),
    wastePct: areaSf ? ((usedSf - areaSf) / areaSf) * 100 : 0,
  };
}

// Quantity for a product from a set of rooms.
// method: 'roll' (roll layout) or 'area' (area + waste %).
export function estimate({ rooms, product, wastePct = 0, method = 'area' }) {
  const areaSf = rooms.reduce((s, r) => s + roomArea(r), 0);
  const unit = product?.unit || 'SF';
  const stock = product?.stock_type || 'none';
  const result = { areaSf, unit, qty: 0, boxes: null, layout: null, method, wastePct };
  if (method === 'roll' && stock === 'roll') {
    const layout = rollLayout(rooms, product.roll_width_ft || 12);
    result.layout = layout;
    result.qty = unit === 'SF' ? ceilTo(layout.usedSf, 1) : layout.sy;
    result.wastePct = layout.wastePct;
    return result;
  }
  const withWaste = areaSf * (1 + (Number(wastePct) || 0) / 100);
  if (stock === 'box' && product.coverage_per_box > 0) {
    const boxes = Math.ceil(withWaste / product.coverage_per_box - 1e-9);
    result.boxes = boxes;
    result.qty = Math.round(boxes * product.coverage_per_box * 100) / 100;
    if (unit === 'BOX') result.qty = boxes;
    return result;
  }
  if (unit === 'SY') result.qty = ceilTo(withWaste / 9, 0.01);
  else if (unit === 'SF') result.qty = Math.ceil(withWaste - 1e-9);
  else if (unit === 'LF') {
    // Perimeter for base / quarter round.
    const perim = rooms.reduce((s, r) => s + 2 * ((Number(r.length_ft) || 0) + (Number(r.width_ft) || 0)), 0);
    result.qty = Math.ceil(perim * (1 + (Number(wastePct) || 0) / 100) - 1e-9);
  } else result.qty = 1;
  return result;
}

// ---------- stock conversions ----------
// Inventory is tracked in stock units: linear feet for rolls, boxes for box goods,
// and the sale unit for everything else. Prices and costs are per sale unit.

export function stockUnitLabel(product) {
  if (!product) return '';
  if (product.stock_type === 'roll') return 'ft';
  if (product.stock_type === 'box') return 'boxes';
  return (product.unit || 'EA').toLowerCase();
}

export function stockToSale(product, stockQty, widthFt) {
  const q = Number(stockQty) || 0;
  if (!product) return q;
  if (product.stock_type === 'roll') {
    const w = Number(widthFt) || Number(product.roll_width_ft) || 12;
    const sf = q * w;
    return product.unit === 'SF' ? sf : sf / 9;
  }
  if (product.stock_type === 'box') {
    const cov = Number(product.coverage_per_box) || 0;
    return product.unit === 'BOX' || !cov ? q : q * cov;
  }
  return q;
}

export function saleToStock(product, saleQty, widthFt) {
  const q = Number(saleQty) || 0;
  if (!product) return q;
  if (product.stock_type === 'roll') {
    const w = Number(widthFt) || Number(product.roll_width_ft) || 12;
    const sf = product.unit === 'SF' ? q : q * 9;
    return ceilTo(sf / w, 1 / 12);
  }
  if (product.stock_type === 'box') {
    const cov = Number(product.coverage_per_box) || 0;
    return product.unit === 'BOX' || !cov ? Math.ceil(q - 1e-9) : Math.ceil(q / cov - 1e-9);
  }
  return q;
}

export function productName(p) {
  if (!p) return '';
  return [p.manufacturer, p.style, p.color].filter(Boolean).join(' ');
}
