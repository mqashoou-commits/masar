require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const QWEN_API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = 'qwen-turbo';
const QWEN_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';

if (!QWEN_API_KEY) {
  console.warn('[masar] WARNING: DASHSCOPE_API_KEY is not set. Add it to a .env file before running real requests.');
}

// ---- helper: call Qwen Cloud (OpenAI-compatible chat completions) ----
// messages: [{role: 'user'|'assistant', content: '...'}]
async function callQwen({ system, messages, maxTokens = 1200, temperature = 0.4 }) {
  const res = await fetch(QWEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${QWEN_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Qwen API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function extractJson(text) {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

// ---- route: extract text from an uploaded CV (PDF) ----
app.post('/api/extract-cv', upload.single('cv'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = await pdfParse(req.file.buffer);
    res.json({ text: parsed.text.slice(0, 12000) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read PDF' });
  }
});

// ---- route: analyze CV text -> strengths, gaps, suggested roles ----
app.post('/api/analyze-cv', async (req, res) => {
  try {
    const { cvText, lang = 'ar' } = req.body;
    if (!cvText || cvText.trim().length < 20) {
      return res.status(400).json({ error: 'cvText is required' });
    }

    const system = `You are Masar, a career coaching assistant for job seekers in the Arab world.
Respond ONLY with a single JSON object, no markdown fences, no preamble, matching this exact shape:
{
  "strengths": ["string", "..."],
  "gaps": ["string", "..."],
  "suggestedRoles": [{"title": "string", "why": "string"}]
}
Write all string values in ${lang === 'ar' ? 'Arabic' : 'English'}.
Give 3-5 strengths, 2-4 gaps, and exactly 3 suggested roles ordered from best fit to third-best fit.
Be specific and reference actual details from the CV text, not generic advice.`;

    const raw = await callQwen({
      system,
      messages: [{ role: 'user', content: `CV TEXT:\n\n${cvText}` }],
    });

    const parsed = extractJson(raw);
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to analyze CV', detail: String(err.message || err) });
  }
});

// ---- route: interview simulation, one turn at a time ----
// body: { role: "Frontend Developer", lang: "ar", history: [{role:"user"|"assistant", content:"..."}] }
app.post('/api/interview', async (req, res) => {
  try {
    const { role = 'General', lang = 'ar', history = [] } = req.body;

    const system = `You are Masar's interview simulator, acting as a professional but warm interviewer for a "${role}" position.
STRICT LANGUAGE RULE: Respond ONLY in ${lang === 'ar' ? 'Arabic (Modern Standard Arabic, Arabic script only)' : 'English'}. Do not use any other language, script, or characters under any circumstances — no Chinese, no Vietnamese, no transliteration, nothing outside ${lang === 'ar' ? 'Arabic' : 'English'}.
Rules:
- If the conversation is just starting (no prior assistant turns), greet the candidate briefly and ask your first interview question.
- Otherwise, first give short, specific feedback (2-3 sentences) on the candidate's last answer, then ask the next relevant interview question.
- Keep each reply under 120 words total.
- Vary question difficulty and topic (behavioral, technical, situational) across the conversation.
- Never break character or mention you are an AI model.`;

    const messages = history.length
      ? history
      : [{ role: 'user', content: 'Start the interview.' }];

    const reply = await callQwen({ system, messages, maxTokens: 400 });
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Interview turn failed', detail: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;

// Only start a listening server when run directly (local development).
// On Vercel, this file is imported as a serverless function handler instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[masar] server running on http://localhost:${PORT}`);
  });
}

module.exports = app;