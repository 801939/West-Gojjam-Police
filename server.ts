import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const __filename = typeof import.meta !== "undefined" && import.meta.url
  ? fileURLToPath(import.meta.url)
  : "";
const __dirname = __filename ? path.dirname(__filename) : "";

const PORT = 3000;
const REPO_OWNER = "yimamem47-collab";
const REPO_NAME = "west-gojjame-police";

// Files to sync (expand this list as needed)
const FILES_TO_SYNC = [
  "src/App.tsx",
  "src/firebase.ts",
  "src/main.tsx",
  "src/types.ts",
  "src/constants.ts",
  "src/index.css",
  "index.html",
  "package.json",
  "vite.config.ts",
  "firestore.rules",
  "firebase-blueprint.json",
  "AGENTS.md",
  "server.ts",
  ".env.example",
  
  // Components
  "src/components/AIAssistant.tsx",
  "src/components/AppManual.tsx",
  "src/components/Assignments.tsx",
  "src/components/Auth.tsx",
  "src/components/CitizenReport.tsx",
  "src/components/CommunityReportForm.tsx",
  "src/components/CommunityReports.tsx",
  "src/components/CorruptionReport.tsx",
  "src/components/CrimeMap.tsx",
  "src/components/Dashboard.tsx",
  "src/components/EmergencyContacts.tsx",
  "src/components/ErrorBoundary.tsx",
  "src/components/Home.tsx",
  "src/components/IncidentMap.tsx",
  "src/components/Incidents.tsx",
  "src/components/Layout.tsx",
  "src/components/Officers.tsx",
  "src/components/PoliceIDScanner.tsx",
  "src/components/PoliceServices.tsx",
  "src/components/QRScanner.tsx",
  "src/components/Reports.tsx",
  "src/components/Scanner.tsx",
  "src/components/Settings.tsx",
  "src/components/TrafficSafety.tsx",
  "src/components/ZoneReports.tsx",

  // Hooks & Libs
  "src/hooks/useAppData.ts",
  "src/lib/translations.ts",
  "src/lib/storage.ts",
  "src/lib/utils.ts",

  // Services
  "src/services/diagnostics.ts",
  "src/services/geminiService.ts",
  "src/services/githubFileService.ts",
  "src/services/telegramService.ts",
  
  // Public assets
  "public/police-logo.png",
  "public/logo.png",
  "public/favicon.ico"
];

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Route: Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", version: "1.0.1", node: process.version });
  });

  // API Route: GitHub Sync - Pushes local files to the GitHub repo
  app.post("/api/github/sync", async (req, res) => {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.VITE_GITHUB_TOKEN;

    if (!GITHUB_TOKEN) {
      return res.status(500).json({ error: "GitHub token (GITHUB_TOKEN) is missing on the server environment." });
    }

    const results = [];

    for (const filePath of FILES_TO_SYNC) {
      try {
        const absolutePath = path.resolve(process.cwd(), filePath);
        
        // Skip if file doesn't exist
        try {
          await fs.access(absolutePath);
        } catch {
          results.push({ file: filePath, status: "error", message: "File does not exist locally" });
          continue;
        }

        let base64Content;
        const isBinary = filePath.match(/\.(png|jpg|jpeg|ico|gif|pdf)$/i);
        
        if (isBinary) {
          const buffer = await fs.readFile(absolutePath);
          base64Content = buffer.toString("base64");
        } else {
          const content = await fs.readFile(absolutePath, "utf-8");
          base64Content = Buffer.from(content).toString("base64");
        }

        const getUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}`;
        
        // 1. Get SHA if file exists to enable update
        const getRes = await fetch(getUrl, {
          headers: {
            "Authorization": `token ${GITHUB_TOKEN}`,
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "West-Gojjam-Police-Sync"
          }
        });

        let sha;
        if (getRes.ok) {
          const data = await getRes.json();
          sha = data.sha;
        }

        // 2. Push content via PUT
        const putRes = await fetch(getUrl, {
          method: "PUT",
          headers: {
            "Authorization": `token ${GITHUB_TOKEN}`,
            "Content-Type": "application/json",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "West-Gojjam-Police-Sync"
          },
          body: JSON.stringify({
            message: `Sync ${filePath} from Digital Management Dashboard`,
            content: base64Content,
            sha
          })
        });

        if (putRes.ok) {
          results.push({ file: filePath, status: "success" });
        } else {
          const err = await putRes.json();
          results.push({ file: filePath, status: "error", message: err.message || "GitHub API Error" });
        }
      } catch (err: any) {
        results.push({ file: filePath, status: "error", message: err.message });
      }
    }

    res.json({ results });
  });

  // API Route: Telegram Proxy
  app.post("/api/telegram", async (req, res) => {
    const { message, html = true } = req.body;
    
    // Use environment variables or hardcoded fallbacks provided by user
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(500).json({ error: "Telegram configuration (TOKEN or CHAT_ID) is missing on server" });
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    try {
      const telegramResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: html ? "HTML" : undefined
        })
      });

      const data = await telegramResponse.json();
      
      if (!telegramResponse.ok) {
        return res.status(telegramResponse.status).json(data);
      }

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Internal network error proxying Telegram" });
    }
  });

  // API Route: Gemini Chat Stream
  app.post("/api/gemini/chat-stream", async (req, res) => {
    const { userPrompt, history = [], context = {} } = req.body;
    
    try {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.write("ERROR: GEMINI_API_KEY is not defined on the server environment.");
        res.end();
        return;
      }
      
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      const formattedHistory: any[] = [];
      let lastRole: string | null = null;
      const recentHistory = history.slice(-10);

      for (const msg of recentHistory) {
        if (!msg || typeof msg.text !== 'string') continue;
        const role = msg.sender === 'user' ? 'user' : 'model';
        if (role === 'user' && msg.text.trim() === userPrompt.trim()) continue;
        if (role === lastRole) continue;
        
        formattedHistory.push({
          role: role,
          parts: [{ text: msg.text }]
        });
        lastRole = role;
      }

      if (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
        formattedHistory.shift();
      }

      if (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user') {
        formattedHistory.pop();
      }

      formattedHistory.push({
        role: 'user',
        parts: [{ text: userPrompt }]
      });

      const contextString = context ? `
DATA CONTEXT:
- Assignments: ${JSON.stringify((context.assignments || []).slice(0, 5))}
- Incidents: ${JSON.stringify((context.incidents || []).slice(0, 5))}
- Reports: ${JSON.stringify((context.reports || []).slice(0, 5))}
- User: ${context.user?.name || 'Officer'} (${context.user?.role || 'Officer'})
` : '';

      const submitCrimeTipDeclaration = {
        name: "submitCrimeTip",
        description: "Submit a crime tip or report from a citizen to the police department. Extracts name, phone, location, and details.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "The name of the person reporting the tip." },
            phone: { type: "STRING", description: "The phone number of the person reporting." },
            location: { type: "STRING", description: "The location of the incident." },
            details: { type: "STRING", description: "The full details of the crime or tip." },
          },
          required: ["name", "phone", "location", "details"],
        },
      };

      const systemInstruction = `You are the "West Gojjam Zone Police Digital Assistant" (የምዕራብ ጎጃም ዞን ፖሊስ ዲጂታል ረዳት), the official AI assistant for the West Gojjam Zone Police Department.

IDENTITY & TONE:
- You were developed by Chief Sergeant Mengesha Yimam Abera (ዋና ሳጅን መንገሻ ይማም አበራ).
- You are a professional, helpful, and highly knowledgeable assistant.
- Your tone is formal yet accessible, respectful, and authoritative on police matters.
- You are an expert in the FDRE Constitution, Ethiopian Criminal Law, Traffic Safety Proclamations, and International Human Rights principles.
- ALWAYS maintain professional police ethics and confidentiality.

LANGUAGE RULES:
1. ALWAYS respond in the language the user is using (Amharic or English).
2. If the user speaks Amharic (አማርኛ), you MUST respond with a detailed and accurate explanation in Amharic.
3. Use natural, polite, and grammatically correct Amharic (Ethiopic script).
4. For Amharic greetings like "How are you?", respond: "ደህና ነኝ፣ የምዕራብ ጎጃም ዞን ፖሊስ ዲጂታል ረዳት ነኝ። እንዴት ልረዳዎ እችላለሁ?"
5. Voice responses (TTS) should be concise and clear.

CORE TASKS:
1. Police Information Management:
   - Assist with recording incidents, tracking case files, and searching suspect information.
   - Handle information on missing persons and vehicle data verification.
   - Assist in preparing operation reports.
2. Personnel Management:
   - Provide information on duty schedules, leave, and missions.
   - Help track work performance reports.
3. Reporting System:
   - Assist in generating Daily, Weekly, 9-month, and Annual performance reports.
   - Provide crime statistics and security analysis for the zone.
4. Public Assistance (Crime Reporting):
   - To report a crime or tip, you MUST collect: Name, Phone Number, Location, and Details.
   - Once all 4 pieces of information are collected, call the 'submitCrimeTip' function.

DATA SECURITY:
- NEVER share sensitive or secret police information without proper authorization.
- Verify user roles before providing internal data. (Internal data is only for Officers/Admins).
- Follow data protection and privacy guidelines strictly.

MOBILE & ANDROID CONTEXT:
- If the user is on a mobile device, emphasize features like the QR Scanner, GPS reporting, and real-time alerts.

DATA CONTEXT:
${contextString}`;

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.5-flash",
        contents: formattedHistory as any,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: [submitCrimeTipDeclaration as any] }],
          safetySettings: [
            { category: "HARM_CATEGORY_HATE_SPEECH" as any, threshold: "BLOCK_NONE" as any },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT" as any, threshold: "BLOCK_NONE" as any },
            { category: "HARM_CATEGORY_HARASSMENT" as any, threshold: "BLOCK_NONE" as any },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT" as any, threshold: "BLOCK_NONE" as any },
          ]
        }
      });
      
      for await (const chunk of responseStream) {
        const text = chunk.text;
        if (text) {
          res.write(text);
        }
        
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          const call = chunk.functionCalls[0];
          res.write(`\n__FUNCTION_CALL__:${JSON.stringify(call)}`);
        }
      }
      
      res.end();
    } catch (error: any) {
      console.error("Server-side Gemini Chat Stream Error:", error);
      res.write(`\nERROR: ${error.message || "Unknown error during streaming."}`);
      res.end();
    }
  });

  // API Route: Gemini TTS
  app.post("/api/gemini/tts", async (req, res) => {
    const { text } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not defined on the server environment." });
      }
      
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      
      const cleanText = text
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/#{1,6}\s+(.*)/g, '$1')
        .replace(/`{1,3}.*?`{1,3}/gs, '')
        .replace(/>\s+(.*)/g, '$1')
        .replace(/[-*+]\s+/g, '')
        .replace(/\d+\.\s+/g, '');
        
      const truncatedText = cleanText.slice(0, 1000);
      const prompt = `Speak the following Amharic text naturally, clearly, and with a professional tone. Ensure you read the Amharic characters correctly: ${truncatedText}`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-tts-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });
      
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        return res.json({ audio: base64Audio });
      }
      res.status(500).json({ error: "No audio data received in response." });
    } catch (error: any) {
      console.error("Server-side Gemini TTS Error:", error);
      res.status(500).json({ error: error.message || "Unknown error during TTS generation." });
    }
  });

  // API Route: Gemini Image Analysis
  app.post("/api/gemini/analyze-image", async (req, res) => {
    const { base64Image, prompt } = req.body;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not defined on the server environment." });
      }
      
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey });
      
      let imageData = base64Image;
      let mimeType = "image/jpeg";

      if (base64Image.includes(';base64,')) {
        const parts = base64Image.split(';base64,');
        mimeType = parts[0].split(':')[1] || "image/jpeg";
        imageData = parts[1];
      }

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: imageData,
                mimeType: mimeType
              }
            }
          ]
        }]
      });

      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Server-side Gemini Image Analysis Error:", error);
      res.status(500).json({ error: error.message || "Unknown error during image analysis." });
    }
  });

  // Vite/Static setup
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server v1.0.1 running on http://0.0.0.0:${PORT} [${process.env.NODE_ENV || 'development'}]`);
  });
}

startServer().catch((err) => {
  console.error("CRITICAL: Server failed to start:", err);
  process.exit(1);
});

