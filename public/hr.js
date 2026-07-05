/* ---------------- company auth ---------------- */
let currentCompany = JSON.parse(localStorage.getItem('masar_company') || 'null');

const companyAuthCard = document.getElementById('companyAuthCard');
const hrContent = document.getElementById('hrContent');
const companyNameDisplay = document.getElementById('companyNameDisplay');

const params = new URLSearchParams(location.search);
let currentJobId = params.get('job') || null;

function showHrContent(){
  companyAuthCard.hidden = true;
  hrContent.hidden = false;
  companyNameDisplay.textContent = currentCompany.name;

  if (currentJobId) {
    loadDashboard();
  } else {
    loadJobsList();
  }
}

if (currentCompany) showHrContent();

document.getElementById('companyLoginBtn').addEventListener('click', async () => {
  const name = document.getElementById('companyName').value.trim();
  const password = document.getElementById('companyPassword').value;
  const status = document.getElementById('companyAuthStatus');
  if (!name || !password) { status.textContent = 'عبّي اسم الشركة وكلمة السر.'; return; }
  status.textContent = 'جاري الدخول...';
  try {
    const res = await fetch('/api/hrm/company/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error; return; }
    currentCompany = data.company;
    localStorage.setItem('masar_company', JSON.stringify(currentCompany));
    status.textContent = '';
    showHrContent();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

document.getElementById('companyRegisterBtn').addEventListener('click', async () => {
  const name = document.getElementById('companyName').value.trim();
  const password = document.getElementById('companyPassword').value;
  const status = document.getElementById('companyAuthStatus');
  if (!name || !password) { status.textContent = 'عبّي اسم الشركة وكلمة السر.'; return; }
  status.textContent = 'جاري الإنشاء...';
  try {
    const res = await fetch('/api/hrm/company/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error; return; }
    currentCompany = { id: data.companyId, name: data.name };
    localStorage.setItem('masar_company', JSON.stringify(currentCompany));
    status.textContent = '';
    showHrContent();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

document.getElementById('companyLogoutBtn').addEventListener('click', () => {
  localStorage.removeItem('masar_company');
  location.href = 'hr.html';
});

function escapeHtml(str){
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------------- jobs list ---------------- */
const jobsListCard = document.getElementById('jobsListCard');
const createJobCard = document.getElementById('createJobCard');
const dashboardCard = document.getElementById('dashboardCard');

async function loadJobsList(){
  jobsListCard.hidden = false;
  createJobCard.hidden = true;
  dashboardCard.hidden = true;

  const res = await fetch(`/api/hr/jobs-by-company/${currentCompany.id}`);
  const data = await res.json();
  const el = document.getElementById('jobsListContainer');

  if (!data.jobs || data.jobs.length === 0) {
    el.innerHTML = '<p class="status-text">لسا ما نشرت أي وظيفة.</p>';
    return;
  }
  el.innerHTML = data.jobs.map(j => `
    <div class="cand-card" style="cursor:pointer;" onclick="openJob('${j.id}')">
      <div class="cand-card-head">
        <span class="cand-name">${escapeHtml(j.title)}</span>
      </div>
      <div class="cand-details">${escapeHtml(j.description.slice(0, 100))}...</div>
    </div>
  `).join('');
}

function openJob(jobId){
  currentJobId = jobId;
  history.pushState(null, '', `hr.html?job=${jobId}`);
  loadDashboard();
}

document.getElementById('newJobBtn').addEventListener('click', () => {
  jobsListCard.hidden = true;
  createJobCard.hidden = false;
});

document.getElementById('cancelNewJobBtn').addEventListener('click', () => {
  createJobCard.hidden = true;
  loadJobsList();
});

/* ---------------- create job ---------------- */
const jobTitleInput = document.getElementById('jobTitle');
const jobDescriptionInput = document.getElementById('jobDescription');
const createJobBtn = document.getElementById('createJobBtn');
const createJobStatus = document.getElementById('createJobStatus');
const dashJobTitle = document.getElementById('dashJobTitle');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const candName = document.getElementById('candName');
const candCvFile = document.getElementById('candCvFile');
const uploadStatus = document.getElementById('uploadStatus');
const candidatesList = document.getElementById('candidatesList');

async function createJob(){
  const title = jobTitleInput.value.trim();
  const description = jobDescriptionInput.value.trim();
  if (!title || description.length < 20) {
    createJobStatus.textContent = 'الرجاء تعبئة المسمى الوظيفي ووصف كامل للوظيفة.';
    return;
  }
  createJobStatus.textContent = 'جاري الإنشاء...';
  try {
    const res = await fetch('/api/hr/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: currentCompany.id, title, description })
    });
    const data = await res.json();
    if (!data.jobId) throw new Error('no jobId');
    currentJobId = data.jobId;
    history.pushState(null, '', `hr.html?job=${currentJobId}`);
    createJobCard.hidden = true;
    loadDashboard();
  } catch (err) {
    createJobStatus.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
}

createJobBtn.addEventListener('click', createJob);

async function loadDashboard(){
  if (!currentJobId) return;
  jobsListCard.hidden = true;
  createJobCard.hidden = true;
  dashboardCard.hidden = false;

  const res = await fetch(`/api/hr/jobs/${currentJobId}`);
  if (!res.ok) return;
  const data = await res.json();
  dashJobTitle.textContent = data.job.title;
  renderCandidates(data.candidates || []);
}

copyLinkBtn.addEventListener('click', () => {
  const url = `${location.origin}/hr.html?job=${currentJobId}`;
  navigator.clipboard.writeText(url);
  copyLinkBtn.textContent = '✅ انسخ رابط الوظيفة';
  setTimeout(() => { copyLinkBtn.textContent = '📋 انسخ رابط الوظيفة'; }, 2000);
});

candCvFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadStatus.textContent = 'جاري تحليل السيرة الذاتية ومقارنتها بالوظيفة...';

  const formData = new FormData();
  formData.append('cv', file);
  formData.append('name', candName.value.trim());

  try {
    const res = await fetch(`/api/hr/jobs/${currentJobId}/candidates`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('bad response');
    uploadStatus.textContent = '';
    candName.value = '';
    candCvFile.value = '';
    loadDashboard();
  } catch (err) {
    uploadStatus.textContent = 'صار خطأ بتحليل السيرة الذاتية، جرب مرة ثانية.';
  }
});

function recLabel(rec){
  const map = {
    shortlist: 'يستاهل الترشيح', maybe: 'يحتاج مراجعة', reject: 'غير مناسب حالياً',
    proceed: 'يستاهل المتابعة', proceed_with_reservations: 'متابعة بتحفظ', not_recommended: 'غير موصى به',
  };
  return map[rec] || rec;
}

function renderCandidates(candidates){
  if (candidates.length === 0) {
    candidatesList.innerHTML = '<p class="status-text">لسا ما في مرشحين، ارفع أول CV فوق.</p>';
    return;
  }

  candidatesList.innerHTML = candidates.map(c => {
    const inviteUrl = `${location.origin}/apply.html?job=${currentJobId}&cand=${c.id}`;
    const interviewBlock = c.interview
      ? `<div class="cand-details">
           <strong>نتيجة المقابلة: ${c.interview.score}/100</strong>
           <span class="cand-rec rec-${c.interview.recommendation}">${recLabel(c.interview.recommendation)}</span>
           <ul>${(c.interview.concerns || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
         </div>`
      : `<div class="cand-invite-link">
           <input type="text" readonly value="${inviteUrl}">
           <button class="cta cta-solid small" onclick="navigator.clipboard.writeText('${inviteUrl}')">انسخ رابط المقابلة</button>
         </div>`;

    return `
      <div class="cand-card">
        <div class="cand-card-head">
          <span class="cand-name">${escapeHtml(c.name)}</span>
          <span>
            <span class="cand-score">${c.cvScore}/100</span>
            <span class="cand-rec rec-${c.cvRecommendation}">${recLabel(c.cvRecommendation)}</span>
          </span>
        </div>
        <div class="cand-details">
          <strong>نقاط القوة:</strong>
          <ul>${(c.cvStrengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
          <strong>فجوات:</strong>
          <ul>${(c.cvGaps || []).map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul>
        </div>
        ${interviewBlock}
      </div>
    `;
  }).join('');
}