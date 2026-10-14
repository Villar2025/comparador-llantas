import { connect } from './supabase.js';
import {
  PROVIDERS,
  norm,
  finish,
  number,
  priceFor,
  searchRows,
} from './catalogo.js';
import { readFile } from './importaciones.js';
const $ = (s) => document.querySelector(s);
const money = (v) =>
  v == null
    ? 'Por confirmar'
    : new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
      }).format(v);
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const providerName = (id) =>
  PROVIDERS.find((p) => p.id === id)?.name || 'Proveedor';
const date = (s) =>
  s
    ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString(
        'es-MX',
        { day: 'numeric', month: 'short', year: 'numeric' },
      )
    : 'Fecha por confirmar';
let db,
  lists = [],
  rows = [],
  results = [],
  orders = [],
  cart = [],
  limit = 30,
  preview = null,
  currentUser = null,
  loading = false,
  previewExpected = null;
let statusTimer;
function globalStatus(text, duration = 0) {
  clearTimeout(statusTimer);
  $('#global-status').textContent = text;
  if (text && duration > 0) {
    statusTimer = setTimeout(() => {
      $('#global-status').textContent = '';
    }, duration);
  }
}
const options = (items) =>
  items
    .map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`)
    .join('');
function setupSelection() {
  const label = $('#query').closest('label');
  label.replaceChildren();
  const kindLabel = document.createElement('span');
  kindLabel.textContent = 'Buscar por';
  const kind = document.createElement('select');
  kind.id = 'search-kind';
  kind.setAttribute('aria-label', 'Buscar por');
  kind.innerHTML = options([
    ['size', 'Medida'],
    ['model', 'Modelo'],
    ['code', 'Código'],
  ]);
  const selectedLabel = document.createElement('span');
  selectedLabel.id = 'selection-label';
  selectedLabel.textContent = 'Medida disponible';
  const select = document.createElement('select');
  select.id = 'query';
  select.setAttribute('aria-labelledby', 'selection-label');
  label.append(kindLabel, kind, selectedLabel, select);
  kind.onchange = () => {
    rebuildSelection(false);
    renderSearch();
  };
  select.onchange = () => renderSearch();
  const subtitle = $('#page-compare .page-heading .muted');
  if (subtitle)
    subtitle.textContent =
      'Elige una medida, modelo o código de las listas de tus proveedores.';
}
function rebuildSelection(preserve = true) {
  const kind = $('#search-kind').value;
  const prior = preserve ? $('#query').value : '';
  const values = [
    ...new Set(rows.map((r) => String(r[kind] ?? '').trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, 'es-MX', { numeric: true }));
  $('#selection-label').textContent = {
    size: 'Medida disponible',
    model: 'Modelo disponible',
    code: 'Código disponible',
  }[kind];
  $('#query').innerHTML = options([
    ['', 'Ver todas las opciones'],
    ...values.map((v) => [v, v]),
  ]);
  if (values.includes(prior)) $('#query').value = prior;
}
function selectedRows() {
  const value = $('#query').value;
  const kind = $('#search-kind').value;
  return value
    ? rows.filter((r) => String(r[kind] ?? '').trim() === value)
    : rows;
}
function page(name) {
  for (const n of ['compare', 'lists', 'cart'])
    $('#page-' + n).hidden = n !== name;
  document
    .querySelectorAll('[data-page]')
    .forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  $('#breadcrumb').textContent =
    'Compras / ' +
    { compare: 'Comparador', lists: 'Listas de precios', cart: 'Mi pedido' }[
      name
    ];
  if (name === 'cart') renderCart();
}
function resetPrivate() {
  globalStatus('');
  if ($('#detail').open) $('#detail').close();
  lists = [];
  rows = [];
  orders = [];
  cart = [];
  preview = null;
  currentUser = null;
  $('#results').replaceChildren();
  $('#chart').replaceChildren();
  $('#review-rows').replaceChildren();
  $('#import-review').hidden = true;
  $('#app').hidden = true;
  $('#login').hidden = false;
}
async function authorize(user) {
  const { data, error } = await db
    .from('propietario')
    .select('usuario_id')
    .eq('usuario_id', user.id)
    .maybeSingle();
  if (error)
    throw Error('No se pudo comprobar el propietario: ' + error.message);
  if (!data) throw Error('Este usuario no está autorizado.');
  currentUser = user.id;
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#password').value = '';
  await load();
}
async function load() {
  if (loading) return;
  loading = true;
  $('#refresh').disabled = true;
  globalStatus('');
  try {
    const [catalog, saved] = await Promise.all([
      db.from('listas_comparador').select('*').eq('active', true),
      db
        .from('ordenes_comparador')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    if (catalog.error)
      throw Error(
        'Ejecuta primero 01_INSTALAR_Y_CARGAR.sql, incluido junto a la carpeta web, en Supabase. ' +
          catalog.error.message,
      );
    if (!currentUser) return;
    lists = catalog.data;
    rows = lists.flatMap((l) =>
      l.rows.map((r) => ({
        ...r,
        uid: l.id + ':' + r.id,
        provider_id: l.provider_id,
        list_id: l.id,
        filename: l.filename,
        date: l.date,
        date_label: l.date_label,
      })),
    );
    if (saved.error) throw saved.error;
    orders = saved.data;
    $('#catalog-count').textContent =
      `${lists.length} proveedores · ${rows.length.toLocaleString('es-MX')} ofertas`;
    const selected = $('#brand-filter').value;
    $('#brand-filter').innerHTML =
      '<option value="">Todas las marcas</option>' +
      options([...new Set(rows.map((r) => r.brand))].sort().map((v) => [v, v]));
    $('#brand-filter').value = selected;
    if (!lists.length)
      globalStatus(
        'No hay listas cargadas. Ejecuta el SQL incluido en el paquete.',
      );
    rebuildSelection();
    renderLists();
    renderSearch();
    renderCart();
    renderSaved();
    await loadHistory();
  } catch (e) {
    globalStatus(e.message || 'No se pudieron cargar los datos.');
  } finally {
    loading = false;
    $('#refresh').disabled = false;
  }
}
function filter() {
  return {
    query: '',
    brand: $('#brand-filter').value,
    provider: $('#provider-filter').value,
    stock: $('#stock-filter').value,
    qty: Math.max(1, Math.min(9999, Number($('#quantity').value) || 1)),
    wholesale: $('#wholesale').checked,
  };
}
function renderSearch(rebuild = true) {
  limit = 30;
  const f = filter();
  $('#exact-label').hidden = $('#mode').value !== 'exact';
  if (rebuild) {
    const prior = $('#exact-filter').value;
    const candidates = searchRows(selectedRows(), { ...f, exact: '' });
    const unique = new Map(
      candidates
        .filter((r) => r.exact)
        .map((r) => [
          r.exact,
          `${r.size} · ${r.brand} ${r.model} · ${r.spec} ${r.variant}`,
        ]),
    );
    $('#exact-filter').innerHTML = options([...unique]);
    if (unique.has(prior)) $('#exact-filter').value = prior;
  }
  if ($('#mode').value === 'exact') {
    const key = $('#exact-filter').value;
    results = key ? searchRows(selectedRows(), { ...f, exact: key }) : [];
  } else results = searchRows(selectedRows(), f);
  $('#result-count').textContent = `${results.length} resultados`;
  renderResults();
  renderChart();
}
function stockText(r, q) {
  return r.stock === null
    ? 'Existencias por confirmar'
    : r.stock === 0
      ? 'Sin existencias reportadas'
      : r.stock < q
        ? `${r.stock} piezas · no cubre ${q}`
        : `${r.stock.toLocaleString('es-MX')} piezas reportadas`;
}
function renderResults() {
  const f = filter();
  const shown = results.slice(0, limit);
  const best = results.find((r) => priceFor(r, f.wholesale) !== null)?.uid;
  $('#results').innerHTML = shown.length
    ? shown
        .map((r) => {
          const price = priceFor(r, f.wholesale);
          return `<article class="offer ${r.uid === best ? 'best' : ''}"><div><div class="offer-top"><span>${esc(providerName(r.provider_id))}</span>${r.uid === best ? '<span class="tag">MENOR PRECIO LISTADO</span>' : ''}</div><h3>${esc(r.size)} · ${esc(r.brand)}</h3><p class="description">${esc(r.model || r.description)}${r.spec ? ' · ' + esc(r.spec) : ''}</p><p class="stock ${r.stock === null || r.stock < f.qty ? 'warn' : ''}">${esc(stockText(r, f.qty))}</p><small>${esc(r.date ? date(r.date) : r.date_label || 'Fecha por confirmar')}</small><button class="text-button offer-details" data-detail="${esc(r.uid)}">Ver descripción y condiciones</button></div><div class="offer-price"><div class="amount">${money(price)}</div><small>${esc(f.wholesale && r.provider_id === PROVIDERS[2].id ? 'Escenario mayoreo' : r.priceLabel || 'Por pieza')}</small><small>${price === null ? '' : money(price * f.qty) + ' / ' + f.qty + ' piezas'}</small><button class="secondary" data-add="${esc(r.uid)}" ${price === null || r.stock === 0 ? 'disabled' : ''}>+ Agregar</button></div></article>`;
        })
        .join('')
    : `<div class="empty">${$('#mode').value === 'exact' ? 'No hay una coincidencia exacta con especificaciones suficientes. Prueba “Distintas marcas / misma medida”.' : 'No hay resultados con estos filtros. Prueba otra medida o muestra todas las existencias.'}</div>`;
  $('#more').hidden = results.length <= limit;
}
function renderChart() {
  const f = filter(),
    data = results.filter((r) => priceFor(r, f.wholesale) > 0).slice(0, 8);
  const max = Math.max(...data.map((r) => priceFor(r, f.wholesale)), 1);
  $('#chart-caption').textContent =
    $('#query').value.trim() || 'Búsqueda actual';
  $('#chart').innerHTML = data.length
    ? data
        .map(
          (r) =>
            `<div class="bar-item"><div class="bar-meta"><span>${esc(providerName(r.provider_id))}<br><small>${esc(r.brand)} · ${esc(r.model)}</small></span><strong>${money(priceFor(r, f.wholesale))}</strong></div><div class="bar-track"><div class="bar" style="width:${(priceFor(r, f.wholesale) / max) * 100}%"></div></div></div>`,
        )
        .join('')
    : '<p class="muted">No hay precios para graficar.</p>';
  $('#chart').setAttribute(
    'aria-label',
    data
      .map(
        (r) =>
          `${providerName(r.provider_id)} ${r.brand} ${r.model}: ${money(priceFor(r, f.wholesale))}`,
      )
      .join('; ') || 'Sin precios',
  );
}
function details(uid) {
  const r = rows.find((x) => x.uid === uid);
  if (!r) return;
  $('#detail-body').innerHTML =
    `<h3>${esc(r.description)}</h3><dl><dt>Proveedor y código</dt><dd>${esc(providerName(r.provider_id))} · ${esc(r.code || 'Código no indicado')}</dd><dt>Precio base</dt><dd>${money(r.price)} · ${esc(r.priceLabel)} · ${esc(r.tax)}</dd><dt>Existencias</dt><dd>${esc(stockText(r, filter().qty))}${r.warehouses ? '<br>' + esc(r.warehouses) : ''}</dd><dt>Fuente</dt><dd>${esc(r.filename)}<br>${esc(r.source)}<br>${esc(r.date ? date(r.date) : r.date_label || 'Fecha por confirmar')}</dd></dl><h3>Otras tarifas publicadas</h3>${r.tiers.length ? '<ul>' + r.tiers.map((t) => `<li>${esc(t.label)}: <strong>${money(t.price)}</strong></li>`).join('') + '</ul>' : '<p>No se indican otras tarifas.</p>'}<h3>Observaciones</h3><ul>${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}<li>Misma medida no significa equivalencia técnica. Verifica carga, velocidad, construcción y uso.</li></ul>`;
  $('#detail').showModal();
}
function renderLists() {
  $('#list-cards').innerHTML = PROVIDERS.map((p) => {
    const l = lists.find((x) => x.provider_id === p.id);
    return `<article class="list-card"><p class="eyebrow">${esc(p.kind === 'yactyres' ? 'PDF' : 'EXCEL')}</p><h2>${esc(p.name)}</h2><p class="list-number">${l ? l.rows.length : 0} <small>ofertas</small></p><p>${esc(l?.filename || 'Sin lista')}</p><p>${esc(l?.date ? date(l.date) : l?.date_label || 'Fecha por confirmar')}</p>${l?.warnings.map((w) => `<p>${esc(w)}</p>`).join('') || ''}</article>`;
  }).join('');
}
async function loadHistory() {
  const { data, error } = await db
    .from('listas_comparador')
    .select('id,provider_id,filename,date,date_label,active,created_at')
    .order('created_at', { ascending: false })
    .limit(30);
  if (!currentUser) return;
  $('#history').innerHTML = error
    ? '<p>No se pudo cargar el historial.</p>'
    : data
        .map(
          (l) =>
            `<div class="history-row"><div><strong>${esc(providerName(l.provider_id))}</strong><small>${esc(l.filename)} · cargada ${date(l.created_at)}</small></div><span class="tag ${l.active ? '' : 'gray'}">${l.active ? 'Actual' : 'Archivada'}</span></div>`,
        )
        .join('');
}
function add(uid) {
  const r = rows.find((r) => r.uid === uid);
  if (!r || r.price === null) return;
  const qty = filter().qty;
  const existing = cart.find((x) => x.row.uid === uid);
  if (existing) existing.qty += qty;
  else cart.push({ row: structuredClone(r), qty, bulk: false });
  renderCart();
  globalStatus(
    `${r.brand} ${r.size}: agregado al pedido. Puedes ajustar la cantidad en “Mi pedido”.`,
    4000,
  );
}
function grouped() {
  const groups = new Map();
  cart.forEach((item) => {
    if (!groups.has(item.row.provider_id)) groups.set(item.row.provider_id, []);
    groups.get(item.row.provider_id).push(item);
  });
  return groups;
}
function unit(item, group) {
  return priceFor(
    item.row,
    item.bulk && group.reduce((s, x) => s + x.qty, 0) >= 50,
  );
}
function renderCart() {
  for (const items of grouped().values())
    if (items.reduce((s, x) => s + x.qty, 0) < 50)
      items.forEach((x) => (x.bulk = false));
  $('#cart-count').textContent = cart.reduce((s, x) => s + x.qty, 0);
  $('#cart').innerHTML = cart.length
    ? [...grouped()]
        .map(([id, items]) => {
          const quantity = items.reduce((s, x) => s + x.qty, 0),
            total = items.reduce(
              (s, x) => s + Math.round(unit(x, items) * x.qty * 100) / 100,
              0,
            );
          return `<section class="cart-group"><h2>${esc(providerName(id))}</h2>${items
            .map((item) => {
              const r = item.row;
              const i = cart.indexOf(item);
              const stale = !lists.some((l) => l.id === r.list_id);
              return `<div class="cart-line"><div><p><strong>${esc(r.size)} · ${esc(r.brand)} ${esc(r.model)}</strong></p><small>Código: ${esc(r.code || 'no indicado')} · ${money(unit(item, items))} / pieza</small><small>${esc(stockText(r, item.qty))}${stale ? ' · Lista anterior: revisa el precio actual.' : ''}</small></div><label>Piezas<input data-qty="${i}" type="number" min="1" max="9999" value="${item.qty}"></label><strong class="line-total">${money(unit(item, items) * item.qty)}</strong><button class="remove" data-remove="${i}" aria-label="Quitar producto">×</button></div>`;
            })
            .join(
              '',
            )}${id === PROVIDERS[2].id ? `<label class="check"><input data-bulk="${id}" type="checkbox" ${items.every((x) => x.bulk) && quantity >= 50 ? 'checked' : ''} ${quantity < 50 ? 'disabled' : ''}>Confirmé mayoreo Yactyres para este pedido (mínimo 50 piezas; ahora ${quantity}).</label>` : ''}<p class="cart-total">${money(total)} <small>MXN</small></p><p class="muted">Subtotal de precios publicados. IVA, flete y disponibilidad sujetos a las condiciones de la lista.</p></section>`;
        })
        .join('')
    : '<div class="empty">Tu pedido está vacío. Agrega opciones desde el comparador.</div>';
  for (const id of ['save-order', 'export-order', 'print-order', 'clear-cart'])
    $('#' + id).disabled = !cart.length;
}
function snapshot() {
  return [...grouped()].map(([id, items]) => ({
    provider_id: id,
    provider: providerName(id),
    lines: items.map((x) => ({
      row: x.row,
      qty: x.qty,
      bulk: x.bulk && items.reduce((s, v) => s + v.qty, 0) >= 50,
      unit: unit(x, items),
      total: Math.round(unit(x, items) * x.qty * 100) / 100,
    })),
    total: items.reduce(
      (s, x) => s + Math.round(unit(x, items) * x.qty * 100) / 100,
      0,
    ),
  }));
}
function renderSaved() {
  $('#saved-orders').innerHTML = orders.length
    ? orders
        .map(
          (o) =>
            `<div class="history-row"><div><strong>Pedido ${esc(o.id.slice(0, 8))}</strong><small>${date(o.created_at)} · ${o.contenido.length} proveedores · ${money(o.contenido.reduce((s, g) => s + g.total, 0))}</small></div><button class="secondary" data-order="${o.id}">Abrir copia</button></div>`,
        )
        .join('')
    : '<p class="muted">Todavía no has guardado pedidos.</p>';
}
function download(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const csvCell = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
function exportOrder() {
  const out = [
    [
      'Proveedor',
      'Codigo',
      'Descripcion',
      'Piezas',
      'Precio unitario MXN',
      'Subtotal MXN',
      'Tarifa',
      'Archivo fuente',
      'Fecha lista',
      'Existencias reportadas',
    ],
  ];
  for (const g of snapshot())
    for (const x of g.lines)
      out.push([
        g.provider,
        x.row.code,
        x.row.description,
        x.qty,
        x.unit,
        x.total,
        x.bulk ? 'Mayoreo confirmado' : x.row.priceLabel,
        x.row.filename,
        x.row.date || x.row.date_label,
        x.row.stock,
      ]);
  download(
    'pedido-llantas.csv',
    '\uFEFF' + out.map((r) => r.map(csvCell).join(',')).join('\r\n'),
  );
}
function printOrder() {
  const w = window.open('', '_blank');
  if (!w) {
    $('#cart-status').textContent =
      'Permite ventanas emergentes para imprimir.';
    return;
  }
  w.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Pedido de llantas</title><style>body{font:14px system-ui;margin:40px;color:#24312b}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #ddd}h2{margin-top:36px}p{line-height:1.6}small{color:#666}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Imprimir / Guardar PDF</button><h1>Pedido de llantas</h1><p>${esc(date(new Date().toISOString()))}</p>${snapshot()
      .map(
        (g) =>
          `<h2>${esc(g.provider)}</h2><table><thead><tr><th>Código / descripción</th><th>Piezas</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${g.lines.map((x) => `<tr><td>${esc(x.row.code || 'Sin código')}<br>${esc(x.row.description)}<br><small>${esc(x.row.filename)} · ${esc(x.row.date || x.row.date_label || 'Fecha por confirmar')} · ${esc(stockText(x.row, x.qty))}</small></td><td>${x.qty}</td><td>${money(x.unit)}</td><td>${money(x.total)}</td></tr>`).join('')}</tbody></table><p><strong>Total ${money(g.total)} MXN</strong></p>`,
      )
      .join(
        '',
      )}<p>Precios de las listas, sujetos a confirmación de disponibilidad, IVA y flete. Este documento no envía ni reserva el pedido.</p></body></html>`,
  );
  w.document.close();
}
function review() {
  const r = preview.rows;
  $('#import-summary').textContent =
    `${r.length} productos. ${preview.warnings.join(' ')}`;
  $('#review-rows').innerHTML = r
    .map(
      (x, i) =>
        `<tr>${['code', 'description', 'brand', 'model', 'stock', 'price', 'bulk'].map((k) => `<td><input aria-label="${k} fila ${i + 1}" data-row="${i}" data-field="${k}" ${['stock', 'price', 'bulk'].includes(k) ? 'type="number" min="0" step="' + (k === 'stock' ? '1' : '0.0001') + '"' : 'type="text"'} value="${esc(k === 'bulk' ? x.tiers.find((t) => t.rule === '50_pedido')?.price || '' : (x[k] ?? ''))}" ${k === 'bulk' && $('#import-provider').value !== PROVIDERS[2].id ? 'disabled' : ''}></td>`).join('')}</tr>`,
    )
    .join('');
  $('#review-confirm').checked = false;
  $('#publish').disabled = true;
  $('#import-review').hidden = false;
}
function bind() {
  $('#provider-filter').innerHTML =
    '<option value="">Todos los proveedores</option>' +
    options(PROVIDERS.map((p) => [p.id, p.name]));
  $('#import-provider').innerHTML = options(
    PROVIDERS.map((p) => [p.id, p.name]),
  );
  document
    .querySelectorAll('[data-page]')
    .forEach((b) => (b.onclick = () => page(b.dataset.page)));
  $('#show-password').onclick = () => {
    const show = $('#password').type === 'password';
    $('#password').type = show ? 'text' : 'password';
    $('#show-password').textContent = show ? 'Ocultar' : 'Mostrar';
    $('#show-password').setAttribute('aria-pressed', String(show));
  };
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#login-button').disabled = true;
    $('#login-status').textContent = 'Entrando…';
    try {
      const { data, error } = await db.auth.signInWithPassword({
        email: $('#email').value.trim(),
        password: $('#password').value,
      });
      if (error) throw error;
      await authorize(data.user);
      $('#login-status').textContent = '';
    } catch (e) {
      $('#login-status').textContent =
        e.code === 'invalid_credentials'
          ? 'Correo o contraseña incorrectos.'
          : e.message;
    } finally {
      $('#login-button').disabled = false;
    }
  };
  $('#logout').onclick = async () => {
    if (
      cart.length &&
      !confirm('Hay un borrador sin guardar. ¿Cerrar sesión y descartarlo?')
    )
      return;
    const { error } = await db.auth.signOut({ scope: 'local' });
    if (error) {
      globalStatus('No se pudo cerrar sesión: ' + error.message);
      return;
    }
    resetPrivate();
  };
  $('#refresh').onclick = load;
  $('#search-form').onsubmit = (e) => {
    e.preventDefault();
    renderSearch();
  };
  let debounce;
  $('#query').oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderSearch(), 180);
  };
  for (const id of [
    'brand-filter',
    'provider-filter',
    'stock-filter',
    'quantity',
    'mode',
    'wholesale',
  ])
    $('#' + id).onchange = () => renderSearch();
  $('#exact-filter').onchange = () => renderSearch(false);
  $('#more').onclick = () => {
    limit += 30;
    renderResults();
  };
  $('#results').onclick = (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.add) add(b.dataset.add);
    if (b?.dataset.detail) details(b.dataset.detail);
  };
  $('#close-detail').onclick = () => $('#detail').close();
  $('#cart').onchange = (e) => {
    if (e.target.dataset.qty !== undefined) {
      const i = Number(e.target.dataset.qty);
      cart[i].qty = Math.max(
        1,
        Math.min(9999, Math.trunc(Number(e.target.value) || 1)),
      );
    }
    if (e.target.dataset.bulk) {
      for (const x of cart.filter(
        (x) => x.row.provider_id === e.target.dataset.bulk,
      ))
        x.bulk = e.target.checked;
    }
    renderCart();
  };
  $('#cart').onclick = (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) {
      cart.splice(Number(b.dataset.remove), 1);
      renderCart();
    }
  };
  $('#clear-cart').onclick = () => {
    if (confirm('¿Vaciar el borrador? Los pedidos guardados se conservan.')) {
      cart = [];
      renderCart();
    }
  };
  $('#save-order').onclick = async () => {
    $('#save-order').disabled = true;
    $('#cart-status').textContent = 'Guardando…';
    try {
      const { data, error } = await db
        .from('ordenes_comparador')
        .insert({ contenido: snapshot() })
        .select()
        .single();
      if (error) throw error;
      orders.unshift(data);
      renderSaved();
      $('#cart-status').textContent =
        'Pedido guardado. No se ha enviado al proveedor.';
    } catch (e) {
      $('#cart-status').textContent = 'No se guardó: ' + e.message;
    } finally {
      $('#save-order').disabled = false;
    }
  };
  $('#saved-orders').onclick = (e) => {
    const id = e.target.closest('[data-order]')?.dataset.order;
    if (!id) return;
    if (
      cart.length &&
      !confirm('¿Reemplazar el borrador por una copia de este pedido?')
    )
      return;
    const o = orders.find((o) => o.id === id);
    cart = o.contenido.flatMap((g) =>
      g.lines.map((x) => ({
        row: structuredClone(x.row),
        qty: x.qty,
        bulk: x.bulk,
      })),
    );
    renderCart();
    $('#cart-status').textContent =
      'Copia abierta con los precios guardados. Revisa si hay listas nuevas.';
  };
  $('#export-order').onclick = exportOrder;
  $('#print-order').onclick = printOrder;
  const invalidate = () => {
    preview = null;
    $('#import-review').hidden = true;
    $('#review-rows').replaceChildren();
    $('#import-status').textContent = '';
  };
  $('#import-provider').onchange = invalidate;
  $('#import-file').onchange = invalidate;
  $('#template').onclick = () =>
    download(
      'formato-lista.csv',
      '\uFEFFcodigo,descripcion,marca,modelo,existencia,precio,mayoreo\r\n',
    );
  $('#import-form').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#import-file').files[0];
    if (!file) return;
    const p = PROVIDERS.find((p) => p.id === $('#import-provider').value);
    preview = null;
    $('#import-review').hidden = true;
    $('#read-file').disabled = true;
    $('#import-provider').disabled = true;
    $('#import-file').disabled = true;
    $('#import-status').textContent = 'Leyendo archivo…';
    try {
      previewExpected = lists.find((l) => l.provider_id === p.id)?.id || null;
      preview = await readFile(
        file,
        p,
        (t) => ($('#import-status').textContent = t),
      );
      preview.filename = file.name;
      preview.provider = p.id;
      review();
      $('#import-status').textContent =
        'Archivo leído. Revisa la tabla antes de publicar.';
    } catch (e) {
      $('#import-status').textContent = e.message;
    } finally {
      $('#read-file').disabled = false;
      $('#import-provider').disabled = false;
      $('#import-file').disabled = false;
    }
  };
  $('#review-rows').oninput = (e) => {
    if (!e.target.dataset.field) return;
    const x = preview.rows[Number(e.target.dataset.row)],
      k = e.target.dataset.field,
      v = e.target.value;
    if (k === 'bulk') {
      x.tiers = x.tiers.filter((t) => t.rule !== '50_pedido');
      if (number(v) > 0)
        x.tiers.push({
          label: 'Mayoreo desde 50 piezas (confirmar)',
          price: number(v),
          rule: '50_pedido',
        });
    } else x[k] = ['stock', 'price'].includes(k) ? number(v) : v;
    $('#review-confirm').checked = false;
    $('#publish').disabled = true;
  };
  $('#review-confirm').onchange = () =>
    ($('#publish').disabled = !$('#review-confirm').checked);
  $('#publish').onclick = async () => {
    if (!preview || !$('#review-confirm').checked) return;
    $('#publish').disabled = true;
    $('#import-status').textContent = 'Guardando…';
    try {
      if (!$('#import-form').reportValidity())
        throw Error('Revisa el formulario.');
      for (const r of preview.rows) {
        if (!r.description.trim() || !r.brand.trim())
          throw Error('Todas las filas necesitan descripción y marca.');
        if (r.price !== null && r.price <= 0)
          throw Error('Precio inválido: deja vacío si no está indicado.');
      }
      const cleaned = preview.rows.map((r, i) =>
        finish({ ...r, id: `${r.code || 'ROW'}::${i}` }),
      );
      const { error } = await db.rpc('publicar_lista_comparador', {
        p_provider: preview.provider,
        p_filename: preview.filename,
        p_date: $('#import-date').value || null,
        p_rows: cleaned,
        p_warnings: preview.warnings,
        p_expected: previewExpected,
      });
      if (error) throw error;
      invalidate();
      $('#import-status').textContent =
        'Lista publicada. El comparador ya usa la nueva versión.';
      await load();
    } catch (e) {
      $('#import-status').textContent = 'No se publicó: ' + e.message;
      $('#publish').disabled = false;
    }
  };
}
export async function start() {
  setupSelection();
  bind();
  db = await connect();
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') resetPrivate();
  });
  $('#login-button').textContent = 'Entrar';
  $('#login-button').disabled = false;
  try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (data.session) await authorize(data.session.user);
  } catch (e) {
    $('#login-status').textContent = e.message;
  }
}