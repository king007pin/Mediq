import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const OCR_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

async function testModel(model: string, apiKey: string, base64: string, mime: string) {
  console.log(`\nTesting model: ${model}`);
  const start = Date.now();
  try {
    const res = await fetch(OCR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Transcribe all visible text labels and values from this scan. Maintain structure.",
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mime};base64,${base64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    const elapsed = Date.now() - start;
    console.log(`HTTP Status: ${res.status} ${res.statusText}`);
    console.log(`Time taken: ${(elapsed / 1000).toFixed(2)}s`);
    const text = await res.text();
    console.log("Response text length:", text.length);
    console.log("Snippet:", text.slice(0, 300));
    return res.ok;
  } catch (err) {
    console.error(`Error with model ${model}:`, err);
    return false;
  }
}

async function main() {
  const visionKeysStr = process.env.NVIDIA_KEY_VISION_POOL || "";
  if (!visionKeysStr) {
    console.error("❌ No NVIDIA_KEY_VISION_POOL found!");
    return;
  }
  const keys = visionKeysStr.split(",").map(k => k.trim()).filter(Boolean);
  const apiKey = keys[0];

  const imgPath = "/Users/shubhammac/.gemini/antigravity-cli/brain/44e32ade-fe1f-4d0f-807c-a1dcbd005dba/mock_chest_xray_1780472209118.png";
  const buffer = fs.readFileSync(imgPath);
  const base64 = buffer.toString("base64");
  const mime = "image/png";

  const models = [
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
    "nvidia/nemotron-nano-12b-v2-vl"
  ];

  for (const model of models) {
    await testModel(model, apiKey, base64, mime);
  }
}

main();
