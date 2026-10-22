/* ═══════════════════════════════════════════════
   BIXIE · app.js — Frontend completo
   - Catálogo público con grid / carrusel
   - Flujo de pedido por WhatsApp (stand-by → confirmado)
   - Panel admin: pedidos, productos, reportes
   ═══════════════════════════════════════════════ */

'use strict';

// ────────────────────────────────────────────────
// ESTADO GLOBAL
// ────────────────────────────────────────────────
const STATE = {
  token: localStorage.getItem('bixie_token') || null,
  user:  JSON.parse(localStorage.getItem('bixie_user') || 'null'),
  productos: [],
  catActiva: '',
  productoActivo: null,
  qty: 1,
  pedidoEstado: '',
};

// ────────────────────────────────────────────────
// UTILIDADES
// ────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const money = n => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (STATE.token) headers['Authorization'] = `Bearer ${STATE.token}`;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers||{}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:${type==='ok' ? '#2d7a50' : '#c0392b'};color:#fff;
    padding:10px 20px;border-radius:30px;font-size:13px;
    box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:999;
    animation:fadeIn .2s ease;
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ────────────────────────────────────────────────
// AUTENTICACIÓN
// ────────────────────────────────────────────────
function setSession(token, user) {
  STATE.token = token;
  STATE.user  = user;
  localStorage.setItem('bixie_token', token);
  localStorage.setItem('bixie_user', JSON.stringify(user));
  renderNav();
}
function clearSession() {
  STATE.token = null;
  STATE.user  = null;
  localStorage.removeItem('bixie_token');
  localStorage.removeItem('bixie_user');
  renderNav();
  showView('catalogo');
}
function renderNav() {
  const loggedIn = !!STATE.token;
  $('navLoginBtn').style.display  = loggedIn ? 'none' : '';
  $('navLogoutBtn').style.display = loggedIn ? '' : 'none';
  $('navAdmin').style.display     = loggedIn ? '' : 'none';
}

// Login modal
$('navLoginBtn').addEventListener('click', () => openLoginModal());
$('loginClose').addEventListener('click', () => closeLoginModal());
$('loginOverlay').addEventListener('click', e => { if (e.target === $('loginOverlay')) closeLoginModal(); });

function openLoginModal() {
  $('loginOverlay').classList.add('open');
  setTimeout(() => $('loginUser').focus(), 100);
}
function closeLoginModal() {
  $('loginOverlay').classList.remove('open');
  $('loginError').style.display = 'none';
}

$('loginSubmit').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
async function doLogin() {
  const user = $('loginUser').value.trim();
  const pass = $('loginPass').value;
  $('loginError').style.display = 'none';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ usuario: user, password: pass })
    });
    setSession(data.token, data.usuario);
    closeLoginModal();
    toast('Bienvenida, ' + data.usuario.nombre + ' 👑');
  } catch (e) {
    $('loginError').textContent = e.message;
    $('loginError').style.display = 'block';
  }
}

$('navLogoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
  clearSession();
  toast('Sesión cerrada');
});

// ────────────────────────────────────────────────
// NAVEGACIÓN
// ────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  $('view' + name.charAt(0).toUpperCase() + name.slice(1)).style.display = '';
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });
  if (name === 'admin') loadAdmin();
  if (name === 'catalogo') loadCatalogo();
}

document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'admin' && !STATE.token) { openLoginModal(); return; }
    showView(btn.dataset.view);
    $('navLinks').classList.remove('open');
  });
});

// Hamburger
$('hamburger').addEventListener('click', () => $('navLinks').classList.toggle('open'));

// ────────────────────────────────────────────────
// CATÁLOGO PÚBLICO
// ────────────────────────────────────────────────
let searchTimer;

