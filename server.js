const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ─── Security Headers (helmet) ───
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://www.gstatic.com", "https://cdnjs.cloudflare.com", "https://apis.google.com", "https://*.firebaseapp.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com", "https://*.firebaseapp.com", "https://api.github.com", "https://api.telegram.org", "wss://*.firebaseio.com"],
            frameSrc: ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ─── Rate Limiting ───
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const buildLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many build requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const trackLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { error: 'Too many login tracking requests.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', generalLimiter);

// إعدادات Telegram للإشعارات
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── HTML Sanitization for Telegram messages ───
function escapeHtml(str) {
    if (!str) return 'غير معروف';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// دالة إرسال إشعار Telegram
async function sendTelegramNotification(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('⚠️ Telegram not configured, skipping notification');
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
    } catch (err) {
        console.error('❌ Telegram notification error:', err.message);
    }
}

// ─── Parse User-Agent for detailed device info ───
function parseUserAgent(ua) {
    if (!ua) return { browser: 'غير معروف', os: 'غير معروف', device: 'غير معروف' };
    let browser = 'غير معروف';
    let os = 'غير معروف';
    let device = 'Desktop';

    if (/Edg\//i.test(ua)) browser = 'Microsoft Edge ' + (ua.match(/Edg\/([\d.]+)/)?.[1] || '');
    else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = 'Opera ' + (ua.match(/OPR\/([\d.]+)/)?.[1] || '');
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Google Chrome ' + (ua.match(/Chrome\/([\d.]+)/)?.[1] || '');
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari ' + (ua.match(/Version\/([\d.]+)/)?.[1] || '');
    else if (/Firefox\//i.test(ua)) browser = 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1] || '');
    else if (/MSIE|Trident/i.test(ua)) browser = 'Internet Explorer';

    if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
    else if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'macOS ' + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '');
    else if (/Android/i.test(ua)) os = 'Android ' + (ua.match(/Android ([\d.]+)/)?.[1] || '');
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS ' + (ua.match(/OS ([\d_]+)/)?.[1]?.replace(/_/g, '.') || '');
    else if (/Linux/i.test(ua)) os = 'Linux';
    else if (/CrOS/i.test(ua)) os = 'Chrome OS';

    if (/Mobile|Android|iPhone|iPod/i.test(ua)) device = 'Mobile';
    else if (/iPad|Tablet/i.test(ua)) device = 'Tablet';
    else if (/wv|WebView/i.test(ua)) device = 'WebView (Android App)';

    return { browser: browser.trim(), os: os.trim(), device: device.trim() };
}

// زيادة حجم البيانات المسموح به لاستقبال الصور (ضروري للـ Base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ─── CORS - Restricted to allowed origins ───
const allowedOrigins = [
    'https://aite-studio.vercel.app',
    'https://aite.studio',
    process.env.ALLOWED_ORIGIN
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(express.static('public'));

// 1. إعدادات Cloudinary (moved to environment variables)
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'duixjs8az', 
  api_key: process.env.CLOUDINARY_API_KEY || '143978951428697', 
  api_secret: process.env.CLOUDINARY_API_SECRET || '9dX6eIvntdtGQIU7oXGMSRG9I2o' 
});

// 2. إعدادات GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error("⚠️ تحذير: متغيرات البيئة الخاصة بـ GitHub مفقودة.");
}

// ─── Input Validation Helpers ───
function isValidPackageName(pkg) {
    return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){1,}$/.test(pkg);
}

