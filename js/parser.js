/**
 * Dhwani '26 — MakeMyPass CSV Parser
 * Robust parsing with column auto-detection and timestamp normalization.
 */

import { configManager } from "./config.js";

export class CSVParser {
  /**
   * Parse a single File object using PapaParse
   */
  static parseFile(file, overrideEventName = null, overridePoints = null) {
    return new Promise((resolve, reject) => {
      // @ts-ignore
      Papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        dynamicTyping: false,
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          try {
            const normalizedData = this.normalizeDataset(
              results.data,
              file.name,
              overrideEventName,
              overridePoints
            );
            resolve({
              fileName: file.name,
              fileSize: file.size,
              rawRowsCount: results.data.length,
              validCARows: normalizedData.filter(r => r.caCode),
              allRows: normalizedData,
              assignedEventName: overrideEventName || this.inferEventNameFromFileName(file.name),
              assignedPoints: overridePoints
            });
          } catch (err) {
            reject(err);
          }
        },
        error: (err) => reject(err)
      });
    });
  }

  /**
   * Parse raw CSV string directly (used for Demo Data / Pasted content)
   */
  static parseRawString(csvText, fileName = "ImportedData.csv", overrideEventName = null, overridePoints = null) {
    return new Promise((resolve, reject) => {
      // @ts-ignore
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
        complete: (results) => {
          const normalizedData = this.normalizeDataset(
            results.data,
            fileName,
            overrideEventName,
            overridePoints
          );
          resolve({
            fileName: fileName,
            fileSize: csvText.length,
            rawRowsCount: results.data.length,
            validCARows: normalizedData.filter(r => r.caCode),
            allRows: normalizedData,
            assignedEventName: overrideEventName || this.inferEventNameFromFileName(fileName),
            assignedPoints: overridePoints
          });
        },
        error: (err) => reject(err)
      });
    });
  }

  /**
   * Normalize an array of row objects into standardized MakeMyPass transaction objects
   */
  static normalizeDataset(rows, fileName, overrideEventName = null, overridePoints = null) {
    if (!rows || rows.length === 0) return [];

    const headers = Object.keys(rows[0] || {});
    const columnMap = this.detectColumnMapping(headers);
    const defaultEventName = overrideEventName || this.inferEventNameFromFileName(fileName);

    return rows.map((row, index) => {
      const caCode = this.extractCACode(row, columnMap.coupon);
      const timestamp = this.extractTimestamp(row, columnMap.date);
      const amount = this.extractAmount(row, columnMap.amount);
      const quantity = this.extractQuantity(row, columnMap.quantity);
      const eventName = overrideEventName || this.extractEventName(row, columnMap.eventName, defaultEventName);
      const orderId = columnMap.orderId && row[columnMap.orderId] ? String(row[columnMap.orderId]).trim() : `TXN-${index + 1}`;
      const buyerName = columnMap.buyerName && row[columnMap.buyerName] ? String(row[columnMap.buyerName]).trim() : "Attendee";

      return {
        id: `row-${index}-${Math.random().toString(36).substring(2, 7)}`,
        orderId,
        caCode,
        caName: this.formatCAName(caCode),
        buyerName,
        eventName,
        quantity,
        amount,
        timestamp,
        dateObj: timestamp.dateObj,
        rawRow: row,
        sourceFile: fileName,
        customPoints: overridePoints
      };
    });
  }

  /**
   * Smart column detection by matching header strings with known MakeMyPass keywords
   */
  static detectColumnMapping(headers) {
    const keywords = configManager.config.columnKeywords;
    const mapping = {
      coupon: null,
      date: null,
      amount: null,
      quantity: null,
      eventName: null,
      orderId: null,
      buyerName: null
    };

    const cleanHeaders = headers.map(h => ({
      original: h,
      clean: h.toLowerCase().replace(/[_\W]+/g, " ").trim()
    }));

    // Check specific MakeMyPass headers first
    const directCaCol = headers.find(h => 
      h.toLowerCase().includes("campus_ambassador") || 
      h.toLowerCase().includes("ambassador_referal") || 
      h.toLowerCase().includes("ambassador_referral")
    );
    if (directCaCol) {
      mapping.coupon = directCaCol;
    }

    for (const [key, kwList] of Object.entries(keywords)) {
      if (mapping[key]) continue;
      for (const kw of kwList) {
        const found = cleanHeaders.find(h => h.clean === kw || h.clean.includes(kw) || kw.includes(h.clean));
        if (found) {
          mapping[key] = found.original;
          break;
        }
      }
    }

    return mapping;
  }

  /**
   * Clean and normalize CA coupon code (Strictly DCAxxx pattern, e.g. DCA006, DCA115)
   */
  static extractCACode(row, colKey) {
    let candidate = null;

    if (colKey && row[colKey]) {
      candidate = String(row[colKey]).trim();
    } else {
      // Fallback: search columns for DCAxxx code
      for (const val of Object.values(row)) {
        if (typeof val === "string" && val.trim().toUpperCase().startsWith("DCA")) {
          candidate = val.trim();
          break;
        }
      }
    }

    if (!candidate) return null;

    const clean = candidate.toUpperCase().replace(/\s+/g, "");
    
    // Strict validation: Must match DCAxxx
    if (configManager.isValidCACode(clean)) {
      return clean;
    }

    return null;
  }

  /**
   * Format friendly display name for the CA
   */
  static formatCAName(caCode) {
    if (!caCode) return "General Ticket";
    return `Ambassador ${caCode}`;
  }

  /**
   * Parse timestamp supporting standard ISO, DD/MM/YYYY, 12h/24h formats
   */
  static extractTimestamp(row, colKey) {
    let dateStr = colKey && row[colKey] ? String(row[colKey]).trim() : "";
    if (!dateStr) {
      return { raw: "N/A", dateObj: new Date() };
    }

    // Try native parsing
    let parsed = new Date(dateStr);
    
    // Check if DD/MM/YYYY format e.g. 25/09/2026 19:30 or 25-09-2026
    if (isNaN(parsed.getTime())) {
      const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
      if (dmyMatch) {
        const [_, day, month, year, hours, minutes, seconds, ampm] = dmyMatch;
        let h = hours ? parseInt(hours, 10) : 12;
        if (ampm && ampm.toUpperCase() === "PM" && h < 12) h += 12;
        if (ampm && ampm.toUpperCase() === "AM" && h === 12) h = 0;
        const m = minutes ? parseInt(minutes, 10) : 0;
        const s = seconds ? parseInt(seconds, 10) : 0;
        parsed = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), h, m, s);
      }
    }

    if (isNaN(parsed.getTime())) {
      parsed = new Date();
    }

    return {
      raw: dateStr,
      dateObj: parsed,
      formattedDate: parsed.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }),
      formattedTime: parsed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    };
  }

  /**
   * Extract numeric amount
   */
  static extractAmount(row, colKey) {
    if (!colKey || row[colKey] === undefined) return 0;
    const cleanStr = String(row[colKey]).replace(/[^0-9.-]+/g, "");
    const val = parseFloat(cleanStr);
    return isNaN(val) ? 0 : Math.max(0, val);
  }

  /**
   * Extract quantity (defaults to 1)
   */
  static extractQuantity(row, colKey) {
    if (!colKey || row[colKey] === undefined) return 1;
    const cleanStr = String(row[colKey]).replace(/[^0-9]+/g, "");
    const val = parseInt(cleanStr, 10);
    return isNaN(val) || val <= 0 ? 1 : val;
  }

  /**
   * Extract Event Name or fallback to inferred filename
   */
  static extractEventName(row, colKey, defaultName) {
    if (colKey && row[colKey] && String(row[colKey]).trim()) {
      return String(row[colKey]).trim();
    }
    return defaultName;
  }

  /**
   * Clean filename to get event name (e.g., "Proshow_Night_MakeMyPass.csv" -> "Proshow Night")
   */
  static inferEventNameFromFileName(fileName) {
    if (!fileName) return "Dhwani '26 Event";
    let clean = fileName.replace(/\.csv$/i, "");
    clean = clean.replace(/(makemypass|export|tickets|sales|dhwani26|dhwani|dh)/gi, "");
    clean = clean.replace(/[_\-]+/g, " ").trim();
    return clean.length > 0 ? clean : "Dhwani '26 Event";
  }
}
