// server.js — API REST + servidor PWA para Bixie Inventario
// Rutas públicas (catálogo), rutas de pedidos (WhatsApp flow) y panel admin.

const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const { db, hashPassword, verifyPassword, generarSku, generarFolio, limpiarImagen } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;
const WA_NUMBER = process.env.WA_NUMBER || '525665296109'; // número de Bixie sin + ni espacios

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ══════════════════════════════════════════════════════════════
// AUTH — sesiones en memoria
// ══════════════════════════════════════════════════════════════
const sesiones = new Map();
const nuevoToken = () => crypto.randomBytes(24).toString('hex');

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && sesiones.get(token);
  if (!s) return res.status(401).json({ error: 'Sesión no válida. Inicia sesión.' });
  req.user  = s;
  req.token = token;
  next();
}
function soloAdmin(req, res, next) {
  if (req.user.rol !== 'admin')
    return res.status(403).json({ error: 'Requiere permiso de administrador.' });
  next();
}

// Login
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get((usuario||'').trim());
  if (!u || !verifyPassword(password||'', u.password))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  const token = nuevoToken();
  const datos = { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol };
  sesiones.set(token, datos);
  res.json({ token, usuario: datos });
});

app.get('/api/me', auth, (req, res) => res.json({ usuario: req.user }));

app.post('/api/logout', auth, (req, res) => {
  sesiones.delete(req.token);
  res.json({ ok: true });
});

