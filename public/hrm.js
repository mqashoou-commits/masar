/* ---------------- company auth ---------------- */
let currentCompany = JSON.parse(localStorage.getItem('masar_company') || 'null');

const companyAuthCard = document.getElementById('companyAuthCard');
const hrmContent = document.getElementById('hrmContent');
const companyNameDisplay = document.getElementById('companyNameDisplay');

function showHrmContent(){
  companyAuthCard.hidden = true;
  hrmContent.hidden = false;
  companyNameDisplay.textContent = currentCompany.name;
  loadEmployees();
}

if (currentCompany) showHrmContent();

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
    showHrmContent();
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
    showHrmContent();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

document.getElementById('companyLogoutBtn').addEventListener('click', () => {
  localStorage.removeItem('masar_company');
  location.reload();
});

/* ---------------- tabs ---------------- */
document.querySelectorAll('.hrm-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hrm-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.hrm-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
  });
});

function escapeHtml(str){
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let employees = [];

async function loadEmployees(){
  const res = await fetch(`/api/hrm/employees/${currentCompany.id}`);
  const data = await res.json();
  employees = data.employees || [];
  renderEmployeesList();
  fillEmployeeSelects();
}

function renderEmployeesList(){
  const el = document.getElementById('employeesList');
  if (employees.length === 0) {
    el.innerHTML = '<p class="status-text">لسا ما في موظفين مضافين.</p>';
    return;
  }
  el.innerHTML = employees.map(e => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name emp-name-toggle" data-id="${e.id}" style="cursor:pointer;">${escapeHtml(e.name)} 🔑</span>
        <span class="cand-score">${e.salary} د.أ</span>
      </div>
      <div class="cand-details">
        <p>${escapeHtml(e.position || '—')} · موظف منذ ${e.startDate}</p>
        <p class="emp-password" data-id="${e.id}" hidden>كلمة السر: <strong>${escapeHtml(e.password)}</strong></p>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.emp-name-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const pwEl = document.querySelector(`.emp-password[data-id="${id}"]`);
      pwEl.hidden = !pwEl.hidden;
    });
  });
}

