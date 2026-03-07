import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_INSTRUCTION = `You are an expert data extraction API.
Extract all tabular cutoff data from the provided MHT-CET engineering college cutoff document and convert it strictly into the structured JSON format defined below.

Extraction Rules:
- Output ONLY valid JSON. Do not include explanations, markdown formatting, or additional commentary.
- Extract and map columns precisely. Ensure that for each seat category (e.g., GOPENH, LOPENH, EWS, TFWS, etc.), the correct "rank" (integer) and "percentile" (decimal) are paired accurately.
- Extract the "Home University" name for each college. This value is typically mentioned beside the "Status" field in the document header for each college. Ensure the extracted "home_university" value is identical to the one found in that location.
- If any category, stage, or section is missing for a branch, return an empty array or omit the field according to the schema.
- Group all branches under their respective college codes.
- Preserve numerical precision exactly as shown in the document.
- Do not fabricate or infer missing values.
- Cover entire pdf and dont loose any data strictly. 
- In minority status write a Single word like ‘Muslim’,’Christan’,’Hindi’ etc

Required JSON Schema:
[
  {
    "college_code": "string",
    "college_name": "string",
    "home_university": "string",
    "city": "string",
    "status": "string",
    "minority_status": "string",
    "branches": [
      {
        "branch_code": "string",
        "branch_name": "string",
        "is_tech": "boolean",
        "is_electronic": "boolean",
        "is_other": "boolean",
        "isCivil": "boolean",
        "isMechanical": "boolean",
        "isElectrical": "boolean",
        "isMinority": "boolean",
        "cutoff_data": {
          "Home_University_Seats_Allotted_to_Home_University_Candidates": [
            {
              "Stage": "string",
              "GOPENH": { "rank": "integer", "percentile": "number" },
              "LOPENH": { "rank": "integer", "percentile": "number" }
            }
          ],
          "Other_Than_Home_University_Seats_Allotted_to_Other_Than_Home_University_Candidates": [],
          "Home_University_Seats_Allotted_to_Other_Than_Home_University_Candidates": [],
          "Other_Than_Home_University_Seats_Allotted_to_Home_University_Candidates": [],
          "State_Level": []
        }
      }
    ]
  }
]`;

export async function extractData(input: { text?: string; pdfBase64?: string }) {
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

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  if (!response.text) {
    throw new Error("The model failed to generate a text response.");
  }

  return response.text;
}