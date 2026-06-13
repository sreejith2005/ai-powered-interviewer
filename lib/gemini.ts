import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Helper to call Gemini GenerateContent endpoint or OpenRouter depending on key.
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
  let finalPrompt = prompt;

  // Use OCR if an image is provided and we have an OCR key
  const ocrKey = process.env.OCR_API_KEY;
  if (imageBase64 && ocrKey) {
    try {
      const ocrFormData = new FormData();
      ocrFormData.append("apikey", ocrKey);
      
      // ocr.space expects the data URL directly, e.g. "data:image/jpeg;base64,..."
      let dataUrl = imageBase64;
      if (!imageBase64.startsWith("data:")) {
        dataUrl = `data:image/jpeg;base64,${imageBase64}`;
      }
      ocrFormData.append("base64Image", dataUrl);
      ocrFormData.append("language", "eng");
      ocrFormData.append("OCREngine", "2");

      const ocrRes = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        body: ocrFormData,
      });
      
      if (ocrRes.ok) {
        const ocrData = await ocrRes.json();
        const parsedText = ocrData?.ParsedResults?.[0]?.ParsedText;
        if (parsedText && parsedText.trim().length > 0) {
          finalPrompt += `\n\n[Extracted Text from User's Screen via OCR]:\n${parsedText}`;
        }
      }
    } catch (err) {
      console.error("OCR Error:", err);
      // fallback to just image
    }
  }

  // Check if this is an OpenRouter API key
  if (apiKey.startsWith("sk-or-")) {
    return generateWithOpenRouter({ apiKey, prompt: finalPrompt, imageBase64 });
  }

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

async function generateWithOpenRouter({
  apiKey,
  prompt,
  imageBase64,
}: {
  apiKey: string;
  prompt: string;
  imageBase64?: string;
}) {
  const messages: any[] = [
    {
      role: "user",
      content: []
    }
  ];

  messages[0].content.push({
    type: "text",
    text: prompt
  });

  if (imageBase64) {
    let dataUrl = imageBase64;
    if (!imageBase64.startsWith("data:")) {
      dataUrl = `data:image/jpeg;base64,${imageBase64}`;
    }
    messages[0].content.push({
      type: "image_url",
      image_url: {
        url: dataUrl
      }
    });
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "AI Powered Interviewer",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash", 
      messages: messages,
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