async function loadCatalogo() {
  renderSkeletons();
  try {
    const [productos, categorias] = await Promise.all([
      api('/api/catalogo'),
      api('/api/catalogo/meta/categorias'),
    ]);
    STATE.productos = productos;
    renderCatPills(categorias);
    renderProductos(productos);
  } catch (e) {
    $('catalogoGrid').innerHTML = `<p class="empty-msg">Error al cargar: ${e.message}</p>`;
  }
}

function renderSkeletons() {
  $('catalogoGrid').innerHTML = Array(8).fill('<div class="skeleton-card"></div>').join('');
}

function renderCatPills(cats) {
  const container = $('catPills');
  container.innerHTML = `<button class="pill active" data-cat="">Todo</button>`;
  cats.forEach(cat => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.dataset.cat = cat;
    b.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    container.appendChild(b);
  });
  container.querySelectorAll('.pill').forEach(p => {
    p.addEventListener('click', () => {
      STATE.catActiva = p.dataset.cat;
      container.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      filtrarYRenderizar();
    });
  });
}

function filtrarYRenderizar() {
  const q = $('searchInput').value.toLowerCase();
  let lista = STATE.productos;
  if (STATE.catActiva) lista = lista.filter(p => p.categoria === STATE.catActiva);
  if (q) lista = lista.filter(p =>
    p.nombre.toLowerCase().includes(q) ||
    (p.descripcion||'').toLowerCase().includes(q) ||
    (p.categoria||'').toLowerCase().includes(q)
  );
  renderProductos(lista);
}

$('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filtrarYRenderizar, 200);
});

function renderProductos(lista) {
  const grid = $('catalogoGrid');
  const empty = $('emptyMsg');
  if (!lista.length) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = lista.map(p => cardHTML(p)).join('');
  grid.querySelectorAll('.producto-card').forEach(card => {
    card.addEventListener('click', () => abrirProducto(Number(card.dataset.id)));
  });
}

function cardHTML(p) {
  const disponible = p.stock_disponible ?? (p.stock - p.stock_reservado);
  const imgHTML = p.imagen
    ? `<img class="card-img" src="${p.imagen}" alt="${p.nombre}" loading="lazy" />`
    : `<div class="card-img-placeholder">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
           <rect x="3" y="3" width="18" height="18" rx="2"/>
           <circle cx="8.5" cy="8.5" r="1.5"/>
           <polyline points="21 15 16 10 5 21"/>
         </svg>
       </div>`;
  let badge = '';
  if (disponible <= 0 && p.stock_reservado > 0) {
    badge = `<span class="card-badge-reservado">Reservado</span>`;
  } else if (disponible <= 0) {
    badge = `<span class="card-badge-agotado">Agotado</span>`;
  }
  return `
    <div class="producto-card" data-id="${p.id}">
      ${imgHTML}${badge}
      <div class="card-body">
        <p class="card-cat">${p.categoria || ''}</p>
        <p class="card-name">${p.nombre}</p>
        <p class="card-precio">${money(p.precio)}</p>
        <p class="card-stock">${disponible > 0 ? disponible + ' disponible' + (disponible !== 1 ? 's' : '') : 'Sin stock'}</p>
      </div>
    </div>`;
}

// ────────────────────────────────────────────────
// MODAL DETALLE / PEDIDO
// ────────────────────────────────────────────────
async function abrirProducto(id) {
  const p = STATE.productos.find(x => x.id === id) || await api(`/api/catalogo/${id}`);
  STATE.productoActivo = p;
  STATE.qty = 1;

  const disponible = p.stock_disponible ?? (p.stock - p.stock_reservado);

  // Llenar modal
  $('modalImg').src = p.imagen || '';
  $('modalImg').style.display = p.imagen ? '' : 'none';
  $('modalCat').textContent   = p.categoria || '';
  $('modalTitulo').textContent = p.nombre;
  $('modalDesc').textContent  = p.descripcion || '';
  $('modalPrecio').textContent = money(p.precio);
  $('modalBadge').textContent  = p.categoria || '';
  $('modalStock').innerHTML    = disponible > 0
    ? `<strong>${disponible}</strong> pieza${disponible !== 1 ? 's' : ''} disponible${disponible !== 1 ? 's' : ''}`
    : `<span style="color:var(--rose)">Sin stock disponible en este momento</span>`;

  // Reset form
  $('qtyVal').textContent    = '1';
  $('pedidoNombre').value    = '';
  $('pedidoNota').value      = '';
  $('pedidoForm').style.display   = '';
  $('pedidoResult').style.display = 'none';
  $('btnPedirWa').disabled = disponible <= 0;

  $('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarModal() {
  $('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  STATE.productoActivo = null;
}

$('modalClose').addEventListener('click', cerrarModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) cerrarModal(); });