app.post('/api/cambiar-password', auth, (req, res) => {
  const { actual, nueva } = req.body || {};
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!verifyPassword(actual||'', u.password))
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  if (!nueva || nueva.length < 6)
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
  db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run(hashPassword(nueva), u.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
// PRODUCTOS — rutas PÚBLICAS (catálogo visible sin login)
// ══════════════════════════════════════════════════════════════

// Stock disponible = stock - stock_reservado
const stockDisponible = `MAX(0, stock - stock_reservado) AS stock_disponible`;

// Catálogo público — solo productos activos con stock disponible
app.get('/api/catalogo', (req, res) => {
  const { categoria, q } = req.query;
  let sql = `SELECT id, sku, nombre, descripcion, categoria, precio, stock,
               stock_reservado, ${stockDisponible}, imagen
             FROM productos WHERE activo = 1`;
  const params = [];
  if (categoria) { sql += ` AND categoria = ?`; params.push(categoria); }
  if (q) {
    sql += ` AND (nombre LIKE ? OR descripcion LIKE ? OR categoria LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY categoria, nombre`;
  res.json(db.prepare(sql).all(...params));
});

// Un producto público (para la vista detalle del carrusel)
app.get('/api/catalogo/:id', (req, res) => {
  const p = db.prepare(
    `SELECT id, sku, nombre, descripcion, categoria, precio, stock,
            stock_reservado, ${stockDisponible}, imagen
     FROM productos WHERE id = ? AND activo = 1`
  ).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(p);
});

// Categorías disponibles (para filtros del carrusel)
app.get('/api/catalogo/meta/categorias', (req, res) => {
  const rows = db.prepare(
    `SELECT DISTINCT categoria FROM productos WHERE activo = 1 AND categoria IS NOT NULL ORDER BY categoria`
  ).all();
  res.json(rows.map(r => r.categoria));
});

// ══════════════════════════════════════════════════════════════
// PEDIDOS — flujo WhatsApp
// ══════════════════════════════════════════════════════════════

// POST /api/pedidos — cliente genera pedido desde el catálogo.
// Reserva las unidades en stand-by hasta que admin confirme o cancele.
app.post('/api/pedidos', (req, res) => {
  const { producto_id, cantidad = 1, nombre_cliente, telefono_cliente, nota } = req.body || {};
  if (!producto_id) return res.status(400).json({ error: 'producto_id es obligatorio.' });
  const cant = Math.max(1, parseInt(cantidad) || 1);

  const crear = db.transaction(() => {
    const p = db.prepare(`SELECT * FROM productos WHERE id = ? AND activo = 1`).get(producto_id);
    if (!p) throw new Error('Producto no encontrado.');
    const disponible = p.stock - p.stock_reservado;
    if (disponible < cant)
      throw new Error(`Solo quedan ${disponible} unidad${disponible !== 1 ? 'es' : ''} disponibles.`);

    const folio = generarFolio();

    // Reservar (stand-by)
    db.prepare(`UPDATE productos SET stock_reservado = stock_reservado + ? WHERE id = ?`).run(cant, p.id);

    const pedidoId = db.prepare(
      `INSERT INTO pedidos (folio, producto_id, cantidad, nombre_cliente, telefono_cliente, nota, estado)
       VALUES (?,?,?,?,?,?,'stand_by')`
    ).run(folio, p.id, cant, nombre_cliente||null, telefono_cliente||null, nota||null).lastInsertRowid;

    db.prepare(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, pedido_id, nota)
       VALUES (?,?,?,?,?)`
    ).run(p.id, 'reserva', cant, pedidoId, `Reserva pedido ${folio}`);

    const prod = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(p.id);
    return { folio, pedidoId, producto: p, cantidad: cant, stock_disponible: prod.stock - prod.stock_reservado };
  });

  try {
    const resultado = crear();

    // Construir link de WhatsApp
    const prod = resultado.producto;
    const msg = encodeURIComponent(
      `🛍️ *Pedido Bixie*\n` +
      `Folio: ${resultado.folio}\n` +
      `Producto: ${prod.nombre} (${prod.categoria || ''})\n` +
      `Cantidad: ${resultado.cantidad}\n` +
      `Precio unitario: $${prod.precio.toFixed(2)} MXN\n` +
      `Total estimado: $${(prod.precio * resultado.cantidad).toFixed(2)} MXN\n` +
      (resultado.cantidad > 1 ? '' : '') +
      `\n¡Hola! Me gustaría apartar este producto. 😊`
    );
    const waLink = `https://wa.me/${WA_NUMBER}?text=${msg}`;

    res.status(201).json({ ...resultado, waLink });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Consultar pedido por folio (público — para que el admin comparta el link de estado)
app.get('/api/pedidos/:folio', (req, res) => {
  const p = db.prepare(
    `SELECT ped.*, prod.nombre AS producto_nombre, prod.imagen, prod.categoria
     FROM pedidos ped JOIN productos prod ON prod.id = ped.producto_id
     WHERE ped.folio = ?`
  ).get(req.params.folio);
  if (!p) return res.status(404).json({ error: 'Pedido no encontrado.' });
  res.json(p);
});

// ══════════════════════════════════════════════════════════════
// PANEL ADMIN — PEDIDOS
// ══════════════════════════════════════════════════════════════

// Listar pedidos (admin)
app.get('/api/admin/pedidos', auth, soloAdmin, (req, res) => {
  const { estado } = req.query;
  let sql = `SELECT ped.*, prod.nombre AS producto_nombre, prod.sku, prod.precio
             FROM pedidos ped JOIN productos prod ON prod.id = ped.producto_id`;
  const params = [];
  if (estado) { sql += ` WHERE ped.estado = ?`; params.push(estado); }
  sql += ` ORDER BY ped.creado_en DESC`;
  res.json(db.prepare(sql).all(...params));
});

// Confirmar pedido — descuenta inventario real, libera reserva
app.patch('/api/admin/pedidos/:id/confirmar', auth, soloAdmin, (req, res) => {
  const confirmar = db.transaction(() => {
    const ped = db.prepare(`SELECT * FROM pedidos WHERE id = ?`).get(req.params.id);
    if (!ped) throw new Error('Pedido no encontrado.');
    if (ped.estado !== 'stand_by') throw new Error(`El pedido ya está en estado "${ped.estado}".`);

    const prod = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(ped.producto_id);
    if (prod.stock < ped.cantidad)
      throw new Error(`Stock insuficiente: hay ${prod.stock} unidad(es) y el pedido pide ${ped.cantidad}.`);

    // Descuento real de inventario + liberar reserva
    db.prepare(
      `UPDATE productos SET stock = stock - ?, stock_reservado = MAX(0, stock_reservado - ?) WHERE id = ?`
    ).run(ped.cantidad, ped.cantidad, prod.id);

    db.prepare(
      `UPDATE pedidos SET estado='confirmado', actualizado_en=datetime('now','localtime') WHERE id = ?`
    ).run(ped.id);

    db.prepare(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, pedido_id, usuario_id, usuario, nota)
       VALUES (?,?,?,?,?,?,?)`
    ).run(prod.id, 'salida', ped.cantidad, ped.id, req.user.id, req.user.nombre,
      `Pedido confirmado ${ped.folio}`);

    return db.prepare(`SELECT * FROM pedidos WHERE id = ?`).get(ped.id);
  });
  try { res.json(confirmar()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Cancelar pedido — libera la reserva sin descontar stock
app.patch('/api/admin/pedidos/:id/cancelar', auth, soloAdmin, (req, res) => {
  const cancelar = db.transaction(() => {
    const ped = db.prepare(`SELECT * FROM pedidos WHERE id = ?`).get(req.params.id);
    if (!ped) throw new Error('Pedido no encontrado.');
    if (ped.estado === 'confirmado') throw new Error('No se puede cancelar un pedido ya confirmado.');
    if (ped.estado === 'cancelado') throw new Error('El pedido ya está cancelado.');

    db.prepare(
      `UPDATE productos SET stock_reservado = MAX(0, stock_reservado - ?) WHERE id = ?`
    ).run(ped.cantidad, ped.producto_id);

    db.prepare(
      `UPDATE pedidos SET estado='cancelado', actualizado_en=datetime('now','localtime') WHERE id = ?`
    ).run(ped.id);

    db.prepare(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, pedido_id, usuario_id, usuario, nota)
       VALUES (?,?,?,?,?,?,?)`
    ).run(ped.producto_id, 'liberacion', ped.cantidad, ped.id, req.user.id, req.user.nombre,
      `Pedido cancelado ${ped.folio}`);

    return db.prepare(`SELECT * FROM pedidos WHERE id = ?`).get(ped.id);
  });
  try { res.json(cancelar()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// PANEL ADMIN — PRODUCTOS
// ══════════════════════════════════════════════════════════════

// Listar todos (incluye inactivos)
app.get('/api/admin/productos', auth, soloAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT *, ${stockDisponible} FROM productos ORDER BY categoria, nombre`
  ).all();
  res.json(rows);
});

// Crear producto
app.post('/api/admin/productos', auth, soloAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.nombre?.trim()) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  let imagen;
  try { imagen = limpiarImagen(b.imagen); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const sku = (b.sku || '').trim() || generarSku();
  const existe = db.prepare(`SELECT id FROM productos WHERE sku = ?`).get(sku);
  if (existe) return res.status(409).json({ error: `Ya existe un producto con el SKU ${sku}` });

  const stock = Math.max(0, parseInt(b.stock) || 0);
  const id = db.prepare(
    `INSERT INTO productos (sku, nombre, descripcion, categoria, precio, stock, stock_minimo, imagen)
     VALUES (@sku,@nombre,@descripcion,@categoria,@precio,@stock,@stock_minimo,@imagen)`
  ).run({
    sku,
    nombre: b.nombre.trim(),
    descripcion: b.descripcion || null,
    categoria: b.categoria || 'otro',
    precio: parseFloat(b.precio) || 0,
    stock,
    stock_minimo: parseInt(b.stock_minimo) ?? 1,
    imagen,
  }).lastInsertRowid;

  if (stock > 0) {
    db.prepare(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, usuario_id, usuario, nota)
       VALUES (?,?,?,?,?,?)`
    ).run(id, 'entrada', stock, req.user.id, req.user.nombre, 'Stock inicial');
  }
  res.status(201).json(db.prepare(`SELECT *, ${stockDisponible} FROM productos WHERE id = ?`).get(id));
});

// Editar producto
app.put('/api/admin/productos/:id', auth, soloAdmin, (req, res) => {
  const prod = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(req.params.id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado.' });
  const b = req.body || {};
  let imagen = prod.imagen;
  if ('imagen' in b) {
    try { imagen = limpiarImagen(b.imagen); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }
  db.prepare(
    `UPDATE productos SET nombre=@nombre, descripcion=@descripcion, categoria=@categoria,
     precio=@precio, stock_minimo=@stock_minimo, imagen=@imagen, activo=@activo WHERE id=@id`
  ).run({
    id: prod.id,
    nombre:      b.nombre      ?? prod.nombre,
    descripcion: b.descripcion ?? prod.descripcion,
    categoria:   b.categoria   ?? prod.categoria,
    precio:      b.precio != null ? parseFloat(b.precio) : prod.precio,
    stock_minimo: b.stock_minimo != null ? parseInt(b.stock_minimo) : prod.stock_minimo,
    activo:      b.activo != null ? (b.activo ? 1 : 0) : prod.activo,
    imagen,
  });
  res.json(db.prepare(`SELECT *, ${stockDisponible} FROM productos WHERE id = ?`).get(prod.id));
});

// Ajuste de stock (entrada manual)
app.post('/api/admin/productos/:id/stock', auth, soloAdmin, (req, res) => {
  const { tipo, cantidad, nota } = req.body || {};
  if (!['entrada','ajuste'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser entrada o ajuste.' });
  const cant = parseInt(cantidad) || 0;
  if (cant === 0) return res.status(400).json({ error: 'cantidad no puede ser 0.' });

  const ajustar = db.transaction(() => {
    const prod = db.prepare(`SELECT * FROM productos WHERE id = ?`).get(req.params.id);
    if (!prod) throw new Error('Producto no encontrado.');
    const nuevoStock = tipo === 'entrada' ? prod.stock + cant : prod.stock + cant;
    if (nuevoStock < 0) throw new Error(`Stock resultante negativo (${nuevoStock}).`);
    db.prepare(`UPDATE productos SET stock = ? WHERE id = ?`).run(nuevoStock, prod.id);
    db.prepare(
      `INSERT INTO movimientos (producto_id, tipo, cantidad, usuario_id, usuario, nota)
       VALUES (?,?,?,?,?,?)`
    ).run(prod.id, tipo, cant, req.user.id, req.user.nombre, nota || null);
    return db.prepare(`SELECT *, ${stockDisponible} FROM productos WHERE id = ?`).get(prod.id);
  });
  try { res.json(ajustar()); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════
// PANEL ADMIN — REPORTES
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/reportes', auth, soloAdmin, (req, res) => {
  const total_productos = db.prepare(`SELECT COUNT(*) c FROM productos WHERE activo=1`).get().c;
  const total_unidades  = db.prepare(`SELECT COALESCE(SUM(stock),0) s FROM productos WHERE activo=1`).get().s;
  const reservados      = db.prepare(`SELECT COALESCE(SUM(stock_reservado),0) s FROM productos WHERE activo=1`).get().s;
  const valor_inventario = db.prepare(`SELECT COALESCE(SUM(stock*precio),0) v FROM productos WHERE activo=1`).get().v;
  const bajo_stock      = db.prepare(
    `SELECT id, sku, nombre, categoria, stock, stock_reservado, stock_minimo
     FROM productos WHERE activo=1 AND (stock - stock_reservado) <= stock_minimo ORDER BY stock ASC`
  ).all();
  const pedidos_pendientes = db.prepare(
    `SELECT ped.*, prod.nombre AS producto_nombre FROM pedidos ped
     JOIN productos prod ON prod.id = ped.producto_id
     WHERE ped.estado = 'stand_by' ORDER BY ped.creado_en ASC`
  ).all();
  const movimientos_recientes = db.prepare(
    `SELECT m.*, p.nombre AS producto_nombre FROM movimientos m
     JOIN productos p ON p.id = m.producto_id ORDER BY m.id DESC LIMIT 30`
  ).all();
  res.json({ total_productos, total_unidades, reservados, valor_inventario,
             bajo_stock, pedidos_pendientes, movimientos_recientes });
});

// ══════════════════════════════════════════════════════════════
// USUARIOS (solo admin)
// ══════════════════════════════════════════════════════════════
app.get('/api/admin/usuarios', auth, soloAdmin, (req, res) => {
  res.json(db.prepare(
    `SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY nombre`
  ).all());
});
app.post('/api/admin/usuarios', auth, soloAdmin, (req, res) => {
  const { usuario, nombre, password, rol } = req.body || {};
  if (!usuario || !nombre || !password) return res.status(400).json({ error: 'Faltan campos.' });
  if (!['admin','vendedor'].includes(rol)) return res.status(400).json({ error: 'Rol inválido.' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres.' });
  if (db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario.trim()))
    return res.status(409).json({ error: 'Ya existe ese usuario.' });
  const id = db.prepare(
    `INSERT INTO usuarios (usuario, nombre, password, rol) VALUES (?,?,?,?)`
  ).run(usuario.trim(), nombre.trim(), hashPassword(password), rol).lastInsertRowid;
  res.status(201).json({ id, usuario: usuario.trim(), nombre: nombre.trim(), rol });
});
app.patch('/api/admin/usuarios/:id', auth, soloAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'No puedes modificar tu propia cuenta aquí.' });
  db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(req.body.activo ? 1 : 0, u.id);
  res.json({ id: u.id, activo: req.body.activo ? 1 : 0 });
});

// ══════════════════════════════════════════════════════════════
// AUTO-SEED — si la BD no tiene productos, carga los de ejemplo
// (útil para primer arranque en Render o ambiente limpio)
// ══════════════════════════════════════════════════════════════
function autoSeed() {
  const total = db.prepare('SELECT COUNT(*) c FROM productos').get().c;
  if (total > 0) return;
  console.log('🌱 BD vacía — cargando productos de ejemplo…');
  try { require('./seed'); } catch (e) { console.warn('Seed omitido:', e.message); }
}

// ══════════════════════════════════════════════════════════════
// ARRANQUE
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n✨ Bixie Inventario — http://localhost:${PORT}`);
  console.log(`   WhatsApp configurado: +${WA_NUMBER}\n`);
  autoSeed();
});
