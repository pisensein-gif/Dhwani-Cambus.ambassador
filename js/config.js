/**
 * Dhwani '26 — Configuration & Rules Store
 * Manages event base points, peak hour windows, and column mappings.
 * Persists user customizations into localStorage.
 */

const STORAGE_KEY_CONFIG = "DHWANI26_CA_CONFIG_V2";
const STORAGE_KEY_SAVED_EVENTS = "DHWANI26_SAVED_EVENTS_V2";

// Default configuration rules for Dhwani '26
export const DEFAULT_CONFIG = {
  defaultBasePoints: 10,
  caCodeRegex: "^DCA[0-9A-Z]+$", // Strictly validates DCAxxx codes (e.g. DCA006, DCA115, DCA213)
  eventPoints: {
    "Day & Festival Pass": 25,
    "Day 1 Pass": 15,
    "Day 2 Pass": 20,
    "Day 3 pass": 30,
    "Proshow Night": 50,
    "Choreonite Dance": 40,
    "Battle of the Bands": 35
  },
  peakWindows: [
    {
      id: "peak-1",
      name: "Evening Flash Sale (Daily 18:00 - 22:00)",
      type: "recurring_daily",
      startTime: "18:00",
      endTime: "22:00",
      bonusPoints: 10,
      active: true
    },
    {
      id: "peak-2",
      name: "Late Night Surge (Daily 22:00 - 23:59)",
      type: "recurring_daily",
      startTime: "22:00",
      endTime: "23:59",
      bonusPoints: 15,
      active: true
    }
  ],
  columnKeywords: {
    coupon: [
      "campus_ambassador_referal_code",
      "campus_ambassador_referral_code",
      "campus ambassador referal code",
      "campus ambassador referral code",
      "ca_referral_code",
      "ca_code",
      "coupon",
      "referral_code",
      "ambassador"
    ],
    date: ["registered_at", "date", "created_at", "time", "booked at", "timestamp"],
    amount: ["amount", "amount paid", "total", "price", "ticket price", "paid amount"],
    quantity: ["no_of_tickets", "quantity", "qty", "tickets", "ticket count", "seats"],
    eventName: ["ticket_name", "event", "event name", "ticket name", "category"],
    orderId: ["ticket_code", "event_register_id", "order id", "booking id", "reference id"]
  }
};

class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
    this.savedEvents = this.loadSavedEvents();
  }

  loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      if (saved) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn("Failed to parse saved config, using defaults", e);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  loadSavedEvents() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SAVED_EVENTS);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to load saved events", e);
    }
    // Default initial events
    return [
      { name: "Day & Festival Pass", points: 25 },
      { name: "Day 1 Pass", points: 15 },
      { name: "Day 2 Pass", points: 20 },
      { name: "Day 3 pass", points: 30 },
      { name: "Proshow Night", points: 50 },
      { name: "Choreonite Dance", points: 40 },
      { name: "Battle of the Bands", points: 35 }
    ];
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(this.config));
    } catch (e) {
      console.error("Failed to save config", e);
    }
  }

  saveEventsList(events) {
    this.savedEvents = events;
    try {
      localStorage.setItem(STORAGE_KEY_SAVED_EVENTS, JSON.stringify(this.savedEvents));
    } catch (e) {
      console.error("Failed to save events list", e);
    }
  }

  registerOrUpdateEvent(eventName, points) {
    const cleanName = eventName.trim();
    const cleanPoints = Number(points) || this.config.defaultBasePoints;

    // Update in eventPoints dictionary
    this.config.eventPoints[cleanName] = cleanPoints;
    this.saveConfig(this.config);

    // Update in savedEvents array
    const existingIdx = this.savedEvents.findIndex(
      e => e.name.toLowerCase() === cleanName.toLowerCase()
    );

    if (existingIdx >= 0) {
      this.savedEvents[existingIdx].points = cleanPoints;
    } else {
      this.savedEvents.push({ name: cleanName, points: cleanPoints });
    }
    this.saveEventsList(this.savedEvents);
  }

  getEventBasePoints(eventName) {
    if (!eventName) return this.config.defaultBasePoints;
    
    // Exact match
    if (this.config.eventPoints[eventName] !== undefined) {
      return Number(this.config.eventPoints[eventName]);
    }

    // Case-insensitive match
    const lower = eventName.toLowerCase().trim();
    for (const [key, points] of Object.entries(this.config.eventPoints)) {
      if (key.toLowerCase().trim() === lower) {
        return Number(points);
      }
    }

    return Number(this.config.defaultBasePoints);
  }

  isValidCACode(code) {
    if (!code || typeof code !== "string") return false;
    const clean = code.trim().toUpperCase();
    // Strict DCAxxx pattern: DCA followed by letters/digits (e.g. DCA006, DCA115, DCA213)
    const regex = new RegExp(this.config.caCodeRegex || "^DCA[0-9A-Z]+$", "i");
    return regex.test(clean);
  }
}

export const configManager = new ConfigManager();
