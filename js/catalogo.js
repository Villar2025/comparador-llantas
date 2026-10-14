export const PROVIDERS = [
    {
      id: '95edaa0e-acd1-45e4-89b7-9cc8c4d4e6f7',
      name: 'Futurama',
      kind: 'toyo',
    },
    {
      id: '3fc74154-817a-4982-89a9-c0fd03252cc3',
      name: 'Conve lanvigator',
      kind: 'lanvigator',
    },
    {
      id: '436a0ea2-c76a-457a-ae30-bf664e8a72a0',
      name: 'Yactyres',
      kind: 'yactyres',
    },
    {
      id: 'c3815de1-c2b2-42fd-82f6-7403808ac4e0',
      name: 'IMP TIRES',
      kind: 'imp',
    },
    {
      id: '4698beae-d592-4396-a684-f46d2047da9a',
      name: 'Reaco Triangle',
      kind: 'reaco',
    },
  ];
  export const norm = (v) =>
    String(v ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  export function number(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  export function sizeOf(text) {
    const s = norm(text);
    let m = s.match(
      /(?:LT\s*|P\s*)?(\d{2,3})[\/\s]+(\d{2,3})\s*(ZR|R|-)\s*(\d{2}(?:\.\d)?)/,
    );
    if (m)
      return {
        size: `${m[1]}/${m[2]}${m[3] === '-' ? '-' : 'R'}${m[4]}`,
        raw: m[0],
      };
    m = s.match(
      /(?:AT\s*|LT\s*)?(\d{2}(?:\.\d+)?)\s*X\s*(\d{1,2}(?:\.\d+)?)\s*(R|-)\s*(\d{1,2}(?:\.\d)?)/,
    );
    if (m)
      return { size: `${Number(m[1])}X${Number(m[2])}${m[3]}${m[4]}`, raw: m[0] };
    m = s.match(/(?:LT\s*)?(\d{2,3}(?:\.\d+)?)\s*R\s*(\d{2}(?:\.\d)?)/);
    if (m) return { size: `${m[1]}R${m[2]}`, raw: m[0] };
    m = s.match(/\b(\d{1,2}(?:\.\d+)?L?)\s*-\s*(\d{1,2}(?:\.\d)?)/);
    return m
      ? { size: `${m[1]}-${m[2]}`, raw: m[0] }
      : { size: 'POR REVISAR', raw: '' };
  }
  export function finish(row) {
    const parsed = sizeOf(row.description);
    row.size = parsed.size;
    row.brand = norm(row.brand).replace(/^SUMAXX TIRE$/, 'SUMAXX');
    row.model = norm(row.model || '');
    row.price = number(row.price);
    if (row.price !== null && row.price <= 0) row.price = null;
    row.stock = number(row.stock);
    if (row.stock !== null && (!Number.isInteger(row.stock) || row.stock < 0))
      throw Error(`Existencia inválida: ${row.code}`);
    row.tiers = (row.tiers || [])
      .filter((t) => number(t.price) > 0)
      .map((t) => ({ ...t, price: number(t.price) }));
    row.notes = row.notes || [];
    const d = norm(row.description);
    const spec = d.match(/\b(\d{2,3}(?:\/\d{2,3})?)\s*([A-Z])(?=\s|$|XL)/);
    row.spec = spec ? spec[1] + spec[2] : '';
    row.variant = [
      /\bLT|R\d+(?:\.\d)?LT/.test(d) ? 'LT' : '',
      /R\d+(?:\.\d)?C\b/.test(d) ? 'C' : '',
      d.includes('ZR') ? 'ZR' : '',
      d.includes('XL') ? 'XL' : '',
      d.match(/\b(?:TT|TL)\b/)?.[0] || '',
      d.match(/\d+\s*PR\b/)?.[0] || '',
      d.includes('LETRA BLANCA') ? 'LETRA BLANCA' : '',
    ]
      .filter(Boolean)
      .join(' ');
    row.exact =
      row.spec && row.model && row.size !== 'POR REVISAR'
        ? [row.size, row.brand, row.model, row.spec, row.variant].join('|')
        : '';
    if (row.size === 'POR REVISAR')
      row.notes.push('Medida incompleta: revisar descripción original.');
    row.id = row.id || row.code;
    return row;
  }
  function base(code, description, source) {
    return {
      code: String(code ?? '').trim(),
      description: String(description ?? '').trim(),
      source,
      notes: [],
      tiers: [],
      stock: null,
      price: null,
      tax: 'Por confirmar',
    };
  }
  function modelAfter(description, brand) {
    let s = norm(description);
    const p = sizeOf(s);
    s = s.replace(p.raw, '').trim();
    const b = norm(brand).replace(/ TBR$| AGRICOLA$/, '');
    const at = s.indexOf(b);
    if (at >= 0) s = s.slice(0, at) + ' ' + s.slice(at + b.length);
    return s
      .replace(/\b\d{2,3}(?:\/\d{2,3})?\s*[A-Z](?=\s|$)/g, '')
      .replace(/\b(?:XL|TL|TT|\d+\s*PR)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  export function parseWorkbook(sheets, kind) {
    let out = [];
    const warnings = [];
    let skipped = 0;
    if (kind === 'toyo') {
      const entry = Object.entries(sheets).find(([, rs]) =>
        rs.some((r) => r.some((v) => norm(v) === 'PRECIO NETO MXN')),
      );
      if (!entry)
        throw Error('Este archivo no tiene el formato TOYO de Futurama.');
      const [sheet, rs] = entry;
      const hi = rs.findIndex((r) => r.some((v) => norm(v) === 'SKU'));
      const h = rs[hi].map(norm);
      const ix = (n) => h.indexOf(n);
      if (
        ['SKU', 'DESCRIPCION', 'STOCK DISPONIBLE', 'PRECIO NETO MXN'].some(
          (n) => ix(n) < 0,
        )
      )
        throw Error('Faltan columnas de Futurama.');
      rs.slice(hi + 1).forEach((r, i) => {
        if (!r[ix('DESCRIPCION')]) return;
        const x = base(
          r[ix('SKU')],
          r[ix('DESCRIPCION')],
          `${sheet} · fila ${hi + i + 2}`,
        );
        x.brand = 'TOYO';
        x.model = modelAfter(x.description, 'TOYO');
        x.model = x.model.replace(/^\d{2,3}[A-Z]\s*/, '');
        x.stock = r[ix('STOCK DISPONIBLE')];
        x.price = r[ix('PRECIO NETO MXN')];
        x.priceLabel = 'Precio neto MXN';
        x.tax = 'Neto según archivo';
        x.notes = ['No aplica descuentos financieros.'];
        out.push(finish(x));
      });
    } else if (kind === 'lanvigator') {
      const entry = Object.entries(sheets).find(([, rs]) =>
        rs.some((r) => r.some((v) => norm(v) === 'MAYOREO')),
      );
      if (!entry) throw Error('No se reconoce la columna MAYOREO de Lanvigator.');
      const [sheet, rs] = entry;
      const hi = rs.findIndex((r) => r.some((v) => norm(v) === 'MAYOREO'));
      const h = rs[hi].map(norm);
      const di = h.indexOf('DESCRIPCION'),
        pi = h.indexOf('MAYOREO');
      rs.slice(hi + 1).forEach((r, i) => {
        if (!r[di]) return;
        const x = base(r[0], r[di], `${sheet} · fila ${hi + i + 2}`);
        x.brand = 'LANVIGATOR';
        x.model = modelAfter(x.description, x.brand);
        x.price = r[pi];
        x.priceLabel = 'Mayoreo publicado';
        x.notes = ['La lista no indica existencias ni mínimo de mayoreo.'];
        out.push(finish(x));
      });
    } else if (kind === 'imp') {
      const entry = Object.entries(sheets).find(([, rs]) =>
        rs.some((r) => r.some((v) => norm(v) === 'EXISTENCIA2')),
      );
      if (!entry) throw Error('No se reconoce el formato IMP TIRES.');
      const [sheet, rs] = entry;
      const hi = rs.findIndex((r) => r.some((v) => norm(v) === 'EXISTENCIA2'));
      const h = rs[hi].map(norm),
        ix = (n) => h.indexOf(n);
      rs.slice(hi + 1).forEach((r, i) => {
        if (!r[ix('DESCRIPCION')]) return;
        if (
          ['RINES', 'AUTO', 'PICKUP'].includes(norm(r[ix('LINEA')])) ||
          norm(r[ix('DESCRIPCION')]).startsWith('CONTENEDOR')
        ) {
          skipped++;
          return;
        }
        const x = base(
          r[ix('ARTICULO')],
          r[ix('DESCRIPCION')],
          `${sheet} · fila ${hi + i + 2}`,
        );
        x.brand = r[ix('MARCA')];
        x.model = modelAfter(x.description, x.brand);
        x.stock = r[ix('EXISTENCIA2')];
        x.price = r[7];
        x.priceLabel = h[7];
        x.notes = [
          `Existencia ${r[4]}; apartados ${r[5]}; disponible (Existencia2) ${r[6]}.`,
          'Niveles por importe: confirmar si corresponden al pedido o a la cuenta del cliente.',
        ];
        x.tiers = [8, 9, 10, 11].map((j) => ({
          label: String(rs[hi][j]),
          price: r[j],
          rule: 'confirmar',
        }));
        out.push(finish(x));
      });
    } else if (kind === 'reaco') {
      const key = Object.keys(sheets).find((k) => norm(k) === 'GENERAL');
      if (!key) throw Error('El archivo Reaco debe incluir la hoja GENERAL.');
      const rs = sheets[key],
        hi = rs.findIndex((r) => norm(r[0]) === 'CODIGO');
      if (hi < 0) throw Error('No se encontró el encabezado GENERAL.');
      rs.slice(hi + 1).forEach((r, i) => {
        if (!r[0] || !r[1] || !r[4] || number(r[5]) === null) return;
        const x = base(
          r[0],
          String(r[1]) + ' ' + String(r[2]),
          `${key} · fila ${hi + i + 2}`,
        );
        x.brand = r[4];
        x.model = r[2];
        x.price = r[6];
        x.priceLabel = 'Pieza';
        x.tax = 'Neto según archivo';
        x.warehouses = String(r[11] || '');
        const parts = [
          ...x.warehouses.matchAll(/([A-Z0-9]+):\s*(\d+(?:\.\d+)?)/g),
        ];
        const total = [7, 8, 9, 10].reduce((s, j) => s + (number(r[j]) || 0), 0);
        x.stock = parts.length
          ? parts.reduce((s, m) => s + Number(m[2]), 0)
          : total;
        if (parts.length && x.stock !== total)
          x.notes.push(
            `Odoo reporta ${x.stock}; las cuatro columnas de almacén suman ${total}. Confirmar disponibilidad.`,
          );
        x.tiers = [{ label: 'Contenedor', price: r[5], rule: 'confirmar' }];
        x.notes.push(
          'Contenedor: condición no especificada; no se aplica automáticamente.',
        );
        out.push(finish(x));
      });
      warnings.push(
        'Se usa GENERAL (precio PIEZA y existencias Odoo). Las otras hojas no se suman ni sustituyen esta lista.',
      );
    } else throw Error('Para Yactyres utiliza PDF o CSV.');
    const seen = new Map();
    out = out.filter((x) => {
      const key = JSON.stringify([
        x.code,
        x.description,
        x.price,
        x.stock,
        x.tiers,
      ]);
      if (seen.has(key)) {
        skipped++;
        return false;
      }
      seen.set(key, true);
      return true;
    });
    const codes = new Map();
    for (const x of out) codes.set(x.code, (codes.get(x.code) || 0) + 1);
    out.forEach((x, i) => {
      x.id = `${x.code}::${i}`;
      if (codes.get(x.code) > 1)
        x.notes.push(
          'Código repetido con diferencias en la fuente: confirmar antes de pedir.',
        );
    });
    if (!out.length) throw Error('No se encontraron llantas.');
    if (skipped)
      warnings.push(
        `${skipped} filas excluidas (rines, contenedores o duplicados idénticos).`,
      );
    return { rows: out, warnings };
  }
  export function priceFor(row, wholesale = false) {
    return wholesale && row.tiers.find((t) => t.rule === '50_pedido')
      ? row.tiers.find((t) => t.rule === '50_pedido').price
      : row.price;
  }
  export function searchRows(
    rows,
    {
      query = '',
      brand = '',
      provider = '',
      stock = 'all',
      qty = 1,
      exact = '',
      wholesale = false,
    } = {},
  ) {
    const q = norm(query).replace(/[^A-Z0-9.]/g, '');
    return rows
      .filter(
        (r) =>
          (!q ||
            norm([r.size, r.description, r.code, r.brand, r.model].join(' '))
              .replace(/[^A-Z0-9.]/g, '')
              .includes(q)) &&
          (!brand || r.brand === brand) &&
          (!provider || r.provider_id === provider) &&
          (!exact || r.exact === exact) &&
          (stock === 'all' ||
            (stock === 'enough'
              ? r.stock !== null && r.stock >= qty
              : r.stock !== null && r.stock > 0)),
      )
      .sort(
        (a, b) =>
          (priceFor(a, wholesale) ?? Infinity) -
            (priceFor(b, wholesale) ?? Infinity) ||
          a.description.localeCompare(b.description),
      );
  }