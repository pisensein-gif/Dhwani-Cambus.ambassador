/**
 * Dhwani '26 — Points Calculation & Leaderboard Engine
 * Calculates event points, peak hour bonuses, CA aggregations, and badges.
 */

import { configManager } from "./config.js";

export class DhwaniEngine {
  /**
   * Process a list of all normalized rows and return the full leaderboard state
   */
  static processLeaderboard(allRows) {
    const caMap = new Map();
    const eventStatsMap = new Map();
    let globalTickets = 0;
    let globalPeakTickets = 0;
    let globalPoints = 0;
    let globalBonusPoints = 0;
    let globalRevenue = 0;

    // Filter only rows that have a valid Campus Ambassador coupon code
    const validCARows = allRows.filter(r => r.caCode);

    validCARows.forEach(row => {
      const scoring = this.calculateRowScore(row);
      row.scoring = scoring;

      // Update Global Totals
      globalTickets += row.quantity;
      globalRevenue += row.amount;
      globalPoints += scoring.totalPoints;
      globalBonusPoints += scoring.peakBonusPoints;
      if (scoring.isPeak) {
        globalPeakTickets += row.quantity;
      }

      // 1. Group by CA
      if (!caMap.has(row.caCode)) {
        caMap.set(row.caCode, {
          caCode: row.caCode,
          caName: row.caName,
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
      ca.totalPoints += scoring.totalPoints;
      ca.totalTickets += row.quantity;
      ca.totalRevenue += row.amount;
      ca.peakBonusPoints += scoring.peakBonusPoints;
      if (scoring.isPeak) {
        ca.peakTickets += row.quantity;
      }

      // Event breakdown for this CA
      if (!ca.events[row.eventName]) {
        ca.events[row.eventName] = {
          eventName: row.eventName,
          tickets: 0,
          points: 0,
          revenue: 0,
          basePointPerTicket: scoring.basePointsPerTicket
        };
      }
      ca.events[row.eventName].tickets += row.quantity;
      ca.events[row.eventName].points += scoring.totalPoints;
      ca.events[row.eventName].revenue += row.amount;

      // Append transaction to CA history
      ca.transactions.push({
        orderId: row.orderId,
        eventName: row.eventName,
        dateFormatted: row.timestamp.formattedDate + " " + row.timestamp.formattedTime,
        dateObj: row.dateObj,
        quantity: row.quantity,
        amount: row.amount,
        isPeak: scoring.isPeak,
        peakWindowName: scoring.peakWindowName,
        basePoints: scoring.basePointsTotal,
        bonusPoints: scoring.peakBonusPoints,
        totalPoints: scoring.totalPoints
      });

      // 2. Group by Event
      if (!eventStatsMap.has(row.eventName)) {
        eventStatsMap.set(row.eventName, {
          eventName: row.eventName,
          totalTickets: 0,
          totalRevenue: 0,
          totalPoints: 0,
          basePointsPerTicket: scoring.basePointsPerTicket,
          activeCAs: new Set()
        });
      }
      const ev = eventStatsMap.get(row.eventName);
      ev.totalTickets += row.quantity;
      ev.totalRevenue += row.amount;
      ev.totalPoints += scoring.totalPoints;
      ev.activeCAs.add(row.caCode);
    });

    // Convert CA Map to Array and Sort by Total Points (descending)
    const leaderboard = Array.from(caMap.values());
    leaderboard.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.totalTickets !== a.totalTickets) return b.totalTickets - a.totalTickets;
      return b.totalRevenue - a.totalRevenue;
    });

    // Assign Ranks and Badges
    this.assignRanksAndBadges(leaderboard);

    // Format Event Stats
    const eventStats = Array.from(eventStatsMap.values()).map(ev => ({
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
        topCA: leaderboard.length > 0 ? leaderboard[0].caName : "None"
      }
    };
  }

  /**
   * Calculate point metrics for a single row based on event rules and peak windows
   */
  static calculateRowScore(row) {
    const basePointsPerTicket = configManager.getEventBasePoints(row.eventName);
    const basePointsTotal = basePointsPerTicket * row.quantity;

    // Evaluate peak hour matching
    const peakMatch = this.checkPeakHour(row.dateObj);
    let peakBonusPerTicket = 0;
    let peakWindowName = "";

    if (peakMatch.isPeak) {
      peakBonusPerTicket = peakMatch.bonusPoints;
      peakWindowName = peakMatch.windowName;
    }

    const peakBonusPoints = peakBonusPerTicket * row.quantity;
    const totalPoints = basePointsTotal + peakBonusPoints;

    return {
      basePointsPerTicket,
      basePointsTotal,
      isPeak: peakMatch.isPeak,
      peakBonusPerTicket,
      peakBonusPoints,
      peakWindowName,
      totalPoints
    };
  }

  /**
   * Match a timestamp against all active peak hour windows
   */
  static checkPeakHour(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) {
      return { isPeak: false, bonusPoints: 0, windowName: "" };
    }

    const peakWindows = configManager.config.peakWindows.filter(w => w.active);

    for (const win of peakWindows) {
      if (win.type === "recurring_daily") {
        // Match daily time range e.g. 18:00 - 22:00
        const [startH, startM] = win.startTime.split(":").map(Number);
        const [endH, endM] = win.endTime.split(":").map(Number);

        const currentMinutes = dateObj.getHours() * 60 + dateObj.getMinutes();
        const startTotal = startH * 60 + startM;
        const endTotal = endH * 60 + endM;

        if (currentMinutes >= startTotal && currentMinutes <= endTotal) {
          return {
            isPeak: true,
            bonusPoints: Number(win.bonusPoints),
            windowName: win.name
          };
        }
      } else if (win.type === "date_range") {
        // Match specific datetime window
        const start = new Date(win.startDate).getTime();
        const end = new Date(win.endDate).getTime();
        const current = dateObj.getTime();

        if (current >= start && current <= end) {
          return {
            isPeak: true,
            bonusPoints: Number(win.bonusPoints),
            windowName: win.name
          };
        }
      }
    }

    return { isPeak: false, bonusPoints: 0, windowName: "" };
  }