function isValidUrl(url) {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function isValidAppName(name) {
    return name && name.length >= 1 && name.length <= 100;
}

// دالة مساعدة لجلب رابط التحميل
async function getReleaseDownloadUrl(runId, repoOwner, repoName, githubToken) {
    try {
        const releaseTag = `build-${runId}`;
        const releasesResponse = await axios.get(
            `https://api.github.com/repos/${repoOwner}/${repoName}/releases/tags/${releaseTag}`,
            { headers: { 'Authorization': `token ${githubToken}` } }
        );
        const release = releasesResponse.data;
        const asset = release.assets.find(a => a.name === 'app-release.apk') || release.assets.find(a => a.name === 'app-debug.apk');
        return asset ? asset.browser_download_url : null;
    } catch (error) {
        // لا نطبع الخطأ هنا لتجنب إغراق السجلات، لأن الإصدار قد لا يكون جاهزاً بعد
        return null;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: تتبع تسجيل الدخول وإرسال إشعار Telegram ---
app.post('/api/track-login', trackLoginLimiter, async (req, res) => {
    const { userName, userEmail, userPhoto, platform } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection?.remoteAddress || 'غير معروف';
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const now = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' });
    const deviceInfo = parseUserAgent(userAgent);
    const referer = req.headers['referer'] || req.headers['referrer'] || 'مباشر';
    const acceptLang = req.headers['accept-language'] || 'غير معروف';
    const lang = acceptLang.split(',')[0] || 'غير معروف';

    const message = `🟢 <b>مستخدم جديد - Aite.studio</b>\n\n` +
        `👤 <b>الاسم:</b> ${escapeHtml(userName)}\n` +
        `📧 <b>الإيميل:</b> ${escapeHtml(userEmail)}\n` +
        `🖼 <b>صورة الملف:</b> ${escapeHtml(userPhoto)}\n` +
        `🌐 <b>IP:</b> ${escapeHtml(ip)}\n` +
        `📱 <b>المنصة:</b> ${escapeHtml(platform)}\n` +
        `💻 <b>نظام التشغيل:</b> ${escapeHtml(deviceInfo.os)}\n` +
        `🔍 <b>المتصفح:</b> ${escapeHtml(deviceInfo.browser)}\n` +
        `📲 <b>نوع الجهاز:</b> ${escapeHtml(deviceInfo.device)}\n` +
        `🌍 <b>اللغة:</b> ${escapeHtml(lang)}\n` +
        `🔗 <b>مصدر الزيارة:</b> ${escapeHtml(referer)}\n` +
        `🕐 <b>الوقت:</b> ${now}\n` +
        `📋 <b>User-Agent:</b> <code>${escapeHtml(userAgent.substring(0, 200))}</code>`;

    await sendTelegramNotification(message);
    res.json({ success: true });
});

// --- API: طلب البناء ---
app.post('/api/build', buildLimiter, async (req, res) => {
    const { appName, packageName, appUrl, iconBase64, permissions, customizations, offlinePageHtml } = req.body;

    // ─── Input Validation ───
    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: 'بيانات ناقصة: اسم التطبيق، معرف الحزمة، رابط الموقع، أو الأيقونة مفقودة.' });
    }
    if (!isValidAppName(appName)) {
        return res.status(400).json({ error: 'اسم التطبيق غير صالح (1-100 حرف).' });
    }
    if (!isValidPackageName(packageName)) {
        return res.status(400).json({ error: 'معرف الحزمة غير صالح. يجب أن يكون مثل: com.company.app' });
    }
    if (!isValidUrl(appUrl)) {
        return res.status(400).json({ error: 'رابط الموقع غير صالح. يجب أن يبدأ بـ http:// أو https://' });
    }
    if (!iconBase64.startsWith('data:image/')) {
        return res.status(400).json({ error: 'صيغة الأيقونة غير صالحة.' });
    }
    if (iconBase64.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'حجم الأيقونة كبير جداً (الحد الأقصى 10MB).' });
    }

    // إرسال إشعار Telegram عند طلب بناء تطبيق
    const buildIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection?.remoteAddress || 'غير معروف';
    const buildTime = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' });
    const buildUA = req.headers['user-agent'] || 'Unknown';
    const buildDevice = parseUserAgent(buildUA);
    const buildMsg = `🔨 <b>طلب بناء تطبيق جديد - Aite.studio</b>\n\n` +
        `📱 <b>اسم التطبيق:</b> ${escapeHtml(appName)}\n` +
        `📦 <b>الحزمة:</b> ${escapeHtml(packageName)}\n` +
        `🔗 <b>الرابط:</b> ${escapeHtml(appUrl)}\n` +
        `🌐 <b>IP:</b> ${escapeHtml(buildIp)}\n` +
        `💻 <b>النظام:</b> ${escapeHtml(buildDevice.os)}\n` +
        `🔍 <b>المتصفح:</b> ${escapeHtml(buildDevice.browser)}\n` +
        `📲 <b>الجهاز:</b> ${escapeHtml(buildDevice.device)}\n` +
        `📋 <b>الأذونات:</b> ${escapeHtml(JSON.stringify(permissions))}\n` +
        `⚙️ <b>التخصيصات:</b> ${escapeHtml(JSON.stringify(customizations))}\n` +
        `🕐 <b>الوقت:</b> ${buildTime}`;
    sendTelegramNotification(buildMsg);

    if (!GITHUB_TOKEN) {
        return res.status(500).json({ error: 'خطأ في الخادم: GITHUB_TOKEN غير موجود.' });
    }

    try {
        console.log(`🚀 بدء طلب جديد لـ: ${appName}`);

        // أ. رفع الصورة إلى Cloudinary
        // ملاحظة: Vercel قد يغلق الاتصال إذا استغرق الرفع أكثر من 10-60 ثانية
        const uploadRes = await cloudinary.uploader.upload(iconBase64, {
            folder: "app_icons",
            resource_type: "image",
            transformation: [{ width: 512, height: 512, crop: "limit" }] // تحسين لتقليل الحجم
        });
        
        const iconUrl = uploadRes.secure_url;
        console.log(`✅ تم رفع الصورة: ${iconUrl}`);

        // ب. إرسال أمر البناء لـ GitHub
        const permissionsJson = JSON.stringify(permissions);
        const customizationsJson = JSON.stringify(customizations);
        const requestId = uuidv4(); 

        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    request_id: requestId,
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_url: iconUrl,
                    permissions_json: permissionsJson,
                    customizations_json: customizationsJson,
                    offline_page_html: offlinePageHtml || ''
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        console.log(`🆔 تم إرسال طلب البناء بمعرف: ${requestId}`);
        res.json({ success: true, run_id: requestId });

    } catch (error) {
        console.error("❌ Error during build request:", error.message);
        res.status(500).json({ error: 'فشل المعالجة. حاول مرة أخرى لاحقاً.' });
    }
});