function fillEmployeeSelects(){
  const selects = ['attEmpSelect', 'leaveEmpSelect', 'advEmpSelect', 'payEmpSelect'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = employees.map(e => `<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
  });
}

document.getElementById('addEmpBtn').addEventListener('click', async () => {
  const name = document.getElementById('empName').value.trim();
  const position = document.getElementById('empPosition').value.trim();
  const salary = document.getElementById('empSalary').value.trim();
  const startDate = document.getElementById('empStartDate').value;
  const workStartTime = document.getElementById('empWorkStart').value || '09:00';
  const status = document.getElementById('empStatus');
  const pwBox = document.getElementById('newPasswordBox');

  if (!name || !salary || !startDate) {
    status.textContent = 'الرجاء تعبئة الاسم والراتب وتاريخ البداية.';
    return;
  }
  status.textContent = 'جاري الإضافة...';
  pwBox.hidden = true;
  try {
    const res = await fetch('/api/hrm/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: currentCompany.id, name, position, salary, startDate, workStartTime })
    });
    const data = await res.json();

    document.getElementById('empName').value = '';
    document.getElementById('empPosition').value = '';
    document.getElementById('empSalary').value = '';
    document.getElementById('empStartDate').value = '';
    status.textContent = '';

    pwBox.hidden = false;
    pwBox.innerHTML = `✅ تمت إضافة <strong>${escapeHtml(name)}</strong> بنجاح.<br>
      كلمة السر التلقائية: <strong>${data.generatedPassword}</strong><br>
       احفظ هذه الكلمة الآن وشاركها مع الموظف .`;

    loadEmployees();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

/* ---------------- attendance ---------------- */
document.getElementById('checkInBtn').addEventListener('click', () => attendanceAction('in'));
document.getElementById('checkOutBtn').addEventListener('click', () => attendanceAction('out'));

async function attendanceAction(type){
  const employeeId = document.getElementById('attEmpSelect').value;
  const status = document.getElementById('attStatus');
  if (!employeeId) { status.textContent = 'اختر موظف أول.'; return; }
  status.textContent = 'جاري التسجيل...';
  try {
    const res = await fetch('/api/hrm/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: currentCompany.id, employeeId, type })
    });
    if (!res.ok) throw new Error();
    status.textContent = type === 'in' ? '✅ تم تسجيل الحضور' : '✅ تم تسجيل الانصراف';
    loadAttendance(employeeId);
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
}

document.getElementById('attEmpSelect').addEventListener('change', (e) => loadAttendance(e.target.value));

async function loadAttendance(employeeId){
  if (!employeeId) return;
  const res = await fetch(`/api/hrm/attendance/${employeeId}`);
  const data = await res.json();
  const el = document.getElementById('attendanceList');
  const records = (data.records || []).slice(-15).reverse();
  if (records.length === 0) {
    el.innerHTML = '<p class="status-text">لا يوجد سجل حضور بعد.</p>';
    return;
  }
  el.innerHTML = records.map(r => {
    const inTime = r.checkIn ? new Date(r.checkIn).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }) : '—';
    const outTime = r.checkOut ? new Date(r.checkOut).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' }) : '—';
    let hours = '';
    if (r.checkIn && r.checkOut) {
      const h = ((r.checkOut - r.checkIn) / (1000 * 60 * 60)).toFixed(1);
      hours = `<span class="cand-score">${h} ساعة</span>`;
    }
    return `<div class="cand-card"><div class="cand-card-head"><span class="cand-name">${r.date}</span>${hours}</div>
      <div class="cand-details">حضور: ${inTime} · انصراف: ${outTime}</div></div>`;
  }).join('');
}

/* ---------------- leave ---------------- */
document.getElementById('submitLeaveBtn').addEventListener('click', async () => {
  const employeeId = document.getElementById('leaveEmpSelect').value;
  const type = document.getElementById('leaveType').value;
  const startDate = document.getElementById('leaveStart').value;
  const endDate = document.getElementById('leaveEnd').value;
  const status = document.getElementById('leaveStatus');

  if (!employeeId || !startDate || !endDate) { status.textContent = 'عبّي كل الحقول.'; return; }
  status.textContent = 'جاري الإرسال...';
  try {
    await fetch('/api/hrm/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, type, startDate, endDate })
    });
    status.textContent = '';
    loadLeaves(employeeId);
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

document.getElementById('leaveEmpSelect').addEventListener('change', (e) => loadLeaves(e.target.value));

const leaveTypeLabels = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بدون أجر' };
const leaveStatusLabels = { pending: 'قيد المراجعة', approved: 'موافق عليها', rejected: 'مرفوضة' };

async function loadLeaves(employeeId){
  if (!employeeId) return;
  const res = await fetch(`/api/hrm/leave/${employeeId}`);
  const data = await res.json();
  const el = document.getElementById('leaveList');
  const leaves = (data.leaves || []).reverse();
  if (leaves.length === 0) {
    el.innerHTML = '<p class="status-text">لا يوجد طلبات إجازة بعد.</p>';
    return;
  }
  el.innerHTML = leaves.map(l => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name">${leaveTypeLabels[l.type]} — ${l.days} يوم</span>
        <span class="cand-rec rec-${l.status === 'approved' ? 'shortlist' : l.status === 'rejected' ? 'reject' : 'maybe'}">${leaveStatusLabels[l.status]}</span>
      </div>
      <div class="cand-details">${l.startDate} → ${l.endDate}</div>
      ${l.status === 'pending' ? `
        <div class="btn-row">
          <button class="cta cta-solid small" onclick="setLeaveStatus('${l.id}','${employeeId}','approved')">موافقة</button>
          <button class="cta small" onclick="setLeaveStatus('${l.id}','${employeeId}','rejected')">رفض</button>
        </div>` : ''}
    </div>
  `).join('');
}

async function setLeaveStatus(leaveId, employeeId, status){
  await fetch(`/api/hrm/leave/${leaveId}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId, status })
  });
  loadLeaves(employeeId);
}

/* ---------------- advances ---------------- */
document.getElementById('submitAdvBtn').addEventListener('click', async () => {
  const employeeId = document.getElementById('advEmpSelect').value;
  const amount = document.getElementById('advAmount').value.trim();
  const installments = document.getElementById('advInstallments').value.trim();
  const status = document.getElementById('advStatus');

  if (!employeeId || !amount || !installments) { status.textContent = 'عبّي كل الحقول.'; return; }
  status.textContent = 'جاري التسجيل...';
  try {
    await fetch('/api/hrm/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId, amount, installments })
    });
    document.getElementById('advAmount').value = '';
    document.getElementById('advInstallments').value = '';
    status.textContent = '';
    loadAdvances(employeeId);
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

document.getElementById('advEmpSelect').addEventListener('change', (e) => loadAdvances(e.target.value));

async function loadAdvances(employeeId){
  if (!employeeId) return;
  const res = await fetch(`/api/hrm/advance/${employeeId}`);
  const data = await res.json();
  const el = document.getElementById('advanceList');
  const advances = (data.advances || []).reverse();
  if (advances.length === 0) {
    el.innerHTML = '<p class="status-text">لا يوجد سلف مسجلة.</p>';
    return;
  }
  el.innerHTML = advances.map(a => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name">${a.amount} د.أ</span>
        <span class="cand-score">${a.installmentAmount.toFixed(2)} د.أ / شهر</span>
      </div>
      <div class="cand-details">عدد الأقساط: ${a.installments}</div>
    </div>
  `).join('');
}

/* ---------------- payroll ---------------- */
document.getElementById('calcPayBtn').addEventListener('click', async () => {
  const employeeId = document.getElementById('payEmpSelect').value;
  const month = document.getElementById('payMonth').value;
  if (!employeeId) return;

  const url = month ? `/api/hrm/payroll/${currentCompany.id}/${employeeId}?month=${month}` : `/api/hrm/payroll/${currentCompany.id}/${employeeId}`;
  const res = await fetch(url);
  const data = await res.json();
  const resultEl = document.getElementById('payrollResult');
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <h3>${escapeHtml(data.employee.name)} — ${data.month}</h3>
    <div class="payroll-row"><span>الراتب الأساسي</span><span>${data.employee.baseSalary} د.أ</span></div>
    <div class="payroll-row"><span>استحقاق الإجازة السنوية</span><span>${data.annualLeaveEntitlement} يوم/سنة</span></div>
    <div class="payroll-row"><span>أيام إجازة مرضية هالشهر</span><span>${data.sickDaysThisMonth} يوم</span></div>
    <div class="payroll-row"><span>أيام بدون أجر هالشهر</span><span>${data.unpaidDaysThisMonth} يوم</span></div>
    <div class="payroll-row"><span>خصم الإجازة بدون أجر</span><span>- ${data.unpaidDeduction} د.أ</span></div>
    <div class="payroll-row"><span>خصم قسط السلفة</span><span>- ${data.advanceDeduction} د.أ</span></div>
    <div class="payroll-row"><span>خصم التأخير</span><span>- ${data.latenessDeduction} د.أ</span></div>
    <div class="payroll-row"><span>صافي الراتب</span><span>${data.netSalary} د.أ</span></div>
  `;
});

loadEmployees();