  /**
   * Assign ranks (with ties handled) and dynamic accolade badges
   */
  static assignRanksAndBadges(leaderboard) {
    if (leaderboard.length === 0) return;

    let maxPeak = 0;
    let maxRevenue = 0;

    leaderboard.forEach(ca => {
      if (ca.peakTickets > maxPeak) maxPeak = ca.peakTickets;
      if (ca.totalRevenue > maxRevenue) maxRevenue = ca.totalRevenue;
    });

    leaderboard.forEach((ca, idx) => {
      ca.rank = idx + 1;
      ca.badges = [];

      // Rank 1
      if (ca.rank === 1) {
        ca.badges.push({ text: "👑 Dhwani Leader", type: "champion" });
      }

      // Peak hour champion
      if (maxPeak > 0 && ca.peakTickets === maxPeak && ca.peakTickets >= 5) {
        ca.badges.push({ text: "⚡ Rush Hour Master", type: "rush" });
      }

      // Century milestone
      if (ca.totalTickets >= 100) {
        ca.badges.push({ text: "🎯 Century Club (100+)", type: "century" });
      } else if (ca.totalTickets >= 50) {
        ca.badges.push({ text: "🔥 Half-Century (50+)", type: "rush" });
      }

      // Revenue King
      if (maxRevenue > 0 && ca.totalRevenue === maxRevenue && ca.totalRevenue >= 10000) {
        ca.badges.push({ text: "💎 Revenue Royalty", type: "revenue" });
      }

      // Multi-event all rounder
      const eventCount = Object.keys(ca.events).length;
      if (eventCount >= 3) {
        ca.badges.push({ text: `🌟 All-Rounder (${eventCount} Events)`, type: "century" });
      }
    });
  }
}
