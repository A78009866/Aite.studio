const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

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

app.post('/api/build', async (req, res) => {
    console.log("📥 New Build Request via GitHub Trigger");

    const { appName, packageName, appUrl, iconBase64, permissions, customizations } = req.body;

    try {
        // 1. رفع الأيقونة لـ Cloudinary للحصول على رابط مباشر
        console.log("🖼️ Uploading icon...");
        const uploadResponse = await cloudinary.uploader.upload(iconBase64, {
            folder: "aite_icons"
        });
        const iconUrl = uploadResponse.secure_url;

        // 2. تجهيز بيانات التطبيق
        const appConfig = {
            last_build: new Date().toISOString(),
            config: {
                appName,
                packageName,
                appUrl,
                iconUrl,
                permissions,
                customizations
            }
        };

        // 3. تحديث ملف app_config.json في GitHub لإطلاق البناء
        // استبدل 'USER/REPO' بمسار مستودعك الحقيقي (مثلاً a78009866/my-app)
        const GITHUB_REPO = process.env.GITHUB_REPO; 
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const FILE_PATH = 'app_config.json';

        console.log("🔗 Updating GitHub config file...");
        
        // الحصول على SHA للملف الحالي (مطلوب من GitHub API لتحديث الملف)
        const getFile = await axios.get(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`,
            { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
        ).catch(() => null);

        const sha = getFile ? getFile.data.sha : null;

        // إرسال التحديث لـ GitHub
        await axios.put(
            `https://api.github.com/repos/${GITHUB_REPO}/contents/${FILE_PATH}`,
            {
                message: `Build request: ${appName}`,
                content: Buffer.from(JSON.stringify(appConfig, null, 2)).toString('base64'),
                sha: sha
            },
            { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
        );

        console.log("✅ GitHub Updated! Cirrus CI should start now.");

        res.status(200).json({
            success: true,
            message: "Build triggered via GitHub update",
            // ملاحظة: بما أننا نستخدم GitHub، سنعتمد على واجهة Cirrus CI للمتابعة
            tracking_url: `https://cirrus-ci.com/github/${GITHUB_REPO}`
        });

    } catch (error) {
        console.error("🔥 Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to trigger build", details: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
