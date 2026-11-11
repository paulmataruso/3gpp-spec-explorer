# Newer LibreOffice for the legacy Word 6/95/97 parts that LibreOffice 7.4 (converter image) hangs on.
# Used only for .doc/.rtf -> .docx (wvWare for the few Word files LibreOffice hangs on; PDF-only GSM specs -> text, poppler); everything else stays in docker/converter.
#   docker build -t spec-explorer-legacy:1 docker/legacy
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-writer-nogui python3 ca-certificates poppler-utils tesseract-ocr tesseract-ocr-eng wv fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp
