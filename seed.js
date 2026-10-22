// seed.js — Productos de ejemplo para Bixie
// Ejecutar UNA SOLA VEZ: npm run seed

const { db, generarSku } = require('./db');

const productos = [
  { nombre: 'Pulsera Trenzada Dorada',   categoria: 'pulsera',  precio: 120, stock: 8,  descripcion: 'Pulsera de hilo trenzado con charms dorados. Talla única ajustable.' },
  { nombre: 'Pulsera de Perlas Rosas',    categoria: 'pulsera',  precio: 95,  stock: 5,  descripcion: 'Pulsera elástica con perlas sintéticas color rosa pastel.' },
  { nombre: 'Pulsera Cadena Fina Plata',  categoria: 'pulsera',  precio: 150, stock: 6,  descripcion: 'Cadena plateada delicada con dije de estrella.' },
  { nombre: 'Aretes Argolla Dorada Grande', categoria: 'arete',  precio: 85,  stock: 10, descripcion: 'Argollas lisas de 4 cm bañadas en oro.' },
  { nombre: 'Aretes Gota Cristal',        categoria: 'arete',    precio: 110, stock: 7,  descripcion: 'Aretes colgantes con cristal facetado transparente.' },
  { nombre: 'Aretes Flor Esmalte',        categoria: 'arete',    precio: 70,  stock: 12, descripcion: 'Aretes de presión con flor de esmalte multicolor.' },
  { nombre: 'Aretes Corazón Rosa',        categoria: 'arete',    precio: 65,  stock: 9,  descripcion: 'Aretes de corazón rosa pastel con brillo.' },
  { nombre: 'Collar Cadena Eslabón Dorado', categoria: 'collar', precio: 180, stock: 4,  descripcion: 'Collar de cadena gruesa de eslabones bañada en oro 18K.' },
  { nombre: 'Collar Perla Central',       categoria: 'collar',   precio: 145, stock: 6,  descripcion: 'Cadena fina con perla sintética como dije central.' },
  { nombre: 'Collar Gargantilla Negra',   categoria: 'collar',   precio: 90,  stock: 8,  descripcion: 'Gargantilla de terciopelo negro con broche dorado.' },
  { nombre: 'Collar Mariposa Plateada',   categoria: 'collar',   precio: 130, stock: 5,  descripcion: 'Dije de mariposa plateada en cadena de 45 cm.' },
  { nombre: 'Tobillera Cadena Perlas',    categoria: 'accesorio', precio: 80,  stock: 7,  descripcion: 'Tobillera ajustable con perlas y charms de estrella.' },
  { nombre: 'Diadema Flores Secas',       categoria: 'accesorio', precio: 95,  stock: 5,  descripcion: 'Diadema con flores secas preservadas en resina.' },
  { nombre: 'Anillo Ajustable Mariposa',  categoria: 'accesorio', precio: 55,  stock: 15, descripcion: 'Anillo abierto ajustable con dije de mariposa dorada.' },
];

console.log('Cargando productos de ejemplo para Bixie…\n');
let creados = 0;

for (const p of productos) {
  const existe = db.prepare('SELECT id FROM productos WHERE nombre = ?').get(p.nombre);
  if (existe) { console.log(`  ↩ Ya existe: ${p.nombre}`); continue; }
  const sku = generarSku();
  const id  = db.prepare(
    `INSERT INTO productos (sku, nombre, descripcion, categoria, precio, stock, stock_minimo)
     VALUES (?,?,?,?,?,?,?)`
  ).run(sku, p.nombre, p.descripcion, p.categoria, p.precio, p.stock, 2).lastInsertRowid;
  db.prepare(
    `INSERT INTO movimientos (producto_id, tipo, cantidad, usuario, nota)
     VALUES (?,?,?,?,?)`
  ).run(id, 'entrada', p.stock, 'seed', 'Stock inicial');
  console.log(`  ✓ ${sku}  ${p.nombre}  (stock: ${p.stock})`);
  creados++;
}

console.log(`✨ Seed: ${creados} producto(s) creado(s).\n`);
// process.exit solo si se corre directo (no si se require desde server)
if (require.main === module) process.exit(0);
