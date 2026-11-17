import { put, list, del } from '@vercel/blob';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };
const DEFAULT_PASS = 'N78963a756W';

async function getJsonBlob(prefix) {
  const { blobs } = await list({ prefix });
  if (!blobs.length) return null;
  const response = await fetch(blobs[0].url + '?t=' + Date.now());
  if (!response.ok) throw new Error('تعذر قراءة بيانات التخزين');
  return await response.json();
}
async function getCurrentPassword() {
  try {
    const data = await getJsonBlob('admin-auth.json');
    if (data && data.password) return data.password;
  } catch (e) { console.error(e); }
  return DEFAULT_PASS;
}
function collectImageUrls(items) {
  const urls = new Set();
  for (const p of (Array.isArray(items) ? items : [])) {
    if (Array.isArray(p.images)) p.images.forEach(u => { if (typeof u === 'string' && u.startsWith('https://')) urls.add(u); });
    if (typeof p.image === 'string' && p.image.startsWith('https://')) urls.add(p.image);
  }
  return urls;
}
async function cleanupUnusedProductImages(items) {
  // لا نحذف إلا الصور الموجودة في مجلد products/ وغير المستخدمة في بيانات المتجر الحالية.
  const used = collectImageUrls(items);
  const { blobs } = await list({ prefix: 'products/' });
  const unused = blobs.filter(b => !used.has(b.url));
  if (unused.length) await del(unused.map(b => b.url));
}
export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await getJsonBlob('store-data.json');
      return res.status(200).json(data || { categories: null, items: null, settings: {} });
    } catch (error) { return res.status(500).json({ error: error.message }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, payload = {} } = req.body || {};
  const validPassword = await getCurrentPassword();
  if (password !== validPassword) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  try {
    if (action === 'verifyLogin') return res.status(200).json({ success: true });
    if (action === 'changePassword') {
      const newPass = String(payload.newPassword || '').trim();
      if (newPass.length < 8) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
      await put('admin-auth.json', JSON.stringify({ password: newPass }), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
      return res.status(200).json({ success: true });
    }
    if (action === 'uploadImage') {
      if (!payload.base64 || !payload.base64.includes(',')) return res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
      const base64Data = payload.base64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const safeName = String(payload.filename || 'product.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const blob = await put(`products/${Date.now()}-${safeName}`, buffer, { access: 'public', contentType: 'image/jpeg' });
      return res.status(200).json({ url: blob.url });
    }
    if (action === 'saveData') {
      if (!payload || !Array.isArray(payload.categories) || !Array.isArray(payload.items)) {
        return res.status(400).json({ error: 'بيانات المتجر غير مكتملة' });
      }
      // حفظ البيانات أولاً؛ بعدها إزالة صور المنتجات التي لم تعد مستخدمة فقط.
      const blob = await put('store-data.json', JSON.stringify({
        categories: payload.categories,
        items: payload.items,
        settings: payload.settings || {}
      }), { access: 'public', addRandomSuffix: false, contentType: 'application/json' });
      try { await cleanupUnusedProductImages(payload.items); }
      catch (cleanupError) { console.error('Image cleanup warning:', cleanupError); }
      return res.status(200).json({ success: true, url: blob.url });
    }
    return res.status(400).json({ error: 'إجراء غير معروف' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'حدث خطأ في الخادم' });
  }
}
