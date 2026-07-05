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

// ---- Redis (Upstash) for HR system persistence ----
const { Redis } = require('@upstash/redis');
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
} else {
  console.warn('[masar] WARNING: Upstash Redis env vars not set. HR features will not work.');
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- HR: create a job posting ----
app.post('/api/hr/jobs', async (req, res) => {
  try {
    const { companyId, title, description } = req.body;
    if (!companyId || !title || !description) return res.status(400).json({ error: 'companyId, title and description are required' });
    const jobId = newId();
    const job = { id: jobId, companyId, title, description, createdAt: Date.now() };
    await redis.set(`job:${jobId}`, JSON.stringify(job));
    await redis.set(`candidates:${jobId}`, JSON.stringify([]));

    const indexKey = `hr:jobs-index:${companyId}`;
    const indexRaw = await redis.get(indexKey);
    const index = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];
    index.push(jobId);
    await redis.set(indexKey, JSON.stringify(index));

    res.json({ jobId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create job', detail: String(err.message || err) });
  }
});

// ---- HR: list all job postings for a company ----
app.get('/api/hr/jobs-by-company/:companyId', async (req, res) => {
  try {
    const indexRaw = await redis.get(`hr:jobs-index:${req.params.companyId}`);
    const index = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];
    if (index.length === 0) return res.json({ jobs: [] });

    const keys = index.map(id => `job:${id}`);
    const results = await redis.mget(...keys);
    const jobs = results.filter(Boolean).map(r => (typeof r === 'string' ? JSON.parse(r) : r));
    res.json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load jobs', detail: String(err.message || err) });
  }
});

// ---- HR: get job + ranked candidates ----
app.get('/api/hr/jobs/:jobId', async (req, res) => {
  try {
    const jobRaw = await redis.get(`job:${req.params.jobId}`);
    if (!jobRaw) return res.status(404).json({ error: 'Job not found' });
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;
    const candRaw = await redis.get(`candidates:${req.params.jobId}`);
    let candidates = candRaw ? (typeof candRaw === 'string' ? JSON.parse(candRaw) : candRaw) : [];
    candidates = candidates.sort((a, b) => (b.cvScore || 0) - (a.cvScore || 0));
    res.json({ job, candidates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load job', detail: String(err.message || err) });
  }
});

// ---- HR: upload + score a candidate CV against the job ----
app.post('/api/hr/jobs/:jobId/candidates', upload.single('cv'), async (req, res) => {
  try {
    const { jobId } = req.params;
    const { name } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No CV file uploaded' });

    const jobRaw = await redis.get(`job:${jobId}`);
    if (!jobRaw) return res.status(404).json({ error: 'Job not found' });
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;

    const parsed = await pdfParse(req.file.buffer);
    const cvText = parsed.text.slice(0, 12000);

    const system = `You are Masar's HR screening assistant. Compare the candidate's CV against the job description.
Respond ONLY with a single JSON object, no markdown fences, no preamble, matching this exact shape:
{
  "score": 0-100 (integer, overall fit score),
  "strengths": ["string", "..."],
  "gaps": ["string", "..."],
  "recommendation": "shortlist" | "maybe" | "reject"
}
Be specific and reference actual details from both the job description and the CV. This is a recommendation only — a human will make the final decision.`;

    const raw = await callQwen({
      system,
      messages: [{ role: 'user', content: `JOB TITLE: ${job.title}\nJOB DESCRIPTION:\n${job.description}\n\nCANDIDATE CV:\n${cvText}` }],
    });
    const evaluation = extractJson(raw);

    const candidateId = newId();
    const candidate = {
      id: candidateId,
      name: name || 'Candidate',
      cvScore: evaluation.score,
      cvStrengths: evaluation.strengths,
      cvGaps: evaluation.gaps,
      cvRecommendation: evaluation.recommendation,
      interview: null,
      createdAt: Date.now(),
    };

    const candRaw = await redis.get(`candidates:${jobId}`);
    const candidates = candRaw ? (typeof candRaw === 'string' ? JSON.parse(candRaw) : candRaw) : [];
    candidates.push(candidate);
    await redis.set(`candidates:${jobId}`, JSON.stringify(candidates));

    res.json({ candidate });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to screen candidate', detail: String(err.message || err) });
  }
});

// ---- Candidate: one turn of the REAL evaluative interview ----
app.post('/api/hr/interview-turn', async (req, res) => {
  try {
    const { jobId, candidateId, lang = 'ar', history = [], targetQuestionCount } = req.body;
    const jobRaw = await redis.get(`job:${jobId}`);
    if (!jobRaw) return res.status(404).json({ error: 'Job not found' });
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;

    // fetch questions already asked to OTHER candidates for this same job, to avoid repetition
    const askedKey = `hr:asked-questions:${jobId}`;
    const askedRaw = await redis.get(askedKey);
    const askedQuestions = askedRaw ? (typeof askedRaw === 'string' ? JSON.parse(askedRaw) : askedRaw) : [];
    const questionCount = targetQuestionCount || (10 + Math.floor(Math.random() * 6)); // 10-15
    const turnNumber = history.filter(h => h.role === 'assistant').length + 1;

    const avoidList = askedQuestions.length
      ? `\nPreviously asked questions for this job (do NOT repeat these or ask anything closely resembling them, come up with genuinely different questions):\n${askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '';

    const system = `You are conducting a REAL job interview (not a practice one) for the position "${job.title}".
Job description: ${job.description}
STRICT LANGUAGE RULE: Respond ONLY in ${lang === 'ar' ? 'Arabic' : 'English'}.
This interview has exactly ${questionCount} questions total. This is question number ${turnNumber} of ${questionCount}.
Rules:
- If this is turn 1, greet the candidate professionally and ask your first relevant question.
- Otherwise, do NOT give feedback (this is a real interview, not coaching) — just acknowledge briefly and ask the next relevant question.
- Cover a genuine mix across the ${questionCount} questions: technical/role-specific skills, past experience, behavioral situations, and judgment/problem-solving — vary the angle each time.
- If this is the FINAL question (turn ${questionCount}), make it a thoughtful closing question, then after the candidate answers, thank them warmly and clearly state the interview is now complete.
- Keep each message under 100 words.${avoidList}`;

    const messages = history.length ? history : [{ role: 'user', content: 'Start the interview.' }];
    const reply = await callQwen({ system, messages, maxTokens: 400, temperature: 0.5 });

    // persist transcript
    const transcriptKey = `transcript:${jobId}:${candidateId}`;
    const updated = [...messages, { role: 'assistant', content: reply }];
    await redis.set(transcriptKey, JSON.stringify(updated));

    // remember this question so future candidates for the same job get different ones
    askedQuestions.push(reply);
    await redis.set(askedKey, JSON.stringify(askedQuestions));

    res.json({ reply, questionCount, turnNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Interview turn failed', detail: String(err.message || err) });
  }
});

// ---- Candidate: finish interview -> generate final evaluation for HR ----
app.post('/api/hr/interview-finish', async (req, res) => {
  try {
    const { jobId, candidateId } = req.body;
    const transcriptRaw = await redis.get(`transcript:${jobId}:${candidateId}`);
    const transcript = transcriptRaw ? (typeof transcriptRaw === 'string' ? JSON.parse(transcriptRaw) : transcriptRaw) : [];

    const jobRaw = await redis.get(`job:${jobId}`);
    const job = typeof jobRaw === 'string' ? JSON.parse(jobRaw) : jobRaw;

    const transcriptText = transcript.map(m => `${m.role === 'user' ? 'Candidate' : 'Interviewer'}: ${m.content}`).join('\n');

    const system = `You are an HR evaluation assistant. Based on this real interview transcript for the position "${job.title}" (${job.description}), produce a final evaluation.
Respond ONLY with a single JSON object, no markdown fences:
{
  "score": 0-100 (integer),
  "strengths": ["string", "..."],
  "concerns": ["string", "..."],
  "recommendation": "proceed" | "proceed_with_reservations" | "not_recommended"
}
This is a recommendation only for a human reviewer — never a final hiring decision.`;

    const raw = await callQwen({
      system,
      messages: [{ role: 'user', content: transcriptText }],
      temperature: 0.3,
    });
    const evaluation = extractJson(raw);

    const candRaw = await redis.get(`candidates:${jobId}`);
    const candidates = candRaw ? (typeof candRaw === 'string' ? JSON.parse(candRaw) : candRaw) : [];
    const idx = candidates.findIndex(c => c.id === candidateId);
    if (idx !== -1) {
      candidates[idx].interview = evaluation;
      await redis.set(`candidates:${jobId}`, JSON.stringify(candidates));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to finalize interview', detail: String(err.message || err) });
  }
});

// =========================================================================
// HR MANAGEMENT SYSTEM (employees, attendance, leave, advances, payroll)
// =========================================================================

// ---- helper: generate a unique numeric password (5-10 digits) ----
function generateUniquePassword(existingPasswords) {
  let password;
  let attempts = 0;
  do {
    const length = 5 + Math.floor(Math.random() * 6); // 5 to 10 digits
    password = '';
    for (let i = 0; i < length; i++) password += Math.floor(Math.random() * 10);
    attempts++;
  } while (existingPasswords.includes(password) && attempts < 50);
  return password;
}

// =========================================================================
// COMPANY MULTI-TENANCY (each company's data is fully isolated)
// =========================================================================

app.post('/api/hrm/company/register', async (req, res) => {
  try {
    const { name, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: 'name and password are required' });

    const nameKey = `company-name:${name.trim().toLowerCase()}`;
    const existing = await redis.get(nameKey);
    if (existing) return res.status(409).json({ error: 'اسم الشركة موجود مسبقاً، اختر اسم آخر أو سجل دخول.' });

    const companyId = newId();
    await redis.set(`company:${companyId}`, JSON.stringify({ id: companyId, name, password, createdAt: Date.now() }));
    await redis.set(nameKey, companyId);
    await redis.set(`hrm:employee-index:${companyId}`, JSON.stringify([]));
    res.json({ companyId, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to register company', detail: String(err.message || err) });
  }
});

app.post('/api/hrm/company/login', async (req, res) => {
  try {
    const { name, password } = req.body;
    const nameKey = `company-name:${(name || '').trim().toLowerCase()}`;
    const companyId = await redis.get(nameKey);
    if (!companyId) return res.status(401).json({ error: 'اسم الشركة أو كلمة السر غير صحيحة' });

    const raw = await redis.get(`company:${companyId}`);
    const company = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    if (!company || company.password !== password) return res.status(401).json({ error: 'اسم الشركة أو كلمة السر غير صحيحة' });
    res.json({ company: { id: company.id, name: company.name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed', detail: String(err.message || err) });
  }
});

// ---- Employees (now scoped per company, stored as individual keys for scalability) ----
app.post('/api/hrm/employees', async (req, res) => {
  try {
    const { companyId, name, position, salary, startDate, workStartTime } = req.body;
    if (!companyId || !name || !salary || !startDate) return res.status(400).json({ error: 'companyId, name, salary, startDate are required' });

    const indexKey = `hrm:employee-index:${companyId}`;
    const indexRaw = await redis.get(indexKey);
    const index = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];

    // check password uniqueness within this company only
    const existingPasswords = [];
    for (const id of index) {
      const eRaw = await redis.get(`employee:${companyId}:${id}`);
      const e = eRaw ? (typeof eRaw === 'string' ? JSON.parse(eRaw) : eRaw) : null;
      if (e) existingPasswords.push(e.password);
    }
    const password = generateUniquePassword(existingPasswords);

    const empId = newId();
    const employee = {
      id: empId, companyId, name, position: position || '', salary: Number(salary), startDate,
      password, workStartTime: workStartTime || '09:00', createdAt: Date.now(),
    };

    await redis.set(`employee:${companyId}:${empId}`, JSON.stringify(employee));
    index.push(empId);
    await redis.set(indexKey, JSON.stringify(index));

    res.json({ employee, generatedPassword: password });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add employee', detail: String(err.message || err) });
  }
});

app.get('/api/hrm/employees/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const indexRaw = await redis.get(`hrm:employee-index:${companyId}`);
    const index = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];
    if (index.length === 0) return res.json({ employees: [] });

    const keys = index.map(id => `employee:${companyId}:${id}`);
    const results = await redis.mget(...keys);
    const employees = results
      .filter(Boolean)
      .map(r => (typeof r === 'string' ? JSON.parse(r) : r));

    res.json({ employees });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load employees', detail: String(err.message || err) });
  }
});

// ---- Employee login (now scoped to a specific company, found by company name) ----
app.post('/api/hrm/employee-login', async (req, res) => {
  try {
    const { companyName, name, password } = req.body;
    const nameKey = `company-name:${(companyName || '').trim().toLowerCase()}`;
    const companyId = await redis.get(nameKey);
    if (!companyId) return res.status(401).json({ error: 'اسم الشركة غير صحيح' });

    const indexRaw = await redis.get(`hrm:employee-index:${companyId}`);
    const index = indexRaw ? (typeof indexRaw === 'string' ? JSON.parse(indexRaw) : indexRaw) : [];

    for (const id of index) {
      const raw = await redis.get(`employee:${companyId}:${id}`);
      const employee = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      if (employee && employee.name === name && employee.password === password) {
        const { password: _pw, ...safeEmployee } = employee;
        return res.json({ employee: safeEmployee, companyId });
      }
    }
    res.status(401).json({ error: 'اسم أو كلمة سر غير صحيحة' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed', detail: String(err.message || err) });
  }
});

// ---- helper: years of service -> annual leave entitlement (Jordan Labor Law) ----
function annualLeaveEntitlement(startDate) {
  const years = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
  return years >= 5 ? 21 : 14;
}

function dailyRate(salary) {
  return salary / 30;
}

// ---- Attendance: check-in / check-out (with automatic lateness deduction) ----
app.post('/api/hrm/attendance', async (req, res) => {
  try {
    const { companyId, employeeId, type } = req.body; // type: 'in' | 'out'
    if (!companyId || !employeeId || !['in', 'out'].includes(type)) return res.status(400).json({ error: 'companyId, employeeId and valid type are required' });

    const key = `hrm:attendance:${employeeId}`;
    const raw = await redis.get(key);
    const records = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];

    const today = new Date().toISOString().slice(0, 10);
    let todayRecord = records.find(r => r.date === today);
    let lateInfo = null;

    if (type === 'in') {
      const now = Date.now();
      if (!todayRecord) {
        todayRecord = { date: today, checkIn: now, checkOut: null };
        records.push(todayRecord);
      } else {
        todayRecord.checkIn = now;
      }

      // ---- lateness check (grace period: 10 minutes) ----
      const empRaw = await redis.get(`employee:${companyId}:${employeeId}`);
      const employee = empRaw ? (typeof empRaw === 'string' ? JSON.parse(empRaw) : empRaw) : null;
      if (employee && employee.workStartTime) {
        const [h, m] = employee.workStartTime.split(':').map(Number);
        const scheduledStart = new Date();
        scheduledStart.setHours(h, m, 0, 0);
        const lateMinutes = Math.round((now - scheduledStart.getTime()) / 60000);

        if (lateMinutes > 10) {
          const rate = dailyRate(employee.salary);
          const minuteRate = rate / (8 * 60); // assuming 8-hour workday
          const deductionAmount = Math.round(lateMinutes * minuteRate * 100) / 100;

          const dedKey = `hrm:deductions:${employeeId}`;
          const dedRaw = await redis.get(dedKey);
          const deductions = dedRaw ? (typeof dedRaw === 'string' ? JSON.parse(dedRaw) : dedRaw) : [];
          const deduction = {
            id: newId(), date: today, reason: `تأخير ${lateMinutes} دقيقة عن موعد الدوام`,
            amount: deductionAmount, createdAt: Date.now(),
          };
          deductions.push(deduction);
          await redis.set(dedKey, JSON.stringify(deductions));
          lateInfo = deduction;
        }
      }
    } else {
      if (!todayRecord) return res.status(400).json({ error: 'Cannot check out before checking in today' });
      todayRecord.checkOut = Date.now();
    }

    await redis.set(key, JSON.stringify(records));
    res.json({ record: todayRecord, lateDeduction: lateInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Attendance action failed', detail: String(err.message || err) });
  }
});

// ---- Deductions ----
app.get('/api/hrm/deductions/:employeeId', async (req, res) => {
  try {
    const raw = await redis.get(`hrm:deductions:${req.params.employeeId}`);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    res.json({ deductions: list.reverse() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load deductions', detail: String(err.message || err) });
  }
});

app.get('/api/hrm/attendance/:employeeId', async (req, res) => {
  try {
    const raw = await redis.get(`hrm:attendance:${req.params.employeeId}`);
    const records = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    res.json({ records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load attendance', detail: String(err.message || err) });
  }
});

// ---- Leave requests ----
app.post('/api/hrm/leave', async (req, res) => {
  try {
    const { employeeId, type, startDate, endDate, reason } = req.body; // type: 'annual' | 'sick' | 'unpaid'
    if (!employeeId || !type || !startDate || !endDate) return res.status(400).json({ error: 'Missing fields' });

    const days = Math.round((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
    const leaveId = newId();
    const leave = { id: leaveId, employeeId, type, startDate, endDate, days, reason: reason || '', status: 'pending', createdAt: Date.now() };

    const key = `hrm:leaves:${employeeId}`;
    const raw = await redis.get(key);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    list.push(leave);
    await redis.set(key, JSON.stringify(list));
    res.json({ leave });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to submit leave request', detail: String(err.message || err) });
  }
});

app.post('/api/hrm/leave/:leaveId/status', async (req, res) => {
  try {
    const { employeeId, status } = req.body; // status: 'approved' | 'rejected'
    const key = `hrm:leaves:${employeeId}`;
    const raw = await redis.get(key);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    const idx = list.findIndex(l => l.id === req.params.leaveId);
    if (idx === -1) return res.status(404).json({ error: 'Leave request not found' });
    list[idx].status = status;
    await redis.set(key, JSON.stringify(list));
    res.json({ leave: list[idx] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update leave status', detail: String(err.message || err) });
  }
});

app.get('/api/hrm/leave/:employeeId', async (req, res) => {
  try {
    const raw = await redis.get(`hrm:leaves:${req.params.employeeId}`);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    res.json({ leaves: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load leave requests', detail: String(err.message || err) });
  }
});

// ---- Salary advances ----
app.post('/api/hrm/advance', async (req, res) => {
  try {
    const { employeeId, amount, installments, reason } = req.body;
    if (!employeeId || !amount || !installments) return res.status(400).json({ error: 'Missing fields' });

    const todayDate = new Date().getDate();
    if (todayDate < 15) {
      return res.status(403).json({ error: `طلبات السلف مسموحة بس بعد يوم 15 من الشهر. اليوم هو يوم ${todayDate}.` });
    }

    const advanceId = newId();
    const advance = {
      id: advanceId, employeeId, amount: Number(amount), installments: Number(installments),
      installmentAmount: Number(amount) / Number(installments),
      remainingInstallments: Number(installments), reason: reason || '',
      status: 'active', createdAt: Date.now(),
    };

    const key = `hrm:advances:${employeeId}`;
    const raw = await redis.get(key);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    list.push(advance);
    await redis.set(key, JSON.stringify(list));
    res.json({ advance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record advance', detail: String(err.message || err) });
  }
});

app.get('/api/hrm/advance/:employeeId', async (req, res) => {
  try {
    const raw = await redis.get(`hrm:advances:${req.params.employeeId}`);
    const list = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
    res.json({ advances: list });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load advances', detail: String(err.message || err) });
  }
});

// ---- Payroll calculation for a given month (YYYY-MM) ----
app.get('/api/hrm/payroll/:companyId/:employeeId', async (req, res) => {
  try {
    const { companyId, employeeId } = req.params;
    const month = req.query.month || new Date().toISOString().slice(0, 7); // "YYYY-MM"

    const empRaw = await redis.get(`employee:${companyId}:${employeeId}`);
    const employee = empRaw ? (typeof empRaw === 'string' ? JSON.parse(empRaw) : empRaw) : null;
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const rate = dailyRate(employee.salary);
    const entitlement = annualLeaveEntitlement(employee.startDate);

    // leaves this month
    const leaveRaw = await redis.get(`hrm:leaves:${employeeId}`);
    const leaves = (leaveRaw ? (typeof leaveRaw === 'string' ? JSON.parse(leaveRaw) : leaveRaw) : [])
      .filter(l => l.status === 'approved' && l.startDate.slice(0, 7) === month);

    const unpaidDays = leaves.filter(l => l.type === 'unpaid').reduce((sum, l) => sum + l.days, 0);
    const sickDays = leaves.filter(l => l.type === 'sick').reduce((sum, l) => sum + l.days, 0);
    const annualDaysUsed = leaves.filter(l => l.type === 'annual').reduce((sum, l) => sum + l.days, 0);

    // advances: active installment due this month
    const advRaw = await redis.get(`hrm:advances:${employeeId}`);
    const advances = (advRaw ? (typeof advRaw === 'string' ? JSON.parse(advRaw) : advRaw) : [])
      .filter(a => a.status === 'active' && a.remainingInstallments > 0);
    const advanceDeduction = advances.reduce((sum, a) => sum + a.installmentAmount, 0);

    // lateness / other deductions this month
    const dedRaw = await redis.get(`hrm:deductions:${employeeId}`);
    const deductions = (dedRaw ? (typeof dedRaw === 'string' ? JSON.parse(dedRaw) : dedRaw) : [])
      .filter(d => d.date.slice(0, 7) === month);
    const latenessDeduction = deductions.reduce((sum, d) => sum + d.amount, 0);

    const unpaidDeduction = unpaidDays * rate;
    const netSalary = employee.salary - unpaidDeduction - advanceDeduction - latenessDeduction;

    res.json({
      employee: { name: employee.name, position: employee.position, baseSalary: employee.salary },
      month,
      dailyRate: Math.round(rate * 100) / 100,
      annualLeaveEntitlement: entitlement,
      annualDaysUsedThisMonth: annualDaysUsed,
      sickDaysThisMonth: sickDays,
      unpaidDaysThisMonth: unpaidDays,
      unpaidDeduction: Math.round(unpaidDeduction * 100) / 100,
      advanceDeduction: Math.round(advanceDeduction * 100) / 100,
      latenessDeduction: Math.round(latenessDeduction * 100) / 100,
      deductionsList: deductions,
      netSalary: Math.round(netSalary * 100) / 100,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to calculate payroll', detail: String(err.message || err) });
  }
});

// =========================================================================
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

// ---- route: find real job listings matching a suggested role ----
// body: { title: "Web Developer", location: "Jordan" }
app.post('/api/find-jobs', async (req, res) => {
  try {
    const { title, location = 'Jordan' } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const JOOBLE_KEY = process.env.JOOBLE_API_KEY;
    if (!JOOBLE_KEY) {
      return res.status(500).json({ error: 'JOOBLE_API_KEY is not set on the server' });
    }

    const jRes = await fetch(`https://jooble.org/api/${JOOBLE_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: title, location }),
    });

    if (!jRes.ok) {
      const errText = await jRes.text();
      throw new Error(`Jooble API error (${jRes.status}): ${errText}`);
    }

    const data = await jRes.json();
    const jobs = (data.jobs || []).slice(0, 5).map((j) => ({
      title: j.title,
      company: j.company,
      location: j.location,
      link: j.link,
      snippet: j.snippet,
    }));

    res.json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch jobs', detail: String(err.message || err) });
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