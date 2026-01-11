const API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

/* -------------------- Domain Overrides -------------------- */

const DOMAIN_CATEGORY_MAP = {
  "facebook.com": "Social Media",
  "instagram.com": "Social Media",
  "youtube.com": "Entertainment",
  "twitter.com": "Social Media",
  "x.com": "Social Media",
  "linkedin.com": "Social Media",
  "discord.com": "Social Media",
  "poki.com": "Gaming",
  "crazygames.com": "Gaming",
  "miniclip.com": "Gaming"
};

const VALID_CATEGORIES = [
  "Education",
  "Entertainment",
  "Social Media",
  "Shopping",
  "News",
  "Adult",
  "Gaming",
  "Sports",
  "Finance",
  "Coding",
  "AI Tools",
  "Productivity",
  "Health",
  "Travel",
  "Food",
  "Other"
];


function detectSearchIntent(url) {
  try {
    const u = new URL(url);

    // Google / Bing / DuckDuckGo
    if (
      u.hostname.includes("google.") ||
      u.hostname.includes("bing.com") ||
      u.hostname.includes("duckduckgo.com")
    ) {
      const query =
        u.searchParams.get("q") ||
        u.searchParams.get("query") ||
        "";

      const q = query.toLowerCase();

      if (/python|java|javascript|coding|programming|developer|react|node|flutter/.test(q)) {
        return "Coding";
      }

      if (/ai|artificial intelligence|chatgpt|llm|machine learning|deep learning/.test(q)) {
        return "AI Tools";
      }

      if (/study|education|course|tutorial|learn|college|exam/.test(q)) {
        return "Education";
      }

      if (/money|finance|investment|crypto|stock|trading/.test(q)) {
        return "Finance";
      }

      if (/health|fitness|diet|exercise|mental/.test(q)) {
        return "Health";
      }

      if (/productivity|time management|focus|habits/.test(q)) {
        return "Productivity";
      }
    }
  } catch {}

  return null;
}

/* -------------------- Gemini Categorization -------------------- */

async function categorizeSite(title, url, apiKey) {
  if (!url || url.startsWith("chrome")) return "Other";

  const hostname = new URL(url).hostname.replace("www.", "");
  for (const domain in DOMAIN_CATEGORY_MAP) {
    if (hostname.endsWith(domain)) {
      return DOMAIN_CATEGORY_MAP[domain];
    }
  }

  // 2️⃣ 🔥 Search intent detection (NEW)
  const intentCategory = detectSearchIntent(url);
  if (intentCategory) {
    return intentCategory;
  }
  if (!apiKey) return "Other";


  const prompt = `
You are a strict classification engine.
Return exactly ONE category from the list below:

${VALID_CATEGORIES.join("\n")}

Rules:
- Return only the category name
- No explanations
- No extra text

Title: "${title}"
URL: "${url}"
`;

  try {
    const res = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!res.ok) return "Other";

    const data = await res.json();
    let category = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (category === "Coding / Programming") category = "Coding";
    if (!VALID_CATEGORIES.includes(category)) return "Other";

    return category;

  } catch {
    return "Other";
  }
}

/* -------------------- State -------------------- */

let apiKey = null;
let blockedCategories = {};
let blockedTitles = [];
let blockedSites = [];
let domainCache = {};
let bypassList = {};

/* -------------------- Initial Load -------------------- */

function loadInitialState() {
  chrome.storage.local.get(
    ["apiKey", "blockedCategories", "blockedTitles", "blockedSites", "domainCache"],
    (res) => {
      apiKey = res.apiKey || null;
      blockedCategories = res.blockedCategories || {};
      blockedTitles = res.blockedTitles || [];
      blockedSites = res.blockedSites || [];
      domainCache = res.domainCache || {};
      console.log("Initial state loaded");
    }
  );
}

loadInitialState();

/* -------------------- Storage Sync -------------------- */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  if (changes.apiKey) apiKey = changes.apiKey.newValue;
  if (changes.blockedCategories) blockedCategories = changes.blockedCategories.newValue || {};
  if (changes.blockedTitles) blockedTitles = changes.blockedTitles.newValue || [];
  if (changes.blockedSites) blockedSites = changes.blockedSites.newValue || [];
  if (changes.domainCache) domainCache = changes.domainCache.newValue || {};

  // 🔥 Re-check all tabs when categories change
  if (changes.blockedCategories) {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        if (tab.id && tab.url) {
          checkAndBlock(tab.id, tab);
        }
      });
    });
  }
});

/* -------------------- Messages -------------------- */

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "setApiKey") {
    apiKey = req.key;
    chrome.storage.local.set({ apiKey });
    sendResponse({ success: true });
  }

  if (req.action === "categorizeHistory") {
    processHistory(req.days).then(sendResponse);
    return true;
  }

  if (req.action === "addBypass" && sender.tab) {
    bypassList[sender.tab.id] = Date.now() + 5 * 60 * 1000;
    sendResponse({ success: true });
  }
});

/* -------------------- History Categorization -------------------- */

async function processHistory(days) {
  if (!apiKey) return { error: "No API Key" };

  const startTime = Date.now() - days * 24 * 60 * 60 * 1000;

  const history = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 50
  });

  let updated = false;

  for (const item of history) {
    if (!item.url || item.url.startsWith("chrome")) continue;

    const domain = new URL(item.url).hostname;
    if (!domainCache[domain]) {
      const category = await categorizeSite(item.title, item.url, apiKey);
      domainCache[domain] = category;
      updated = true;
    }
  }

  if (updated) {
    chrome.storage.local.set({ domainCache });
  }

  return { success: true };
}

/* -------------------- Blocking -------------------- */

// Fast navigation block
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;

  const url = details.url;
  if (!url || url.startsWith("chrome")) return;
  if (bypassList[details.tabId] > Date.now()) return;

  const domain = new URL(url).hostname;

  if (blockedSites.some(s => url.includes(s))) {
    blockTab(details.tabId, "Site Blocked", domain);
    return;
  }

  const category = domainCache[domain];
  if (category && blockedCategories[category]) {
    blockTab(details.tabId, "Category Blocked", category);
  }
});

// SPA / title updates
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") {
    checkAndBlock(tabId, tab);
  }
});

async function checkAndBlock(tabId, tab) {
  if (!tab.url || tab.url.startsWith("chrome")) return;
  if (bypassList[tabId] > Date.now()) return;

  const domain = new URL(tab.url).hostname;
  const title = tab.title || "";

  const matchedTitle = blockedTitles.find(t =>
    title.toLowerCase().includes(t.toLowerCase())
  );
  if (matchedTitle) {
    blockTab(tabId, "Title Blocked", matchedTitle);
    return;
  }

  let category = domainCache[domain];
  if (!category && apiKey) {
    category = await categorizeSite(title, tab.url, apiKey);
    domainCache[domain] = category;
    chrome.storage.local.set({ domainCache });
  }

  if (category && blockedCategories[category]) {
    blockTab(tabId, "Category Blocked", category);
  }
}

/* -------------------- Block Page -------------------- */

function blockTab(tabId, reason, detected) {
  chrome.tabs.update(tabId, {
    url: chrome.runtime.getURL(
      `block.html?reason=${encodeURIComponent(reason)}&detected=${encodeURIComponent(detected)}`
    )
  });
}