// Cantidad
$('qtyMinus').addEventListener('click', () => {
  if (STATE.qty > 1) STATE.qty--;
  $('qtyVal').textContent = STATE.qty;
});
$('qtyPlus').addEventListener('click', () => {
  const p = STATE.productoActivo;
  const max = p ? (p.stock_disponible ?? (p.stock - p.stock_reservado)) : 99;
  if (STATE.qty < max) STATE.qty++;
  $('qtyVal').textContent = STATE.qty;
});

// Crear pedido → WhatsApp
$('btnPedirWa').addEventListener('click', async () => {
  const p = STATE.productoActivo;
  if (!p) return;
  const btn = $('btnPedirWa');
  btn.disabled = true;
  btn.textContent = 'Reservando…';
  try {
    const res = await api('/api/pedidos', {
      method: 'POST',
      body: JSON.stringify({
        producto_id: p.id,
        cantidad: STATE.qty,
        nombre_cliente: $('pedidoNombre').value.trim() || null,
        nota: $('pedidoNota').value.trim() || null,
      })
    });
    // Mostrar resultado
    $('pedidoForm').style.display   = 'none';
    $('pedidoResult').style.display = '';
    $('resultFolio').textContent     = `Folio de reserva: ${res.folio}`;
    $('resultWaLink').href           = res.waLink;

    // Actualizar stock en pantalla
    const idx = STATE.productos.findIndex(x => x.id === p.id);
    if (idx >= 0) {
      STATE.productos[idx].stock_reservado = (STATE.productos[idx].stock_reservado || 0) + STATE.qty;
      STATE.productos[idx].stock_disponible = STATE.productos[idx].stock - STATE.productos[idx].stock_reservado;
    }
    filtrarYRenderizar();
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" style="width:20px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.824.486 3.533 1.332 5.012L2 22l5.143-1.311A9.967 9.967 0 0 0 11.999 22C17.523 22 22 17.523 22 12S17.523 2 11.999 2zm0 18.133a8.12 8.12 0 0 1-4.33-1.254l-.31-.183-3.053.779.806-2.967-.202-.32A8.134 8.134 0 1 1 11.999 20.133z"/></svg> Pedir por WhatsApp`;
    toast(e.message, 'error');
  }
});

$('resultCerrar').addEventListener('click', cerrarModal);

// ────────────────────────────────────────────────
// PANEL ADMIN
// ────────────────────────────────────────────────
function loadAdmin() {
  loadPedidos();
}

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    btn.classList.add('active');
    $('tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1)).style.display = '';
    if (btn.dataset.tab === 'pedidos')  loadPedidos();
    if (btn.dataset.tab === 'productos') loadAdminProductos();
    if (btn.dataset.tab === 'reportes') loadReportes();
  });
});

// ─── PEDIDOS ─────────────────────────────────
let filtroEstado = '';

document.querySelectorAll('#tabPedidos .pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('#tabPedidos .pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    filtroEstado = p.dataset.estado;
    loadPedidos();
  });
});

