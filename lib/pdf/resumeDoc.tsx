import React from "react";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

/**
 * Turns plain resume text into a polished PDF.
 * Parsing heuristics: first line = name, following lines until a blank = contact,
 * ALL-CAPS short lines = section headers, "-"/"•" lines = bullets, rest = paragraphs.
 *
 * Templates:
 *  - "classic": Times serif, centered header, thin rules — looks like a traditional resume.
 *  - "modern":  Helvetica, left-aligned, subtle accent — clean tech style.
 * Both are single-column and ATS-safe.
 */

export type ResumeTemplate = "classic" | "modern";

interface Block {
  type: "section" | "bullet" | "para";
  text: string;
}

interface Parsed {
  name: string;
  contact: string[];
  blocks: Block[];
}

const SECTION_RE = /^[A-Z0-9][A-Z0-9\s&/\-–—:().,+']{1,46}$/;
const BULLET_RE = /^[-•▸*·]\s+/;

/** Words that mark a real section header, so a CAPS name isn't mistaken for one. */
const SECTION_WORDS =
  /\b(summary|objective|profile|experience|employment|history|education|skills?|projects?|certification|achievements?|awards?|contact|interests?|languages?|publications?|references?|training|courses?|activities|volunteer|portfolio|expertise|competenc|highlights?)\b/i;

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSection(line: string): boolean {
  return (
    line.length <= 48 &&
    line === line.toUpperCase() &&
    /[A-Z]/.test(line) &&
    SECTION_RE.test(line)
  );
}

/**
 * The first line of a resume is the candidate's name, but it's often written in
 * CAPS — which also looks exactly like a section header. Decide by content.
 */
function looksLikeName(line: string, fallbackName: string): boolean {
  const clean = line.replace(/\*\*/g, "").trim();
  if (!clean) return false;
  if (normalizeName(clean) === normalizeName(fallbackName)) return true;
  if (SECTION_WORDS.test(clean)) return false;
  if (/[@|:•]|https?:/i.test(clean)) return false; // contact line, not a name
  if (/\d/.test(clean)) return false;
  const words = clean.split(/\s+/);
  return words.length >= 1 && words.length <= 5;
}

export function parseResume(text: string, fallbackName: string): Parsed {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((l) => l.trim());
  let i = 0;
  while (i < lines.length && !lines[i]) i++;

  let name = fallbackName;
  const contact: string[] = [];

  if (i < lines.length && looksLikeName(lines[i], fallbackName)) {
    name = lines[i].replace(/\*\*/g, "");
    i++;
    // contact lines until blank or a real section header (max 3)
    let taken = 0;
    while (i < lines.length && lines[i] && !isSection(lines[i]) && taken < 3) {
      contact.push(lines[i]);
      i++;
      taken++;
    }
  }

  const nameKey = normalizeName(name);
  const contactKeys = new Set(contact.map((c) => c.trim()));

  const blocks: Block[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // The name and contact details are already rendered in the header — never
    // repeat them in the body.
    if (normalizeName(line) === nameKey) continue;
    if (contactKeys.has(line)) continue;

    if (isSection(line)) blocks.push({ type: "section", text: line });
    else if (BULLET_RE.test(line))
      blocks.push({ type: "bullet", text: line.replace(BULLET_RE, "") });
    else blocks.push({ type: "para", text: line });
  }
  return { name, contact, blocks };
}

function makeStyles(template: ResumeTemplate) {
  const serif = template === "classic";
  const font = serif ? "Times-Roman" : "Helvetica";
  const fontBold = serif ? "Times-Bold" : "Helvetica-Bold";
  const accent = serif ? "#1a1a1a" : "#0b6e5a";

  return StyleSheet.create({
    page: {
      paddingVertical: 40,
      paddingHorizontal: 46,
      fontFamily: font,
      fontSize: 9.8,
      color: "#1c1c1c",
      lineHeight: 1.35,
    },
    name: {
      fontFamily: fontBold,
      fontSize: serif ? 21 : 19,
      textAlign: serif ? "center" : "left",
      letterSpacing: serif ? 1.5 : 0.5,
      textTransform: serif ? "uppercase" : "none",
      color: "#111",
      lineHeight: 1.25,
      marginBottom: 7,
    },
    contact: {
      fontSize: 8.6,
      lineHeight: 1.4,
      textAlign: serif ? "center" : "left",
      color: "#444",
      marginBottom: 2,
    },
    headerRule: {
      borderBottomWidth: serif ? 1.2 : 2,
      borderBottomColor: serif ? "#222" : accent,
      marginTop: 9,
      marginBottom: 6,
    },
    section: {
      fontFamily: fontBold,
      fontSize: 10.6,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: serif ? "#111" : accent,
      marginTop: 11,
      marginBottom: 3,
      paddingBottom: 2,
      borderBottomWidth: 0.8,
      borderBottomColor: serif ? "#999" : "#d5ddda",
    },
    bulletRow: { flexDirection: "row", marginBottom: 2.2, paddingLeft: 2 },
    bulletDot: { width: 10, fontSize: 9.8 },
    bulletText: { flex: 1 },
    para: { marginBottom: 2.6 },
  });
}

function ResumeDoc({
  parsed,
  template,
}: {
  parsed: Parsed;
  template: ResumeTemplate;
}) {
  const s = makeStyles(template);
  return (
    <Document title={`${parsed.name} — Resume`} author={parsed.name}>
      <Page size="A4" style={s.page}>
        <Text style={s.name}>{parsed.name}</Text>
        {parsed.contact.length > 0 && (
          <Text style={s.contact}>{parsed.contact.join("  |  ")}</Text>
        )}
        <View style={s.headerRule} />
        {parsed.blocks.map((b, i) => {
          if (b.type === "section")
            return (
              <Text key={i} style={s.section}>
                {b.text}
              </Text>
            );
          if (b.type === "bullet")
            return (
              <View key={i} style={s.bulletRow}>
                <Text style={s.bulletDot}>•</Text>
                <Text style={s.bulletText}>{b.text}</Text>
              </View>
            );
          return (
            <Text key={i} style={s.para}>
              {b.text}
            </Text>
          );
        })}
      </Page>
    </Document>
  );
}

export async function buildResumePdf(
  text: string,
  fallbackName: string,
  template: ResumeTemplate
): Promise<Blob> {
  const parsed = parseResume(text, fallbackName);
  return pdf(<ResumeDoc parsed={parsed} template={template} />).toBlob();
}

/** Simple letter PDF (cover letters etc.) */
export async function buildLetterPdf(
  senderName: string,
  title: string,
  body: string
): Promise<Blob> {
  const s = StyleSheet.create({
    page: {
      padding: 56,
      fontFamily: "Times-Roman",
      fontSize: 10.5,
      color: "#1c1c1c",
      lineHeight: 1.5,
    },
    name: { fontFamily: "Times-Bold", fontSize: 16, marginBottom: 2 },
    title: { fontSize: 9, color: "#555", marginBottom: 18 },
    para: { marginBottom: 8 },
  });
  const doc = (
    <Document title={title} author={senderName}>
      <Page size="A4" style={s.page}>
        <Text style={s.name}>{senderName}</Text>
        <Text style={s.title}>{title}</Text>
        {body
          .split(/\n{2,}|\n/)
          .filter((p) => p.trim())
          .map((p, i) => (
            <Text key={i} style={s.para}>
              {p.trim()}
            </Text>
          ))}
      </Page>
    </Document>
  );
  return pdf(doc).toBlob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
