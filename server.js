const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'SAGE_CLOUD_SECRET_2026';

// Ensure data folder exists
const DATA_DIR = process.env.VERCEL ? '/tmp/sage_data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ADMISSIONS_FILE = path.join(DATA_DIR, 'admissions.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');

// Helper to read JSON
function readJson(file, defaultValue = []) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {
        console.error('Error reading ' + file, e);
    }
    return defaultValue;
}

// Helper to write JSON atomically
function writeJson(file, data) {
    try {
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, file);
    } catch (e) {
        console.error('Error writing ' + file, e);
    }
}

// Normalize phone numbers (strips country code / leading zeros, takes last 9 digits)
function normalizePhone(p) {
    if (!p) return '';
    const digits = String(p).replace(/[^0-9]/g, '');
    return digits.length >= 9 ? digits.slice(-9) : digits;
}

// Body parser helper
function getBody(req) {
    if (req.body && typeof req.body === 'object') {
        return Promise.resolve(req.body);
    }
    return new Promise((resolve) => {
        let chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            const ct = (req.headers['content-type'] || '').toLowerCase();
            if (ct.includes('application/json')) {
                try {
                    resolve(JSON.parse(raw));
                    return;
                } catch (e) {
                    resolve({});
                    return;
                }
            }
            if (ct.includes('application/x-www-form-urlencoded')) {
                const params = new URLSearchParams(raw);
                const obj = {};
                for (const [k, v] of params.entries()) obj[k] = v;
                resolve(obj);
                return;
            }
            resolve(raw);
        });
        req.on('error', () => resolve({}));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ONLINE ADMISSION REGISTRATION WEB FORM (/register)
// ─────────────────────────────────────────────────────────────────────────────
function renderRegistrationPage() {
    const classes = readJson(CLASSES_FILE, []);
    let classHtml = '';
    if (classes.length === 0) {
        classHtml = '<div style="color:#64748b; font-size:12px; padding:8px 0;">Classes will be assigned upon institute enrollment.</div>';
    } else {
        classes.forEach(c => {
            const feeStr = c.fee ? ` (LKR ${Number(c.fee).toLocaleString()})` : '';
            classHtml += `
                <label style="display:flex; align-items:center; gap:8px; font-size:12.5px; padding:6px 0; cursor:pointer; border-bottom:1px solid #f1f5f9;">
                    <input type="checkbox" name="classes" value="${c.id || c.name}" style="accent-color:#b91c1c; width:16px; height:16px;">
                    <span><b>${c.name}</b> <span style="color:#64748b;">${c.grade || ''}${feeStr}</span></span>
                </label>
            `;
        });
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SAGE Higher Education Institute — Online Self-Admission</title>
    <style>
        :root {
            --primary: #7d1218;
            --primary-accent: #b91c1c;
            --bg: #f8fafc;
            --card-bg: #ffffff;
            --text-main: #0f172a;
            --text-muted: #64748b;
            --border: #e2e8f0;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg);
            color: var(--text-main);
            line-height: 1.5;
            padding-bottom: 40px;
        }
        .header-banner {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #7d1218 100%);
            color: white;
            padding: 32px 20px 24px;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }
        .header-logo {
            font-size: 26px;
            font-weight: 800;
            margin-bottom: 4px;
        }
        .header-logo span { color: #f87171; }
        .header-sub {
            font-size: 13px;
            opacity: 0.9;
            text-transform: uppercase;
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .container {
            max-width: 600px;
            margin: -14px auto 0;
            padding: 0 16px;
        }
        .portal-switch {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: white;
            padding: 12px 18px;
            border-radius: 14px;
            text-decoration: none;
            margin-bottom: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.04);
            border: 1.5px solid #e2e8f0;
            color: #1e293b;
        }
        .form-card {
            background: white;
            border-radius: 20px;
            padding: 26px 20px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.06);
            border: 1px solid var(--border);
        }
        .section-title {
            font-size: 14.5px;
            font-weight: 700;
            color: var(--primary);
            margin: 20px 0 12px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding-bottom: 6px;
            border-bottom: 1.5px solid #f1f5f9;
        }
        .section-title:first-of-type { margin-top: 0; }
        .form-group { margin-bottom: 16px; }
        label {
            display: block;
            font-size: 12.5px;
            font-weight: 700;
            color: #334155;
            margin-bottom: 6px;
        }
        .required { color: #dc2626; }
        .hint { font-size: 11px; color: var(--text-muted); font-weight: normal; }
        input[type="text"], input[type="tel"], input[type="date"], select, textarea {
            width: 100%;
            padding: 12px 14px;
            border: 1.5px solid var(--border);
            border-radius: 10px;
            font-size: 14.5px;
            outline: none;
            transition: 0.2s;
            box-sizing: border-box;
        }
        input:focus, select:focus, textarea:focus {
            border-color: var(--primary-accent);
            box-shadow: 0 0 0 3px rgba(185,28,38,0.15);
        }
        .row { display: flex; gap: 12px; }
        .col { flex: 1; }
        .btn-submit {
            width: 100%;
            padding: 15px;
            background: #7d1218;
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 15px rgba(125,18,24,0.3);
            margin-top: 20px;
            transition: 0.2s;
        }
        .btn-submit:hover { background: #9b1921; }
        .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
        #successCard { display: none; text-align: center; padding: 30px 10px; }
        .ref-box {
            background: #f8fafc;
            border: 2px dashed #cbd5e1;
            border-radius: 12px;
            padding: 16px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="header-banner">
        <div class="header-logo">🏛 SAGE <span>SMS</span></div>
        <div class="header-sub">Higher Education Institute</div>
        <div style="margin-top:8px; font-size:12px; background:rgba(255,255,255,0.15); display:inline-block; padding:4px 14px; border-radius:20px;">
            ✨ Online Student Self-Admission Desk (24/7)
        </div>
    </div>

    <div class="container">
        <a href="/" class="portal-switch">
            <span style="font-size:13px; font-weight:700;">👨‍👩‍👦 Already a Student? (දැනටමත් ශිෂ්‍යයෙක්ද?)</span>
            <span style="background:#7d1218; color:white; font-size:12px; font-weight:700; padding:5px 12px; border-radius:8px;">Parent Portal ➔</span>
        </a>

        <div class="form-card" id="formCard">
            <form id="admForm" onsubmit="submitForm(event)">
                <div class="section-title">👤 Student Details (ශිෂ්‍ය තොරතුරු)</div>
                <div class="form-group">
                    <label>Full Name (සම්පූර්ණ නම) <span class="required">*</span></label>
                    <input type="text" name="fullName" required placeholder="e.g. Kasun Mihisara Perera">
                </div>
                <div class="row">
                    <div class="col form-group">
                        <label>Name with Initials <span class="hint">(මුලකුරු සමඟ)</span></label>
                        <input type="text" name="nameInitials" placeholder="e.g. K.M. Perera">
                    </div>
                    <div class="col form-group">
                        <label>Gender (ස්ත්‍රී/පුරුෂ)</label>
                        <select name="gender">
                            <option value="Male">Male (පුරුෂ)</option>
                            <option value="Female">Female (ස්ත්‍රී)</option>
                        </select>
                    </div>
                </div>
                <div class="row">
                    <div class="col form-group">
                        <label>Date of Birth <span class="hint">(උපන් දිනය)</span></label>
                        <input type="date" name="dob">
                    </div>
                    <div class="col form-group">
                        <label>Grade / Year (පන්තිය) <span class="required">*</span></label>
                        <select name="grade" required>
                            <option value="">— Select Grade —</option>
                            ${['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11 (O/L)','Grade 12 (A/L)','Grade 13 (A/L)','After A/L'].map(g => `<option value="${g}">${g}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>School Name (පාසල)</label>
                    <input type="text" name="schoolName" placeholder="e.g. Royal College, Colombo">
                </div>

                <div class="section-title">📞 Contact Details (සම්බන්ධතා)</div>
                <div class="row">
                    <div class="col form-group">
                        <label>Mobile Phone (දුරකථන අංකය) <span class="required">*</span></label>
                        <input type="tel" name="phone" required placeholder="0771234567">
                    </div>
                    <div class="col form-group">
                        <label>WhatsApp Number</label>
                        <input type="tel" name="whatsapp" placeholder="0771234567">
                    </div>
                </div>
                <div class="row">
                    <div class="col form-group">
                        <label>Guardian / Parent Name (දෙමාපිය නම)</label>
                        <input type="text" name="guardianName" placeholder="Father or Mother's Name">
                    </div>
                    <div class="col form-group">
                        <label>Guardian Phone (දෙමාපිය දුරකථනය)</label>
                        <input type="tel" name="guardianPhone" placeholder="0711234567">
                    </div>
                </div>
                <div class="form-group">
                    <label>Home Address & City (ලිපිනය සහ නගරය)</label>
                    <input type="text" name="address" placeholder="Address">
                </div>

                <div class="section-title">📚 Select Classes to Enroll (අයදුම් කරන පන්ති)</div>
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin-bottom:16px;">
                    ${classHtml}
                </div>

                <button type="submit" class="btn-submit" id="submitBtn">
                    ✔ Submit Online Registration (ලියාපදිංචි වන්න)
                </button>
            </form>

            <div id="successCard">
                <div style="font-size:52px; margin-bottom:12px;">🎉</div>
                <h2 style="color:#166534; font-size:22px; margin-bottom:6px;">Registration Submitted Successfully!</h2>
                <p style="color:#64748b; font-size:13px;">ඔබගේ ලියාපදිංචි අයදුම්පත ආයතනය වෙත සාර්ථකව ලැබුණි.</p>

                <div class="ref-box">
                    <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:#64748b;">Your Reference Number</div>
                    <div id="refNo" style="font-size:24px; font-weight:800; color:#7d1218; letter-spacing:1px; margin-top:4px;"></div>
                </div>

                <div style="background:#f1f5f9; padding:14px; border-radius:12px; font-size:12.5px; color:#334155; line-height:1.6; text-align:left; margin-bottom:20px;">
                    📌 <b>Next Steps (මීළඟ පියවර):</b><br>
                    1. Keep this Reference Number safe.<br>
                    2. Visit SAGE Institute reception counter to collect your Smart PVC ID Card.<br>
                    3. කාර්යාලය වෙත ගොස් ඔබගේ Smart PVC ID පත ලබාගන්න.
                </div>

                <a href="/register" style="display:inline-block; padding:10px 20px; background:#e2e8f0; color:#1e293b; border-radius:10px; text-decoration:none; font-weight:700; font-size:13px;">
                    ← Register Another Student
                </a>
            </div>
        </div>
    </div>

    <script>
        async function submitForm(e) {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.innerText = 'Submitting... කරුණාකර රැඳෙන්න...';

            const form = document.getElementById('admForm');
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());

            // Collect checkboxes
            const selectedClasses = [];
            form.querySelectorAll('input[name="classes"]:checked').forEach(cb => selectedClasses.push(cb.value));
            data.requestedClasses = selectedClasses.join(',');

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (result.status === 'OK') {
                    form.style.display = 'none';
                    document.getElementById('refNo').innerText = result.refNo;
                    document.getElementById('successCard').style.display = 'block';
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    alert('Error: ' + (result.message || 'Submission failed'));
                    btn.disabled = false;
                    btn.innerText = '✔ Submit Online Registration';
                }
            } catch (err) {
                alert('Connection error: ' + err.message);
                btn.disabled = false;
                btn.innerText = '✔ Submit Online Registration';
            }
        }
    </script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PARENT WEB PORTAL (/) — 24/7 with Student ID + Phone Verification
// ─────────────────────────────────────────────────────────────────────────────
function handleParentPortal(req, res, query) {
    const code = (query.get('code') || '').trim();
    const phone = (query.get('phone') || '').trim();

    if (!code || !phone) {
        return sendHtml(res, renderLoginPage(null, code, phone));
    }

    const students = readJson(STUDENTS_FILE, []);
    const normInput = normalizePhone(phone);

    const student = students.find(s => {
        const idMatch = String(s.studentCode || s.id) === code || String(s.id) === code;
        if (!idMatch) return false;

        const pMatch = (
            normInput === normalizePhone(s.phone) ||
            normInput === normalizePhone(s.whatsapp) ||
            normInput === normalizePhone(s.guardianPhone) ||
            normInput === normalizePhone(s.emergencyContact)
        );
        return pMatch;
    });

    if (!student) {
        return sendHtml(res, renderLoginPage('🔒 Security Verification Failed: Student ID and Registered Phone Number do not match our institute records. (ලියාපදිංචි කර ඇති දුරකථන අංකය ඇතුළත් කරන්න)', code, ''));
    }

    sendHtml(res, renderStudentDashboard(student));
}

function renderLoginPage(error, defaultCode, defaultPhone) {
    return `<!DOCTYPE html><html><head><meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>SAGE SMS — 24/7 Parent & Student Portal</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 20px; color: #1e293b; display: flex; justify-content: center; align-items: center; min-height: 90vh; }
        .card { background: white; border-radius: 20px; padding: 36px 30px; max-width: 440px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
        .header { text-align: center; margin-bottom: 24px; }
        .header h1 { font-size: 26px; margin: 0 0 6px; color: #7d1218; font-weight: 800; }
        .header p { font-size: 13.5px; color: #64748b; margin: 0; line-height: 1.4; }
        .input-group { margin-bottom: 18px; text-align: left; }
        label { display: block; font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px; }
        input { width: 100%; padding: 12px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 15px; box-sizing: border-box; outline: none; }
        input:focus { border-color: #b91c26; box-shadow: 0 0 0 3px rgba(185,28,38,0.15); }
        .hint { font-size: 11px; color: #64748b; margin-top: 5px; display: block; }
        button { width: 100%; padding: 14px; background: #7d1218; color: white; border: none; border-radius: 12px; font-size: 15.5px; font-weight: 700; cursor: pointer; margin-top: 10px; box-shadow: 0 4px 12px rgba(125,18,24,0.25); }
        button:hover { background: #9b1921; }
        .badge { display: inline-block; padding: 4px 12px; background: #fee2e2; color: #991b1b; border-radius: 20px; font-size: 12px; font-weight: 800; margin-bottom: 12px; }
        .link-register { display: block; text-align: center; background: #eff6ff; color: #2563eb; padding: 12px 14px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 13px; margin-bottom: 22px; border: 1.5px dashed #93c5fd; line-height: 1.4; }
        .privacy-note { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 18px; font-size: 11.5px; color: #475569; display: flex; align-items: center; gap: 8px; }
    </style></head><body>
    <div class='card'>
        <div class='header'>
            <span class='badge'>🔒 SECURE 24/7 PARENT PORTAL</span>
            <h1>SAGE SMS Portal</h1>
            <p>Enter Student ID and registered Mobile Number to securely view attendance, marks & fee receipts.</p>
        </div>

        <a href='/register' class='link-register'>
            ✨ New Student? Click Here to Register Online<br>
            <span style='font-size:11px; font-weight:normal; color:#475569;'>අලුතින් ලියාපදිංචි වීමට මෙතැන ක්ලික් කරන්න ➔</span>
        </a>

        ${error ? `<div style='background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 12px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 18px; line-height: 1.4;'>${error}</div>` : ''}

        <div class='privacy-note'>
            <span>🛡️</span><span><b>Privacy Protected:</b> Student records can only be accessed by matching the registered mobile phone number.</span>
        </div>

        <form method='GET' action='/'>
            <div class='input-group'>
                <label>1. Student ID / Code (ශිෂ්‍ය අංකය)</label>
                <input type='text' name='code' value='${defaultCode || ''}' placeholder='e.g. 10001 or 1001' required ${!defaultCode ? 'autofocus' : ''}>
                <span class='hint'>Found on the student's SAGE Smart PVC ID card</span>
            </div>
            <div class='input-group'>
                <label>2. Registered Mobile Number (දුරකථන අංකය)</label>
                <input type='tel' name='phone' value='${defaultPhone || ''}' placeholder='e.g. 0771234567' required ${defaultCode ? 'autofocus' : ''}>
                <span class='hint'>Student's or guardian's phone registered with the institute</span>
            </div>
            <button type='submit'>🔒 Secure Verification & Login →</button>
        </form>
        <div style='text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;'>SAGE Higher Education Institute &bull; Powered by SAGE SMS</div>
    </div>
    </body></html>`;
}

function renderStudentDashboard(s) {
    const attendPct = s.attendTotal > 0 ? Math.round((s.attendPresent * 100) / s.attendTotal) : 100;

    let examRows = '';
    if (s.exams && s.exams.length > 0) {
        s.exams.forEach(ex => {
            examRows += `<tr><td>${ex.date || '-'}</td><td><b>${ex.title || '-'}</b></td><td>${ex.subject || '-'}</td><td style='font-weight:700;'>${ex.marks || '-'}</td><td><span style='background:#dbeafe; color:#1e40af; padding:3px 8px; border-radius:6px; font-size:12px;'>${ex.grade || '-'}</span></td></tr>`;
        });
    } else {
        examRows = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No exam marks recorded yet.</td></tr>';
    }

    let payRows = '';
    if (s.payments && s.payments.length > 0) {
        s.payments.forEach(p => {
            payRows += `<tr><td>${p.date || '-'}</td><td><code style='color:#7d1218; font-weight:700;'>${p.receiptNo || '-'}</code></td><td>${p.className || 'Tuition Fee'}</td><td style='font-weight:700;'>LKR ${Number(p.amount || 0).toLocaleString()}</td><td><span style='background:#dcfce7; color:#166534; font-weight:700; padding:3px 8px; border-radius:6px; font-size:12px;'>VERIFIED</span></td></tr>`;
        });
    } else {
        payRows = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No fee payment history found.</td></tr>';
    }

    return `<!DOCTYPE html><html><head><meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>${s.fullName || 'Student'} — SAGE Portal</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
        .top-nav { background: #7d1218; color: white; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
        .top-nav h2 { margin: 0; font-size: 18px; font-weight: 800; }
        .top-nav a { color: #fecaca; text-decoration: none; font-size: 13px; font-weight: 600; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; }
        .container { max-width: 960px; margin: 24px auto; padding: 0 16px; }
        .hero-card { background: white; border-radius: 16px; padding: 24px; border: 1px solid #e2e8f0; margin-bottom: 20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 20px; }
        .stat-box { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; text-align: center; }
        .stat-box .val { font-size: 26px; font-weight: 800; margin: 6px 0; }
        .stat-box .lbl { font-size: 12px; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .table-card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 20px; margin-bottom: 20px; overflow-x: auto; }
        h3 { margin-top: 0; margin-bottom: 14px; font-size: 17px; color: #1e293b; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th { text-align: left; padding: 10px 12px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 700; }
        td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    </style></head><body>
    <div class='top-nav'>
        <h2>SAGE SMS 24/7 Parent Portal</h2>
        <a href='/'>🔒 Log Out</a>
    </div>
    <div class='container'>
        <div class='hero-card'>
            <div style='display:flex; justify-content:space-between; align-items:center;'>
                <div>
                    <h1 style='margin:0 0 6px; font-size:24px; color:#7d1218;'>${s.fullName || 'Student'}</h1>
                    <div style='color:#64748b; font-size:14px;'>Student Code: <b style='color:#0f172a;'>${s.studentCode || s.id}</b> &bull; Grade: <b style='color:#0f172a;'>${s.grade || '-'}</b> &bull; City: ${s.city || '-'}</div>
                </div>
                <div><span style='background:#dcfce7; color:#166534; font-weight:700; padding:6px 14px; border-radius:6px; font-size:13px;'>ACTIVE STUDENT</span></div>
            </div>
        </div>

        <div class='stats-grid'>
            <div class='stat-box'>
                <div class='lbl'>Attendance Rate</div>
                <div class='val' style='color:#166534;'>${attendPct}%</div>
                <div style='font-size:12px; color:#64748b;'>${s.attendPresent || 0} / ${s.attendTotal || 0} Days Present</div>
            </div>
            <div class='stat-box'>
                <div class='lbl'>Total Fees Paid</div>
                <div class='val' style='color:#1e40af;'>LKR ${Number(s.totalPaid || 0).toLocaleString()}</div>
                <div style='font-size:12px; color:#64748b;'>Verified Receipts</div>
            </div>
            <div class='stat-box'>
                <div class='lbl'>Registered Phone</div>
                <div class='val' style='font-size:18px; color:#334155; margin-top:12px;'>${s.phone || '-'}</div>
                <div style='font-size:12px; color:#64748b;'>Guardian: ${s.guardianName || 'Parent'}</div>
            </div>
        </div>

        <div class='table-card'>
            <h3>📊 Recent Exam Performance & Marks</h3>
            <table><thead><tr><th>Date</th><th>Exam / Paper</th><th>Subject</th><th>Marks</th><th>Grade</th></tr></thead><tbody>
                ${examRows}
            </tbody></table>
        </div>

        <div class='table-card'>
            <h3>💳 Fee Payments & Official Receipts</h3>
            <table><thead><tr><th>Date</th><th>Receipt No</th><th>Class</th><th>Amount</th><th>Status</th></tr></thead><tbody>
                ${payRows}
            </tbody></table>
        </div>

        <div style='text-align:center; padding: 20px; color:#94a3b8; font-size:13px;'>SAGE Higher Education Institute &bull; Powered by SAGE SMS</div>
    </div>
    </body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HTTP RESPONSE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
    });
    res.end(html);
}

function sendJson(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-SAGE-SECRET',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(JSON.stringify(data));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SERVER & REQUEST DISPATCHER
// ─────────────────────────────────────────────────────────────────────────────
async function handleRequest(req, res) {
    // Enable CORS for all requests
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, X-SAGE-SECRET',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        });
        res.end();
        return;
    }

    const host = req.headers.host || 'localhost';
    const parsed = new URL(req.url, `http://${host}`);
    const pathname = parsed.pathname;

    try {
        // 1. GET /register
        if (req.method === 'GET' && pathname === '/register') {
            return sendHtml(res, renderRegistrationPage());
        }

        // 2. GET / (Parent Portal)
        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            return handleParentPortal(req, res, parsed.searchParams);
        }

        // 3. POST /api/register (Online admission submission from phone)
        if (req.method === 'POST' && pathname === '/api/register') {
            const body = await getBody(req);
            if (!body.fullName || !body.phone || !body.grade) {
                return sendJson(res, { status: 'ERROR', message: 'Full Name, Phone, and Grade are required.' }, 400);
            }

            const admissions = readJson(ADMISSIONS_FILE, []);
            const refNo = 'SAGE-ADM-' + (1000 + (Date.now() % 100000));

            const newAdm = {
                id: admissions.length + 1,
                refNo: refNo,
                fullName: body.fullName.trim(),
                nameInitials: (body.nameInitials || '').trim(),
                gender: body.gender || 'Male',
                dob: body.dob || null,
                grade: body.grade || '',
                schoolName: (body.schoolName || '').trim(),
                phone: body.phone.trim(),
                whatsapp: (body.whatsapp || '').trim(),
                guardianName: (body.guardianName || '').trim(),
                guardianPhone: (body.guardianPhone || '').trim(),
                address: (body.address || '').trim(),
                requestedClasses: (body.requestedClasses || '').trim(),
                status: 'PENDING',
                submittedAt: new Date().toISOString()
            };

            admissions.push(newAdm);
            writeJson(ADMISSIONS_FILE, admissions);

            return sendJson(res, { status: 'OK', refNo: refNo, message: 'Registration submitted successfully' });
        }

        // 4. GET /api/admissions (SAGE-SMS Desktop pulls admissions)
        if (req.method === 'GET' && pathname === '/api/admissions') {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }

            const status = parsed.searchParams.get('status') || 'PENDING';
            const admissions = readJson(ADMISSIONS_FILE, []);
            const filtered = status === 'ALL' ? admissions : admissions.filter(a => a.status === status);
            return sendJson(res, { status: 'OK', admissions: filtered });
        }

        // 5. POST /api/admissions/:id/status or /api/admissions/status
        if (req.method === 'POST' && pathname.startsWith('/api/admissions/')) {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }

            const body = await getBody(req);
            const pathParts = pathname.split('/');
            const targetId = pathParts[3] || body.id || body.refNo;
            const { status, studentCode, notes } = body;

            const admissions = readJson(ADMISSIONS_FILE, []);
            const item = admissions.find(a => String(a.id) === String(targetId) || a.refNo === String(targetId));
            if (item) {
                item.status = status || item.status;
                if (studentCode) item.assignedStudentCode = studentCode;
                if (notes) item.notes = notes;
                writeJson(ADMISSIONS_FILE, admissions);
                return sendJson(res, { status: 'OK', message: 'Admission status updated' });
            }
            return sendJson(res, { status: 'ERROR', message: 'Admission not found' }, 404);
        }

        // 6. POST /api/sync-data (SAGE-SMS Desktop uploads active classes & students for 24/7 Parent Portal)
        if (req.method === 'POST' && pathname === '/api/sync-data') {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }

            const body = await getBody(req);
            const { classes, students } = body;
            if (Array.isArray(classes)) {
                writeJson(CLASSES_FILE, classes);
            }
            if (Array.isArray(students)) {
                writeJson(STUDENTS_FILE, students);
            }

            return sendJson(res, {
                status: 'OK',
                message: `Synced successfully! (${(classes || []).length} classes, ${(students || []).length} students)`
            });
        }

        // 404 Not Found
        sendJson(res, { status: 'ERROR', message: 'Endpoint not found' }, 404);
    } catch (err) {
        console.error('Server error:', err);
        sendJson(res, { status: 'ERROR', message: 'Internal server error: ' + err.message }, 500);
    }
}

module.exports = handleRequest;

if (require.main === module) {
    const server = http.createServer(handleRequest);
    server.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(` SAGE SMS 24/7 Cloud Portal running on port ${PORT}`);
        console.log(` - Online Registration: http://localhost:${PORT}/register`);
        console.log(` - Parent Portal:       http://localhost:${PORT}/`);
        console.log(`=======================================================`);
    });
}