async function loadPedidos() {
  const list = $('pedidosList');
  list.innerHTML = '<p class="empty-msg">Cargando…</p>';
  try {
    const url = '/api/admin/pedidos' + (filtroEstado ? `?estado=${filtroEstado}` : '');
    const pedidos = await api(url);
    const pendientes = pedidos.filter(p => p.estado === 'stand_by').length;
    $('pedidosBadge').textContent   = pendientes;
    $('pedidosBadge').style.display = pendientes ? '' : 'none';

    if (!pedidos.length) {
      list.innerHTML = '<p class="empty-msg">No hay pedidos en este estado.</p>';
      return;
    }
    list.innerHTML = pedidos.map(p => pedidoCardHTML(p)).join('');
    list.querySelectorAll('.btn-confirmar').forEach(b => {
      b.addEventListener('click', () => confirmarPedido(b.dataset.id));
    });
    list.querySelectorAll('.btn-cancelar').forEach(b => {
      b.addEventListener('click', () => cancelarPedido(b.dataset.id));
    });
  } catch (e) {
    list.innerHTML = `<p class="empty-msg">${e.message}</p>`;
  }
}

function pedidoCardHTML(p) {
  const imgHTML = p.imagen
    ? `<img class="pedido-img" src="${p.imagen}" alt="" />`
    : `<div class="pedido-img" style="display:flex;align-items:center;justify-content:center;background:var(--rose-light);">
         <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rose-mid)" stroke-width="1.5">
           <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
           <polyline points="21 15 16 10 5 21"/>
         </svg>
       </div>`;
  const acciones = p.estado === 'stand_by'
    ? `<div class="pedido-acciones">
         <button class="btn-confirmar" data-id="${p.id}">✓ Confirmar</button>
         <button class="btn-cancelar"  data-id="${p.id}">✕ Cancelar</button>
       </div>` : '';
  const cliente = p.nombre_cliente ? `— ${p.nombre_cliente}` : '';
  return `
    <div class="pedido-card ${p.estado}">
      ${imgHTML}
      <div class="pedido-info">
        <p class="pedido-folio">${p.folio}</p>
        <p class="pedido-nombre">${p.producto_nombre} × ${p.cantidad}</p>
        <p class="pedido-meta">${cliente} ${p.nota ? '· ' + p.nota : ''}</p>
        <p class="pedido-meta" style="color:var(--text-light);font-size:11px">${new Date(p.creado_en).toLocaleString('es-MX')}</p>
      </div>
      <span class="pedido-estado ${p.estado}">${estadoLabel(p.estado)}</span>
      ${acciones}
    </div>`;
}
function estadoLabel(e) {
  return { stand_by: '⏳ Stand-by', confirmado: '✓ Confirmado', cancelado: '✕ Cancelado' }[e] || e;
}

async function confirmarPedido(id) {
  if (!confirm('¿Confirmar este pedido? Se descontará el inventario.')) return;
  try {
    await api(`/api/admin/pedidos/${id}/confirmar`, { method: 'PATCH' });
    toast('Pedido confirmado ✓ — inventario descontado');
    loadPedidos();
    loadCatalogo();
  } catch (e) { toast(e.message, 'error'); }
}
async function cancelarPedido(id) {
  if (!confirm('¿Cancelar este pedido? La reserva se liberará.')) return;
  try {
    await api(`/api/admin/pedidos/${id}/cancelar`, { method: 'PATCH' });
    toast('Pedido cancelado — pieza liberada');
    loadPedidos();
    loadCatalogo();
  } catch (e) { toast(e.message, 'error'); }
}

