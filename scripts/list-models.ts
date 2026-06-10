import dotenv from "dotenv";
import path from "node:path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function listModels() {
  const keysStr = process.env.NVIDIA_API_KEY || "";
  if (!keysStr) {
    console.error("❌ No NVIDIA_API_KEY found!");
    return;
  }
  const keys = keysStr.split(",").map(k => k.trim()).filter(Boolean);
  const apiKey = keys[0];

  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    console.log(`HTTP Status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const data = await res.json() as { data: Array<{ id: string }> };
      const visionModels = data.data.filter(m => m.id.toLowerCase().includes("vision") || m.id.toLowerCase().includes("neva") || m.id.toLowerCase().includes("ocr"));
      console.log("Found vision/ocr models:");
      visionModels.forEach(m => console.log(` - ${m.id}`));
      
      console.log("\nAll models:");
      data.data.forEach(m => console.log(` - ${m.id}`));
    } else {
      const text = await res.text();
      console.log("Response text:", text);
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

listModels();
