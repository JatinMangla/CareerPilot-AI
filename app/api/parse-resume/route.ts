import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  try {
    let text = "";
    if (name.endsWith(".pdf")) {
      // unpdf wraps a current, serverless build of Mozilla's pdf.js. It replaced
      // pdf-parse, which was unmaintained since 2018 and bundled pdf.js 1.10 to
      // parse files uploaded from anywhere.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const result = await extractText(pdf, { mergePages: true });
      text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
    } else if (name.endsWith(".docx")) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value;
    } else if (name.endsWith(".txt") || name.endsWith(".md")) {
      text = buf.toString("utf-8");
    } else {
      return Response.json(
        { error: "Unsupported file type. Upload PDF, DOCX, TXT, or MD." },
        { status: 400 }
      );
    }

    text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
      return Response.json(
        { error: "Could not extract text — the file may be a scanned image. Paste the text manually instead." },
        { status: 422 }
      );
    }
    return Response.json({ text, fileName: file.name });
  } catch (err: any) {
    return Response.json(
      { error: `Failed to parse file: ${err?.message || "unknown error"}` },
      { status: 500 }
    );
  }
}
