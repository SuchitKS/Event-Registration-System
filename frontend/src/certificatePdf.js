import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { FONTS, TEMPLATES, fillTokens } from './certificateLib.js';

// US Letter landscape, in PDF points (11 x 8.5 in)
const W = 792;
const H = 612;
const LH = 1.15; // same line-height as the editor CSS

const bytesCache = {};
const getBytes = async (url) => {
  if (!bytesCache[url]) {
    const res = await fetch(`${url}?v=1`);
    if (!res.ok) throw new Error(`Missing file: ${url}`);
    bytesCache[url] = await res.arrayBuffer();
  }
  return bytesCache[url];
};

const hex = (c) => {
  const m = String(c || '#000000').replace('#', '').padEnd(6, '0');
  return rgb(parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255);
};

// Wrap text like CSS white-space: pre-wrap (honours new lines, wraps on spaces)
const wrap = (font, text, size, maxW) => {
  const out = [];
  String(text ?? '').split('\n').forEach((para) => {
    let cur = '';
    para.split(' ').forEach((word) => {
      const test = cur ? `${cur} ${word}` : word;
      if (cur && font.widthOfTextAtSize(test, size) > maxW) { out.push(cur); cur = word; } else cur = test;
    });
    out.push(cur);
  });
  return out;
};

// Draw lines of text inside a box, top of first line at `top` (PDF y-up coordinate)
const drawLines = (page, font, lines, { size, color, left, width, top, align }) => {
  const lh = size * LH;
  const asc = font.heightAtSize(size, { descender: false });
  const full = font.heightAtSize(size);
  lines.forEach((line, i) => {
    if (!line) return;
    const w = font.widthOfTextAtSize(line, size);
    const x = align === 'left' ? left : align === 'right' ? left + width - w : left + (width - w) / 2;
    const baseline = top - i * lh - ((lh - full) / 2 + asc);
    page.drawText(line, { x, y: baseline, size, font, color });
  });
};

const embedImage = async (pdf, src) => {
  if (!src) return null;
  try {
    const bytes = await (await fetch(src)).arrayBuffer();
    return src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg') ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  } catch { return null; }
};

const drawContained = (page, img, bx, by, bw, bh) => {
  const k = Math.min(bw / img.width, bh / img.height);
  const w = img.width * k, h = img.height * k;
  page.drawImage(img, { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, width: w, height: h });
};

/**
 * @param {{template:string, layout:Array, data:Object}} p
 * @returns {Promise<Uint8Array>}
 */
export const generateCertificatePdf = async ({ template, layout, data }) => {
  const tpl = TEMPLATES[template] || TEMPLATES.teal;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([W, H]);

  // Background
  const bg = await pdf.embedJpg(await getBytes(tpl.bg));
  page.drawImage(bg, { x: 0, y: 0, width: W, height: H });

  // Embed only the fonts that are actually used
  const used = [...new Set(layout.filter((e) => e.font).map((e) => e.font))];
  const fonts = {};
  for (const k of used) {
    const def = FONTS[k] || FONTS.Cormorant;
    // Subsetting breaks Allura's glyph mapping, so only the big Cormorant file is subset.
    fonts[k] = await pdf.embedFont(await getBytes(def.file), { subset: k === 'Cormorant' });
  }
  const fontOf = (k) => fonts[k] || fonts[Object.keys(fonts)[0]];

  for (const e of layout) {
    const bx = (e.x / 100) * W;
    const bw = (e.w / 100) * W;
    const bh = (e.h / 100) * H;
    const top = H - (e.y / 100) * H;       // PDF y of the box top
    const by = top - bh;                    // PDF y of the box bottom
    const color = hex(e.color || tpl.base);

    if (e.t === 'text') {
      const font = fontOf(e.font);
      const size = ((e.size || 2) / 100) * W;
      const lines = wrap(font, fillTokens(e.text, data), size, bw);
      const blockH = lines.length * size * LH;
      drawLines(page, font, lines, { size, color, left: bx, width: bw, top: top - (bh - blockH) / 2, align: e.al || 'center' });
    }

    if (e.t === 'line') {
      const th = 0.0018 * W;
      page.drawRectangle({ x: bx, y: by + bh / 2 - th / 2, width: bw, height: th, color });
    }

    if (e.t === 'img') {
      const img = await embedImage(pdf, e.src);
      if (img) drawContained(page, img, bx, by, bw, bh);
    }

    if (e.t === 'sig') {
      const font = fontOf(e.font);
      const size = ((e.size || 1.8) / 100) * W;
      const small = size * 0.8;
      const name = wrap(font, fillTokens(e.name, data), size, bw);
      const desig = wrap(font, fillTokens(e.desig, data), small, bw);
      const dH = desig.filter(Boolean).length ? desig.length * small * LH : 0;
      const nH = name.filter(Boolean).length ? name.length * size * LH : 0;
      const th = 0.0012 * W;
      const margin = 0.2 * size;

      // stack from the bottom of the box upwards (same as the editor's flex column)
      let cursor = by + dH;                         // top of designation block
      drawLines(page, font, desig, { size: small, color, left: bx, width: bw, top: by + dH, align: 'center' });
      drawLines(page, font, name, { size, color, left: bx, width: bw, top: cursor + nH, align: 'center' });
      cursor += nH;                                 // top of name block
      const lineY = cursor + margin;
      page.drawRectangle({ x: bx, y: lineY, width: bw, height: th, color });
      const areaBottom = lineY + th + margin;
      const img = await embedImage(pdf, e.src);
      if (img) {
        const aw = bw * 0.7, ah = top - areaBottom;
        if (ah > 0) drawContained(page, img, bx + (bw - aw) / 2, areaBottom, aw, ah);
      }
    }
  }

  return pdf.save();
};
