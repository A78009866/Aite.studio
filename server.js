const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

if (process.env.NODE_ENV !== 'production') require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات Cloudinary (للأيقونات)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- ذاكرة مؤقتة لحفظ حالة البناء ---
// المفتاح هو الباكج نيم، والقيمة هي الحالة ورابط التحميل
let builds = {};

// 1. استقبال طلب البناء من الواجهة
app.post('/api/build', async (req, res) => {
    const { appName, packageName, appUrl, iconBase64 } = req.body;

    if (!appName || !packageName || !appUrl) return res.status(400).json({ error: "Missing Data" });

    // تسجيل البناء في الذاكرة كـ "قيد الانتظار"
    builds[packageName] = { status: 'building', url: null };

    try {
        let finalIconUrl = iconBase64;
        // رفع الأيقونة
        if (iconBase64 && iconBase64.startsWith('data:image')) {
            const upload = await cloudinary.uploader.upload(iconBase64, {
                folder: "apk_icons", public_id: `${packageName.replace(/\./g, '_')}_icon`, overwrite: true
            });
            finalIconUrl = upload.secure_url;
        }

        // تجهيز ملف الإعدادات
        const appConfig = {
            APP_NAME: appName,
            PACKAGE_NAME: packageName,
            APP_URL: appUrl,
            ICON_URL: finalIconUrl || "",
            // هذا الرابط سيستخدمه Cirrus ليعيد الاتصال بنا
            CALLBACK_URL: `https://${req.get('host')}/api/webhook`, 
            TIMESTAMP: new Date().toISOString()
        };

        // تحديث GitHub لإيقاظ Cirrus
        const owner = process.env.REPO_OWNER;
        const repo = process.env.REPO_NAME;
        const token = process.env.GITHUB_TOKEN;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/app_config.json`;

        let sha = null;
        try {
            const { data } = await axios.get(apiUrl, { headers: { Authorization: `token ${token}` } });
            sha = data.sha;
        } catch (e) {}

        await axios.put(apiUrl, {
            message: `🚀 Build: ${appName}`,
            content: Buffer.from(JSON.stringify(appConfig, null, 2)).toString('base64'),
            sha: sha
        }, { headers: { Authorization: `token ${token}` } });

        res.json({ success: true, buildId: packageName });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to trigger build" });
    }
});

// 2. نقطة المراقبة (Polling) - الواجهة تطلبها كل 5 ثواني
app.get('/api/status/:id', (req, res) => {
    const status = builds[req.params.id] || { status: 'not_found' };
    res.json(status);
});

// 3. نقطة الاستقبال (Webhook) - Cirrus يستدعيها عند الانتهاء
app.post('/api/webhook', (req, res) => {
    const { buildId, status, downloadUrl } = req.body;
    
    console.log(`🔔 Webhook received for ${buildId}: ${status}`);
    
    // تحديث الحالة في الذاكرة
    if (buildId) {
        builds[buildId] = { 
            status: status, 
            url: downloadUrl 
        };
    }
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