// --- API: فحص الحالة ---
app.get('/api/status/:requestId', async (req, res) => {
    const { requestId } = req.params;

    // Validate requestId format (UUID v4)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return res.status(400).json({ error: 'معرف الطلب غير صالح' });
    }

    try {
        const runsResponse = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?event=repository_dispatch&per_page=5`, 
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );

        let foundRun = null;

        for (const run of runsResponse.data.workflow_runs) {
            // تحقق سريع من الاسم لتجنب جلب التفاصيل لكل عملية (تحسين للأداء)
            // الاسم في YML هو: Build AppName (REQUEST_ID)
            if (run.name && run.name.includes(requestId)) {
                 foundRun = run;
                 break;
            }
            
            // الطريقة القديمة (الاحتياطية) في حال لم يعمل التحقق من الاسم
            try {
                const runDetailsResponse = await axios.get(
                    run.url, 
                    { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
                );
                if (runDetailsResponse.data.client_payload && runDetailsResponse.data.client_payload.request_id === requestId) {
                    foundRun = runDetailsResponse.data;
                    break;
                }
            } catch (innerError) {
                continue;
            }
        }

        if (foundRun) {
            let downloadUrl = null;
            if (foundRun.status === 'completed' && foundRun.conclusion === 'success') {
                downloadUrl = await getReleaseDownloadUrl(foundRun.id, REPO_OWNER, REPO_NAME, GITHUB_TOKEN);
            }
            res.json({
                status: foundRun.status,
                conclusion: foundRun.conclusion,
                github_run_id: foundRun.id,
                download_url: downloadUrl
            });
        } else {
            res.json({ status: 'queued', conclusion: null, github_run_id: null, download_url: null });
        }

    } catch (error) {
        console.error(`Error checking status:`, error.message);
        // نرسل حالة "قيد التقدم" لتجنب توقف واجهة المستخدم
        res.status(200).json({ status: 'in_progress', conclusion: null }); 
    }
});

// --- API: Proxy Download (restricted to GitHub releases only - SSRF protection) ---
app.get('/api/download', async (req, res) => {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).json({ error: 'URL مفقود' });

    // ─── SSRF Protection: Only allow downloads from GitHub ───
    try {
        const parsedUrl = new URL(fileUrl);
        const allowedHosts = ['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'];
        if (!allowedHosts.some(host => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host))) {
            return res.status(403).json({ error: 'غير مسموح بالتحميل من هذا المصدر' });
        }
        if (parsedUrl.protocol !== 'https:') {
            return res.status(403).json({ error: 'يجب استخدام HTTPS' });
        }
    } catch {
        return res.status(400).json({ error: 'رابط غير صالح' });
    }

    try {
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream',
            headers: { 'User-Agent': 'AiteStudio/1.0' },
            maxRedirects: 10,
            timeout: 120000
        });
        const rawName = req.query.name ? req.query.name.replace(/[^a-zA-Z0-9\u0600-\u06FF._-]/g, '_') : 'app';
        const filename = `${rawName}.apk`;
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        response.data.pipe(res);
    } catch (error) {
        console.error('Download proxy error:', error.message);
        res.status(500).json({ error: 'فشل تحميل الملف' });
    }
});

// ─── Global error handler ───
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