// ─── PRODUCTOS ADMIN ─────────────────────────
async function loadAdminProductos() {
  const tbody = $('adminTableBody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Cargando…</td></tr>';
  try {
    const prods = await api('/api/admin/productos');
    if (!prods.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-msg">Sin productos. ¡Crea el primero!</td></tr>';
      return;
    }
    tbody.innerHTML = prods.map(p => {
      const disp = p.stock_disponible ?? (p.stock - p.stock_reservado);
      const bajoBg = disp <= p.stock_minimo ? 'background:var(--rose-light)' : '';
      return `<tr style="${bajoBg}">
        <td>${p.imagen
          ? `<img class="table-img" src="${p.imagen}" alt="" />`
          : `<div class="table-img-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`
        }</td>
        <td><strong>${p.nombre}</strong><br><span style="font-size:10px;color:var(--text-light)">${p.sku}</span></td>
        <td style="text-transform:capitalize">${p.categoria || '—'}</td>
        <td>${money(p.precio)}</td>
        <td>${p.stock}</td>
        <td style="color:var(--gold)">${p.stock_reservado}</td>
        <td class="${disp <= p.stock_minimo ? 'tag-bajo' : ''}">${disp}</td>
        <td><span class="${p.activo ? 'tag-activo' : 'tag-inactivo'}">${p.activo ? '● Activo' : '○ Inactivo'}</span></td>
        <td><button class="btn-edit" data-id="${p.id}">Editar</button></td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.btn-edit').forEach(b => {
      b.addEventListener('click', () => abrirDrawer(Number(b.dataset.id), prods));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-msg">${e.message}</td></tr>`;
  }
}

// ─── DRAWER PRODUCTO ─────────────────────────
let modoEdicion = false;
let editId = null;

$('btnNuevoProducto').addEventListener('click', () => abrirDrawer(null));
$('drawerClose').addEventListener('click', cerrarDrawer);
$('dpCancel').addEventListener('click', cerrarDrawer);
$('drawerOverlay').addEventListener('click', e => { if (e.target === $('drawerOverlay')) cerrarDrawer(); });

function abrirDrawer(id, lista) {
  modoEdicion = !!id;
  editId = id;
  $('drawerTitle').textContent = id ? 'Editar producto' : 'Nuevo producto';
  $('dpError').style.display   = 'none';
  $('dpStockAjuste').style.display = id ? '' : 'none';
  $('dpStock').disabled = !!id;
  $('dpImgPreview').src = '';
  $('dpImgPreview').style.display = 'none';
  $('imgUploadLabel').style.display = '';

  // Reset form
  ['dpNombre','dpDesc','dpPrecio','dpSku','dpAjusteNota'].forEach(f => { if ($(f)) $(f).value = ''; });
  $('dpStock').value    = '1';
  $('dpStockMin').value = '1';
  $('dpCat').value      = 'pulsera';

  if (id && lista) {
    const p = lista.find(x => x.id === id);
    if (p) {
      $('dpNombre').value   = p.nombre || '';
      $('dpDesc').value     = p.descripcion || '';
      $('dpCat').value      = p.categoria || 'otro';
      $('dpPrecio').value   = p.precio || 0;
      $('dpStock').value    = p.stock || 0;
      $('dpStockMin').value = p.stock_minimo || 1;
      $('dpSku').value      = p.sku || '';
      if (p.imagen) {
        $('dpImgPreview').src = p.imagen;
        $('dpImgPreview').style.display = '';
        $('imgUploadLabel').style.display = 'none';
      }
    }
  }

  $('drawerOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarDrawer() {
  $('drawerOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Preview imagen
let imgB64 = null;
$('dpImgFile').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const MAX = 4 * 1024 * 1024;
  if (file.size > MAX) { toast('Imagen muy grande (máx ~3 MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    imgB64 = ev.target.result;
    $('dpImgPreview').src = imgB64;
    $('dpImgPreview').style.display = '';
    $('imgUploadLabel').style.display = 'none';
  };
  reader.readAsDataURL(file);
});
$('imgUploadLabel').addEventListener('click', () => $('dpImgFile').click());
$('dpImgPreview').addEventListener('click', () => $('dpImgFile').click());

// Guardar producto
$('dpGuardar').addEventListener('click', async () => {
  const nombre = $('dpNombre').value.trim();
  if (!nombre) { showDpError('El nombre es obligatorio.'); return; }
  const body = {
    nombre,
    descripcion: $('dpDesc').value.trim() || null,
    categoria:   $('dpCat').value,
    precio:      parseFloat($('dpPrecio').value) || 0,
    stock:       parseInt($('dpStock').value) || 0,
    stock_minimo: parseInt($('dpStockMin').value) || 1,
    sku:         $('dpSku').value.trim() || undefined,
  };
  if (imgB64)     body.imagen = imgB64;
  if (modoEdicion) body.activo = 1;

  try {
    if (modoEdicion) {
      await api(`/api/admin/productos/${editId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Producto actualizado ✓');
    } else {
      await api('/api/admin/productos', { method: 'POST', body: JSON.stringify(body) });
      toast('Producto creado ✓');
    }
    imgB64 = null;
    cerrarDrawer();
    loadAdminProductos();
    loadCatalogo();
  } catch (e) {
    showDpError(e.message);
  }
});

function showDpError(msg) {
  $('dpError').textContent    = msg;
  $('dpError').style.display  = 'block';
}

// Ajuste de stock
$('btnAplicarAjuste').addEventListener('click', async () => {
  const tipo = $('dpAjusteTipo').value;
  const cant = parseInt($('dpAjusteCant').value) || 0;
  const nota = $('dpAjusteNota').value.trim();
  if (!cant) { showDpError('Indica una cantidad.'); return; }
  try {
    await api(`/api/admin/productos/${editId}/stock`, {
      method: 'POST',
      body: JSON.stringify({ tipo, cantidad: cant, nota })
    });
    toast(`Stock ajustado: ${tipo} de ${cant} unidad(es)`);
    loadAdminProductos();
    loadCatalogo();
  } catch (e) {
    showDpError(e.message);
  }
});

// ─── REPORTES ────────────────────────────────
async function loadReportes() {
  try {
    const r = await api('/api/admin/reportes');
    $('statProds').textContent = r.total_productos;
    $('statUnids').textContent = r.total_unidades;
    $('statRes').textContent   = r.reservados;
    $('statVal').textContent   = money(r.valor_inventario);

    renderMiniList('bajoStockList', r.bajo_stock, p =>
      `<span class="mr-name">${p.nombre}</span>
       <span class="mr-meta">${p.categoria || ''}</span>
       <span class="mr-chip exit">Stock: ${p.stock - p.stock_reservado}</span>`
    );

    renderMiniList('standByList', r.pedidos_pendientes, p =>
      `<span class="mr-name">${p.producto_nombre}</span>
       <span class="mr-meta">${p.nombre_cliente || 'Sin nombre'}</span>
       <span class="mr-chip reserva">${p.folio}</span>`
    );

    renderMiniList('movList', r.movimientos_recientes, m => {
      const tipoChip = {
        entrada: 'entry', salida: 'exit', ajuste: 'entry',
        reserva: 'reserva', liberacion: 'entry'
      }[m.tipo] || 'entry';
      const tipoLabel = {
        entrada: '▲ Entrada', salida: '▼ Salida', ajuste: '± Ajuste',
        reserva: '⏳ Reserva', liberacion: '↩ Liberación'
      }[m.tipo] || m.tipo;
      return `<span class="mr-name">${m.producto_nombre}</span>
              <span class="mr-meta">${m.usuario || '—'}</span>
              <span class="mr-chip ${tipoChip}">${tipoLabel} ${m.cantidad}</span>`;
    });
  } catch (e) {
    toast('Error al cargar reportes: ' + e.message, 'error');
  }
}

function renderMiniList(containerId, items, rowFn) {
  const el = $(containerId);
  if (!items?.length) { el.innerHTML = '<p class="empty-msg" style="padding:16px 0">Sin registros</p>'; return; }
  el.innerHTML = items.map(i => `<div class="mini-row">${rowFn(i)}</div>`).join('');
}

// ────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────
renderNav();
loadCatalogo();
