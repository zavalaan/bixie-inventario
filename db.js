// db.js — Base de datos SQLite para Bixie Inventario.
// Tablas: usuarios, productos, pedidos (con estado stand_by / confirmado / cancelado),
// movimientos de inventario.
// La imagen se guarda como Data URL (base64) en la propia BD — portable sin servidor de archivos.

const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fs       = require('fs');

// En Render el disco persistente se monta en /data.
// En desarrollo local se usa la carpeta del proyecto.
const DB_DIR  = fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = path.join(DB_DIR, 'bixie.db');

console.log(`📦 Base de datos: ${DB_PATH}`);
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────
// ESQUEMA
// ──────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario    TEXT NOT NULL UNIQUE,
    nombre     TEXT NOT NULL,
    password   TEXT NOT NULL,
    rol        TEXT NOT NULL CHECK (rol IN ('admin','vendedor')),
    activo     INTEGER NOT NULL DEFAULT 1,
    creado_en  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS productos (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sku            TEXT NOT NULL UNIQUE,
    nombre         TEXT NOT NULL,
    descripcion    TEXT,
    categoria      TEXT,          -- pulsera | arete | collar | accesorio | otro
    precio         REAL NOT NULL DEFAULT 0,
    stock          INTEGER NOT NULL DEFAULT 0,
    stock_reservado INTEGER NOT NULL DEFAULT 0,   -- unidades en stand-by (pedidos pendientes)
    stock_minimo   INTEGER NOT NULL DEFAULT 1,
    imagen         TEXT,          -- Data URL base64
    activo         INTEGER NOT NULL DEFAULT 1,
    creado_en      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    folio       TEXT NOT NULL UNIQUE,
    producto_id INTEGER NOT NULL REFERENCES productos(id),
    cantidad    INTEGER NOT NULL DEFAULT 1,
    nombre_cliente TEXT,
    telefono_cliente TEXT,
    nota        TEXT,
    estado      TEXT NOT NULL DEFAULT 'stand_by'
                  CHECK (estado IN ('stand_by','confirmado','cancelado')),
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado_en TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL CHECK (tipo IN ('entrada','salida','ajuste','reserva','liberacion')),
    cantidad    INTEGER NOT NULL,
    pedido_id   INTEGER REFERENCES pedidos(id),
    usuario_id  INTEGER REFERENCES usuarios(id),
    usuario     TEXT,
    nota        TEXT,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_mov_prod   ON movimientos(producto_id);
  CREATE INDEX IF NOT EXISTS idx_ped_prod   ON pedidos(producto_id);
  CREATE INDEX IF NOT EXISTS idx_ped_estado ON pedidos(estado);
`);

// ──────────────────────────────────────────────
// CONTRASEÑAS
// ──────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch (_) { return false; }
}

// ──────────────────────────────────────────────
// USUARIO ADMINISTRADOR POR DEFECTO
// ──────────────────────────────────────────────
const totalUsuarios = db.prepare('SELECT COUNT(*) c FROM usuarios').get().c;
if (totalUsuarios === 0) {
  db.prepare('INSERT INTO usuarios (usuario, nombre, password, rol) VALUES (?,?,?,?)')
    .run('admin', 'Administrador Bixie', hashPassword('bixie2026'), 'admin');
  console.log('─────────────────────────────────────────');
  console.log(' Usuario admin creado:');
  console.log('   usuario:    admin');
  console.log('   contraseña: bixie2026  ← ¡cámbiala al entrar!');
  console.log('─────────────────────────────────────────');
}

// ──────────────────────────────────────────────
// SKU AUTOMÁTICO
// ──────────────────────────────────────────────
function generarSku() {
  const row = db.prepare(`SELECT sku FROM productos WHERE sku LIKE 'BX-%' ORDER BY id DESC LIMIT 1`).get();
  let n = 1;
  if (row) {
    const num = parseInt(row.sku.replace('BX-', ''), 10);
    if (!isNaN(num)) n = num + 1;
  }
  return 'BX-' + String(n).padStart(4, '0');
}

// ──────────────────────────────────────────────
// FOLIO DE PEDIDO
// ──────────────────────────────────────────────
function generarFolio() {
  const hoy = new Date();
  const prefix = `PED-${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,'0')}${String(hoy.getDate()).padStart(2,'0')}`;
  const last = db.prepare(`SELECT folio FROM pedidos WHERE folio LIKE ? ORDER BY folio DESC LIMIT 1`).get(prefix + '%');
  const n = last ? parseInt(last.folio.slice(-4), 10) + 1 : 1;
  return `${prefix}-${String(n).padStart(4,'0')}`;
}

// ──────────────────────────────────────────────
// IMAGEN — validación
// ──────────────────────────────────────────────
const MAX_IMG = 4 * 1024 * 1024;
function limpiarImagen(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(s))
    throw new Error('Formato de imagen no válido (png/jpg/webp)');
  if (s.length > MAX_IMG) throw new Error('La imagen es demasiado grande (máx ~3 MB)');
  return s;
}

module.exports = { db, hashPassword, verifyPassword, generarSku, generarFolio, limpiarImagen };
