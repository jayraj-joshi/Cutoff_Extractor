import { GoogleGenAI } from "@google/genai";

// --- Fallback Configuration ---
// Models to cycle through sequentially on 429/503 errors.
const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-3.1-pro-preview",
];

// API keys to cycle through sequentially. Empty/undefined keys are filtered out.
const API_KEYS = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5,
  process.env.GEMINI_API_KEY6,
].filter((key): key is string => !!key && key.trim().length > 0);

/**
 * Checks whether an error is a retryable 429 (rate limit) or 503 (model overload).
 * The @google/genai SDK may throw errors with a status code property,
 * or include the status code in the error message string.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message || "";
    // Check for HTTP status codes in the error message
    if (message.includes("429") || message.includes("503") || message.includes("403") || message.includes("400")) {
      return true;
    }
    // Check for common rate-limit / overload phrases
    if (
      message.toLowerCase().includes("rate limit") ||
      message.toLowerCase().includes("resource exhausted") ||
      message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("model is overloaded") ||
      message.toLowerCase().includes("forbidden") ||
      message.toLowerCase().includes("bad request")
    ) {
      return true;
    }
  }
  // Check for a status or statusCode property on the error object
  if (typeof error === "object" && error !== null) {
    const status = (error as any).status ?? (error as any).statusCode;
    if (status === 429 || status === 503 || status === 403 || status === 400) {
      return true;
    }
  }
  return false;
}


const MHT_CET_SYSTEM_INSTRUCTION = `You are an expert data extraction API.
Extract all tabular cutoff data from the provided MHT-CET engineering college cutoff document and convert it strictly into the structured JSON format defined below.

Extraction Rules:
- Output ONLY valid JSON. Do not include explanations, markdown formatting, or additional commentary.
- Extract and include ALL seat categories present in the document. This includes all region-specific and state-level codes (e.g., GOPENH, LOPENH, GNT1S, PWDRSCS, etc.).
- NO NULL VALUES: Cutoff category fields must NEVER be null. If a category is present in the document, extract its "rank" and "percentile" accurately as an object. If a category is not present for a specific stage, OMIT the field entirely from the JSON object instead of setting it to null.
- Extract the "Home University" name for each college. Ensure the extracted "home_university" value is identical to the one found in the document (usually beside "Status").
- Extract the "city" name for each college, ensuring it captures the main city or district name (e.g., "Ahmednagar" from "Dist.Ahmednagar").
- Correctly identify boundaries between seat sections (Home University, Other Than Home University, State Level). Map sections strictly to their own keys.
- The "Stage" field MUST only contain values like "Stage-I" or "Stage-II". NEVER use section names (like "State Level") as a stage value.
- If any category, stage, or section is missing, return an empty array or omit the field.
- Group all branches under their respective college codes.
- Preserve numerical precision exactly as shown in the document.
- Do not fabricate or infer missing values.
- Cover every page of the documentary and dont loose any single data point. Each table row must be captured.
- In minority status write a Single word like 'Muslim','Christian','Hindi' etc. If the college has no minority status, set minority_status to "None".
- BRANCH CATEGORIZATION (CRITICAL):
  1. If the branch name contains "Computer", "IT", "Information", "AI", "Data Science", or "Software" -> set isTech: true, and ALL other flags (isCivil, isMechanical, isElectrical, isElectronic, isOther) to false.
  2. If the branch name contains "Civil" -> set isCivil: true, and ALL other flags (isTech, isMechanical, isElectrical, isElectronic, isOther) to false.
  3. If the branch name contains "Mechanical" -> set isMechanical: true, and ALL other flags (isTech, isCivil, isElectrical, isElectronic, isOther) to false.
  4. If the branch name contains "Electrical" -> set isElectrical: true, and ALL other flags (isTech, isCivil, isMechanical, isElectronic, isOther) to false.
  5. If the branch name contains "Electronic", "Telecommunication", or "ENTC" -> set isElectronic: true, and ALL other flags (isTech, isCivil, isMechanical, isElectrical, isOther) to false.
  6. Set isOther: true ONLY if the branch name does NOT match ANY of the above categories (e.g., Chemical, Textile, Production, Metallurgy). If isOther is true, then isTech, isCivil, isMechanical, isElectrical, and isElectronic MUST be false.
  7. MANDATORY: Exactly ONE of these 6 boolean flags must be true. It is a violation to have both isCivil: true and isOther: true.
- isMinority: Set at the college level. True if the college has minority status, otherwise false.

Required JSON Schema:
[
  {
    "college_code": "string",
    "college_name": "string",
    "home_university": "string",
    "city": "string",
    "status": "string",
    "minority_status": "string",
    "isMinority": "boolean",
    "branches": [
      {
        "branch_code": "string",
        "branch_name": "string",
        "isTech": "boolean",
        "isElectronic": "boolean",
        "isOther": "boolean",
        "isCivil": "boolean",
        "isMechanical": "boolean",
        "isElectrical": "boolean",
        "cutoff_data": {
          "Home_University_Seats_Allotted_to_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "Other_Than_Home_University_Seats_Allotted_to_Other_Than_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "Home_University_Seats_Allotted_to_Other_Than_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "Other_Than_Home_University_Seats_Allotted_to_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "State_Level": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ]
        }
      }
    ]
  }
]`;

const AIQ_SYSTEM_INSTRUCTION = `You are an expert data extraction API.
Extract all tabular AIQ (All India Quota) cutoff data from the provided document and convert it strictly into the structured JSON format defined below.

Extraction Rules:
- Output ONLY valid JSON. Do not include explanations, markdown formatting, or additional commentary.
- Extract "Sr. No.", "All India Merit" (Rank and Percentile), "Choice Code", "Institute Name", "Course Name", "Merit Exam", "Type", and "Seat Type".
- INSTITUTE EXTRACTION (CRITICAL): Separate the Institute Name field into "institute_code" (the numeric part, e.g., "01101") and "institute_name" (the textual part, e.g., "Shri Sant Gajanan Maharaj College of Engineering, Shegaon"). Omit the hyphen and extra spaces between them.
- Capture every single row from the tables.
- Preserve numerical precision exactly as shown in the document.

Required JSON Schema:
{
  "results": [
    {
      "sr_no": "integer",
      "all_india_merit": {
        "rank": "integer",
        "percentile": "number"
      },
      "choice_code": "string",
      "institute_code": "string",
      "institute_name": "string",
      "course_name": "string",
      "merit_exam": "string",
      "type": "string",
      "seat_type": "string"
    }
  ]
}`;


const PHARMACY_SYSTEM_INSTRUCTION = `You are an expert data extraction API.
Extract all tabular cutoff data from the provided Pharmacy college cutoff document and convert it strictly into the structured JSON format defined below.

Extraction Rules:
- Output ONLY valid JSON. Do not include explanations, markdown formatting, or additional commentary.
- Extract and include ALL seat categories present in the document. This includes all region-specific and state-level codes.
- NO NULL VALUES: Cutoff category fields must NEVER be null. If a category is present in the document, extract its "rank" and "percentile" accurately as an object. If a category is not present for a specific stage, OMIT the field entirely from the JSON object instead of setting it to null.
- Extract the "Status" for each college (e.g., "Government", "Un-Aided", etc.).
- Extract the "city" name for each college, ensuring it captures the main city or district name (e.g., "Amravati" from "Government College of Pharmacy, Amravati").
- Extract the "Home University" name for each college. Ensure the extracted "home_university" value is exactly as it appears in the document.
- In minority status write a Single word like 'Muslim','Christian','Hindi' etc. If the college has no minority status, set minority_status to "None".
- isMinority: Set at the college level. True if the college has minority status, otherwise false.
- Correctly identify boundaries between seat sections (Home University, Other Than Home University, State Level). Map sections strictly to their own keys.
- The "Stage" field MUST only contain values like "I" or "II". NEVER use section names as a stage value.
- If any category, stage, or section is missing, return an empty array or omit the field.
- Group all courses under their respective college codes. The college header looks like "1003 - Government College of Pharmacy, Amravati", where 1003 is college_code and the rest is college_name.
- The course header looks like "100382310 - Pharmacy", where 100382310 is course_code and Pharmacy is course_name.
- Preserve numerical precision exactly as shown in the document.
- Do not fabricate or infer missing values.
- Cover every page of the document and don't lose any single data point. Each table row must be captured.

Required JSON Schema:
[
  {
    "college_code": "string",
    "college_name": "string",
    "home_university": "string",
    "city": "string",
    "status": "string",
    "minority_status": "string",
    "isMinority": "boolean",
    "courses": [
      {
        "course_code": "string",
        "course_name": "string",
        "cutoff_data": {
          "Home_University_Seats_Allotted_to_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "Other_Than_Home_University_Seats_Allotted_to_Other_Than_Home_University_Candidates": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ],
          "State_Level": [
            {
              "Stage": "string",
              "CATEGORY_CODE": { "rank": "integer", "percentile": "number" }
            }
          ]
        }
      }
    ]
  }
]`;

export type ExtractionMode = 'MHT-CET' | 'AIQ' | 'Pharmacy';

/**
 * Extracts MHT-CET cutoff data using Gemini with automatic fallback.
 *
 * Fallback logic:
 *   1. Start with FALLBACK_MODELS[0] and try each API key sequentially.
 *   2. If a 429/503 error occurs, move to the next API key.
 *   3. If all keys fail for the current model, switch to the next model.
 *   4. If all models and keys are exhausted, throw the last encountered error.
 *   5. Non-retryable errors (e.g., 400 bad request) are thrown immediately.
 */
