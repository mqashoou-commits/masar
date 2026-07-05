const params = new URLSearchParams(location.search);
const jobId = params.get('job');
const candidateId = params.get('cand');

const introCard = document.getElementById('introCard');
const jobTitleDisplay = document.getElementById('jobTitleDisplay');
const startBtn = document.getElementById('startBtn');
const chatWindow = document.getElementById('chatWindow');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const doneCard = document.getElementById('doneCard');

let history_ = [];
let questionCount = 0;
let targetQuestionCount = null; // set by backend on first response (10-15)

async function loadJob(){
  if (!jobId) { jobTitleDisplay.textContent = 'رابط غير صالح'; return; }
  try {
    const res = await fetch(`/api/hr/jobs/${jobId}`);
    const data = await res.json();
    jobTitleDisplay.textContent = `مقابلة لوظيفة: ${data.job.title}`;
  } catch (err) {
    jobTitleDisplay.textContent = 'تعذر تحميل بيانات الوظيفة';
  }
}
loadJob();

function addMessage(role, content){
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'assistant'}`;
  div.textContent = content;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function interviewTurn(){
  addMessage('assistant', 'مسار عم يفكر...');
  const thinkingEl = chatLog.lastChild;
  try {
    const res = await fetch('/api/hr/interview-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, candidateId, lang: 'ar', history: history_, targetQuestionCount })
    });
    const data = await res.json();
    thinkingEl.remove();
    addMessage('assistant', data.reply);
    history_.push({ role: 'assistant', content: data.reply });
    questionCount++;
    if (targetQuestionCount === null) targetQuestionCount = data.questionCount;

    if (questionCount >= targetQuestionCount) {
      setTimeout(finishInterview, 800);
    }
  } catch (err) {
    thinkingEl.textContent = 'صار خطأ، جرب تحدّث الصفحة.';
  }
}

startBtn.addEventListener('click', () => {
  introCard.hidden = true;
  chatWindow.hidden = false;
  history_ = [{ role: 'user', content: 'Start the interview.' }];
  interviewTurn();
});

chatInput.addEventListener('paste', (e) => {
  e.preventDefault();
  chatInput.classList.add('paste-blocked');
  setTimeout(() => chatInput.classList.remove('paste-blocked'), 600);
});

sendBtn.addEventListener('click', sendReply);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReply(); });

function sendReply(){
  const val = chatInput.value.trim();
  if (!val) return;
  addMessage('user', val);
  history_.push({ role: 'user', content: val });
  chatInput.value = '';
  interviewTurn();
}

async function finishInterview(){
  chatWindow.hidden = true;
  doneCard.hidden = false;
  try {
    await fetch('/api/hr/interview-finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, candidateId })
    });
  } catch (err) {
    // silent — candidate already sees the thank-you screen
  }
}