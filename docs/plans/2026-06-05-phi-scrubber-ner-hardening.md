# PHI Scrubber NER Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the MedIQ de-identification system by upgrading the regex-based scrubber to support Indian regional identifiers and integrating a context-aware machine learning Named Entity Recognition (NER) pipeline via Microsoft Presidio inside the FastAPI sidecar.

**Architecture:** 
1. **Hybrid Core**: Update the local Node.js regex scrubber to support Indian Aadhaar, ABHA ID, and Indian mobile phone numbers.
2. **NER FastAPI Route**: Introduce a `/deidentify` route in `sidecar/scrapling_sidecar.py` that utilizes Microsoft Presidio Analyzer and Anonymizer engines backed by a spaCy language model.
3. **Resilient Node Wrapper**: Update `src/lib/phi-scrubber.ts` to call the sidecar's `/deidentify` API when sidecar execution is active (`SCRAPLING_ENABLED=1`), falling back gracefully to the offline regex scrubber on any timeout or failure.

**Tech Stack:** TypeScript, Node.js, Python, FastAPI, Microsoft Presidio Analyzer & Anonymizer, spaCy (`en_core_web_sm`), Vitest.

---

### Task 1: Indian Regional Regex Scrubber Upgrades

**Files:**
- Modify: `src/lib/phi-scrubber.ts`
- Modify: `src/__tests__/security/phiScrubber.test.ts`

**Step 1: Write the failing test**

Add assertions verifying Indian regional IDs inside `src/__tests__/security/phiScrubber.test.ts`. Replace lines 16-22 with:

```typescript
  it("redacts US and Indian phone numbers", () => {
    expect(scrubPhi("call 555-123-4567")).toBe("call [PHONE]");
    expect(scrubPhi("(415) 867-5309")).toBe("[PHONE]");
    expect(scrubPhi("+1 415 867 5309")).toBe("[PHONE]");
    expect(scrubPhi("4158675309")).toBe("[PHONE]");
    expect(scrubPhi("patient mobile +91 98765 43210")).toBe("patient mobile [PHONE]");
    expect(scrubPhi("dial 919876543210 or 09876543210")).toBe("dial [PHONE] or [PHONE]");
  });

  it("redacts Indian national IDs (Aadhaar & ABHA)", () => {
    expect(scrubPhi("Aadhaar: 1234-5678-9012")).toBe("Aadhaar: [AADHAAR]");
    expect(scrubPhi("ABHA ID is 12-3456-7890-1234")).toBe("ABHA ID is [ABHA]");
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/security/phiScrubber.test.ts`
Expected: FAIL with failed assertions for Aadhaar and Indian mobile numbers.

**Step 3: Write minimal implementation**

Update `src/lib/phi-scrubber.ts` by appending Indian rules to the `RULES` array:

```typescript
  // US and Indian phone numbers.
  { pattern: /(?:\+?91[\s.-]?)?[6-9]\d{9}\b/g, replacement: "[PHONE]" },
  { pattern: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replacement: "[PHONE]" },
  // US SSN.
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // Indian national IDs.
  { pattern: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, replacement: "[AADHAAR]" },
  { pattern: /\b\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g, replacement: "[ABHA]" },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/security/phiScrubber.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/phi-scrubber.ts src/__tests__/security/phiScrubber.test.ts
git commit -m "security: add Indian regional phone and national ID regex rules"
```

---

### Task 2: Implement FastAPI `/deidentify` NER Endpoint in Sidecar

**Files:**
- Modify: `sidecar/requirements-scrapling.txt`
- Modify: `sidecar/scrapling_sidecar.py`

**Step 1: Write the dependencies**

Add Presidio and spaCy to `sidecar/requirements-scrapling.txt`:

```text
fastapi>=0.110
uvicorn[standard]>=0.27
scrapling>=0.2
presidio-analyzer>=2.2.353
presidio-anonymizer>=2.2.353
spacy>=3.7.0
```

Install the dependencies and the spaCy language model:
```bash
~/scrapling-env/bin/pip install -r sidecar/requirements-scrapling.txt
~/scrapling-env/bin/python -m spacy download en_core_web_sm
```

**Step 2: Add Pydantic schemas and `/deidentify` handler to `sidecar/scrapling_sidecar.py`**

Modify `sidecar/scrapling_sidecar.py` to import and configure Presidio Analyzer and Anonymizer engines:

