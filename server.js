const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();

// زيادة حجم البيانات المسموح به لاستقبال الصور
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static('public'));

// 1. إعدادات Cloudinary (كما طلبت)
cloudinary.config({ 
  cloud_name: 'duixjs8az', 
  api_key: '143978951428697', 
  api_secret: '9dX6eIvntdtGQIU7oXGMSRG9I2o' 
});

// 2. إعدادات GitHub (يجب أن تكون في Environment Variables في Vercel)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN) console.error("⚠️ تحذير: GITHUB_TOKEN غير موجود!");

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: طلب البناء ---
app.post('/api/build', async (req, res) => {
    const { appName, packageName, appUrl, iconBase64, permissions } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: 'بيانات ناقصة' });
    }

    try {
        console.log(`🚀 بدء طلب جديد لـ: ${appName}`);

        // أ. رفع الصورة إلى Cloudinary
        const uploadRes = await cloudinary.uploader.upload(iconBase64, {
            folder: "app_icons",
            resource_type: "image"
        });
        const iconUrl = uploadRes.secure_url;
        console.log(`✅ تم رفع الصورة: ${iconUrl}`);

        // ب. إرسال أمر البناء لـ GitHub
        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_url: iconUrl,
                    permissions: permissions
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        // ج. انتظار قليل والحصول على Run ID الخاص بهذه العملية تحديداً
        // ننتظر 3 ثواني لضمان أن GitHub قد أنشأ العملية في القائمة
        setTimeout(async () => {
    try {
        // جلب آخر 5 عمليات بناء للتأكد من إيجاد العملية الصحيحة
        const runs = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?event=repository_dispatch&per_page=5`,
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );
        
        // البحث عن العملية التي تحتوي على اسم التطبيق في العنوان أو التي بدأت الآن
        // سنعتمد على أول عملية في القائمة لأنها الأحدث التي أطلقها السيرفر قبل 3 ثوانٍ
        if (runs.data.workflow_runs.length > 0) {
            const runId = runs.data.workflow_runs[0].id;
            console.log(`🆔 تم تخصيص Run ID فريد لطلبك: ${runId}`);
            res.json({ success: true, run_id: runId });
        } else {
            res.status(500).json({ error: "لم يتم العثور على العملية، حاول مجدداً" });
        }
    } catch (err) {
        res.status(500).json({ error: "فشل في تتبع العملية" });
    }
}, 4000); // زيادة وقت التأخير لـ 4 ثوانٍ لضمان استجابة GitHub

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: "فشل المعالجة" });
    }
});

// --- API: فحص الحالة برقم العملية (Fixes the issue) ---
app.get('/api/status/:runId', async (req, res) => {
    const { runId } = req.params;
    try {
        const response = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${runId}`,
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );
        
        res.json({
            status: response.data.status, // queued, in_progress, completed
            conclusion: response.data.conclusion, // success, failure
            run_id: response.data.id
        });
    } catch (error) {
        console.error(`Error checking status for ${runId}:`, error.message);
        res.status(500).json({ error: 'Could not fetch status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
