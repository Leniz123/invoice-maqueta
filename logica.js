// Datos de ejemplo y cálculos de la maqueta de InVoice.
// Todo es ficticio: empresa, clientes y documentos. Sin datos reales de nadie.
(function (raiz) {
  const IVA = 0.19;

  function formatoCLP(n) {
    const abs = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (n < 0 ? '−$' : '$') + abs;
  }

  function dvRut(cuerpo) {
    let suma = 0, mul = 2;
    for (const d of String(cuerpo).split('').reverse()) {
      suma += Number(d) * mul;
      mul = mul === 7 ? 2 : mul + 1;
    }
    const r = 11 - (suma % 11);
    return r === 11 ? '0' : r === 10 ? 'K' : String(r);
  }

  function formatoRut(cuerpo) {
    return String(cuerpo).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dvRut(cuerpo);
  }

  // Uno de los dos: el neto (y se suma el IVA) o el total (que ya trae el IVA).
  function calcularTotales(neto, total) {
    if (neto != null) {
      const iva = Math.round(neto * IVA);
      return { neto, iva, total: neto + iva };
    }
    const n = Math.round(total / (1 + IVA));
    return { neto: n, iva: total - n, total };
  }

  function normalizar(texto) {
    return String(texto).toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[.\-\s]/g, '');
  }

  function textoBuscable(d) {
    return normalizar([
      d.cliente.nombre, formatoRut(d.cliente.rut), d.numero, d.total,
      d.items.map(i => i.desc).join(' '),
    ].join(' '));
  }

  function filtrarDocumentos(docs, filtro, texto) {
    const q = normalizar(texto || '');
    return docs.filter(d => {
      if (filtro === 'facturas' && d.tipo !== 'factura') return false;
      if (filtro === 'cotizaciones' && d.tipo !== 'cotizacion') return false;
      if (filtro === 'notas' && d.tipo !== 'nota') return false;
      if (filtro === 'porcobrar' && !(d.tipo === 'factura' && !d.pagada)) return false;
      return !q || textoBuscable(d).includes(q);
    });
  }

  const DIA = 86400000;
  const soloFecha = f => Date.UTC(f.getFullYear(), f.getMonth(), f.getDate());

  function resumenCobranza(docs, hoy) {
    const deudas = docs
      .filter(d => d.tipo === 'factura' && !d.pagada)
      .map(d => {
        const dias = Math.round((soloFecha(hoy) - soloFecha(d.vence)) / DIA);
        return { doc: d, vencido: dias > 0, dias };
      })
      .sort((a, b) => (b.vencido - a.vencido) || (b.dias - a.dias));
    const vencido = deudas.filter(x => x.vencido).reduce((s, x) => s + x.doc.total, 0);
    const total = deudas.reduce((s, x) => s + x.doc.total, 0);
    return { total, vencido, porVencer: total - vencido, deudas };
  }

  function resumenMes(docs, anio, mes) {
    const delMes = docs.filter(d => d.tipo !== 'cotizacion'
      && d.fecha.getFullYear() === anio && d.fecha.getMonth() === mes);
    return {
      facturado: delMes.reduce((s, d) => s + (d.tipo === 'nota' ? -d.total : d.total), 0),
      cantidad: delMes.length,
    };
  }

  // Lo vendido en cada uno de los `n` meses que terminan en `mesFin` (0 = enero).
  function ventasPorMes(docs, anio, mesFin, n) {
    const meses = [];
    for (let i = n - 1; i >= 0; i--) {
      const k = anio * 12 + mesFin - i;
      const a = Math.floor(k / 12), m = k % 12;
      meses.push({ anio: a, mes: m, total: resumenMes(docs, a, m).facturado });
    }
    return meses;
  }

  // Los `n` clientes que más compraron en el año; `pct` es sobre lo vendido a todos.
  function mejoresClientes(docs, anio, n) {
    const por = new Map();
    for (const d of docs) {
      if (d.tipo === 'cotizacion' || d.fecha.getFullYear() !== anio) continue;
      const x = por.get(d.cliente.id) || { cliente: d.cliente, total: 0 };
      x.total += d.tipo === 'nota' ? -d.total : d.total;
      por.set(d.cliente.id, x);
    }
    const lista = [...por.values()].sort((a, b) => b.total - a.total);
    const suma = lista.reduce((s, x) => s + x.total, 0) || 1;
    return lista.slice(0, n).map(x => Object.assign(x, { pct: 100 * x.total / suma }));
  }

  // IVA de las ventas del mes (débito fiscal): facturas menos notas de crédito.
  function ivaDelMes(docs, anio, mes) {
    const delMes = docs.filter(d => d.fecha.getFullYear() === anio && d.fecha.getMonth() === mes);
    const ivaFacturas = delMes.filter(d => d.tipo === 'factura').reduce((s, d) => s + d.iva, 0);
    const ivaNotas = delMes.filter(d => d.tipo === 'nota').reduce((s, d) => s + d.iva, 0);
    return { ivaFacturas, ivaNotas, debito: ivaFacturas - ivaNotas };
  }

  // Lectura simple de una venta escrita. En la versión real esto lo hace la IA.
  const GENERICAS = new Set(['comercial', 'transportes', 'constructora', 'ferreteria', 'agricola', 'ltda', 'spa']);
  function leerTexto(texto, clientes) {
    const plano = String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const palabras = new Set(plano.split(/[^a-z0-9]+/));
    const cliente = clientes.find(c => normalizarPalabras(c.nombre).some(p => p.length >= 4 && !GENERICAS.has(p) && palabras.has(p))) || null;
    const numeros = (plano.match(/\d{1,3}(?:\.\d{3})+|\d+/g) || []).map(n => Number(n.replace(/\./g, '')));
    let items = [];
    if (numeros.length) {
      const cant = numeros.length >= 2 ? numeros[0] : 1;
      const precio = numeros[numeros.length - 1];
      const m = texto.match(/\bpor\s+([^,\d]+)/i) || texto.match(/\d+\s+([^,\d]+?)\s+(?:a|de)\s+\$?\d/i);
      const desc = m ? m[1].trim() : 'Servicio';
      items = [{ desc: desc.charAt(0).toUpperCase() + desc.slice(1), cant, precio }];
    }
    let ivaIncluido = null;
    if (/iva incluido|con iva|incluye iva/.test(plano)) ivaIncluido = true;
    else if (/mas iva|\bneto\b|masiva/.test(plano)) ivaIncluido = false;
    const pago = /contado/.test(plano) ? 'Contado' : /30 dias/.test(plano) ? '30 días' : (cliente ? cliente.pago : 'Contado');
    return { cliente, items, ivaIncluido, pago };
  }
  const normalizarPalabras = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/);

  function ejemplo() {
    const f = (dia, mes) => new Date(2026, mes - 1, dia);
    const empresa = { nombre: 'Servicios Técnicos Altamar SpA', usuario: 'Andrés', rut: 76543210 };
    const c = {
      robles: { id: 'robles', nombre: 'Transportes Los Robles SpA', corto: 'Los Robles', rut: 77123456, giro: 'Transporte de carga', direccion: 'Av. Argentina 1240, Valparaíso', correo: 'pagos@losrobles.example', telefono: '+56 9 1111 2222', pago: 'Contado' },
      penalolen: { id: 'penalolen', nombre: 'Comercial Peñalolén SpA', corto: 'Comercial Peñalolén', rut: 76987654, giro: 'Comercio al por mayor', direccion: 'Av. Grecia 8735, Peñalolén', correo: 'compras@penalolen.example', telefono: '+56 9 3333 4444', pago: 'Contado' },
      andes: { id: 'andes', nombre: 'Constructora Andes Ltda.', corto: 'Constructora Andes', rut: 78555222, giro: 'Construcción', direccion: '5 Norte 455, Viña del Mar', correo: 'facturas@andes.example', telefono: '+56 9 5555 6666', pago: '30 días' },
      valle: { id: 'valle', nombre: 'Ferretería del Valle SpA', corto: 'Ferretería del Valle', rut: 77444111, giro: 'Ferretería', direccion: 'Freire 312, Quilpué', correo: 'pagos@delvalle.example', telefono: '+56 9 7777 8888', pago: '30 días' },
      sanpedro: { id: 'sanpedro', nombre: 'Agrícola San Pedro SpA', corto: 'Agrícola San Pedro', rut: 76321987, giro: 'Agrícola', direccion: 'Camino Lo Chaparro km 3, Limache', correo: 'admin@sanpedro.example', telefono: '+56 9 9999 0000', pago: '30 días' },
    };
    const docs = [];
    function doc(tipo, numero, cli, fecha, items, opciones) {
      const o = opciones || {};
      const neto = items.reduce((s, i) => s + i.cant * i.precio, 0);
      const t = calcularTotales(neto, null);
      const pago = o.pago || cli.pago;
      const vence = new Date(fecha.getTime() + (pago === '30 días' ? 30 : 0) * DIA);
      docs.push({
        id: tipo + numero, tipo, numero, cliente: cli, fecha, items,
        neto: t.neto, iva: t.iva, total: t.total, pago, vence,
        pagada: !!o.pagada, observacion: o.observacion || '',
      });
    }
    doc('factura', 9, c.robles, f(15, 10), [{ desc: 'Flete Valparaíso–Santiago', cant: 3, precio: 40000 }]);
    doc('cotizacion', 2, c.sanpedro, f(14, 10), [{ desc: 'Mantención de bombas de riego', cant: 4, precio: 75000 }]);
    doc('cotizacion', 1, c.penalolen, f(13, 10), [{ desc: 'Revisión de cámaras de frío', cant: 2, precio: 45000 }]);
    doc('factura', 8, c.penalolen, f(12, 10), [{ desc: 'Mantención de cámaras de frío', cant: 1, precio: 120000 }], { pagada: true });
    doc('factura', 7, c.andes, f(8, 10), [{ desc: 'Instalación eléctrica de faena', cant: 1, precio: 250000 }]);
    doc('nota', 1, c.robles, f(6, 10), [{ desc: 'Anula flete no realizado', cant: 1, precio: 20000 }]);
    doc('factura', 6, c.valle, f(5, 10), [{ desc: 'Reparación de tablero', cant: 1, precio: 60000 }], { pago: 'Contado' });
    doc('factura', 5, c.robles, f(5, 10), [{ desc: 'Flete Valparaíso–Santiago', cant: 3, precio: 40000 }], { pagada: true });
    doc('factura', 4, c.penalolen, f(2, 10), [{ desc: 'Mantención de cámaras de frío', cant: 1, precio: 100000 }], { pagada: true });
    doc('factura', 3, c.sanpedro, f(22, 9), [{ desc: 'Mantención de bombas de riego', cant: 2, precio: 75000 }]);
    doc('factura', 2, c.andes, f(15, 9), [{ desc: 'Mantención de equipos', cant: 3, precio: 85000 }], { pagada: true });
    doc('factura', 1, c.valle, f(3, 9), [{ desc: 'Instalación eléctrica', cant: 2, precio: 90000 }]);
    // Meses anteriores, ya pagados, para el análisis
    const pagada = { pagada: true };
    doc('factura', 0, c.penalolen, f(29, 9), [{ desc: 'Mantención de cámaras de frío', cant: 1, precio: 100000 }], pagada);
    doc('factura', 0, c.robles, f(26, 9), [{ desc: 'Flete Valparaíso–Santiago', cant: 2, precio: 40000 }], pagada);
    doc('factura', 0, c.andes, f(20, 8), [{ desc: 'Instalación eléctrica de faena', cant: 1, precio: 520000 }], pagada);
    doc('factura', 0, c.valle, f(12, 8), [{ desc: 'Reparación de tableros', cant: 2, precio: 85000 }], pagada);
    doc('factura', 0, c.robles, f(5, 8), [{ desc: 'Flete Valparaíso–Santiago', cant: 3, precio: 40000 }], pagada);
    doc('factura', 0, c.penalolen, f(24, 7), [{ desc: 'Mantención de cámaras de frío', cant: 1, precio: 150000 }], pagada);
    doc('factura', 0, c.andes, f(15, 7), [{ desc: 'Mantención de equipos', cant: 1, precio: 280000 }], pagada);
    doc('factura', 0, c.sanpedro, f(8, 7), [{ desc: 'Mantención de bombas de riego', cant: 2, precio: 75000 }], pagada);
    doc('factura', 0, c.robles, f(26, 6), [{ desc: 'Flete Valparaíso–Santiago', cant: 2, precio: 40000 }], pagada);
    doc('factura', 0, c.andes, f(16, 6), [{ desc: 'Instalación eléctrica de faena', cant: 1, precio: 450000 }], pagada);
    doc('factura', 0, c.valle, f(9, 6), [{ desc: 'Instalación eléctrica', cant: 2, precio: 90000 }], pagada);
    doc('factura', 0, c.penalolen, f(27, 5), [{ desc: 'Revisión de cámaras de frío', cant: 1, precio: 60000 }], pagada);
    doc('factura', 0, c.robles, f(19, 5), [{ desc: 'Flete Valparaíso–Santiago', cant: 4, precio: 40000 }], pagada);
    doc('factura', 0, c.andes, f(11, 5), [{ desc: 'Mantención de equipos', cant: 1, precio: 380000 }], pagada);
    // Las facturas se numeran en orden de fecha, como en el SII
    docs.filter(d => d.tipo === 'factura')
      .map((d, i) => ({ d, i }))
      .sort((a, b) => a.d.fecha - b.d.fecha || a.i - b.i)
      .forEach((x, k) => { x.d.numero = k + 1; x.d.id = 'factura' + (k + 1); });
    return { empresa, clientes: Object.values(c), documentos: docs, hoy: f(15, 10) };
  }

  const Logica = { IVA, formatoCLP, dvRut, formatoRut, calcularTotales, normalizar, filtrarDocumentos, resumenCobranza, resumenMes, ventasPorMes, mejoresClientes, ivaDelMes, leerTexto, ejemplo };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logica;
  else raiz.Logica = Logica;
})(typeof window !== 'undefined' ? window : globalThis);
