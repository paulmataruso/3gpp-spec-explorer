"""
Render vector figures (EMF/WMF, also BMP/TIFF) to PNG with one long-lived headless LibreOffice,
exporting just the drawing's bounding box at the requested pixel width. Much faster than
converting each file to a full-page bitmap and trimming it.

    from render_uno import Renderer
    with Renderer() as r:
        r.render('/tmp/image3.emf', '/tmp/image3.png', width_px=1016)
"""
import os, subprocess, time, uuid

import uno  # python3-uno
from com.sun.star.beans import PropertyValue
from com.sun.star.connection import NoConnectException


def _props(**kw):
    out = []
    for k, v in kw.items():
        p = PropertyValue()
        p.Name, p.Value = k, v
        out.append(p)
    return tuple(out)


class Renderer:
    def __init__(self):
        self.proc = None
        self.desktop = None
        self.ctx = None

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *a):
        self.stop()

    def start(self):
        self.pipe = 'specx_' + uuid.uuid4().hex[:8]
        profile = f'file:///tmp/lo_profile_{self.pipe}'
        self.proc = subprocess.Popen(
            ['soffice', '--headless', '--invisible', '--norestore', '--nologo', '--nodefault', '--nolockcheck',
             f'-env:UserInstallation={profile}', f'--accept=pipe,name={self.pipe};urp;StarOffice.ComponentContext'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        for _ in range(120):
            try:
                self.ctx = resolver.resolve(f'uno:pipe,name={self.pipe};urp;StarOffice.ComponentContext')
                break
            except NoConnectException:
                if self.proc.poll() is not None:
                    raise RuntimeError('soffice exited during startup')
                time.sleep(0.25)
        else:
            raise RuntimeError('could not connect to soffice')
        smgr = self.ctx.ServiceManager
        self.desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', self.ctx)
        self.exporter = smgr.createInstanceWithContext('com.sun.star.drawing.GraphicExportFilter', self.ctx)

    def stop(self):
        try:
            if self.desktop:
                self.desktop.terminate()
        except Exception:
            pass
        if self.proc:
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.proc = self.desktop = None

    def restart(self):
        self.stop()
        self.start()

    def render(self, src, dest, width_px=None, max_px=2400):
        """export the figure in `src` to PNG `dest`; returns (w, h) or None"""
        doc = None
        try:
            doc = self.desktop.loadComponentFromURL(uno.systemPathToFileUrl(os.path.abspath(src)), '_blank', 0, _props(Hidden=True))
            if doc is None or not hasattr(doc, 'DrawPages'):
                return None
            page = doc.DrawPages.getByIndex(0)
            if page.Count == 0:
                return None
            shape = page.getByIndex(0)
            size = shape.Size  # 1/100 mm
            if size.Width <= 0 or size.Height <= 0:
                return None
            natural = size.Width / 2540 * 96  # px at 96 dpi
            w = int(width_px or natural * 2)
            w = max(64, min(max_px, w))
            h = max(1, round(w * size.Height / size.Width))
            if h > max_px * 2:  # very tall drawings
                h = max_px * 2
                w = max(1, round(h * size.Width / size.Height))
            filter_data = uno.Any('[]com.sun.star.beans.PropertyValue', _props(PixelWidth=w, PixelHeight=h))
            self.exporter.setSourceDocument(shape)
            self.exporter.filter(_props(URL=uno.systemPathToFileUrl(os.path.abspath(dest)), MediaType='image/png', FilterData=filter_data))
            return (w, h) if os.path.exists(dest) else None
        finally:
            if doc is not None:
                try:
                    doc.close(True)
                except Exception:
                    pass
