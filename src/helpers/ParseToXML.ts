import * as cheerio from "cheerio";

import logger from "../utils/logger.js";
import { FeedEntry, Form13FData } from "../types/signal.types.js";

import { secRequest } from "../services/scraping/liquiditySignals/commonScraping.service.js";
// Return full Schedule 13D / 13G XML string for one filing entry
export async function getSchedule13Xml(entry: FeedEntry): Promise<string | null> {
  try {
    // Step 1 – fetch the index page (.htm)
    const indexData = await secRequest(
      entry.link,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      `Schedule 13D/G index: ${entry.accession}`,
    );

    const $ = cheerio.load(indexData);
    const xmlLinks: string[] = [];

    // Step 2 – collect possible XML document URLs
    $("a").each((_i, elem) => {
      const href = $(elem).attr("href") || "";
      // Only pure XML (ignore XSLT transforms)
      if (href.endsWith(".xml") && !href.includes("xsl")) {
        const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
        xmlLinks.push(absolute);
      }
    });

    logger.info(`Found ${xmlLinks.length} XML links for ${entry.accession}`);
    if (xmlLinks.length > 0) logger.info(`XML links: ${xmlLinks.join(", ")}`);

    // Step 3 – try each XML link until one contains <SC13D> or <SC13G>
    for (const xmlUrl of xmlLinks) {
      try {
        logger.info(`Attempting to fetch: ${xmlUrl}`);
        const xmlData = await secRequest(
          xmlUrl,
          {
            headers: {
              Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
              Referer: entry.link,
            },
          },
          `Schedule 13 XML: ${entry.accession}`,
        );

        //console.log("XML Data is "+xmlData);

        if (xmlData && xmlData.length > 100) {
          logger.info(`✅ Successfully fetched Schedule 13 XML (${xmlData.length} bytes)`);
          return xmlData;
        }
      } catch (err: any) {
        logger.warn(`Failed to fetch ${xmlUrl}: ${err.message}`);
      }
    }

    // Step 4 – fallback to .txt file
    logger.info(`Trying .txt fallback for ${entry.accession}`);
    const txtUrl = entry.link.replace("-index.htm", ".txt");
    const txtData = await secRequest(
      txtUrl,
      {
        headers: {
          Accept: "text/plain, */*;q=0.8",
          Referer: entry.link,
        },
      },
      `Schedule 13 TXT: ${entry.accession}`,
    );

    if (txtData && txtData.length > 100) {
      const xmlMatch = txtData.match(/<SC13[DG][\s\S]*?<\/SC13[DG]>/i);
      if (xmlMatch && xmlMatch[0]) {
        const extractedXml = xmlMatch[0].trim();
        logger.info(`✅ Extracted Schedule 13 XML from .txt (${extractedXml.length} bytes)`);
        return extractedXml;
      }
    }

    logger.warn(`No valid Schedule 13 XML content found for ${entry.accession}`);
    return null;
  } catch (err: any) {
    logger.error(`Failed to get filing content for ${entry.accession}: ${err.message}`);
    return null;
  }
}

