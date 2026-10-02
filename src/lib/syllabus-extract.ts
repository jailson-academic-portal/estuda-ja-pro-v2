// Client-side text extraction from PDF / Word files for the syllabus field.
// Runs in the browser (NOT in Workers) — uses pdfjs-dist and mammoth.

export async function extractSyllabusText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.type === "text/plain" || name.endsWith(".txt")) {
    return (await file.text()).trim();
  }
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return extractPdfText(file);
  }
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    return extractDocxText(file);
  }
  if (file.type === "application/msword" || name.endsWith(".doc")) {
    throw new Error("Formato .doc legado não é suportado. Salve como .docx ou PDF.");
  }
  throw new Error("Formato não suportado. Use PDF ou .docx");
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Use a CDN worker that matches the installed version.
  const workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  const max = Math.min(doc.numPages, 50);
  for (let i = 1; i <= max; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    parts.push(text);
  }
  return parts.join("\n\n").replace(/\s+\n/g, "\n").trim();
}

async function extractDocxText(file: File): Promise<string> {
  // mammoth ships a browser build but no separate types — cast to any.
  const mammoth = (await import("mammoth/mammoth.browser.js" as string)) as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
  };
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value.trim();
}
