const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cloudinary = require('cloudinary').v2; // استدعاء مكتبة Cloudinary

const app = express();

// زيادة الحد المسموح به لاستقبال صور Base64
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static('public'));

// إعدادات GitHub من البيئة
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

// إعدادات Cloudinary (بناءً على البيانات التي أرسلتها)
cloudinary.config({ 
  cloud_name: 'duixjs8az', 
  api_key: '143978951428697', 
  api_secret: '9dX6eIvntdtGQIU7oXGMSRG9I2o' 
});

if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
    console.error("❌ CRITICAL ERROR: Environment variables for GitHub are missing.");
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// دالة لرفع الصورة إلى Cloudinary
async function uploadToCloudinary(base64Data) {
    try {
        const result = await cloudinary.uploader.upload(base64Data, {
            folder: "app_icons", // مجلد داخل Cloudinary لتنظيم الصور
            resource_type: "image",
            allowed_formats: ["jpg", "png", "jpeg"]
        });
        return result.secure_url; // إرجاع الرابط الآمن (HTTPS)
    } catch (error) {
        console.error("Cloudinary Error:", error);
        throw new Error("Failed to upload image to Cloudinary");
    }
}

app.post('/api/build', async (req, res) => {
    console.log("📩 Received build request...");
    
    const { appName, packageName, appUrl, iconBase64, permissions } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: 'بيانات ناقصة' });
    }

    try {
        // 1. رفع الصورة إلى Cloudinary
        console.log("☁️ Uploading icon to Cloudinary...");
        const iconUrl = await uploadToCloudinary(iconBase64);
        console.log(`✅ Icon uploaded: ${iconUrl}`);
        
        // 2. إرسال البيانات إلى GitHub Action
        console.log(`🚀 Triggering GitHub Action...`);
        
        await axios.post(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
            {
                event_type: 'build-apk',
                client_payload: {
                    app_name: appName,
                    package_name: packageName,
                    app_url: appUrl,
                    icon_url: iconUrl, // نرسل رابط Cloudinary
                    use_camera: permissions?.camera || false,
                    use_mic: permissions?.mic || false,
                    use_location: permissions?.location || false,
                    use_files: permissions?.files || false
                }
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        console.log("✅ GitHub Dispatch Sent Successfully");
        res.json({ success: true, message: 'تم بدء عملية البناء' });

    } catch (error) {
        console.error("❌ Process Error:", error.message);
        const status = error.response ? error.response.status : 500;
        res.status(status).json({ error: "فشل في معالجة الطلب" });
    }
});

// API الحالة (بدون تغيير)
app.get('/api/status', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/runs?per_page=1`,
            { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } }
        );
        if (response.data.workflow_runs.length > 0) {
            const lastRun = response.data.workflow_runs[0];
            res.json({
                status: lastRun.status,
                conclusion: lastRun.conclusion,
                html_url: lastRun.html_url,
                run_id: lastRun.id 
            });
        } else {
            res.json({ status: 'queued', conclusion: null });
        }
    } catch (error) {
        res.status(500).json({ error: 'Could not fetch status' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
