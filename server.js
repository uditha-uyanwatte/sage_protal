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

// Helper to read JSON (with fallback to bundled repository data)
function readJson(file, defaultValue = []) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        const baseName = path.basename(file);
        const bundled = path.join(__dirname, 'data', baseName);
        if (bundled !== file && fs.existsSync(bundled)) {
            return JSON.parse(fs.readFileSync(bundled, 'utf8'));
        }
    } catch (e) {
        console.error('Error reading ' + file, e);
    }
    return defaultValue;
}

// Helper to write JSON atomically (compact for faster serverless I/O)
function writeJson(file, data) {
    try {
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
        fs.renameSync(tmp, file);
    } catch (e) {
        console.error('Error writing ' + file, e);
    }
}

function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Normalize student code (strips prefixes and leading zeros)
function normalizeCode(c) {
    if (!c) return '';
    return String(c).trim().toUpperCase().replace(/^(STU-|SAGE-|SAGE)/i, '').replace(/^0+/, '');
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

                <div class="section-title">👨‍👩‍👧‍👦 Siblings Information / සහෝදර සහෝදරියන්ගේ විස්තර (Optional)</div>
                <div style="background:#f8fafc; border:1.5px solid #e2e8f0; border-radius:12px; padding:14px; margin-bottom:16px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; cursor:pointer;">
                        <input type="checkbox" id="hasSiblingsCheck" onchange="document.getElementById('siblingsBox').style.display = this.checked ? 'block' : 'none';" style="accent-color:#b91c1c; width:16px; height:16px;">
                        <span>Student has brother(s) or sister(s) studying at SAGE / Elsewhere<br>
                        <span style="font-size:11px; font-weight:normal; color:#64748b;">(ආයතනයේ හෝ වෙනත් පාසලක ඉගෙනුම ලබන සහෝදර සහෝදරියන් සිටී නම් මෙතැන ලකුණු කරන්න)</span></span>
                    </label>
                    <div id="siblingsBox" style="display:none; margin-top:12px; padding-top:12px; border-top:1px dashed #cbd5e1;">
                        <div class="row">
                            <div class="col form-group">
                                <label>Sibling Full Name (සහෝදර/සහෝදරියගේ නම)</label>
                                <input type="text" name="siblingName" placeholder="e.g. Nimesh Perera">
                            </div>
                            <div class="col form-group">
                                <label>Relationship (සම්බන්ධය)</label>
                                <select name="siblingRelation">
                                    <option value="Brother">Brother (සහෝදරයා)</option>
                                    <option value="Sister">Sister (සහෝදරිය)</option>
                                </select>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col form-group">
                                <label>Sibling's Student ID at SAGE <span class="hint">(දැනටමත් SAGE හි ඉගෙනුම ලබන්නේ නම් ශිෂ්‍ය අංකය)</span></label>
                                <input type="text" name="siblingStudentCode" placeholder="e.g. 10042 (For Sibling Discount)">
                            </div>
                            <div class="col form-group">
                                <label>Sibling's Date of Birth <span class="hint">(උපන් දිනය - DOB)</span></label>
                                <input type="date" name="siblingDob">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Sibling's Grade / School (ශ්‍රේණිය / පාසල)</label>
                            <input type="text" name="siblingGrade" placeholder="e.g. Grade 10 / Royal College">
                        </div>
                    </div>
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
    const rawCode = (query.get('code') || '').trim();
    const rawPhone = (query.get('phone') || '').trim();

    if (!rawCode || !rawPhone) {
        return sendHtml(res, renderLoginPage(null, rawCode, rawPhone));
    }

    const students = readJson(STUDENTS_FILE, []);
    const normCode = normalizeCode(rawCode);
    const normInputPhone = normalizePhone(rawPhone);

    const student = students.find(s => {
        // Match code against studentCode, regNumber, or internal id
        const sCode = normalizeCode(s.studentCode);
        const sReg = normalizeCode(s.regNumber);
        const sId = normalizeCode(s.id);

        const idMatch = (
            (sCode && (sCode === normCode || String(s.studentCode).trim() === rawCode)) ||
            (sReg && (sReg === normCode || String(s.regNumber).trim() === rawCode)) ||
            (sId && (sId === normCode || String(s.id).trim() === rawCode))
        );
        if (!idMatch) return false;

        // Match phone against phone, whatsapp, guardianPhone, emergencyContact
        const p1 = normalizePhone(s.phone);
        const p2 = normalizePhone(s.whatsapp);
        const p3 = normalizePhone(s.guardianPhone);
        const p4 = normalizePhone(s.emergencyContact);

        const pMatch = (
            (p1 && (normInputPhone === p1 || p1.endsWith(normInputPhone) || normInputPhone.endsWith(p1))) ||
            (p2 && (normInputPhone === p2 || p2.endsWith(normInputPhone) || normInputPhone.endsWith(p2))) ||
            (p3 && (normInputPhone === p3 || p3.endsWith(normInputPhone) || normInputPhone.endsWith(p3))) ||
            (p4 && (normInputPhone === p4 || p4.endsWith(normInputPhone) || normInputPhone.endsWith(p4)))
        );
        return pMatch;
    });

    if (!student) {
        return sendHtml(res, renderLoginPage('🔒 Security Verification Failed: Student ID and Registered Phone Number do not match our institute records. Please check the Student ID / Smart Card or enter the Guardian\'s registered mobile phone number. (ලියාපදිංචි කර ඇති දුරකථන අංකය නිවැරදිව ඇතුළත් කරන්න)', rawCode, ''));
    }

    // Feature #6: Find all siblings sharing this verified parent/guardian phone number
    const linkedSiblings = students.filter(other => {
        if (String(other.id) === String(student.id) && String(other.studentCode) === String(student.studentCode)) {
            return false;
        }
        const op = [other.phone, other.whatsapp, other.guardianPhone, other.emergencyContact]
            .map(normalizePhone)
            .filter(Boolean);
        return op.some(p => normInputPhone && (p === normInputPhone || p.endsWith(normInputPhone) || normInputPhone.endsWith(p)));
    });

    sendHtml(res, renderStudentDashboard(student, linkedSiblings, rawPhone));
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
                <input type='text' name='code' value='${escHtml(defaultCode || '')}' placeholder='e.g. 10001 or 1001' required ${!defaultCode ? 'autofocus' : ''}>
                <span class='hint'>Found on the student's SAGE Smart PVC ID card</span>
            </div>
            <div class='input-group'>
                <label>2. Registered Mobile Number (දුරකථන අංකය)</label>
                <input type='tel' name='phone' value='${escHtml(defaultPhone || '')}' placeholder='e.g. 0771234567' required ${defaultCode ? 'autofocus' : ''}>
                <span class='hint'>Student's or guardian's phone registered with the institute</span>
            </div>
            <button type='submit'>🔒 Secure Verification & Login →</button>
        </form>
        <div style='text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8;'>SAGE Higher Education Institute &bull; Powered by SAGE SMS</div>
    </div>
    </body></html>`;
}

function renderStudentDashboard(s, linkedSiblings = [], verifiedPhone = '') {
    const attendPct = s.attendTotal > 0 ? Math.round((s.attendPresent * 100) / s.attendTotal) : 100;
    const slNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const curMonth = s.currentMonth || slNow.toISOString().slice(0, 7);
    const qrPayload = s.qrToken || s.studentCode || String(s.id || '');
    const qrImgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=6&data=' + encodeURIComponent(qrPayload);
    const qrBigUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=340x340&margin=10&data=' + encodeURIComponent(qrPayload);

    // ── FEATURE #6: SIBLING SWITCHER BAR ─────────────────────────────────────
    let siblingSwitcherHtml = '';
    if (linkedSiblings && linkedSiblings.length > 0) {
        const encPhone = encodeURIComponent(verifiedPhone || s.phone || s.guardianPhone || '');
        const sibLinks = linkedSiblings.map(sib => {
            const sibCode = encodeURIComponent(sib.studentCode || sib.id);
            return `<a class='sib-pill' href='/?code=${sibCode}&phone=${encPhone}'>👤 ${escHtml(sib.fullName)} <span class='sib-sub'>(${escHtml(sib.grade || sib.studentCode)})</span></a>`;
        }).join('');
        siblingSwitcherHtml = `
        <div class='sib-bar no-print'>
            <div class='sib-title'>👨‍👩‍👧 Family Accounts — Switch Child (සහෝදර සහෝදරියන්):</div>
            <div class='sib-pills'>
                <span class='sib-pill active'>✔ ${escHtml(s.fullName)} <span class='sib-sub'>(${escHtml(s.grade || s.studentCode)})</span></span>
                ${sibLinks}
            </div>
        </div>`;
    }

    // Recorded siblings list from student_siblings table
    let recordedSibsHtml = '';
    if (s.siblings && s.siblings.length > 0) {
        const items = s.siblings.map(sb => {
            const extra = [sb.relationship, sb.grade, sb.dob ? 'DOB: ' + sb.dob : ''].filter(Boolean).join(' • ');
            return `<span class='fam-tag'>👨‍👩‍👧 <b>${escHtml(sb.fullName)}</b>${extra ? ' (' + escHtml(extra) + ')' : ''}</span>`;
        }).join('');
        recordedSibsHtml = `<div style='margin-top:10px; display:flex; flex-wrap:wrap; gap:6px;'>${items}</div>`;
    }

    // Collect receipts safely in an indexed array (immune to any HTML/JS quoting issues)
    const receiptsList = [];
    const addReceipt = (obj) => {
        const idx = receiptsList.length;
        receiptsList.push(obj);
        return idx;
    };

    // ── FEATURE #3: MONTHLY CLASS FEE STATUS (PAID / UNPAID + E-RECEIPT) ─────
    const enrolled = Array.isArray(s.enrolledClasses) ? s.enrolledClasses : [];
    let paidClassCount = 0;
    let unpaidBalance = 0;
    let feeStatusRows = '';

    if (enrolled.length > 0) {
        enrolled.forEach(cl => {
            const feeNum = Number(cl.fee || 0);
            if (cl.paidThisMonth) {
                paidClassCount++;
                const rIdx = addReceipt({
                    receiptNo: cl.paidReceiptNo || '-',
                    date: cl.paidDate || curMonth,
                    className: cl.className || 'Class Fee',
                    amount: Number(cl.paidAmount || feeNum),
                    method: cl.paidMethod || 'CASH'
                });
                feeStatusRows += `<tr>
                    <td><b>${escHtml(cl.className)}</b><div style='font-size:12px; color:#64748b;'>${escHtml(cl.teacherName || '-')}</div></td>
                    <td style='font-weight:700;'>LKR ${feeNum.toLocaleString()}</td>
                    <td><span class='pill-paid'>✅ PAID (ගෙවා ඇත)</span><div style='font-size:11px; color:#64748b; margin-top:3px;'>${escHtml(cl.paidDate || '')} &bull; ${escHtml(cl.paidReceiptNo || '')}</div></td>
                    <td><button class='btn-receipt' onclick='openReceipt(${rIdx})'>🧾 E-Receipt</button></td>
                </tr>`;
            } else {
                unpaidBalance += feeNum;
                feeStatusRows += `<tr>
                    <td><b>${escHtml(cl.className)}</b><div style='font-size:12px; color:#64748b;'>${escHtml(cl.teacherName || '-')}</div></td>
                    <td style='font-weight:700;'>LKR ${feeNum.toLocaleString()}</td>
                    <td><span class='pill-unpaid'>❌ UNPAID (ගෙවා නැත)</span><div style='font-size:11px; color:#b91c1c; margin-top:3px;'>Due for ${escHtml(curMonth)}</div></td>
                    <td><span style='font-size:12px; color:#94a3b8;'>Pay at Counter</span></td>
                </tr>`;
            }
        });
    } else {
        feeStatusRows = `<tr><td colspan='4' style='text-align:center; color:#94a3b8; padding:18px;'>No active class enrollments synced yet.</td></tr>`;
    }

    const feeSummaryBadge = enrolled.length === 0
        ? ''
        : (unpaidBalance <= 0
            ? `<span class='pill-paid'>✅ All ${enrolled.length} Classes Paid for ${escHtml(curMonth)}</span>`
            : `<span class='pill-unpaid'>Paid: ${paidClassCount}/${enrolled.length} &bull; Pending: LKR ${unpaidBalance.toLocaleString()}</span>`);

    // ── FEATURE #4: WEEKLY CLASS TIMETABLE & HALLS ───────────────────────────
    const dayOrder = { MONDAY: 1, MON: 1, TUESDAY: 2, TUE: 2, WEDNESDAY: 3, WED: 3, THURSDAY: 4, THU: 4, FRIDAY: 5, FRI: 5, SATURDAY: 6, SAT: 6, SUNDAY: 7, SUN: 7 };
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const todayName = dayNames[slNow.getUTCDay()];
    const todayShort = todayName.slice(0, 3);

    const sortedTimetable = [...enrolled].sort((a, b) => {
        const da = dayOrder[(a.dayOfWeek || '').trim().toUpperCase()] || 99;
        const db = dayOrder[(b.dayOfWeek || '').trim().toUpperCase()] || 99;
        if (da !== db) return da - db;
        return String(a.startTime || '').localeCompare(String(b.startTime || ''));
    });

    let timetableRows = '';
    if (sortedTimetable.length > 0) {
        sortedTimetable.forEach(cl => {
            const dUpper = (cl.dayOfWeek || '').trim().toUpperCase();
            const isToday = dUpper && (dUpper === todayName || dUpper === todayShort);
            const timeStr = (cl.startTime || '') + (cl.endTime ? ' – ' + cl.endTime : '');
            timetableRows += `<tr style='${isToday ? 'background:#fef2f2;' : ''}'>
                <td>
                    <span class='day-badge ${isToday ? 'day-today' : ''}'>${escHtml(cl.dayOfWeek || 'TBA')}</span>
                    ${isToday ? "<span class='today-dot'>TODAY</span>" : ''}
                </td>
                <td style='font-weight:700; white-space:nowrap;'>${escHtml(timeStr || 'TBA')}</td>
                <td><b>${escHtml(cl.className)}</b>${cl.subject ? `<div style='font-size:12px; color:#64748b;'>${escHtml(cl.subject)}</div>` : ''}</td>
                <td>${escHtml(cl.teacherName || '-')}</td>
                <td><span class='hall-badge'>🏛️ ${escHtml(cl.hallName || 'TBA')}</span></td>
            </tr>`;
        });
    } else {
        timetableRows = `<tr><td colspan='5' style='text-align:center; color:#94a3b8; padding:18px;'>No weekly class timetable assigned yet.</td></tr>`;
    }

    // ── RECENT EXAMS ─────────────────────────────────────────────────────────
    let examRows = '';
    if (s.exams && s.exams.length > 0) {
        s.exams.forEach(ex => {
            examRows += `<tr><td>${escHtml(ex.date || '-')}</td><td><b>${escHtml(ex.title || '-')}</b></td><td>${escHtml(ex.subject || '-')}</td><td style='font-weight:700;'>${escHtml(ex.marks || '-')}</td><td><span style='background:#dbeafe; color:#1e40af; padding:3px 8px; border-radius:6px; font-size:12px; font-weight:700;'>${escHtml(ex.grade || '-')}</span></td></tr>`;
        });
    } else {
        examRows = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:18px;">No exam marks recorded yet.</td></tr>';
    }

    // ── FEATURE #3 (PART B): PAYMENT HISTORY WITH 1-CLICK OFFICIAL E-RECEIPT ─
    let payRows = '';
    if (s.payments && s.payments.length > 0) {
        s.payments.forEach(p => {
            const rIdx = addReceipt({
                receiptNo: p.receiptNo || '-',
                date: p.date || '-',
                className: p.className || 'Tuition Fee',
                amount: Number(p.amount || 0),
                method: p.method || 'CASH'
            });
            payRows += `<tr>
                <td>${escHtml(p.date || '-')}</td>
                <td><code style='color:#7d1218; font-weight:700;'>${escHtml(p.receiptNo || '-')}</code></td>
                <td>${escHtml(p.className || 'Tuition Fee')}</td>
                <td style='font-weight:700;'>LKR ${Number(p.amount || 0).toLocaleString()}</td>
                <td><button class='btn-receipt' onclick='openReceipt(${rIdx})'>🧾 E-Receipt</button></td>
            </tr>`;
        });
    } else {
        payRows = '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:18px;">No fee payment history found.</td></tr>';
    }

    const studentMetaJson = JSON.stringify({
        fullName: s.fullName || 'Student',
        studentCode: s.studentCode || String(s.id || ''),
        grade: s.grade || '-',
        schoolName: s.schoolName || '-',
        phone: s.phone || s.guardianPhone || '-'
    }).replace(/</g, '\\u003c');
    const receiptsJson = JSON.stringify(receiptsList).replace(/</g, '\\u003c');

    return `<!DOCTYPE html><html><head><meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <title>${escHtml(s.fullName || 'Student')} — SAGE 24/7 Portal</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; margin: 0; padding: 0; color: #0f172a; }
        .top-nav { background: linear-gradient(135deg, #7d1218 0%, #580b10 100%); color: white; padding: 14px 22px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.18); position: sticky; top: 0; z-index: 50; }
        .top-nav h2 { margin: 0; font-size: 17px; font-weight: 800; letter-spacing: 0.2px; }
        .top-nav a { color: #fecaca; text-decoration: none; font-size: 13px; font-weight: 700; padding: 6px 12px; border: 1px solid rgba(255,255,255,0.28); border-radius: 8px; }
        .top-nav a:hover { background: rgba(255,255,255,0.12); }
        .container { max-width: 1020px; margin: 20px auto; padding: 0 14px 30px; }

        /* Feature #6: Sibling Switcher Bar */
        .sib-bar { background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%); border: 1.5px solid #bfdbfe; border-radius: 14px; padding: 12px 16px; margin-bottom: 16px; }
        .sib-title { font-size: 12.5px; font-weight: 800; color: #1e40af; margin-bottom: 8px; }
        .sib-pills { display: flex; flex-wrap: wrap; gap: 8px; }
        .sib-pill { display: inline-flex; align-items: center; gap: 5px; padding: 7px 13px; border-radius: 999px; font-size: 13px; font-weight: 700; text-decoration: none; background: white; color: #1e293b; border: 1.5px solid #cbd5e1; transition: all 0.15s; }
        .sib-pill:hover { border-color: #7d1218; color: #7d1218; transform: translateY(-1px); }
        .sib-pill.active { background: #7d1218; color: white; border-color: #7d1218; }
        .sib-pill .sib-sub { font-weight: 500; font-size: 11.5px; opacity: 0.85; }
        .fam-tag { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 10px; font-size: 12px; color: #334155; }

        /* Hero + Feature #2 Digital ID Grid */
        .hero-grid { display: grid; grid-template-columns: 1.25fr 0.95fr; gap: 16px; margin-bottom: 18px; }
        @media (max-width: 780px) { .hero-grid { grid-template-columns: 1fr; } }

        .hero-card { background: white; border-radius: 16px; padding: 22px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(15,23,42,0.04); }
        .stats-mini { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 16px; }
        .stat-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 8px; text-align: center; }
        .stat-box .lbl { font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; }
        .stat-box .val { font-size: 20px; font-weight: 800; margin: 4px 0 2px; }
        .stat-box .sub { font-size: 11px; color: #64748b; }

        /* Feature #2: Official Digital PVC ID Card */
        .id-card { background: linear-gradient(135deg, #7d1218 0%, #4c080d 100%); color: white; border-radius: 16px; padding: 18px; position: relative; overflow: hidden; box-shadow: 0 10px 24px -6px rgba(125,18,24,0.35); border: 1px solid #991b1b; display: flex; flex-direction: column; justify-content: space-between; }
        .id-top { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.18); padding-bottom: 10px; margin-bottom: 12px; }
        .id-brand { font-size: 11px; font-weight: 800; letter-spacing: 0.8px; color: #fde68a; }
        .id-chip { background: rgba(255,255,255,0.16); padding: 3px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
        .id-body { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
        .id-info h4 { margin: 0 0 4px; font-size: 17px; font-weight: 800; color: white; }
        .id-meta { font-size: 12px; color: #fecaca; line-height: 1.55; }
        .id-meta b { color: white; }
        .id-qr-box { background: white; padding: 7px; border-radius: 10px; text-align: center; flex-shrink: 0; cursor: pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
        .id-qr-box img { width: 92px; height: 92px; display: block; border-radius: 4px; }
        .id-qr-code { font-family: monospace; font-size: 10px; font-weight: 800; color: #0f172a; margin-top: 3px; }
        .id-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.22); font-size: 11px; color: #fca5a5; }
        .btn-qr-big { background: #fde68a; color: #78350f; border: none; border-radius: 8px; padding: 6px 11px; font-size: 11.5px; font-weight: 800; cursor: pointer; }
        .btn-qr-big:hover { background: #fcd34d; }

        /* Cards & Tables */
        .table-card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 18px 20px; margin-bottom: 16px; overflow-x: auto; box-shadow: 0 2px 6px rgba(15,23,42,0.03); }
        .card-head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        h3 { margin: 0; font-size: 16.5px; color: #0f172a; font-weight: 800; }
        table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 520px; }
        th { text-align: left; padding: 9px 10px; background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569; font-weight: 700; font-size: 12px; text-transform: uppercase; }
        td { padding: 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }

        /* Badges & Buttons */
        .pill-paid { display: inline-block; background: #dcfce7; color: #166534; font-weight: 800; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; }
        .pill-unpaid { display: inline-block; background: #fee2e2; color: #b91c1c; font-weight: 800; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; }
        .day-badge { display: inline-block; background: #f1f5f9; color: #1e293b; font-weight: 800; padding: 4px 9px; border-radius: 7px; font-size: 11.5px; }
        .day-today { background: #7d1218; color: white; }
        .today-dot { display: inline-block; background: #ef4444; color: white; font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
        .hall-badge { display: inline-block; background: #eff6ff; color: #1e40af; font-weight: 700; padding: 4px 9px; border-radius: 7px; font-size: 12px; }
        .btn-receipt { background: #7d1218; color: white; border: none; border-radius: 7px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
        .btn-receipt:hover { background: #991b1b; }

        /* Modals (Enlarge QR + Official E-Receipt) */
        .modal-bg { display: none; position: fixed; inset: 0; background: rgba(15,23,42,0.68); z-index: 200; align-items: center; justify-content: center; padding: 16px; }
        .modal-bg.open { display: flex; }
        .modal-box { background: white; border-radius: 18px; max-width: 440px; width: 100%; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.35); position: relative; }
        .receipt-header { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 14px; margin-bottom: 14px; }
        .receipt-header h2 { margin: 0 0 4px; color: #7d1218; font-size: 19px; }
        .receipt-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13.5px; border-bottom: 1px solid #f1f5f9; }
        .receipt-row span:first-child { color: #64748b; font-weight: 600; }
        .receipt-row span:last-child { color: #0f172a; font-weight: 700; text-align: right; }
        .receipt-total { background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 10px; padding: 12px 14px; margin: 14px 0; display: flex; justify-content: space-between; align-items: center; }
        .receipt-total .amt { font-size: 21px; font-weight: 900; color: #166534; }
        .modal-actions { display: flex; gap: 8px; margin-top: 14px; }
        .modal-actions button { flex: 1; padding: 11px; border-radius: 10px; font-weight: 700; font-size: 13.5px; cursor: pointer; border: none; }
        .btn-print { background: #166534; color: white; }
        .btn-close { background: #e2e8f0; color: #334155; }

        @media print {
            body * { visibility: hidden !important; }
            #receiptModal.open, #receiptModal.open * { visibility: visible !important; }
            #receiptModal.open { position: absolute !important; inset: 0 !important; background: white !important; display: block !important; padding: 0 !important; }
            #receiptModal .modal-box { box-shadow: none !important; border: 1px solid #cbd5e1 !important; margin: 0 auto !important; }
            .no-print { display: none !important; }
        }
    </style></head><body>
    <div class='top-nav no-print'>
        <h2>🎓 SAGE 24/7 Parent & Student Portal</h2>
        <a href='/'>🔒 Log Out</a>
    </div>

    <div class='container'>
        ${siblingSwitcherHtml}

        <!-- HERO PROFILE + FEATURE #2 DIGITAL STUDENT ID CARD -->
        <div class='hero-grid'>
            <div class='hero-card'>
                <div>
                    <div style='display:flex; justify-content:space-between; align-items:flex-start; gap:10px;'>
                        <div>
                            <h1 style='margin:0 0 5px; font-size:22px; color:#7d1218;'>${escHtml(s.fullName || 'Student')}</h1>
                            <div style='color:#64748b; font-size:13px; line-height:1.5;'>
                                ID: <b style='color:#0f172a;'>${escHtml(s.studentCode || s.id)}</b> &bull;
                                Grade: <b style='color:#0f172a;'>${escHtml(s.grade || '-')}</b>
                                ${s.schoolName ? ` &bull; School: <b style='color:#0f172a;'>${escHtml(s.schoolName)}</b>` : ''}
                            </div>
                            <div style='color:#64748b; font-size:12.5px; margin-top:3px;'>
                                📞 ${escHtml(s.phone || s.guardianPhone || '-')} &bull; Guardian: ${escHtml(s.guardianName || 'Parent')}
                            </div>
                        </div>
                        <span class='pill-paid'>ACTIVE</span>
                    </div>
                    ${recordedSibsHtml}
                </div>

                <div class='stats-mini'>
                    <div class='stat-box'>
                        <div class='lbl'>Attendance</div>
                        <div class='val' style='color:#166534;'>${attendPct}%</div>
                        <div class='sub'>${s.attendPresent || 0} / ${s.attendTotal || 0} Days</div>
                    </div>
                    <div class='stat-box'>
                        <div class='lbl'>Total Paid</div>
                        <div class='val' style='color:#1e40af; font-size:16px; margin-top:8px;'>LKR ${Number(s.totalPaid || 0).toLocaleString()}</div>
                        <div class='sub'>Verified</div>
                    </div>
                    <div class='stat-box'>
                        <div class='lbl'>Classes</div>
                        <div class='val' style='color:#7d1218;'>${enrolled.length}</div>
                        <div class='sub'>${paidClassCount} Paid (${escHtml(curMonth)})</div>
                    </div>
                </div>
            </div>

            <!-- FEATURE #2: DIGITAL STUDENT ID CARD WITH LIVE QR CODE -->
            <div class='id-card'>
                <div class='id-top'>
                    <span class='id-brand'>🪪 SAGE DIGITAL STUDENT ID</span>
                    <span class='id-chip'>GATE QR READY</span>
                </div>
                <div class='id-body'>
                    <div class='id-info'>
                        <h4>${escHtml(s.fullName || 'Student')}</h4>
                        <div class='id-meta'>
                            Code: <b>${escHtml(s.studentCode || s.id)}</b><br>
                            Grade: <b>${escHtml(s.grade || '-')}</b><br>
                            City: <b>${escHtml(s.city || '-')}</b><br>
                            Status: <b style='color:#86efac;'>● ACTIVE</b>
                        </div>
                    </div>
                    <div class='id-qr-box' onclick='openQrModal()' title='Tap to enlarge QR for Gate Scanner'>
                        <img src='${qrImgUrl}' alt='Student QR Code'>
                        <div class='id-qr-code'>${escHtml(s.studentCode || s.id)}</div>
                    </div>
                </div>
                <div class='id-footer'>
                    <span>Show at entrance gate if card is forgotten</span>
                    <button class='btn-qr-big no-print' onclick='openQrModal()'>🔍 Enlarge QR</button>
                </div>
            </div>
        </div>

        <!-- FEATURE #3: THIS MONTH CLASS FEE STATUS -->
        <div class='table-card'>
            <div class='card-head'>
                <h3>💰 Monthly Class Fee Status — ${escHtml(curMonth)} (මෙම මාසයේ ගාස්තු තත්ත්වය)</h3>
                ${feeSummaryBadge}
            </div>
            <table>
                <thead><tr><th>Class & Teacher</th><th>Monthly Fee</th><th>Status (${escHtml(curMonth)})</th><th>Receipt</th></tr></thead>
                <tbody>${feeStatusRows}</tbody>
            </table>
        </div>

        <!-- FEATURE #4: WEEKLY CLASS TIMETABLE & HALLS -->
        <div class='table-card'>
            <div class='card-head'>
                <h3>📅 Weekly Class Timetable & Halls (සතියේ පන්ති කාලසටහන)</h3>
                <span style='font-size:12px; color:#64748b; font-weight:600;'>Today: ${todayName}</span>
            </div>
            <table>
                <thead><tr><th>Day</th><th>Time</th><th>Class / Subject</th><th>Teacher</th><th>Hall / Room</th></tr></thead>
                <tbody>${timetableRows}</tbody>
            </table>
        </div>

        <!-- RECENT EXAM PERFORMANCE -->
        <div class='table-card'>
            <div class='card-head'><h3>📊 Recent Exam Performance & Marks</h3></div>
            <table>
                <thead><tr><th>Date</th><th>Exam / Paper</th><th>Subject</th><th>Marks</th><th>Grade</th></tr></thead>
                <tbody>${examRows}</tbody>
            </table>
        </div>

        <!-- FEATURE #3 (PART B): PAYMENT HISTORY & PRINTABLE E-RECEIPTS -->
        <div class='table-card'>
            <div class='card-head'><h3>💳 Fee Payments & Official E-Receipts</h3></div>
            <table>
                <thead><tr><th>Date</th><th>Receipt No</th><th>Class / Item</th><th>Amount</th><th>E-Receipt</th></tr></thead>
                <tbody>${payRows}</tbody>
            </table>
        </div>

        <div style='text-align:center; padding: 16px; color:#94a3b8; font-size:12.5px;'>
            SAGE Higher Education Institute &bull; Hotline: +94 76 796 2250 &bull; Powered by SAGE SMS 24/7 Cloud
        </div>
    </div>

    <!-- ENLARGED QR GATE SCANNER MODAL (FEATURE #2) -->
    <div id='qrModal' class='modal-bg no-print' onclick='if(event.target===this) closeQrModal()'>
        <div class='modal-box' style='text-align:center;'>
            <div style='font-size:12px; font-weight:800; color:#7d1218; letter-spacing:1px; margin-bottom:4px;'>SAGE ENTRANCE GATE SCANNER PASS</div>
            <h3 style='margin:0 0 12px; font-size:20px;'>${escHtml(s.fullName || 'Student')}</h3>
            <div style='background:white; border:2px solid #e2e8f0; border-radius:14px; padding:14px; display:inline-block;'>
                <img src='${qrBigUrl}' style='width:250px; height:250px; display:block;' alt='Large Student QR'>
            </div>
            <div style='font-family:monospace; font-size:18px; font-weight:900; color:#0f172a; margin-top:10px;'>${escHtml(s.studentCode || s.id)}</div>
            <div style='font-size:12.5px; color:#64748b; margin-top:4px;'>${escHtml(s.grade || '')} &bull; Hold phone screen steady toward the attendance QR scanner</div>
            <div class='modal-actions'>
                <button class='btn-close' onclick='closeQrModal()'>✖ Close Pass</button>
            </div>
        </div>
    </div>

    <!-- OFFICIAL PRINTABLE E-RECEIPT MODAL (FEATURE #3) -->
    <div id='receiptModal' class='modal-bg' onclick='if(event.target===this) closeReceipt()'>
        <div class='modal-box'>
            <div class='receipt-header'>
                <h2>🎓 SAGE Higher Education Institute</h2>
                <div style='font-size:12px; color:#64748b;'>Official Digital Fee Payment E-Receipt &bull; +94 76 796 2250</div>
                <div style='margin-top:8px;'><span class='pill-paid'>✅ VERIFIED OFFICIAL RECEIPT</span></div>
            </div>
            <div class='receipt-row'><span>Receipt No</span><span id='rcNo' style='color:#7d1218; font-family:monospace;'>-</span></div>
            <div class='receipt-row'><span>Date Paid</span><span id='rcDate'>-</span></div>
            <div class='receipt-row'><span>Student Name</span><span id='rcStu'>-</span></div>
            <div class='receipt-row'><span>Student ID / Grade</span><span id='rcCode'>-</span></div>
            <div class='receipt-row'><span>Class / Description</span><span id='rcClass'>-</span></div>
            <div class='receipt-row'><span>Payment Method</span><span id='rcMethod'>CASH</span></div>
            <div class='receipt-total'>
                <span style='font-weight:800; color:#166534;'>AMOUNT PAID</span>
                <span class='amt' id='rcAmt'>LKR 0.00</span>
            </div>
            <div style='text-align:center; font-size:11.5px; color:#64748b;'>This is a computer-generated verified receipt from SAGE SMS Cloud Portal. No signature required.</div>
            <div class='modal-actions no-print'>
                <button class='btn-print' onclick='window.print()'>🖨 Print / Save PDF</button>
                <button class='btn-close' onclick='closeReceipt()'>✖ Close</button>
            </div>
        </div>
    </div>

    <script>
        const STU_META = ${studentMetaJson};
        const RECEIPTS = ${receiptsJson};
        function openQrModal() { document.getElementById('qrModal').classList.add('open'); }
        function closeQrModal() { document.getElementById('qrModal').classList.remove('open'); }
        function openReceipt(idx) {
            const r = RECEIPTS[idx];
            if (!r) return;
            document.getElementById('rcNo').textContent = r.receiptNo || '-';
            document.getElementById('rcDate').textContent = r.date || '-';
            document.getElementById('rcStu').textContent = STU_META.fullName;
            document.getElementById('rcCode').textContent = STU_META.studentCode + ' • ' + STU_META.grade;
            document.getElementById('rcClass').textContent = r.className || 'Tuition Fee';
            document.getElementById('rcMethod').textContent = r.method || 'CASH';
            document.getElementById('rcAmt').textContent = 'LKR ' + Number(r.amount || 0).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
            document.getElementById('receiptModal').classList.add('open');
        }
        function closeReceipt() { document.getElementById('receiptModal').classList.remove('open'); }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') { closeQrModal(); closeReceipt(); }
        });
    </script>
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

            let siblingInfo = null;
            if (body.siblingName && body.siblingName.trim()) {
                const sName = body.siblingName.trim();
                const sRel = body.siblingRelation || 'Sibling';
                const sCode = (body.siblingStudentCode || '').trim();
                const sDob = (body.siblingDob || '').trim();
                const sGrade = (body.siblingGrade || '').trim();
                siblingInfo = `${sName} (${sRel}${sCode ? ', SAGE ID: ' + sCode : ''}${sDob ? ', DOB: ' + sDob : ''}${sGrade ? ', ' + sGrade : ''})`;
            }

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
                siblingInfo: siblingInfo,
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