// Generalized function to get XML content for a filing entry and type
export async function getxmlGeneral(entry: FeedEntry, type: string): Promise<string | null> {
  try {
    // Step 1 – fetch the index page (.htm)

    const indexData = await secRequest(
      entry.link,

      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },

      `${type} index: ${entry.accession}`,
    );

    const $ = cheerio.load(indexData);

    const xmlLinks: string[] = [];

    // Step 2 – collect possible XML document URLs

    $("a").each((_i, elem) => {
      const href = $(elem).attr("href") || "";

      // Only pure XML (ignore XSLT transforms)

      if (href.endsWith(".xml") && !href.includes("xsl")) {
        const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;

        xmlLinks.push(absolute);
      }
    });

    logger.info(`Found ${xmlLinks.length} XML links for ${entry.accession}`);

    if (xmlLinks.length > 0) logger.info(`XML links: ${xmlLinks.join(", ")}`);

    // Step 3 – try each XML link until one contains <SC13D> or <SC13G>

    for (const xmlUrl of xmlLinks) {
      try {
        logger.info(`Attempting to fetch: ${xmlUrl}`);

        const xmlData = await secRequest(
          xmlUrl,

          {
            headers: {
              Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",

              Referer: entry.link,
            },
          },

          `Schedule 13 XML: ${entry.accession}`,
        );

        //console.log("XML Data is "+xmlData);

        if (xmlData && xmlData.length > 100) {
          logger.info(`✅ Successfully fetched Schedule 13 XML (${xmlData.length} bytes)`);

          console.log("xml url is " + xmlUrl);

          return xmlData;
        }
      } catch (err: any) {
        logger.warn(`Failed to fetch ${xmlUrl}: ${err.message}`);
      }
    }

    // Step 4 – fallback to .txt file

    logger.info(`Trying .txt fallback for ${entry.accession}`);

    const txtUrl = entry.link.replace("-index.htm", ".txt");

    const txtData = await secRequest(
      txtUrl,

      {
        headers: {
          Accept: "text/plain, */*;q=0.8",

          Referer: entry.link,
        },
      },

      `Schedule 13 TXT: ${entry.accession}`,
    );

    if (txtData && txtData.length > 100) {
      const xmlMatch = txtData.match(/<SC13[DG][\s\S]*?<\/SC13[DG]>/i);

      if (xmlMatch && xmlMatch[0]) {
        const extractedXml = xmlMatch[0].trim();

        logger.info(`✅ Extracted Schedule 13 XML from .txt (${extractedXml.length} bytes)`);

        return extractedXml;
      }
    }

    logger.warn(`No valid Schedule 13 XML content found for ${entry.accession}`);

    return null;
  } catch (err: any) {
    logger.error(`Failed to get filing content for ${entry.accession}: ${err.message}`);

    return null;
  }
}

export async function getxmlGeneral2(entry: FeedEntry, type: string): Promise<string | null> {
  try {
    // Step 1 – fetch the index page (.htm)

    const indexData = await secRequest(
      entry.link,

      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },

      `${type} index: ${entry.accession}`,
    );

    const $ = cheerio.load(indexData);

    const xmlLinks: string[] = [];

    // Step 2 – collect possible XML document URLs

    /*$("a").each((_i, elem) => {

      const href = $(elem).attr("href") || "";

      // Only pure XML (ignore XSLT transforms)

      if (href.endsWith(".xml") && !href.includes("xsl")) {

        const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;

        xmlLinks.push(absolute);

      }

    });*/

    $("tr").each((_i, row) => {
      const desc = $(row).find("td").eq(1).text().trim().toLowerCase();

      const href = $(row).find("a").attr("href") || "";

      if (
        desc.includes("extracted xbrl instance") || // <-- best way
        href.endsWith("_htm.xml") || // fallback filename pattern
        href.endsWith("_ins.xml") // some filings use this
      ) {
        const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;

        xmlLinks.push(absolute);
      }
    });

    logger.info(`Found ${xmlLinks.length} XML links for ${entry.accession}`);

    if (xmlLinks.length > 0) logger.info(`XML links: ${xmlLinks.join(", ")}`);

    // Step 3 – try each XML link until one contains <SC13D> or <SC13G>

    for (const xmlUrl of xmlLinks) {
      try {
        logger.info(`Attempting to fetch: ${xmlUrl}`);

        const xmlData = await secRequest(
          xmlUrl,

          {
            headers: {
              Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",

              Referer: entry.link,
            },
          },

          `Schedule 13 XML: ${entry.accession}`,
        );

        //console.log("XML Data is "+xmlData);

        if (xmlData && xmlData.length > 100) {
          logger.info(`✅ Successfully fetched Schedule 13 XML (${xmlData.length} bytes)`);

          console.log("xml url is " + xmlUrl);

          return xmlData;
        }
      } catch (err: any) {
        logger.warn(`Failed to fetch ${xmlUrl}: ${err.message}`);
      }
    }

    // Step 4 – fallback to .txt file

    logger.info(`Trying .txt fallback for ${entry.accession}`);

    const txtUrl = entry.link.replace("-index.htm", ".txt");

    const txtData = await secRequest(
      txtUrl,

      {
        headers: {
          Accept: "text/plain, */*;q=0.8",

          Referer: entry.link,
        },
      },

      `Schedule 13 TXT: ${entry.accession}`,
    );

    if (txtData && txtData.length > 100) {
      const xmlMatch = txtData.match(/<SC13[DG][\s\S]*?<\/SC13[DG]>/i);

      if (xmlMatch && xmlMatch[0]) {
        const extractedXml = xmlMatch[0].trim();

        logger.info(`✅ Extracted Schedule 13 XML from .txt (${extractedXml.length} bytes)`);

        return extractedXml;
      }
    }

    logger.warn(`No valid Schedule 13 XML content found for ${entry.accession}`);

    return null;
  } catch (err: any) {
    logger.error(`Failed to get filing content for ${entry.accession}: ${err.message}`);

    return null;
  }
}

