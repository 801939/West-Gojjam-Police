import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { sendTelegramMessage, escapeHtml } from './telegramService';

/**
 * Sends a crime tip report to GitHub as a JSON file.
 */
const sendToGitHub = async (tipArgs: any) => {
  const GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    console.warn("GitHub Token not found. Skipping GitHub report.");
    return;
  }

  const REPO_OWNER = "yimamem47-collab";
  const REPO_NAME = "west-gojjame-police";
  const FILE_PATH = `reports/tip-${Date.now()}.json`;

  // Safely encode to base64 for GitHub API (handles Unicode/Amharic)
  const content = btoa(unescape(encodeURIComponent(JSON.stringify({
    ...tipArgs,
    timestamp: new Date().toISOString(),
    source: 'AI Assistant Digital Portal'
  }, null, 2))));

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `New crime tip from AI Assistant: ${tipArgs.name}`,
        content: content,
      }),
    });
    
    if (response.ok) {
      console.log("GitHub: Report saved successfully.");
    } else {
      const err = await response.json();
      console.error("GitHub API Error:", err);
    }
  } catch (err) {
    console.error("GitHub Fetch Error:", err);
  }
};

/**
 * Trigger secure client-side background tasks after function call extraction.
 */
const triggerBackgroundTasks = async (tipArgs: any) => {
  try {
    const message = `🤖 <b>አዲስ ጥቆማ ደርሷል! (ከ AI ረዳት)</b>\n---------------------------\n<b>Name:</b> ${escapeHtml(tipArgs.name)}\n<b>Phone:</b> ${escapeHtml(tipArgs.phone)}\n<b>Location:</b> ${escapeHtml(tipArgs.location)}\n---------------------------\n<b>Details:</b>\n${escapeHtml(tipArgs.details)}`;

    // Firebase write from Client (respects auth state and Firestore rules verification)
    const firebaseTask = addDoc(collection(db, 'community_reports'), {
      reporterName: tipArgs.name,
      reporterPhone: tipArgs.phone,
      location: tipArgs.location,
      details: tipArgs.details,
      date: new Date().toISOString().split('T')[0],
      status: 'New',
      timestamp: serverTimestamp(),
      source: 'AI Assistant'
    });

    // Telegram
    const telegramTask = sendTelegramMessage(message);

    // Google Sheets
    const sheetURL = "https://script.google.com/macros/s/AKfycbw2Bkjrv9SbObSFs0xOlcONYKJKpsa_lqSu2to4PfIKlHoP8U5KVMj0DQYrkvkS_jYS/exec";
    const reportData = {
      name: tipArgs.name,
      phone: tipArgs.phone,
      email: "AI Assistant",
      message: tipArgs.details,
      location: tipArgs.location,
      date: new Date().toISOString().split('T')[0],
      status: 'New'
    };
    const sheetsTask = fetch(sheetURL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData)
    });

    const githubTask = sendToGitHub(tipArgs);
    await Promise.allSettled([firebaseTask, telegramTask, sheetsTask, githubTask]);
    console.log("AI Assistant: Client-side background tasks triggered.");
  } catch (err) {
    console.error("AI Assistant: Client-side background task error:", err);
  }
};

/**
 * Generates a streaming response from Gemini.
 */
export const getGeminiResponseStream = async (
  userPrompt: string, 
  history: any[] = [], 
  context: any = {},
  onChunk: (text: string) => void
): Promise<string> => {
  try {
    const response = await fetch("/api/gemini/chat-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userPrompt, history, context })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Failed to make chat stream request");
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body reader available");

    const decoder = new TextDecoder("utf-8");
    let done = false;
    let accumulatedText = "";

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        const chunkText = decoder.decode(value, { stream: !done });
        
        // Parse and check if this chunk contains a function call indicator
        if (chunkText.includes("__FUNCTION_CALL__:")) {
          const parts = chunkText.split("__FUNCTION_CALL__:");
          const textBefore = parts[0];
          const jsonStr = parts[1];
          
          if (textBefore) {
            accumulatedText += textBefore;
            onChunk(accumulatedText);
          }
          
          try {
            const call = JSON.parse(jsonStr.trim());
            const args = call.args as any;
            
            // Execute the client-side background tasks directly!
            await triggerBackgroundTasks(args);
            
            const confirmation = "ጥቆማዎ ለምዕራብ ጎጃም ፖሊስ መምሪያ፣ ለፌርቤዝ እና ለቴሌግራም ግሩፕ በቅጽበት ተልኳል። ስለ ትብብርዎ እናመሰግናለን።";
            accumulatedText = confirmation;
            onChunk(confirmation);
            return confirmation;
          } catch (e) {
            console.error("Failed to parse function call JSON:", e);
          }
        } else {
          accumulatedText += chunkText;
          onChunk(accumulatedText);
        }
      }
    }

    return accumulatedText;
  } catch (error: any) {
    console.error("Gemini client stream error:", error);
    const errorMessage = error?.message || "Unknown error";
    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('API key not valid')) {
      return "ይቅርታ፣ የ AI አገልግሎት ቁልፍ (API Key) ችግር አለበት። (Invalid API Key)";
    }
    if (errorMessage.includes('quota') || errorMessage.includes('429')) {
      return "ይቅርታ፣ የ AI አገልግሎት አጠቃቀም ገደብ ላይ ደርሰናል። እባክዎ ጥቂት ደቂቃዎችን ቆይተው ይሞክሩ። (Quota Exceeded)";
    }
    return `ይቅርታ፣ ምላሽ መስጠት አልቻልኩም። ስህተት፡ ${errorMessage}. እባክዎ ኢንተርኔትዎን ያረጋግጡ።`;
  }
};

/**
 * Generates a non-streaming response from Gemini based on the user prompt.
 */
export const getGeminiResponse = async (
  userPrompt: string, 
  history: any[] = [], 
  context: any = {}
): Promise<string> => {
  let accumulated = "";
  return await getGeminiResponseStream(userPrompt, history, context, (text) => {
    accumulated = text;
  });
};

/**
 * Generates audio from text using external server-side Gemini TTS.
 */
export const getGeminiTTS = async (text: string): Promise<string | null> => {
  try {
    const response = await fetch("/api/gemini/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.audio || null;
  } catch (error) {
    console.error("Client getGeminiTTS Error:", error);
    return null;
  }
};

/**
 * Analyzes an image (base64) using server-side Gemini.
 */
export const analyzeImage = async (base64Image: string, prompt: string): Promise<string | null> => {
  try {
    const response = await fetch("/api/gemini/analyze-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64Image, prompt })
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.text || null;
  } catch (error) {
    console.error("Client analyzeImage Error:", error);
    return null;
  }
};
