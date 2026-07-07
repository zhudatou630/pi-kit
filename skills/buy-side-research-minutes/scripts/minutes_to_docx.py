#!/usr/bin/env python3
"""Convert a simple Markdown research note to .docx without external packages."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Iterable
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def xml_text(text: str) -> str:
    attrs = ' xml:space="preserve"' if text[:1].isspace() or text[-1:].isspace() else ""
    return f"<w:t{attrs}>{escape(text)}</w:t>"


def run(text: str, bold: bool = False) -> str:
    if not text:
        return ""
    bold_xml = "<w:b/>" if bold else ""
    return (
        "<w:r>"
        "<w:rPr>"
        f'<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>'
        f"{bold_xml}"
        "</w:rPr>"
        f"{xml_text(text)}"
        "</w:r>"
    )


def inline_runs(markdown: str, force_bold: bool = False) -> str:
    if force_bold:
        return run(markdown, bold=True)

    parts = re.split(r"(\*\*[^*]+\*\*)", markdown)
    rendered: list[str] = []
    for part in parts:
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            rendered.append(run(part[2:-2], bold=True))
        else:
            rendered.append(run(part))
    return "".join(rendered)


def paragraph(text: str, style: str = "Normal", bullet: bool = False, bold: bool = False) -> str:
    indent = '<w:ind w:left="420" w:hanging="260"/>' if bullet else ""
    spacing = '<w:spacing w:before="80" w:after="80" w:line="300" w:lineRule="auto"/>'
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/>{spacing}{indent}</w:pPr>'
    body = inline_runs(f"• {text}" if bullet else text, force_bold=bold)
    return f"<w:p>{ppr}{body}</w:p>"


def is_section_label(line: str) -> bool:
    """Return true for section labels that should get scan-friendly spacing."""
    if line.startswith("**") and line.endswith("**") and len(line) <= 60:
        return True
    if line.endswith(("：", ":")) and len(line) <= 24:
        return True
    return line in {"Q&A", "总结", "调研要点", "后续跟踪重点"}


def section_label_text(line: str) -> str:
    if line.startswith("**") and line.endswith("**"):
        return line[2:-2].strip().rstrip("。.")
    return line.strip().rstrip("。.")


def blocks_from_markdown(markdown: str) -> Iterable[tuple[str, str]]:
    current: list[str] = []
    emitted = False
    pending_blank = False

    def flush_current() -> tuple[str, str] | None:
        nonlocal current
        if not current:
            return None
        text = " ".join(current).strip()
        current = []
        return ("p", text) if text else None

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            item = flush_current()
            if item:
                emitted = True
                yield item
            if emitted:
                pending_blank = True
            continue

        if pending_blank and emitted and is_section_label(line):
            yield ("blank", "")
            emitted = True
        pending_blank = False

        if is_section_label(line):
            item = flush_current()
            if item:
                emitted = True
                yield item
            yield ("bold", section_label_text(line))
            emitted = True
            continue

        if line.startswith("#"):
            item = flush_current()
            if item:
                emitted = True
                yield item
            level = len(line) - len(line.lstrip("#"))
            yield ("bold", line[level:].strip())
            emitted = True
            continue

        if re.match(r"^[-*]\s+", line):
            item = flush_current()
            if item:
                emitted = True
                yield item
            yield ("bullet", re.sub(r"^[-*]\s+", "", line).strip())
            emitted = True
            continue

        if line.endswith(("：", ":")) and len(line) <= 24:
            item = flush_current()
            if item:
                emitted = True
                yield item
            yield ("bold", line)
            emitted = True
            continue

        current.append(line)

    item = flush_current()
    if item:
        yield item


def document_xml(markdown: str) -> str:
    paragraphs: list[str] = []
    for kind, text in blocks_from_markdown(markdown):
        if kind == "blank":
            paragraphs.append(paragraph("", "Normal"))
        elif kind == "bold":
            paragraphs.append(paragraph(text, "Normal", bold=True))
        elif kind == "bullet":
            paragraphs.append(paragraph(text, "Normal", bullet=True))
        else:
            paragraphs.append(paragraph(text, "Normal"))

    body = "\n".join(paragraphs)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}">
  <w:body>
    {body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
'''


CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
'''

PACKAGE_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
'''

DOCUMENT_RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>
'''

STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei" w:cs="Arial"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="220" w:after="120"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="120" w:after="80"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
</w:styles>
'''

SETTINGS = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="{W_NS}">
  <w:defaultTabStop w:val="420"/>
</w:settings>
'''

FONT_TABLE = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="{W_NS}">
  <w:font w:name="Microsoft YaHei"/>
  <w:font w:name="Arial"/>
</w:fonts>
'''


def core_props() -> str:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>buy-side-research-minutes</dc:creator>
  <cp:lastModifiedBy>buy-side-research-minutes</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
'''


APP_PROPS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>buy-side-research-minutes</Application>
</Properties>
'''


def write_docx(markdown: str, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", CONTENT_TYPES)
        docx.writestr("_rels/.rels", PACKAGE_RELS)
        docx.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        docx.writestr("word/document.xml", document_xml(markdown))
        docx.writestr("word/styles.xml", STYLES)
        docx.writestr("word/settings.xml", SETTINGS)
        docx.writestr("word/fontTable.xml", FONT_TABLE)
        docx.writestr("docProps/core.xml", core_props())
        docx.writestr("docProps/app.xml", APP_PROPS)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_md", help="Input Markdown file")
    parser.add_argument("output_docx", help="Output .docx path")
    args = parser.parse_args()

    markdown = Path(args.input_md).read_text(encoding="utf-8")
    write_docx(markdown, Path(args.output_docx))


if __name__ == "__main__":
    main()
