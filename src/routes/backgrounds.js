// 背景图库 API：内置默认图 + 上传图片 + 全局选择。
import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import db from '../db.js';

const router = Router();
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS = 20;
const BACKGROUND_DIR = resolve(process.env.BACKGROUND_DIR || './data/backgrounds');
const MIME_INFO = {
  'image/jpeg': { ext: '.jpg', matches: (body) => body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff },
  'image/png': { ext: '.png', matches: (body) => body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: '.webp', matches: (body) => body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP' },
};
const imageBody = express.raw({ type: Object.keys(MIME_INFO), limit: MAX_BYTES });

mkdirSync(BACKGROUND_DIR, { recursive: true });

function selectedId() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'background_selected'").get();
  if (!row) return 'default';
  try {
    const value = JSON.parse(row.value);
    return value === 'none' || value === 'default' || /^upload:\d+$/.test(value) ? value : 'default';
  } catch {
    return 'default';
  }
}

function setSelected(id) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('background_selected', ?)").run(JSON.stringify(id));
}

function serialize(row) {
  return {
    id: `upload:${row.id}`,
    name: row.display_name,
    url: `/api/backgrounds/${row.id}/image`,
    builtIn: false,
    size: row.size_bytes,
    createdAt: row.created_at,
  };
}

function safeDisplayName(headerValue, fallback) {
  let value = '';
  try { value = decodeURIComponent(String(headerValue || '')); } catch { value = ''; }
  value = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!value) value = fallback;
  const suffix = extname(value);
  const stem = suffix ? value.slice(0, -suffix.length) : value;
  return (stem.trim() || fallback).slice(0, 80);
}

router.get('/', (req, res) => {
  const uploads = db.prepare('SELECT * FROM backgrounds ORDER BY created_at DESC, id DESC').all().map(serialize);
  const selected = selectedId();
  const selectedExists = selected === 'none' || selected === 'default' || uploads.some((item) => item.id === selected);
  if (!selectedExists) setSelected('default');
  res.json({
    selected: selectedExists ? selected : 'default',
    items: [
      { id: 'none', name: '无背景', url: null, builtIn: true },
      { id: 'default', name: '默认背景', url: '/bg.jpg', builtIn: true },
      ...uploads,
    ],
    limits: { maxBytes: MAX_BYTES, maxUploads: MAX_UPLOADS },
  });
});

router.put('/selection', (req, res) => {
  const id = req.body?.id;
  if (id !== 'none' && id !== 'default' && !/^upload:\d+$/.test(String(id || ''))) {
    return res.status(400).json({ error: '背景选项无效' });
  }
  if (String(id).startsWith('upload:')) {
    const numericId = Number(String(id).slice(7));
    if (!db.prepare('SELECT 1 FROM backgrounds WHERE id = ?').get(numericId)) {
      return res.status(404).json({ error: '背景图片不存在' });
    }
  }
  setSelected(id);
  res.json({ ok: true, selected: id });
});

router.post(
  '/',
  imageBody,
  (req, res) => {
    const mime = String(req.headers['content-type'] || '').split(';', 1)[0].toLowerCase();
    const info = MIME_INFO[mime];
    if (!info) return res.status(415).json({ error: '仅支持 JPG、PNG 或 WebP 图片' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: '图片内容不能为空' });
    if (!info.matches(req.body)) return res.status(400).json({ error: '图片内容与文件类型不匹配' });

    const count = db.prepare('SELECT COUNT(*) AS count FROM backgrounds').get().count;
    if (count >= MAX_UPLOADS) return res.status(409).json({ error: `最多保留 ${MAX_UPLOADS} 张上传背景，请先删除旧图片` });

    const filename = `${randomUUID()}${info.ext}`;
    const filePath = join(BACKGROUND_DIR, filename);
    const displayName = safeDisplayName(req.headers['x-file-name'], `背景 ${count + 1}`);
    let inserted;
    try {
      writeFileSync(filePath, req.body, { flag: 'wx' });
      inserted = db.prepare(
        'INSERT INTO backgrounds (display_name, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?)'
      ).run(displayName, filename, mime, req.body.length);
      const id = `upload:${inserted.lastInsertRowid}`;
      setSelected(id);
      res.status(201).json({ ok: true, selected: id, item: serialize(db.prepare('SELECT * FROM backgrounds WHERE id = ?').get(inserted.lastInsertRowid)) });
    } catch (err) {
      try { unlinkSync(filePath); } catch { /* 文件可能尚未创建 */ }
      throw err;
    }
  }
);

router.get('/:id/image', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).end();
  const row = db.prepare('SELECT * FROM backgrounds WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  const path = join(BACKGROUND_DIR, row.filename);
  res.type(row.mime_type);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path, (err) => {
    if (!err) return;
    if (!res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).end();
  });
});

router.delete('/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).json({ error: '背景图片不存在' });
  const row = db.prepare('SELECT * FROM backgrounds WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '背景图片不存在' });

  try {
    unlinkSync(join(BACKGROUND_DIR, row.filename));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const deletingSelected = selectedId() === `upload:${id}`;
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM backgrounds WHERE id = ?').run(id);
    if (deletingSelected) setSelected('default');
  });
  remove();
  res.json({ ok: true, selected: deletingSelected ? 'default' : selectedId() });
});

export default router;
