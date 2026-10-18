// Тени с пустой серединой: под самим окном или виджетом их нет, поэтому
// они не просвечивают сквозь вырезанные углы и полупрозрачный фон.
//
// Тень рисуется слоями один раз в маленькую картинку (углы и по пикселю
// края), а на предмет растягивается как border-image: при перемещении и
// изменении размера ничего не перерисовывается.

import Cairo from 'cairo';
import GLib from 'gi://GLib';

export const SHADOW_MARGIN = 28;
const files = new Map();

// blur — ширина размытия, dy — сдвиг вниз, strength — непрозрачность.
export function shadowFile(radius, blur, dy, strength) {
    const key = `${radius}-${blur}-${dy}-${strength}`;
    if (files.has(key))
        return files.get(key);
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'hypede', 'shadows']);
    const path = GLib.build_filenamev([dir, `shadow-v2-${key}.png`]);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        GLib.mkdir_with_parents(dir, 0o755);
        const m = SHADOW_MARGIN, r = radius;
        const size = 2 * (m + r) + 2;
        const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
        const cr = new Cairo.Context(surface);
        const roundRect = (x, y, rw, rh, rr) => {
            rr = Math.max(0, Math.min(rr, rw / 2, rh / 2));
            cr.newSubPath();
            cr.arc(x + rw - rr, y + rr, rr, -Math.PI / 2, 0);
            cr.arc(x + rw - rr, y + rh - rr, rr, 0, Math.PI / 2);
            cr.arc(x + rr, y + rh - rr, rr, Math.PI / 2, Math.PI);
            cr.arc(x + rr, y + rr, rr, Math.PI, 3 * Math.PI / 2);
            cr.closePath();
        };
        const inner = size - 2 * m;
        cr.setFillRule(Cairo.FillRule.EVEN_ODD); // закрашивается только кольцо снаружи
        for (let i = blur; i > 0; i--) {
            // Каждый слой шире предыдущего; прозрачность убывает по гауссу.
            const t = i / blur;
            const alpha = strength * Math.exp(-4 * t * t) / blur * 3;
            cr.setSourceRGBA(0, 0, 0, alpha);
            roundRect(m - i, m - i + dy * (1 - t), inner + 2 * i, inner + 2 * i, r + i);
            roundRect(m, m, inner, inner, r);
            cr.fill();
        }
        cr.$dispose();
        surface.writeToPNG(path);
        surface.finish();
    }
    const uri = GLib.filename_to_uri(path, null);
    files.set(key, uri);
    return uri;
}

// Строка стиля для St.Widget, который лежит под предметом и шире его на
// SHADOW_MARGIN с каждой стороны.
export function shadowStyle(radius, blur, dy, strength) {
    const slice = SHADOW_MARGIN + radius + 1;
    return `border-image: url("${shadowFile(radius, blur, dy, strength)}") ${slice} ${slice} ${slice} ${slice};`;
}
