import jsPDF from "jspdf";

const reportText = `
---
## • CLINICAL SUMMARY
Patient is a 45-year-old male presenting with chest pain.

---
## • FIRST-LINE PHARMACOTHERAPY
| Drug (generic) | Class | Dose & Route | Frequency | Duration | Evidence | Contraindications |
|---|---|---|---|---|---|---|
| Aspirin | Antiplatelet | 325 mg PO | Once | Immediate | [S1] | Active bleeding |
`;

async function testPdf() {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  console.log("jsPDF instantiated successfully");

  const PW = 210, PH = 297;
  const ML = 18, MR = 192;
  const CW = MR - ML;

  const TEAL = [13, 148, 136] as [number, number, number];
  const NAVY = [26, 52, 96] as [number, number, number];
  const DARK = [30, 41, 59] as [number, number, number];
  const MUTED = [100, 116, 139] as [number, number, number];
  const LIGHT = [200, 214, 229] as [number, number, number];
  const WHITE = [255, 255, 255] as [number, number, number];
  const DISC = [176, 190, 197] as [number, number, number];
  const TEAL_BG = [237, 248, 247] as [number, number, number];
  const HEADER_BG = [245, 249, 250] as [number, number, number];

  const tc = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fc = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const dc = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);

  let page = 1;
  let y = 57;

  function drawLetterhead() {
    fc(HEADER_BG); doc.rect(0, 0, PW, 46, "F");
    doc.setFont("times", "bold"); doc.setFontSize(22); tc(NAVY);
    doc.text("MEDIQ", 40, 21);
    doc.setFont("times", "normal"); doc.setFontSize(8.5); tc(TEAL);
    doc.text("CLINICAL INTELLIGENCE", 40, 27);
    const now = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    doc.setFont("times", "normal"); doc.setFontSize(7.5); tc(MUTED);
    doc.text(now, MR, 18, { align: "right" });
    doc.text("AI-Assisted Assessment", MR, 24, { align: "right" });
    doc.text("For Licensed Clinicians Only", MR, 30, { align: "right" });
    dc(TEAL); doc.setLineWidth(0.7); doc.line(ML, 35, MR, 35);
    doc.setFont("times", "bold"); doc.setFontSize(13); tc(NAVY);
    doc.text("CLINICAL ASSESSMENT REPORT", PW / 2, 42, { align: "center" });
    dc(LIGHT); doc.setLineWidth(0.25); doc.line(ML, 52, MR, 52);
    y = 57;
  }

  function drawFooter() {
    dc(LIGHT); doc.setLineWidth(0.25); doc.line(ML, PH - 22, MR, PH - 22);
    const disc = "DISCLAIMER...";
    doc.setFont("times", "italic"); doc.setFontSize(6); tc(DISC);
    const dlines = doc.splitTextToSize(disc, CW) as string[];
    doc.text(dlines, ML, PH - 19);
    doc.setFont("times", "normal"); doc.setFontSize(7); tc(MUTED);
    doc.text("Page " + page, PW / 2, PH - 7, { align: "center" });
  }

  function newPage() {
    drawFooter(); doc.addPage(); page++;
    fc(HEADER_BG); doc.rect(0, 0, PW, 15, "F");
    doc.setFont("times", "bold"); doc.setFontSize(9); tc(NAVY);
    doc.text("MEDIQ", ML, 9);
    doc.setFont("times", "normal"); doc.setFontSize(8); tc(TEAL);
    doc.text("Clinical Assessment Report (continued)", ML + 13, 9);
    dc(TEAL); doc.setLineWidth(0.4); doc.line(ML, 13, MR, 13);
    y = 21;
  }

  const checkY = (n: number) => { if (y + n > PH - 25) newPage(); };

  const isAllCapsHeader = (l: string) => {
    let clean = l.trim();
    if (clean.startsWith("#")) {
      clean = clean.replace(/^#+\s*/, "").trim();
    }
    if (clean.startsWith("•") || clean.startsWith("–") || clean.startsWith("-")) {
      clean = clean.slice(1).trim();
    }
    const textWithoutNumber = clean.replace(/^(\d+[\.\s]+|◆\s*)/, "").trim();
    return /^[A-Z\d\s&\/\-–—:().,]+$/.test(textWithoutNumber) && textWithoutNumber.length >= 3 && clean.length <= 80;
  };
  const isDash = (l: string) => /^[-─═]+$/.test(l.trim()) && l.trim().length >= 3;
  const isTableLine = (l: string) => l.trim().startsWith("|");
  const isNumList = (l: string) => /^\d+\.\s{1,3}/.test(l.trim());
  const isBull = (l: string) => /^[-•]\s{1,3}/.test(l.trim());
  const isSepRow = (l: string) => /^\|[-|\s]+\|$/.test(l.trim());

  drawLetterhead();

  const lines = reportText.split("\n");
  let i = 0;

  const CELL_FS = 10;
  const CELL_LINE_H = 5.0;
  const CELL_TPAD = 2.8;
  const CELL_BPAD = 2.2;
  const CELL_HPad = 2.5;
  const MIN_ROW_H = 8;

  function calcRowH(wrapped: string[][]): number {
    const maxLines = Math.max(...wrapped.map(w => w.length), 1);
    return Math.max(CELL_TPAD + maxLines * CELL_LINE_H + CELL_BPAD, MIN_ROW_H);
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; y += 1.2; continue; }

    if (isTableLine(line)) {
      const tbl: string[] = [];
      while (i < lines.length && (isTableLine(lines[i]) || isSepRow(lines[i]))) { tbl.push(lines[i]); i++; }
      const parseRow = (l: string) => l.split("|").slice(1, -1).map(c => c.trim());
      const si = tbl.findIndex(isSepRow);
      const hdrs = (si > 0 ? tbl.slice(0, si) : [tbl[0]]).flatMap(parseRow);
      const drows = (si >= 0 ? tbl.slice(si + 1) : tbl.slice(1)).filter(l => !isSepRow(l)).map(parseRow).filter(r => r.some(c => c));
      if (!hdrs.length) continue;

      const nCols = hdrs.length;
      const colW = CW / nCols;

      doc.setFont("times", "bold"); doc.setFontSize(CELL_FS);
      const hdrWrapped = hdrs.map(h => doc.splitTextToSize(h, colW - CELL_HPad * 2) as string[]);
      const hdrH = calcRowH(hdrWrapped);

      doc.setFont("times", "normal"); doc.setFontSize(CELL_FS);
      const dataWrapped = drows.map(row =>
        row.map(cell => doc.splitTextToSize(cell || "", colW - CELL_HPad * 2) as string[])
      );
      const dataHs = dataWrapped.map(rw => calcRowH(rw));

      const firstRowH = dataHs[0] ?? 0;
      if (y + hdrH + firstRowH > PH - 25) newPage();

      const drawTableHeader = (): number => {
        fc(TEAL); doc.rect(ML, y, CW, hdrH, "F");
        doc.setFont("times", "bold"); doc.setFontSize(CELL_FS); tc(WHITE);
        hdrWrapped.forEach((wlines, ci) => {
          wlines.forEach((wl, li) => {
            doc.text(wl, ML + ci * colW + CELL_HPad, y + CELL_TPAD + li * CELL_LINE_H);
          });
        });
        for (let ci = 1; ci < nCols; ci++) {
          dc(WHITE); doc.setLineWidth(0.2);
          doc.line(ML + ci * colW, y, ML + ci * colW, y + hdrH);
        }
        return hdrH;
      };

      let segTopY = y;
      y += drawTableHeader();

      dataWrapped.forEach((rowWrapped, ri) => {
        const rH = dataHs[ri];
        if (y + rH > PH - 25) {
          dc(TEAL); doc.setLineWidth(0.4);
          doc.rect(ML, segTopY, CW, y - segTopY, "S");
          newPage();
          segTopY = y;
          y += drawTableHeader();
        }
        if (ri % 2 === 0) { fc(TEAL_BG); doc.rect(ML, y, CW, rH, "F"); }
        doc.setFont("times", "normal"); doc.setFontSize(CELL_FS);
        rowWrapped.forEach((wlines, ci) => {
          tc(ci === 0 ? DARK : MUTED);
          wlines.forEach((wl, li) => {
            doc.text(wl, ML + ci * colW + CELL_HPad, y + CELL_TPAD + li * CELL_LINE_H);
          });
        });
        dc(LIGHT); doc.setLineWidth(0.15);
        doc.line(ML, y + rH, MR, y + rH);
        for (let ci = 1; ci < nCols; ci++) {
          doc.line(ML + ci * colW, y, ML + ci * colW, y + rH);
        }
        y += rH;
      });

      dc(TEAL); doc.setLineWidth(0.4);
      doc.rect(ML, segTopY, CW, y - segTopY, "S");
      y += 3;
      continue;
    }

    if (isDash(line)) { i++; continue; }

    if (isAllCapsHeader(line)) {
      checkY(10); y += 3;
      doc.setFont("times", "bold"); doc.setFontSize(15); tc(TEAL);
      let clean = line.trim();
      if (clean.startsWith("#")) {
        clean = clean.replace(/^#+\s*/, "").trim();
      }
      if (clean.startsWith("•") || clean.startsWith("–") || clean.startsWith("-")) {
        clean = clean.slice(1).trim();
      }
      doc.text(clean, ML, y);
      const tw = doc.getTextWidth(clean);
      dc(TEAL); doc.setLineWidth(0.4); doc.line(ML, y + 1.1, ML + tw, y + 1.1);
      y += 6; i++;
      continue;
    }

    if (isNumList(line)) {
      const wrapped = doc.splitTextToSize(line.trim(), CW - 5) as string[];
      checkY(wrapped.length * 5.2 + 1);
      doc.setFont("times", "normal"); doc.setFontSize(11.5); tc(DARK);
      wrapped.forEach((wl, wi) => { doc.text(wl, ML + (wi > 0 ? 6 : 3), y); y += 5.2; });
      i++; continue;
    }

    if (isBull(line)) {
      const content = line.trim().replace(/^[-•]\s{1,3}/, "");
      const wrapped = doc.splitTextToSize(content, CW - 9) as string[];
      checkY(wrapped.length * 5.2 + 1);
      doc.setFont("times", "normal"); doc.setFontSize(11.5);
      tc(TEAL); doc.text("–", ML + 2, y);
      tc(MUTED);
      wrapped.forEach((wl, wi) => { if (wi > 0) checkY(5.2); doc.text(wl, ML + 7, y); y += 5.2; });
      i++; continue;
    }

    const wrapped = doc.splitTextToSize(line, CW) as string[];
    checkY(wrapped.length * 5.2 + 1);
    doc.setFont("times", "normal"); doc.setFontSize(11.5); tc(DARK);
    wrapped.forEach(wl => { doc.text(wl, ML, y); y += 5.2; });
    i++;
  }

  drawFooter();
  console.log("PDF generated successfully! Pages:", page);
}

testPdf().catch(err => {
  console.error("PDF generation failed:", err);
  process.exit(1);
});
