/* ==========================================================================
   PUTRA 354 JAYA — POS & KATALOG (v2.1)
   app.js — seluruh logika aplikasi (Vanilla JS, ES6+)

   Arsitektur data:
   - Mode Demo : data + foto tersimpan di localStorage (tanpa server).
   - Mode Sheets : data dikirim ke Google Apps Script (Web App URL);
                   foto dikompres via Canvas → dikirim Base64 →
                   Apps Script menyimpannya ke Google Drive dan hanya
                   menaruh URL-nya ke Google Sheets.

   Perubahan v2.1:
   - Nota bisa dibagikan sebagai teks / foto / PDF ke aplikasi apa pun
     (Web Share API; fallback: salin / unduh).
   - Kalimat penutup nota diganti.
   - Tombol kembali HP menutup layer teratas (sheet/modal/halaman detail),
     bukan keluar dari aplikasi (History API).
   - Logo perisai "Putra 354 Jaya" digambar via Canvas: dipakai untuk
     ikon aplikasi (manifest), logo pojok kiri atas, dan nota foto/PDF.
   ========================================================================== */
'use strict';

/* ==========================================================================
   1. KONSTANTA, STATE & DATA CONTOH (MODE DEMO)
   ========================================================================== */
const LS = {
  settings: 'p354_settings',
  products: 'p354_products',
  cart:     'p354_cart',
  history:  'p354_history',
};

// Enam produk contoh agar aplikasi langsung terasa hidup saat pertama dibuka
const DEMO_PRODUCTS = [
  { id:'demo-1', name:'Beras Premium 5 kg',  category:'Sembako', price:68000, desc:'Beras pulen, kemasan vacum',
    image:'https://picsum.photos/seed/p354-beras/600/600.jpg',
    images:['https://picsum.photos/seed/p354-beras/600/600.jpg','https://picsum.photos/seed/p354-beras-2/600/600.jpg','https://picsum.photos/seed/p354-beras-3/600/600.jpg'] },
  { id:'demo-2', name:'Minyak Goreng 1 L',   category:'Sembako', price:17500, desc:'',
    image:'https://picsum.photos/seed/p354-minyak/600/600.jpg',
    images:['https://picsum.photos/seed/p354-minyak/600/600.jpg','https://picsum.photos/seed/p354-minyak-2/600/600.jpg'] },
  { id:'demo-3', name:'Gula Pasir 1 kg',     category:'Sembako', price:16000, desc:'', image:'https://picsum.photos/seed/p354-gula/600/600.jpg'   },
  { id:'demo-4', name:'Telur Ayam 1 kg',     category:'Sembako', price:28000, desc:'Isi ± 16 butir', image:'https://picsum.photos/seed/p354-telur/600/600.jpg'  },
  { id:'demo-5', name:'Kopi Sachet isi 10',  category:'Minuman', price:15000, desc:'', image:'https://picsum.photos/seed/p354-kopi/600/600.jpg'   },
  { id:'demo-6', name:'Mie Instan Goreng',   category:'Makanan', price:3500,  desc:'', image:'https://picsum.photos/seed/p354-mie/600/600.jpg'    },
];

const state = {
  products: [],                                                    // katalog aktif
  cart: new Map(),                                                 // productId -> { qty, price } (price = harga khusus, opsional)
  settings: { storeName:'Putra 354 Jaya', storeAddr:'', storePhone:'', scriptUrl:'' },
  view: 'pos',
  online: navigator.onLine,
};

// Status foto pada form produk (multi-foto)
let pfPhotos = [];        // daftar foto di form: campuran URL (lama) & dataURL (baru)
let pfPhotosDirty = false; // apakah daftar foto diubah sejak form dibuka

let deferredPrompt = null;      // event install PWA yang ditunda
let confirmCallback = null;     // aksi yang menunggu konfirmasi hapus
let currentReceiptText = '';    // teks struk untuk dibagikan / disalin
let currentReceiptData = null;  // (v2.1) data struk aktif untuk dibagikan sebagai foto/PDF
let detailProductId = null;     // produk yang sedang dibuka di halaman detail
let priceEditId = null;         // item keranjang yang sedang diedit harganya

/* ==========================================================================
   2. UTILITAS UMUM
   ========================================================================== */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const rupiah      = n => 'Rp' + (Number(n) || 0).toLocaleString('id-ID');
const parseNumber = s => Number(String(s).replace(/[^\d]/g, '')) || 0;
const initialOf   = s => (String(s || '?').trim()[0] || '?').toUpperCase();
const uid         = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isDemo      = () => !state.settings.scriptUrl;

// Semua gambar milik produk — fallback ke `image` tunggal (data lama v1)
const imagesOf = p => {
  const arr = Array.isArray(p && p.images) ? p.images.filter(Boolean) : [];
  return arr.length ? arr : (p && p.image ? [p.image] : []);
};

// Harga satuan item keranjang: harga khusus bila ada, selain itu harga normal
const unitPriceOf = (entry, p) => (entry.price != null ? entry.price : p.price);

