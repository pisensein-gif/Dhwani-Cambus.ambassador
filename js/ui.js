/**
 * Dhwani '26 — UI Controller & Renderer
 * Handles rendering of stats, podium animations, leaderboard table, charts, and modals.
 */

import { configManager } from "./config.js";

export class UIRenderer {
  constructor() {
    this.chartInstance = null;
  }

  /**
   * Update top statistic cards
   */
  static renderStats(summary, eventCount) {
    document.getElementById("statActiveCAs").textContent = summary.totalCAs.toLocaleString();
    document.getElementById("statTicketsSold").textContent = summary.totalTickets.toLocaleString();
    document.getElementById("statTotalPoints").textContent = summary.totalPoints.toLocaleString();
    document.getElementById("statTotalRevenue").textContent = `₹${summary.totalRevenue.toLocaleString()}`;

    document.getElementById("statTopCA").textContent = summary.topCA ? `Top: ${summary.topCA}` : "Top: --";
    document.getElementById("statPeakTickets").textContent = `⚡ ${summary.totalPeakTickets} in Peak Hours`;
    document.getElementById("statBonusPoints").textContent = `⚡ ${summary.totalBonusPoints} Bonus Points`;
    document.getElementById("statEventsCount").textContent = `${eventCount} Events Processed`;
  }

