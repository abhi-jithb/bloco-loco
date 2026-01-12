const API_URL =
  "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent";

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

export async function categorizeSite(title, url, apiKey) {
  if (!apiKey) throw new Error("API Key is missing");

  const prompt = `
You are a strict classification engine.

Choose exactly ONE category from this list:
${VALID_CATEGORIES.join("\n")}

Rules:
- Respond with only the category name
- No punctuation
- No explanation
- No extra text

Title: "${title}"
URL: "${url}"
`;

  try {
    const response = await fetch(`${API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!response.ok) {
      console.error("Gemini HTTP error:", response.status);
      return "Other";
    }

    const data = await response.json();
    console.log("Gemini raw response:", data);

    let category =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!category) return "Other";

    // Normalize
    if (category === "Coding / Programming") category = "Coding";

    // Validate
    if (!VALID_CATEGORIES.includes(category)) {
      console.warn("Invalid category from Gemini:", category);
      return "Other";
    }

    return category;

  } catch (err) {
    console.error("Gemini API exception:", err);
    return "Other";
  }
}
