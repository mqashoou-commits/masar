/* ---------------- i18n ---------------- */
let currentLang = localStorage.getItem('masar_lang') || 'ar';

function applyLang(lang){
  currentLang = lang;
  localStorage.setItem('masar_lang', lang);
  const dict = I18N[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = dict.dir;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (dict[key]) el.setAttribute('placeholder', dict[key]);
  });
}

document.getElementById('langToggle').addEventListener('click', () => {
  applyLang(currentLang === 'ar' ? 'en' : 'ar');
});

applyLang(currentLang);

/* ---------------- hero entrance + journey path draw ---------------- */
window.addEventListener('load', () => {
  gsap.from('.eyebrow, .hero-title, .hero-sub, .cta, .stat-row', {
    y: 24, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out'
  });
  gsap.to('#journeyPath', {
    strokeDashoffset: 0, duration: 2.2, delay: 0.4, ease: 'power2.inOut'
  });
});

document.getElementById('ctaStart').addEventListener('click', () => {
  document.getElementById('analyzeSection').scrollIntoView({ behavior: 'smooth' });
});

/* ---------------- scroll reveal for panels ---------------- */
const revealTargets = document.querySelectorAll('.panel-head, .input-card, .results-card, .interview-setup, .chat-window');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting){
      gsap.to(entry.target, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' });
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealTargets.forEach(el => {
  gsap.set(el, { y: 24, opacity: 0 });
  observer.observe(el);
});

/* ---------------- Three.js ambient particle field ---------------- */
(function initBackground(){
  const canvas = document.getElementById('bgCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 20;

  function resize(){
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const count = 260;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++){
    positions[i*3] = (Math.random() - 0.5) * 60;
    positions[i*3+1] = (Math.random() - 0.5) * 30;
    positions[i*3+2] = (Math.random() - 0.5) * 40;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x4FD1C5, size: 0.12, transparent: true, opacity: 0.7 });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  function animate(){
    requestAnimationFrame(animate);
    points.rotation.y += 0.0006;
    points.rotation.x += 0.0002;
    renderer.render(scene, camera);
  }
  animate();
})();

/* ---------------- CV analysis ---------------- */
const cvText = document.getElementById('cvText');
const cvFile = document.getElementById('cvFile');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeStatus = document.getElementById('analyzeStatus');
const resultsCard = document.getElementById('resultsCard');

cvFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  analyzeStatus.textContent = I18N[currentLang].analyzing;
  const formData = new FormData();
  formData.append('cv', file);
  try {
    const res = await fetch('/api/extract-cv', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.text) cvText.value = data.text;
    analyzeStatus.textContent = '';
  } catch (err) {
    analyzeStatus.textContent = I18N[currentLang].analyzeError;
  }
});

analyzeBtn.addEventListener('click', async () => {
  const text = cvText.value.trim();
  if (text.length < 20) {
    analyzeStatus.textContent = I18N[currentLang].analyzeError;
    return;
  }
  analyzeStatus.textContent = I18N[currentLang].analyzing;
  resultsCard.hidden = true;

  try {
    const res = await fetch('/api/analyze-cv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cvText: text, lang: currentLang })
    });
    if (!res.ok) throw new Error('bad response');
    const data = await res.json();
    renderResults(data);
    analyzeStatus.textContent = '';
  } catch (err) {
    analyzeStatus.textContent = I18N[currentLang].analyzeError;
  }
});

function renderResults(data){
  const strengthsList = document.getElementById('strengthsList');
  const gapsList = document.getElementById('gapsList');
  const rolesList = document.getElementById('rolesList');

  strengthsList.innerHTML = (data.strengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
  gapsList.innerHTML = (data.gaps || []).map(g => `<li>${escapeHtml(g)}</li>`).join('');
  rolesList.innerHTML = (data.suggestedRoles || []).map(r =>
    `<div class="role-card"><strong>${escapeHtml(r.title)}</strong><p>${escapeHtml(r.why)}</p></div>`
  ).join('');

  resultsCard.hidden = false;
  gsap.fromTo(resultsCard, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 });

  // pre-fill first suggested role into the interview role input
  if (data.suggestedRoles && data.suggestedRoles[0]) {
    roleInput.value = data.suggestedRoles[0].title;
  }
}

function escapeHtml(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ---------------- interview simulation ---------------- */
const roleInput = document.getElementById('roleInput');
const startInterviewBtn = document.getElementById('startInterviewBtn');
const interviewSetup = document.getElementById('interviewSetup');
const chatWindow = document.getElementById('chatWindow');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const sendReplyBtn = document.getElementById('sendReplyBtn');

let interviewHistory = [];
let interviewRole = '';

function addMessage(role, content){
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'assistant'}`;
  div.textContent = content;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function interviewTurn(){
  addMessage('assistant', I18N[currentLang].thinking);
  const thinkingEl = chatLog.lastChild;
  try {
    const res = await fetch('/api/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: interviewRole, lang: currentLang, history: interviewHistory })
    });
    const data = await res.json();
    thinkingEl.remove();
    addMessage('assistant', data.reply);
    interviewHistory.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    thinkingEl.textContent = I18N[currentLang].analyzeError;
  }
}

startInterviewBtn.addEventListener('click', () => {
  interviewRole = roleInput.value.trim() || 'General';
  interviewHistory = [{ role: 'user', content: 'Start the interview.' }];
  interviewSetup.hidden = true;
  chatWindow.hidden = false;
  gsap.fromTo(chatWindow, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 });
  interviewTurn();
});

sendReplyBtn.addEventListener('click', sendChatReply);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatReply(); });

function sendChatReply(){
  const val = chatInput.value.trim();
  if (!val) return;
  addMessage('user', val);
  interviewHistory.push({ role: 'user', content: val });
  chatInput.value = '';
  interviewTurn();
}