  /**
   * Render the glowing Top 3 podium
   */
  static renderPodium(leaderboard, onSelectCA) {
    const podiumSec = document.getElementById("podiumSection");
    if (!leaderboard || leaderboard.length === 0) {
      podiumSec.style.display = "none";
      return;
    }

    podiumSec.style.display = "block";

    const rankCards = [
      { id: "podiumRank1", data: leaderboard[0] },
      { id: "podiumRank2", data: leaderboard[1] },
      { id: "podiumRank3", data: leaderboard[2] }
    ];

    rankCards.forEach(({ id, data }) => {
      const cardEl = document.getElementById(id);
      if (!cardEl) return;

      if (!data) {
        cardEl.style.opacity = "0.3";
        cardEl.style.pointerEvents = "none";
        return;
      }

      cardEl.style.opacity = "1";
      cardEl.style.pointerEvents = "auto";

      const initials = data.caName
        .split(" ")
        .map(n => n.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const initialsEl = cardEl.querySelector(".avatar-initials");
      const nameEl = cardEl.querySelector(".ca-name");
      const codeEl = cardEl.querySelector(".ca-code-badge");
      const pointsEl = cardEl.querySelector(".score-points");
      const metaEl = cardEl.querySelector(".score-meta");

      if (initialsEl) initialsEl.textContent = initials;
      if (nameEl) {
        nameEl.textContent = data.caName;
        nameEl.title = data.caName;
      }
      if (codeEl) codeEl.textContent = data.caCode;
      if (pointsEl) pointsEl.innerHTML = `${data.totalPoints.toLocaleString()} <small>PTS</small>`;
      if (metaEl) {
        metaEl.innerHTML = `<span>🎟️ ${data.totalTickets} Tickets</span><span>⚡ ${data.peakTickets} Peak</span>`;
      }

      cardEl.onclick = () => onSelectCA(data);
    });

    // Fire festive confetti
    try {
      // @ts-ignore
      if (typeof confetti === "function") {
        // @ts-ignore
        confetti({
          particleCount: 40,
          spread: 70,
          origin: { y: 0.7 },
          colors: ["#00f2fe", "#a855f7", "#ffb703", "#f72585"]
        });
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * Render the main Leaderboard Table with search and filter state
   */
  static renderLeaderboard(leaderboard, filterEvent, searchQuery, sortBy, onSelectCA) {
    const tbody = document.getElementById("leaderboardBody");
    const footerBar = document.getElementById("tableFooterBar");
    const showingCount = document.getElementById("showingCount");

    if (!leaderboard || leaderboard.length === 0) {
      tbody.innerHTML = `
        <tr class="empty-state-row">
          <td colspan="8">
            <div class="empty-state">
              <div class="empty-icon"><i data-lucide="inbox"></i></div>
              <h4>No Data Loaded Yet</h4>
              <p>Upload your MakeMyPass CSV files above or click <strong>"Load Demo Data"</strong> to see live calculations.</p>
            </div>
          </td>
        </tr>
      `;
      footerBar.style.display = "none";
      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Filter by Event
    let filtered = leaderboard.map(ca => {
      if (filterEvent === "ALL") return ca;
      const ev = ca.events[filterEvent];
      if (!ev) return null;
      return {
        ...ca,
        displayPoints: ev.points,
        displayTickets: ev.tickets,
        displayRevenue: ev.revenue
      };
    }).filter(Boolean);

    // Filter by Search Query
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(ca => 
        ca.caName.toLowerCase().includes(q) || ca.caCode.toLowerCase().includes(q)
      );
    }

    // Sort leaderboard
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
              <h4>No Matching Campus Ambassadors</h4>
              <p>No results found for "${searchQuery}". Try clearing your search query or event filter.</p>
            </div>
          </td>
        </tr>
      `;
      footerBar.style.display = "none";
      // @ts-ignore
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    footerBar.style.display = "flex";
    showingCount.textContent = filtered.length;

    let html = "";
    filtered.forEach((ca, index) => {
      const currentRank = index + 1;
      let rankClass = "rank-rest";
      if (currentRank === 1) rankClass = "rank-1";
      else if (currentRank === 2) rankClass = "rank-2";
      else if (currentRank === 3) rankClass = "rank-3";

      const points = filterEvent === "ALL" ? ca.totalPoints : ca.displayPoints;
      const tickets = filterEvent === "ALL" ? ca.totalTickets : ca.displayTickets;
      const revenue = filterEvent === "ALL" ? ca.totalRevenue : ca.displayRevenue;

      const initials = ca.caName.split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();

      const badgesHtml = ca.badges.map(b => 
        `<span class="badge-tag-mini badge-${b.type}">${b.text}</span>`
      ).join(" ");

      html += `
        <tr data-ca-code="${ca.caCode}">
          <td class="col-rank">
            <span class="rank-indicator ${rankClass}">${currentRank}</span>
          </td>
          <td class="col-ca">
            <div class="ca-profile-cell">
              <div class="ca-avatar-mini">${initials}</div>
              <div>
                <div class="ca-meta-title">${ca.caName}</div>
                <div class="ca-meta-code">${ca.caCode}</div>
              </div>
            </div>
          </td>
          <td class="col-tickets text-center">
            <strong>${tickets}</strong>
          </td>
          <td class="col-peak text-center">
            <span class="text-purple font-mono font-bold">⚡ ${ca.peakTickets}</span>
          </td>
          <td class="col-revenue text-right font-mono">
            ₹${revenue.toLocaleString()}
          </td>
          <td class="col-badges">
            <div class="badges-wrap">${badgesHtml || '<span class="text-muted text-xs">-</span>'}</div>
          </td>
          <td class="col-points text-right">
            <span class="points-pill">${points.toLocaleString()} <small>PTS</small></span>
          </td>
          <td class="col-action text-center">
            <button class="btn btn-xs btn-outline btn-view-ca" data-ca-code="${ca.caCode}">
              <i data-lucide="external-link"></i> Details
            </button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Attach row click listeners
    tbody.querySelectorAll("tr[data-ca-code]").forEach(row => {
      const code = row.getAttribute("data-ca-code");
      const caObj = leaderboard.find(c => c.caCode === code);
      row.onclick = (e) => {
        // Prevent double trigger if clicking inner button
        if (caObj) onSelectCA(caObj);
      };
    });

    // @ts-ignore
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Populate Event Filter Dropdown options
   */
  static populateEventFilter(eventStats) {
    const filterSelect = document.getElementById("eventFilter");
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = `<option value="ALL">All Events</option>`;
    
    eventStats.forEach(ev => {
      const opt = document.createElement("option");
      opt.value = ev.eventName;
      opt.textContent = `${ev.eventName} (${ev.totalTickets} tickets)`;
      filterSelect.appendChild(opt);
    });

    if (currentVal && Array.from(filterSelect.options).some(o => o.value === currentVal)) {
      filterSelect.value = currentVal;
    }
  }

  /**
   * Render Event-wise Summary Cards Grid
   */
  static renderEventSummaryGrid(eventStats) {
    const section = document.getElementById("eventsSummarySection");
    const grid = document.getElementById("eventsGrid");

    if (!eventStats || eventStats.length === 0) {
      section.style.display = "none";
      return;
    }

    section.style.display = "block";
    grid.innerHTML = "";

    eventStats.forEach(ev => {
      const card = document.createElement("div");
      card.className = "event-card";
      card.innerHTML = `
        <div class="event-card-head">
          <span class="event-title">${ev.eventName}</span>
          <span class="event-pts-badge">${ev.basePointsPerTicket} pts/tkt</span>
        </div>
        <div class="event-stats-row">
          <span>Tickets Sold:</span>
          <strong class="text-bright">${ev.totalTickets}</strong>
        </div>
        <div class="event-stats-row">
          <span>CAs Active:</span>
          <strong class="text-cyan">${ev.caCount}</strong>
        </div>
        <div class="event-stats-row">
          <span>Total Points Awarded:</span>
          <strong class="text-gold">${ev.totalPoints.toLocaleString()}</strong>
        </div>
        <div class="event-stats-row">
          <span>Total Revenue:</span>
          <strong class="text-emerald font-mono">₹${ev.totalRevenue.toLocaleString()}</strong>
        </div>
      `;
      grid.appendChild(card);
    });
  }



  /**
   * Render Detailed CA Modal with transaction history and Chart.js chart
   */
  renderCADrilldown(ca) {
    const modal = document.getElementById("caModal");
    const initialsEl = document.getElementById("modalInitials");
    const nameEl = document.getElementById("modalCAName");
    const codeEl = document.getElementById("modalCACode");
    const rankEl = document.getElementById("modalRankBadge");

    const pointsEl = document.getElementById("modalPoints");
    const ticketsEl = document.getElementById("modalTickets");
    const peakCountEl = document.getElementById("modalPeakCount");
    const revenueEl = document.getElementById("modalRevenue");
    const badgesBox = document.getElementById("modalBadgesContainer");
    const txnBody = document.getElementById("modalTransactionsBody");

    const initials = ca.caName.split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();
    initialsEl.textContent = initials;
    nameEl.textContent = ca.caName;
    codeEl.textContent = `CODE: ${ca.caCode}`;
    rankEl.textContent = `Rank #${ca.rank}`;

    pointsEl.textContent = ca.totalPoints.toLocaleString();
    ticketsEl.textContent = ca.totalTickets.toLocaleString();
    peakCountEl.textContent = `⚡ ${ca.peakTickets} (Bonus +${ca.peakBonusPoints} pts)`;
    revenueEl.textContent = `₹${ca.totalRevenue.toLocaleString()}`;

    // Render Badges
    badgesBox.innerHTML = ca.badges.map(b => 
      `<span class="badge-tag-mini badge-${b.type}">${b.text}</span>`
    ).join(" ");

    // Render Transactions Table
    txnBody.innerHTML = "";
    ca.transactions.forEach(t => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${t.eventName}</strong> <br/><small class="text-muted font-mono">${t.orderId}</small></td>
        <td><small class="font-mono">${t.dateFormatted}</small></td>
        <td>${t.quantity}</td>
        <td class="font-mono">₹${t.amount.toLocaleString()}</td>
        <td>${t.isPeak ? `<span class="text-purple font-bold">⚡ Yes (+${t.bonusPoints} pts)</span>` : '<span class="text-muted">No</span>'}</td>
        <td class="text-right"><span class="text-cyan font-bold">${t.totalPoints} pts</span></td>
      `;
      txnBody.appendChild(tr);
    });

    // Render Chart.js Donut Chart
    this.renderCAChart(ca);

    modal.classList.add("active");
    // @ts-ignore
    if (window.lucide) window.lucide.createIcons();
  }

  /**
   * Render Chart.js event points breakdown
   */
  renderCAChart(ca) {
    const canvas = document.getElementById("caEventChart");
    if (!canvas) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    const eventLabels = Object.keys(ca.events);
    const eventPointsData = eventLabels.map(k => ca.events[k].points);
    const colors = [
      "#7928ca", "#00f2fe", "#ffb703", "#f72585", 
      "#10b981", "#6366f1", "#f59e0b", "#ec4899"
    ];

    // @ts-ignore
    this.chartInstance = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: eventLabels,
        datasets: [{
          data: eventPointsData,
          backgroundColor: colors.slice(0, eventLabels.length),
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.1)"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "right",
            labels: { color: "#94a3b8", font: { family: "Inter", size: 11 } }
          }
        }
      }
    });
  }



  /**
   * Helper to display temporary toast notifications
   */
  static showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let iconName = "info";
    if (type === "success") iconName = "check-circle";
    if (type === "warning") iconName = "alert-triangle";
    if (type === "error") iconName = "alert-circle";

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    // @ts-ignore
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}