export async function extractData(input: { text?: string; pdfBase64?: string; mode?: ExtractionMode }) {
  const mode = input.mode || 'MHT-CET';
  let systemInstruction = MHT_CET_SYSTEM_INSTRUCTION;
  if (mode === 'AIQ') systemInstruction = AIQ_SYSTEM_INSTRUCTION;
  if (mode === 'Pharmacy') systemInstruction = PHARMACY_SYSTEM_INSTRUCTION;

  const parts: any[] = [];

  if (input.pdfBase64) {
    parts.push({
      inlineData: {
        mimeType: "application/pdf",
        data: input.pdfBase64,
      },
    });
  }

  if (input.text) {
    parts.push({ text: input.text });
  }

  if (parts.length === 0) {
    throw new Error("No input provided. Please provide either text or a PDF file.");
  }

  // Guard: ensure at least one API key is configured
  if (API_KEYS.length === 0) {
    throw new Error("No Gemini API keys configured. Please set at least GEMINI_API_KEY1 in your .env file.");
  }

  let lastError: unknown = null;

  // --- Outer loop: cycle through models ---
  for (let modelIndex = 0; modelIndex < FALLBACK_MODELS.length; modelIndex++) {
    const model = FALLBACK_MODELS[modelIndex];
    console.log(`[Gemini Fallback] Trying model: ${model} (${modelIndex + 1}/${FALLBACK_MODELS.length})`);

    // --- Inner loop: cycle through API keys for this model ---
    for (let keyIndex = 0; keyIndex < API_KEYS.length; keyIndex++) {
      const apiKey = API_KEYS[keyIndex];
      const ai = new GoogleGenAI({ apiKey });

      console.log(`[Gemini Fallback]   Using API key ${keyIndex + 1}/${API_KEYS.length}`);

      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts },
          config: {
            systemInstruction: systemInstruction,
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        });

        if (!response.text) {
          throw new Error("The model failed to generate a text response.");
        }

        // Success — log and return immediately
        console.log(
          `[Gemini Fallback] ✅ Success with model: ${model}, key ${keyIndex + 1}`
        );
        return response.text;
      } catch (err: unknown) {
        lastError = err;

        // If error is retryable (400/403/429/503), log and continue to the next API key
        if (isRetryableError(err)) {
          console.warn(
            `[Gemini Fallback] ⚠️ Retryable error (400/403/429/503) with model "${model}" on key ${keyIndex + 1}:`,
            err instanceof Error ? err.message : err
          );

          // Continue to the next API key in the inner loop
          continue;
        }

        // Non-retryable error — fail immediately, no point trying other models/keys
        console.error(
          `[Gemini Fallback] ❌ Non-retryable error with model "${model}" on key ${keyIndex + 1}:`,
          err instanceof Error ? err.message : err
        );
        throw err;
      }
    }

    // All keys failed for this model — log before moving to next model
    console.warn(
      `[Gemini Fallback] All API keys exhausted for model "${model}". Switching to next model...`
    );
  }

  // All keys and models exhausted — throw the last error
  console.error("[Gemini Fallback] ❌ All API keys and models exhausted.");
  throw lastError instanceof Error
    ? lastError
    : new Error("All Gemini API keys and models have been exhausted due to rate limiting or authentication errors (400/403/429/503).");
}