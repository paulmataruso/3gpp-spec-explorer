# Figure converter: EMF/WMF -> PNG/SVG via headless LibreOffice, plus pandoc for docx -> HTML.
FROM debian:12-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-draw-nogui libreoffice-writer-nogui fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
      pandoc imagemagick python3 python3-uno ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Calc: the spreadsheets some zips carry beside the document (scraper/docx/attachdocs.py renders them as tables)
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-calc-nogui && rm -rf /var/lib/apt/lists/*
WORKDIR /work
# Debian's ImageMagick policy caps memory at 256MiB, which pushes 4x figure renders to a disk cache
RUN sed -i -e 's/name="memory" value="[^"]*"/name="memory" value="2GiB"/' \
           -e 's/name="map" value="[^"]*"/name="map" value="4GiB"/' \
           -e 's/name="area" value="[^"]*"/name="area" value="512MP"/' \
           -e 's/name="disk" value="[^"]*"/name="disk" value="8GiB"/' /etc/ImageMagick-6/policy.xml