// Nama berkas unduhan yang aman, cth: "beras-premium-5-kg-1.jpg"
const slugify = s =>
  (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'produk';

// Escape HTML — wajib sebelum menempelkan data ke innerHTML
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Render ulang semua ikon Lucide setelah DOM berubah
function refreshIcons(){
  if (window.lucide && lucide.createIcons) lucide.createIcons();
}

// Notifikasi ringkas non-blokir
function toast(message, type = 'ok'){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span class="toast-dot"></span><span>${escapeHtml(message)}</span>`;
  $('#toastWrap').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// Overlay spinner (wajib tampil selama menunggu Apps Script 1–3 detik)
function setLoading(on, text = 'Memproses…'){
  $('#loadingText').textContent = text;
  $('#loadingOverlay').classList.toggle('show', on);
}

/* ==========================================================================
   3. PENYIMPANAN LOKAL (localStorage) — cache & mode demo
   ========================================================================== */
function lsGet(key, fallback){
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; }
  catch { return fallback; }
}
function lsSet(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* kuota penuh — abaikan agar aplikasi tetap jalan */ }
}

function loadLocal(){
  const s = lsGet(LS.settings, null);
  if (s) state.settings = { ...state.settings, ...s };
  state.products = lsGet(LS.products, []);

  // Keranjang berisi { qty, price } — nilai angka dari v1 dimigrasi otomatis
  state.cart = new Map();
  lsGet(LS.cart, []).forEach(([id, v]) => {
    const entry = typeof v === 'number' ? { qty: v, price: undefined } : v;
    if (id && entry && entry.qty > 0){
      state.cart.set(String(id), { qty: entry.qty, price: entry.price });
    }
  });
}

const saveSettingsLocal = () => lsSet(LS.settings, state.settings);
const saveProductsLocal = () => lsSet(LS.products, state.products);
const saveCartLocal     = () => lsSet(LS.cart, [...state.cart]);

/* ==========================================================================
   4. JEMBATAN KE GOOGLE APPS SCRIPT
   Semua request dikirim sebagai POST dengan Content-Type text/plain
   agar dianggap "simple request" (tanpa preflight OPTIONS yang
   tidak didukung Apps Script).
   ========================================================================== */
async function api(action, payload = {}, timeoutMs = 30000, urlOverride = null){
  const url = urlOverride || state.settings.scriptUrl;
  if (!url) throw new Error('MODE_DEMO');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Server menolak permintaan');
    return json;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Waktu tunggu habis — periksa koneksi');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Tarik seluruh katalog dari Google Sheets ke cache lokal
async function syncFromServer(){
  if (isDemo()){
    toast('Masih Mode Demo — isi URL Apps Script terlebih dahulu.', 'info');
    return;
  }
  setLoading(true, 'Menarik data dari Google Sheets…');
  try {
    const res = await api('getProducts');
    state.products = (res.data || []).map(p => {
      // kolom Galeri berisi JSON array URL — data lama (tanpa galeri) tetap aman
      const imgs = Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : [];
      return {
        id:       String(p.id || ''),
        name:     String(p.name || ''),
        category: String(p.category || ''),
        price:    Number(p.price) || 0,
        desc:     String(p.desc || ''),
        image:    String(p.image || '') || (imgs[0] || ''),
        images:   imgs,
      };
    });
    saveProductsLocal();

    // buang item keranjang yang produknya sudah tidak ada di server
    [...state.cart.keys()].forEach(id => {
      if (!state.products.some(p => p.id === id)) state.cart.delete(id);
    });
    saveCartLocal();

    renderAll();
    updateCartUI();
    toast(`Katalog tersinkron — ${state.products.length} produk`);
  } catch (err) {
    toast('Gagal sinkron: ' + err.message, 'err');
  } finally {
    setLoading(false);
  }
}

// Tambah / perbarui satu produk di cache lokal
function upsertProductLocal(p){
  const imgs = Array.isArray(p.images) ? p.images.map(String).filter(Boolean) : [];
  const norm = {
    id: String(p.id), name: p.name, category: p.category || '',
    price: Number(p.price) || 0, desc: p.desc || '',
    image: p.image || imgs[0] || '',
    images: imgs,
  };
  const i = state.products.findIndex(x => x.id === norm.id);
  if (i >= 0) state.products[i] = norm; else state.products.unshift(norm);
  saveProductsLocal();
}

/* ==========================================================================
   5. KOMPRESI GAMBAR (Canvas API)
   Sisi terpanjang dibatasi 900px, hasil JPEG kualitas 0.82 —
   cukup tajam untuk katalog, jauh lebih ringan untuk diunggah.
   ========================================================================== */
function compressImage(file, maxSide = 900, quality = 0.82){
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpe?g)$/.test(file.type)){
      return reject(new Error('Hanya berkas JPG / PNG yang didukung'));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Berkas bukan gambar yang valid'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width  * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#FFFFFF';        // ratakan PNG transparan ke putih
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ==========================================================================
   6. RENDER — HALAMAN KASIR
   ========================================================================== */
function renderPOS(){
  const q = $('#posSearch').value.trim().toLowerCase();
  const all = state.products;
  const list = q
    ? all.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q))
    : all;

  $('#posGrid').innerHTML = list.map(productCardHTML).join('');
  $('#posCount').textContent = q
    ? `${list.length} dari ${all.length} produk`
    : `${all.length} produk`;

  const empty = $('#posEmpty');
  if (list.length === 0){
    empty.classList.remove('hidden');
    if (all.length === 0){
      $('#emptyTitle').textContent = 'Belum ada produk';
      $('#emptyText').textContent  = 'Tambahkan produk lewat tab Katalog agar bisa mulai berjualan.';
      $('#emptyGoCatalog').classList.remove('hidden');
    } else {
      $('#emptyTitle').textContent = 'Tidak ditemukan';
      $('#emptyText').textContent  = `Tidak ada produk yang cocok dengan “${q}”.`;
      $('#emptyGoCatalog').classList.add('hidden');
    }
  } else {
    empty.classList.add('hidden');
  }
  refreshIcons();
}

// kartu memakai data-open: ketukan pada kartu membuka detail,
// ketukan pada tombol "+" (span .p-add) tetap menambah ke keranjang
function productCardHTML(p){
  const entry = state.cart.get(p.id);
  const qty = entry ? entry.qty : 0;
  const fallback = `<span class="p-thumb-fallback">${escapeHtml(initialOf(p.name))}</span>`;
  return `
  <button class="p-card ${qty ? 'in-cart' : ''}" type="button" data-open="${escapeHtml(p.id)}">
    <span class="p-thumb">
      ${fallback}
      ${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.remove()">` : ''}
    </span>
    ${p.category ? `<span class="p-cat">${escapeHtml(p.category)}</span>` : ''}
    <span class="p-name">${escapeHtml(p.name)}</span>
    <span class="p-price">${rupiah(p.price)}</span>
    ${qty ? `<span class="p-badge">${qty}×</span>` : ''}
    <span class="p-add"><i data-lucide="plus"></i></span>
  </button>`;
}

/* ==========================================================================
   7. RENDER — HALAMAN KATALOG
   ========================================================================== */
function renderCatalog(){
  $('#catalogList').innerHTML = state.products.map(catalogRowHTML).join('');
  $('#catalogEmpty').classList.toggle('hidden', state.products.length > 0);
  refreshIcons();
}

function catalogRowHTML(p){
  const fallback = `<span class="p-thumb-fallback">${escapeHtml(initialOf(p.name))}</span>`;
  return `
  <div class="cat-item">
    <span class="cat-thumb">
      ${fallback}
      ${p.image ? `<img src="${escapeHtml(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
    </span>
    <div class="cat-info">
      <div class="cat-name">${escapeHtml(p.name)}</div>
      <div class="cat-meta">
        ${p.category ? `<span class="cat-tag">${escapeHtml(p.category)}</span>` : ''}
        ${p.desc ? `<span class="cat-desc">${escapeHtml(p.desc)}</span>` : ''}
      </div>
      <div class="cat-price">${rupiah(p.price)}</div>
    </div>
    <div class="cat-actions">
      <button class="icon-btn" type="button" title="Edit" data-edit="${escapeHtml(p.id)}"><i data-lucide="pencil"></i></button>
      <button class="icon-btn danger" type="button" title="Hapus" data-del="${escapeHtml(p.id)}"><i data-lucide="trash-2"></i></button>
    </div>
  </div>`;
}

/* ==========================================================================
   7B. HALAMAN DETAIL PRODUK
   ========================================================================== */
function openProductDetail(id){
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  detailProductId = id;
  renderProductDetail(p);
  pushLayer();                    // (v2.1) tombol kembali HP kembali ke Kasir
  switchView('product');
}

function renderProductDetail(p){
  const imgs = imagesOf(p);
  const gal = $('#detailGallery');

  // galeri foto — bila tidak ada foto, tampilkan huruf awal sebagai fallback
  if (imgs.length === 0){
    gal.innerHTML = `
      <div class="gallery-slide">
        <span class="gallery-fallback">${escapeHtml(initialOf(p.name))}</span>
      </div>`;
  } else {
    gal.innerHTML = imgs.map((src, i) => `
      <div class="gallery-slide">
        <img src="${escapeHtml(src)}" alt="Foto ${i + 1} dari ${escapeHtml(p.name)}">
        ${imgs.length > 1 ? `<span class="slide-count">${i + 1}/${imgs.length}</span>` : ''}
        <button class="dl-btn" type="button" data-dl="${i}" title="Unduh foto ini (JPG)">
          <i data-lucide="download"></i>
        </button>
      </div>`).join('');
  }
  gal.scrollLeft = 0;

  // titik navigasi galeri — hanya bila foto lebih dari satu
  $('#detailDots').innerHTML = imgs.length > 1
    ? imgs.map((_, i) =>
        `<button type="button" data-dot="${i}" class="${i === 0 ? 'active' : ''}" aria-label="Foto ${i + 1}"></button>`).join('')
    : '';

  // teks detail
  $('#dpCat').textContent = p.category || '';
  $('#dpCat').classList.toggle('hidden', !p.category);
  $('#dpName').textContent  = p.name;
  $('#dpPrice').textContent = rupiah(p.price);

  const desc = $('#dpDesc');
  if (p.desc){
    desc.textContent = p.desc;
    desc.classList.remove('placeholder');
  } else {
    desc.textContent = 'Tidak ada keterangan untuk produk ini.';
    desc.classList.add('placeholder');
  }
  refreshIcons();
}

// Unduh satu foto sebagai JPG — lewat Blob agar nama berkas bisa diatur;
// bila CORS memblokir (mis. host Drive), fallback: buka di tab baru.
async function downloadImage(url, filename){
  setLoading(true, 'Menyiapkan unduhan…');
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    toast('Foto diunduh');
  } catch {
    window.open(url, '_blank');
  } finally {
    setLoading(false);
  }
}

/* ==========================================================================
   8. KERANJANG BELANJA (state real-time via manipulasi DOM)
   tiap entri: { qty, price } — price = harga khusus opsional
   ========================================================================== */
function cartCount(){
  return [...state.cart.values()].reduce((a, e) => a + e.qty, 0);
}
function cartTotal(){
  let sum = 0;
  state.cart.forEach((entry, id) => {
    const p = state.products.find(x => x.id === id);
    if (p) sum += unitPriceOf(entry, p) * entry.qty;
  });
  return sum;
}

function addToCart(id){
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const cur = state.cart.get(id);
  // harga khusus dipertahankan bila item sudah ada di keranjang
  state.cart.set(id, { qty: (cur ? cur.qty : 0) + 1, price: cur ? cur.price : undefined });
  saveCartLocal();
  updateCartUI(true);
}

function changeQty(id, delta){
  const cur = state.cart.get(id);
  if (!cur) return;
  const next = cur.qty + delta;
  if (next <= 0) state.cart.delete(id);
  else state.cart.set(id, { qty: next, price: cur.price });
  saveCartLocal();
  updateCartUI();
}

function updateCartUI(bump = false){
  const n = cartCount();
  const bar = $('#cartBar');
  bar.classList.toggle('hidden', n === 0);
  $('#cartBarCount').textContent = n;
  $('#cartBarTotal').textContent = rupiah(cartTotal());

  // efek "pop" kecil tiap kali item ditambahkan
  if (bump && n > 0){
    bar.classList.remove('bump');
    void bar.offsetWidth;              // paksa reflow agar animasi bisa diulang
    bar.classList.add('bump');
  }
  renderCartItems();
  // perbarui badge kartu juga saat berada di halaman detail produk,
  // agar badge tidak basi ketika pengguna kembali ke Kasir
  if (state.view === 'pos' || state.view === 'product') renderPOS();
}

function renderCartItems(){
  const wrap = $('#cartItems');
  if (state.cart.size === 0){
    wrap.innerHTML = `<div class="cart-empty">Keranjang masih kosong.<br>Ketuk produk di halaman Kasir untuk menambah.</div>`;
  } else {
    wrap.innerHTML = [...state.cart.entries()].map(([id, entry]) => {
      const p = state.products.find(x => x.id === id);
      if (!p) return '';
      const unit = unitPriceOf(entry, p);
      const isCustom = entry.price != null && entry.price !== p.price;
      return `
      <div class="cart-item">
        <div class="ci-info">
          <strong>${escapeHtml(p.name)}</strong>
          <div class="ci-price-row">
            ${isCustom ? `<s class="ci-old">${rupiah(p.price)}</s>` : ''}
            <span class="ci-price ${isCustom ? 'custom' : ''}">${rupiah(unit)} / item</span>
            <button class="ci-edit" type="button" data-price="${escapeHtml(id)}" title="Ubah harga"><i data-lucide="pencil"></i></button>
          </div>
        </div>
        <div class="stepper">
          <button type="button" data-dec="${escapeHtml(id)}" aria-label="Kurangi"><i data-lucide="minus"></i></button>
          <span>${entry.qty}</span>
          <button type="button" data-inc="${escapeHtml(id)}" aria-label="Tambah"><i data-lucide="plus"></i></button>
        </div>
        <span class="ci-sub">${rupiah(unit * entry.qty)}</span>
      </div>`;
    }).join('');
  }
  $('#cartTotal').textContent = rupiah(cartTotal());
  refreshIcons();
}

function openCartSheet(){
  pushLayer();                      // (v2.1) daftarkan ke tombol kembali HP
  $('#sheetBackdrop').classList.add('show');
  $('#cartSheet').classList.add('show');
  document.body.classList.add('no-scroll');
}
function closeCartSheet(){
  popLayer();                       // (v2.1) consume entri history-nya
  $('#sheetBackdrop').classList.remove('show');
  $('#cartSheet').classList.remove('show');
  document.body.classList.remove('no-scroll');
}

/* ---------- Modal ubah harga khusus ---------- */
function openPriceModal(id){
  const p = state.products.find(x => x.id === id);
  const entry = state.cart.get(id);
  if (!p || !entry) return;
  priceEditId = id;
  pushLayer();                      // (v2.1) daftarkan ke tombol kembali HP
  $('#pmName').textContent = p.name;
  $('#pmHint').textContent = `Harga normal: ${rupiah(p.price)}. Kosongkan lalu simpan untuk kembali ke harga normal.`;
  const unit = unitPriceOf(entry, p);
  $('#pmPrice').value = unit ? unit.toLocaleString('id-ID') : '';
  $('#priceModal').classList.add('show');
  document.body.classList.add('no-scroll');
  setTimeout(() => $('#pmPrice').select(), 220);
}

function closePriceModal(){
  popLayer();                       // (v2.1) consume entri history-nya
  $('#priceModal').classList.remove('show');
  // keranjang biasanya masih terbuka di belakang — jangan buka kunci scrollnya
  if (!$('#cartSheet').classList.contains('show') &&
      !$('#productModal').classList.contains('show') &&
      !$('#confirmModal').classList.contains('show')){
    document.body.classList.remove('no-scroll');
  }
  priceEditId = null;
}

/* ==========================================================================
   9. CHECKOUT & STRUK
   ========================================================================== */
async function checkout(){
  if (state.cart.size === 0){
    toast('Keranjang masih kosong', 'info');
    return;
  }

  // susun rincian transaksi dari keranjang (harga khusus ikut terpakai)
  const items = [];
  state.cart.forEach((entry, id) => {
    const p = state.products.find(x => x.id === id);
    if (p){
      const unit = unitPriceOf(entry, p);
      items.push({ name: p.name, qty: entry.qty, price: unit, subtotal: unit * entry.qty });
    }
  });
  const total = items.reduce((a, i) => a + i.subtotal, 0);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const receipt = {
    id: `TRX-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    time: now.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
    items, total,
    store: {
      name:  state.settings.storeName,
      addr:  state.settings.storeAddr,
      phone: state.settings.storePhone,
    },
  };

  // arsip lokal untuk rekap mandiri pemilik
  const history = lsGet(LS.history, []);
  history.unshift({ id: receipt.id, time: now.toISOString(), total, items });
  lsSet(LS.history, history.slice(0, 200));

  // catat ke sheet "Transaksi" di background — tidak perlu menunggu
  if (!isDemo()){
    api('checkout', {
      receipt: {
        id: receipt.id,
        summary: items.map(i => `${i.qty}x ${i.name}`).join(', '),
        total,
      },
    }, 15000).catch(() => {});
  }

  // kosongkan keranjang lalu tampilkan struk (harga khusus ikut ter-reset)
  state.cart.clear();
  saveCartLocal();
  updateCartUI();
  closeCartSheet();
  showReceipt(receipt);
}

function showReceipt(r){
  currentReceiptData = r;           // (v2.1) simpan untuk share foto/PDF
  pushLayer();                      // (v2.1) daftarkan ke tombol kembali HP
  $('#receiptBody').innerHTML = `
    <div class="r-store">
      <b>${escapeHtml(r.store.name)}</b>
      ${r.store.addr  ? `<span>${escapeHtml(r.store.addr)}</span>`  : ''}
      ${r.store.phone ? `<span>Telp. ${escapeHtml(r.store.phone)}</span>` : ''}
    </div>
    <div class="r-sep"></div>
    <div class="r-meta"><span>${escapeHtml(r.id)}</span><span>${escapeHtml(r.time)}</span></div>
    <div class="r-sep"></div>
    ${r.items.map(i => `
      <div class="r-line">
        <em>${escapeHtml(i.name)}</em>
        <span class="r-qty">${i.qty} x ${rupiah(i.price)}</span>
      </div>
      <div class="r-line"><em></em><span class="r-qty">${rupiah(i.subtotal)}</span></div>
    `).join('')}
    <div class="r-sep"></div>
    <div class="r-total"><span>TOTAL</span><span>${rupiah(r.total)}</span></div>
    <div class="r-foot">alhamdulillahi jaza kumullahu khoiro</div>
  `;
  currentReceiptText = receiptText(r);
  $('#receiptModal').classList.add('show');
  document.body.classList.add('no-scroll');
}

// versi teks polos untuk dibagikan / disalin
function receiptText(r){
  const line = '------------------------------';
  return [
    `*${r.store.name}*`,
    r.store.addr || null,
    `${r.id} — ${r.time}`,
    line,
    ...r.items.map(i => `${i.qty}x ${i.name} = ${rupiah(i.subtotal)}`),
    line,
    `TOTAL: ${rupiah(r.total)}`,
    'alhamdulillahi jaza kumullahu khoiro',
  ].filter(Boolean).join('\n');
}

function closeReceipt(){
  popLayer();                       // (v2.1) consume entri history-nya
  $('#receiptModal').classList.remove('show');
  document.body.classList.remove('no-scroll');
}

async function copyReceipt(){
  try {
    await navigator.clipboard.writeText(currentReceiptText);
  } catch {
    // fallback untuk browser lama
    const ta = document.createElement('textarea');
    ta.value = currentReceiptText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Struk disalin ke clipboard');
}

/* ==========================================================================
   9B. BAGIKAN NOTA — TEKS / FOTO / PDF (v2.1)
   Foto dirender ke Canvas (dengan logo di pojok atas), PDF dibungkus
   dari JPEG hasil Canvas tanpa library tambahan. Distribusi memakai
   Web Share API agar bisa dikirim ke aplikasi apa pun; fallback: unduh.
   ========================================================================== */

// unduh Blob sebagai berkas (fallback bila Web Share file tidak tersedia)
function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// bagikan nota sebagai teks ke aplikasi apa pun
async function shareReceiptText(){
  if (navigator.share){
    try {
      await navigator.share({ title: 'Nota Transaksi', text: currentReceiptText });
      return;
    } catch (e){
      if (e && e.name === 'AbortError') return; // pengguna membatalkan
    }
  }
  await copyReceipt(); // fallback: salin ke clipboard
}

// bagikan nota sebagai foto (JPG) atau PDF
async function shareReceiptFile(kind){
  if (!currentReceiptData) return;
  const r = currentReceiptData;
  let blob, filename;
  try {
    setLoading(true, 'Menyiapkan nota…');
    const canvas = renderReceiptCanvas(r);
    if (kind === 'pdf'){
      blob = buildPdfFromJpegCanvas(canvas);
      filename = r.id + '.pdf';
    } else {
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
      filename = r.id + '.jpg';
    }
  } catch (err) {
    toast('Gagal menyiapkan nota: ' + err.message, 'err');
    return;
  } finally {
    setLoading(false);
  }

  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })){
    try {
      await navigator.share({ files: [file], title: 'Nota Transaksi' });
      return;
    } catch (e){
      if (e && e.name === 'AbortError') return; // pengguna membatalkan
    }
  }
  saveBlob(blob, filename);
  toast('Nota diunduh — kirim lewat aplikasi lain');
}

// gambar nota ke Canvas: logo di pojok atas + identitas + rincian + total
function renderReceiptCanvas(r){
  const W = 720, PAD = 44, LOGO = 132;
  const F = '"Plus Jakarta Sans", Arial, sans-serif';
  const nameFont  = `700 24px ${F}`;
  const smallFont = `500 19px ${F}`;
  const metaFont  = `600 17px ${F}`;
  const maxTextW  = W - PAD * 2;

  // pembungkus teks alamat agar tidak terpotong
  const meas = document.createElement('canvas').getContext('2d');
  const wrap = (text, font) => {
    meas.font = font;
    const out = [];
    let line = '';
    String(text).split(/\s+/).forEach(w => {
      const t = line ? line + ' ' + w : w;
      if (meas.measureText(t).width > maxTextW && line){ out.push(line); line = w; }
      else line = t;
    });
    if (line) out.push(line);
    return out;
  };

  const addrLines  = r.store.addr  ? wrap(r.store.addr, smallFont) : [];
  const phoneLines = r.store.phone ? ['Telp. ' + r.store.phone] : [];

  // baris item: nama + subtotal, lalu baris kecil qty x harga
  const rows = [];
  r.items.forEach(i => {
    rows.push({ left: i.name, right: rupiah(i.subtotal), font: nameFont, color: '#1B1F1C', indent: 0 });
    rows.push({ left: `${i.qty} x ${rupiah(i.price)}`, right: '', font: smallFont, color: '#8A928B', indent: 16 });
  });

  // tinggi kanvas — urutan penjumlahan persis sama dengan proses menggambar di bawah
  const H = PAD
    + LOGO + 34          // logo
    + 40                 // nama toko
    + addrLines.length  * 26 + (addrLines.length  ? 4 : 0)
    + phoneLines.length * 26 + (phoneLines.length ? 4 : 0)
    + 26                 // garis putus
    + 6 + 26             // baris meta + garis putus
    + rows.length * 34   // item
    + 4 + 26             // garis putus
    + 46                 // TOTAL
    + 24                 // kalimat penutup
    + PAD;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const dashLine = () => {
    ctx.strokeStyle = '#C9CFC9';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 9]);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 26;
  };

  let y = PAD;

  // logo di pojok atas nota (v2.1)
  ctx.save();
  ctx.translate((W - LOGO) / 2, y);
  drawLogo(ctx, LOGO);
  ctx.restore();
  y += LOGO + 34;

  // identitas toko
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1B1F1C';
  ctx.font = `800 30px ${F}`;
  ctx.fillText(r.store.name, W / 2, y);
  y += 40;
  ctx.font = smallFont;
  ctx.fillStyle = '#5A635D';
  addrLines.forEach(l => { ctx.fillText(l, W / 2, y); y += 26; });
  if (addrLines.length) y += 4;
  phoneLines.forEach(l => { ctx.fillText(l, W / 2, y); y += 26; });
  if (phoneLines.length) y += 4;

  dashLine();

  // nomor nota & waktu
  ctx.font = metaFont;
  ctx.fillStyle = '#5A635D';
  ctx.textAlign = 'left';
  ctx.fillText(r.id, PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(r.time, W - PAD, y);
  y += 6;
  dashLine();

  // rincian item
  rows.forEach(row => {
    ctx.textAlign = 'left';
    ctx.font = row.font;
    let left = row.left;
    const maxLeft = maxTextW - (row.right ? ctx.measureText(row.right).width + 24 : 0) - row.indent;
    while (ctx.measureText(left).width > maxLeft && left.length > 1) left = left.slice(0, -2);
    if (left !== row.left) left = left.trimEnd() + '…';
    ctx.fillStyle = row.color;
    ctx.fillText(left, PAD + row.indent, y);
    if (row.right){
      ctx.textAlign = 'right';
      ctx.fillStyle = '#1B1F1C';
      ctx.fillText(row.right, W - PAD, y);
    }
    y += 34;
  });
  y += 4;
  dashLine();

  // total
  ctx.textAlign = 'left';
  ctx.font = `800 26px ${F}`;
  ctx.fillStyle = '#1B1F1C';
  ctx.fillText('TOTAL', PAD, y);
  ctx.textAlign = 'right';
  ctx.fillText(rupiah(r.total), W - PAD, y);
  y += 46;

  // kalimat penutup (v2.1)
  ctx.textAlign = 'center';
  ctx.font = `600 19px ${F}`;
  ctx.fillStyle = '#5A635D';
  ctx.fillText('alhamdulillahi jaza kumullahu khoiro', W / 2, y);

  return cv;
}

// bungkus JPEG hasil Canvas menjadi berkas PDF valid (tanpa library tambahan)
function buildPdfFromJpegCanvas(canvas){
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const bin = atob(dataUrl.split(',')[1]);
  const jpeg = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i);

  const W = canvas.width, H = canvas.height;
  const pageW = 595; // lebar A4 dalam poin
  const pageH = Math.max(1, Math.round(pageW * H / W));

  const chunks = [];
  let len = 0;
  const enc = new TextEncoder();
  const addStr = s => { const b = enc.encode(s); chunks.push(b); len += b.length; };
  const addU8  = b => { chunks.push(b); len += b.length; };
  const off = [];

  addStr('%PDF-1.4\n');

  off[1] = len;
  addStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  off[2] = len;
  addStr('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  off[3] = len;
  addStr(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  off[4] = len;
  addStr(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  addU8(jpeg);
  addStr('\nendstream\nendobj\n');

  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`;
  off[5] = len;
  addStr(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);

  const xref = len;
  addStr('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) addStr(String(off[i]).padStart(10, '0') + ' 00000 n \n');
  addStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

/* ==========================================================================
   10. CRUD PRODUK (form modal)
   ========================================================================== */
function openProductModal(id = null){
  pfPhotosDirty = false;
  pushLayer();                      // (v2.1) daftarkan ke tombol kembali HP
  $('#productForm').reset();
  $('#pfId').value = id || '';

  let p = null;
  if (id){
    p = state.products.find(x => x.id === id);
    $('#pfTitle').textContent = 'Edit Produk';
    if (p){
      $('#pfName').value     = p.name;
      $('#pfCategory').value = p.category || '';
      $('#pfPrice').value    = p.price ? p.price.toLocaleString('id-ID') : '';
      $('#pfDesc').value     = p.desc || '';
    }
  } else {
    $('#pfTitle').textContent = 'Tambah Produk';
  }

  pfPhotos = p ? imagesOf(p).slice() : [];
  renderPhotoThumbs();
  fillCategoryList();
  $('#productModal').classList.add('show');
  document.body.classList.add('no-scroll');
  refreshIcons();
  setTimeout(() => $('#pfName').focus(), 260); // keyboard langsung siap
}

function closeProductModal(){
  popLayer();                       // (v2.1) consume entri history-nya
  $('#productModal').classList.remove('show');
  document.body.classList.remove('no-scroll');
}

// render pratinjau multi-foto + tile "tambah foto" di dalam grid
function renderPhotoThumbs(){
  $('#pfPhotoThumbs').innerHTML = pfPhotos.map((src, i) => `
    <div class="photo-thumb">
      <img src="${escapeHtml(src)}" alt="Foto ${i + 1}">
      <button type="button" class="photo-thumb-x" data-rm="${i}" title="Hapus foto"><i data-lucide="x"></i></button>
    </div>`).join('') + `
    <div class="photo-add-tile">
      <i data-lucide="camera"></i>
      <span>${pfPhotos.length ? 'Tambah foto' : 'Ketuk untuk pilih foto'}</span>
      <small>JPG / PNG · bisa beberapa foto</small>
    </div>`;
  refreshIcons();
}

// datalist kategori diisi otomatis dari kategori yang sudah ada
function fillCategoryList(){
  const cats = [...new Set(state.products.map(p => p.category).filter(Boolean))];
  $('#categoryList').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
}

// submit form produk — bekerja di Mode Demo maupun Mode Sheets
async function saveProductFlow(e){
  e.preventDefault();

  const name  = $('#pfName').value.trim();
  const price = parseNumber($('#pfPrice').value);
  if (!name)   { toast('Nama produk wajib diisi', 'err'); return; }
  if (price <= 0){ toast('Harga harus lebih dari 0', 'err'); return; }

  const editingId = $('#pfId').value;
  const isEdit = Boolean(editingId);
  const product = {
    id: isEdit ? editingId : uid(),
    name,
    category: $('#pfCategory').value.trim(),
    price,
    desc: $('#pfDesc').value.trim(),
  };
  // null = daftar foto tidak diubah · array = daftar foto final
  const images = pfPhotosDirty ? pfPhotos.slice() : null;

  setLoading(true, isEdit ? 'Menyimpan perubahan…' : 'Mengunggah produk…');
  try {
    let saved;
    if (isDemo()){
      await new Promise(r => setTimeout(r, 500)); // simulasi jeda server
      const old = isEdit ? (state.products.find(x => x.id === editingId) || {}) : {};
      const arr = images !== null ? images : imagesOf(old);
      saved = { ...product, image: arr[0] || '', images: arr };
    } else {
      const res = await api(isEdit ? 'updateProduct' : 'addProduct', { product, images });
      saved = res.data;
    }
    upsertProductLocal(saved);
    closeProductModal();
    renderAll();
    toast(isEdit ? 'Perubahan disimpan' : 'Produk baru ditambahkan');
  } catch (err) {
    toast('Gagal menyimpan: ' + err.message, 'err');
  } finally {
    setLoading(false);
  }
}

// hapus produk (dengan modal konfirmasi, bukan confirm() bawaan)
async function performDelete(id){
  setLoading(true, 'Menghapus produk…');
  try {
    if (!isDemo()) await api('deleteProduct', { id }, 20000);
    state.products = state.products.filter(p => p.id !== id);
    if (state.cart.has(id)){
      state.cart.delete(id);
      saveCartLocal();
      updateCartUI();
    }
    saveProductsLocal();
    renderAll();
    toast('Produk dihapus');
  } catch (err) {
    toast('Gagal menghapus: ' + err.message, 'err');
  } finally {
    setLoading(false);
  }
}

function askConfirm(title, text, yesLabel, cb){
  pushLayer();                      // (v2.1) daftarkan ke tombol kembali HP
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent  = text;
  $('#confirmYes').textContent   = yesLabel;
  confirmCallback = cb;
  $('#confirmModal').classList.add('show');
  document.body.classList.add('no-scroll');
}
function closeConfirm(){
  popLayer();                       // (v2.1) consume entri history-nya
  $('#confirmModal').classList.remove('show');
  if (!$('#productModal').classList.contains('show')){
    document.body.classList.remove('no-scroll');
  }
  confirmCallback = null;
}

/* ==========================================================================
   11. PENGATURAN (identitas toko & koneksi database)
   ========================================================================== */
function renderSettings(){
  $('#setName').value      = state.settings.storeName;
  $('#setAddr').value      = state.settings.storeAddr;
  $('#setPhone').value     = state.settings.storePhone;
  $('#setScriptUrl').value = state.settings.scriptUrl;
  $('#statProducts').textContent = state.products.length;
  $('#statTrx').textContent = lsGet(LS.history, []).length;
}

function applySettings(){
  const s = state.settings;
  $('#storeName').textContent = s.storeName || 'Toko Saya';
  $('#storeAddr span').textContent = s.storeAddr || 'Atur alamat di tab Pengaturan';
  document.title = (s.storeName || 'Toko') + ' — Kasir & Katalog';
  $('#demoBanner').classList.toggle('hidden', !isDemo());
  updateNetChip();
  renderSettings();
}

function updateNetChip(){
  const chip = $('#netChip');
  const connected = state.online && !isDemo();
  chip.classList.toggle('online', connected);
  chip.innerHTML = connected
    ? '<i data-lucide="wifi"></i><span>Terhubung Sheets</span>'
    : (isDemo()
        ? '<i data-lucide="wifi-off"></i><span>Mode Demo</span>'
        : '<i data-lucide="wifi-off"></i><span>Offline</span>');
  refreshIcons();
}

async function onSaveSettings(e){
  e.preventDefault();
  const prevUrl = state.settings.scriptUrl;
  state.settings = {
    storeName: $('#setName').value.trim()      || 'Putra 354 Jaya',
    storeAddr: $('#setAddr').value.trim(),
    storePhone: $('#setPhone').value.trim(),
    scriptUrl: $('#setScriptUrl').value.trim(),
  };
  saveSettingsLocal();
  applySettings();
  renderPOS();
  renderCatalog();
  toast('Pengaturan disimpan');

  // URL baru terisi → langsung tarik data dari Sheets
  if (state.settings.scriptUrl && state.settings.scriptUrl !== prevUrl){
    await syncFromServer();
  }
}

async function onTestConnection(){
  const url = $('#setScriptUrl').value.trim();
  if (!url){ toast('Isi URL Web App terlebih dahulu', 'info'); return; }

  const status = $('#testStatus');
  status.className = 'conn-status show';
  status.innerHTML = '<i data-lucide="refresh-cw"></i><span>Menguji koneksi…</span>';
  refreshIcons();

  try {
    await api('ping', {}, 20000, url);
    status.className = 'conn-status ok show';
    status.innerHTML = '<i data-lucide="check"></i><span>Terhubung! Katalog siap disinkronkan.</span>';
    toast('Koneksi ke Google Sheets berhasil');
  } catch (err) {
    status.className = 'conn-status err show';
    status.innerHTML = `<i data-lucide="x"></i><span>${escapeHtml(err.message)}</span>`;
  }
  refreshIcons();
}

/* ==========================================================================
   12. NAVIGASI TAB
   ========================================================================== */
function switchView(name){
  const prev = state.view;          // (v2.1) catat view sebelumnya
  state.view = name;
  document.body.dataset.view = name;
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  window.scrollTo({ top: 0 });
  // (v2.1) meninggalkan halaman detail lewat tab → konsumsi entri history-nya
  if (prev === 'product' && name !== 'product') popLayer();
  if (name === 'settings') renderSettings();
}

/* ==========================================================================
   12B. TOMBOL KEMBALI HP (v2.1)
   Setiap layer (sheet/modal/halaman detail) mendaftarkan satu entri
   history saat dibuka. Tombol kembali HP menutup layer teratas —
   bukan langsung keluar dari aplikasi. Penutupan lewat UI/Esc akan
   meng-consume entri history yang sama agar selalu sinkron.
   ========================================================================== */
let pushedCount = 0;        // jumlah entri history yang masih tercatat
let popGuard = 0;           // penanda popstate yang dipicu history.back() internal
let closingFromPop = false; // true saat penutupan dipicu tombol kembali HP

function pushLayer(){
  try {
    history.pushState({ p354: true }, '');
    pushedCount++;
  } catch (e) { /* lingkungan terbatas — abaikan */ }
}

function popLayer(){
  if (closingFromPop) return;       // sudah dipop oleh tombol kembali HP
  if (pushedCount > 0){
    pushedCount--;
    try {
      popGuard++;
      history.back();
    } catch (e) {
      popGuard--;
    }
  }
}

// menutup satu layer teratas yang sedang terbuka (dipanggil dari popstate)
function closeTopmostLayer(){
  if ($('#receiptModal').classList.contains('show')) closeReceipt();
  else if ($('#confirmModal').classList.contains('show')) closeConfirm();
  else if ($('#priceModal').classList.contains('show')) closePriceModal();
  else if ($('#productModal').classList.contains('show')) closeProductModal();
  else if ($('#cartSheet').classList.contains('show')) closeCartSheet();
  else if (state.view === 'product') switchView('pos');
}

/* ==========================================================================
   13. PWA — manifest dinamis, logo via Canvas, service worker
   ========================================================================== */

/* ---------- (v2.1) logo "Putra 354 Jaya" — digambar via Canvas ----------
   Perisai merah bersinar kuning, teks PUTRA (putih), 354 (biru),
   JAYA (putih). Dipakai untuk: ikon aplikasi (manifest), logo pojok
   kiri atas, dan nota dalam bentuk foto/PDF. */
function drawLogo(ctx, S){
  const u = S / 512;
  const FAM = '"Plus Jakarta Sans", "Arial Black", Arial, sans-serif';

  ctx.save();

  // jalur perisai (heater shield)
  const shield = () => {
    ctx.beginPath();
    ctx.moveTo(54*u, 42*u);
    ctx.quadraticCurveTo(256*u, 84*u, 458*u, 42*u);
    ctx.bezierCurveTo(478*u, 150*u, 482*u, 255*u, 404*u, 372*u);
    ctx.bezierCurveTo(360*u, 455*u, 305*u, 494*u, 256*u, 506*u);
    ctx.bezierCurveTo(207*u, 494*u, 152*u, 455*u, 108*u, 372*u);
    ctx.bezierCurveTo(30*u, 255*u, 34*u, 150*u, 54*u, 42*u);
    ctx.closePath();
  };

  // dasar merah
  shield();
  ctx.fillStyle = '#E02020';
  ctx.fill();

  // sinaris kuning (terpotong bentuk perisai)
  ctx.save();
  shield();
  ctx.clip();
  ctx.fillStyle = '#FFDB00';
  const cx = 256*u, cy = 262*u, R = 430*u, half = 7.5 * Math.PI / 180;
  for (let i = 0; i < 12; i++){
    const a = i * 30 * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a - half), cy + R * Math.sin(a - half));
    ctx.lineTo(cx + R * Math.cos(a + half), cy + R * Math.sin(a + half));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // garis tepi hitam
  shield();
  ctx.lineWidth = 14*u;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#141414';
  ctx.stroke();

  // teks dengan garis luar — urutan gambar: hitam → putih → isi warna
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fitted = (txt, targetW, weight) => {
    ctx.font = `${weight} 100px ${FAM}`;
    const w = ctx.measureText(txt).width || 1;
    return Math.max(10, Math.floor(100 * targetW / w));
  };
  const outlined = (txt, x, yy, font, fill, rings) => {
    ctx.font = font;
    rings.forEach(([col, lw]) => { ctx.lineWidth = lw*u; ctx.strokeStyle = col; ctx.strokeText(txt, x, yy); });
    ctx.fillStyle = fill;
    ctx.fillText(txt, x, yy);
  };

  outlined('PUTRA', 256*u, 112*u,
    `800 ${fitted('PUTRA', 235*u, 800)}px ${FAM}`, '#FFFFFF', [['#141414', 9]]);

  // spasi antar huruf JAYA (diabaikan otomatis oleh browser lama)
  ctx.letterSpacing = Math.round(9*u) + 'px';
  outlined('JAYA', 256*u, 372*u,
    `800 ${fitted('JAYA', 200*u, 800)}px ${FAM}`, '#FFFFFF', [['#141414', 8]]);
  ctx.letterSpacing = '0px';

  outlined('354', 256*u, 258*u,
    `800 ${fitted('354', 320*u, 800)}px ${FAM}`, '#1D3F9E', [['#141414', 17], ['#FFFFFF', 9]]);

  ctx.restore();
}

function makeIconDataUrl(size){
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#FFFFFF';                 // latar putih agar aman di semua launcher
  ctx.fillRect(0, 0, size, size);
  const inner = Math.round(size * 0.72);     // perisai + margin aman (maskable)
  ctx.translate(Math.round((size - inner) / 2), Math.round((size - inner) / 2));
  drawLogo(ctx, inner);
  return cv.toDataURL('image/png');
}

function initPWA(){
  // (v2.1) logo pojok kiri atas — digambar ulang setelah font siap agar rapi
  const setHeaderLogo = () => { $('#appLogo').src = makeIconDataUrl(96); };
  setHeaderLogo();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(setHeaderLogo);

  // tunggu font termuat agar ikon konsisten — lalu pasang manifest via Blob URL
  const applyManifest = () => {
    try {
      const manifest = {
        name: 'Putra 354 Jaya — Kasir & Katalog',
        short_name: 'Putra 354',
        description: 'Katalog digital dan kasir harian toko Putra 354 Jaya.',
        start_url: location.href.split('#')[0],
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F8F9FA',
        theme_color: '#2E7D32',
        icons: [
          { src: makeIconDataUrl(192), sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: makeIconDataUrl(512), sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      };
      const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
      $('#manifestLink').href = URL.createObjectURL(blob);
    } catch { /* manifest bersifat penambah — aplikasi tetap jalan tanpanya */ }
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(applyManifest);
  else applyManifest();

  // service worker opsional — cukup sediakan berkas sw.js di folder yang sama
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')){
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ==========================================================================
   14. SEMUA EVENT LISTENER
   ========================================================================== */
function bindEvents(){

  // --- navigasi tab ---
  $$('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $('#emptyGoCatalog').addEventListener('click', () => switchView('catalog'));
  $('#demoBannerBtn').addEventListener('click', () => switchView('settings'));

  // --- halaman kasir ---
  $('#posSearch').addEventListener('input', renderPOS);
  $('#posGrid').addEventListener('click', e => {
    // tombol "+" pada kartu → langsung masuk keranjang
    if (e.target.closest('.p-add')){
      const card = e.target.closest('.p-card');
      if (card) addToCart(card.dataset.open);
      return;
    }
    // area kartu lainnya → buka halaman detail produk
    const card = e.target.closest('[data-open]');
    if (card) openProductDetail(card.dataset.open);
  });

  // --- halaman detail produk ---
  $('#btnBackDetail').addEventListener('click', () => switchView('pos'));
  $('#dpAddBtn').addEventListener('click', () => {
    if (detailProductId) addToCart(detailProductId);
  });

  const gal = $('#detailGallery');
  // geser galeri → perbarui titik navigasi
  gal.addEventListener('scroll', () => {
    const i = Math.round(gal.scrollLeft / Math.max(gal.clientWidth, 1));
    $$('#detailDots button').forEach((d, j) => d.classList.toggle('active', j === i));
  });
  // ketuk titik → lompat ke foto terkait
  $('#detailDots').addEventListener('click', e => {
    const d = e.target.closest('[data-dot]');
    if (!d) return;
    gal.scrollTo({ left: Number(d.dataset.dot) * gal.clientWidth, behavior: 'smooth' });
  });
  // tombol unduh pada tiap slide foto
  gal.addEventListener('click', e => {
    const btn = e.target.closest('[data-dl]');
    if (!btn) return;
    const p = state.products.find(x => x.id === detailProductId);
    if (!p) return;
    const imgs = imagesOf(p);
    const idx = Number(btn.dataset.dl);
    downloadImage(imgs[idx], `${slugify(p.name)}-${idx + 1}.jpg`);
  });

  // --- keranjang ---
  $('#cartBar').addEventListener('click', openCartSheet);
  $('#btnCloseCart').addEventListener('click', closeCartSheet);
  $('#sheetBackdrop').addEventListener('click', closeCartSheet);
  $('#btnClearCart').addEventListener('click', () => {
    if (state.cart.size === 0) return;
    askConfirm('Kosongkan keranjang?', 'Semua item yang sudah dipilih akan dibuang.', 'Kosongkan', () => {
      state.cart.clear();
      saveCartLocal();
      updateCartUI();
      closeCartSheet();
      toast('Keranjang dikosongkan');
    });
  });
  $('#cartItems').addEventListener('click', e => {
    // tombol ubah harga khusus
    const pr = e.target.closest('[data-price]');
    if (pr){ openPriceModal(pr.dataset.price); return; }

    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) changeQty(inc.dataset.inc, +1);
    if (dec) changeQty(dec.dataset.dec, -1);
  });
  $('#btnCheckout').addEventListener('click', checkout);

  // --- modal ubah harga ---
  $('#pmPrice').addEventListener('input', e => {
    const n = parseNumber(e.target.value);
    e.target.value = n ? n.toLocaleString('id-ID') : '';
  });
  $('#pmSave').addEventListener('click', () => {
    const p = state.products.find(x => x.id === priceEditId);
    const entry = state.cart.get(priceEditId);
    if (!p || !entry){ closePriceModal(); return; }
    const v = parseNumber($('#pmPrice').value);
    if (v > 0 && v !== p.price){
      entry.price = v;
      toast('Harga khusus diterapkan');
    } else {
      entry.price = undefined; // kosong / sama dengan harga normal → kembali normal
      toast('Harga kembali normal');
    }
    state.cart.set(priceEditId, entry);
    saveCartLocal();
    updateCartUI();
    closePriceModal();
  });
  $('#pmCancel').addEventListener('click', closePriceModal);
  $('#priceModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closePriceModal();
  });

  // --- katalog ---
  $('#addProductBtn').addEventListener('click', () => openProductModal());
  $('#catalogList').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) openProductModal(ed.dataset.edit);
    if (dl){
      const p = state.products.find(x => x.id === dl.dataset.del);
      if (p) askConfirm('Hapus produk?', `“${p.name}” akan dihapus dari katalog dan Google Sheets.`, 'Hapus', () => performDelete(p.id));
    }
  });

  // --- form produk ---
  $('#productForm').addEventListener('submit', saveProductFlow);
  $('#btnCancelProduct').addEventListener('click', closeProductModal);
  $('#productModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProductModal();
  });

  // format harga jadi ribuan saat mengetik (68.000)
  $('#pfPrice').addEventListener('input', e => {
    const n = parseNumber(e.target.value);
    e.target.value = n ? n.toLocaleString('id-ID') : '';
  });

  // unggah multi-foto — kompres satu per satu lalu tampilkan pratinjau
  $('#pfPhotoBox').addEventListener('click', () => $('#pfPhotoInput').click());
  $('#pfPhotoInput').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = ''; // agar berkas yang sama bisa dipilih ulang
    if (files.length === 0) return;
    for (let i = 0; i < files.length; i++){
      setLoading(true, `Mengompres foto ${i + 1}/${files.length}…`);
      try {
        pfPhotos.push(await compressImage(files[i]));
        pfPhotosDirty = true;
        renderPhotoThumbs();
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    setLoading(false);
  });
  $('#pfPhotoThumbs').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (!rm) return;
    e.stopPropagation(); // jangan picu pemilih berkas
    pfPhotos.splice(Number(rm.dataset.rm), 1);
    pfPhotosDirty = true;
    renderPhotoThumbs();
  });

  // --- modal konfirmasi ---
  $('#confirmYes').addEventListener('click', () => {
    const cb = confirmCallback;
    confirmCallback = null;
    closeConfirm();
    if (cb) cb();
  });
  $('#confirmNo').addEventListener('click', closeConfirm);
  $('#confirmModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirm();
  });

  // --- struk ---
  // (v2.1) bagikan serbaguna: teks / foto / PDF ke aplikasi apa pun
  $('#btnShareText').addEventListener('click', shareReceiptText);
  $('#btnSharePhoto').addEventListener('click', () => shareReceiptFile('photo'));
  $('#btnSharePdf').addEventListener('click', () => shareReceiptFile('pdf'));
  $('#btnCopyReceipt').addEventListener('click', copyReceipt);
  $('#btnDoneReceipt').addEventListener('click', closeReceipt);

  // --- pengaturan ---
  $('#setForm').addEventListener('submit', onSaveSettings);
  $('#btnTestConn').addEventListener('click', onTestConnection);
  $('#btnSync').addEventListener('click', syncFromServer);

  // --- tombol Esc menutup lapisan teratas ---
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('#receiptModal').classList.contains('show'))       closeReceipt();
    else if ($('#confirmModal').classList.contains('show'))  closeConfirm();
    else if ($('#priceModal').classList.contains('show'))    closePriceModal();
    else if ($('#productModal').classList.contains('show'))  closeProductModal();
    else if ($('#cartSheet').classList.contains('show'))     closeCartSheet();
  });

  // --- (v2.1) tombol kembali HP: tutup layer teratas, bukan keluar aplikasi ---
  window.addEventListener('popstate', () => {
    if (popGuard > 0){ popGuard--; return; }   // popstate hasil history.back() internal
    if (pushedCount > 0){
      pushedCount--;
      closingFromPop = true;
      closeTopmostLayer();
      closingFromPop = false;
    }
  });

  // --- status jaringan ---
  window.addEventListener('online',  () => { state.online = true;  updateNetChip(); });
  window.addEventListener('offline', () => { state.online = false; updateNetChip(); });

  // --- PWA: prompt "Instal App" ---
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').classList.remove('hidden');
  });
  $('#installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('Aplikasi terpasang — buka dari home screen');
    deferredPrompt = null;
    $('#installBtn').classList.add('hidden');
  });
}

/* ==========================================================================
   15. INISIALISASI
   ========================================================================== */
function renderAll(){
  renderPOS();
  renderCatalog();
  renderSettings();
  refreshIcons();
}

function init(){
  loadLocal();

  // benih produk contoh untuk percobaan pertama di Mode Demo
  if (state.products.length === 0 && isDemo()){
    state.products = DEMO_PRODUCTS.map(p => ({ ...p }));
    saveProductsLocal();
  }

  bindEvents();
  initPWA();
  applySettings();
  renderAll();

  // Mode Sheets + cache kosong → tarik data pertama kali
  if (!isDemo() && state.products.length === 0){
    syncFromServer();
  }
}

document.addEventListener('DOMContentLoaded', init);
