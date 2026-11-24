const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET || 'SAGE_CLOUD_SECRET_2026';
const DEFAULT_STAFF_PIN = process.env.STAFF_PIN || '2026';

// Ensure data folder exists
const DATA_DIR = process.env.VERCEL ? '/tmp/sage_data' : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const ADMISSIONS_FILE = path.join(DATA_DIR, 'admissions.json');
const STUDENTS_FILE = path.join(DATA_DIR, 'students.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'mobile_attendance.json');
const CONFIG_FILE = path.join(DATA_DIR, 'portal_config.json');

function getStaffPin() {
    const cfg = readJson(CONFIG_FILE, {});
    if (cfg && cfg.staffPin && String(cfg.staffPin).trim()) {
        return String(cfg.staffPin).trim();
    }
    return DEFAULT_STAFF_PIN;
}

function getSlNow() {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
}

function getSlDateStr() {
    return getSlNow().toISOString().slice(0, 10);
}

function isAuthorizedStaff(req, parsed, body) {
    const pin = String(
        req.headers['x-staff-pin'] ||
        req.headers['x-sage-secret'] ||
        (parsed && (parsed.searchParams.get('pin') || parsed.searchParams.get('key'))) ||
        (body && (body.pin || body.key)) ||
        ''
    ).trim();
    if (!pin) return false;
    return pin === getStaffPin() || pin === API_SECRET;
}

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
// 2B. STAFF MOBILE QR ATTENDANCE SCANNER (/staff-scan)
// ─────────────────────────────────────────────────────────────────────────────
function renderStaffScannerPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="theme-color" content="#7d1218">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>SAGE Staff Mobile QR Attendance Scanner</title>
    <script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; min-height: 100vh; padding-bottom: 36px; }
        .top-bar { background: linear-gradient(135deg, #7d1218 0%, #4c080d 100%); padding: 13px 16px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 60; box-shadow: 0 4px 16px rgba(0,0,0,0.35); }
        .top-bar h1 { font-size: 16px; font-weight: 800; letter-spacing: 0.2px; display: flex; align-items: center; gap: 7px; }
        .top-actions { display: flex; gap: 6px; align-items: center; }
        .btn-top { background: rgba(255,255,255,0.16); color: #fff; border: 1px solid rgba(255,255,255,0.28); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .btn-top:active { background: rgba(255,255,255,0.28); }
        .wrap { max-width: 540px; margin: 0 auto; padding: 14px; }

        /* Login Gate */
        .login-card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 28px 22px; margin-top: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.4); }
        .login-badge { display: inline-block; background: rgba(185,28,28,0.25); color: #fca5a5; border: 1px solid rgba(248,113,113,0.35); padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; margin-bottom: 10px; }
        .login-card h2 { font-size: 22px; font-weight: 800; margin-bottom: 6px; }
        .login-card p { font-size: 13px; color: #94a3b8; margin-bottom: 20px; line-height: 1.45; }
        .field { margin-bottom: 14px; }
        .field label { display: block; font-size: 12.5px; font-weight: 700; color: #cbd5e1; margin-bottom: 6px; }
        .field input, .field select { width: 100%; padding: 12px 14px; background: #0f172a; border: 1.5px solid #334155; border-radius: 12px; color: #fff; font-size: 15px; outline: none; }
        .field input:focus, .field select:focus { border-color: #f87171; box-shadow: 0 0 0 3px rgba(248,113,113,0.2); }
        .btn-primary { width: 100%; padding: 14px; background: linear-gradient(135deg, #b91c1c, #7d1218); color: #fff; border: none; border-radius: 12px; font-size: 15.5px; font-weight: 800; cursor: pointer; box-shadow: 0 6px 18px rgba(185,28,28,0.35); }
        .btn-primary:disabled { opacity: 0.6; }
        .err-box { background: rgba(220,38,38,0.18); border: 1px solid #ef4444; color: #fecaca; border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 14px; display: none; }

        /* Scanner App */
        #scannerApp { display: none; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 14px; margin-bottom: 12px; }
        .card-label { font-size: 11.5px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }

        .class-select { width: 100%; padding: 11px 12px; background: #0f172a; color: #f8fafc; border: 1.5px solid #475569; border-radius: 10px; font-size: 14px; font-weight: 700; outline: none; }
        .class-select:focus { border-color: #f87171; }

        #readerWrap { background: #020617; border-radius: 14px; overflow: hidden; border: 2px solid #334155; min-height: 220px; position: relative; display: flex; align-items: center; justify-content: center; }
        #reader { width: 100%; }
        #reader video { border-radius: 12px; }
        .cam-placeholder { text-align: center; padding: 28px 16px; color: #94a3b8; font-size: 13px; }
        .cam-controls { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 7px; margin-top: 10px; }
        .btn-cam { padding: 10px 8px; border-radius: 10px; border: 1px solid #475569; background: #0f172a; color: #f8fafc; font-size: 12.5px; font-weight: 700; cursor: pointer; text-align: center; }
        .btn-cam.active { background: #15803d; border-color: #22c55e; color: #fff; }
        .btn-cam.stop { background: #b91c1c; border-color: #ef4444; color: #fff; }

        .manual-row { display: flex; gap: 8px; margin-top: 10px; }
        .manual-row input { flex: 1; padding: 11px 12px; background: #0f172a; border: 1.5px solid #475569; border-radius: 10px; color: #fff; font-size: 14.5px; font-weight: 700; outline: none; }
        .manual-row input:focus { border-color: #38bdf8; }
        .manual-row button { padding: 0 16px; background: #2563eb; color: #fff; border: none; border-radius: 10px; font-weight: 800; font-size: 14px; cursor: pointer; white-space: nowrap; }

        /* Instant Scan Result Banner */
        #resultBox { display: none; border-radius: 16px; padding: 16px; margin-bottom: 12px; border: 2px solid transparent; animation: pop 0.18s ease-out; }
        @keyframes pop { from { transform: scale(0.96); opacity: 0.6; } to { transform: scale(1); opacity: 1; } }
        .res-paid { background: linear-gradient(135deg, #064e3b, #065f46); border-color: #34d399 !important; }
        .res-dayfee { background: linear-gradient(135deg, #0c4a6e, #0369a1); border-color: #38bdf8 !important; }
        .res-freecard { background: linear-gradient(135deg, #312e81, #4338ca); border-color: #818cf8 !important; }
        .res-unpaid { background: linear-gradient(135deg, #7f1d1d, #991b1b); border-color: #f87171 !important; }
        .res-warn { background: linear-gradient(135deg, #78350f, #92400e); border-color: #fbbf24 !important; }
        .res-notenr { background: linear-gradient(135deg, #4c1d95, #5b21b6); border-color: #a78bfa !important; }
        .res-status { font-size: 13px; font-weight: 900; letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center; gap: 6px; }
        .res-name { font-size: 20px; font-weight: 900; color: #fff; margin-bottom: 3px; }
        .res-meta { font-size: 13px; color: rgba(255,255,255,0.9); line-height: 1.5; }
        .btn-force { margin-top: 10px; width: 100%; padding: 10px; background: #fde68a; color: #78350f; border: none; border-radius: 10px; font-weight: 800; font-size: 13.5px; cursor: pointer; }

        /* Gate Fee Action Buttons on Scan Banner */
        .fee-mode-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #334155; flex-wrap: wrap; }
        .fee-mode-toggle { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; color: #e2e8f0; cursor: pointer; }
        .fee-mode-toggle input { width: 17px; height: 17px; accent-color: #0ea5e9; }
        .dayfee-box { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #94a3b8; }
        .dayfee-box input { width: 76px; padding: 6px 8px; background: #0f172a; border: 1.5px solid #475569; border-radius: 8px; color: #38bdf8; font-weight: 800; font-size: 13px; text-align: center; outline: none; }
        .fee-actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 11px; }
        .btn-fa { padding: 10px 8px; border: 1.5px solid rgba(255,255,255,0.28); border-radius: 10px; font-size: 12.5px; font-weight: 800; cursor: pointer; color: #fff; text-align: center; }
        .btn-fa-monthly { background: #16a34a; border-color: #4ade80; }
        .btn-fa-day { background: #0284c7; border-color: #38bdf8; }
        .btn-fa-free { background: #4f46e5; border-color: #818cf8; }
        .btn-fa-unpaid { background: rgba(15,23,42,0.55); border-color: #fca5a5; color: #fecaca; }
        .btn-fa.selected { box-shadow: 0 0 0 2.5px #fde047; }

        /* Live Cash in Hand Banner */
        .cash-bar { background: linear-gradient(135deg, #064e3b, #0f172a); border: 1.5px solid #10b981; border-radius: 14px; padding: 11px 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .cash-left { font-size: 11.5px; color: #a7f3d0; font-weight: 700; line-height: 1.4; }
        .cash-amt { font-size: 20px; font-weight: 900; color: #4ade80; white-space: nowrap; }

        /* Stats Strip */
        .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
        .stat { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 10px 6px; text-align: center; }
        .stat .num { font-size: 20px; font-weight: 900; }
        .stat .lbl { font-size: 10px; color: #94a3b8; font-weight: 700; text-transform: uppercase; margin-top: 2px; }

        /* Cloud Sync Bar */
        .sync-bar { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 10px 12px; margin-bottom: 12px; }
        .sync-txt { font-size: 12.5px; color: #cbd5e1; line-height: 1.35; }
        .btn-sync { background: #0ea5e9; color: #fff; border: none; border-radius: 9px; padding: 8px 12px; font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
        .btn-sync:disabled { opacity: 0.5; }

        /* Scan Log */
        .log-list { max-height: 330px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; }
        .log-item { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 9px 11px; }
        .log-left { min-width: 0; }
        .log-name { font-size: 13.5px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .log-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
        .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 800; white-space: nowrap; }
        .pill-g { background: #14532d; color: #86efac; }
        .pill-c { background: #0c4a6e; color: #7dd3fc; }
        .pill-p { background: #312e81; color: #c7d2fe; }
        .pill-r { background: #7f1d1d; color: #fca5a5; }
        .pill-b { background: #1e3a8a; color: #93c5fd; }
        .btn-edit-fee { background: #1e293b; border: 1px solid #475569; color: #fde68a; font-size: 11px; font-weight: 800; border-radius: 7px; padding: 4px 7px; cursor: pointer; }
        .btn-del { background: transparent; border: none; color: #64748b; font-size: 15px; cursor: pointer; padding: 4px 6px; }

        /* Per-Student Gate Fee Selection Modal (When Day Fee tick is OFF) */
        .fee-modal-bg { display: none; position: fixed; inset: 0; background: rgba(2,6,23,0.82); z-index: 200; align-items: flex-end; justify-content: center; padding: 12px; }
        @media (min-width: 520px) { .fee-modal-bg { align-items: center; } }
        .fee-modal-bg.open { display: flex; }
        .fee-modal { background: #1e293b; border: 1.5px solid #475569; border-radius: 20px; width: 100%; max-width: 440px; padding: 18px 16px 16px; box-shadow: 0 25px 60px rgba(0,0,0,0.65); animation: pop 0.16s ease-out; }
        .fm-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 12px; }
        .fm-stu { font-size: 19px; font-weight: 900; color: #fff; }
        .fm-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
        .fm-status { border-radius: 12px; padding: 10px 12px; font-size: 12.5px; font-weight: 800; margin: 10px 0; line-height: 1.4; }
        .fm-st-paid { background: #064e3b; border: 1.5px solid #34d399; color: #a7f3d0; }
        .fm-st-unpaid { background: #7f1d1d; border: 1.5px solid #f87171; color: #fecaca; }
        .fm-amt-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; }
        .fm-amt-row label { font-size: 12px; font-weight: 700; color: #cbd5e1; }
        .fm-amt-row input { width: 115px; padding: 7px 10px; background: #1e293b; border: 1.5px solid #4ade80; border-radius: 8px; color: #4ade80; font-size: 15px; font-weight: 900; text-align: right; outline: none; }
        .fm-btn-stack { display: flex; flex-direction: column; gap: 8px; }
        .fm-btn { width: 100%; padding: 13px 14px; border-radius: 12px; font-size: 14.5px; font-weight: 800; cursor: pointer; border: 1.5px solid transparent; display: flex; align-items: center; justify-content: center; gap: 7px; }
        .fm-btn-already { background: linear-gradient(135deg, #059669, #047857); border-color: #34d399; color: #fff; }
        .fm-btn-monthly { background: linear-gradient(135deg, #16a34a, #15803d); border-color: #4ade80; color: #fff; }
        .fm-btn-day { background: linear-gradient(135deg, #0284c7, #0369a1); border-color: #38bdf8; color: #fff; }
        .fm-btn-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .fm-btn-free { background: #4338ca; border-color: #818cf8; color: #fff; }
        .fm-btn-unpaid { background: #991b1b; border-color: #f87171; color: #fff; }
        .fm-btn-cancel { background: #0f172a; border-color: #475569; color: #94a3b8; padding: 10px; font-size: 13px; }
    </style>
</head>
<body>
    <div class="top-bar">
        <h1>📷 SAGE Staff QR Scanner</h1>
        <div class="top-actions" id="topActions" style="display:none;">
            <button class="btn-top" id="soundBtn" onclick="toggleSound()">🔊</button>
            <button class="btn-top" onclick="refreshRoster()" title="Reload updated fee & student list">🔄</button>
            <button class="btn-top" onclick="logoutStaff()">🔒 Exit</button>
        </div>
    </div>

    <div class="wrap">
        <!-- 1. STAFF PIN LOCK SCREEN -->
        <div id="loginView" class="login-card">
            <span class="login-badge">🔒 AUTHORIZED STAFF ONLY</span>
            <h2>Staff Gate Attendance Login</h2>
            <p>Enter your name and the SAGE Staff Scanner PIN to unlock the mobile camera QR attendance scanner.<br>
            <span style="font-size:12px; color:#cbd5e1;">(කාර්ය මණ්ඩල නම සහ Staff PIN අංකය ඇතුළත් කරන්න)</span></p>

            <div id="loginErr" class="err-box"></div>

            <form onsubmit="loginStaff(event)">
                <div class="field">
                    <label>Staff Name / Gate Counter (නම)</label>
                    <input type="text" id="staffNameInput" placeholder="e.g. Nimal / Gate 1" required>
                </div>
                <div class="field">
                    <label>Staff Scanner PIN (රහස් අංකය)</label>
                    <input type="password" id="staffPinInput" inputmode="numeric" placeholder="Enter Staff PIN" required>
                </div>
                <button type="submit" id="loginBtn" class="btn-primary">🔓 Unlock QR Scanner →</button>
            </form>
            <div style="margin-top:16px; text-align:center; font-size:11.5px; color:#64748b;">
                SAGE Higher Education Institute &bull; 24/7 Cloud Mobile Desk
            </div>
        </div>

        <!-- 2. LIVE STAFF QR SCANNER WORKSPACE -->
        <div id="scannerApp">
            <!-- Class Selector & Gate Fee Mode -->
            <div class="card">
                <div class="card-label">
                    <span>📚 Select Active Class (පන්තිය තෝරන්න)</span>
                    <span id="rosterInfo" style="color:#38bdf8;">0 students</span>
                </div>
                <select id="classSelect" class="class-select" onchange="onClassChanged()"></select>
                <div class="fee-mode-bar">
                    <label class="fee-mode-toggle">
                        <input type="checkbox" id="autoDayFeeCheck" onchange="saveFeePrefs()">
                        <span>💵 Day Fee Tick (Auto Day Fee)</span>
                    </label>
                    <div class="dayfee-box">
                        <span>LKR</span>
                        <input type="number" id="dayFeeAmountInput" value="200" min="0" step="50" onchange="saveFeePrefs()">
                    </div>
                </div>
            </div>

            <!-- Instant Result Alert -->
            <div id="resultBox"></div>

            <!-- Camera Viewfinder -->
            <div class="card">
                <div class="card-label">
                    <span>📷 Live QR Camera Scanner</span>
                    <span id="staffTag" style="color:#fde68a;">Staff</span>
                </div>
                <div id="readerWrap">
                    <div id="reader"></div>
                    <div id="camPlaceholder" class="cam-placeholder">
                        <div style="font-size:34px; margin-bottom:6px;">📱</div>
                        Tap <b>▶ Start Camera</b> to scan Student PVC Card or Digital ID QR codes
                    </div>
                </div>
                <div class="cam-controls">
                    <button id="camToggleBtn" class="btn-cam active" onclick="toggleCamera()">▶ Start Camera</button>
                    <button class="btn-cam" onclick="flipCamera()">🔄 Flip Cam</button>
                    <button class="btn-cam" onclick="document.getElementById('qrFileInput').click()">🖼 QR Photo</button>
                </div>
                <input type="file" id="qrFileInput" accept="image/*" style="display:none;" onchange="scanFromFile(event)">

                <!-- Manual Student ID Entry -->
                <div class="manual-row">
                    <input type="text" id="manualCodeInput" placeholder="Manual ID (e.g. 1001 or STU-1001)" onkeydown="if(event.key==='Enter'){event.preventDefault(); manualMark();}">
                    <button type="button" onclick="manualMark()">✔ Mark</button>
                </div>
            </div>

            <!-- Live Stats -->
            <div class="stats-grid">
                <div class="stat"><div class="num" id="stTotal" style="color:#f8fafc;">0</div><div class="lbl">Scanned</div></div>
                <div class="stat"><div class="num" id="stPaid" style="color:#4ade80;">0</div><div class="lbl">Paid / Mon</div></div>
                <div class="stat"><div class="num" id="stDayFee" style="color:#38bdf8;">0</div><div class="lbl">Day Fee</div></div>
                <div class="stat"><div class="num" id="stUnpaid" style="color:#f87171;">0</div><div class="lbl">Not Paid</div></div>
            </div>

            <!-- Live Staff Cash in Hand -->
            <div class="cash-bar">
                <div class="cash-left">
                    <div>💰 CASH IN HAND TODAY (අතේ එකතු වූ මුදල)</div>
                    <div id="cashBreakdown" style="font-weight:600; color:#cbd5e1;">Monthly: 0 • Day Fee: 0 • Free Card: 0 • Cloud: 0/0</div>
                </div>
                <div class="cash-amt" id="stCashTotal">LKR 0</div>
            </div>

            <!-- Cloud Push Bar -->
            <div class="sync-bar">
                <div class="sync-txt" id="syncStatusTxt">☁️ Ready — scans upload automatically to SAGE Cloud</div>
                <button class="btn-sync" id="pushAllBtn" onclick="pushAllToCloud()">☁️ Push All</button>
            </div>

            <!-- Today's Scan History -->
            <div class="card">
                <div class="card-label">
                    <span>📋 Today's Scans (<span id="todayDateLbl"></span>)</span>
                    <button style="background:none; border:none; color:#94a3b8; font-size:11px; cursor:pointer; font-weight:700;" onclick="clearLocalToday()">Clear Phone Log</button>
                </div>
                <div id="logList" class="log-list">
                    <div style="text-align:center; color:#64748b; padding:18px; font-size:13px;">No students scanned yet today.</div>
                </div>
            </div>
        </div>
    </div>

    <!-- PER-STUDENT ATTENDANCE FEE SELECTION MODAL (WHEN DAY FEE TICK IS OFF) -->
    <div id="feeModalBg" class="fee-modal-bg">
        <div class="fee-modal">
            <div class="fm-head">
                <div>
                    <div style="font-size:10.5px; font-weight:800; color:#fde68a; letter-spacing:0.6px;">⚡ ATTENDANCE FEE SELECTION</div>
                    <div class="fm-stu" id="fmStuName">Student Name</div>
                    <div class="fm-sub" id="fmStuSub">Code • Grade</div>
                </div>
                <span class="pill pill-b" id="fmMonthTag">2026-11</span>
            </div>

            <div style="margin-bottom:8px;">
                <label style="display:block; font-size:11.5px; font-weight:700; color:#94a3b8; margin-bottom:4px;">Class (පන්තිය):</label>
                <select id="fmClassSelect" class="class-select" onchange="updateFeeModalClassInfo()"></select>
            </div>

            <div id="fmStatusBox" class="fm-status fm-st-unpaid"></div>

            <div class="fm-amt-row">
                <label for="fmMonthlyAmt">💰 Monthly Fee Amount (LKR):</label>
                <input type="number" id="fmMonthlyAmt" min="0" step="100" value="2000" oninput="document.getElementById('fmBtnMonthly').textContent='💰 Monthly Paid — LKR ' + Number(this.value||0).toLocaleString() + ' (මාසික ගාස්තුව)';">
            </div>

            <div class="fm-btn-stack">
                <button type="button" id="fmBtnAlreadyPaid" class="fm-btn fm-btn-already" style="display:none;" onclick="confirmModalChoice('ALREADY_PAID')">
                    ✅ Confirm Present — Already Paid (ගෙවා ඇත)
                </button>
                <button type="button" id="fmBtnMonthly" class="fm-btn fm-btn-monthly" onclick="confirmModalChoice('MONTHLY_PAID')">
                    💰 Monthly Paid (මාසික ගාස්තුව ගෙව්වා)
                </button>
                <button type="button" id="fmBtnDayFee" class="fm-btn fm-btn-day" style="display:none;" onclick="confirmModalChoice('DAY_FEE')">
                    💵 Collect Day Fee (දින ගාස්තුව)
                </button>
                <div class="fm-btn-row2">
                    <button type="button" class="fm-btn fm-btn-free" onclick="confirmModalChoice('FREE_CARD')">🎟️ Free Card (නොමිලේ)</button>
                    <button type="button" class="fm-btn fm-btn-unpaid" onclick="confirmModalChoice('NOT_PAID')">❌ Not Paid (නොගෙවූ)</button>
                </div>
                <button type="button" class="fm-btn fm-btn-cancel" onclick="closeFeeModal()">✖ Cancel (අවලංගු කරන්න)</button>
            </div>
        </div>
    </div>

    <script>
        let STAFF_PIN = '';
        let STAFF_NAME = '';
        let CLASSES = [];
        let STUDENTS = [];
        let TODAY_DATE = '';
        let CURRENT_MONTH = '';
        let SCANS = [];
        let soundEnabled = true;
        let html5Qr = null;
        let cameraRunning = false;
        let facingMode = 'environment';
        let lastQrCode = '';
        let lastQrAt = 0;
        let MODAL_OPEN = false;
        let MODAL_STUDENT = null;
        let MODAL_EDIT_SCAN_ID = null;
        let TODAY_NAME = '';

        // Restore staff name, fee preferences & active session on load
        window.addEventListener('DOMContentLoaded', () => {
            const savedName = localStorage.getItem('sage_staff_name') || '';
            if (savedName) document.getElementById('staffNameInput').value = savedName;
            const savedDayFee = localStorage.getItem('sage_staff_day_fee');
            if (savedDayFee) document.getElementById('dayFeeAmountInput').value = savedDayFee;
            document.getElementById('autoDayFeeCheck').checked = localStorage.getItem('sage_staff_auto_dayfee') === '1';

            const savedPin = sessionStorage.getItem('sage_staff_pin') || '';
            if (savedName && savedPin) {
                document.getElementById('staffPinInput').value = savedPin;
                doLogin(savedName, savedPin, true);
            }
        });

        function saveFeePrefs() {
            const amt = Math.max(0, Number(document.getElementById('dayFeeAmountInput').value || 200));
            localStorage.setItem('sage_staff_day_fee', String(amt));
            localStorage.setItem('sage_staff_auto_dayfee', document.getElementById('autoDayFeeCheck').checked ? '1' : '0');
        }

        function getDayFeeAmount() {
            const v = Number(document.getElementById('dayFeeAmountInput').value);
            return (!isNaN(v) && v > 0) ? v : 200;
        }

        function isAutoDayFee() {
            return Boolean(document.getElementById('autoDayFeeCheck').checked);
        }

        function normalizeCode(c) {
            if (!c) return '';
            return String(c).trim().toUpperCase().replace(/^(STU-|SAGE-|SAGE)/i, '').replace(/^0+/, '');
        }

        function escHtml(v) {
            return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function playBeep(type) {
            if (!soundEnabled) return;
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const tone = (freq, start, dur, wave) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = wave || 'sine';
                    o.frequency.value = freq;
                    g.gain.setValueAtTime(0.18, ctx.currentTime + start);
                    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
                    o.connect(g); g.connect(ctx.destination);
                    o.start(ctx.currentTime + start);
                    o.stop(ctx.currentTime + start + dur);
                };
                if (type === 'paid') { tone(880, 0, 0.11); tone(1320, 0.11, 0.16); if (navigator.vibrate) navigator.vibrate(70); }
                else if (type === 'unpaid') { tone(330, 0, 0.16, 'sawtooth'); tone(260, 0.2, 0.24, 'sawtooth'); if (navigator.vibrate) navigator.vibrate([140, 80, 180]); }
                else if (type === 'warn') { tone(520, 0, 0.14, 'triangle'); if (navigator.vibrate) navigator.vibrate(90); }
                else { tone(190, 0, 0.28, 'sawtooth'); if (navigator.vibrate) navigator.vibrate(220); }
            } catch (e) {}
        }

        function toggleSound() {
            soundEnabled = !soundEnabled;
            document.getElementById('soundBtn').textContent = soundEnabled ? '🔊' : '🔇';
        }

        async function loginStaff(e) {
            e.preventDefault();
            const name = document.getElementById('staffNameInput').value.trim();
            const pin = document.getElementById('staffPinInput').value.trim();
            await doLogin(name, pin, false);
        }

        async function doLogin(name, pin, silent) {
            const btn = document.getElementById('loginBtn');
            const err = document.getElementById('loginErr');
            err.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Verifying PIN & Loading Roster...';

            try {
                const res = await fetch('/api/staff/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-STAFF-PIN': pin },
                    body: JSON.stringify({ pin, staffName: name })
                });
                const data = await res.json();
                if (res.status !== 200 || data.status !== 'OK') {
                    if (!silent) {
                        err.textContent = '🔒 ' + (data.message || 'Invalid Staff PIN. Please check with Admin.');
                        err.style.display = 'block';
                    }
                    sessionStorage.removeItem('sage_staff_pin');
                    btn.disabled = false;
                    btn.textContent = '🔓 Unlock QR Scanner →';
                    return;
                }

                STAFF_PIN = pin;
                STAFF_NAME = name || 'Staff';
                CLASSES = data.classes || [];
                STUDENTS = data.students || [];
                TODAY_DATE = data.todayDate;
                CURRENT_MONTH = data.currentMonth;
                TODAY_NAME = data.todayName || '';

                localStorage.setItem('sage_staff_name', STAFF_NAME);
                sessionStorage.setItem('sage_staff_pin', STAFF_PIN);

                loadLocalScans();
                populateClassSelect(data.todayName || '');

                document.getElementById('loginView').style.display = 'none';
                document.getElementById('scannerApp').style.display = 'block';
                document.getElementById('topActions').style.display = 'flex';
                document.getElementById('staffTag').textContent = '👤 ' + STAFF_NAME;
                document.getElementById('rosterInfo').textContent = STUDENTS.length + ' students synced';
                document.getElementById('todayDateLbl').textContent = TODAY_DATE;
                renderLogAndStats();
            } catch (ex) {
                err.textContent = 'Connection error: ' + ex.message;
                err.style.display = 'block';
                btn.disabled = false;
                btn.textContent = '🔓 Unlock QR Scanner →';
            }
        }

        async function refreshRoster() {
            const info = document.getElementById('rosterInfo');
            info.textContent = 'Refreshing...';
            try {
                const res = await fetch('/api/staff/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-STAFF-PIN': STAFF_PIN },
                    body: JSON.stringify({ pin: STAFF_PIN, staffName: STAFF_NAME })
                });
                const data = await res.json();
                if (data.status === 'OK') {
                    CLASSES = data.classes || [];
                    STUDENTS = data.students || [];
                    const prev = document.getElementById('classSelect').value;
                    populateClassSelect(data.todayName || '');
                    if (prev) document.getElementById('classSelect').value = prev;
                    info.textContent = STUDENTS.length + ' students ✓';
                }
            } catch (e) {
                info.textContent = 'Offline mode';
            }
        }

        function logoutStaff() {
            stopCamera();
            sessionStorage.removeItem('sage_staff_pin');
            STAFF_PIN = '';
            document.getElementById('scannerApp').style.display = 'none';
            document.getElementById('topActions').style.display = 'none';
            document.getElementById('loginView').style.display = 'block';
            document.getElementById('loginBtn').disabled = false;
            document.getElementById('loginBtn').textContent = '🔓 Unlock QR Scanner →';
            document.getElementById('staffPinInput').value = '';
        }

        function populateClassSelect(todayName) {
            const sel = document.getElementById('classSelect');
            const tUp = String(todayName || '').toUpperCase();
            const sorted = [...CLASSES].sort((a, b) => {
                const aT = String(a.dayOfWeek || '').toUpperCase() === tUp ? 0 : 1;
                const bT = String(b.dayOfWeek || '').toUpperCase() === tUp ? 0 : 1;
                if (aT !== bT) return aT - bT;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
            let html = '<option value="">⚡ Auto-Detect Enrolled Class (ස්වයංක්‍රීය)</option>';
            sorted.forEach(c => {
                const isToday = tUp && String(c.dayOfWeek || '').toUpperCase() === tUp;
                const tag = isToday ? '★ TODAY • ' : (c.dayOfWeek ? c.dayOfWeek.slice(0,3) + ' • ' : '');
                const time = c.startTime ? ' (' + c.startTime + ')' : '';
                html += '<option value="' + escHtml(c.id) + '">' + escHtml(tag + c.name + (c.grade ? ' - ' + c.grade : '') + time) + '</option>';
            });
            sel.innerHTML = html;
            const savedClass = localStorage.getItem('sage_staff_last_class');
            if (savedClass && [...sel.options].some(o => o.value === savedClass)) {
                sel.value = savedClass;
            }
        }

        function onClassChanged() {
            localStorage.setItem('sage_staff_last_class', document.getElementById('classSelect').value);
            document.getElementById('resultBox').style.display = 'none';
        }

        function getStorageKey() {
            return 'sage_staff_scans_' + (TODAY_DATE || new Date().toISOString().slice(0, 10));
        }

        function loadLocalScans() {
            try {
                SCANS = JSON.parse(localStorage.getItem(getStorageKey()) || '[]');
                if (!Array.isArray(SCANS)) SCANS = [];
            } catch (e) { SCANS = []; }
        }

        function saveLocalScans() {
            try { localStorage.setItem(getStorageKey(), JSON.stringify(SCANS)); } catch (e) {}
        }

        async function toggleCamera() {
            if (cameraRunning) { await stopCamera(); } else { await startCamera(); }
        }

        async function startCamera() {
            if (typeof Html5Qrcode === 'undefined') {
                showSimpleBanner('res-warn', '⚠️ Camera Library Offline', 'Use the Manual Student ID box below, or reconnect internet and reload.');
                return;
            }
            const btn = document.getElementById('camToggleBtn');
            btn.textContent = 'Starting...';
            try {
                document.getElementById('camPlaceholder').style.display = 'none';
                if (!html5Qr) html5Qr = new Html5Qrcode('reader');
                await html5Qr.start(
                    { facingMode: facingMode },
                    { fps: 12, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
                    (decodedText) => onQrDecoded(decodedText),
                    () => {}
                );
                cameraRunning = true;
                btn.className = 'btn-cam stop';
                btn.textContent = '⏹ Stop Camera';
            } catch (err) {
                document.getElementById('camPlaceholder').style.display = 'block';
                btn.className = 'btn-cam active';
                btn.textContent = '▶ Start Camera';
                showSimpleBanner('res-warn', '📷 Camera Permission Needed', String(err) + ' — Allow camera permission in browser settings, or use Manual ID entry.');
            }
        }

        async function stopCamera() {
            const btn = document.getElementById('camToggleBtn');
            if (html5Qr && cameraRunning) {
                try { await html5Qr.stop(); } catch (e) {}
            }
            cameraRunning = false;
            document.getElementById('camPlaceholder').style.display = 'block';
            btn.className = 'btn-cam active';
            btn.textContent = '▶ Start Camera';
        }

        async function flipCamera() {
            facingMode = (facingMode === 'environment') ? 'user' : 'environment';
            if (cameraRunning) {
                await stopCamera();
                await startCamera();
            }
        }

        async function scanFromFile(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            e.target.value = '';
            if (typeof Html5Qrcode === 'undefined') return;
            const wasRunning = cameraRunning;
            if (wasRunning) await stopCamera();
            try {
                if (!html5Qr) html5Qr = new Html5Qrcode('reader');
                const decoded = await html5Qr.scanFile(file, false);
                processToken(decoded, false);
            } catch (err) {
                playBeep('error');
                showSimpleBanner('res-unpaid', '❌ No QR Code Found in Photo', 'Please select a clearer photo of the Student QR ID.');
            }
            if (wasRunning) await startCamera();
        }

        function onQrDecoded(text) {
            if (MODAL_OPEN) return;
            const now = Date.now();
            const clean = String(text || '').trim();
            if (!clean) return;
            if (clean === lastQrCode && (now - lastQrAt) < 3000) return;
            lastQrCode = clean;
            lastQrAt = now;
            processToken(clean, false);
        }

        function manualMark() {
            const inp = document.getElementById('manualCodeInput');
            const val = inp.value.trim();
            if (!val) return;
            inp.value = '';
            processToken(val, false);
        }

        function findStudent(token) {
            const raw = String(token || '').trim();
            const upper = raw.toUpperCase();
            const norm = normalizeCode(raw);
            return STUDENTS.find(s => {
                if (s.qrToken && String(s.qrToken).trim().toUpperCase() === upper) return true;
                if (s.studentCode && String(s.studentCode).trim().toUpperCase() === upper) return true;
                if (s.regNumber && String(s.regNumber).trim().toUpperCase() === upper) return true;
                if (norm && normalizeCode(s.studentCode) === norm) return true;
                if (norm && normalizeCode(s.regNumber) === norm) return true;
                if (norm && String(s.id) === norm) return true;
                return false;
            });
        }

        function processToken(token, forceNotEnrolled) {
            const stu = findStudent(token);
            if (!stu) {
                playBeep('error');
                showSimpleBanner('res-unpaid', '❌ STUDENT NOT FOUND (හමු නොවීය)', 'Scanned Code: ' + token + ' — Sync latest students from SAGE-SMS Desktop if newly registered.');
                return;
            }

            const selEl = document.getElementById('classSelect');
            let classId = selEl.value ? Number(selEl.value) : null;
            const enrolled = Array.isArray(stu.enrolledClasses) ? stu.enrolledClasses : [];

            // Auto-pick single enrolled class when top selector is on Auto-Detect
            if (!classId && enrolled.length === 1) {
                classId = Number(enrolled[0].id);
            }

            // MODE A: Day Fee Tick IS CHECKED -> auto-apply Day Fee (skipping if already paid Monthly!)
            if (isAutoDayFee() && classId) {
                const classObj = CLASSES.find(c => Number(c.id) === classId);
                const matchEnr = enrolled.find(ec => Number(ec.id) === classId);
                const className = (classObj && classObj.name) || (matchEnr && matchEnr.className) || 'Class';
                const classFee = (matchEnr && Number(matchEnr.fee || 0) > 0)
                    ? Number(matchEnr.fee)
                    : (classObj ? Number(classObj.fee || 0) : 0);

                // Duplicate check for today + class
                const dup = SCANS.find(x => String(x.studentCode) === String(stu.studentCode) && Number(x.classId || 0) === classId);
                if (dup) {
                    playBeep('warn');
                    showScanCard('res-warn', '⚠️ ALREADY MARKED TODAY (දැනටමත් ලකුණු කර ඇත)', stu, className, formatFeeSummary(dup) + ' • Scanned at ' + dup.timeStr, null, dup.feeStatus !== 'PAID' ? dup : null);
                    return;
                }

                // Already paid Monthly Fee this month -> DO NOT double-charge Day Fee!
                if (matchEnr && matchEnr.paidThisMonth) {
                    saveAndUploadScan(stu, classId, className, classFee, 'PAID', 'NONE', 0,
                        'res-paid', '✅ PRESENT • ALREADY PAID THIS MONTH (ගෙවා ඇත)',
                        'No Day Fee charged • Receipt: ' + (matchEnr.paidReceiptNo || CURRENT_MONTH), false);
                    playBeep('paid');
                    return;
                }

                // Auto collect Day Fee!
                const dAmt = getDayFeeAmount();
                saveAndUploadScan(stu, classId, className, classFee, 'DAY_FEE', 'DAY_FEE', dAmt,
                    'res-dayfee', '💵 PRESENT • DAY FEE COLLECTED (දින ගාස්තුව)',
                    'Day Fee Cash Collected: LKR ' + dAmt.toLocaleString() + (matchEnr ? '' : ' • Auto-enrolled on PC sync'), true);
                playBeep('paid');
                return;
            }

            // MODE B: Day Fee Tick is UNCHECKED (or multiple classes on Auto-Detect) ->
            // Open Fee Selection Modal for EVERY student scanned!
            openFeeModal(stu, classId, null);
        }

        function openFeeModal(stu, preferredClassId, existingScanId) {
            MODAL_OPEN = true;
            MODAL_STUDENT = stu;
            MODAL_EDIT_SCAN_ID = existingScanId || null;

            document.getElementById('fmStuName').textContent = stu.fullName || 'Student';
            document.getElementById('fmStuSub').textContent = (stu.studentCode || stu.id) + ' • ' + (stu.grade || '-');
            document.getElementById('fmMonthTag').textContent = CURRENT_MONTH || '';

            // Populate modal class selector: student's enrolled classes first, then all institute classes
            const enrolled = Array.isArray(stu.enrolledClasses) ? stu.enrolledClasses : [];
            const enrIds = new Set(enrolled.map(e => Number(e.id)));
            const sel = document.getElementById('fmClassSelect');
            let opts = '';
            if (enrolled.length > 0) {
                opts += '<optgroup label="★ Student Enrolled Classes">';
                enrolled.forEach(ec => {
                    const paidMark = ec.paidThisMonth ? ' ✅ PAID' : ' ❌ UNPAID';
                    opts += '<option value="' + escHtml(ec.id) + '">' + escHtml(ec.className + paidMark) + '</option>';
                });
                opts += '</optgroup>';
            }
            const others = CLASSES.filter(c => !enrIds.has(Number(c.id)));
            if (others.length > 0) {
                opts += '<optgroup label="Other Institute Classes (Auto-Enroll)">';
                others.forEach(c => {
                    opts += '<option value="' + escHtml(c.id) + '">' + escHtml(c.name + (c.grade ? ' - ' + c.grade : '')) + '</option>';
                });
                opts += '</optgroup>';
            }
            if (!opts) {
                opts = '<option value="">🚪 General Gate Attendance</option>';
            }
            sel.innerHTML = opts;

            // Choose default selected class
            if (preferredClassId && [...sel.options].some(o => Number(o.value) === Number(preferredClassId))) {
                sel.value = String(preferredClassId);
            } else if (enrolled.length > 0) {
                // Prefer a class scheduled today if available
                const tUp = String(TODAY_NAME || '').toUpperCase();
                const todayClass = CLASSES.find(c => enrIds.has(Number(c.id)) && tUp && String(c.dayOfWeek || '').toUpperCase() === tUp);
                sel.value = String(todayClass ? todayClass.id : enrolled[0].id);
            }

            // Show Day Fee button inside modal when Auto Day Fee mode needed class picking OR editing an existing scan
            const dayBtn = document.getElementById('fmBtnDayFee');
            if (isAutoDayFee() || existingScanId) {
                dayBtn.style.display = 'flex';
                dayBtn.textContent = '💵 Collect Day Fee — LKR ' + getDayFeeAmount().toLocaleString() + ' (දින ගාස්තුව)';
            } else {
                dayBtn.style.display = 'none';
            }

            updateFeeModalClassInfo();
            document.getElementById('feeModalBg').classList.add('open');
            playBeep('warn');
        }

        function updateFeeModalClassInfo() {
            if (!MODAL_STUDENT) return;
            const selVal = document.getElementById('fmClassSelect').value;
            const cid = selVal ? Number(selVal) : null;
            const enrolled = Array.isArray(MODAL_STUDENT.enrolledClasses) ? MODAL_STUDENT.enrolledClasses : [];
            const matchEnr = cid ? enrolled.find(ec => Number(ec.id) === cid) : null;
            const classObj = cid ? CLASSES.find(c => Number(c.id) === cid) : null;

            const fee = (matchEnr && Number(matchEnr.fee || 0) > 0)
                ? Number(matchEnr.fee)
                : (classObj ? Number(classObj.fee || 0) : 0);
            document.getElementById('fmMonthlyAmt').value = fee > 0 ? fee : 2000;

            const dup = SCANS.find(x =>
                String(x.studentCode) === String(MODAL_STUDENT.studentCode) &&
                Number(x.classId || 0) === Number(cid || 0) &&
                (!MODAL_EDIT_SCAN_ID || x.scanId !== MODAL_EDIT_SCAN_ID)
            );
            const alreadyPaidLocally = SCANS.some(x =>
                String(x.studentCode) === String(MODAL_STUDENT.studentCode) &&
                Number(x.classId || 0) === Number(cid || 0) &&
                x.feeStatus === 'MONTHLY_PAID' &&
                (!MODAL_EDIT_SCAN_ID || x.scanId !== MODAL_EDIT_SCAN_ID)
            );

            const isPaid = Boolean((matchEnr && matchEnr.paidThisMonth) || alreadyPaidLocally);
            const stBox = document.getElementById('fmStatusBox');
            const alreadyBtn = document.getElementById('fmBtnAlreadyPaid');

            if (isPaid) {
                stBox.className = 'fm-status fm-st-paid';
                stBox.innerHTML = '✅ ALREADY PAID THIS MONTH! (මෙම මාසයේ ගෙවා ඇත)' +
                    (matchEnr && matchEnr.paidReceiptNo ? '<br>Receipt: ' + escHtml(matchEnr.paidReceiptNo) + ' • ' + escHtml(matchEnr.paidDate || '') : '') +
                    (dup ? '<br>⚠️ Already marked today at ' + escHtml(dup.timeStr) : '');
                alreadyBtn.style.display = 'flex';
            } else {
                stBox.className = 'fm-status fm-st-unpaid';
                stBox.innerHTML = '❌ UNPAID FOR ' + escHtml(CURRENT_MONTH) + ' (මෙම මාසයේ ගෙවා නැත)' +
                    (fee > 0 ? ' • Class Fee: LKR ' + fee.toLocaleString() : '') +
                    (!matchEnr && cid ? '<br>ℹ️ Student not yet enrolled — will auto-enroll on PC sync' : '') +
                    (dup ? '<br>⚠️ Already scanned today (' + escHtml(formatFeeSummary(dup)) + ') — selecting below updates it' : '');
                alreadyBtn.style.display = 'none';
            }

            document.getElementById('fmBtnMonthly').textContent = '💰 Monthly Paid — LKR ' + (fee > 0 ? fee.toLocaleString() : 'Enter Amt') + ' (මාසික ගාස්තුව)';
        }

        function closeFeeModal() {
            document.getElementById('feeModalBg').classList.remove('open');
            MODAL_OPEN = false;
            MODAL_STUDENT = null;
            MODAL_EDIT_SCAN_ID = null;
            lastQrAt = Date.now();
        }

        function confirmModalChoice(choice) {
            if (!MODAL_STUDENT) return;
            const stu = MODAL_STUDENT;
            const editId = MODAL_EDIT_SCAN_ID;
            const selVal = document.getElementById('fmClassSelect').value;
            const cid = selVal ? Number(selVal) : null;
            const enrolled = Array.isArray(stu.enrolledClasses) ? stu.enrolledClasses : [];
            const matchEnr = cid ? enrolled.find(ec => Number(ec.id) === cid) : null;
            const classObj = cid ? CLASSES.find(c => Number(c.id) === cid) : null;
            const className = (classObj && classObj.name) || (matchEnr && matchEnr.className) || 'General Gate Attendance';
            const enteredAmt = Math.max(0, Number(document.getElementById('fmMonthlyAmt').value || 0));
            const classFee = enteredAmt > 0 ? enteredAmt : ((matchEnr && Number(matchEnr.fee || 0)) || (classObj && Number(classObj.fee || 0)) || 0);

            if (choice === 'MONTHLY_PAID') {
                if (matchEnr && matchEnr.paidThisMonth) {
                    if (!confirm('⚠️ This student ALREADY PAID for ' + CURRENT_MONTH + ' (' + (matchEnr.paidReceiptNo || 'Paid') + ').\\n\\nRecord another Monthly Payment anyway?')) {
                        return;
                    }
                }
                if (enteredAmt <= 0) {
                    alert('Please enter a valid Monthly Fee amount (LKR).');
                    return;
                }
            }

            closeFeeModal();

            // Check if updating an existing scan today for this student+class
            let existing = editId
                ? SCANS.find(x => x.scanId === editId)
                : SCANS.find(x => String(x.studentCode) === String(stu.studentCode) && Number(x.classId || 0) === Number(cid || 0));

            let feeStatus = 'NOT_PAID';
            let paymentType = 'NONE';
            let collectedAmount = 0;
            let cardCls = 'res-unpaid';
            let banner = '';
            let detail = '';

            if (choice === 'ALREADY_PAID') {
                feeStatus = 'PAID';
                cardCls = 'res-paid';
                banner = '✅ PRESENT • ALREADY PAID (ගෙවා ඇත)';
                detail = 'Verified Paid for ' + CURRENT_MONTH + (matchEnr && matchEnr.paidReceiptNo ? ' • ' + matchEnr.paidReceiptNo : '');
                playBeep('paid');
            } else if (choice === 'MONTHLY_PAID') {
                feeStatus = 'MONTHLY_PAID';
                paymentType = 'MONTHLY';
                collectedAmount = enteredAmt;
                cardCls = 'res-paid';
                banner = '💰 PRESENT • MONTHLY PAID (මාසික ගාස්තුව)';
                detail = 'Collected Cash: LKR ' + enteredAmt.toLocaleString() + ' • Receipt auto-creates on PC Pull!';
                playBeep('paid');
            } else if (choice === 'DAY_FEE') {
                const dAmt = getDayFeeAmount();
                feeStatus = 'DAY_FEE';
                paymentType = 'DAY_FEE';
                collectedAmount = dAmt;
                cardCls = 'res-dayfee';
                banner = '💵 PRESENT • DAY FEE COLLECTED (දින ගාස්තුව)';
                detail = 'Collected Day Fee Cash: LKR ' + dAmt.toLocaleString() + ' • Syncing to Cloud!';
                playBeep('paid');
            } else if (choice === 'FREE_CARD') {
                feeStatus = 'FREE_CARD';
                cardCls = 'res-freecard';
                banner = '🎟️ PRESENT • FREE CARD (නොමිලේ)';
                detail = 'Marked authorized Free Card (Excluded from Not Paid list)';
                playBeep('paid');
            } else {
                feeStatus = 'NOT_PAID';
                cardCls = 'res-unpaid';
                banner = '❌ PRESENT • NOT PAID (නොගෙවූ සිසුන්)';
                detail = 'Added to Desktop Attendance -> Not Paid Students tab';
                playBeep('unpaid');
            }

            if (existing) {
                existing.classId = cid;
                existing.className = className;
                existing.classFee = classFee;
                existing.feeStatus = feeStatus;
                existing.paymentType = paymentType;
                existing.collectedAmount = collectedAmount;
                existing.uploaded = false;
                saveLocalScans();
                showScanCard(cardCls, banner, stu, className, detail, null, feeStatus !== 'PAID' ? existing : null);
                renderLogAndStats();
                uploadScans([existing]);
            } else {
                saveAndUploadScan(stu, cid, className, classFee, feeStatus, paymentType, collectedAmount,
                    cardCls, banner, detail, feeStatus !== 'PAID');
            }
        }

        function saveAndUploadScan(stu, classId, className, classFee, feeStatus, paymentType, collectedAmount, cardCls, banner, detail, showEditBtns) {
            const now = new Date();
            const timeStr = now.toTimeString().slice(0, 8);
            const scanObj = {
                scanId: 'MOB-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
                studentId: stu.id,
                studentCode: stu.studentCode,
                studentName: stu.fullName,
                grade: stu.grade || '',
                classId: classId,
                className: className,
                classFee: classFee,
                date: TODAY_DATE,
                timeStr: timeStr,
                scannedAt: now.toISOString(),
                staffName: STAFF_NAME,
                feeStatus: feeStatus,
                paymentType: paymentType,
                collectedAmount: collectedAmount,
                uploaded: false
            };

            SCANS.unshift(scanObj);
            saveLocalScans();
            showScanCard(cardCls, banner, stu, className, detail, null, showEditBtns ? scanObj : null);
            renderLogAndStats();
            uploadScans([scanObj]);
        }

        function formatFeeSummary(sc) {
            if (sc.feeStatus === 'PAID') return '✅ ALREADY PAID THIS MONTH';
            if (sc.feeStatus === 'MONTHLY_PAID') return '💰 MONTHLY FEE COLLECTED: LKR ' + Number(sc.collectedAmount || 0).toLocaleString();
            if (sc.feeStatus === 'DAY_FEE') return '💵 DAY FEE COLLECTED: LKR ' + Number(sc.collectedAmount || 0).toLocaleString();
            if (sc.feeStatus === 'FREE_CARD') return '🎟️ FREE CARD (නොමිලේ)';
            if (sc.feeStatus === 'NOT_PAID') return '❌ NOT PAID (නොගෙවූ සිසුන්)';
            return '🚪 General Gate Attendance';
        }

        function setScanFeeAction(scanId, actionType) {
            const sc = SCANS.find(x => x.scanId === scanId);
            if (!sc) return;
            const stu = STUDENTS.find(s => String(s.studentCode) === String(sc.studentCode)) || {
                id: sc.studentId, studentCode: sc.studentCode, fullName: sc.studentName, grade: sc.grade, enrolledClasses: []
            };
            if (actionType === 'MONTHLY_PAID' && Number(sc.classFee || 0) <= 0) {
                openFeeModal(stu, sc.classId, sc.scanId);
                return;
            }
            MODAL_STUDENT = stu;
            MODAL_EDIT_SCAN_ID = sc.scanId;
            document.getElementById('fmClassSelect').innerHTML = '<option value="' + escHtml(sc.classId || '') + '">' + escHtml(sc.className) + '</option>';
            document.getElementById('fmMonthlyAmt').value = sc.classFee || 2000;
            confirmModalChoice(actionType);
        }

        function reopenFeeEditor(scanId) {
            const sc = SCANS.find(x => x.scanId === scanId);
            if (!sc) return;
            const stu = STUDENTS.find(s => String(s.studentCode) === String(sc.studentCode)) || {
                id: sc.studentId, studentCode: sc.studentCode, fullName: sc.studentName, grade: sc.grade, enrolledClasses: []
            };
            openFeeModal(stu, sc.classId, sc.scanId);
        }

        function showSimpleBanner(cls, title, msg) {
            const box = document.getElementById('resultBox');
            box.className = cls;
            box.style.display = 'block';
            box.innerHTML = '<div class="res-status"><span>' + escHtml(title) + '</span></div>' +
                            '<div class="res-meta">' + escHtml(msg) + '</div>';
        }

        function showScanCard(cls, banner, stu, className, detail, forceToken, scanForFeeBtns) {
            const box = document.getElementById('resultBox');
            box.className = cls;
            box.style.display = 'block';
            let html = '<div class="res-status"><span>' + escHtml(banner) + '</span><span>' + escHtml(stu.studentCode) + '</span></div>' +
                       '<div class="res-name">' + escHtml(stu.fullName) + '</div>' +
                       '<div class="res-meta">' + escHtml(stu.grade || '-') + ' &bull; ' + escHtml(className) + '<br><b>' + escHtml(detail) + '</b></div>';
            if (forceToken) {
                html += '<button class="btn-force" onclick="processToken(' + escHtml(JSON.stringify(forceToken)) + ', true)">✔ Mark Attendance Anyway</button>';
            }
            if (scanForFeeBtns && scanForFeeBtns.classId) {
                const sidArg = escHtml(JSON.stringify(scanForFeeBtns.scanId));
                const mLbl = scanForFeeBtns.classFee > 0 ? ('LKR ' + Number(scanForFeeBtns.classFee).toLocaleString()) : 'Monthly';
                const dLbl = 'LKR ' + getDayFeeAmount().toLocaleString();
                const fs = scanForFeeBtns.feeStatus;
                html += '<div class="fee-actions-grid">' +
                    '<button class="btn-fa btn-fa-monthly ' + (fs === 'MONTHLY_PAID' ? 'selected' : '') + '" onclick="setScanFeeAction(' + sidArg + ', \\'MONTHLY_PAID\\')">💰 Monthly (' + escHtml(mLbl) + ')</button>' +
                    '<button class="btn-fa btn-fa-day ' + (fs === 'DAY_FEE' ? 'selected' : '') + '" onclick="setScanFeeAction(' + sidArg + ', \\'DAY_FEE\\')">💵 Day Fee (' + escHtml(dLbl) + ')</button>' +
                    '<button class="btn-fa btn-fa-free ' + (fs === 'FREE_CARD' ? 'selected' : '') + '" onclick="setScanFeeAction(' + sidArg + ', \\'FREE_CARD\\')">🎟️ Free Card</button>' +
                    '<button class="btn-fa btn-fa-unpaid ' + (fs === 'NOT_PAID' ? 'selected' : '') + '" onclick="setScanFeeAction(' + sidArg + ', \\'NOT_PAID\\')">❌ Not Paid</button>' +
                '</div>';
            }
            box.innerHTML = html;
        }

        async function uploadScans(items) {
            if (!items || !items.length) return;
            const txt = document.getElementById('syncStatusTxt');
            txt.textContent = '☁️ Uploading ' + items.length + ' scan(s) to Cloud...';
            try {
                const res = await fetch('/api/staff/attendance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-STAFF-PIN': STAFF_PIN },
                    body: JSON.stringify({ pin: STAFF_PIN, scans: items })
                });
                const data = await res.json();
                if (res.status === 200 && data.status === 'OK') {
                    const ids = new Set(items.map(i => i.scanId));
                    SCANS.forEach(s => { if (ids.has(s.scanId)) s.uploaded = true; });
                    saveLocalScans();
                    renderLogAndStats();
                    txt.innerHTML = '✅ <b>Cloud Synced!</b> Click <b>Pull Phone Scans</b> on PC anytime.';
                } else {
                    txt.textContent = '⚠️ Cloud upload retry needed (' + (data.message || res.status) + ')';
                }
            } catch (e) {
                txt.textContent = '📶 Offline — saved safely on phone. Tap Push All when online.';
            }
        }

        async function pushAllToCloud() {
            if (!SCANS.length) {
                document.getElementById('syncStatusTxt').textContent = 'ℹ️ No scans today to upload yet.';
                return;
            }
            const btn = document.getElementById('pushAllBtn');
            btn.disabled = true;
            btn.textContent = 'Pushing...';
            await uploadScans(SCANS);
            btn.disabled = false;
            btn.textContent = '☁️ Push All';
        }

        function removeScan(scanId) {
            SCANS = SCANS.filter(s => s.scanId !== scanId);
            saveLocalScans();
            renderLogAndStats();
        }

        function clearLocalToday() {
            if (!SCANS.length) return;
            if (!confirm('Clear today\\'s phone scan log? (Make sure you already synced to Desktop PC!)')) return;
            SCANS = [];
            saveLocalScans();
            renderLogAndStats();
        }

        function renderLogAndStats() {
            const total = SCANS.length;
            const paidOrMon = SCANS.filter(s => s.feeStatus === 'PAID' || s.feeStatus === 'MONTHLY_PAID').length;
            const monthlyCollectedCnt = SCANS.filter(s => s.feeStatus === 'MONTHLY_PAID').length;
            const dayFeeCnt = SCANS.filter(s => s.feeStatus === 'DAY_FEE').length;
            const freeCnt = SCANS.filter(s => s.feeStatus === 'FREE_CARD').length;
            const unpaid = SCANS.filter(s => s.feeStatus === 'NOT_PAID').length;
            const synced = SCANS.filter(s => s.uploaded).length;
            const cashTotal = SCANS.reduce((sum, s) => sum + Number(s.collectedAmount || 0), 0);

            document.getElementById('stTotal').textContent = total;
            document.getElementById('stPaid').textContent = paidOrMon;
            document.getElementById('stDayFee').textContent = dayFeeCnt;
            document.getElementById('stUnpaid').textContent = unpaid;
            document.getElementById('stCashTotal').textContent = 'LKR ' + cashTotal.toLocaleString();
            document.getElementById('cashBreakdown').textContent =
                'Monthly: ' + monthlyCollectedCnt + ' • Day Fee: ' + dayFeeCnt + ' • Free Card: ' + freeCnt + ' • Cloud: ' + synced + '/' + total;

            const list = document.getElementById('logList');
            if (!total) {
                list.innerHTML = '<div style="text-align:center; color:#64748b; padding:18px; font-size:13px;">No students scanned yet today.</div>';
                return;
            }
            list.innerHTML = SCANS.map(s => {
                let pill = '<span class="pill pill-b">GATE</span>';
                if (s.feeStatus === 'PAID') pill = '<span class="pill pill-g">✅ PAID</span>';
                else if (s.feeStatus === 'MONTHLY_PAID') pill = '<span class="pill pill-g">💰 LKR ' + Number(s.collectedAmount || 0).toLocaleString() + '</span>';
                else if (s.feeStatus === 'DAY_FEE') pill = '<span class="pill pill-c">💵 DAY ' + Number(s.collectedAmount || 0).toLocaleString() + '</span>';
                else if (s.feeStatus === 'FREE_CARD') pill = '<span class="pill pill-p">🎟️ FREE</span>';
                else if (s.feeStatus === 'NOT_PAID') pill = '<span class="pill pill-r">❌ NOT PAID</span>';

                const cloudMark = s.uploaded ? '☁️' : '⏳';
                const editBtn = (s.classId && s.feeStatus !== 'PAID')
                    ? '<button class="btn-edit-fee" onclick="reopenFeeEditor(' + escHtml(JSON.stringify(s.scanId)) + ')" title="Change Fee Status">✎ Fee</button>'
                    : '';
                return '<div class="log-item">' +
                    '<div class="log-left">' +
                        '<div class="log-name">' + escHtml(s.studentName) + ' <span style="color:#94a3b8; font-weight:600; font-size:11.5px;">(' + escHtml(s.studentCode) + ')</span></div>' +
                        '<div class="log-sub">' + escHtml(s.className) + ' &bull; ' + escHtml(s.timeStr) + ' &bull; ' + cloudMark + '</div>' +
                    '</div>' +
                    '<div style="display:flex; align-items:center; gap:5px;">' + pill + editBtn +
                        '<button class="btn-del" onclick="removeScan(' + escHtml(JSON.stringify(s.scanId)) + ')" title="Remove from phone log">✕</button>' +
                    '</div>' +
                '</div>';
            }).join('');
        }
    </script>
</body>
</html>`;
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
        'Access-Control-Allow-Headers': 'Content-Type, X-SAGE-SECRET, X-STAFF-PIN',
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
            'Access-Control-Allow-Headers': 'Content-Type, X-SAGE-SECRET, X-STAFF-PIN',
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

        // 1B. GET /staff-scan (Staff Mobile QR Attendance Scanner)
        if (req.method === 'GET' && (pathname === '/staff-scan' || pathname === '/staff-scan/')) {
            return sendHtml(res, renderStaffScannerPage());
        }

        // 2. GET / (Parent Portal)
        if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            return handleParentPortal(req, res, parsed.searchParams);
        }

        // 2B. POST /api/staff/login (Verify Staff PIN & return compact roster for instant scanning)
        if (req.method === 'POST' && pathname === '/api/staff/login') {
            const body = await getBody(req);
            if (!isAuthorizedStaff(req, parsed, body)) {
                return sendJson(res, { status: 'ERROR', message: 'Invalid Staff PIN. Please check PIN in SAGE-SMS Desktop.' }, 401);
            }
            const classes = readJson(CLASSES_FILE, []);
            const studentsRaw = readJson(STUDENTS_FILE, []);
            const students = studentsRaw.map(s => ({
                id: s.id,
                studentCode: s.studentCode,
                regNumber: s.regNumber,
                qrToken: s.qrToken || s.studentCode,
                fullName: s.fullName,
                grade: s.grade || '',
                enrolledClasses: Array.isArray(s.enrolledClasses) ? s.enrolledClasses.map(ec => ({
                    id: ec.id,
                    className: ec.className,
                    fee: ec.fee || 0,
                    paidThisMonth: Boolean(ec.paidThisMonth),
                    paidReceiptNo: ec.paidReceiptNo || '',
                    paidDate: ec.paidDate || ''
                })) : []
            }));
            const slNow = getSlNow();
            const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
            return sendJson(res, {
                status: 'OK',
                todayDate: slNow.toISOString().slice(0, 10),
                currentMonth: slNow.toISOString().slice(0, 7),
                todayName: dayNames[slNow.getUTCDay()],
                classes,
                students
            });
        }

        // 2C. POST /api/staff/attendance (Upload single or batch mobile scans)
        if (req.method === 'POST' && pathname === '/api/staff/attendance') {
            const body = await getBody(req);
            if (!isAuthorizedStaff(req, parsed, body)) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized Staff PIN' }, 401);
            }
            const incoming = Array.isArray(body.scans) ? body.scans : (body.studentCode ? [body] : []);
            const existing = readJson(ATTENDANCE_FILE, []);
            const byKey = new Map();
            existing.forEach(item => {
                const k = `${item.studentCode}|${item.classId || ''}|${item.date}`;
                byKey.set(k, item);
            });

            let savedCount = 0;
            incoming.forEach(sc => {
                if (!sc || !sc.studentCode) return;
                const d = sc.date || getSlDateStr();
                const cid = (sc.classId !== null && sc.classId !== undefined && sc.classId !== '') ? Number(sc.classId) : null;
                const k = `${sc.studentCode}|${cid || ''}|${d}`;
                const feeStatus = String(sc.feeStatus || 'GENERAL').trim();
                const paymentType = String(sc.paymentType || 'NONE').trim();
                const collectedAmount = Math.max(0, Number(sc.collectedAmount || 0));
                const prev = byKey.get(k);
                if (!prev) {
                    byKey.set(k, {
                        scanId: sc.scanId || ('MOB-' + Date.now() + '-' + Math.floor(Math.random() * 10000)),
                        studentId: sc.studentId || 0,
                        studentCode: String(sc.studentCode).trim(),
                        studentName: String(sc.studentName || '').trim(),
                        classId: cid,
                        className: String(sc.className || 'General Gate Attendance').trim(),
                        date: d,
                        timeStr: String(sc.timeStr || getSlNow().toISOString().slice(11, 19)),
                        staffName: String(sc.staffName || 'MobileStaff').trim(),
                        feeStatus: feeStatus,
                        paymentType: paymentType,
                        collectedAmount: collectedAmount,
                        syncedToDesktop: false,
                        receivedAt: new Date().toISOString()
                    });
                    savedCount++;
                } else if (
                    prev.feeStatus !== feeStatus ||
                    String(prev.paymentType || 'NONE') !== paymentType ||
                    Number(prev.collectedAmount || 0) !== collectedAmount
                ) {
                    // Staff updated student's gate fee status (e.g., NOT_PAID -> DAY_FEE / MONTHLY_PAID / FREE_CARD)
                    prev.feeStatus = feeStatus;
                    prev.paymentType = paymentType;
                    prev.collectedAmount = collectedAmount;
                    prev.staffName = String(sc.staffName || prev.staffName || 'MobileStaff').trim();
                    prev.syncedToDesktop = false;
                    prev.updatedAt = new Date().toISOString();
                    savedCount++;
                }
            });

            // Keep last 5,000 records max
            const allList = Array.from(byKey.values()).slice(-5000);
            writeJson(ATTENDANCE_FILE, allList);
            const pendingCount = allList.filter(x => !x.syncedToDesktop).length;
            return sendJson(res, { status: 'OK', savedCount, totalPending: pendingCount });
        }

        // 2D. GET /api/staff/attendance (Desktop SAGE-SMS pulls pending mobile scans)
        if (req.method === 'GET' && pathname === '/api/staff/attendance') {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }
            const onlyPending = parsed.searchParams.get('pending') !== 'false';
            const all = readJson(ATTENDANCE_FILE, []);
            const scans = onlyPending ? all.filter(x => !x.syncedToDesktop) : all;
            return sendJson(res, { status: 'OK', scans });
        }

        // 2E. POST /api/staff/attendance/ack (Desktop acknowledges imported scanIds)
        if (req.method === 'POST' && pathname === '/api/staff/attendance/ack') {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }
            const body = await getBody(req);
            const ackIds = new Set(Array.isArray(body.scanIds) ? body.scanIds.map(String) : []);
            const all = readJson(ATTENDANCE_FILE, []);
            let acked = 0;
            all.forEach(item => {
                if (ackIds.has(String(item.scanId))) {
                    item.syncedToDesktop = true;
                    acked++;
                }
            });
            writeJson(ATTENDANCE_FILE, all);
            return sendJson(res, { status: 'OK', acked });
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

        // 6. POST /api/sync-data (SAGE-SMS Desktop uploads active classes, students & staffPin for 24/7 Cloud Portal)
        if (req.method === 'POST' && pathname === '/api/sync-data') {
            const key = req.headers['x-sage-secret'] || parsed.searchParams.get('key');
            if (key !== API_SECRET) {
                return sendJson(res, { status: 'ERROR', message: 'Unauthorized' }, 401);
            }

            const body = await getBody(req);
            const { classes, students, staffPin } = body;
            if (Array.isArray(classes)) {
                writeJson(CLASSES_FILE, classes);
            }
            if (Array.isArray(students)) {
                writeJson(STUDENTS_FILE, students);
            }
            if (staffPin && String(staffPin).trim()) {
                const cfg = readJson(CONFIG_FILE, {});
                cfg.staffPin = String(staffPin).trim();
                cfg.updatedAt = new Date().toISOString();
                writeJson(CONFIG_FILE, cfg);
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
        console.log(` - Staff QR Scanner:    http://localhost:${PORT}/staff-scan`);
        console.log(`=======================================================`);
    });
}
