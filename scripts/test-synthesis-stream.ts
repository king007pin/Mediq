import dotenv from "dotenv";
import path from "node:path";

// Load test env first to get the DATABASE_URL stub
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });

// Overwrite with real NVIDIA keys from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

// Force a stub DATABASE_URL if it was overwritten with an empty value
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://stub:stub@localhost:5432/stub";

async function main() {
  // Dynamically import runSynthesisAgent so that the env vars are already loaded
  const { runSynthesisAgent } = await import("../src/lib/swarm/agent-runner");

  const model = "meta/llama-3.3-70b-instruct";
  const question = "55-year-old male with sudden crushing chest pain radiating to left arm. Diagnose and outline management.";
  
  const round1Agents = [
    {
      model: "mistralai/ministral-14b-instruct-2512",
      message: "The patient's acute crushing substernal chest pain suggests Acute Coronary Syndrome (ACS), specifically ST-elevation myocardial infarction (STEMI) or non-ST-elevation myocardial infarction (NSTEMI). Immediate ECG and cardiac biomarkers (troponins) are essential.",
      reasoning: "emergency clinical strategy",
      round: 1 as const
    },
    {
      model: "meta/llama-3.1-8b-instruct",
      message: "Cardiology assessment supports ACS. High suspicion of acute myocardial ischemia. Immediate aspirin, heparin, and preparation for primary PCI (if STEMI) or risk stratification are required.",
      reasoning: "cardiology clinical strategy",
      round: 1 as const
    }
  ];

  console.log("🚀 Initializing live synthesis stream test...\n");

  const result = await runSynthesisAgent(
    model,
    question,
    "Evidence snippet [S1]: ACC/AHA guidelines mandate aspirin 162-325 mg immediately for suspected ACS. [S2]: Primary PCI is indicated for STEMI if it can be performed within 120 minutes of first medical contact.",
    round1Agents,
    [], // no debate round 2 for simplicity
    [
      { chunk: "ACC/AHA guidelines mandate aspirin 162-325 mg immediately.", sourceTitle: "AHA Guidelines", sourceUrl: null, position: 0 },
      { chunk: "Primary PCI is indicated within 120 minutes.", sourceTitle: "ACC Guidelines", sourceUrl: null, position: 1 }
    ] as any,
    (token) => {
      // Print tokens in real-time
      process.stdout.write(token);
    }
  );

  console.log("\n\n✅ Stream synthesis finished successfully!");
  console.log(`📊 Total characters generated: ${result.length}`);
}

main().catch((err) => {
  console.error("\n❌ Synthesis stream failed:", err);
  process.exit(1);
});
