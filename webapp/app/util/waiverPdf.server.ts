import PDFDocument from "pdfkit";

export interface WaiverPdfData {
  contractorName: string;
  icName: string;
  businessName: string;
  rocLicense: string;
  phone: string;
  email: string;
  hasWcInsurance: boolean;
  insuranceCarrier: string;
  policyNumber: string;
  expirationDate: string;
  signatureName: string;
  signedAt: string; // ISO timestamp
  ipAddress: string;
}

const PURPLE = "#3f2b46";
const PURPLE_LIGHT = "#7f5b8b";
const GREEN = "#5da06d";
const GRAY = "#817186";
const BG = "#fff9f1";

export async function generateWaiverPdf(
  data: WaiverPdfData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: {
        Title: "Arizona Independent Contractor Workers' Compensation Waiver",
        Author: "Nopal Build",
        Subject: "Workers' Compensation Acknowledgment",
        CreationDate: new Date(data.signedAt),
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 144; // total width minus margins

    // ── Header ──────────────────────────────────────────────────────────────
    doc
      .fontSize(9)
      .fillColor(GRAY)
      .text("NOPAL BUILD", { align: "right" });

    doc
      .fontSize(16)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("ARIZONA INDEPENDENT CONTRACTOR", { align: "center" })
      .moveDown(0.2);

    doc
      .fontSize(13)
      .fillColor(PURPLE_LIGHT)
      .font("Helvetica-Bold")
      .text("WORKERS' COMPENSATION ACKNOWLEDGMENT", { align: "center" })
      .moveDown(0.1);

    doc
      .fontSize(11)
      .fillColor(PURPLE_LIGHT)
      .font("Helvetica")
      .text("AND RESPONSIBILITY", { align: "center" })
      .moveDown(1);

    // ── Divider ──────────────────────────────────────────────────────────────
    const startX = doc.page.margins.left;
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + pageWidth, doc.y)
      .strokeColor(PURPLE_LIGHT)
      .lineWidth(0.5)
      .stroke()
      .moveDown(0.8);

    // ── Party Information ────────────────────────────────────────────────────
    doc
      .fontSize(10)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("PARTY INFORMATION", { continued: false })
      .moveDown(0.5);

    const fieldRow = (label: string, value: string) => {
      doc
        .fontSize(9)
        .fillColor(GRAY)
        .font("Helvetica-Bold")
        .text(label.toUpperCase() + ":", { continued: true })
        .font("Helvetica")
        .fillColor(PURPLE)
        .text("  " + (value || "—"), { continued: false })
        .moveDown(0.4);
    };

    fieldRow("Contractor", data.contractorName);
    fieldRow("Independent Contractor Name", data.icName);
    fieldRow("Business Name", data.businessName);
    fieldRow("ROC License No.", data.rocLicense);
    fieldRow("Phone", data.phone);
    fieldRow("Email", data.email);

    doc.moveDown(0.5);

    // ── Divider ──────────────────────────────────────────────────────────────
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + pageWidth, doc.y)
      .strokeColor("#e5d6c5")
      .lineWidth(0.5)
      .stroke()
      .moveDown(0.8);

    // ── Independent Contractor Acknowledgment ────────────────────────────────
    doc
      .fontSize(10)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("INDEPENDENT CONTRACTOR ACKNOWLEDGMENT")
      .moveDown(0.5);

    doc
      .fontSize(9)
      .fillColor(PURPLE)
      .font("Helvetica")
      .text(
        "I certify that I am performing work as an independent contractor and not as an employee of the Contractor identified above.",
        { align: "justify" }
      )
      .moveDown(0.4);

    doc
      .fontSize(9)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("I understand and acknowledge the following:")
      .moveDown(0.4);

    const checkItem = (text: string) => {
      doc
        .fontSize(9)
        .fillColor(GREEN)
        .font("Helvetica-Bold")
        .text("[x] ", { continued: true })
        .fillColor(PURPLE)
        .font("Helvetica")
        .text(text, { indent: 0, align: "justify" })
        .moveDown(0.3);
    };

    checkItem(
      "I am responsible for determining whether Arizona law requires me or my business to maintain workers' compensation insurance."
    );
    checkItem(
      "I am solely responsible for obtaining and maintaining any workers' compensation insurance required by law for myself and any employees I hire."
    );
    checkItem(
      "If I hire or supervise any employees, laborers, or subcontractors, I am solely responsible for complying with all applicable federal, state, and local employment and insurance laws."
    );
    checkItem(
      "I understand that the Contractor is relying upon my representation that I am an independent contractor."
    );
    checkItem(
      "I agree to indemnify and hold harmless the Contractor, Owner, and their agents from any claims, penalties, assessments, or costs arising from my failure to obtain any workers' compensation coverage required by law."
    );
    checkItem(
      "I understand that nothing contained in this document creates an employer-employee relationship."
    );

    doc.moveDown(0.5);

    // ── Divider ──────────────────────────────────────────────────────────────
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + pageWidth, doc.y)
      .strokeColor("#e5d6c5")
      .lineWidth(0.5)
      .stroke()
      .moveDown(0.8);

    // ── Workers' Compensation Coverage ───────────────────────────────────────
    doc
      .fontSize(10)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("WORKERS' COMPENSATION COVERAGE")
      .moveDown(0.5);

    if (data.hasWcInsurance) {
      doc
        .fontSize(9)
        .fillColor(GREEN)
        .font("Helvetica-Bold")
        .text("[x] ", { continued: true })
        .fillColor(PURPLE)
        .font("Helvetica")
        .text("I maintain workers' compensation insurance.")
        .moveDown(0.4);

      fieldRow("Insurance Carrier", data.insuranceCarrier);
      fieldRow("Policy Number", data.policyNumber);
      fieldRow("Expiration Date", data.expirationDate);
    } else {
      doc
        .fontSize(9)
        .fillColor(GREEN)
        .font("Helvetica-Bold")
        .text("[x] ", { continued: true })
        .fillColor(PURPLE)
        .font("Helvetica")
        .text(
          "I do not maintain workers' compensation insurance because I believe it is not required for my business under Arizona law.",
          { align: "justify" }
        )
        .moveDown(0.4);
    }

    doc.moveDown(0.5);

    // ── Divider ──────────────────────────────────────────────────────────────
    doc
      .moveTo(startX, doc.y)
      .lineTo(startX + pageWidth, doc.y)
      .strokeColor("#e5d6c5")
      .lineWidth(0.5)
      .stroke()
      .moveDown(0.8);

    // ── Certification ────────────────────────────────────────────────────────
    doc
      .fontSize(10)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text("CERTIFICATION")
      .moveDown(0.5);

    doc
      .fontSize(9)
      .fillColor(PURPLE)
      .font("Helvetica")
      .text(
        "I certify that the information provided above is true and correct. I understand that providing false information may result in termination of my contract and may subject me to liability under applicable law.",
        { align: "justify" }
      )
      .moveDown(0.8);

    // ── Signature Block ──────────────────────────────────────────────────────
    const signedDate = new Date(data.signedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    // Signature box
    const boxY = doc.y;
    doc
      .rect(startX, boxY, pageWidth, 70)
      .fillColor(BG)
      .fill()
      .rect(startX, boxY, pageWidth, 70)
      .strokeColor("#e5d6c5")
      .lineWidth(0.5)
      .stroke();

    doc
      .fontSize(9)
      .fillColor(GRAY)
      .font("Helvetica-Bold")
      .text("ELECTRONIC SIGNATURE", startX + 12, boxY + 10)
      .moveDown(0.3);

    doc
      .fontSize(14)
      .fillColor(PURPLE)
      .font("Helvetica-Bold")
      .text(data.signatureName, startX + 12, boxY + 26);

    doc
      .fontSize(8)
      .fillColor(GRAY)
      .font("Helvetica")
      .text(`Signed: ${signedDate}`, startX + 12, boxY + 46);

    doc.moveDown(4);

    // ── Audit Trail ──────────────────────────────────────────────────────────
    doc
      .fontSize(7.5)
      .fillColor(GRAY)
      .font("Helvetica")
      .text(
        `AUDIT RECORD — IP Address: ${data.ipAddress} · Timestamp: ${data.signedAt} · Document: Arizona WC Acknowledgment`,
        { align: "center" }
      )
      .moveDown(0.3);

    doc
      .fontSize(7.5)
      .fillColor(GRAY)
      .font("Helvetica")
      .text(
        "This document was electronically signed in accordance with the federal Electronic Signatures in Global and National Commerce Act (ESIGN) and the Uniform Electronic Transactions Act (UETA).",
        { align: "center" }
      );

    doc.end();
  });
}