export async function getxmls13F(entry: FeedEntry, type: string): Promise<Form13FData | null> {
  try {
    // Step 1 – fetch the index page (.htm)
    const indexData = await secRequest(
      entry.link,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      },
      `${type} index: ${entry.accession}`,
    );

    const $ = cheerio.load(indexData);

    let primaryDocUrl: string | null = null;
    let infoTableUrl: string | null = null;

    // Step 2 – Find both primary document and information table XML
    // First, log all XML files found for debugging
    const allFiles: Array<{ desc: string; href: string; filename: string }> = [];
    $("tr").each((_i, row) => {
      const desc = $(row).find("td").eq(1).text().trim().toLowerCase();
      const href = $(row).find("a").attr("href") || "";
      const filename = href.split("/").pop()?.toLowerCase() || "";

      if (href.endsWith(".xml")) {
        allFiles.push({ desc, href, filename });
      }
    });

    logger.info(`Found ${allFiles.length} XML files in index for ${entry.accession}`);
    allFiles.forEach((f, idx) => {
      if (idx < 10) {
        // Log first 10 files
        logger.info(
          `  [${idx + 1}] ${f.filename} - "${f.desc}" - ${f.href.includes("/xsl") ? "[XSL PATH - SKIP]" : "[OK]"}`,
        );
      }
    });

    $("tr").each((_i, row) => {
      const $row = $(row);
      const desc = $row.find("td").eq(1).text().trim().toLowerCase();
      const type = $row.find("td").eq(3).text().trim().toLowerCase(); // Type column
      const href = $row.find("a").attr("href") || "";
      const filename = href.split("/").pop()?.toLowerCase() || "";

      // Skip any paths that contain "xsl" - these are XSLT transformation files, not data files
      if (href.toLowerCase().includes("/xsl")) {
        return;
      }

      // Look for primary document
      // Common patterns: primary_doc.xml, form13fhr.xml, *-primary.xml
      if (
        !primaryDocUrl &&
        filename.endsWith(".xml") &&
        (desc.includes("primary document") ||
          type.includes("13f-hr") ||
          filename.includes("primary") ||
          filename === "primary_doc.xml" ||
          filename === "form13fhr.xml" ||
          (!filename.includes("infotable") &&
            !filename.includes("info") &&
            !filename.includes("table") &&
            !type.includes("information")))
      ) {
        primaryDocUrl = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
        logger.info(`Found potential primary doc: ${primaryDocUrl}`);
      }

      // Look for information table - check both description AND type columns
      // Common patterns: infotable.xml, informationtable.xml, form13f_table.xml, custom names
      if (
        !infoTableUrl &&
        filename.endsWith(".xml") &&
        (desc.includes("information table") ||
          desc.includes("infotable") ||
          desc.includes("13f holdings report") ||
          type.includes("information table") || // Check Type column
          type.includes("information") ||
          filename.includes("infotable") ||
          filename.includes("informationtable") ||
          filename.includes("table.xml") ||
          filename === "infotable.xml" ||
          filename === "form13f_table.xml")
      ) {
        infoTableUrl = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
        logger.info(`Found info table: ${infoTableUrl} (type: "${type}", desc: "${desc}")`);
      }
    });

    // If we didn't find them by description, try pattern matching on all XML links
    if (!primaryDocUrl || !infoTableUrl) {
      logger.info(`Fallback search - primaryDoc: ${!!primaryDocUrl}, infoTable: ${!!infoTableUrl}`);
      const allXmlLinks: Array<{ url: string; filename: string }> = [];

      $("a").each((_i, elem) => {
        const href = $(elem).attr("href") || "";
        // Skip any XSLT files or paths containing "xsl"
        if (href.endsWith(".xml") && !href.toLowerCase().includes("xsl")) {
          const filename = href.split("/").pop()?.toLowerCase() || "";
          const absolute = href.startsWith("http") ? href : `https://www.sec.gov${href}`;
          allXmlLinks.push({ url: absolute, filename });
        }
      });

      logger.info(`Fallback found ${allXmlLinks.length} non-XSL XML files`);

      for (const link of allXmlLinks) {
        if (
          !primaryDocUrl &&
          (link.filename.includes("primary") ||
            link.filename === "form13fhr.xml" ||
            link.filename.match(/^[0-9-]+\.xml$/))
        ) {
          primaryDocUrl = link.url;
          logger.info(`Found primary doc by pattern: ${primaryDocUrl}`);
        }

        if (
          !infoTableUrl &&
          (link.filename.includes("infotable") ||
            link.filename.includes("informationtable") ||
            link.filename.includes("table.xml"))
        ) {
          infoTableUrl = link.url;
          logger.info(`Found info table by pattern: ${infoTableUrl}`);
        }
      }
    }

    if (!primaryDocUrl && !infoTableUrl) {
      logger.warn(`No XML files found for ${entry.accession}`);
      return null;
    }

    if (!infoTableUrl) {
      logger.warn(
        `⚠️ Info table not found for ${entry.accession} - will return with empty infoTableXml`,
      );
    }
    if (!primaryDocUrl) {
      logger.warn(
        `⚠️ Primary doc not found for ${entry.accession} - will return with empty primaryXml`,
      );
    }

    // Step 3 – Fetch both XMLs
    let primaryXml = "";
    let infoTableXml = "";

    if (primaryDocUrl) {
      try {
        logger.info(`Fetching primary doc: ${primaryDocUrl}`);
        primaryXml = await secRequest(
          primaryDocUrl,
          {
            headers: {
              Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
              Referer: entry.link,
            },
          },
          `13F Primary XML: ${entry.accession}`,
        );
        logger.info(`✅ Successfully fetched primary doc (${primaryXml.length} bytes)`);
      } catch (err: any) {
        logger.warn(`Failed to fetch primary doc ${primaryDocUrl}: ${err.message}`);
      }
    }

    if (infoTableUrl) {
      try {
        logger.info(`Fetching info table: ${infoTableUrl}`);
        infoTableXml = await secRequest(
          infoTableUrl,
          {
            headers: {
              Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
              Referer: entry.link,
            },
          },
          `13F InfoTable XML: ${entry.accession}`,
        );
        logger.info(`✅ Successfully fetched info table (${infoTableXml.length} bytes)`);
      } catch (err: any) {
        logger.warn(`Failed to fetch info table ${infoTableUrl}: ${err.message}`);
      }
    }

    // Only return if we got at least one XML
    if (primaryXml || infoTableXml) {
      return {
        accession: entry.accession,
        primaryXml: primaryXml,
        infoTableXml: infoTableXml,
      };
    }

    logger.warn(`No valid 13F XML content found for ${entry.accession}`);
    return null;
  } catch (err: any) {
    logger.error(`Failed to get 13F filing content for ${entry.accession}: ${err.message}`);
    return null;
  }
}
