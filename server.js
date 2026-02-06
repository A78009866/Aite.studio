const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

// تحميل المتغيرات البيئية
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
// السماح بأحجام كبيرة للصور
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.post('/api/build', async (req, res) => {
    console.log("📥 Received Build Request (GitHub Strategy)");

    const { 
        appName, 
        packageName, 
        appUrl, 
        iconBase64, 
        permissions, 
        customizations 
    } = req.body;

    // التحقق من البيانات
    if (!appName || !packageName || !appUrl || !iconBase64) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    try {
        let finalIconUrl = iconBase64;

        // 1. رفع الصورة إلى Cloudinary
        if (iconBase64.startsWith('data:image')) {
            console.log("🖼️ Uploading Icon...");
            const uploadResponse = await cloudinary.uploader.upload(iconBase64, {
                folder: "apk_builder_icons",
                public_id: `${packageName.replace(/\./g, '_')}_icon`,
                overwrite: true
            });
            finalIconUrl = uploadResponse.secure_url;
            console.log("✅ Icon Uploaded:", finalIconUrl);
        }

        // 2. تجهيز ملف الإعدادات (JSON)
        // هذا الملف سيتم حفظه في GitHub ليقرأه Cirrus CI
        const appConfig = {
            app_name: appName,
            package_name: packageName,
            app_url: appUrl,
            icon_url: finalIconUrl,
            permissions: {
                camera: permissions?.camera || false,
                mic: permissions?.mic || false,
                location: permissions?.location || false,
                files: permissions?.files || false,
                notify: permissions?.notify || false
            },
            customizations: {
                zoom: customizations?.enableZoom || true,
                text_selection: customizations?.enableTextSelection || true,
                splash: customizations?.enableSplashScreen || true
            },
            build_timestamp: new Date().toISOString() // لضمان تغيير محتوى الملف دائماً
        };

        // 3. تحديث الملف في GitHub
        const githubUser = process.env.GITHUB_USERNAME;
        const githubRepo = process.env.GITHUB_REPO;
        const githubToken = process.env.GITHUB_TOKEN;
        const filePath = 'app_config.json'; // اسم الملف في المستودع
        
        const apiUrl = `https://api.github.com/repos/${githubUser}/${githubRepo}/contents/${filePath}`;

        // أ. جلب الـ SHA الحالي للملف (مطلوب للتحديث)
        let sha = null;
        try {
            const getFile = await axios.get(apiUrl, {
                headers: { Authorization: `token ${githubToken}` }
            });
            sha = getFile.data.sha;
        } catch (err) {
            console.log("ℹ️ File does not exist yet, creating new one.");
        }

        // ب. تحديث الملف (Commit)
        const contentBase64 = Buffer.from(JSON.stringify(appConfig, null, 2)).toString('base64');
        
        await axios.put(apiUrl, {
            message: `🚀 Build Trigger: ${appName}`,
            content: contentBase64,
            sha: sha // إذا كان null سيقوم بإنشاء ملف جديد
        }, {
            headers: { Authorization: `token ${githubToken}` }
        });

        console.log("✅ GitHub File Updated -> Build Triggered!");

        res.status(200).json({
            success: true,
            message: "Build request sent to GitHub",
            tracking_url: `https://github.com/${githubUser}/${githubRepo}/actions` // أو رابط Cirrus إذا كنت تعرفه
        });

    } catch (error) {
        console.error("🔥 Server Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to trigger build via GitHub", details: error.message });
    }
});

app.get('/', (req, res) => res.send("Aite Studio Server (GitHub Mode) is Running 🚀"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
