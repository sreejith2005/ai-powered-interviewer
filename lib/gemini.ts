import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Helper to call Gemini GenerateContent endpoint.
 */
export async function generateContent({
  apiKey,
  prompt,
  imageBase64,
}: {
  apiKey: string;
  prompt: string;
  imageBase64?: string;
}) {
  const genAI = new GoogleGenerativeAI(apiKey);
  // Recommend using gemini-2.5-flash as per instructions "use a current multimodal model"
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const parts: any[] = [{ text: prompt }];

  if (imageBase64) {
    // Extract mime type and base64 data if it includes data URL prefix
    // e.g. "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
    let base64Data = imageBase64;
    let mimeType = "image/jpeg"; // default

    if (imageBase64.startsWith("data:")) {
      const split = imageBase64.split(",");
      mimeType = split[0].split(":")[1].split(";")[0];
      base64Data = split[1];
    }

    parts.push({
      inlineData: {
        data: base64Data,
        mimeType,
      },
    });
  }

  const result = await model.generateContent(parts);
  const response = await result.response;
  return response.text();
}
