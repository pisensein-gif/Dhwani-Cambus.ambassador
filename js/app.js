/**
 * =========================================================================
 * DHWANI '26 — CAMPUS AMBASSADOR LEADERBOARD & POINTS ENGINE
 * Backend: Firebase Cloud Firestore Database (dhwani-cambus-ambassidor)
 * Real-time cloud sync, persistent CA directory & event dataset replacement
 * =========================================================================
 */

(function () {
  "use strict";

  // -----------------------------------------------------------------------
  // 1. FIREBASE INITIALIZATION & FIRESTORE SETUP
  // -----------------------------------------------------------------------
  const firebaseConfig = {
    apiKey: "AIzaSyBmo6BUbFj0f3ep4IJKNN6xkGaz_kP8Wes",
    authDomain: "dhwani-cambus-ambassidor.firebaseapp.com",
    projectId: "dhwani-cambus-ambassidor",
    storageBucket: "dhwani-cambus-ambassidor.firebasestorage.app",
    messagingSenderId: "762957998637",
    appId: "1:762957998637:web:6d425ae35cf390828426a4"
  };

  let db = null;
  let isFirestoreConnected = false;

  try {
    // @ts-ignore
    if (typeof firebase !== "undefined") {
      // @ts-ignore
      if (!firebase.apps || firebase.apps.length === 0) {
        // @ts-ignore
        firebase.initializeApp(firebaseConfig);
      }
      // @ts-ignore
      db = firebase.firestore();
      // Enable offline persistence if supported
      try {
        db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
      } catch (e) {}
    }
  } catch (err) {
    console.error("Firebase init warning:", err);
  }

  // Strict regex for valid CA codes (e.g., DCA006, DCA115, DCA213)
  const CA_REGEX = /^DCA[0-9A-Z]+$/i;

  // Peak Hour Windows for Dhwani '26
  const PEAK_HOURS = [
    { name: "Evening Flash Sale (18:00 - 22:00)", startH: 18, startM: 0, endH: 22, endM: 0, bonus: 10, active: true },
    { name: "Late Night Surge (22:00 - 23:59)", startH: 22, startM: 0, endH: 23, endM: 59, bonus: 15, active: true }
  ];

  // -----------------------------------------------------------------------
  // 2. CLOUD FIRESTORE DATA MANAGER & REALTIME SYNC
  // -----------------------------------------------------------------------
  const LOCAL_BACKUP_EVENTS = "DHWANI26_FB_EVENTS_BACKUP";
  const LOCAL_BACKUP_AMB = "DHWANI26_FB_AMB_BACKUP";

  class FirestoreDataManager {
    constructor() {
      this.eventsList = [];

      this.ambassadorsMap = {};

      this.eventDatasets = {};
      this.loadLocalBackup();
    }

    loadLocalBackup() {
      try {
        const ev = localStorage.getItem(LOCAL_BACKUP_EVENTS);
        if (ev) this.eventDatasets = JSON.parse(ev);
        const amb = localStorage.getItem(LOCAL_BACKUP_AMB);
        if (amb) this.ambassadorsMap = { ...this.ambassadorsMap, ...JSON.parse(amb) };
      } catch (e) {}
    }

    saveLocalBackup() {
      try {
        localStorage.setItem(LOCAL_BACKUP_EVENTS, JSON.stringify(this.eventDatasets));
        localStorage.setItem(LOCAL_BACKUP_AMB, JSON.stringify(this.ambassadorsMap));
      } catch (e) {}
    }

    getPointsForEvent(name) {
      if (!name) return 25;
      const lower = String(name).toLowerCase().trim();
      if (this.eventDatasets[name] && this.eventDatasets[name].points) {
        return Number(this.eventDatasets[name].points);
      }
      return 25;
    }

    getAmbassadorName(code) {
      const cleanCode = String(code).trim().toUpperCase();
      if (this.ambassadorsMap[cleanCode] && this.ambassadorsMap[cleanCode].name) {
        return this.ambassadorsMap[cleanCode].name;
      }
      return `Ambassador ${cleanCode}`;
    }

    /**
     * Start Realtime listener from Firestore
     */
    startRealtimeSync(onUpdateCallback) {
      if (!db) {
        this.updateConnectionStatus(false, "Local Mode (Firestore SDK unavailable)");
        return;
      }

      this.updateConnectionStatus(true, "Firestore Live");

      // 1. Listen to 'events' collection
      db.collection("events").onSnapshot(
        (snapshot) => {
          this.eventDatasets = {};
          snapshot.forEach((doc) => {
            const data = doc.data();
            this.eventDatasets[data.eventName || doc.id] = data;
          });
          this.saveLocalBackup();
          onUpdateCallback();
        },
        (error) => {
          console.warn("Firestore events snapshot error:", error);
          this.updateConnectionStatus(false, "Firestore Offline (Using Cache)");
        }
      );

      // 2. Listen to 'ambassadors' collection
      db.collection("ambassadors").onSnapshot(
        (snapshot) => {
          snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.code) {
              this.ambassadorsMap[data.code] = data;
            }
          });
          this.saveLocalBackup();
          onUpdateCallback();
        },
        (error) => {
          console.warn("Firestore ambassadors snapshot error:", error);
        }
      );
    }

    updateConnectionStatus(online, text) {
      isFirestoreConnected = online;
      const badge = document.getElementById("firebaseStatusBadge");
      const dot = badge ? badge.querySelector(".status-dot") : null;
      const txt = document.getElementById("firebaseStatusText");

      if (dot) {
        dot.className = online ? "status-dot online" : "status-dot offline";
      }
      if (txt) {
        txt.textContent = text || (online ? "Firestore Connected" : "Firestore Offline");
      }
    }

    /**
     * Upload / Update an event dataset on Firestore
     * If an event with the same name exists, it is completely replaced with new data!
     */
    async uploadEventToFirestore(eventName, points, fileName, rows) {
      const cleanEventName = String(eventName).trim();
      const docId = cleanEventName.replace(/[\/\\]+/g, "_");

      const eventData = {
        eventName: cleanEventName,
        points: Number(points),
        fileName: fileName,
        updatedAt: new Date().toISOString(),
        rows: rows
      };

      // 1. Update local cache immediately
      this.eventDatasets[cleanEventName] = eventData;
      this.saveLocalBackup();

      // 2. Sync to Firestore
      if (db) {
        try {
          await db.collection("events").doc(docId).set(eventData);
          console.log(`Synced event [${cleanEventName}] to Firestore`);
        } catch (err) {
          console.error("Failed to write event to Firestore:", err);
          DashboardUI.showToast("Saved locally (Firestore write pending)", "warning");
        }
      }

      // Auto-register any new CAs found in dataset to Firestore
      rows.forEach(r => {
        if (r.caCode && !this.ambassadorsMap[r.caCode]) {
          this.registerOrUpdateAmbassador(r.caCode, `Ambassador ${r.caCode}`, r.college || "");
        }
      });
    }

    /**
     * Delete an event dataset from Firestore & Local
     */
    async deleteEventFromFirestore(eventName) {
      delete this.eventDatasets[eventName];
      this.saveLocalBackup();

      if (db) {
        try {
          const docId = eventName.replace(/[\/\\]+/g, "_");
          await db.collection("events").doc(docId).delete();
          console.log(`Deleted event [${eventName}] from Firestore`);
        } catch (err) {
          console.error("Firestore delete event error:", err);
        }
      }
    }

    /**
     * Register or update Ambassador profile on Firestore
     */
    async registerOrUpdateAmbassador(code, name, college = "") {
      const cleanCode = String(code).trim().toUpperCase();
      if (!CA_REGEX.test(cleanCode)) return false;

      const cleanName = name && String(name).trim() ? String(name).trim() : `Ambassador ${cleanCode}`;
      const ambData = {
        code: cleanCode,
        name: cleanName,
        college: college ? String(college).trim() : (this.ambassadorsMap[cleanCode]?.college || ""),
        updatedAt: new Date().toISOString()
      };

      this.ambassadorsMap[cleanCode] = ambData;
      this.saveLocalBackup();

      if (db) {
        try {
          await db.collection("ambassadors").doc(cleanCode).set(ambData, { merge: true });
        } catch (err) {
          console.error("Firestore update ambassador error:", err);
        }
      }
      return true;
    }

    /**
     * Clear all datasets from Firestore
     */
    async clearAllDatasetsFromFirestore() {
      const eventNames = Object.keys(this.eventDatasets);
      this.eventDatasets = {};
      this.saveLocalBackup();

      if (db) {
        try {
          const batch = db.batch();
          for (const ev of eventNames) {
            const docId = ev.replace(/[\/\\]+/g, "_");
            const ref = db.collection("events").doc(docId);
            batch.delete(ref);
          }
          await batch.commit();
        } catch (err) {
          console.error("Firestore clear all error:", err);
        }
      }
    }
  }

  const storage = new FirestoreDataManager();

  // -----------------------------------------------------------------------
  // 3. MAKE MY PASS CSV PARSER
  // -----------------------------------------------------------------------
  class MakeMyPassParser {
    static parseFile(file, assignedEventName, assignedPoints) {
      return new Promise((resolve, reject) => {
        // @ts-ignore
        if (typeof Papa === "undefined") {
          reject(new Error("PapaParse library not loaded"));
          return;
        }

        // @ts-ignore
        Papa.parse(file, {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (h) => h.trim(),
          complete: (results) => {
            try {
              const rows = this.normalize(results.data, file.name, assignedEventName, assignedPoints);
              resolve({
                fileName: file.name,
                allRows: rows,
                validCARows: rows.filter(r => r.caCode),
                eventName: assignedEventName,
                eventPoints: assignedPoints
              });
            } catch (err) {
              reject(err);
            }
          },
          error: (err) => reject(err)
        });
      });
    }

    static normalize(dataRows, fileName, eventName, pointsPerTicket) {
      if (!dataRows || !Array.isArray(dataRows)) return [];

      return dataRows.map((row, idx) => {
        const caCode = this.extractCACode(row);
        const quantity = this.extractQuantity(row);
        const amount = this.extractAmount(row);
        const timestamp = this.extractTimestamp(row);
        const college = row.college || "";
        const orderId = row.ticket_code || row.event_register_id || row.order_id || `MMP-${idx + 1}`;
        const finalEventName = eventName || row.ticket_name || row.event_name || this.inferName(fileName);

        return {
          id: `tkt-${idx}-${Math.random().toString(36).substr(2, 6)}`,
          orderId,
          caCode,
          college,
          quantity,
          amount,
          eventName: finalEventName,
          basePointsPerTicket: pointsPerTicket !== null && pointsPerTicket !== undefined ? Number(pointsPerTicket) : storage.getPointsForEvent(finalEventName),
          dateObj: timestamp.dateObj,
          dateFormatted: timestamp.formatted
        };
      });
    }

    static extractCACode(row) {
      const direct = row.campus_ambassador_referal_code || row.campus_ambassador_referral_code || row.ca_code || row.coupon;
      if (direct && typeof direct === "string") {
        const clean = direct.trim().toUpperCase().replace(/\s+/g, "");
        if (CA_REGEX.test(clean)) return clean;
      }

      for (const val of Object.values(row)) {
        if (typeof val === "string") {
          const clean = val.trim().toUpperCase().replace(/\s+/g, "");
          if (CA_REGEX.test(clean)) return clean;
        }
      }
      return null;
    }

    static extractQuantity(row) {
      const q = row.no_of_tickets || row.quantity || row.qty || row.seats || 1;
      const parsed = parseInt(String(q).replace(/[^0-9]/g, ""), 10);
      return isNaN(parsed) || parsed <= 0 ? 1 : parsed;
    }

    static extractAmount(row) {
      const a = row.amount || row.amount_paid || row.price || row.total || 0;
      const parsed = parseFloat(String(a).replace(/[^0-9.-]/g, ""));
      return isNaN(parsed) ? 0 : Math.max(0, parsed);
    }

    static extractTimestamp(row) {
      const d = row.registered_at || row.created_at || row.date || row.timestamp || "";
      let parsed = new Date(d);

      if (isNaN(parsed.getTime()) && typeof d === "string") {
        const m = d.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
        if (m) {
          parsed = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), parseInt(m[4] || "12", 10), parseInt(m[5] || "0", 10));
        }
      }

      if (isNaN(parsed.getTime())) parsed = new Date();

      return {
        dateObj: parsed,
        formatted: parsed.toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      };
    }

    static inferName(fileName) {
      if (!fileName) return "Dhwani '26 Event";
      let clean = fileName.replace(/\.csv$/i, "");
      clean = clean.replace(/(makemypass|export|tickets|sales|dhwani26|dhwani)/gi, "");
      clean = clean.replace(/[_\-]+/g, " ").trim();
      return clean.length > 0 ? clean : "Dhwani '26 Event";
    }
  }

  // -----------------------------------------------------------------------
  // 4. CALCULATION & SCORING ENGINE
  // -----------------------------------------------------------------------
  class CalculationEngine {
    static processAllSavedDatasets() {
      const datasets = Object.values(storage.eventDatasets);
      const allRows = [];
      datasets.forEach(ds => {
        const currentPoints = storage.getPointsForEvent(ds.eventName);
        if (Array.isArray(ds.rows)) {
          ds.rows.forEach(r => {
            r.basePointsPerTicket = currentPoints;
            allRows.push(r);
          });
        }
      });

      return this.processRows(allRows);
    }

    static processRows(allRows) {
      const caMap = new Map();
      const eventMap = new Map();

      let globalTickets = 0;
      let globalPeakTickets = 0;
      let globalPoints = 0;
      let globalBonusPoints = 0;
      let globalRevenue = 0;

      const validRows = allRows.filter(r => r.caCode);

      validRows.forEach(row => {
        const peakMatch = this.checkPeak(row.dateObj);
        const peakBonusPerTicket = peakMatch.isPeak ? peakMatch.bonus : 0;
        const basePointsTotal = row.basePointsPerTicket * row.quantity;
        const peakBonusTotal = peakBonusPerTicket * row.quantity;
        const rowTotalPoints = basePointsTotal + peakBonusTotal;

        globalTickets += row.quantity;
        globalRevenue += row.amount;
        globalPoints += rowTotalPoints;
        globalBonusPoints += peakBonusTotal;
        if (peakMatch.isPeak) globalPeakTickets += row.quantity;

        if (!caMap.has(row.caCode)) {
          caMap.set(row.caCode, {
            caCode: row.caCode,
            caName: storage.getAmbassadorName(row.caCode),
            college: storage.ambassadorsMap[row.caCode]?.college || row.college || "",
            totalPoints: 0,
            totalTickets: 0,
            peakTickets: 0,
            peakBonusPoints: 0,
            totalRevenue: 0,
            events: {},
            transactions: [],
            badges: []
          });
        }

        const ca = caMap.get(row.caCode);
        ca.totalPoints += rowTotalPoints;
        ca.totalTickets += row.quantity;
        ca.totalRevenue += row.amount;
        ca.peakBonusPoints += peakBonusTotal;
        if (peakMatch.isPeak) ca.peakTickets += row.quantity;

        if (!ca.events[row.eventName]) {
          ca.events[row.eventName] = { tickets: 0, points: 0, revenue: 0 };
        }
        ca.events[row.eventName].tickets += row.quantity;
        ca.events[row.eventName].points += rowTotalPoints;
        ca.events[row.eventName].revenue += row.amount;

        ca.transactions.push({
          orderId: row.orderId,
          eventName: row.eventName,
          dateFormatted: row.dateFormatted,
          quantity: row.quantity,
          amount: row.amount,
          isPeak: peakMatch.isPeak,
          bonusPoints: peakBonusTotal,
          totalPoints: rowTotalPoints
        });

        if (!eventMap.has(row.eventName)) {
          eventMap.set(row.eventName, {
            eventName: row.eventName,
            totalTickets: 0,
            totalRevenue: 0,
            totalPoints: 0,
            basePointsPerTicket: row.basePointsPerTicket,
            activeCAs: new Set()
          });
        }
        const ev = eventMap.get(row.eventName);
        ev.totalTickets += row.quantity;
        ev.totalRevenue += row.amount;
        ev.totalPoints += rowTotalPoints;
        ev.activeCAs.add(row.caCode);
      });

      const leaderboard = Array.from(caMap.values());
      leaderboard.sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
        if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets;
        return b.totalRevenue - a.totalRevenue;
      });

      let maxPeak = 0;
      leaderboard.forEach(ca => {
        if (ca.peakTickets > maxPeak) maxPeak = ca.peakTickets;
      });

      leaderboard.forEach((ca, idx) => {
        ca.rank = idx + 1;
        ca.badges = [];
        if (ca.rank === 1) ca.badges.push({ text: "👑 Dhwani Leader", type: "champion" });
        if (maxPeak > 0 && ca.peakTickets === maxPeak && ca.peakTickets >= 3) {
          ca.badges.push({ text: "⚡ Rush Hour Master", type: "rush" });
        }
        if (ca.totalTickets >= 25) {
          ca.badges.push({ text: "🎯 Top Performer (25+)", type: "century" });
        }
        if (Object.keys(ca.events).length >= 2) {
          ca.badges.push({ text: "🌟 Multi-Event", type: "revenue" });
        }
      });

      const eventStats = Array.from(eventMap.values()).map(ev => ({
        ...ev,
        caCount: ev.activeCAs.size
      }));
      eventStats.sort((a, b) => b.totalTickets - a.totalTickets);

      return {
        leaderboard,
        eventStats,
        summary: {
          totalCAs: leaderboard.length,
          totalTickets: globalTickets,
          totalPeakTickets: globalPeakTickets,
          totalPoints: globalPoints,
          totalBonusPoints: globalBonusPoints,
          totalRevenue: globalRevenue,
          topCA: leaderboard.length > 0 ? `${leaderboard[0].caName} (${leaderboard[0].caCode})` : "--"
        }
      };
    }

    static checkPeak(dateInput) {
      let dateObj = dateInput;
      if (typeof dateInput === "string" || typeof dateInput === "number") {
        dateObj = new Date(dateInput);
      } else if (dateObj && typeof dateObj.toDate === "function") {
        dateObj = dateObj.toDate();
      }
      if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) return { isPeak: false, bonus: 0 };
      
      const currentMin = dateObj.getHours() * 60 + dateObj.getMinutes();

      for (const w of PEAK_HOURS) {
        if (!w.active) continue;
        const startTotal = w.startH * 60 + w.startM;
        const endTotal = w.endH * 60 + w.endM;
        if (currentMin >= startTotal && currentMin <= endTotal) {
          return { isPeak: true, bonus: w.bonus };
        }
      }
      return { isPeak: false, bonus: 0 };
    }
  }

  // -----------------------------------------------------------------------
  // 5. UI RENDERER & INTERACTIVE DASHBOARD
  // -----------------------------------------------------------------------
  class DashboardUI {
    constructor() {
      this.chart = null;
    }

    renderStats(summary, eventCount) {
      document.getElementById("statActiveCAs").textContent = summary.totalCAs.toLocaleString();
      document.getElementById("statTicketsSold").textContent = summary.totalTickets.toLocaleString();
      document.getElementById("statTotalPoints").textContent = summary.totalPoints.toLocaleString();
      document.getElementById("statTotalRevenue").textContent = `₹${summary.totalRevenue.toLocaleString()}`;

      document.getElementById("statTopCA").textContent = `Top: ${summary.topCA}`;
      document.getElementById("statPeakTickets").textContent = `⚡ ${summary.totalPeakTickets} in Peak Hours`;
      document.getElementById("statBonusPoints").textContent = `⚡ ${summary.totalBonusPoints} Bonus Points`;
      document.getElementById("statEventsCount").textContent = `${eventCount} Events in Firestore`;
    }

    renderPodium(leaderboard, onSelectCA) {
      const sec = document.getElementById("podiumSection");
      if (!leaderboard || leaderboard.length === 0) {
        sec.style.display = "none";
        return;
      }
      sec.style.display = "block";

      const podiumConfigs = [
        { id: "podiumRank1", data: leaderboard[0] },
        { id: "podiumRank2", data: leaderboard[1] },
        { id: "podiumRank3", data: leaderboard[2] }
      ];

      podiumConfigs.forEach(({ id, data }) => {
        const card = document.getElementById(id);
        if (!card) return;
        if (!data) {
          card.style.opacity = "0.3";
          card.style.pointerEvents = "none";
          return;
        }

        card.style.opacity = "1";
        card.style.pointerEvents = "auto";
        card.querySelector(".avatar-initials").textContent = data.caCode.substring(0, 4);
        card.querySelector(".ca-name").textContent = data.caName;
        card.querySelector(".ca-code-badge").textContent = data.caCode;
        card.querySelector(".score-points").innerHTML = `${data.totalPoints.toLocaleString()} <small>PTS</small>`;
        card.querySelector(".score-meta").innerHTML = `<span>🎟️ ${data.totalTickets} Tickets</span><span>⚡ ${data.peakTickets} Peak</span>`;

        card.onclick = () => onSelectCA(data);
      });

      try {
        // @ts-ignore
        if (typeof confetti === "function") {
          // @ts-ignore
          confetti({ particleCount: 30, spread: 60, origin: { y: 0.7 }, colors: ["#00f2fe", "#a855f7", "#ffb703"] });
        }
      } catch (e) {}
    }

    renderLeaderboard(leaderboard, filterEvent, searchQuery, sortBy, onSelectCA) {
      const tbody = document.getElementById("leaderboardBody");
      const footer = document.getElementById("tableFooterBar");
      const countEl = document.getElementById("showingCount");

      if (!leaderboard || leaderboard.length === 0) {
        tbody.innerHTML = `
          <tr class="empty-state-row">
            <td colspan="8">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="inbox"></i></div>
                <h4>No Data Loaded Yet</h4>
                <p>Upload your MakeMyPass CSV files above to see live calculations.</p>
              </div>
            </td>
          </tr>
        `;
        footer.style.display = "none";
        // @ts-ignore
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      let filtered = leaderboard.map(ca => {
        if (filterEvent === "ALL") return ca;
        const ev = ca.events[filterEvent];
        if (!ev) return null;
        return { ...ca, displayPoints: ev.points, displayTickets: ev.tickets, displayRevenue: ev.revenue };
      }).filter(Boolean);

      if (searchQuery && searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(ca => ca.caCode.toLowerCase().includes(q) || ca.caName.toLowerCase().includes(q) || ca.college.toLowerCase().includes(q));
      }

      filtered.sort((a, b) => {
        const pA = filterEvent === "ALL" ? a.totalPoints : a.displayPoints;
        const pB = filterEvent === "ALL" ? b.totalPoints : b.displayPoints;
        const tA = filterEvent === "ALL" ? a.totalTickets : a.displayTickets;
        const tB = filterEvent === "ALL" ? b.totalTickets : b.displayTickets;
        const rA = filterEvent === "ALL" ? a.totalRevenue : a.displayRevenue;
        const rB = filterEvent === "ALL" ? b.totalRevenue : b.displayRevenue;

        switch (sortBy) {
          case "points_desc": return pB - pA;
          case "tickets_desc": return tB - tA;
          case "peak_desc": return b.peakTickets - a.peakTickets;
          case "revenue_desc": return rB - rA;
          case "name_asc": return a.caName.localeCompare(b.caName);
          default: return pB - pA;
        }
      });

      if (filtered.length === 0) {
        tbody.innerHTML = `
          <tr class="empty-state-row">
            <td colspan="8">
              <div class="empty-state">
                <div class="empty-icon"><i data-lucide="search-x"></i></div>
                <h4>No Matching Ambassadors</h4>
                <p>No results found for "${searchQuery}".</p>
              </div>
            </td>
          </tr>
        `;
        footer.style.display = "none";
        // @ts-ignore
        if (window.lucide) window.lucide.createIcons();
        return;
      }

      footer.style.display = "flex";
      countEl.textContent = filtered.length;

      let html = "";
      filtered.forEach((ca, idx) => {
        const rank = idx + 1;
        let rankClass = rank === 1 ? "rank-1" : rank === 2 ? "rank-2" : rank === 3 ? "rank-3" : "rank-rest";
        const points = filterEvent === "ALL" ? ca.totalPoints : ca.displayPoints;
        const tickets = filterEvent === "ALL" ? ca.totalTickets : ca.displayTickets;
        const revenue = filterEvent === "ALL" ? ca.totalRevenue : ca.displayRevenue;

        const badgesHtml = ca.badges.map(b => `<span class="badge-tag-mini badge-${b.type}">${b.text}</span>`).join(" ");

        html += `
          <tr data-ca-code="${ca.caCode}">
            <td class="col-rank"><span class="rank-indicator ${rankClass}">${rank}</span></td>
            <td class="col-ca">
              <div class="ca-profile-cell">
                <div class="ca-avatar-mini">${ca.caCode.substring(0, 4)}</div>
                <div>
                  <div class="ca-meta-title">${ca.caName}</div>
                  <div class="ca-meta-code">${ca.caCode} ${ca.college ? '• ' + ca.college : ''}</div>
                </div>
              </div>
            </td>
            <td class="col-tickets text-center"><strong>${tickets}</strong></td>
            <td class="col-peak text-center"><span class="text-purple font-mono font-bold">⚡ ${ca.peakTickets}</span></td>
            <td class="col-revenue text-right font-mono">₹${revenue.toLocaleString()}</td>
            <td class="col-badges"><div class="badges-wrap">${badgesHtml || "-"}</div></td>
            <td class="col-points text-right"><span class="points-pill">${points.toLocaleString()} <small>PTS</small></span></td>
            <td class="col-action text-center">
              <button class="btn btn-xs btn-outline"><i data-lucide="external-link"></i> Details</button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;

      tbody.querySelectorAll("tr[data-ca-code]").forEach(row => {
        const code = row.getAttribute("data-ca-code");
        const caObj = leaderboard.find(c => c.caCode === code);
        row.onclick = () => { if (caObj) onSelectCA(caObj); };
      });

      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();
    }

    renderEventSummary(eventStats, onDeleteEvent) {
      const sec = document.getElementById("eventsSummarySection");
      const grid = document.getElementById("eventsGrid");
      const filter = document.getElementById("eventFilter");

      if (!eventStats || eventStats.length === 0) {
        sec.style.display = "none";
        filter.innerHTML = `<option value="ALL">All Events</option>`;
        return;
      }

      sec.style.display = "block";
      grid.innerHTML = "";

      // @ts-ignore
      const currentFilter = filter.value;
      filter.innerHTML = `<option value="ALL">All Events</option>`;

      eventStats.forEach(ev => {
        const opt = document.createElement("option");
        opt.value = ev.eventName;
        opt.textContent = `${ev.eventName} (${ev.totalTickets} tkts)`;
        filter.appendChild(opt);

        const card = document.createElement("div");
        card.className = "event-card";
        card.innerHTML = `
          <div class="event-card-head">
            <div>
              <span class="event-title">${ev.eventName}</span>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">
                ☁️ ${storage.eventDatasets[ev.eventName]?.fileName || ''}
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:0.4rem;">
              <span class="event-pts-badge">${ev.basePointsPerTicket} pts/tkt</span>
              <button class="btn-icon-sm btn-del-ev" title="Delete Event from Firestore">
                <i data-lucide="trash-2" style="width:14px;height:14px;color:var(--accent-danger)"></i>
              </button>
            </div>
          </div>
          <div class="event-stats-row"><span>Tickets Sold:</span><strong class="text-bright">${ev.totalTickets}</strong></div>
          <div class="event-stats-row"><span>Active Ambassadors:</span><strong class="text-cyan">${ev.caCount}</strong></div>
          <div class="event-stats-row"><span>Total Points:</span><strong class="text-gold">${ev.totalPoints.toLocaleString()}</strong></div>
          <div class="event-stats-row"><span>Total Revenue:</span><strong class="text-emerald font-mono">₹${ev.totalRevenue.toLocaleString()}</strong></div>
        `;

        card.querySelector(".btn-del-ev").onclick = (e) => {
          e.stopPropagation();
          onDeleteEvent(ev.eventName);
        };

        grid.appendChild(card);
      });

      // @ts-ignore
      if (currentFilter && Array.from(filter.options).some(o => o.value === currentFilter)) {
        // @ts-ignore
        filter.value = currentFilter;
      }

      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();
    }

    renderAmbassadorsDirectory(leaderboard, onSelectCA) {
      const tbody = document.getElementById("ambassadorsDirBody");
      const ambMap = storage.ambassadorsMap;
      const allCodes = Object.keys(ambMap).sort();

      if (allCodes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:1.5rem;">No Ambassadors registered yet.</td></tr>`;
        return;
      }

      let html = "";
      allCodes.forEach(code => {
        const amb = ambMap[code];
        const activeData = leaderboard.find(c => c.caCode === code);
        const tickets = activeData ? activeData.totalTickets : 0;
        const points = activeData ? activeData.totalPoints : 0;

        html += `
          <tr data-amb-code="${amb.code}">
            <td><strong class="text-cyan font-mono">${amb.code}</strong></td>
            <td>
              <input type="text" class="input-field amb-name-edit" value="${amb.name}" style="padding:0.3rem 0.5rem; width:100%;" />
            </td>
            <td>
              <input type="text" class="input-field amb-col-edit" value="${amb.college || ''}" placeholder="College" style="padding:0.3rem 0.5rem; width:100%; font-size:0.8rem;" />
            </td>
            <td class="text-center font-bold">${tickets}</td>
            <td class="text-right text-gold font-bold">${points.toLocaleString()}</td>
            <td class="text-center">
              <button class="btn btn-xs btn-primary btn-save-amb" title="Save to Firestore">Save</button>
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;

      tbody.querySelectorAll("tr[data-amb-code]").forEach(row => {
        const code = row.getAttribute("data-amb-code");
        const btnSave = row.querySelector(".btn-save-amb");
        btnSave.onclick = async () => {
          // @ts-ignore
          const name = row.querySelector(".amb-name-edit").value;
          // @ts-ignore
          const college = row.querySelector(".amb-col-edit").value;
          await storage.registerOrUpdateAmbassador(code, name, college);
          DashboardUI.showToast(`Updated & synced profile for ${code} on Firestore`, "success");
        };
      });
    }

    showCADrilldown(ca) {
      const modal = document.getElementById("caModal");
      document.getElementById("modalInitials").textContent = ca.caCode.substring(0, 4);
      document.getElementById("modalCAName").textContent = ca.caName;
      document.getElementById("modalCACode").textContent = `CODE: ${ca.caCode} ${ca.college ? '• ' + ca.college : ''}`;
      document.getElementById("modalRankBadge").textContent = `Rank #${ca.rank}`;

      document.getElementById("modalPoints").textContent = ca.totalPoints.toLocaleString();
      document.getElementById("modalTickets").textContent = ca.totalTickets.toLocaleString();
      document.getElementById("modalPeakCount").textContent = `⚡ ${ca.peakTickets} (+${ca.peakBonusPoints} pts)`;
      document.getElementById("modalRevenue").textContent = `₹${ca.totalRevenue.toLocaleString()}`;

      document.getElementById("modalBadgesContainer").innerHTML = ca.badges.map(b => `<span class="badge-tag-mini badge-${b.type}">${b.text}</span>`).join(" ");

      const tbody = document.getElementById("modalTransactionsBody");
      tbody.innerHTML = "";
      ca.transactions.forEach(t => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${t.eventName}</strong><br/><small class="text-muted font-mono">${t.orderId}</small></td>
          <td><small class="font-mono">${t.dateFormatted}</small></td>
          <td><strong>${t.quantity}</strong></td>
          <td class="font-mono">₹${t.amount.toLocaleString()}</td>
          <td>${t.isPeak ? `<span class="text-purple font-bold">⚡ Yes (+${t.bonusPoints} pts)</span>` : '<span class="text-muted">No</span>'}</td>
          <td class="text-right"><span class="text-cyan font-bold">${t.totalPoints} pts</span></td>
        `;
        tbody.appendChild(tr);
      });

      this.renderChart(ca);
      modal.classList.add("active");
      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();
    }

    renderChart(ca) {
      const canvas = document.getElementById("caEventChart");
      // @ts-ignore
      if (!canvas || typeof Chart === "undefined") return;
      if (this.chart) this.chart.destroy();

      const labels = Object.keys(ca.events);
      const data = labels.map(k => ca.events[k].points);
      const colors = ["#7928ca", "#00f2fe", "#ffb703", "#f72585", "#10b981", "#6366f1"];

      // @ts-ignore
      this.chart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "right", labels: { color: "#94a3b8", font: { family: "Inter", size: 11 } } } }
        }
      });
    }

    static showToast(msg, type = "info") {
      const container = document.getElementById("toastContainer");
      const toast = document.createElement("div");
      toast.className = `toast ${type}`;
      let icon = type === "success" ? "check-circle" : type === "warning" ? "alert-triangle" : "info";
      toast.innerHTML = `<i data-lucide="${icon}"></i><span>${msg}</span>`;
      container.appendChild(toast);
      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();

      setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }
  }

  // -----------------------------------------------------------------------
  // 6. APPLICATION CONTROLLER & REALTIME EVENT WIRING
  // -----------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // @ts-ignore
    if (window.lucide) window.lucide.createIcons();

    const ui = new DashboardUI();
    let filterEvent = "ALL";
    let searchQuery = "";
    let sortBy = "points_desc";

    const recalculateAll = () => {
      const result = CalculationEngine.processAllSavedDatasets();

      ui.renderStats(result.summary, result.eventStats.length);
      ui.renderPodium(result.leaderboard, (ca) => ui.showCADrilldown(ca));
      ui.renderEventSummary(result.eventStats, async (eventName) => {
        if (confirm(`Delete stored dataset for "${eventName}" from Firestore?`)) {
          await storage.deleteEventFromFirestore(eventName);
          recalculateAll();
          DashboardUI.showToast(`Deleted ${eventName} from Firestore`, "info");
        }
      });
      ui.renderLeaderboard(result.leaderboard, filterEvent, searchQuery, sortBy, (ca) => ui.showCADrilldown(ca));

      const datasetCount = Object.keys(storage.eventDatasets).length;
      document.getElementById("btnClearData").style.display = datasetCount > 0 ? "inline-flex" : "none";
    };

    // Start Realtime Synchronization with Firebase Firestore
    storage.startRealtimeSync(() => {
      recalculateAll();
    });

    // File Upload & Modal Queue
    const fileInput = document.getElementById("fileInput");
    const dropZone = document.getElementById("dropZone");
    const fileEventModal = document.getElementById("fileEventModal");
    const btnCloseFileEventModal = document.getElementById("btnCloseFileEventModal");
    const btnCancelFileEvent = document.getElementById("btnCancelFileEvent");
    const btnConfirmFileEvent = document.getElementById("btnConfirmFileEvent");
    const uploadModalFilename = document.getElementById("uploadModalFilename");
    const modeExistingEvent = document.getElementById("modeExistingEvent");
    const modeNewEvent = document.getElementById("modeNewEvent");
    const sectionExistingEvent = document.getElementById("sectionExistingEvent");
    const sectionNewEvent = document.getElementById("sectionNewEvent");
    const savedEventsDropdown = document.getElementById("savedEventsDropdown");
    const newEventNameInput = document.getElementById("newEventNameInput");
    const eventPointsInput = document.getElementById("eventPointsInput");

    let fileQueue = [];
    let currentFile = null;

    const updateEventMode = () => {
      // @ts-ignore
      if (modeExistingEvent.checked) {
        sectionExistingEvent.style.display = "block";
        sectionNewEvent.style.display = "none";
        // @ts-ignore
        const opt = savedEventsDropdown.options[savedEventsDropdown.selectedIndex];
        // @ts-ignore
        if (opt && opt.dataset.points) eventPointsInput.value = opt.dataset.points;
      } else {
        sectionExistingEvent.style.display = "none";
        sectionNewEvent.style.display = "block";
        // @ts-ignore
        if (!newEventNameInput.value && currentFile) {
          // @ts-ignore
          newEventNameInput.value = MakeMyPassParser.inferName(currentFile.name);
        }
      }
    };

    modeExistingEvent.addEventListener("change", updateEventMode);
    modeNewEvent.addEventListener("change", updateEventMode);

    savedEventsDropdown.addEventListener("change", () => {
      // @ts-ignore
      const opt = savedEventsDropdown.options[savedEventsDropdown.selectedIndex];
      // @ts-ignore
      if (opt && opt.dataset.points) eventPointsInput.value = opt.dataset.points;
    });

    const populateDropdown = (inferred) => {
      // @ts-ignore
      savedEventsDropdown.innerHTML = "";
      const events = Object.values(storage.eventDatasets);
      let matchedIdx = 0;

      events.forEach((ev, idx) => {
        const opt = document.createElement("option");
        opt.value = ev.eventName;
        opt.textContent = `${ev.eventName} (${ev.points} pts / tkt)`;
        opt.dataset.points = String(ev.points);
        // @ts-ignore
        savedEventsDropdown.appendChild(opt);

        if (inferred && ev.eventName.toLowerCase().includes(inferred.toLowerCase())) {
          matchedIdx = idx;
        }
      });

      if (events.length > 0) {
        // @ts-ignore
        savedEventsDropdown.selectedIndex = matchedIdx;
        // @ts-ignore
        eventPointsInput.value = events[matchedIdx].points;
      }
    };

    const processNextQueueItem = () => {
      if (fileQueue.length === 0) {
        fileEventModal.classList.remove("active");
        currentFile = null;
        return;
      }

      currentFile = fileQueue.shift();
      uploadModalFilename.textContent = `Importing: ${currentFile.name}`;
      const inferred = MakeMyPassParser.inferName(currentFile.name);
      // @ts-ignore
      newEventNameInput.value = inferred;
      // @ts-ignore
      modeExistingEvent.checked = true;

      populateDropdown(inferred);
      updateEventMode();
      fileEventModal.classList.add("active");
    };

    const closeEventModal = () => {
      fileEventModal.classList.remove("active");
      fileQueue = [];
      currentFile = null;
    };

    btnCloseFileEventModal.addEventListener("click", closeEventModal);
    btnCancelFileEvent.addEventListener("click", closeEventModal);

    btnConfirmFileEvent.addEventListener("click", async () => {
      if (!currentFile) return;
      // @ts-ignore
      const eventName = modeExistingEvent.checked ? savedEventsDropdown.value.trim() : newEventNameInput.value.trim();
      if (!eventName) {
        DashboardUI.showToast("Please enter or select an event name", "warning");
        return;
      }

      // @ts-ignore
      const points = Number(eventPointsInput.value) || 25;

      const overlay = document.getElementById("processingOverlay");
      const overlaySubtext = document.getElementById("processingSubtext");
      if (overlay) {
        overlay.style.display = "flex";
        overlaySubtext.textContent = `Analyzing ${currentFile.name}...`;
      }

      try {
        const parsed = await MakeMyPassParser.parseFile(currentFile, eventName, points);
        if (overlay) overlaySubtext.textContent = `Syncing ${parsed.validCARows.length} records to Firestore...`;
        
        // Save to Firestore (replaces previous data if event already exists)
        const isUpdate = storage.eventDatasets[eventName] !== undefined;
        await storage.uploadEventToFirestore(eventName, points, currentFile.name, parsed.allRows);
        
        recalculateAll();
        
        if (isUpdate) {
          DashboardUI.showToast(`Updated [${eventName}] on Firestore (${parsed.validCARows.length} sales)! Previous data replaced.`, "success");
        } else {
          DashboardUI.showToast(`Uploaded [${eventName}] to Firestore (${parsed.validCARows.length} sales)!`, "success");
        }
      } catch (err) {
        console.error(err);
        DashboardUI.showToast(`Error parsing ${currentFile.name}`, "error");
      } finally {
        if (overlay) overlay.style.display = "none";
      }

      processNextQueueItem();
    });

    const handleFiles = (files) => {
      if (!files || files.length === 0) return;
      fileQueue = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".csv"));
      if (fileQueue.length > 0) processNextQueueItem();
    };

    fileInput.addEventListener("change", (e) => {
      // @ts-ignore
      handleFiles(e.target.files);
      // @ts-ignore
      e.target.value = "";
    });

    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
      // @ts-ignore
      if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
    });

    // Clear Data
    document.getElementById("btnClearData").addEventListener("click", async () => {
      if (confirm("Clear all event datasets from Firestore? Ambassador profiles will remain saved.")) {
        await storage.clearAllDatasetsFromFirestore();
        recalculateAll();
        DashboardUI.showToast("All event datasets removed from Firestore", "warning");
      }
    });

    // Search & Filter Listeners
    const searchInput = document.getElementById("searchInput");
    const btnClearSearch = document.getElementById("btnClearSearch");
    const eventFilter = document.getElementById("eventFilter");
    const sortBySelect = document.getElementById("sortBySelect");

    searchInput.addEventListener("input", (e) => {
      // @ts-ignore
      searchQuery = e.target.value;
      // @ts-ignore
      btnClearSearch.style.display = searchQuery ? "inline-block" : "none";
      recalculateAll();
    });

    btnClearSearch.addEventListener("click", () => {
      // @ts-ignore
      searchInput.value = "";
      searchQuery = "";
      btnClearSearch.style.display = "none";
      recalculateAll();
    });

    eventFilter.addEventListener("change", (e) => {
      // @ts-ignore
      filterEvent = e.target.value;
      recalculateAll();
    });

    sortBySelect.addEventListener("change", (e) => {
      // @ts-ignore
      sortBy = e.target.value;
      recalculateAll();
    });

    // Ambassador Directory Modal
    const ambassadorDirModal = document.getElementById("ambassadorDirModal");
    const btnOpenAmbassadors = document.getElementById("btnOpenAmbassadors");
    const btnCloseAmbassadorDirModal = document.getElementById("btnCloseAmbassadorDirModal");
    const btnCloseAmbassadorDirBtn = document.getElementById("btnCloseAmbassadorDirBtn");
    const btnSaveAmbassadorProfile = document.getElementById("btnSaveAmbassadorProfile");
    const dirInputCode = document.getElementById("dirInputCode");
    const dirInputName = document.getElementById("dirInputName");
    const dirInputCollege = document.getElementById("dirInputCollege");

    const openAmbassadorDir = () => {
      const res = CalculationEngine.processAllSavedDatasets();
      ui.renderAmbassadorsDirectory(res.leaderboard, (ca) => ui.showCADrilldown(ca));
      ambassadorDirModal.classList.add("active");
    };

    const closeAmbassadorDir = () => {
      ambassadorDirModal.classList.remove("active");
      recalculateAll();
    };

    btnOpenAmbassadors.addEventListener("click", openAmbassadorDir);
    btnCloseAmbassadorDirModal.addEventListener("click", closeAmbassadorDir);
    btnCloseAmbassadorDirBtn.addEventListener("click", closeAmbassadorDir);

    btnSaveAmbassadorProfile.addEventListener("click", async () => {
      // @ts-ignore
      const code = dirInputCode.value.trim().toUpperCase();
      // @ts-ignore
      const name = dirInputName.value.trim();
      // @ts-ignore
      const college = dirInputCollege.value.trim();

      if (!code) {
        DashboardUI.showToast("Please enter a valid CA Code (e.g., DCA006)", "warning");
        return;
      }

      if (!CA_REGEX.test(code)) {
        DashboardUI.showToast("Code must start with DCA (e.g. DCA006, DCA115)", "warning");
        return;
      }

      await storage.registerOrUpdateAmbassador(code, name, college);
      // @ts-ignore
      dirInputCode.value = "";
      // @ts-ignore
      dirInputName.value = "";
      // @ts-ignore
      dirInputCollege.value = "";

      const res = CalculationEngine.processAllSavedDatasets();
      ui.renderAmbassadorsDirectory(res.leaderboard, (ca) => ui.showCADrilldown(ca));
      recalculateAll();
      DashboardUI.showToast(`Saved Ambassador profile for ${code} on Firestore`, "success");
    });

    // Export CSV
    document.getElementById("btnExportSummary").addEventListener("click", () => {
      const res = CalculationEngine.processAllSavedDatasets();

      if (res.leaderboard.length === 0) {
        DashboardUI.showToast("No data to export", "warning");
        return;
      }

      const rows = [["Rank", "Campus Ambassador Name", "CA Code", "College", "Total Points", "Tickets Sold", "Peak Hour Tickets", "Bonus Points", "Revenue (INR)", "Event Breakdown"].join(",")];
      res.leaderboard.forEach(ca => {
        const evStr = Object.entries(ca.events).map(([k, v]) => `${k}: ${v.tickets} tkts (${v.points} pts)`).join(" | ");
        rows.push([ca.rank, `"${ca.caName}"`, `"${ca.caCode}"`, `"${ca.college}"`, ca.totalPoints, ca.totalTickets, ca.peakTickets, ca.peakBonusPoints, ca.totalRevenue, `"${evStr}"`].join(","));
      });

      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `Dhwani26_CA_Leaderboard_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      DashboardUI.showToast("Exported Leaderboard CSV successfully!", "success");
    });

    // CA Drilldown Modal Close
    const caModal = document.getElementById("caModal");
    const closeCAModal = () => caModal.classList.remove("active");
    document.getElementById("btnCloseCAModal").onclick = closeCAModal;
    document.getElementById("btnCloseCAModalBtn").onclick = closeCAModal;

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeCAModal();
        closeEventModal();
        closeAmbassadorDir();
      }
    });

    [caModal, fileEventModal, ambassadorDirModal].forEach(modal => {
      if (modal) {
        modal.onclick = (e) => {
          if (e.target === modal) {
            modal.classList.remove("active");
            if (modal === ambassadorDirModal) recalculateAll();
          }
        };
      }
    });

    // Initial calculation
    recalculateAll();
  });
})();
