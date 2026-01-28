const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid');

const app = express();

// زيادة حجم البيانات المسموح به لاستقبال الصور (ضروري للـ Base64)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static('public'));

// 1. إعدادات Cloudinary
cloudinary.config({ 
  cloud_name: 'duixjs8az', 
  api_key: '143978951428697', 
  api_secret: '9dX6eIvntdtGQIU7oXGMSRG9I2o' 
});

// 2. إعدادات GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error("⚠️ تحذير: متغيرات البيئة الخاصة بـ GitHub مفقودة.");
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
        const asset = release.assets.find(a => a.name === 'app-debug.apk');
        return asset ? asset.browser_download_url : null;
    } catch (error) {
        // لا نطبع الخطأ هنا لتجنب إغراق السجلات، لأن الإصدار قد لا يكون جاهزاً بعد
        return null;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: طلب البناء ---
app.post('/api/build', async (req, res) => {
    // استقبال البيانات
    const { appName, packageName, appUrl, iconBase64, permissions, customizations } = req.body;

    // --- تصحيح الخطأ هنا: تم تغيير iconBase66 إلى iconBase64 ---
    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: 'بيانات ناقصة: اسم التطبيق، معرف الحزمة، رابط الموقع، أو الأيقونة مفقودة.' });
    }

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
                    customizations_json: customizationsJson
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
        res.status(500).json({ error: `فشل المعالجة: ${error.message}` });
    }
});

// --- API: فحص الحالة ---
app.get('/api/status/:requestId', async (req, res) => {
    const { requestId } = req.params;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
