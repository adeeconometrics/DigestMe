# Convert a folder of `.docx` to PDF (LibreOffice headless)

Short and sweet — change `04-27D` to your source dir and `04-27D/pdf` to your output dir.

## 1. Install LibreOffice

```sh
brew install --cask libreoffice
```

## 2. Convert (batch, recursive-friendly)

```sh
mkdir -p "04-27D/pdf"
soffice --headless --norestore -env:UserInstallation=file:///tmp/lo-convert-profile \
  --convert-to pdf --outdir "04-27D/pdf" 04-27D/*.docx
```

## 3. (Optional) Fix double extension

If the PDFs come out named `title.docx.pdf`, strip the extra suffix:

```sh
for f in "04-27D/pdf"/*.docx.pdf; do mv -- "$f" "${f%.docx.pdf}.pdf"; done
```
