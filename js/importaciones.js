import { parseWorkbook, finish, number, norm } from './catalogo.js';
async function script(src, name) {
  if (globalThis[name]) return globalThis[name];
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () =>
      reject(
        Error('No se pudo cargar el lector. Revisa Internet o utiliza CSV.'),
      );
    document.head.append(s);
  });
  return globalThis[name];
}
export async function readFile(file, provider, status) {
  if (file.size > 20 * 1024 * 1024) throw Error('El archivo supera 20 MB.');
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    if (provider.kind !== 'yactyres')
      throw Error(
        'El lector PDF está preparado para las tablas Yactyres. Para otro diseño utiliza el formato CSV.',
      );
    return readPDF(file, status);
  }
  if (!['xls', 'xlsx', 'csv'].includes(ext))
    throw Error('Selecciona Excel, PDF o CSV.');
  const XLSX = await script('./vendor/xlsx.full.min.js', 'XLSX');
  const book =
    ext === 'csv'
      ? XLSX.read(await file.text(), { type: 'string', raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheets = Object.fromEntries(
    book.SheetNames.map((n) => [
      n,
      XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, defval: null }),
    ]),
  );
  if (ext === 'csv') {
    const rs = Object.values(sheets)[0];
    const h = rs[0].map(norm);
    const names = [
      'CODIGO',
      'DESCRIPCION',
      'MARCA',
      'MODELO',
      'EXISTENCIA',
      'PRECIO',
      'MAYOREO',
    ];
    if (names.some((k) => !h.includes(k)))
      throw Error('El CSV debe usar las columnas del formato descargable.');
    const rows = rs
      .slice(1)
      .filter((r) => r.some((v) => v !== null && v !== ''))
      .map((r, i) => {
        const v = (k) => r[h.indexOf(k)];
        if (!v('DESCRIPCION') || !v('MARCA'))
          throw Error(`Fila ${i + 2}: falta descripción o marca.`);
        return finish({
          id: `CSV-${i + 1}`,
          code: String(v('CODIGO') || ''),
          description: String(v('DESCRIPCION')),
          brand: String(v('MARCA')),
          model: String(v('MODELO') || ''),
          stock: number(v('EXISTENCIA')),
          price: number(v('PRECIO')),
          priceLabel: 'Precio CSV',
          tax: 'Por confirmar',
          source: `CSV · fila ${i + 2}`,
          tiers:
            provider.kind === 'yactyres' && number(v('MAYOREO')) > 0
              ? [
                  {
                    label: 'Mayoreo desde 50 piezas (confirmar)',
                    price: number(v('MAYOREO')),
                    rule: '50_pedido',
                  },
                ]
              : [],
          notes: [],
        });
      });
    if (!rows.length) throw Error('El CSV está vacío.');
    return {
      rows,
      warnings: [
        'Datos de CSV: verifica IVA, condiciones y fecha de vigencia.',
      ],
    };
  }
  return parseWorkbook(sheets, provider.kind);
}
async function readPDF(file, status) {
  status('Preparando lector PDF…');
  const pdfjs = await import('../vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../vendor/pdf.worker.mjs',
    import.meta.url,
  ).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() })
    .promise;
  if (pdf.numPages > 12) {
    await pdf.destroy();
    throw Error('El lector admite hasta 12 páginas por PDF.');
  }
  let worker;
  const rows = [];
  const warnings = [
    'Lectura automática de PDF: revisa cada fila contra el original antes de publicar.',
  ];
  try {
    const T = await script('./vendor/tesseract.min.js', 'Tesseract');
    worker = await T.createWorker('eng', 1, {
      workerPath: new URL('../vendor/tesseract.worker.min.js', import.meta.url)
        .href,
      corePath: new URL('../vendor/tesseract-core.wasm.js', import.meta.url)
        .href,
      langPath: new URL('../vendor/', import.meta.url).href,
    });
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p),
        vp = page.getViewport({ scale: 3.3 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const W = canvas.width,
        H = canvas.height,
        pixels = ctx.getImageData(0, 0, W, H).data;
      // Bordes horizontales de la tabla: definen las filas incluso si el OCR omite una cifra.
      const detected = [];
      for (let y = Math.floor(H * 0.17); y < H * 0.88; y++) {
        let dark = 0,
          count = 0;
        for (let x = Math.floor(W * 0.21); x < W * 0.93; x += 3) {
          const i = (y * W + x) * 4;
          count++;
          if ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 210) dark++;
        }
        if (dark / count > 0.65) detected.push(y);
      }
      const clusters = [];
      for (const y of detected) {
        const last = clusters.at(-1);
        if (last && y - last.at(-1) <= 4) last.push(y);
        else clusters.push([y]);
      }
      let borders = clusters.map((c) =>
        Math.round(c.reduce((s, y) => s + y, 0) / c.length),
      );
      borders = borders.filter((y, i) => !i || y - borders[i - 1] > 8);
      const intervals = [];
      for (let i = 0; i < borders.length - 1; i++) {
        const height = borders[i + 1] - borders[i];
        if (height > H * 0.015 && height < H * 0.05)
          intervals.push([borders[i], borders[i + 1]]);
      }
      if (intervals.length < 10)
        throw Error(
          'El diseño del PDF no coincide con la tabla Yactyres. Utiliza el formato CSV para conservar todas las filas.',
        );
      const cols = [
        [0.13, 0.191],
        [0.2, 0.384],
        [0.397, 0.574],
        [0.584, 0.699],
        [0.713, 0.818],
        [0.838, 0.935],
      ];
      const extracted = [];
      for (let c = 0; c < cols.length; c++) {
        status(`PDF: página ${p}/${pdf.numPages}, columna ${c + 1}/6…`);
        const left = Math.floor(cols[c][0] * W),
          top = intervals[0][0] + 3,
          width = Math.floor((cols[c][1] - cols[c][0]) * W),
          height = intervals.at(-1)[1] - top - 3;
        const crop = document.createElement('canvas');
        crop.width = width;
        crop.height = height;
        const cc = crop.getContext('2d');
        cc.drawImage(canvas, left, top, width, height, 0, 0, width, height);
        cc.fillStyle = 'white';
        for (const y of borders) cc.fillRect(0, y - top - 3, width, 7);
        await worker.setParameters({
          tessedit_char_whitelist:
            c === 0 ? '0123456789' : c >= 4 ? '0123456789.,$' : '',
        });
        const { data } = await worker.recognize(crop);
        extracted[c] = (data.lines || []).map((line) => ({
          text: line.text.trim(),
          y: (line.bbox.y0 + line.bbox.y1) / 2 + top,
        }));
        crop.width = crop.height = 0;
      }
      for (let i = 0; i < intervals.length; i++) {
        const [top, bottom] = intervals[i];
        const cell = (c) =>
          extracted[c]
            .filter((t) => t.y > top && t.y < bottom)
            .sort((a, b) => a.y - b.y)
            .map((t) => t.text)
            .join(' ')
            .trim();
        const stock = number(cell(0)),
          description = cell(1),
          model = cell(2),
          brand = cell(3),
          price = number(cell(4)),
          bulk = number(cell(5));
        if (!description || !brand || price === null || stock === null)
          warnings.push(
            `Página ${p}, fila ${i + 1}: lectura incompleta; corregir antes de guardar.`,
          );
        rows.push(
          finish({
            id: `PDF-${p}-${i + 1}`,
            code: '',
            description,
            brand,
            model,
            stock,
            price,
            priceLabel: 'Menudeo',
            tax: 'Por confirmar',
            source: `PDF · página ${p}, fila ${i + 1}`,
            tiers:
              bulk > 0
                ? [
                    {
                      label: 'Mayoreo desde 50 piezas (confirmar)',
                      price: bulk,
                      rule: '50_pedido',
                    },
                  ]
                : [],
            notes: [
              'Extraído por lectura automática; confirmar contra el PDF.',
            ],
          }),
        );
      }
      canvas.width = canvas.height = 0;
    }
  } finally {
    if (worker) await worker.terminate();
    await pdf.destroy();
  }
  return { rows, warnings };
}