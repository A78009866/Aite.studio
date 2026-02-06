const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// تحميل dotenv فقط محلياً
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/build', async (req, res) => {
    console.log("📥 Received Build Request via GitHub Trigger");

    const { 
        appName, 
        packageName, 
        appUrl, 
        iconBase64, 
        permissions, 
        customizations 
    } = req.body;

    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        let finalIconUrl = iconBase64;

        // 1. رفع الصورة
        if (iconBase64.startsWith('data:image')) {
            console.log("🖼️ Uploading Icon...");
            const uploadResponse = await cloudinary.uploader.upload(iconBase64, {
                folder: "apk_icons",
                public_id: `${packageName.replace(/\./g, '_')}_icon`,
                overwrite: true
            });
            finalIconUrl = uploadResponse.secure_url;
        }

        // 2. تجهيز ملف الإعدادات JSON
        const appConfig = {
            APP_NAME: appName,
            PACKAGE_NAME: packageName,
            APP_URL: appUrl,
            ICON_URL: finalIconUrl,
            // تحويل الأذونات إلى صيغة بسيطة
            PERMISSIONS: Object.keys(permissions || {}).filter(k => permissions[k]).join(','), 
            CUSTOM_ZOOM: customizations?.enableZoom || false,
            CUSTOM_SPLASH: customizations?.enableSplashScreen || false,
            TIMESTAMP: new Date().toISOString()
        };

        // 3. تحديث الملف في GitHub
        // استخدام الأسماء الموجودة في صورتك (REPO_OWNER, REPO_NAME)
        const owner = process.env.REPO_OWNER;
        const repo = process.env.REPO_NAME;
        const token = process.env.GITHUB_TOKEN;
        const path = 'app_config.json';
        
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

        // جلب SHA للملف الحالي (لتحديثه)
        let sha = null;
        try {
            const { data } = await axios.get(apiUrl, { headers: { Authorization: `token ${token}` } });
            sha = data.sha;
        } catch (e) { /* الملف غير موجود، سننشئه */ }

        // التحديث أو الإنشاء
        await axios.put(apiUrl, {
            message: `🚀 Build Trigger: ${appName}`,
            content: Buffer.from(JSON.stringify(appConfig, null, 2)).toString('base64'),
            sha: sha
        }, {
            headers: { Authorization: `token ${token}` }
        });

        console.log("✅ app_config.json updated on GitHub");

        res.status(200).json({
            success: true,
            message: "Build triggered successfully",
            tracking_url: `https://cirrus-ci.com/github/${owner}/${repo}`
        });

    } catch (error) {
        console.error("🔥 Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to trigger build" });
    }
});

app.get('/', (req, res) => res.send("Server Running"));
app.listen(PORT, () => console.log(`Server on ${PORT}`));
