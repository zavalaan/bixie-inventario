# Bixie · Sistema de Catálogo e Inventario

Sistema a la medida para **Bixie** — bisutería y accesorios. Catálogo público con carrusel de imágenes, pedidos vía WhatsApp con reserva de inventario (stand-by) y panel de administración.

Desarrollado por **bit3io**.

---

## Características

### Catálogo público (sin login)
- Grid / carrusel de productos con foto, precio y stock disponible
- Filtros por categoría: pulsera, arete, collar, accesorio
- Búsqueda en tiempo real
- Vista detalle con formulario de pedido

### Flujo de pedido por WhatsApp
1. El cliente selecciona una pieza y presiona **"Pedir por WhatsApp"**
2. El sistema reserva las unidades en **stand-by** (no las descuenta aún)
3. Se genera un botón que abre WhatsApp con el mensaje del pedido prellenado
4. El catálogo refleja el stock reservado en tiempo real

### Panel Admin
- **Pedidos**: listar, filtrar por estado, confirmar o cancelar
  - **Confirmar** → descuenta el inventario real
  - **Cancelar** → libera la reserva sin descontar
- **Productos**: alta, edición, imagen, ajuste de stock (entrada/ajuste manual)
- **Reportes**: resumen de inventario, pedidos en stand-by, bajo stock, movimientos recientes

---

## Requisitos

- **Node.js 18 o superior** (probado en Node 22)
- Dependencias: `better-sqlite3`, `express`, `multer` (ver `package.json`)

---

## Instalación

```bash
# 1. Entra a la carpeta
cd bixie-inventario

# 2. Instala dependencias
npm install

# 3. (Opcional) Carga productos de ejemplo
npm run seed

# 4. Arranca el servidor
npm start
```

Abre en el navegador: **http://localhost:3000**

La base de datos se crea sola en `bixie.db` al primer arranque.

---

## Configuración

### Número de WhatsApp

En producción, set la variable de entorno antes de arrancar:

```bash
WA_NUMBER=525665296109 npm start
```

O crea un archivo `.env` (instala `dotenv` si lo deseas):
```
WA_NUMBER=525665296109
PORT=3000
```

### Acceso administrador (primer arranque)
```
usuario:    admin
contraseña: bixie2026
```
> ⚠️ Cambia la contraseña al entrar: **Panel → botón de usuario**

---

## Estructura del proyecto

```
bixie-inventario/
├── server.js          API REST + sirve la PWA
├── db.js              SQLite — esquema y utilidades
├── seed.js            Productos de ejemplo (npm run seed)
├── package.json
└── public/            Aplicación frontend (PWA)
    ├── index.html     Shell HTML
    ├── styles.css     Identidad visual Bixie (rosa/oro)
    ├── app.js         Lógica completa frontend
    └── manifest.webmanifest
```

---

## Base de datos

Cuatro tablas:
- **usuarios** — credenciales y roles (admin / vendedor)
- **productos** — catálogo con `stock` total y `stock_reservado` (stand-by)
- **pedidos** — folio, estado (`stand_by` → `confirmado` / `cancelado`), datos del cliente
- **movimientos** — historial completo: entradas, salidas, reservas, liberaciones

---

## Despliegue en producción (Railway / Render)

1. Sube el repositorio a GitHub
2. Conecta a Railway o Render
3. Configura la variable de entorno `WA_NUMBER=52XXXXXXXXXX`
4. El servidor arranca con `npm start`

Para respaldar la BD, copia el archivo `bixie.db`.

---

## Próximas fases sugeridas

- Importación masiva de productos por CSV
- Exportación de pedidos a Excel
- Notificación automática por WhatsApp Business API al confirmar
- Multi-usuario vendedora con historial por persona
- Modo oscuro