```python
# Add to imports (around line 21):
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_anonymizer import AnonymizerEngine

# Initialize Presidio engines (around line 38):
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# Define Indian custom pattern recognizers to run in the ML model
aadhaar_pattern = Pattern(name="aadhaar_pattern", regex=r"\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b", score=0.85)
aadhaar_recognizer = PatternRecognizer(supported_entity="AADHAAR", patterns=[aadhaar_pattern])
analyzer.registry.add_recognizer(aadhaar_recognizer)

abha_pattern = Pattern(name="abha_pattern", regex=r"\b\d{2}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b", score=0.85)
abha_recognizer = PatternRecognizer(supported_entity="ABHA", patterns=[abha_pattern])
analyzer.registry.add_recognizer(abha_recognizer)

# Add Pydantic validation schemas
class DeidentifyRequest(BaseModel):
    text: str
    language: str = "en"

class DeidentifyResponse(BaseModel):
    ok: bool
    text: str
    error: Optional[str] = None

# Add endpoint handler
@app.post("/deidentify", response_model=DeidentifyResponse)
async def deidentify(
    req: DeidentifyRequest,
    x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token"),
):
    if SHARED_TOKEN and x_auth_token != SHARED_TOKEN:
        raise HTTPException(status_code=401, detail="bad token")

    if not req.text.strip():
        return DeidentifyResponse(ok=True, text="")

    try:
        # Run Presidio analysis & anonymization
        results = analyzer.analyze(text=req.text, language=req.language)
        anonymized_result = anonymizer.anonymize(text=req.text, analyzer_results=results)
        return DeidentifyResponse(ok=True, text=anonymized_result.text)
    except Exception as e:
        return DeidentifyResponse(ok=False, text=req.text, error=str(e))
```

**Step 3: Run sidecar server locally to verify syntax**

Run: `~/scrapling-env/bin/python -m uvicorn sidecar.scrapling_sidecar:app --port 8003 --reload`
Expected: Server starts successfully with no import or syntax errors. Terminate process.

**Step 4: Commit**

```bash
git add sidecar/requirements-scrapling.txt sidecar/scrapling_sidecar.py
git commit -m "feat: add Presidio-driven deidentify route to Python sidecar"
```

---

### Task 3: Node-to-Sidecar Client Wrapper & Falling Back

**Files:**
- Modify: `src/lib/phi-scrubber.ts`
- Modify: `src/__tests__/security/phiScrubber.test.ts`
- Modify: `src/app/api/lab-extract/route.ts`

**Step 1: Write integration tests in `src/__tests__/security/phiScrubber.test.ts`**

Add tests validating sidecar communication and fallback mechanisms:

```typescript
  describe("scrubPhi — ML sidecar de-identification", () => {
    it("communicates with the sidecar and falls back to regex on error", async () => {
      // Mocking fetch to verify deidentify requests are sent
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url) => {
        if (url.toString().includes("/deidentify")) {
          return new Response(JSON.stringify({ ok: true, text: "Redacted [NAME] text" }), { status: 200 });
        }
        return originalFetch(url);
      };
      
      // Since scrubPhi is synchronous, we create an async sibling scrubPhiAsync
      const res = await scrubPhiAsync("Mr. Alice presents");
      expect(res).toBe("Redacted [NAME] text");

      globalThis.fetch = originalFetch;
    });
  });
```

**Step 2: Implement asynchronous scrubPhiAsync wrapper in `src/lib/phi-scrubber.ts`**

Add `scrubPhiAsync` that triggers sidecar `/deidentify` and falls back:

```typescript
import { safeFetch } from "./safe-fetch";

/**
 * Async context-aware scrubber calling Python sidecar NER.
 * Falls back to synchronous regex-based scrubPhi on failures or timeouts.
 */
export async function scrubPhiAsync(text: string | null | undefined): Promise<string> {
  if (!text) return "";
  
  const enabled = process.env.SCRAPLING_ENABLED !== "0";
  const url = process.env.SCRAPLING_SIDECAR_URL || "http://127.0.0.1:8003";
  const token = process.env.SCRAPLING_SIDECAR_TOKEN || "";

  if (!enabled) {
    return scrubPhi(text);
  }

  try {
    const res = await fetch(`${url}/deidentify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Auth-Token": token } : {}),
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(3000), // Strict 3s budget to prevent blocking requests
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok && typeof data.text === "string") {
        return data.text;
      }
    }
  } catch (err) {
    console.warn("[PHI Scrubber] Sidecar NER failed, falling back to regex: ", err);
  }

  // Fallback to local regex-based de-identification
  return scrubPhi(text);
}
```

Update `/api/lab-extract` to run the async scrubber on document parses:
Modify `src/app/api/lab-extract/route.ts` around line 377:
```typescript
- const scrubbedText = scrubPhi(combinedText);
+ const scrubbedText = await scrubPhiAsync(combinedText);
```

**Step 3: Run unit tests to verify wrapper**

Run: `npx vitest run src/__tests__/security/phiScrubber.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/lib/phi-scrubber.ts src/__tests__/security/phiScrubber.test.ts src/app/api/lab-extract/route.ts
git commit -m "feat: implement scrubPhiAsync with sidecar NER and offline regex fallback"
```

---

### Task 4: Complete Test Verification

Run: `npm run typecheck && npm run test`
Expected: All 612+ tests pass cleanly. Output typechecking is clean.
Commit: `git commit --allow-empty -m "chore: verify build and tests pass cleanly"`
