let currentEmployee = JSON.parse(localStorage.getItem('masar_employee') || 'null');

const loginCard = document.getElementById('loginCard');
const empDashboard = document.getElementById('empDashboard');
const logoutBtn = document.getElementById('logoutBtn');
const empNameDisplay = document.getElementById('empNameDisplay');

function escapeHtml(str){
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showDashboard(){
  loginCard.hidden = true;
  empDashboard.hidden = false;
  logoutBtn.hidden = false;
  empNameDisplay.textContent = currentEmployee.name;
  loadPayroll();
  loadDeductions();
  loadMyLeaves();
  loadMyAdvances();
}

if (currentEmployee) showDashboard();

document.getElementById('loginBtn').addEventListener('click', async () => {
  const companyName = document.getElementById('loginCompany').value.trim();
  const name = document.getElementById('loginName').value.trim();
  const password = document.getElementById('loginPassword').value;
  const status = document.getElementById('loginStatus');
  if (!companyName || !name || !password) { status.textContent = 'عبّي اسم الشركة والاسم وكلمة السر.'; return; }

  status.textContent = 'جاري الدخول...';
  try {
    const res = await fetch('/api/hrm/employee-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, name, password })
    });
    if (!res.ok) {
      const err = await res.json();
      status.textContent = err.error || 'صار خطأ.';
      return;
    }
    const data = await res.json();
    currentEmployee = data.employee;
    currentEmployee.companyId = data.companyId;
    localStorage.setItem('masar_employee', JSON.stringify(currentEmployee));
    status.textContent = '';
    showDashboard();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('masar_employee');
  location.reload();
});

/* ---------------- payroll ---------------- */
document.getElementById('loadPayBtn').addEventListener('click', loadPayroll);

async function loadPayroll(){
  const month = document.getElementById('payMonthSelect').value;
  const url = month ? `/api/hrm/payroll/${currentEmployee.companyId}/${currentEmployee.id}?month=${month}` : `/api/hrm/payroll/${currentEmployee.companyId}/${currentEmployee.id}`;
  const res = await fetch(url);
  const data = await res.json();
  const box = document.getElementById('payrollBox');
  box.innerHTML = `
    <div class="payroll-row"><span>الراتب الأساسي</span><span>${data.employee.baseSalary} د.أ</span></div>
    <div class="payroll-row"><span>أيام بدون أجر هالشهر</span><span>${data.unpaidDaysThisMonth} يوم</span></div>
    <div class="payroll-row"><span>خصم الإجازة بدون أجر</span><span>- ${data.unpaidDeduction} د.أ</span></div>
    <div class="payroll-row"><span>خصم قسط السلفة</span><span>- ${data.advanceDeduction} د.أ</span></div>
    <div class="payroll-row"><span>خصم التأخير</span><span>- ${data.latenessDeduction} د.أ</span></div>
    <div class="payroll-row"><span>صافي الراتب</span><span>${data.netSalary} د.أ</span></div>
  `;
}

/* ---------------- deductions ---------------- */
async function loadDeductions(){
  const res = await fetch(`/api/hrm/deductions/${currentEmployee.id}`);
  const data = await res.json();
  const el = document.getElementById('deductionsList');
  if (!data.deductions || data.deductions.length === 0) {
    el.innerHTML = '<p class="status-text">ما في خصومات مسجلة عليك 🎉</p>';
    return;
  }
  el.innerHTML = data.deductions.map(d => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name">${d.date}</span>
        <span class="cand-score">- ${d.amount} د.أ</span>
      </div>
      <div class="cand-details">${escapeHtml(d.reason)}</div>
    </div>
  `).join('');
}

/* ---------------- leave requests ---------------- */
document.getElementById('submitLeaveBtn').addEventListener('click', async () => {
  const type = document.getElementById('leaveType').value;
  const startDate = document.getElementById('leaveStart').value;
  const endDate = document.getElementById('leaveEnd').value;
  const reason = document.getElementById('leaveReason').value.trim();
  const status = document.getElementById('leaveStatus');

  if (!startDate || !endDate) { status.textContent = 'حدد التواريخ.'; return; }
  status.textContent = 'جاري الإرسال...';
  try {
    await fetch('/api/hrm/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: currentEmployee.id, type, startDate, endDate, reason })
    });
    document.getElementById('leaveStart').value = '';
    document.getElementById('leaveEnd').value = '';
    document.getElementById('leaveReason').value = '';
    status.textContent = '✅ تم إرسال الطلب';
    loadMyLeaves();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

const leaveTypeLabels = { annual: 'سنوية', sick: 'مرضية', unpaid: 'بدون أجر' };
const leaveStatusLabels = { pending: 'قيد المراجعة', approved: 'موافق عليها', rejected: 'مرفوضة' };

async function loadMyLeaves(){
  const res = await fetch(`/api/hrm/leave/${currentEmployee.id}`);
  const data = await res.json();
  const el = document.getElementById('myLeavesList');
  const leaves = (data.leaves || []).reverse();
  if (leaves.length === 0) {
    el.innerHTML = '<p class="status-text">ما في طلبات إجازة سابقة.</p>';
    return;
  }
  el.innerHTML = leaves.map(l => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name">${leaveTypeLabels[l.type]} — ${l.days} يوم</span>
        <span class="cand-rec rec-${l.status === 'approved' ? 'shortlist' : l.status === 'rejected' ? 'reject' : 'maybe'}">${leaveStatusLabels[l.status]}</span>
      </div>
      <div class="cand-details">${l.startDate} → ${l.endDate}${l.reason ? ' · ' + escapeHtml(l.reason) : ''}</div>
    </div>
  `).join('');
}

/* ---------------- advance requests ---------------- */
document.getElementById('submitAdvBtn').addEventListener('click', async () => {
  const amount = document.getElementById('advAmount').value.trim();
  const installments = document.getElementById('advInstallments').value.trim();
  const reason = document.getElementById('advReason').value.trim();
  const status = document.getElementById('advStatus');

  if (!amount || !installments) { status.textContent = 'عبّي المبلغ وعدد الأقساط.'; return; }
  status.textContent = 'جاري الإرسال...';
  try {
    const res = await fetch('/api/hrm/advance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: currentEmployee.id, amount, installments, reason })
    });
    const data = await res.json();
    if (!res.ok) { status.textContent = data.error; return; }
    document.getElementById('advAmount').value = '';
    document.getElementById('advInstallments').value = '';
    document.getElementById('advReason').value = '';
    status.textContent = '✅ تم إرسال الطلب';
    loadMyAdvances();
  } catch (err) {
    status.textContent = 'صار خطأ، جرب مرة ثانية.';
  }
});

async function loadMyAdvances(){
  const res = await fetch(`/api/hrm/advance/${currentEmployee.id}`);
  const data = await res.json();
  const el = document.getElementById('myAdvancesList');
  const advances = (data.advances || []).reverse();
  if (advances.length === 0) {
    el.innerHTML = '<p class="status-text">ما في سلف سابقة.</p>';
    return;
  }
  el.innerHTML = advances.map(a => `
    <div class="cand-card">
      <div class="cand-card-head">
        <span class="cand-name">${a.amount} د.أ</span>
        <span class="cand-score">${a.installmentAmount.toFixed(2)} د.أ / شهر</span>
      </div>
      <div class="cand-details">${a.installments} أقساط${a.reason ? ' · ' + escapeHtml(a.reason) : ''}</div>
    </div>
  `).join('');
}