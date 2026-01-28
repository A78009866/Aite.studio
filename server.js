const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { v4: uuidv4 } = require('uuid'); // Import uuid

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

if (!GITHUB_TOKEN) {
    console.error("⚠️ تحذير: GITHUB_TOKEN غير موجود! لن تتمكن من بدء عمليات بناء GitHub Actions.");
    // يمكنك اختيار إيقاف السيرفر أو التعامل مع هذا بشكل مختلف
    // process.exit(1); 
}
if (!REPO_OWNER || !REPO_NAME) {
    console.error("⚠️ تحذير: REPO_OWNER أو REPO_NAME غير موجودين! لن تتمكن من بدء عمليات بناء GitHub Actions.");
}


app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- API: طلب البناء ---
app.post('/api/build', async (req, res) => {
    const { appName, packageName, appUrl, iconBase64, permissions, customizations } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: 'بيانات ناقصة: اسم التطبيق، معرف الحزمة، رابط الموقع، أو الأيقونة مفقودة.' });
    }
    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
        return res.status(500).json({ error: 'خطأ في إعدادات الخادم: GITHUB_TOKEN أو REPO_OWNER أو REPO_NAME غير مضبوطة.' });
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
        // دمج الأذونات والتخصيصات في سلاسل نصية JSON لتقليل عدد الخصائص
        const permissionsJson = JSON.stringify(permissions);
        const customizationsJson = JSON.stringify(customizations);
        const requestId = uuidv4(); // Generate a unique request ID

        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    request_id: requestId, // Pass the unique request ID
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_url: iconUrl,
                    permissions_json: permissionsJson, // دمج الأذونات
                    customizations_json: customizationsJson // دمج التخصيصات
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
        res.json({ success: true, run_id: requestId }); // Return the request ID to the client

    } catch (error) {
        console.error("❌ Error during build request:", error.message);
        if (error.response) {
            console.error("GitHub API Response Status:", error.response.status);
            console.error("GitHub API Response Data:", error.response.data);
            res.status(error.response.status).json({ error: `فشل المعالجة: ${error.response.data.message || error.message}` });
        } else {
            res.status(500).json({ error: "فشل المعالجة: " + error.message });
        }
    }
});

// --- API: فحص الحالة برقم العملية (Fixes the issue) ---
app.get('/api/status/:requestId', async (req, res) => {
    const { requestId } = req.params;
    try {
        // Fetch recent repository_dispatch workflow runs
        const runsResponse = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?event=repository_dispatch&per_page=20`, // Fetch more runs to increase chances
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );

        let foundRun = null;
        for (const run of runsResponse.data.workflow_runs) {
            // Fetch details for each run to access client_payload
            const runDetailsResponse = await axios.get(
                `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs/${run.id}`,
                { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
            );
            const clientPayload = runDetailsResponse.data.client_payload;
            if (clientPayload && clientPayload.request_id === requestId) {
                foundRun = runDetailsResponse.data;
                break;
            }
        }

        if (foundRun) {
            res.json({
                status: foundRun.status, // queued, in_progress, completed
                conclusion: foundRun.conclusion, // success, failure
                github_run_id: foundRun.id // Return the actual GitHub run ID
            });
        } else {
            // If no matching run is found yet, assume it's queued or not started
            res.json({ status: 'queued', conclusion: null, github_run_id: null });
        }

    } catch (error) {
        console.error(`Error checking status for request ${requestId}:`, error.message);
        res.status(500).json({ error: 'Could not fetch status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
