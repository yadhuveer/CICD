// src/controllers/export.controller.ts
import { Request, Response } from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import path from "path";
import { fileURLToPath } from "url";
import { Contact } from "../models/Contacts.model.js";
import fs from "fs/promises";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In production (dist/controllers/), go up two levels then into src/assets
// In development (src/controllers/), go up one level then into assets
const assetsDir = path.resolve(__dirname, "../assets/companyAssets");

const logoPath = path.join(assetsDir, "Longwall-Logo.png");
const interRegularPath = path.join(assetsDir, "fonts/Inter-Regular.ttf");
const interBoldPath = path.join(assetsDir, "fonts/Inter-Bold.ttf");
const arialAltPath = path.join(assetsDir, "fonts/LiberationSans-Regular.ttf");

/* -----------------------------------------------------
   HELPERS
----------------------------------------------------- */
function safeString(v: any): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.map(safeString).filter(Boolean).join(", ");
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function normalize(raw: any) {
  return {
    fullName: safeString(raw?.fullName || ""),
    emails: (raw?.emailAddress?.personal || []).concat(raw?.emailAddress?.business || []),
    linkedin: safeString(raw?.linkedinUrl || ""),
    address: safeString(
      Array.isArray(raw?.primaryAddress) ? raw.primaryAddress.join(", ") : raw?.primaryAddress,
    ),
    age: safeString(raw?.age),
    annualEarnedIncome: safeString(raw?.annualEarnedIncome),
    liquidNetWorth: safeString(
      Array.isArray(raw?.liquidNetWorth) ? raw.liquidNetWorth[0] : raw?.liquidNetWorth,
    ),
    assets: Array.isArray(raw?.allAssets) ? raw.allAssets : [],
    liabilities: Array.isArray(raw?.allLiabilities) ? raw.allLiabilities : [],
    informativeInsight: safeString(raw?.insight?.informativeInsight),
    actionableInsight: safeString(raw?.insight?.actionableInsight),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getLogoBase64(): Promise<string> {
  try {
    const logoBuffer = await fs.readFile(logoPath);
    return `data:image/png;base64,${logoBuffer.toString("base64")}`;
  } catch (err) {
    console.error("Logo not found:", err);
    return "";
  }
}

function generateHTML(contacts: any[], logoBase64: string): string {
  const contactsHTML = contacts
    .map((c) => {
      const infoRows: string[] = [];

      if (c.emails.length > 0) {
        infoRows.push(
          `<div class="info-row"><span class="label">Emails:</span> ${escapeHtml(c.emails.join(", "))}</div>`,
        );
      }
      if (c.linkedin) {
        infoRows.push(
          `<div class="info-row"><span class="label">LinkedIn:</span> ${escapeHtml(c.linkedin)}</div>`,
        );
      }
      if (c.address) {
        infoRows.push(
          `<div class="info-row"><span class="label">Address:</span> ${escapeHtml(c.address)}</div>`,
        );
      }
      if (c.age) {
        infoRows.push(
          `<div class="info-row"><span class="label">Age:</span> ${escapeHtml(c.age)}</div>`,
        );
      }

      const financialRows: string[] = [];
      if (c.annualEarnedIncome) {
        financialRows.push(
          `<div class="info-row"><span class="label">Annual Income:</span> ${escapeHtml(`$` + c.annualEarnedIncome)}</div>`,
        );
      }
      if (c.liquidNetWorth) {
        financialRows.push(
          `<div class="info-row"><span class="label">Liquid Net Worth:</span> ${escapeHtml(`$` + c.liquidNetWorth)}</div>`,
        );
      }
      if (c.assets.length > 0) {
        financialRows.push(
          `<div class="info-row"><span class="label">Assets:</span> ${escapeHtml(c.assets.join(", "))}</div>`,
        );
      }
      if (c.liabilities.length > 0) {
        financialRows.push(
          `<div class="info-row"><span class="label">Liabilities:</span> ${escapeHtml(c.liabilities.join(", "))}</div>`,
        );
      }

      // Format insights as numbered lists
      const informativeItems = c.informativeInsight
        ? c.informativeInsight
            .split("\n")
            .filter((line: string) => line.trim())
            .map(
              (line: string, idx: number) =>
                `<li>${escapeHtml(line.replace(/^\d+\.\s*/, ""))}</li>`,
            )
            .join("")
        : "";

      const actionableItems = c.actionableInsight
        ? c.actionableInsight
            .split("\n")
            .filter((line: string) => line.trim())
            .map(
              (line: string, idx: number) =>
                `<li>${escapeHtml(line.replace(/^\d+\.\s*/, ""))}</li>`,
            )
            .join("")
        : "";

      return `
        <div class="page">
          <div class="header-bar"></div>
          ${logoBase64 ? `<img src="${logoBase64}" class="logo" alt="Logo" />` : ""}
          
          <div class="content">
            <div class="name-section">
              <div class="dot"></div>
              <h1>${escapeHtml(c.fullName)}</h1>
            </div>

            <h2>Contact Information</h2>
            <div class="section-content">
              ${infoRows.join("")}
            </div>

            <h2>Financial Overview</h2>
            <div class="section-content">
              ${financialRows.join("")}
            </div>

            <div class="insights-section">
              <div class="dot"></div>
              <h1>Insights</h1>
            </div>

            <div class="insight-content">
              <h3>Informative Insight:</h3>
              ${informativeItems ? `<ol class="insight-list">${informativeItems}</ol>` : '<p class="insight-text"></p>'}

              <h3>Actionable Insight:</h3>
              ${actionableItems ? `<ol class="insight-list">${actionableItems}</ol>` : '<p class="insight-text"></p>'}
            </div>
          </div>

          <div class="footer">
            <div class="footer-blue"></div>
            <div class="footer-dark"></div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          size: A4;
          margin: 0;
        }
        
        @font-face {
          font-family: 'Inter';
          src: url('file://${interRegularPath}') format('truetype');
          font-weight: 400;
          font-style: normal;
        }

        @font-face {
          font-family: 'Inter';
          src: url('file://${interBoldPath}') format('truetype');
          font-weight: 700;
          font-style: normal;
        }

        @font-face {
          font-family: 'ArialAlt';
          src: url('file://${arialAltPath}') format('truetype');
          font-weight: 400;
          font-style: normal;
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        html, body {
          width: 210mm;
          /* Force standard height behavior */
          height: 100%;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: 'ArialAlt', Arial, sans-serif;
          color: #1a1a1a;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .page {
          width: 210mm;
          height: 297mm; 
          position: relative;
          page-break-after: always;
          background: white;
         
        }

        .header-bar {
          width: 100%;
          height: 19px;
          background: #015794;
        }

        .logo {
          position: absolute;
          top: 50px; 
          right: 50px;
          width: 150px; 
          height: auto;
        }

        .content {
          padding: 0 50px; /* Reduced side padding */
          padding-top: 80px; /* Reduced top padding */
          height: 220mm; 
        }

        .name-section {
          display: flex;
          align-items: center;
          margin-bottom: 20px; /* Compacted */
        }

        .insights-section {
          display: flex;
          align-items: center;
          margin-top: 25px; /* Compacted */
          margin-bottom: 20px; /* Compacted */
        }

        .dot {
          width: 6px;
          height: 6px;
          background: #1a1a1a;
          border-radius: 50%;
          margin-right: 10px;
          flex-shrink: 0;
          margin-top: 2px;
        }

        h1 {
          font-family: 'Inter', Arial, sans-serif;
          font-size: 20px;
          font-weight: 700;
          color: #0F172A;
          line-height: 1;
          margin: 0;
        }

        h2 {
          font-family: 'Inter', Arial, sans-serif;
          font-size: 16px; /* Slightly smaller */
          font-weight: 700;
          color: #0F172A;
          margin-bottom: 10px; /* Compacted */
          margin-top: 0;
        }

        h3 {
          font-family: 'Inter', Arial, sans-serif;
          font-size: 14px; /* Slightly smaller */
          font-weight: 700;
          color: #0F172A;
          margin-bottom: 8px; /* Compacted */
          margin-top: 15px; /* Compacted */
        }

        h3:first-child {
          margin-top: 0;
        }

        .section-content {
          margin-bottom: 20px; /* Compacted */
        }

        .info-row {
          font-family: 'ArialAlt', Arial, sans-serif;
          font-size: 13px; /* Smaller font to fit more */
          margin-bottom: 5px; /* Compacted */
          line-height: 1.3;
          color: #1a1a1a;
        }

        .info-row .label {
          font-family: 'Inter', Arial, sans-serif;
          font-weight: 700;
        }

        .insight-content {
          margin-bottom: 20px;
        }

        .insight-list {
          font-family: 'ArialAlt', Arial, sans-serif;
          font-size: 13px; /* Smaller font to fit more */
          line-height: 1.4;
          margin: 0;
          padding-left: 20px;
          color: #1a1a1a;
        }

        .insight-list li {
          margin-bottom: 6px; /* Compacted */
          padding-left: 5px;
        }

        .insight-text {
          font-family: 'ArialAlt', Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          margin-bottom: 10px;
          white-space: pre-wrap;
          word-wrap: break-word;
          color: #1a1a1a;
        }

        /* FOOTER STYLES */
        .footer {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 72px;
        }

        .footer-dark {
          position: absolute;
          bottom: 0;
          left: 0;
          width: 100%;
          height: 25px;
          background: #015794;
          z-index: 1;
        }

        .footer-blue {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 50%;
          height: 50px;
          background: #67A2C2;
          clip-path: polygon(15% 0, 100% 0, 100% 100%, 0% 100%);
          z-index: 2;
        }
      </style>
    </head>
    <body>
      ${contactsHTML}
    </body>
    </html>
  `;
}

/* -----------------------------------------------------
   MAIN EXPORT HANDLER
----------------------------------------------------- */
export async function exportContactsPdf(req: Request, res: Response) {
  let browser;

  try {
    const idsParam = req.query.ids as string | undefined;
    const contactIds = idsParam ? idsParam.split(",").map((id) => id.trim()) : [];

    let contacts: any[] = [];
    if (contactIds.length > 0) {
      contacts = await Contact.find({ _id: { $in: contactIds } }).lean();
    } else {
      const limit = req.query.limit === "all" ? 0 : parseInt(String(req.query.limit || 20));
      const q = Contact.find({}).sort({ createdAt: -1 });
      if (limit > 0) q.limit(limit);
      contacts = await q.lean();
    }

    const finalContacts = contacts.map((c) => normalize(c));
    const logoBase64 = await getLogoBase64();
    const html = generateHTML(finalContacts, logoBase64);

    browser = await puppeteer.launch({
      headless: true,
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
    });

    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=contacts.pdf");
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("PDF Error:", err);
    if (browser) await browser.close();
    if (!res.headersSent)
      res.status(500).json({ error: "Failed to render PDF", detail: err.message });
  }
}
